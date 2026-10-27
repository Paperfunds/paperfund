import { verifiedSmallProfile } from './bounded-profile.js';
import type { Evidence as OldEvidence } from '../../candidates/simple-price-v2/model.js';
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { quote, validateEvidence } from '../../candidates/simple-price-v2-directional/model.js';
import { quote as oldQuote } from '../../candidates/simple-price-v2/model.js';
import { ATOMIC_POLICY } from '../../providers/simple-price-v2-atomic/provider.js';
import { normalizeDirectional } from '../../providers/simple-price-v2-atomic/normalize.js';
import { cutoffTimeline, cutoffTimeWindow } from './diagnosis.js';
import { parseRecording, solRecordings, encode } from './fixtures.js';
import type { Capture } from '../../providers/simple-price-v2/provider.js';
const root = 'artifacts/simple-price-v2-blocker-review/';
it('genuine SOL original-time replay isolates fixed-cutoff ordering without changing provenance', () => {
  const path =
    'artifacts/simple-price-v2-cutoff-review/1792022493770-capture-1792022513663-captureSol.json';
  const c = parseRecording<Capture>(readFileSync(path, 'utf8')),
    e = c.evidence,
    cutoff = Date.parse('2026-10-15T00:00:00Z');
  const b = quote('BUY', 100000000n, e, e.identity, c.receivedAtMs, ATOMIC_POLICY);
  const normal = quote(
    'SELL',
    b.output,
    e,
    e.identity,
    c.receivedAtMs,
    ATOMIC_POLICY,
    undefined,
    b.output,
  );
  expect(normal.output).toBe(97374383n);
  expect(() =>
    quote('SELL', b.output, e, e.identity, cutoff, ATOMIC_POLICY, undefined, b.output),
  ).toThrow('STALE_OR_INVALID_EVIDENCE');
  expect(cutoffTimeWindow(cutoff, cutoff + 6001, ATOMIC_POLICY).possible).toBe(false);
  const timeline = cutoffTimeline(e, cutoff, ATOMIC_POLICY);
  expect(timeline.filter((t) => t.kind === 'TOKEN').every((t) => t.existingRuleRejects)).toBe(true);
  writeFileSync(
    root + 'cutoff-diagnosis.json',
    encode({
      path,
      cutoff,
      receivedAt: c.receivedAtMs,
      normal,
      rows: timeline,
      original00FailedCaptureAvailable: false,
      provenanceUnchanged: true,
    }),
  );
});
it('all three preserved SOL cases retain exact original quantities, fees and full/partial exits', () => {
  const expectedBuy = [5370987144392n, 36713303555594n, 38229114948436n],
    expectedSell = [959883623n, 894012175n, 892892057n];
  const results = solRecordings().map((c, index) => {
    const e = c.evidence,
      b = quote('BUY', 1000000000n, e, e.identity, c.receivedAtMs, ATOMIC_POLICY),
      prior = oldQuote(
        'BUY',
        1000000000n,
        e as OldEvidence,
        e.identity,
        c.receivedAtMs,
        ATOMIC_POLICY,
      );
    const full = quote(
        'SELL',
        b.output,
        e,
        e.identity,
        c.receivedAtMs,
        ATOMIC_POLICY,
        undefined,
        b.output,
      ),
      half = quote(
        'SELL',
        b.output / 2n,
        e,
        e.identity,
        c.receivedAtMs,
        ATOMIC_POLICY,
        undefined,
        b.output,
      );
    expect(b.output).toBe(expectedBuy[index]);
    expect(full.output).toBe(expectedSell[index]);
    const { modelVersion: ignored, ...rest } = b,
      { modelVersion: oldIgnored, ...oldRest } = prior;
    void ignored;
    void oldIgnored;
    expect(rest).toEqual(oldRest);
    expect(full.output).toBe(
      oldQuote(
        'SELL',
        b.output,
        e as OldEvidence,
        e.identity,
        c.receivedAtMs,
        ATOMIC_POLICY,
        undefined,
        b.output,
      ).output,
    );
    expect(half.output).toBe(
      oldQuote(
        'SELL',
        b.output / 2n,
        e as OldEvidence,
        e.identity,
        c.receivedAtMs,
        ATOMIC_POLICY,
        undefined,
        b.output,
      ).output,
    );
    return { label: c.label, b, full, half };
  });
  writeFileSync(root + 'sol-regressions.json', encode(results));
});
it('same-slot atomic GOOG evidence has genuine within-swap adaptive variation and exact size-specific fees', async () => {
  type Normalized = Awaited<ReturnType<typeof normalizeDirectional>>;
  const path = 'artifacts/simple-price-v2-atomic-review/atomic-read-only-comparisons.json';
  const d = parseRecording<{ review?: { diagnostic: Normalized } }[]>(readFileSync(path, 'utf8'));
  const original = d[1]!.review!.diagnostic,
    obs = original.references.map((r) => r.observation);
  expect(obs[0]!.native.slot).toBe(obs[1]!.native.slot);
  const at = Math.max(...obs.map((o) => Date.parse(o.sourceState.observedAt)));
  const normalized = await normalizeDirectional(obs, ATOMIC_POLICY, at, [
    100000000n,
    10000000n,
    250000000n,
  ]);
  const rows = normalized.references.map((r) => ({
    source: r.observation.native.source,
    slot: r.observation.native.slot,
    time: r.observation.native.observedAtMs,
    refs: r.refs.map((q) => ({
      side: q.side,
      input: q.sdk.input,
      fee: q.sdk.fee,
      output: q.sdk.output,
      rateMin: q.sdk.rateMin,
      rateMax: q.sdk.rateMax,
    })),
  }));
  for (const r of normalized.references) {
    const q = r.refs.find((q) => q.side === 'BUY' && q.input === 250000000n)!;
    expect(q.sdk.rateMin).toBe(1600n);
    expect(q.sdk.rateMax).toBe(1703n);
    expect(q.sdk.fee).toBe(q.bridge.lp);
    expect(q.sdk.output).toBe(q.bridge.output);
  }
  expect(() =>
    validateEvidence(normalized.evidence, normalized.evidence.identity, at, ATOMIC_POLICY),
  ).toThrow('VARIABLE_ADAPTIVE_FEE_RANGE');
  expect(rows[0]!.refs).toEqual(rows[1]!.refs);
  writeFileSync(
    root + 'goog-diagnosis.json',
    encode({
      path,
      at,
      rows,
      classification: 'WITHIN_SWAP_ADAPTIVE_TICK_GROUP_FEE_CHANGE_NOT_PROVIDER_DISAGREEMENT',
      exactFeeAppliesOnlyToQuotedInput: true,
      constantScheduleSupported: false,
      failedRehearsalCapturesNotArchived: true,
      archivedProfileMaxSol: '0.25, not the final 2 SOL profile',
    }),
  );
});

it('explicit smaller GOOG profile uses exact constant fees and rejects unsupported larger orders', async () => {
  type Normalized = Awaited<ReturnType<typeof normalizeDirectional>>;
  const path = 'artifacts/simple-price-v2-atomic-review/atomic-read-only-comparisons.json';
  const d = parseRecording<{ review?: { diagnostic: Normalized } }[]>(readFileSync(path, 'utf8'));
  const original = d[1]!.review!.diagnostic,
    obs = original.references.map((r) => r.observation),
    at = Math.max(...obs.map((o) => Date.parse(o.sourceState.observedAt)));
  const result = await verifiedSmallProfile(obs, ATOMIC_POLICY, at),
    e = result.normalized.evidence;
  for (const side of ['BUY', 'SELL'] as const)
    expect(e.directionalCosts![side].bridgeInputRate).toEqual({ n: 1600n, d: 1000000n });
  const b = quote('BUY', 100000000n, e, e.identity, at, ATOMIC_POLICY),
    exit = quote('SELL', b.output, e, e.identity, at, ATOMIC_POLICY, undefined, b.output);
  expect(b.output).toBe(original.references[0]!.refs[0]!.output);
  expect(exit.output).toBeGreaterThan(0n);
  expect(exit.output).toBeLessThan(100000000n);
  expect(() => quote('BUY', 250000000n, e, e.identity, at, ATOMIC_POLICY)).toThrow();
  expect(() =>
    quote('SELL', b.output * 3n, e, e.identity, at, ATOMIC_POLICY, undefined, b.output * 3n),
  ).toThrow();
  writeFileSync(
    root + 'bounded-profile.json',
    encode({
      source: path,
      at,
      profile: result.profile,
      referenceBudgets: result.referenceBudgets,
      curve: result.curve,
      buy: b,
      sell: exit,
      fullProfileStillRejected: true,
      productionActivated: false,
    }),
  );
});
