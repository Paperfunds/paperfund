import { verifiedSmallProfile } from '../simple-price-v2-settlement/bounded-profile.js';
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { quote } from '../../candidates/simple-price-v2-directional/model.js';
import { ATOMIC_POLICY } from '../../providers/simple-price-v2-atomic/provider.js';
import type { normalizeDirectional } from '../../providers/simple-price-v2-atomic/normalize.js';
import { parseRecording, encode } from '../simple-price-v2-settlement/fixtures.js';
const root = 'artifacts/simple-price-v2-final-settlement-review/';
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
    root + 'bounded-profile-' + Date.now() + '.json',
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
