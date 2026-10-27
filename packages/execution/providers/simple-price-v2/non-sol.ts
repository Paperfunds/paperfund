/** Isolated non-SOL evidence acquisition. No pool swaps, simulated reserve updates, or activation. */
import {
  SolanaRpcClient,
  WRAPPED_SOL_MINT,
  withAdvisoryRead,
  SOLANA_ROUTE_PROTOCOL_ID,
  SolanaRouteSource,
  pumpBondingCurveAddress,
  decodePumpBondingCurve,
  PUMP_PROGRAM_ID,
} from '@paperfund/protocols';
import { identifier } from '@paperfund/core';
import { Stage1NonSolPumpSwap } from '../../../protocols/src/experimental/non-sol-pump-swap.js';
import type { Stage1Snapshot } from '../../../protocols/src/experimental/non-sol-pump-swap.js';
import { assertOrcaSnapshot } from '../../../protocols/src/composed-pump-orca.js';
import { orcaSpot } from '../../../protocols/isolated/simple-price-v2/orca-spot.js';
import { advisoryClockTime } from '../../../protocols/src/rpc-read-context.js';
import { ENDPOINTS, REAL_POLICY } from './provider.js';
import { jupiterQuote, blockTime } from './jupiter.js';
import {
  CandidateError,
  fingerprint,
  discrepancy,
  observationProgression,
} from '../../candidates/simple-price-v2/model.js';
import type { Rational, Observation } from '../../candidates/simple-price-v2/model.js';

export const CLOCK = 'SysvarC1ock11111111111111111111111111111111';
type AccountBatch = Awaited<ReturnType<SolanaRpcClient['getMultipleAccounts']>>;
export function mergeSameBank(
  keys: readonly string[],
  parts: readonly { keys: readonly string[]; batch: AccountBatch }[],
): AccountBatch {
  if (parts.length === 0) throw new CandidateError('CONVERSION_BANK_INCOHERENT');
  const slot = parts[0]!.batch.context.slot,
    map = new Map<string, AccountBatch['value'][number]>();
  let clock: string | undefined;
  for (const part of parts) {
    if (part.batch.context.slot !== slot || part.batch.value.length !== part.keys.length)
      throw new CandidateError('CONVERSION_BANK_INCOHERENT');
    const at = part.keys.indexOf(CLOCK),
      c = part.batch.value[at];
    if (at < 0 || !c) throw new CandidateError('CONVERSION_CLOCK_MISSING');
    const encoded = JSON.stringify(c);
    if (clock !== undefined && clock !== encoded)
      throw new CandidateError('CONVERSION_BANK_INCOHERENT');
    clock = encoded;
    part.keys.forEach((key, index) => {
      const value = part.batch.value[index]!;
      if (map.has(key) && JSON.stringify(map.get(key)) !== JSON.stringify(value))
        throw new CandidateError('CONFLICTING_SOURCE_EVIDENCE');
      map.set(key, value);
    });
  }
  if (keys.some((key) => !map.has(key))) throw new CandidateError('CONVERSION_ACCOUNT_MISSING');
  return { context: parts[0]!.batch.context, value: keys.map((key) => map.get(key)!) };
}
/** Identical confirmed slot and Clock bytes only; diagnostic reassembly is not a bank-hash/fork proof. */
async function readSameBank(rpc: SolanaRpcClient, keys: readonly string[]): Promise<AccountBatch> {
  if (keys.length <= 9) return rpc.getMultipleAccounts(keys);
  const other = keys.filter((k) => k !== CLOCK),
    groups: string[][] = [];
  for (let at = 0; at < other.length; at += 8) groups.push([CLOCK, ...other.slice(at, at + 8)]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const settled = await Promise.allSettled(
      groups.map(async (group) => ({ keys: group, batch: await rpc.getMultipleAccounts(group) })),
    );
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const parts = settled.map((r) => {
      if (r.status !== 'fulfilled') throw new CandidateError('CONVERSION_ACCOUNT_MISSING');
      return r.value;
    });
    try {
      return mergeSameBank(keys, parts);
    } catch (error) {
      if (
        !(error instanceof CandidateError) ||
        error.code !== 'CONVERSION_BANK_INCOHERENT' ||
        attempt === 1
      )
        throw error;
    }
  }
  throw new CandidateError('CONVERSION_BANK_INCOHERENT');
}
const BPS = 10000n;
const product = (a: Rational, b: Rational): Rational => ({ n: a.n * b.n, d: a.d * b.d });
const invert = (a: Rational): Rational => ({ n: a.d, d: a.n });
export function orientedPrice(
  mintA: string,
  mintB: string,
  base: string,
  quote: string,
  bPerA: Rational,
): Rational {
  if (bPerA.n <= 0n || bPerA.d <= 0n || base === quote) throw new CandidateError('INVALID_PRICE');
  if (mintA === base && mintB === quote) return bPerA;
  if (mintB === base && mintA === quote) return invert(bPerA);
  throw new CandidateError('TERMINAL_TOKEN_POOL_IDENTITY_MISMATCH');
}
export interface CostProof {
  primaryQuotePremium: Rational;
  conversionInputDeduction: Rational;
  buyPremium: Rational;
  sellDeduction: Rational;
  exactSameRate: boolean;
  commonIntegerBps: bigint | null;
  representable: boolean;
  unsupported: string | null;
}
/** Zero-impact fixed costs only. Never absorb a fee mismatch into fitted size impact. */
export function fixedCostProof(primary: Rational, bridge: Rational, fx: Rational): CostProof {
  for (const r of [primary, bridge])
    if (r.n < 0n || r.d <= 0n || r.n >= r.d) throw new CandidateError('INVALID_FEES');
  if (fx.n <= 0n || fx.d <= 0n) throw new CandidateError('INVALID_PRICE');
  // BUY: a quote-premium primary follows an input-deduction conversion. SELL reverses that path.
  const factor = product(
    { n: primary.d + primary.n, d: primary.d },
    { n: bridge.d, d: bridge.d - bridge.n },
  );
  const buyPremium = { n: factor.n - factor.d, d: factor.d };
  const retention = product(
    { n: primary.d - primary.n, d: primary.d },
    { n: bridge.d - bridge.n, d: bridge.d },
  );
  const sellDeduction = { n: retention.d - retention.n, d: retention.d };
  const equal = buyPremium.n * sellDeduction.d === sellDeduction.n * buyPremium.d;
  const bps =
    equal && (buyPremium.n * BPS) % buyPremium.d === 0n
      ? (buyPremium.n * BPS) / buyPremium.d
      : null;
  // With nonzero quote fees, converting ceil(quote fee) is not generally ceil(lamport notional fee).
  const unsupported = !equal
    ? 'ASYMMETRIC_COMPOSED_FIXED_FEES'
    : bps === null
      ? 'NON_INTEGER_NORMALIZED_FEE_RATE'
      : primary.n !== 0n && fx.n !== fx.d
        ? 'QUOTE_FEE_ROUNDING_NOT_LAMPORT_EQUIVALENT'
        : null;
  return {
    primaryQuotePremium: primary,
    conversionInputDeduction: bridge,
    buyPremium,
    sellDeduction,
    exactSameRate: equal,
    commonIntegerBps: bps,
    representable: unsupported === null,
    unsupported,
  };
}
export interface NonSolObservation {
  native: Observation;
  conversion: Observation;
  baseDecimals: number;
  quoteDecimals: number;
  sourceState: Stage1Snapshot;
  primaryFeeBps: { lp: bigint; protocol: bigint; creator: bigint };
  /** Configured baseline only. adaptiveFee=true makes the total unavailable and blocks admission. */
  conversionFeePpm: bigint;
  adaptiveFee: boolean;
  costs: CostProof;
}
export async function decodeNonSol(
  snapshot: Stage1Snapshot,
  index: 0 | 1,
): Promise<NonSolObservation> {
  const engine = new Stage1NonSolPumpSwap({ purpose: 'READ_ONLY_STAGE1_VALIDATION' });
  const v = await engine.validate(snapshot, { nowMs: Date.now(), maxAgeMs: REAL_POLICY.maxAgeMs });
  assertOrcaSnapshot(v.bridge, snapshot.accounts, snapshot.absentAccounts);
  const whirlpool = orcaSpot(snapshot.bridgePool, snapshot.accounts[snapshot.bridgePool]!);
  const fx = orientedPrice(
    whirlpool.mintA,
    whirlpool.mintB,
    snapshot.quoteMint,
    WRAPPED_SOL_MINT,
    whirlpool.bPerA,
  );
  const at = Date.parse(
    advisoryClockTime(
      {
        owner: snapshot.accounts[CLOCK]!.owner,
        data: [snapshot.accounts[CLOCK]!.base64, 'base64'],
      },
      snapshot.slot,
    ),
  );
  const source = index === 0 ? 'solana' : 'publicnode',
    upstream = ENDPOINTS[index],
    reference = fingerprint(snapshot);
  const identity = { mint: snapshot.mint, market: snapshot.targetPool, quote: snapshot.quoteMint };
  const primary = { lp: v.math.lpBps, protocol: v.math.protocolBps, creator: v.math.creatorBps };
  const feePpm = whirlpool.feePpm;
  return {
    native: {
      source,
      upstream,
      reference,
      identity,
      observedAtMs: at,
      slot: BigInt(snapshot.slot),
      price: { n: v.math.quote + v.math.virtual, d: v.math.base },
      tradeable: true,
    },
    conversion: {
      source,
      upstream,
      reference,
      identity: {
        mint: snapshot.quoteMint,
        market: 'conversion:' + snapshot.quoteMint,
        quote: WRAPPED_SOL_MINT,
      },
      observedAtMs: at,
      slot: BigInt(snapshot.slot),
      price: fx,
      tradeable: true,
    },
    baseDecimals: v.baseDecimals,
    quoteDecimals: v.quoteDecimals,
    sourceState: snapshot,
    primaryFeeBps: primary,
    conversionFeePpm: feePpm,
    adaptiveFee: whirlpool.adaptive,
    costs: fixedCostProof(
      { n: primary.lp + primary.protocol + primary.creator, d: BPS },
      { n: feePpm, d: 1000000n },
      fx,
    ),
  };
}
export function verifyNonSolQuorum(
  observations: readonly NonSolObservation[],
  mint: string,
  previous?: readonly NonSolObservation[],
) {
  if (observations.length !== 2) throw new CandidateError('PRICE_QUORUM_UNAVAILABLE');
  const a = observations[0]!,
    b = observations[1]!,
    now = Date.now();
  for (const o of observations) {
    if (
      o.native.identity.mint !== mint ||
      o.native.identity.market !== a.native.identity.market ||
      o.native.identity.quote !== a.native.identity.quote ||
      o.conversion.identity.mint !== o.native.identity.quote ||
      o.conversion.identity.quote !== WRAPPED_SOL_MINT ||
      o.conversion.identity.market !== 'conversion:' + o.native.identity.quote ||
      o.baseDecimals !== a.baseDecimals ||
      o.quoteDecimals !== a.quoteDecimals ||
      fingerprint(o.primaryFeeBps) !== fingerprint(a.primaryFeeBps) ||
      o.conversionFeePpm !== a.conversionFeePpm
    )
      throw new CandidateError('CONFLICTING_SOURCE_EVIDENCE');
    for (const x of [o.native, o.conversion]) {
      if (
        REAL_POLICY.trustedSources[x.source] !== x.upstream ||
        x.slot === null ||
        x.slot < 0n ||
        !x.tradeable ||
        !Number.isSafeInteger(x.observedAtMs) ||
        x.observedAtMs > now + REAL_POLICY.maxFutureMs ||
        now - x.observedAtMs > REAL_POLICY.maxAgeMs
      )
        throw new CandidateError('STALE_OR_UNTRUSTED_CONVERSION');
    }
  }
  if (a.native.upstream === b.native.upstream) throw new CandidateError('PRICE_QUORUM_UNAVAILABLE');
  const times = observations.flatMap((o) => [o.native.observedAtMs, o.conversion.observedAtMs]);
  if (Math.max(...times) - Math.min(...times) > REAL_POLICY.maxSkewMs)
    throw new CandidateError('INCOHERENT_SNAPSHOT');
  discrepancy(a.native.price, b.native.price, REAL_POLICY.maxDiscrepancyBps);
  discrepancy(a.conversion.price, b.conversion.price, REAL_POLICY.maxDiscrepancyBps);
  if (previous) {
    observationProgression(
      observations.map((o) => o.native),
      previous.map((o) => o.native),
    );
    observationProgression(
      observations.map((o) => o.conversion),
      previous.map((o) => o.conversion),
    );
  }
  return product(a.native.price, a.conversion.price); // Lamports/base unit already; no second decimal scaling.
}
/** Catalog entries are sample acquisition hints, not generic admission rules. Actual chain linkage must match. */
export const NON_SOL_SAMPLES = [
  {
    label: 'GOOG-quoted migrated PumpSwap',
    mint: '5pHhLJn3nXKLXyHMpoMP8YLrt1Brt3z84NWspPkKWaep',
    kind: 'PUMP_SWAP_ORCA',
  },
  {
    label: 'PUMP-quoted migrated PumpSwap TUSD',
    mint: '7UhL5K7t1UDPLdhoj2Sz59kyn79Qvxkvk75ukfxDTUSD',
    kind: 'PUMP_SWAP_ORCA',
  },
  {
    label: 'PINKY/DJT composed',
    mint: '36sagUqFTtRexLToDforaTaWve4HdCuzH3EXNAtLwfUQ',
    kind: 'OTHER_COMPOSED',
  },
  {
    label: 'previous Pump/Orca NVDAx',
    mint: 'BsCrE8ZBoqwzv1Yix8uV6S7MmvmH6R7B5Nv3Su8CtmN3',
    kind: 'OTHER_COMPOSED',
  },
] as const;
export class NonSolProvider {
  readonly reviews = new Map<string, unknown>();
  private serial: Promise<unknown> = Promise.resolve();
  private readonly previous = new Map<string, readonly NonSolObservation[]>();
  readonly networkReceipts: unknown[] = [];
  private readonly rpc = ENDPOINTS.map(
    (url) =>
      new SolanaRpcClient({
        url,
        timeoutMs: 5000,
        commitment: 'confirmed',
        fetchImplementation: async (endpoint, init) => {
          const request = JSON.parse(String(init?.body)) as { method: string };
          if (
            !['getMultipleAccounts', 'getAccountInfo', 'getProgramAccounts', 'getSlot'].includes(
              request.method,
            )
          )
            throw new CandidateError('READ_ONLY_RPC_REQUIRED');
          const response = await fetch(endpoint, init);
          const body: unknown = await response.clone().json();
          this.networkReceipts.push({
            upstream: url,
            request,
            receivedAtMs: Date.now(),
            status: response.status,
            body,
          });
          return response;
        },
      }),
  );
  private verified = false;
  private async verifyNetwork() {
    if (this.verified) return;
    const results = await Promise.all(
      ENDPOINTS.map(async (endpoint) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] }),
          signal: AbortSignal.timeout(5000),
        });
        const body = (await response.json()) as { result?: string };
        return response.ok && body.result === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
      }),
    );
    if (!results.every(Boolean)) throw new CandidateError('MAINNET_PROVENANCE_UNVERIFIED');
    this.verified = true;
  }
  async inspect(mint: string, terminalMint = mint) {
    if (mint !== terminalMint) throw new CandidateError('TERMINAL_TOKEN_POOL_IDENTITY_MISMATCH');
    const task = this.serial
      .catch(() => undefined)
      .then(async () => {
        await this.verifyNetwork();
        const receiptStart = this.networkReceipts.length;
        const curve = (
          await this.rpc[0]!.getMultipleAccounts([await pumpBondingCurveAddress(mint)])
        ).value[0];
        if (curve && curve.owner !== PUMP_PROGRAM_ID)
          throw new CandidateError('CANONICAL_CURVE_OWNER_MISMATCH');
        // Choose the source family from canonical chain identity, never by retrying another venue after failure.
        if (!curve || !decodePumpBondingCurve(Buffer.from(curve.data[0], 'base64')).complete) {
          const existing = await this.inspectExisting(mint);
          const available = existing.flatMap((row) => ('state' in row ? [row] : []));
          const metadata = available.map((row) => {
            const hops = row.state.normalizedState['hops'] as {
              pool: string;
              mintA: string;
              mintB: string;
            }[];
            const first = hops[0];
            if (!first || ![first.mintA, first.mintB].includes(mint))
              throw new CandidateError('TERMINAL_TOKEN_POOL_IDENTITY_MISMATCH');
            const quoteMint = first.mintA === mint ? first.mintB : first.mintA;
            const accounts = row.state.normalizedState['accounts'] as Record<
              string,
              { base64: string }
            >;
            const quote = accounts[quoteMint];
            if (!quote) throw new CandidateError('CONVERSION_MINT_EVIDENCE_UNAVAILABLE');
            return {
              upstream: row.upstream,
              tokenMint: mint,
              quoteMint,
              baseDecimals: Number(row.state.normalizedState['tokenDecimals']),
              quoteDecimals: Buffer.from(quote.base64, 'base64')[44],
              firstPool: first.pool,
              routeHash: fingerprint(hops),
              slot: row.state.chainSlot,
              sourceTime: row.state.normalizedState['chainTime'],
              state: row.state,
            };
          });
          this.reviews.set(mint, {
            mint,
            terminalMint,
            family: 'CANONICAL_GENERAL_COMPOSED',
            existingRoute: existing,
            metadata,
            receipts: structuredClone(this.networkReceipts.slice(receiptStart)),
            admitted: false,
          });
          if (
            metadata.length === 2 &&
            fingerprint({
              quote: metadata[0]!.quoteMint,
              baseDecimals: metadata[0]!.baseDecimals,
              quoteDecimals: metadata[0]!.quoteDecimals,
              route: metadata[0]!.routeHash,
            }) !==
              fingerprint({
                quote: metadata[1]!.quoteMint,
                baseDecimals: metadata[1]!.baseDecimals,
                quoteDecimals: metadata[1]!.quoteDecimals,
                route: metadata[1]!.routeHash,
              })
          )
            throw new CandidateError('CONFLICTING_COMPOSED_ROUTE_IDENTITY');
          throw new CandidateError(
            available.length === 2
              ? 'COMPOSED_SPOT_AND_FEE_NORMALIZATION_REQUIRED'
              : 'COMPOSED_PRICE_FX_QUORUM_UNAVAILABLE',
          );
        }
        const snapshots: { upstream: string; state: Stage1Snapshot }[] = [];
        const results = await Promise.allSettled(
          this.rpc.map(async (rpc, index) => {
            const engine = new Stage1NonSolPumpSwap({ purpose: 'READ_ONLY_STAGE1_VALIDATION' });
            const state = await engine.capture(
              { getMultipleAccounts: (keys) => readSameBank(rpc, keys) },
              mint,
            );
            snapshots.push({ upstream: ENDPOINTS[index]!, state });
            return decodeNonSol(state, index as 0 | 1);
          }),
        );
        const observations = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        const errors = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []));
        const review: Record<string, unknown> = {
          mint,
          terminalMint,
          provenance: 'REAL_READ_ONLY_MAINNET',
          snapshots,
          observations,
          errors,
          receipts: structuredClone(this.networkReceipts.slice(receiptStart)),
          admitted: false,
        };
        this.reviews.set(mint, review);
        if (errors.length) throw new CandidateError('NON_SOL_NATIVE_EVIDENCE_UNAVAILABLE');
        review['paperSolSpot'] = verifyNonSolQuorum(observations, mint, this.previous.get(mint));
        this.previous.set(mint, observations);
        if (observations.some((o) => o.adaptiveFee))
          throw new CandidateError('ADAPTIVE_CONVERSION_FEE_NOT_NORMALIZED');
        const incompatible = observations.find((o) => !o.costs.representable);
        if (incompatible) throw new CandidateError(incompatible.costs.unsupported!);
        // A price/FX quorum is not fill authority. Exact fee amounts, width and directional size proof remain mandatory.
        throw new CandidateError('DIRECTIONAL_COST_AND_ROUNDING_PROOF_REQUIRED');
      });
    this.serial = task;
    return task;
  }
  async inspectExisting(mint: string) {
    await this.verifyNetwork();
    const rows = await Promise.allSettled(
      this.rpc.map((rpc, index) =>
        withAdvisoryRead(
          {
            signal: AbortSignal.timeout(12000),
            metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 },
          },
          async () => {
            const source = new SolanaRouteSource(rpc);
            const state = await source.loadMarketState({
              protocolId: SOLANA_ROUTE_PROTOCOL_ID,
              marketId: identifier('solana-route:' + mint, 'MarketId'),
              tokenMint: identifier(mint, 'TokenMint'),
            });
            return { upstream: ENDPOINTS[index], state };
          },
        ),
      ),
    );
    return rows.map((r) =>
      r.status === 'fulfilled' ? r.value : { unavailable: String(r.reason) },
    );
  }
  async independentQuotes(mint: string) {
    const rows: unknown[] = [];
    for (const input of [10000000n, 100000000n, 1000000000n]) {
      try {
        const buy = await jupiterQuote(mint, 'BUY', input, false),
          buyTime = await blockTime(buy.contextSlot);
        const sell = await jupiterQuote(mint, 'SELL', BigInt(buy.outAmount), false),
          sellTime = await blockTime(sell.contextSlot);
        rows.push({
          input,
          buy,
          buyTime,
          sell,
          sellTime,
          feeConvention: 'ALL_IN; NOT V2 FEE_EXCLUSIVE',
          candidateAdmitted: false,
        });
      } catch (error) {
        rows.push({ input, unavailable: String(error), candidateAdmitted: false });
      }
    }
    return rows;
  }
}
