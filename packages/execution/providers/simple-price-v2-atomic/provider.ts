/** Isolated read-only mainnet capture. No production registration or configuration mutation. */
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { SolanaRpcClient, withAdvisoryRead } from '@paperfund/protocols';
import { Stage1NonSolPumpSwap } from '../../../protocols/src/experimental/non-sol-pump-swap.js';
import { decodeNonSol } from '../simple-price-v2/non-sol.js';
import { REAL_POLICY, RealMarketProvider } from '../simple-price-v2/provider.js';
import {
  CandidateError,
  validateEvidence,
  calibrate,
} from '../../candidates/simple-price-v2-directional/model.js';
import type { Policy } from '../../candidates/simple-price-v2-directional/model.js';
import { normalizeDirectional } from './normalize.js';
export const HELIUS_ID = 'https://mainnet.helius-rpc.com';
const SOLANA = 'https://api.mainnet-beta.solana.com';
export const ATOMIC_POLICY: Policy = {
  ...REAL_POLICY,
  version: 'UNAPPROVED_PRIVATE_ATOMIC_HELIUS_V1',
  trustedSources: { ...REAL_POLICY.trustedSources, helius: HELIUS_ID },
};
export interface Receipt {
  readonly upstream: string;
  readonly request: { method: string; params: unknown[] };
  readonly status: number;
  readonly receivedAtMs: number;
  readonly body: { result?: unknown; error?: { code?: number; message: string } };
}
function existingHelius(): string {
  let url = process.env['SOLANA_RPC_URL'];
  if (!url) {
    try {
      url = parse(readFileSync('.env'))['SOLANA_RPC_URL'];
    } catch {
      throw new CandidateError('CONFIGURED_HELIUS_REQUIRED');
    }
  }
  try {
    const parsed = new URL(url ?? '');
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'mainnet.helius-rpc.com' ||
      parsed.username ||
      parsed.password
    )
      throw new Error();
  } catch {
    throw new CandidateError('CONFIGURED_HELIUS_REQUIRED');
  }
  return url!;
}
export class AtomicMarketProvider {
  readonly sol = new RealMarketProvider();
  readonly reviews = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly #urls = [SOLANA, existingHelius()];
  private readonly identities = [SOLANA, HELIUS_ID];
  private readonly denied = new Set<number>();
  private readonly slots = new Map<string, number>();
  private verified = false;
  readonly receipts: Receipt[] = [];
  readonly attempts: unknown[] = [];
  private readonly sent = [0, 0];
  private async transport(index: number, init: RequestInit): Promise<Response> {
    if (this.denied.has(index)) throw new CandidateError('RPC_ACCESS_DENIED');
    const request = JSON.parse(String(init.body)) as Receipt['request'];
    if (!['getGenesisHash', 'getMultipleAccounts', 'getAccountInfo'].includes(request.method))
      throw new CandidateError('READ_ONLY_RPC_REQUIRED');
    // Private provider I/O budget; no artificial execution price or timestamp adjustment.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 125 - (Date.now() - this.sent[index]!))),
    );
    init.signal?.throwIfAborted();
    this.sent[index] = Date.now();
    let response: Response;
    try {
      response = await fetch(this.#urls[index]!, { ...init, redirect: 'error' });
    } catch {
      throw new CandidateError('RPC_TRANSPORT_UNAVAILABLE');
    }
    let body: Receipt['body'];
    try {
      const decoded = (await response.clone().json()) as {
        result?: unknown;
        error?: { code?: number };
      };
      body = decoded.error
        ? {
            error: {
              ...(decoded.error.code === undefined ? {} : { code: decoded.error.code }),
              message: 'PROVIDER_REJECTED_REQUEST',
            },
          }
        : { result: decoded.result };
    } catch {
      body = { error: { message: 'NON_JSON_PROVIDER_RESPONSE' } };
    }
    this.receipts.push({
      upstream: this.identities[index]!,
      request,
      status: response.status,
      receivedAtMs: Date.now(),
      body,
    });
    if (response.status === 401 || response.status === 403) {
      this.denied.add(index);
      throw new CandidateError('RPC_ACCESS_DENIED');
    }
    return response;
  }
  private async network() {
    if (this.verified) return;
    const results = await Promise.allSettled(
      this.#urls.map(async (_, index) => {
        const response = await this.transport(index, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'getGenesisHash', params: [] }),
          signal: AbortSignal.timeout(5000),
        });
        const b = (await response.json()) as { result?: string };
        if (!response.ok || b.result !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
          throw new CandidateError('MAINNET_PROVENANCE_UNVERIFIED');
      }),
    );
    if (results.some((r) => r.status === 'rejected'))
      throw new CandidateError('RPC_NETWORK_VERIFICATION_UNAVAILABLE');
    this.verified = true;
  }
  captureNonSol(mint: string) {
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        const start = this.receipts.length;
        let diagnostic: Awaited<ReturnType<typeof normalizeDirectional>> | undefined;
        try {
          if (this.denied.size) throw new CandidateError('RPC_ACCESS_DENIED');
          await this.network();
          const results = await Promise.allSettled(
            this.#urls.map(async (_, index) => {
              const rpc = new SolanaRpcClient({
                url: this.#urls[index]!,
                commitment: 'confirmed',
                timeoutMs: 5000,
                fetchImplementation: (_url, init) => this.transport(index, init ?? {}),
              });
              const slotKey = index + ':' + mint;
              const minimumSlot = this.slots.get(slotKey);
              const acquire = () =>
                withAdvisoryRead(
                  {
                    signal: AbortSignal.timeout(5000),
                    metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 },
                    ...(minimumSlot === undefined ? {} : { minimumSlot }),
                  },
                  () =>
                    new Stage1NonSolPumpSwap({ purpose: 'READ_ONLY_STAGE1_VALIDATION' }).capture(
                      rpc,
                      mint,
                    ),
                );
              let state: Awaited<ReturnType<Stage1NonSolPumpSwap['capture']>>;
              try {
                state = await acquire();
              } catch (error) {
                if (!(error instanceof Error) || error.message !== 'STAGE1_CLOCK_INCONSISTENT')
                  throw error;
                this.attempts.push({
                  mint,
                  upstream: this.identities[index],
                  retry: 'CLOCK_CONTEXT_MISMATCH_FULL_RECAPTURE',
                  attempt: 2,
                });
                state = await acquire();
              }
              const decoded = await decodeNonSol(state, index as 0 | 1),
                source = index === 0 ? 'solana' : 'helius',
                upstream = this.identities[index]!;
              return {
                ...decoded,
                native: { ...decoded.native, source, upstream },
                conversion: { ...decoded.conversion, source, upstream },
              };
            }),
          );
          if (results.some((r) => r.status === 'rejected')) {
            this.attempts.push({
              mint,
              failures: results.flatMap((r) =>
                r.status === 'rejected'
                  ? [String(r.reason).replace(/https?:\/\/\S+/g, '[REDACTED_ENDPOINT]')]
                  : [],
              ),
              receipts: structuredClone(this.receipts.slice(start)),
            });
            throw new CandidateError(
              this.denied.size ? 'RPC_ACCESS_DENIED' : 'ATOMIC_CAPTURE_UNAVAILABLE',
            );
          }
          const observations = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
          // A deliberately bounded private quote sample, not a changed fee rule or fallback after rejection.
          const referenceBudgets = [100000000n, 10000000n, 2000000000n];
          const normalized = await normalizeDirectional(
              observations,
              ATOMIC_POLICY,
              Date.now(),
              referenceBudgets,
            ),
            e = normalized.evidence;
          diagnostic = normalized;
          const now = Date.now(),
            price = validateEvidence(e, e.identity, now, ATOMIC_POLICY),
            curve = calibrate(e, price, now, ATOMIC_POLICY);
          observations.forEach((o, index) =>
            this.slots.set(index + ':' + mint, o.sourceState.slot),
          );
          const capture = {
            provenance: 'REAL_READ_ONLY_ATOMIC_MAINNET' as const,
            evidence: e,
            normalized,
            curve,
            referenceBudgets,
            observations,
            receipts: structuredClone(this.receipts.slice(start)),
            genesis: structuredClone(
              this.receipts.filter((r) => r.request.method === 'getGenesisHash'),
            ),
            receivedAtMs: Date.now(),
            tokenDecimals: observations[0]!.baseDecimals,
            quoteDecimals: observations[0]!.quoteDecimals,
          };
          this.reviews.set(mint, capture);
          this.attempts.push(capture);
          return capture;
        } catch (error) {
          this.reviews.set(mint, {
            error: error instanceof CandidateError ? error.code : 'ATOMIC_CAPTURE_UNAVAILABLE',
            diagnostic,
            receipts: structuredClone(this.receipts.slice(start)),
          });
          this.attempts.push(this.reviews.get(mint));
          throw error;
        }
      });
    this.queue = task;
    return task;
  }
  captureSol(mint: string) {
    return this.sol.capture(mint);
  }
}
export type AtomicCapture = Awaited<ReturnType<AtomicMarketProvider['captureNonSol']>>;
