import { createHash } from 'node:crypto';

export const MODEL_VERSION = 'simple-price-candidate-v2';
export const CANDIDATE_ENABLED = false;
const BPS = 10_000n;
export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}
export interface Identity {
  readonly mint: string;
  readonly market: string;
  readonly quote: string;
}
export interface Observation {
  readonly source: string;
  readonly upstream: string;
  readonly reference: string;
  readonly observedAtMs: number;
  readonly slot: bigint | null;
  /** Quote base units per token base unit. Prices must be fee-exclusive. */
  readonly price: Rational;
  readonly identity: Identity;
  readonly tradeable: boolean;
}
export interface Fee {
  readonly category: string;
  readonly bps: bigint;
}
export interface Evidence {
  readonly identity: Identity;
  readonly observations: readonly Observation[];
  /** Lamports per quote base unit; SOL uses exactly 1/1. */
  readonly conversion: {
    readonly price: Rational;
    readonly observations: readonly Observation[];
  } | null;
  readonly fees: readonly Fee[];
  readonly feeReference: string;
  readonly feeObservedAtMs: number;
  readonly calibration: Calibration;
}
export interface ReferenceQuote {
  readonly source: string;
  readonly upstream: string;
  readonly reference: string;
  readonly identity: Identity;
  readonly side: 'BUY' | 'SELL';
  readonly input: bigint;
  readonly output: bigint;
  readonly observedAtMs: number;
  readonly slot: bigint;
  readonly feesHash: string;
  readonly convention: 'EXACT_INPUT_ALL_IN_VERIFIED';
}
export interface Calibration {
  readonly snapshotHash: string;
  readonly spotConvention: 'FEE_EXCLUSIVE_SPOT';
  readonly feeConvention: 'LAMPORT_BUY_INPUT_SELL_GROSS_CEIL';
  readonly widthConvention: 'NO_FIXED_WIDTH_VERIFIED';
  /** First BUY is the fit input; remaining BUY and all SELL quotes validate range. */
  readonly quotes: readonly ReferenceQuote[];
}
export interface Policy {
  readonly version: string;
  readonly maxAgeMs: number;
  readonly maxFutureMs: number;
  readonly maxSkewMs: number;
  readonly maxDiscrepancyBps: bigint;
  readonly maxMovementBps: bigint;
  readonly trustedSources: Readonly<Record<string, string>>;
  readonly solQuote: string;
  readonly trustedQuoteSources: Readonly<Record<string, string>>;
  readonly maxQuoteSlotSkew: bigint;
  readonly maxCalibrationErrorBps: bigint;
}
export class CandidateError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function requireEvidence(ok: boolean, code: string): asserts ok {
  if (!ok) throw new CandidateError(code);
}
export function fingerprint(value: unknown): string {
  const stable = (v: unknown): unknown => {
    if (typeof v === 'bigint') return { bigint: v.toString() };
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, stable(x)]),
      );
    return v;
  };
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}
function rational(p: Rational): void {
  requireEvidence(
    typeof p.n === 'bigint' && typeof p.d === 'bigint' && p.n > 0n && p.d > 0n,
    'INVALID_PRICE',
  );
}
function sameIdentity(a: Identity, b: Identity): boolean {
  return a.mint === b.mint && a.market === b.market && a.quote === b.quote;
}
function time(at: number, now: number, p: Policy): void {
  requireEvidence(
    Number.isSafeInteger(at) && at >= 0 && at <= now + p.maxFutureMs && now - at <= p.maxAgeMs,
    'STALE_OR_INVALID_EVIDENCE',
  );
}
export function discrepancy(a: Rational, b: Rational, limit: bigint): void {
  const x = a.n * b.d,
    y = b.n * a.d;
  requireEvidence((x > y ? x - y : y - x) * BPS <= (x < y ? x : y) * limit, 'CONTRADICTORY_PRICE');
}
/** Compare like-for-like source cursors; an archived baseline is never a current price fallback. */
export function observationProgression(
  current: readonly Observation[],
  previous: readonly Observation[],
): void {
  requireEvidence(
    new Set(previous.map((o) => o.source)).size === previous.length,
    'INVALID_PREVIOUS_EVIDENCE',
  );
  requireEvidence(
    current.length === previous.length &&
      current.every((o) => previous.some((p) => p.source === o.source)) &&
      current[0]?.source === previous[0]?.source,
    'SOURCE_PROVENANCE_CHANGED',
  );
  for (const o of current) {
    const prior = previous.find((p) => p.source === o.source);
    requireEvidence(prior !== undefined, 'SOURCE_PROVENANCE_CHANGED');
    requireEvidence(
      sameIdentity(o.identity, prior.identity) && o.upstream === prior.upstream,
      'CONFLICTING_SOURCE_EVIDENCE',
    );
    rational(prior.price);
    requireEvidence(
      Number.isSafeInteger(prior.observedAtMs) &&
        prior.observedAtMs >= 0 &&
        (prior.slot === null || (typeof prior.slot === 'bigint' && prior.slot >= 0n)),
      'INVALID_PREVIOUS_EVIDENCE',
    );
    requireEvidence(
      o.observedAtMs >= prior.observedAtMs &&
        (prior.slot === null || (o.slot !== null && o.slot >= prior.slot)),
      'REGRESSING_EVIDENCE',
    );
    if (o.observedAtMs === prior.observedAtMs && o.slot === prior.slot) {
      requireEvidence(
        o.price.n * prior.price.d === prior.price.n * o.price.d && o.tradeable === prior.tradeable,
        'CONFLICTING_SOURCE_EVIDENCE',
      );
    }
  }
}
function quorum(
  observations: readonly Observation[],
  identity: Identity,
  now: number,
  p: Policy,
): Rational {
  requireEvidence(observations.length >= 2 && observations.length <= 8, 'PRICE_QUORUM_UNAVAILABLE');
  const upstreams = new Set<string>();
  for (const o of observations) {
    requireEvidence(
      !!o.reference && !!o.upstream && p.trustedSources[o.source] === o.upstream,
      'UNTRUSTED_SOURCE',
    );
    requireEvidence(
      sameIdentity(o.identity, identity) && o.tradeable === true,
      'UNSUPPORTED_OR_WRONG_MARKET',
    );
    requireEvidence(
      o.slot === null || (typeof o.slot === 'bigint' && o.slot >= 0n),
      'INVALID_SLOT',
    );
    rational(o.price);
    time(o.observedAtMs, now, p);
    upstreams.add(o.upstream);
  }
  requireEvidence(
    new Set(observations.map((o) => o.source)).size === observations.length,
    'CONFLICTING_SOURCE_EVIDENCE',
  );
  requireEvidence(upstreams.size >= 2, 'PRICE_QUORUM_UNAVAILABLE');
  const timestamps = observations.map((o) => o.observedAtMs);
  requireEvidence(
    Math.max(...timestamps) - Math.min(...timestamps) <= p.maxSkewMs,
    'INCOHERENT_SNAPSHOT',
  );
  for (const a of observations)
    for (const b of observations) discrepancy(a.price, b.price, p.maxDiscrepancyBps);
  // The explicit primary is retained, never averaged with an unverified source.
  return observations[0]!.price;
}
export function validateEvidence(
  e: Evidence,
  expected: Identity,
  now: number,
  p: Policy,
  previous?: Evidence,
): Rational {
  requireEvidence(
    Number.isSafeInteger(now) &&
      now >= 0 &&
      !!p.version &&
      [p.maxAgeMs, p.maxFutureMs, p.maxSkewMs].every((x) => Number.isSafeInteger(x) && x >= 0) &&
      typeof p.maxDiscrepancyBps === 'bigint' &&
      p.maxDiscrepancyBps >= 0n &&
      typeof p.maxMovementBps === 'bigint' &&
      p.maxMovementBps >= 0n,
    'INVALID_POLICY',
  );
  requireEvidence(
    sameIdentity(e.identity, expected) &&
      Object.values(expected).every((x) => typeof x === 'string' && x.length > 0),
    'WRONG_MARKET',
  );
  const native = quorum(e.observations, expected, now, p);
  let fx: Rational = { n: 1n, d: 1n };
  if (expected.quote !== p.solQuote) {
    requireEvidence(e.conversion !== null, 'CONVERSION_UNAVAILABLE');
    fx = quorum(
      e.conversion.observations,
      { mint: expected.quote, quote: p.solQuote, market: `conversion:${expected.quote}` },
      now,
      p,
    );
    rational(e.conversion.price);
    requireEvidence(
      fx.n * e.conversion.price.d === e.conversion.price.n * fx.d,
      'CONTRADICTORY_CONVERSION',
    );
  } else requireEvidence(e.conversion === null, 'UNEXPECTED_CONVERSION');
  const allTimes = [...e.observations, ...(e.conversion?.observations ?? [])].map(
    (o) => o.observedAtMs,
  );
  allTimes.push(e.feeObservedAtMs, ...e.calibration.quotes.map((q) => q.observedAtMs));
  time(e.feeObservedAtMs, now, p);
  requireEvidence(
    Math.max(...allTimes) - Math.min(...allTimes) <= p.maxSkewMs,
    'INCOHERENT_SNAPSHOT',
  );
  requireEvidence(
    !!e.feeReference &&
      e.fees.length > 0 &&
      new Set(e.fees.map((f) => f.category)).size === e.fees.length &&
      e.fees.every((f) => !!f.category && typeof f.bps === 'bigint' && f.bps >= 0n) &&
      e.fees.reduce((s, f) => s + f.bps, 0n) < BPS,
    'INVALID_FEES',
  );
  requireEvidence(
    e.calibration.spotConvention === 'FEE_EXCLUSIVE_SPOT' &&
      e.calibration.feeConvention === 'LAMPORT_BUY_INPUT_SELL_GROSS_CEIL' &&
      e.calibration.widthConvention === 'NO_FIXED_WIDTH_VERIFIED' &&
      e.calibration.snapshotHash === snapshotHash(e),
    'UNVERIFIED_PRICE_CONVENTION',
  );
  if (previous) {
    requireEvidence(sameIdentity(previous.identity, expected), 'WRONG_PREVIOUS_MARKET');
    requireEvidence(previous.observations.length >= 2, 'INVALID_PREVIOUS_EVIDENCE');
    observationProgression(e.observations, previous.observations);
    if (e.conversion) {
      requireEvidence(
        previous.conversion !== null && previous.conversion.observations.length >= 2,
        'INVALID_PREVIOUS_EVIDENCE',
      );
      observationProgression(e.conversion.observations, previous.conversion.observations);
    }
    // Previous evidence is an archived baseline, not a substitute current execution price.
    discrepancy(native, previous.observations[0]!.price, p.maxMovementBps);
    if (e.conversion && previous.conversion)
      discrepancy(fx, previous.conversion.price, p.maxMovementBps);
  }
  return { n: native.n * fx.n, d: native.d * fx.d };
}
export const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
export function snapshotHash(e: Omit<Evidence, 'calibration'>): string {
  return fingerprint({
    identity: e.identity,
    observations: e.observations,
    conversion: e.conversion,
    fees: e.fees,
    feeReference: e.feeReference,
    feeObservedAtMs: e.feeObservedAtMs,
  });
}
export function feeAmounts(base: bigint, fees: readonly Fee[]) {
  return fees.map((f) => ({ category: f.category, amount: ceil(base * f.bps, BPS) }));
}
const total = (fees: readonly { amount: bigint }[]) => fees.reduce((s, f) => s + f.amount, 0n);
export function buyNotional(budget: bigint, fees: readonly Fee[]): bigint {
  let lo = 0n,
    hi = budget;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid + total(feeAmounts(mid, fees)) <= budget) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}
interface Curve {
  readonly k: Rational;
  readonly minBuy: bigint;
  readonly maxBuy: bigint;
  readonly minSell: bigint;
  readonly maxSell: bigint;
}
const mark = (q: bigint, p: Rational) => (q * p.n) / p.d;
const sellGross = (m: bigint, k: Rational) => (m * k.d) / (k.d + k.n * m);
const buyTokens = (x: bigint, p: Rational, k: Rational) =>
  (x * p.d * k.d) / (p.n * (k.d + k.n * x));
/** Fit only after exact fixed-fee removal; held-out directional quotes establish supported bounds. */
export function calibrate(e: Evidence, price: Rational, now: number, p: Policy): Curve {
  requireEvidence(
    typeof p.maxQuoteSlotSkew === 'bigint' &&
      p.maxQuoteSlotSkew >= 0n &&
      typeof p.maxCalibrationErrorBps === 'bigint' &&
      p.maxCalibrationErrorBps >= 0n &&
      p.maxCalibrationErrorBps < BPS,
    'INVALID_POLICY',
  );
  const quotes = e.calibration.quotes;
  requireEvidence(
    quotes.length >= 4 &&
      quotes.length <= 32 &&
      new Set(quotes.map((q) => q.reference)).size === quotes.length,
    'CALIBRATION_UNAVAILABLE',
  );
  const spotSlots = [...e.observations, ...(e.conversion?.observations ?? [])].map((o) => o.slot);
  requireEvidence(
    spotSlots.every((s) => s !== null),
    'QUOTE_SLOT_UNAVAILABLE',
  );
  for (const q of quotes) {
    requireEvidence(
      q.convention === 'EXACT_INPUT_ALL_IN_VERIFIED' &&
        !!q.reference &&
        p.trustedQuoteSources[q.source] === q.upstream &&
        !!q.upstream &&
        sameIdentity(q.identity, e.identity) &&
        q.feesHash === fingerprint(e.fees) &&
        typeof q.input === 'bigint' &&
        q.input > 0n &&
        typeof q.output === 'bigint' &&
        q.output > 0n &&
        typeof q.slot === 'bigint' &&
        q.slot >= 0n &&
        (q.side === 'BUY' || q.side === 'SELL'),
      'UNVERIFIED_QUOTE',
    );
    time(q.observedAtMs, now, p);
    requireEvidence(
      spotSlots.every(
        (s) => s !== null && (s > q.slot ? s - q.slot : q.slot - s) <= p.maxQuoteSlotSkew,
      ),
      'QUOTE_STATE_SLOT_SKEW',
    );
  }
  const buys = quotes.filter((q) => q.side === 'BUY'),
    sells = quotes.filter((q) => q.side === 'SELL');
  requireEvidence(buys.length >= 2 && sells.length >= 2, 'DIRECTIONAL_QUOTES_REQUIRED');
  const anchor = buys[0]!,
    n = buyNotional(anchor.input, e.fees);
  requireEvidence(
    n + total(feeAmounts(n, e.fees)) === anchor.input,
    'UNSUPPORTED_QUOTE_FEE_NORMALIZATION',
  );
  const delta = n * price.d - anchor.output * price.n;
  // A floor-to-token discrepancy alone is not evidence of size impact.
  requireEvidence(delta > price.n, 'UNMEASURED_SIZE_RESPONSE');
  const k = { n: delta, d: anchor.output * price.n * n };
  for (const q of quotes) {
    const x = buyNotional(q.input, e.fees);
    if (q.side === 'BUY')
      requireEvidence(
        x + total(feeAmounts(x, e.fees)) === q.input,
        'UNSUPPORTED_QUOTE_FEE_NORMALIZATION',
      );
    const g = q.side === 'SELL' ? sellGross(mark(q.input, price), k) : x;
    const modeled = q.side === 'BUY' ? buyTokens(x, price, k) : g - total(feeAmounts(g, e.fees));
    const error = modeled > q.output ? modeled - q.output : q.output - modeled;
    requireEvidence(error * BPS <= q.output * p.maxCalibrationErrorBps, 'CALIBRATION_MISMATCH');
  }
  const bn = buys.map((q) => buyNotional(q.input, e.fees)),
    sn = sells.map((q) => mark(q.input, price));
  const min = (xs: bigint[]) => xs.reduce((a, b) => (a < b ? a : b)),
    max = (xs: bigint[]) => xs.reduce((a, b) => (a > b ? a : b));
  requireEvidence(min(bn) < max(bn) && min(sn) > 0n && min(sn) < max(sn), 'UNSUPPORTED_SIZE_RANGE');
  return { k, minBuy: min(bn), maxBuy: max(bn), minSell: min(sn), maxSell: max(sn) };
}
export interface Fill {
  readonly modelVersion: string;
  readonly policyVersion: string;
  readonly identity: Identity;
  readonly side: 'BUY' | 'SELL';
  readonly input: bigint;
  readonly requestedInput: bigint;
  readonly output: bigint;
  readonly gross: bigint;
  readonly fees: readonly { category: string; amount: bigint }[];
  readonly costs: {
    readonly fixedFeeLamports: bigint;
    readonly sizeImpactAndDustLamports: bigint;
    readonly platformFeeLamports: 0n;
    readonly uncertaintyBufferBps: 0n;
    readonly feeConvention: 'FULL_NOTIONAL_CEIL' | 'PROPORTIONAL_PEAK_NET';
  };
  readonly peakQuantity: bigint | null;
  readonly curve: Curve;
  readonly evidence: Evidence;
  readonly evidenceHash: string;
  readonly policy: Policy;
  readonly policyHash: string;
  readonly previousEvidence: Evidence | null;
  readonly executedAtMs: number;
}
export function quote(
  side: 'BUY' | 'SELL',
  amount: bigint,
  evidence: Evidence,
  identity: Identity,
  now: number,
  policy: Policy,
  previous?: Evidence,
  peakQuantity?: bigint,
): Fill {
  requireEvidence(
    typeof amount === 'bigint' && amount > 0n && (side === 'BUY' || side === 'SELL'),
    'INVALID_AMOUNT',
  );
  const e = structuredClone(evidence),
    p = structuredClone(policy);
  const price = validateEvidence(e, identity, now, p, previous),
    curve = calibrate(e, price, now, p);
  let gross: bigint,
    output: bigint,
    input: bigint,
    fees: readonly { category: string; amount: bigint }[],
    sizeLoss: bigint;
  if (side === 'BUY') {
    requireEvidence(peakQuantity === undefined, 'INVALID_PEAK_QUANTITY');
    gross = buyNotional(amount, e.fees);
    requireEvidence(gross >= curve.minBuy && gross <= curve.maxBuy, 'UNSUPPORTED_SIZE_RANGE');
    fees = feeAmounts(gross, e.fees);
    input = gross + total(fees);
    output = buyTokens(gross, price, curve.k);
    sizeLoss = gross - mark(output, price);
  } else {
    const peak = peakQuantity ?? amount;
    requireEvidence(typeof peak === 'bigint' && peak >= amount, 'INVALID_PEAK_QUANTITY');
    const m = mark(peak, price);
    requireEvidence(m >= curve.minSell && m <= curve.maxSell, 'UNSUPPORTED_SIZE_RANGE');
    const fullGross = sellGross(m, curve.k),
      fullFees = feeAmounts(fullGross, e.fees),
      fullNet = fullGross - total(fullFees);
    // Net is authoritative. Apportion audit fees down; never debit them from net again.
    output = (fullNet * amount) / peak;
    fees = fullFees.map((f) => ({ category: f.category, amount: (f.amount * amount) / peak }));
    gross = output + total(fees);
    input = amount;
    sizeLoss = mark(amount, price) - gross;
  }
  requireEvidence(output > 0n && gross > 0n && sizeLoss >= 0n, 'ZERO_OUTPUT');
  return {
    modelVersion: MODEL_VERSION,
    policyVersion: p.version,
    identity: structuredClone(identity),
    side,
    input,
    requestedInput: amount,
    output,
    gross,
    fees,
    costs: {
      fixedFeeLamports: total(fees),
      sizeImpactAndDustLamports: sizeLoss,
      platformFeeLamports: 0n,
      uncertaintyBufferBps: 0n,
      feeConvention: side === 'BUY' ? 'FULL_NOTIONAL_CEIL' : 'PROPORTIONAL_PEAK_NET',
    },
    peakQuantity: side === 'SELL' ? (peakQuantity ?? amount) : null,
    curve,
    evidence: e,
    evidenceHash: fingerprint(e),
    policy: p,
    policyHash: fingerprint(p),
    previousEvidence: previous ? structuredClone(previous) : null,
    executedAtMs: now,
  };
}
export function replayFill(fill: Fill): Fill {
  requireEvidence(
    fill.modelVersion === MODEL_VERSION &&
      fingerprint(fill.evidence) === fill.evidenceHash &&
      fingerprint(fill.policy) === fill.policyHash &&
      fill.policy.version === fill.policyVersion,
    'EVIDENCE_CORRUPTED',
  );
  const result = quote(
    fill.side,
    fill.requestedInput,
    fill.evidence,
    fill.identity,
    fill.executedAtMs,
    fill.policy,
    fill.previousEvidence ?? undefined,
    fill.peakQuantity ?? undefined,
  );
  requireEvidence(fingerprint(result) === fingerprint(fill), 'FILL_REPLAY_MISMATCH');
  return result;
}
export function valueForExit(
  quantity: bigint,
  evidence: Evidence,
  identity: Identity,
  now: number,
  policy: Policy,
  previous?: Evidence,
  peakQuantity?: bigint,
): bigint {
  return quote('SELL', quantity, evidence, identity, now, policy, previous, peakQuantity).output;
}
/** No invented cutoff price, write-off or microscopic retries. Persist this result in a future worker adapter. */
export function settlementFailure(
  attempt: number,
  maxAttempts: number,
  reason: string,
): { readonly state: 'RETRY_PENDING' | 'REVIEW_REQUIRED'; readonly reason: string } {
  requireEvidence(
    Number.isSafeInteger(attempt) &&
      attempt >= 1 &&
      Number.isSafeInteger(maxAttempts) &&
      maxAttempts >= 1 &&
      !!reason,
    'INVALID_RETRY_POLICY',
  );
  return { state: attempt >= maxAttempts ? 'REVIEW_REQUIRED' : 'RETRY_PENDING', reason };
}
