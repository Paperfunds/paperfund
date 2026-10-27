import { it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { quote } from '../../candidates/simple-price-v2-directional/model.js';
import { ATOMIC_POLICY } from '../simple-price-v2-atomic/provider.js';
import type { Capture } from '../simple-price-v2/provider.js';

it('replays genuine fresh SOL evidence at its own time, but rejects a cutoff execution timestamp more than one second earlier', () => {
  const root = 'artifacts/simple-price-v2-cutoff-review/';
  const name = readdirSync(root)
    .filter((n) => n.endsWith('-captureSol.json'))
    .sort()
    .at(-1);
  if (!name) throw Error('REAL_CAPTURE_REQUIRED');
  const c = JSON.parse(readFileSync(root + name, 'utf8'), (key, value: unknown) =>
    ['n', 'd', 'slot', 'chainSlot', 'input', 'output', 'bps'].includes(key) &&
    typeof value === 'string' &&
    /^\d+$/.test(value)
      ? BigInt(value)
      : value,
  ) as Capture;
  const e = c.evidence,
    at = c.receivedAtMs;
  const cutoff = Math.floor(at / 3600000) * 3600000;
  expect(Math.min(...e.observations.map((o) => o.observedAtMs)) - cutoff).toBeGreaterThan(
    ATOMIC_POLICY.maxFutureMs,
  );
  const buy = quote('BUY', 100000000n, e, e.identity, at, ATOMIC_POLICY);
  const normal = quote('SELL', buy.output, e, e.identity, at, ATOMIC_POLICY, undefined, buy.output);
  expect(normal.output).toBeGreaterThan(0n);
  expect(() =>
    quote('SELL', buy.output, e, e.identity, cutoff, ATOMIC_POLICY, undefined, buy.output),
  ).toThrow('STALE_OR_INVALID_EVIDENCE');
  writeFileSync(
    root + 'timestamp-contract-diagnostic.json',
    JSON.stringify(
      {
        source: name,
        originalReceivedAt: new Date(at).toISOString(),
        frozenCutoff: new Date(cutoff).toISOString(),
        observationTimes: e.observations.map((o) => new Date(o.observedAtMs).toISOString()),
        normalSell: normal.output.toString(),
        frozenCutoffResult: 'STALE_OR_INVALID_EVIDENCE',
        conclusion:
          'Existing forced settlement passes endsAtExclusive as executedAt; fresh post-cutoff evidence violates the candidate one-second future allowance. Retry wall time does not change the forced execution timestamp.',
        replayOnly: true,
        freshAuthorityGranted: false,
      },
      null,
      2,
    ),
  );
});
