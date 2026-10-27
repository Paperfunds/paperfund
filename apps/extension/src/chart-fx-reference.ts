import type { HistoricalChartFx, Trade } from '@paperfund/shared/browser';

type AvailableFx = Extract<HistoricalChartFx, { status: 'AVAILABLE' }>;
export interface ChartFxReference {
  fx: AvailableFx;
  rateUnits: bigint;
  provenance: {
    kind: 'FILL_CAPTURE' | 'ARCHIVED_NEARBY_CAPTURE';
    sourceFillId: string;
    targetFillId: string;
    sourceFillTimestamp: string;
    sourceOffsetMs: number;
    originalReason?: string;
  };
}
function ownReference(fill: Trade): ChartFxReference | null {
  const fx = fill.sol_usd_fx;
  if (fx?.status !== 'AVAILABLE') return null;
  const parts = /^(\d+)(?:\.(\d{1,18}))?$/.exec(fx.rate);
  const time = Date.parse(fill.executed_at), observed = Date.parse(fx.fxAt);
  const target = Math.floor(time / 1000) * 1000;
  if (!parts || !Number.isFinite(time) || !Number.isFinite(observed) ||
    Date.parse(fx.requestedAt) !== target ||
    (fx.version === 'CAPTURED_EXECUTION_FX_V1' ? Math.abs(observed - time) > 5000 :
      observed < target || observed - target > 5000) ||
    (fx.fillTimestamp && Date.parse(fx.fillTimestamp) !== time)) return null;
  const rateUnits = BigInt(parts[1]!) * 10n ** 18n + BigInt((parts[2] ?? '').padEnd(18, '0'));
  if (rateUnits <= 0n) return null;
  return { fx, rateUnits, provenance: { kind: 'FILL_CAPTURE', sourceFillId: fill.id,
    targetFillId: fill.id, sourceFillTimestamp: fill.executed_at, sourceOffsetMs: observed - time } };
}

/** Read-only chart reference. Never changes a fill or relabels another fill's capture as its own. */
export function chartFxReference(fill: Trade, archive: readonly Trade[]):
  ChartFxReference | { reason: string } {
  if (fill.sol_usd_fx?.status === 'AVAILABLE')
    return ownReference(fill) ?? { reason: 'INVALID_HISTORICAL_FX' };
  const reason = fill.sol_usd_fx?.reason ?? 'HISTORICAL_FX_NOT_CAPTURED';
  const at = Date.parse(fill.executed_at);
  if (!fill.owner_user_id || !fill.competition_account_id || !Number.isFinite(at)) return { reason };
  const candidates: ChartFxReference[] = [];
  for (const donor of archive) {
    if (donor.id === fill.id || donor.owner_user_id !== fill.owner_user_id ||
      donor.competition_account_id !== fill.competition_account_id ||
      donor.hourly_round_id !== fill.hourly_round_id || donor.mint_address !== fill.mint_address) continue;
    const ref = ownReference(donor);
    if (!ref) continue;
    const fx = ref.fx, observed = Date.parse(fx.fxAt), retrieved = Date.parse(fx.retrievedAt);
    // The already-trusted captured-execution contract permits observations +/- five seconds.
    // Additionally require the original retrieval itself to be inside the recipient's window.
    if (fx.version !== 'CAPTURED_EXECUTION_FX_V1' || fx.source !== 'COINBASE_SOL_USD_LAST_TRADE' ||
      fx.feedId !== 'SOL-USD' || !fx.sourceObservationId || !/^\d+$/.test(fx.sourceObservationId) ||
      !fx.responseHash || !/^[a-f0-9]{64}$/.test(fx.responseHash) ||
      Date.parse(fx.fillTimestamp ?? '') !== Date.parse(donor.executed_at) ||
      !Number.isFinite(retrieved) || observed > retrieved + 1000 || retrieved - observed > 5000 ||
      Math.abs(observed - at) > 5000 || Math.abs(retrieved - at) > 5000) continue;
    candidates.push({ ...ref, provenance: { kind: 'ARCHIVED_NEARBY_CAPTURE',
      sourceFillId: donor.id, targetFillId: fill.id, sourceFillTimestamp: donor.executed_at,
      sourceOffsetMs: observed - at, originalReason: reason } });
  }
  const observations = new Map<string, string>();
  for (const candidate of candidates) {
    // Ticker and tape serialize the same trade with different precision/payload hashes.
    const id = candidate.fx.sourceObservationId!, signature = JSON.stringify([
      Date.parse(candidate.fx.fxAt), candidate.rateUnits.toString()]);
    if (observations.has(id) && observations.get(id) !== signature)
      return { reason: 'CONTRADICTORY_ARCHIVED_FX' };
    observations.set(id, signature);
  }
  candidates.sort((a, b) => Math.abs(a.provenance.sourceOffsetMs) - Math.abs(b.provenance.sourceOffsetMs) ||
    a.provenance.sourceFillId.localeCompare(b.provenance.sourceFillId));
  return candidates[0] ?? { reason };
}
