import type { Evidence, Policy } from '../../candidates/simple-price-v2-directional/model.js';
/** Inspection only; never authorizes a cutoff price or relaxes validation. */
export function cutoffTimeline(e: Evidence, cutoffMs: number, p: Policy) {
  const row = (kind: string, source: string, at: number, slot: bigint | null) => ({
    kind,
    source,
    observedAtMs: at,
    slot,
    afterCutoffMs: at - cutoffMs,
    existingRuleRejects: at > cutoffMs + p.maxFutureMs || cutoffMs - at > p.maxAgeMs,
    afterCutoff: at > cutoffMs,
  });
  return [
    ...e.observations.map((o) => row('TOKEN', o.source, o.observedAtMs, o.slot)),
    ...(e.conversion?.observations ?? []).map((o) => row('FX', o.source, o.observedAtMs, o.slot)),
    row('FEE', 'verified-fee', e.feeObservedAtMs, null),
    ...e.calibration.quotes.map((o) => row(o.side + '_QUOTE', o.source, o.observedAtMs, o.slot)),
  ];
}
export const REQUIRED_CUTOFF_POLICY = 'CUTOFF_PRICE_SELECTION_NOT_APPROVED';

/** Read-only intersection of the two unchanged freshness windows; no price authority is created. */
export function cutoffTimeWindow(cutoffMs: number, currentMs: number, p: Policy) {
  const earliest = Math.max(cutoffMs - p.maxAgeMs, currentMs - p.maxAgeMs);
  const latest = Math.min(cutoffMs + p.maxFutureMs, currentMs + p.maxFutureMs);
  return { earliest, latest, possible: earliest <= latest };
}
