import { ATOMIC_POLICY } from '../../providers/simple-price-v2-atomic/provider.js';
export const REPLAY_POLICY = { ...ATOMIC_POLICY, version: 'CONTROLLED_ARCHIVED_TIME_REPLAY_V1' };
import { readFileSync } from 'node:fs';
import type { Evidence } from '../../candidates/simple-price-v2-directional/model.js';
import { snapshotHash, fingerprint } from '../../candidates/simple-price-v2-directional/model.js';
export const RECORDING = 'artifacts/simple-price-v2-provider-review/live-markets.json';
const numeric = new Set([
  'n',
  'd',
  'bps',
  'slot',
  'input',
  'output',
  'minInput',
  'maxInput',
  'lp',
  'protocol',
  'creator',
  'conversionFeePpm',
  'rateMin',
  'rateMax',
  'fee',
]);
export function parseRecording<T>(s: string): T {
  return JSON.parse(s, (k, v: unknown) =>
    v && typeof v === 'object' && '$bigint' in v
      ? BigInt((v as { $bigint: string }).$bigint)
      : numeric.has(k) && typeof v === 'string' && /^-?\d+$/.test(v)
        ? BigInt(v)
        : v,
  ) as T;
}
export function solRecordings() {
  return parseRecording<
    { label: string; capture?: { evidence: Evidence; receivedAtMs: number } }[]
  >(readFileSync(RECORDING, 'utf8'))
    .filter((r) => r.capture)
    .slice(0, 3)
    .map((r) => ({ label: r.label, ...r.capture! }));
}
/** Actual recorded prices, fee categories and executable quote amounts are unchanged.
 * Only chronology labels are mocked. This evidence can enter the disposable FIXTURE adapter only;
 * it is not an atomic mainnet capture and cannot be passed off as live price provenance.
 */
export function controlledReplay(original: Evidence, at: number): Evidence {
  const e = structuredClone(original);
  const observations = e.observations.map((o) => ({
    ...o,
    reference: 'CONTROLLED_TIME_REPLAY:' + o.reference,
    observedAtMs: at,
    slot: BigInt(at),
  }));
  const base = {
    ...e,
    observations,
    feeObservedAtMs: at,
    feeReference: fingerprint({ state: observations[0]!.reference, fees: e.fees }),
  };
  return {
    ...base,
    calibration: {
      ...e.calibration,
      quotes: e.calibration.quotes.map((q) => ({
        ...q,
        reference: 'CONTROLLED_TIME_REPLAY:' + q.reference,
        observedAtMs: at,
        slot: BigInt(at),
      })),
      snapshotHash: snapshotHash(base),
    },
  };
}
export const encode = (v: unknown) =>
  JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? x.toString() : x), 2);
