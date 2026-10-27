/** Fee-only arithmetic. No reserves, ticks, pool transitions, or quote output used as a price. */
import { CandidateError, ceil, fingerprint } from './model.js';
import type { Fee, Rational } from '../simple-price-v2/model.js';
import type { Evidence, Policy } from './model.js';
export interface CostProof {
  readonly source: string;
  readonly upstream: string;
  readonly reference: string;
  readonly observedAtMs: number;
  readonly slot: bigint;
  readonly minInput: bigint;
  readonly maxInput: bigint;
  /** SDK rate extrema over the largest captured directional path, fractions, not bps. */
  readonly rateMin: Rational;
  readonly rateMax: Rational;
}
export interface DirectionalSchedule {
  readonly primary: readonly Fee[];
  readonly bridgeInputRate: Rational;
  readonly adaptive: boolean;
  readonly proofs: readonly CostProof[];
}
export interface DirectionalCosts {
  readonly convention: 'PUMPSWAP_QUOTE_CEIL_ORCA_INPUT_CEIL';
  readonly route: readonly [string, string];
  readonly BUY: DirectionalSchedule;
  readonly SELL: DirectionalSchedule;
}
const check = (ok: boolean, reason: string) => {
  if (!ok) throw new CandidateError(reason);
};
const equal = (a: Rational, b: Rational) => a.n * b.d === b.n * a.d;
export function costHash(e: Pick<Evidence, 'fees' | 'directionalCosts'>): string {
  return fingerprint(e.directionalCosts ?? e.fees);
}
/** Economic terms only; fresh RPC receipts may change provenance hashes at the same bank cursor. */
export function costTermsHash(e: Pick<Evidence, 'fees' | 'directionalCosts'>): string {
  const c = e.directionalCosts;
  const terms = (s: DirectionalSchedule) => ({
    primary: s.primary,
    rate: s.bridgeInputRate,
    adaptive: s.adaptive,
  });
  return fingerprint(
    c
      ? { convention: c.convention, route: c.route, BUY: terms(c.BUY), SELL: terms(c.SELL) }
      : e.fees,
  );
}
export function validateCosts(e: Evidence, now: number, policy: Policy): void {
  const costs = e.directionalCosts;
  if (!costs) return;
  check(e.identity.quote !== policy.solQuote && !!e.conversion, 'DIRECTIONAL_FX_REQUIRED');
  check(e.fees.length === 0, 'DUPLICATED_FEE_CONTRACT');
  check(
    costs.convention === 'PUMPSWAP_QUOTE_CEIL_ORCA_INPUT_CEIL' &&
      Array.isArray(costs.route) &&
      costs.route.length === 2 &&
      costs.route[0] === e.identity.market &&
      !!costs.route[1],
    'UNVERIFIED_COST_CONVENTION',
  );
  for (const side of ['BUY', 'SELL'] as const) {
    const s = costs[side];
    check(!!s && typeof s.adaptive === 'boolean', 'DIRECTIONAL_FEES_REQUIRED');
    const r = s.bridgeInputRate;
    check(
      !!r && typeof r.n === 'bigint' && typeof r.d === 'bigint' && r.n >= 0n && r.d > r.n,
      'INVALID_FEES',
    );
    check(
      Array.isArray(s.primary) &&
        s.primary.length > 0 &&
        new Set(s.primary.map((f) => f.category)).size === s.primary.length &&
        s.primary.every((f) => !!f.category && typeof f.bps === 'bigint' && f.bps >= 0n) &&
        s.primary.reduce((a, f) => a + f.bps, 0n) < 10000n,
      'INVALID_FEES',
    );
    check(
      Array.isArray(s.proofs) && s.proofs.length === e.observations.length,
      'DIRECTIONAL_FEE_QUORUM_REQUIRED',
    );
    for (const o of e.observations) {
      const rows = s.proofs.filter((p) => p.source === o.source),
        p = rows[0];
      check(
        rows.length === 1 &&
          !!p &&
          p.upstream === o.upstream &&
          p.reference === o.reference &&
          p.slot === o.slot &&
          p.observedAtMs === o.observedAtMs,
        'CONFLICTING_FEE_PROVENANCE',
      );
      if (!p) throw new CandidateError('DIRECTIONAL_FEE_QUORUM_REQUIRED');
      check(
        Number.isSafeInteger(p.observedAtMs) &&
          now - p.observedAtMs <= policy.maxAgeMs &&
          p.observedAtMs <= now + policy.maxFutureMs,
        'STALE_FEE_EVIDENCE',
      );
      check(
        typeof p.minInput === 'bigint' &&
          typeof p.maxInput === 'bigint' &&
          p.minInput > 0n &&
          p.maxInput >= p.minInput,
        'UNSUPPORTED_FEE_RANGE',
      );
      check(
        !!p.rateMin &&
          !!p.rateMax &&
          typeof p.rateMin.n === 'bigint' &&
          typeof p.rateMin.d === 'bigint' &&
          typeof p.rateMax.n === 'bigint' &&
          typeof p.rateMax.d === 'bigint' &&
          p.rateMin.n >= 0n &&
          p.rateMin.d > p.rateMin.n &&
          p.rateMax.n >= 0n &&
          p.rateMax.d > p.rateMax.n &&
          equal(r, p.rateMin) &&
          equal(r, p.rateMax),
        'VARIABLE_ADAPTIVE_FEE_RANGE',
      );
    }
  }
}
export function costProgression(e: Evidence, prior: Evidence): void {
  if (!e.directionalCosts && !prior.directionalCosts) return;
  check(!!e.directionalCosts && !!prior.directionalCosts, 'COST_CONTRACT_CHANGED');
  for (const side of ['BUY', 'SELL'] as const) {
    const s = e.directionalCosts![side],
      old = prior.directionalCosts![side];
    for (const p of s.proofs) {
      const before = old.proofs.find((x) => x.source === p.source);
      check(!!before && p.upstream === before.upstream, 'CONFLICTING_FEE_PROVENANCE');
      if (!before) throw new CandidateError('DIRECTIONAL_FEE_QUORUM_REQUIRED');
      check(
        p.slot >= before.slot && p.observedAtMs >= before.observedAtMs,
        'REGRESSING_FEE_EVIDENCE',
      );
      if (p.slot === before.slot && p.observedAtMs === before.observedAtMs)
        check(
          fingerprint({
            primary: s.primary,
            rate: s.bridgeInputRate,
            adaptive: s.adaptive,
            minInput: p.minInput,
            maxInput: p.maxInput,
            rateMin: p.rateMin,
            rateMax: p.rateMax,
          }) ===
            fingerprint({
              primary: old.primary,
              rate: old.bridgeInputRate,
              adaptive: old.adaptive,
              minInput: before.minInput,
              maxInput: before.maxInput,
              rateMin: before.rateMin,
              rateMax: before.rateMax,
            }) &&
            fingerprint(e.directionalCosts!.route) === fingerprint(prior.directionalCosts!.route),
          'CONFLICTING_FEE_EVIDENCE',
        );
    }
  }
}
const sum = (fees: readonly { amount: bigint }[]) => fees.reduce((a, f) => a + f.amount, 0n);
/** Exact fee-only BUY waterfall; conversion/base-unit dust is separated before curve fitting. */
export function directionalBuy(budget: bigint, e: Evidence) {
  const s = e.directionalCosts!.BUY,
    fx = e.conversion!.price,
    r = s.bridgeInputRate;
  const bridge = ceil(budget * r.n, r.d),
    quoteBudget = ((budget - bridge) * fx.d) / fx.n;
  const basis = (quoteBudget * 10000n) / (10000n + s.primary.reduce((a, f) => a + f.bps, 0n));
  const raw = s.primary.map((f) => ({ category: f.category, amount: ceil(basis * f.bps, 10000n) }));
  const quoteNet = quoteBudget - sum(raw),
    notional = (quoteNet * fx.n) / fx.d;
  let remaining = quoteBudget,
    before = (remaining * fx.n) / fx.d;
  const fees = [
    { category: 'BRIDGE_AMM_TRADE_FEE', amount: bridge },
    ...raw.map((f) => {
      remaining -= f.amount;
      const after = (remaining * fx.n) / fx.d,
        amount = before - after;
      before = after;
      return { category: f.category, amount };
    }),
  ];
  const dust = budget - notional - sum(fees);
  check(notional > 0n && dust >= 0n, 'ZERO_OUTPUT');
  return { notional, fees, dust, bridgeInput: budget };
}
/** Exact fee-only SELL waterfall. Audit categories telescope to gross minus net, less FX dust. */
export function directionalSell(gross: bigint, e: Evidence) {
  const s = e.directionalCosts!.SELL,
    fx = e.conversion!.price,
    r = s.bridgeInputRate;
  const quoteGross = (gross * fx.d) / fx.n;
  let remaining = quoteGross,
    before = (remaining * fx.n) / fx.d;
  const dust = gross - before;
  const fees = s.primary.map((f) => {
    remaining -= ceil(quoteGross * f.bps, 10000n);
    const after = (remaining * fx.n) / fx.d,
      amount = before - after;
    before = after;
    return { category: f.category, amount };
  });
  const bridgeInput = remaining;
  remaining -= ceil(remaining * r.n, r.d);
  const net = (remaining * fx.n) / fx.d;
  fees.push({ category: 'BRIDGE_AMM_TRADE_FEE', amount: before - net });
  check(net > 0n && dust >= 0n, 'ZERO_OUTPUT');
  return { net, fees, dust, bridgeInput };
}
export function feeRange(e: Evidence, side: 'BUY' | 'SELL', bridgeInput: bigint): void {
  for (const p of e.directionalCosts?.[side].proofs ?? [])
    check(bridgeInput >= p.minInput && bridgeInput <= p.maxInput, 'UNSUPPORTED_FEE_RANGE');
}
