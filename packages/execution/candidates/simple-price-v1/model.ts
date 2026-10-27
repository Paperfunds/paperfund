import { createHash } from 'node:crypto';

export const MODEL_VERSION = 'simple-price-candidate-v1';
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
  readonly quality: {
    readonly depthLamports: bigint;
    readonly baseSpreadBps: bigint;
    readonly reference: string;
    readonly observedAtMs: number;
  };
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
function discrepancy(a: Rational, b: Rational, limit: bigint): void {
  const x = a.n * b.d,
    y = b.n * a.d;
  requireEvidence((x > y ? x - y : y - x) * BPS <= (x < y ? x : y) * limit, 'CONTRADICTORY_PRICE');
}
/** Compare like-for-like source cursors; an archived baseline is never a current price fallback. */
function observationProgression(
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
  allTimes.push(e.feeObservedAtMs, e.quality.observedAtMs);
  time(e.feeObservedAtMs, now, p);
  time(e.quality.observedAtMs, now, p);
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
    typeof e.quality.depthLamports === 'bigint' &&
      e.quality.depthLamports > 0n &&
      typeof e.quality.baseSpreadBps === 'bigint' &&
      e.quality.baseSpreadBps >= 0n &&
      e.quality.baseSpreadBps < BPS &&
      !!e.quality.reference,
    'QUALITY_UNAVAILABLE',
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
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
export interface Fill {
  readonly modelVersion: string;
  readonly policyVersion: string;
  readonly identity: Identity;
  readonly side: 'BUY' | 'SELL';
  readonly input: bigint;
  readonly output: bigint;
  readonly gross: bigint;
  readonly requestedInput: bigint;
  readonly fees: readonly { readonly category: string; readonly amount: bigint }[];
  readonly spreadLossLamports: bigint;
  readonly evidenceHash: string;
  readonly policyHash: string;
  readonly evidence: Evidence;
  readonly executedAtMs: number;
  readonly policy: Policy;
  readonly previousEvidence: Evidence | null;
}
/** Pure candidate only. Not registered with ExecutionRouter or exported by the package. */
export function quote(
  side: 'BUY' | 'SELL',
  amount: bigint,
  evidence: Evidence,
  identity: Identity,
  now: number,
  policy: Policy,
  previous?: Evidence,
): Fill {
  requireEvidence(
    typeof amount === 'bigint' && amount > 0n && (side === 'BUY' || side === 'SELL'),
    'INVALID_AMOUNT',
  );
  const e = structuredClone(evidence),
    p = structuredClone(policy);
  const price = validateEvidence(e, identity, now, p, previous);
  const feeTotal = (base: bigint) => e.fees.reduce((sum, f) => sum + ceil(base * f.bps, BPS), 0n);
  const depth = e.quality.depthLamports,
    spread = e.quality.baseSpreadBps;
  let gross: bigint, output: bigint, spreadLossLamports: bigint;
  if (side === 'BUY') {
    // Largest fee-exclusive notional whose separately ceiling-rounded fees fit the all-in spend.
    let lo = 0n,
      hi = amount;
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      if (mid + feeTotal(mid) <= amount) lo = mid;
      else hi = mid - 1n;
    }
    gross = lo;
    output = (gross * price.d * depth * BPS) / (price.n * (depth + gross) * (BPS + spread));
    spreadLossLamports = gross - (output * price.n) / price.d;
  } else {
    const mark = (amount * price.n) / price.d;
    gross = (mark * depth * (BPS - spread)) / ((depth + mark) * BPS);
    output = gross - feeTotal(gross);
    spreadLossLamports = mark - gross;
  }
  requireEvidence(output > 0n && gross > 0n, 'ZERO_OUTPUT');
  const fees = e.fees.map((f) => ({ category: f.category, amount: ceil(gross * f.bps, BPS) }));
  // Any BUY budget dust stays in cash; input is exact actual spend.
  return {
    modelVersion: MODEL_VERSION,
    policyVersion: p.version,
    identity: structuredClone(identity),
    side,
    input: side === 'BUY' ? gross + feeTotal(gross) : amount,
    requestedInput: amount,
    output,
    gross,
    fees,
    spreadLossLamports,
    evidenceHash: fingerprint(e),
    policyHash: fingerprint(p),
    evidence: e,
    executedAtMs: now,
    policy: p,
    previousEvidence: previous ? structuredClone(previous) : null,
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
): bigint {
  return quote('SELL', quantity, evidence, identity, now, policy, previous).output;
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
