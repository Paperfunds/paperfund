/** Explicitly opt-in, read-only mainnet acquisition. No environment secrets or production registration. */
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import type { MarketIdentity, MarketState } from '@paperfund/execution';
import {
  SolanaRpcClient,
  PumpSwapSolanaMarketStateSource,
  PumpSwapProtocolAdapter,
  PUMP_SWAP_PROTOCOL_ID,
  WRAPPED_SOL_MINT,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  withAdvisoryRead,
  canonicalPumpSwapPoolAddress,
} from '@paperfund/protocols';
import {
  fingerprint,
  snapshotHash,
  validateEvidence,
  calibrate,
} from '../../candidates/simple-price-v2/model.js';
import type {
  Evidence,
  Policy,
  ReferenceQuote,
  Fee,
} from '../../candidates/simple-price-v2/model.js';

export const ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
] as const;
const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
/** Acquisition limits for private review only; no financial-policy approval. Eight slots never bypasses 2s coherence. */
export const REAL_POLICY: Policy = {
  version: 'UNAPPROVED_PRIVATE_REAL_ACQUISITION_V1',
  maxAgeMs: 5000,
  maxFutureMs: 1000,
  maxSkewMs: 2000,
  maxDiscrepancyBps: 100n,
  maxMovementBps: 20000n,
  trustedSources: { solana: ENDPOINTS[0], publicnode: ENDPOINTS[1] },
  solQuote: WRAPPED_SOL_MINT,
  trustedQuoteSources: { native: ENDPOINTS[0] },
  maxQuoteSlotSkew: 8n,
  maxCalibrationErrorBps: 1n,
};
export function assertMintCosts(owner: string, bytes: Buffer): void {
  if (bytes.length < 82 || bytes[45] !== 1) throw new Error('INVALID_MINT');
  // Immutable standard SPL mint, or Token-2022 metadata-only extensions. Unknown monetary semantics fail closed.
  if (owner === SPL_TOKEN_PROGRAM_ID && bytes.length === 82) return;
  if (owner !== TOKEN_2022_PROGRAM_ID) throw new Error('UNVERIFIED_TOKEN_COSTS');
  if (bytes.length === 82) return;
  if (bytes.length < 166 || bytes[165] !== 1 || bytes.subarray(82, 165).some((b) => b !== 0))
    throw new Error('UNVERIFIED_TOKEN_COSTS');
  const seen = new Set<number>();
  for (let at = 166; at < bytes.length;) {
    if (bytes.subarray(at).every((b) => b === 0)) return;
    if (at + 4 > bytes.length) throw new Error('UNVERIFIED_TOKEN_COSTS');
    const type = bytes.readUInt16LE(at),
      length = bytes.readUInt16LE(at + 2);
    if (![18, 19].includes(type) || seen.has(type) || at + 4 + length > bytes.length)
      throw new Error('UNVERIFIED_TOKEN_COSTS');
    seen.add(type);
    at += 4 + length;
  }
}
export function normalizeNative(
  states: readonly MarketState[],
  quotes: readonly ReferenceQuote[],
): Evidence {
  if (states.length !== 2) throw new Error('TWO_NATIVE_PROVIDERS_REQUIRED');
  const primary = states[0]!,
    n = primary.normalizedState;
  const identity = {
    mint: primary.identity.tokenMint,
    market: primary.identity.marketId,
    quote: WRAPPED_SOL_MINT,
  };
  const fees = nativeFees(primary);
  const observations = states.map((state, index) => {
    const v = state.normalizedState;
    if (
      state.identity.protocolId !== PUMP_SWAP_PROTOCOL_ID ||
      state.identity.marketId !== identity.market ||
      state.identity.tokenMint !== identity.mint ||
      v['quoteMint'] !== WRAPPED_SOL_MINT ||
      v['model'] !== 'PUMP_SWAP_CANONICAL_POOL' ||
      state.chainSlot === null ||
      fingerprint(nativeFees(state)) !== fingerprint(fees) ||
      v['tokenDecimals'] !== n['tokenDecimals'] ||
      v['isMayhemMode'] !== false ||
      v['isCashbackCoin'] !== false ||
      (BigInt(String(v['disableFlags'])) & 24n) !== 0n
    )
      throw new Error('UNVERIFIED_NATIVE_CONVENTION');
    const at = Date.parse(String(v['chainTime']));
    if (!Number.isSafeInteger(at)) throw new Error('SOURCE_TIME_UNAVAILABLE');
    return {
      source: index === 0 ? 'solana' : 'publicnode',
      upstream: ENDPOINTS[index]!,
      reference: fingerprint(state),
      identity,
      observedAtMs: at,
      slot: state.chainSlot,
      price: {
        n: BigInt(String(v['effectiveQuoteReserves'])),
        d: BigInt(String(v['baseReserves'])),
      },
      tradeable: true,
    };
  });
  const base = {
    identity,
    observations,
    conversion: null,
    fees,
    feeReference: fingerprint({ state: observations[0]!.reference, fees }),
    feeObservedAtMs: observations[0]!.observedAtMs,
  };
  return {
    ...base,
    calibration: {
      snapshotHash: snapshotHash(base),
      spotConvention: 'FEE_EXCLUSIVE_SPOT',
      feeConvention: 'LAMPORT_BUY_INPUT_SELL_GROSS_CEIL',
      widthConvention: 'NO_FIXED_WIDTH_VERIFIED',
      quotes,
    },
  };
}
export function nativeFees(state: MarketState): Fee[] {
  const n = state.normalizedState;
  return [
    { category: 'PUMP_SWAP_LP_FEE', bps: BigInt(String(n['lpFeeBps'])) },
    { category: 'PUMP_SWAP_PROTOCOL_FEE', bps: BigInt(String(n['protocolFeeBps'])) },
    {
      category: 'PUMP_SWAP_CREATOR_FEE',
      bps: n['creatorFeeApplies'] === true ? BigInt(String(n['creatorFeeBps'])) : 0n,
    },
  ];
}
export interface Capture {
  provenance: 'REAL_READ_ONLY_MAINNET';
  receivedAtMs: number;
  evidence: Evidence;
  states: readonly MarketState[];
  receipts: readonly unknown[];
  tokenDecimals: string;
}
export class RealMarketProvider {
  private readonly adapters: PumpSwapProtocolAdapter[];
  private receipts: unknown[] = [];
  private verified = false;
  private readonly slotHints = new Map<string, readonly number[]>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor() {
    this.adapters = ENDPOINTS.map(
      (endpoint) =>
        new PumpSwapProtocolAdapter(
          new PumpSwapSolanaMarketStateSource(
            new SolanaRpcClient({
              url: endpoint,
              timeoutMs: 5000,
              commitment: 'confirmed',
              fetchImplementation: async (url, init) => {
                const request = JSON.parse(String(init?.body)) as {
                  method: string;
                  params?: unknown[];
                };
                if (
                  ![
                    'getAccountInfo',
                    'getMultipleAccounts',
                    'getProgramAccounts',
                    'getSlot',
                  ].includes(request.method)
                )
                  throw new Error('READ_ONLY_RPC_METHOD_REQUIRED');
                const response = await fetch(url, init),
                  body = await response.clone().json();
                this.receipts.push({
                  endpoint,
                  request,
                  receivedAtMs: Date.now(),
                  status: response.status,
                  body,
                });
                if (request.method === 'getMultipleAccounts') {
                  const keys = request.params?.[0] as string[] | undefined;
                  const values = (
                    body as { result?: { value?: { owner: string; data: [string, string] }[] } }
                  ).result?.value;
                  if (keys && values)
                    keys.forEach((key, i) => {
                      const a = values[i];
                      // Atomic native decoder responses include the requested mint alongside pool, vaults, fees and Clock.
                      if (
                        a &&
                        (a.owner === SPL_TOKEN_PROGRAM_ID || a.owner === TOKEN_2022_PROGRAM_ID) &&
                        keys.length > 2 &&
                        key === this.mint
                      )
                        assertMintCosts(a.owner, Buffer.from(a.data[0], 'base64'));
                    });
                }
                return response;
              },
            }),
          ),
        ),
    );
  }
  private mint = '';
  capture(mint: string): Promise<Capture> {
    const next = this.queue.catch(() => undefined).then(() => this.acquire(mint));
    this.queue = next;
    return next;
  }
  private async acquire(mint: string): Promise<Capture> {
    this.receipts = [];
    this.mint = mint;
    if (!this.verified) {
      const results = await Promise.all(
        ENDPOINTS.map(async (endpoint) => {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] }),
            signal: AbortSignal.timeout(5000),
          });
          const body = (await response.json()) as { result?: string };
          this.receipts.push({ endpoint, receivedAtMs: Date.now(), status: response.status, body });
          return response.ok && body.result === MAINNET;
        }),
      );
      if (!results.every(Boolean)) throw new Error('MAINNET_PROVENANCE_UNVERIFIED');
      this.verified = true;
    }
    const identity: MarketIdentity = {
      protocolId: PUMP_SWAP_PROTOCOL_ID,
      tokenMint: identifier(mint, 'TokenMint'),
      marketId: identifier(await canonicalPumpSwapPoolAddress(mint), 'MarketId'),
    };
    const settled = await Promise.allSettled(
      this.adapters.map((adapter, index) =>
        withAdvisoryRead(
          {
            signal: AbortSignal.timeout(12000),
            ...(this.slotHints.get(mint)?.[index] !== undefined
              ? { minimumSlot: this.slotHints.get(mint)![index]! }
              : {}),
            metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 },
          },
          () => adapter.loadMarketState(identity),
        ),
      ),
    );
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const states = settled.map((result) => {
      if (result.status !== 'fulfilled') throw new Error('RPC_QUORUM_UNAVAILABLE');
      return result.value;
    });
    const state = states[0]!,
      at = Date.parse(String(state.normalizedState['chainTime']));
    const quoteIdentity = { mint, market: identity.marketId, quote: WRAPPED_SOL_MINT };
    const feesHash = fingerprint(nativeFees(state)),
      quotes: ReferenceQuote[] = [];
    for (const budget of [1000000000n, 10000000n, 2000000000n]) {
      const request = {
        identity,
        orderId: identifier('read-only:' + budget, 'OrderId'),
        executionId: identifier('read-only:' + budget, 'ExecutionId'),
        executedAt: utcInstant(at),
      };
      const buy = await this.adapters[0]!.simulateBuy(
        { ...request, requestedPaperSol: paperSolBaseUnits(budget) },
        state,
      );
      if (buy.actualInput.asset !== 'PAPER_SOL' || buy.actualOutput.asset !== 'TOKEN')
        throw new Error('UNSUPPORTED_NATIVE_QUOTE');
      const sell = await this.adapters[0]!.simulateSell(
        { ...request, requestedTokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
        state,
      );
      if (sell.actualOutput.asset !== 'PAPER_SOL') throw new Error('UNSUPPORTED_NATIVE_QUOTE');
      for (const [side, input, output] of [
        ['BUY', buy.actualInput.amount, buy.actualOutput.amount],
        ['SELL', buy.actualOutput.amount, sell.actualOutput.amount],
      ] as const) {
        quotes.push({
          source: 'native',
          upstream: ENDPOINTS[0],
          reference: fingerprint({ receipt: fingerprint(state), side, budget, input, output }),
          identity: quoteIdentity,
          side,
          input,
          output,
          observedAtMs: at,
          slot: state.chainSlot!,
          feesHash,
          convention: 'EXACT_INPUT_ALL_IN_VERIFIED',
        });
      }
    }
    const evidence = normalizeNative(states, quotes);
    validateEvidence(evidence, evidence.identity, Date.now(), REAL_POLICY);
    calibrate(evidence, evidence.observations[0]!.price, Date.now(), REAL_POLICY);
    this.slotHints.set(
      mint,
      states.map((state) => {
        if (state.chainSlot === null || state.chainSlot > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error('INVALID_SOURCE_SLOT');
        return Number(state.chainSlot);
      }),
    );
    return {
      provenance: 'REAL_READ_ONLY_MAINNET',
      receivedAtMs: Date.now(),
      evidence,
      states,
      receipts: structuredClone(this.receipts),
      tokenDecimals: String(state.normalizedState['tokenDecimals']),
    };
  }
  auditFailure() {
    return structuredClone(this.receipts);
  }
}
