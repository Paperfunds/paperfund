import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fingerprint } from '../../candidates/simple-price-v2-directional/model.js';
const root = 'artifacts/simple-price-v2-cutoff-evidence-review/';
export interface Block {
  blockhash: string;
  previousBlockhash: string;
  parentSlot: number;
}
/** Provider-attested block consistency only, never a cryptographic inclusion proof for accounts. */
export function blockDecision(
  slot: number,
  rootSlot: number | null,
  confirmed: Block | null,
  finalized: Block | null,
) {
  if (
    !Number.isSafeInteger(slot) ||
    slot <= 0 ||
    (rootSlot !== null && (!Number.isSafeInteger(rootSlot) || rootSlot < 0))
  )
    return 'REVIEW_INVALID_FINALITY_FIELDS';
  if (
    [confirmed, finalized].some(
      (b) =>
        b &&
        (!b.blockhash ||
          !b.previousBlockhash ||
          !Number.isSafeInteger(b.parentSlot) ||
          b.parentSlot < 0 ||
          b.parentSlot >= slot),
    )
  )
    return 'REVIEW_INVALID_FINALITY_FIELDS';
  if (rootSlot === null || rootSlot < slot || !confirmed || !finalized)
    return 'REVIEW_FINALITY_UNAVAILABLE';
  if (
    confirmed.blockhash !== finalized.blockhash ||
    confirmed.previousBlockhash !== finalized.previousBlockhash ||
    confirmed.parentSlot !== finalized.parentSlot
  )
    return 'REVIEW_FORK_OR_PROVIDER_CONFLICT';
  return 'PROVIDER_ATTESTED_BLOCK_FINALIZED_ACCOUNT_INCLUSION_NOT_PROVEN';
}
export function cursorDecision(
  current: { slot: number; sourceMs: number },
  previous: { slot: number; sourceMs: number },
) {
  return current.slot < previous.slot || current.sourceMs < previous.sourceMs
    ? 'REVIEW_PROVIDER_REGRESSION'
    : 'ORDERED';
}
export function exactSlotMetadata(
  slot: number,
  confirmed: Block | null,
  refs: readonly { source: string; slot: number; finalized?: Block }[],
) {
  const same = refs.filter((r) => r.slot === slot && r.finalized);
  if (!confirmed || !same.length) return { decision: 'REVIEW_FINALITY_UNAVAILABLE', sources: [] };
  const decisions = same.map((r) => blockDecision(slot, slot, confirmed, r.finalized!));
  if (decisions.some((d) => d.startsWith('REVIEW')))
    return { decision: 'REVIEW_FORK_OR_PROVIDER_CONFLICT', sources: same.map((r) => r.source) };
  return {
    decision: 'PROVIDER_ATTESTED_EXACT_SLOT_FINALIZED_ACCOUNT_INCLUSION_NOT_PROVEN',
    sources: same.map((r) => r.source),
  };
}
function stats(xs: number[]) {
  const a = xs.filter(Number.isFinite).sort((a, b) => a - b);
  const p = (q: number) => (a.length ? a[Math.ceil(q * a.length) - 1] : null);
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
it('missing finality, forks and provider regressions remain REVIEW without changing account bytes', () => {
  const a = { blockhash: 'A', previousBlockhash: 'P', parentSlot: 99 };
  expect(blockDecision(NaN, 101, a, a)).toContain('REVIEW');
  expect(blockDecision(100, 101, { ...a, parentSlot: 100 }, a)).toContain('REVIEW');
  expect(blockDecision(100, null, a, a)).toContain('REVIEW');
  expect(blockDecision(100, 99, a, a)).toContain('REVIEW');
  expect(blockDecision(100, 101, a, null)).toContain('REVIEW');
  expect(blockDecision(100, 101, a, { ...a, blockhash: 'B' })).toContain('CONFLICT');
  expect(cursorDecision({ slot: 100, sourceMs: 2 }, { slot: 101, sourceMs: 1 })).toContain(
    'REGRESSION',
  );
  expect(cursorDecision({ slot: 101, sourceMs: 0 }, { slot: 100, sourceMs: 1 })).toContain(
    'REGRESSION',
  );
  expect(blockDecision(100, 101, a, a)).toContain('INCLUSION_NOT_PROVEN');
  expect(exactSlotMetadata(100, a, [{ source: 'b', slot: 101, finalized: a }]).decision).toContain(
    'REVIEW',
  );
  expect(exactSlotMetadata(100, a, [{ source: 'b', slot: 100, finalized: a }]).decision).toContain(
    'INCLUSION_NOT_PROVEN',
  );
  expect(
    exactSlotMetadata(100, a, [
      { source: 'a', slot: 100, finalized: a },
      { source: 'b', slot: 100, finalized: { ...a, blockhash: 'FORK' } },
    ]).decision,
  ).toContain('CONFLICT');
});
it('summarizes actual bounded observations, preserves raw evidence, and distinguishes measured bounds from missing proof', () => {
  const file = readdirSync(root)
    .filter((f) => f.endsWith('-observations.json'))
    .sort()
    .at(-1);
  if (!file) throw Error('BOUNDED_LIVE_RECORDING_REQUIRED');
  const bytes = readFileSync(root + file),
    x = JSON.parse(bytes.toString()) as {
      records: {
        round: number;
        market: string;
        source: string;
        slot?: number;
        sourceMs?: number;
        receivedMs: number;
        complete: boolean;
        raw?: { accounts?: Record<string, unknown>; normalizedState?: Record<string, unknown> };
      }[];
      finality: {
        source: string;
        slot: number;
        confirmed?: Block;
        finalized?: Block;
        lastBelowAt?: number;
        firstRootAt?: number;
        delayUpperMs: number | null;
      }[];
      providers: {
        source: string;
        disabled: string;
        roots: { at: number; slot: number }[];
        receipts: { status: number; latencyMs: number; method: string; receivedMs: number }[];
      }[];
      grouped: unknown;
      finalizedCaptures: { source: string; market: string; ageMs?: number }[];
      comparisons: { market: string; valid: boolean; reason?: string }[];
      endedAt: number;
    };
  const decisions = x.finality.map((f) => ({
    source: f.source,
    slot: f.slot,
    decision: blockDecision(
      f.slot,
      f.firstRootAt ? f.slot : null,
      f.confirmed ?? null,
      f.finalized ?? null,
    ),
    exactSlotAuthorizedMetadata: exactSlotMetadata(f.slot, f.confirmed ?? null, x.finality),
    delayUpperMs: f.delayUpperMs,
    pollBracketMs: f.firstRootAt && f.lastBelowAt ? f.firstRootAt - f.lastBelowAt : null,
  }));
  const pairs = x.records
    .filter((s) => s.source === 'solana')
    .map((a) => {
      const b = x.records.find(
        (b) => b.source === 'helius' && b.market === a.market && b.round === a.round,
      );
      return {
        market: a.market,
        round: a.round,
        slotDelta: b?.slot !== undefined && a.slot !== undefined ? b.slot - a.slot : null,
        sourceTimeDeltaMs:
          b?.sourceMs !== undefined && a.sourceMs !== undefined ? b.sourceMs - a.sourceMs : null,
        receiptDeltaMs: b ? b.receivedMs - a.receivedMs : null,
      };
    });
  const changes = [];
  for (const p of x.providers)
    for (const market of ['SOL', 'TUSD', 'GOOG']) {
      const a = x.records.filter((r) => r.source === p.source && r.market === market && r.complete),
        rows = [];
      const economic = (r: (typeof a)[number]) =>
        r.raw?.accounts
          ? fingerprint(
              Object.fromEntries(
                Object.entries(r.raw.accounts).filter(
                  ([k]) => k !== 'SysvarC1ock11111111111111111111111111111111',
                ),
              ),
            )
          : fingerprint(
              Object.fromEntries(
                Object.entries(r.raw?.normalizedState ?? {}).filter(([k]) =>
                  [
                    'baseReserves',
                    'effectiveQuoteReserves',
                    'lpFeeBps',
                    'protocolFeeBps',
                    'creatorFeeBps',
                  ].includes(k),
                ),
              ),
            );
      for (let i = 1; i < a.length; i++)
        rows.push({
          receiptGapMs: a[i]!.receivedMs - a[i - 1]!.receivedMs,
          bankTimeAdvanceMs: a[i]!.sourceMs! - a[i - 1]!.sourceMs!,
          slotAdvance: a[i]!.slot! - a[i - 1]!.slot!,
          economicBytesChanged: economic(a[i]!) !== economic(a[i - 1]!),
        });
      changes.push({
        source: p.source,
        market,
        observedChangeIntervals: rows,
        trueUpdateFrequencyKnown: false,
      });
    }
  const summary = {
    sourceFile: file,
    rawHash: fingerprint(bytes.toString()),
    groups: x.grouped,
    pairs,
    changes,
    decisions,
    finalityObserved: decisions.filter((d) => !d.decision.startsWith('REVIEW')).length,
    finalityUnresolved: decisions.filter((d) => d.decision.startsWith('REVIEW')).length,
    exactSlotAuthorizedCoverage: decisions.filter(
      (d) => !d.exactSlotAuthorizedMetadata.decision.startsWith('REVIEW'),
    ).length,
    rootPollDelayUpperMs: stats(
      decisions.flatMap((d) => (d.delayUpperMs === null ? [] : [d.delayUpperMs])),
    ),
    finalizedAccountAgeMs: stats(
      x.finalizedCaptures.flatMap((r) => (r.ageMs === undefined ? [] : [r.ageMs])),
    ),
    providers: x.providers.map((p) => ({
      source: p.source,
      disabled: p.disabled,
      totalRequests: p.receipts.length,
      successfulRequests: p.receipts.filter((r) => r.status === 200).length,
      rpcLatencyMs: stats(p.receipts.map((r) => r.latencyMs)),
      rootRegressions: p.roots.filter((r, i) => i > 0 && r.slot < p.roots[i - 1]!.slot),
      failures: p.receipts
        .filter((r) => r.status !== 200)
        .map((r) => ({
          status: r.status,
          method: r.method,
          at: r.receivedMs,
          recoveryObservation: 'NOT_RETRIED_AFTER_ACCESS_OR_RATE_REJECTION',
          unobservedRecoveryGapMs: x.endedAt - r.receivedMs,
        })),
    })),
    directionalFeeFxChecks: x.comparisons.map((c) => ({
      market: c.market,
      valid: c.valid,
      reason: c.reason,
    })),
    inclusionProof: false,
    utcClockQualification: false,
    recommendedPrivateTrial: {
      confirmedSourceAgeMs: 2000,
      activated: false,
      reason:
        'Observed maximum confirmed age 1340ms; 660ms sample-only headroom, requires active polling and holds; does not establish tail reliability',
    },
    finalityDecisionRequired:
      'Confirmed snapshot pending finality with unchanged raw bytes versus finalized-at-capture requiring a separately approved older source-age policy',
  };
  writeFileSync(
    root + 'measurement-summary-' + Date.now() + '.json',
    JSON.stringify(summary, null, 2),
    { flag: 'wx' },
  );
  expect(x.records).toHaveLength(24);
  expect(fingerprint(readFileSync(root + file).toString())).toBe(summary.rawHash);
});
