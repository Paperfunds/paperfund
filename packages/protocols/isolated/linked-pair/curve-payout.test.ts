import { it, expect } from 'vitest';
import { curvePayoutSpec, controlledCurvePayoutInterval } from './curve-payout-fixtures.js';
import {
  mixedBank,
  controlledSolCurveBank,
  controlledMixedInterval,
  CURVE,
  CURVE_MINT,
} from './mixed-fixtures.js';
import { transitionExternalCurve, validatePumpCurve } from './pump-curve.js';
import { newLinkedBranch, reconcileLinkedInterval, digest } from './external-flow.js';
import { transitionLinkedSnapshot } from './native-transition.js';
it('controlled V2 SOL/token curve BUY, partial/full SELL pay fees once without growing retained V3 buckets and recover exactly', async () => {
  for (const s of [mixedBank(), controlledSolCurveBank()]) {
    let branch = newLinkedBranch('payout', 'r', s);
    branch.simulated = (
      await transitionLinkedSnapshot(branch.simulated, 10000000n, true, {
        nowMs: Date.parse(s.observedAt),
        maxAgeMs: 10000,
      })
    ).next;
    const original = Buffer.from(s.accounts[CURVE]!.base64, 'base64')
      .subarray(125, 141)
      .toString('hex');
    const buy = await curvePayoutSpec(s, true, 1000000000n),
      b = await controlledCurvePayoutInterval(s, buy);
    let r = await reconcileLinkedInterval(branch, b, Date.parse(b.after.observedAt), 10000);
    expect(r.events).toBe(1);
    branch = r.branch;
    let previous = b.blocks[0]!.result.transactions[0]!;
    for (const amount of [buy.amount / 3n, buy.amount - buy.amount / 3n]) {
      const spec = await curvePayoutSpec(branch.real, false, amount),
        e = await controlledCurvePayoutInterval(branch.real, spec, previous);
      r = await reconcileLinkedInterval(
        JSON.parse(JSON.stringify(branch)),
        e,
        Date.parse(e.after.observedAt),
        10000,
      );
      expect(r.events).toBe(1);
      branch = r.branch;
      previous = e.blocks[0]!.result.transactions[0]!;
      expect(
        (await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000)).replay,
      ).toBe(true);
    }
    expect(
      Buffer.from(branch.real.accounts[CURVE]!.base64, 'base64').subarray(125, 141).toString('hex'),
    ).toBe(original);
    expect(digest(branch.real)).not.toBe(digest(branch.simulated));
  }
});
it('V2 reconciliation preserves carried curve impact from preceding mixed hops and rejects a substituted fee destination', async () => {
  const e = await controlledMixedInterval(),
    branch = newLinkedBranch('mixed-v2', 'r', e.before);
  branch.simulated = (
    await transitionLinkedSnapshot(branch.simulated, 10000000n, true, {
      nowMs: Date.parse(e.before.observedAt),
      maxAgeMs: 10000,
    })
  ).next;
  const a = await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000),
    spec = await curvePayoutSpec(a.branch.real, true, 10000000n, false),
    next = await controlledCurvePayoutInterval(a.branch.real, spec),
    b = await reconcileLinkedInterval(a.branch, next, Date.parse(next.after.observedAt), 10000);
  expect(b.branch.simulated.accounts[CURVE]).not.toEqual(b.branch.real.accounts[CURVE]);
  await expect(
    transitionExternalCurve(
      a.branch.real,
      { ...spec, creatorRecipient: spec.protocolRecipient },
      { nowMs: Date.parse(a.branch.real.observedAt), maxAgeMs: 10000 },
    ),
  ).rejects.toThrow('FEE_DESTINATION_BINDING');
});
it('standalone completion leaves unspendable input with the payer; native multihop consumes its serialized remainder without invented base output', async () => {
  const s = mixedBank(),
    raw = Buffer.from(s.accounts[CURVE]!.base64, 'base64');
  raw.writeBigUInt64LE(1n, 24);
  s.accounts[CURVE] = { ...s.accounts[CURVE]!, base64: raw.toString('base64') };
  const spec = { ...(await curvePayoutSpec(s, true, 1n)), legacy: false },
    policy = { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 },
    exact = await transitionExternalCurve(s, spec, policy),
    budget = exact.input + 1n;
  const solo = await transitionExternalCurve(
      s,
      { ...spec, exactOutput: false, amount: budget, bound: 1n },
      policy,
    ),
    hop = await transitionExternalCurve(
      s,
      { ...spec, exactOutput: false, amount: budget, bound: 1n, completionMode: 'MULTI_HOP' },
      policy,
    );
  expect(solo.input).toBe(exact.input);
  expect(hop.input).toBe(budget);
  expect(solo.output).toBe(1n);
  expect(hop.output).toBe(1n);
  expect(Buffer.from(solo.next.accounts[CURVE]!.base64, 'base64').readBigUInt64LE(158)).toBe(0n);
  expect(Buffer.from(hop.next.accounts[CURVE]!.base64, 'base64').readBigUInt64LE(158)).toBe(1n);
  await expect(validatePumpCurve(solo.next, CURVE, CURVE_MINT, s.quoteMint)).rejects.toThrow(
    'COMPLETION_UNSUPPORTED',
  );
});
