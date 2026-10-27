/** Bounded read-only measurement only. No market capture here can enter a financial service. */
import { readFileSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { performance } from 'node:perf_hooks';
import { it, expect } from 'vitest';
import { identifier } from '@paperfund/core';
import {
  SolanaRpcClient,
  PumpSwapSolanaMarketStateSource,
  PumpSwapProtocolAdapter,
  PUMP_SWAP_PROTOCOL_ID,
  withAdvisoryRead,
} from '@paperfund/protocols';
import { Stage1NonSolPumpSwap } from '../../../protocols/src/experimental/non-sol-pump-swap.js';
import { decodeNonSol, CLOCK } from '../../providers/simple-price-v2/non-sol.js';
import type { NonSolObservation } from '../../providers/simple-price-v2/non-sol.js';
import { ATOMIC_POLICY } from '../../providers/simple-price-v2-atomic/provider.js';
import { normalizeDirectional } from '../../providers/simple-price-v2-atomic/normalize.js';
import {
  validateEvidence,
  calibrate,
  fingerprint,
} from '../../candidates/simple-price-v2-directional/model.js';

const root = 'artifacts/simple-price-v2-final-qualification-review/';
const genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const markets = [
  { label: 'SOL', mint: '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump' },
  { label: 'TUSD', mint: '7UhL5K7t1UDPLdhoj2Sz59kyn79Qvxkvk75ukfxDTUSD' },
  { label: 'GOOG', mint: '5pHhLJn3nXKLXyHMpoMP8YLrt1Brt3z84NWspPkKWaep' },
];
const wait = (n: number) => new Promise((r) => setTimeout(r, n));
const encode = (x: unknown) =>
  JSON.stringify(x, (_, v: unknown) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v));
const clean = (e: unknown) =>
  e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, '[ENDPOINT]') : 'UNKNOWN';
interface Receipt {
  method: string;
  params: unknown[];
  startedMs: number;
  receivedMs: number;
  latencyMs: number;
  status: number;
  body: unknown;
}
class ReadOnlyProvider {
  readonly receipts: Receipt[] = [];
  readonly roots: { at: number; slot: number }[] = [];
  disabled = '';
  private last = 0;
  constructor(
    readonly source: string,
    readonly upstream: string,
    private url: string,
  ) {}
  async transport(init: RequestInit): Promise<Response> {
    if (this.disabled) throw Error(this.disabled);
    const request = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
    if (
      !['getGenesisHash', 'getMultipleAccounts', 'getAccountInfo', 'getSlot', 'getBlock'].includes(
        request.method,
      )
    )
      throw Error('READ_ONLY_METHOD_REQUIRED');
    if (this.receipts.length >= 90) throw Error('BOUNDED_PROVIDER_BUDGET_EXHAUSTED');
    await wait(Math.max(0, 1000 - (Date.now() - this.last)));
    const startedMs = Date.now(),
      started = performance.now();
    this.last = startedMs;
    try {
      const response = await fetch(this.url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      const body: unknown = await response.clone().json();
      this.receipts.push({
        ...request,
        startedMs,
        receivedMs: Date.now(),
        latencyMs: performance.now() - started,
        status: response.status,
        body,
      });
      if ([401, 403, 429].includes(response.status)) {
        this.disabled = 'RPC_HTTP_' + response.status;
        throw Error(this.disabled);
      }
      return response;
    } catch (error) {
      if (!this.receipts.some((r) => r.startedMs === startedMs))
        this.receipts.push({
          ...request,
          startedMs,
          receivedMs: Date.now(),
          latencyMs: performance.now() - started,
          status: 0,
          body: { error: 'TRANSPORT_OR_TIMEOUT' },
        });
      throw error;
    }
  }
  async call<T>(method: string, params: unknown[]): Promise<T> {
    const r = await this.transport({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const b = (await r.json()) as { result?: T; error?: { code: number } };
    if (!r.ok || b.error || b.result === undefined)
      throw Error('RPC_METHOD_UNAVAILABLE:' + method + ':' + (b.error?.code ?? r.status));
    return b.result;
  }
  client() {
    return new SolanaRpcClient({
      url: this.url,
      commitment: 'confirmed',
      timeoutMs: 5000,
      fetchImplementation: (_url, init) => this.transport(init ?? {}),
    });
  }
  async root() {
    const slot = await this.call<number>('getSlot', [{ commitment: 'finalized' }]);
    this.roots.push({ at: Date.now(), slot });
    return slot;
  }
}
interface Sample {
  round: number;
  market: string;
  source: string;
  upstream: string;
  startedMs: number;
  receivedMs: number;
  latencyMs: number;
  slot?: number;
  sourceMs?: number;
  ageMs?: number;
  accountHash?: string;
  accounts?: number;
  block?: {
    blockhash: string;
    previousBlockhash: string;
    parentSlot: number;
    blockTime: number | null;
  };
  complete: boolean;
  error?: string;
  observation?: NonSolObservation;
  raw?: unknown;
}
function distribution(xs: number[]) {
  const a = xs.filter(Number.isFinite).sort((a, b) => a - b);
  const p = (q: number) => (a.length ? a[Math.max(0, Math.ceil(q * a.length) - 1)] : null);
  return {
    count: a.length,
    min: a[0] ?? null,
    p50: p(0.5),
    p90: p(0.9),
    p95: p(0.95),
    max: a.at(-1) ?? null,
    values: a,
  };
}

it.skipIf(process.env['PAPERFUND_V2_EVIDENCE_READS'] !== '1')(
  'bounded SOL/TUSD/GOOG capture freshness and confirmed-to-finalized slot observations',
  async () => {
    const run = Date.now(),
      records: Sample[] = [],
      comparisons: unknown[] = [],
      finality: unknown[] = [],
      finalizedCaptures: unknown[] = [];
    const helius =
      process.env['SOLANA_RPC_URL'] ?? parse(readFileSync('.env'))['SOLANA_RPC_URL'] ?? '';
    const u = new URL(helius);
    if (
      u.protocol !== 'https:' ||
      u.hostname !== 'mainnet.helius-rpc.com' ||
      u.username ||
      u.password
    )
      throw Error('AUTHORIZED_EXISTING_HELIUS_REQUIRED');
    const providers = [
      new ReadOnlyProvider(
        'solana',
        'https://api.mainnet-beta.solana.com',
        'https://api.mainnet-beta.solana.com',
      ),
      new ReadOnlyProvider('helius', 'https://mainnet.helius-rpc.com', helius),
    ];
    // A rejecting provider remains disabled across this task's bounded windows.
    for (const file of readdirSync(root).filter((f) => f.endsWith('-observations.json'))) {
      const prior = JSON.parse(readFileSync(root + file, 'utf8')) as {
        providers: { source: string; disabled: string }[];
      };
      for (const p of providers)
        if (prior.providers.some((x) => x.source === p.source && x.disabled))
          p.disabled = 'PRIOR_WINDOW_PROVIDER_REJECTED';
    }
    const save = (suffix: string, data: unknown) =>
      writeFileSync(root + run + '-' + suffix + '.json', encode(data), { flag: 'wx' });
    const event = (data: unknown) =>
      appendFileSync(root + run + '-events.jsonl', encode({ at: Date.now(), data }) + '\n');
    try {
      for (const p of providers) {
        try {
          if (p.disabled) continue;
          if ((await p.call('getGenesisHash', [])) !== genesis) throw Error('WRONG_GENESIS');
          await p.root();
        } catch (e) {
          p.disabled = p.disabled || clean(e);
          event({ source: p.source, unavailable: p.disabled });
        }
      }
      const previous = new Map<string, Sample>();
      for (let round = 0; round < 2; round++) {
        for (const m of markets) {
          const pair = await Promise.all(
            providers.map(async (p, index) => {
              const start = p.receipts.length,
                startedMs = Date.now(),
                t = performance.now();
              let sample: Sample = {
                round,
                market: m.label,
                source: p.source,
                upstream: p.upstream,
                startedMs,
                receivedMs: startedMs,
                latencyMs: 0,
                complete: false,
              };
              try {
                if (p.disabled) throw Error(p.disabled);
                let raw: unknown,
                  slot: number,
                  sourceMs: number,
                  observation: NonSolObservation | undefined;
                if (m.label === 'SOL') {
                  const adapter = new PumpSwapProtocolAdapter(
                    new PumpSwapSolanaMarketStateSource(p.client()),
                  );
                  const state = await withAdvisoryRead(
                    {
                      signal: AbortSignal.timeout(10000),
                      metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 },
                    },
                    () =>
                      adapter.loadMarketState({
                        protocolId: PUMP_SWAP_PROTOCOL_ID,
                        tokenMint: identifier(m.mint, 'TokenMint'),
                        marketId: identifier(
                          'GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J',
                          'MarketId',
                        ),
                      }),
                  );
                  raw = state;
                  slot = Number(state.chainSlot);
                  sourceMs = Date.parse(String(state.normalizedState['chainTime']));
                } else {
                  const state = await withAdvisoryRead(
                    {
                      signal: AbortSignal.timeout(10000),
                      metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 },
                    },
                    () =>
                      new Stage1NonSolPumpSwap({ purpose: 'READ_ONLY_STAGE1_VALIDATION' }).capture(
                        p.client(),
                        m.mint,
                      ),
                  );
                  const d = await decodeNonSol(state, index as 0 | 1);
                  observation = {
                    ...d,
                    native: { ...d.native, source: p.source, upstream: p.upstream },
                    conversion: { ...d.conversion, source: p.source, upstream: p.upstream },
                  };
                  raw = state;
                  slot = state.slot;
                  sourceMs = d.native.observedAtMs;
                }
                const receivedMs = Date.now();
                const full = p.receipts
                  .slice(start)
                  .filter(
                    (r) =>
                      r.method === 'getMultipleAccounts' &&
                      (r.params[0] as string[]).includes(CLOCK),
                  )
                  .at(-1);
                if (!full) throw Error('ATOMIC_CLOCK_BATCH_NOT_RETAINED');
                const batch = full.body as {
                  result?: { context: { slot: number }; value: unknown[] };
                };
                if (
                  batch.result?.context.slot !== slot ||
                  (full.params[0] as string[]).length !== batch.result.value.length
                )
                  throw Error('CAPTURE_RECEIPT_CONTEXT_MISMATCH');
                sample = {
                  ...sample,
                  receivedMs,
                  latencyMs: performance.now() - t,
                  slot,
                  sourceMs,
                  ageMs: receivedMs - sourceMs,
                  complete: true,
                  raw,
                  ...(observation ? { observation } : {}),
                  accountHash: fingerprint(batch.result),
                  accounts: batch.result.value.length,
                };
                const prior = previous.get(p.source + ':' + m.label);
                if (prior && (slot < prior.slot! || sourceMs < prior.sourceMs!))
                  throw Error('REGRESSING_PROVIDER_CAPTURE');
                previous.set(p.source + ':' + m.label, sample);
                // Block metadata is an auxiliary read; it never replaces the stored account bytes.
                try {
                  sample.block = await p.call('getBlock', [
                    slot,
                    {
                      commitment: 'confirmed',
                      transactionDetails: 'none',
                      rewards: false,
                      maxSupportedTransactionVersion: 0,
                    },
                  ]);
                } catch (error) {
                  event({ source: p.source, market: m.label, blockUnavailable: clean(error) });
                }
              } catch (error) {
                sample = {
                  ...sample,
                  receivedMs: Date.now(),
                  latencyMs: performance.now() - t,
                  error: clean(error),
                  complete: false,
                };
              }
              records.push(sample);
              event({
                round,
                market: m.label,
                source: p.source,
                complete: sample.complete,
                slot: sample.slot,
                ageMs: sample.ageMs,
                error: sample.error,
              });
              return sample;
            }),
          );
          if (pair.every((s) => s.complete) && m.label !== 'SOL')
            try {
              const normalized = await normalizeDirectional(
                pair.map((s) => s.observation!),
                ATOMIC_POLICY,
                Date.now(),
                m.label === 'GOOG' ? [100000000n, 10000000n] : [100000000n, 10000000n, 2000000000n],
              );
              const e = normalized.evidence;
              calibrate(
                e,
                validateEvidence(e, e.identity, Date.now(), ATOMIC_POLICY),
                Date.now(),
                ATOMIC_POLICY,
              );
              comparisons.push({
                round,
                market: m.label,
                valid: true,
                evidence: e,
                referenceBudgets: m.label === 'GOOG' ? ['.01', '.1'] : ['.01', '.1', '2'],
              });
            } catch (error) {
              comparisons.push({ round, market: m.label, valid: false, reason: clean(error) });
            }
        }
        for (const p of providers)
          try {
            if (!p.disabled) await p.root();
          } catch (error) {
            event({ source: p.source, rootUnavailable: clean(error) });
          }
        if (round < 1) await wait(2000);
      }
      // At most 12 polls, 3s apart; only unresolved captured slots are followed.
      for (let n = 0; n < 12; n++) {
        let pending = false;
        for (const p of providers) {
          const latest = records
            .filter((s) => s.complete && s.source === p.source)
            .reduce((a, s) => Math.max(a, s.slot!), 0);
          if (p.disabled || !latest) continue;
          if ((p.roots.at(-1)?.slot ?? 0) < latest) {
            pending = true;
            try {
              await p.root();
            } catch (error) {
              event({ source: p.source, rootUnavailable: clean(error) });
            }
          }
        }
        if (!pending) break;
        await wait(3000);
      }
      for (const p of providers) {
        const unique = [
          ...new Map(
            records.filter((s) => s.complete && s.source === p.source).map((s) => [s.slot, s]),
          ).values(),
        ];
        for (const s of unique) {
          const first = p.roots.find((r) => r.slot >= s.slot!),
            lastBelow = p.roots.filter((r) => r.slot < s.slot!).at(-1);
          let finalized: Sample['block'] | undefined, reason: string | undefined;
          try {
            if (!first) throw Error('FINALITY_NOT_OBSERVED_IN_BUDGET');
            finalized = await p.call('getBlock', [
              s.slot!,
              {
                commitment: 'finalized',
                transactionDetails: 'none',
                rewards: false,
                maxSupportedTransactionVersion: 0,
              },
            ]);
          } catch (e) {
            reason = clean(e);
          }
          finality.push({
            source: p.source,
            slot: s.slot,
            confirmed: s.block,
            finalized,
            consistent: !!s.block && !!finalized && s.block.blockhash === finalized.blockhash,
            firstRootAt: first?.at,
            lastBelowAt: lastBelow?.at,
            delayUpperMs: first ? Math.max(0, first.at - s.receivedMs) : null,
            reason,
            accountStateInclusionProof: false,
          });
        }
        for (const m of markets) {
          const s = records
            .filter((s) => s.complete && s.source === p.source && s.market === m.label)
            .at(-1);
          if (!s || p.disabled) continue;
          const seed = p.receipts
            .filter(
              (r) =>
                r.method === 'getMultipleAccounts' && (r.params[0] as string[]).includes(CLOCK),
            )
            .find((r) => {
              const result = r.body as { result?: { context: { slot: number } } };
              return (
                result.result?.context.slot === s.slot &&
                (r.params[0] as string[]).includes(
                  m.label === 'SOL'
                    ? 'GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J'
                    : (s.raw as { targetPool: string }).targetPool,
                )
              );
            });
          if (!seed) continue;
          try {
            const b = await p.call<{
              context: { slot: number };
              value: ({ data: [string, string] } | null)[];
            }>('getMultipleAccounts', [
              seed.params[0],
              { commitment: 'finalized', encoding: 'base64' },
            ]);
            const keys = seed.params[0] as string[],
              clock = b.value[keys.indexOf(CLOCK)];
            if (!clock) throw Error('NO_FINALIZED_CLOCK');
            const bytes = Buffer.from(clock.data[0], 'base64');
            finalizedCaptures.push({
              source: p.source,
              market: m.label,
              slot: b.context.slot,
              receivedMs: Date.now(),
              sourceMs: Number(bytes.readBigInt64LE(32)) * 1000,
              ageMs: Date.now() - Number(bytes.readBigInt64LE(32)) * 1000,
              clockSlot: bytes.readBigUInt64LE(0),
              keys,
              body: b,
              tradeAuthority: false,
            });
          } catch (e) {
            finalizedCaptures.push({ source: p.source, market: m.label, error: clean(e) });
          }
        }
      }
    } finally {
      const grouped = markets.flatMap((m) =>
        providers.map((p) => {
          const a = records.filter((s) => s.market === m.label && s.source === p.source),
            v = a.filter((s) => s.complete);
          return {
            market: m.label,
            source: p.source,
            attempts: a.length,
            complete: v.length,
            ageMs: distribution(v.map((s) => s.ageMs!)),
            captureLatencyMs: distribution(v.map((s) => s.latencyMs)),
            updates: v.slice(1).map((s, i) => ({
              gapMs: s.receivedMs - v[i]!.receivedMs,
              sourceAdvanceMs: s.sourceMs! - v[i]!.sourceMs!,
              slotAdvance: s.slot! - v[i]!.slot!,
            })),
            errors: a.filter((s) => s.error).map((s) => s.error),
          };
        }),
      );
      save('observations', {
        scope: 'READ_ONLY_MAINNET_MEASUREMENT_NOT_SETTLEMENT_AUTHORITY',
        records,
        comparisons,
        finality,
        finalizedCaptures,
        providers: providers.map((p) => ({
          source: p.source,
          upstream: p.upstream,
          disabled: p.disabled,
          roots: p.roots,
          receipts: p.receipts,
        })),
        grouped,
        rpcLatencyMs: providers.map((p) => ({
          source: p.source,
          distribution: distribution(p.receipts.map((r) => r.latencyMs)),
        })),
        endedAt: Date.now(),
      });
      console.log(
        JSON.stringify({
          run,
          groups: grouped.map((g) => ({
            market: g.market,
            source: g.source,
            complete: g.complete,
            attempts: g.attempts,
            age: g.ageMs,
          })),
          requests: providers.map((p) => ({
            source: p.source,
            count: p.receipts.length,
            disabled: p.disabled,
          })),
        }),
      );
    }
    expect(records).toHaveLength(12);
  },
  240000,
);
