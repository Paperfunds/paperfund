import { describe, it, expect } from 'vitest';
import { transitionLinkedLeg, transitionLinkedSnapshot } from './native-transition.js';
import { crossingFixture, decode, encodePool, oldEvidence } from './remaining-fixtures.js';
import { Stage1NonSolPumpSwap } from '../../src/experimental/non-sol-pump-swap.js';
import BN from 'bn.js';
const policy = (s: { observedAt: string }) => ({
  nowMs: Date.parse(s.observedAt),
  maxAgeMs: 10000,
});
const n = (x: BN) => BigInt(x.toString()),
  mask = (1n << 128n) - 1n;
describe.each([false, true])(
  'initialized crossing, dynamic=%s (controlled tick/reward metadata on retained reserves)',
  (dynamic) => {
    it('crosses down then up with native quotes, directional liquidity and wrapping fee/reward outside growth', async () => {
      const s = await crossingFixture(dynamic),
        before = decode(s),
        tick = before.ticks.find((a) => a.data?.startTickIndex === 0)!.data!.ticks[0]!,
        serialized = JSON.stringify(s);
      const down = await transitionLinkedLeg(s, 100000000000n, true, policy(s), 'BRIDGE'),
        post = decode(down.next),
        cross = decode(down.next, false).ticks.find((a) => a.data?.startTickIndex === 0)!.data!
          .ticks[0]!;
      expect(post.data.tickCurrentIndex).toBeLessThan(0);
      expect(n(post.data.liquidity)).toBe(n(before.data.liquidity) - n(tick.liquidityNet));
      expect(n(cross.feeGrowthOutsideB)).toBe((n(before.data.feeGrowthGlobalB) - 23n) & mask);
      expect(n(cross.feeGrowthOutsideA)).not.toBe(17n);
      const expectedReward = (n(before.data.rewardInfos[0]!.growthGlobalX64) + 95n) & mask;
      expect(n(post.data.rewardInfos[0]!.growthGlobalX64)).toBe(expectedReward);
      expect(n(cross.rewardGrowthsOutside[0]!)).toBe((expectedReward - 31n) & mask);
      expect(n(cross.rewardGrowthsOutside[1]!)).toBe(37n);
      expect(JSON.stringify(s)).toBe(serialized);
      const up = await transitionLinkedLeg(down.next, down.output, false, policy(s), 'BRIDGE'),
        last = decode(up.next, false),
        back = last.ticks.find((a) => a.data?.startTickIndex === 0)!.data!.ticks[0]!;
      expect(last.data.tickCurrentIndex).toBeGreaterThan(0);
      expect(n(last.data.liquidity)).toBe(n(before.data.liquidity));
      expect(n(back.rewardGrowthsOutside[0]!)).toBe(31n);
      expect(n(last.data.rewardInfos[0]!.growthGlobalX64)).toBe(expectedReward);
      expect(up.output).toBeLessThan(100000000000n);
      const again = await transitionLinkedLeg(down.next, 100000000n, true, policy(s), 'BRIDGE');
      expect(n(decode(again.next).data.liquidity)).toBe(n(post.data.liquidity));
    });
    it('continues native BUY, full valuation and partial/full SELL with active rewards', async () => {
      const s = await crossingFixture(dynamic);
      const buy = await transitionLinkedSnapshot(s, 100000000n, true, policy(s));
      const engine = new Stage1NonSolPumpSwap({
        purpose: 'READ_ONLY_STAGE1_VALIDATION',
        bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool },
      });
      const valuation = await engine.quote(buy.next, buy.quote.output, false, policy(s));
      const full = await transitionLinkedSnapshot(buy.next, buy.quote.output, false, policy(s));
      expect(full.quote.output).toBe(valuation.output);
      const part = await transitionLinkedSnapshot(
        buy.next,
        buy.quote.output / 3n,
        false,
        policy(s),
      );
      const rest = await transitionLinkedSnapshot(
        part.next,
        buy.quote.output - buy.quote.output / 3n,
        false,
        policy(s),
      );
      expect(part.quote.output + rest.quote.output).toBeLessThan(100000000n);
      expect(
        decode(rest.next).data.rewardInfos[0]!.growthGlobalX64.eq(
          decode(part.next).data.rewardInfos[0]!.growthGlobalX64,
        ),
      ).toBe(true);
    });
  },
);
it('rejects reward timestamp regression and leaves the predecessor untouched', async () => {
  const s = await crossingFixture(true),
    d = decode(s);
  d.data.rewardLastUpdatedTimestamp = new BN('18446744073709551615');
  await encodePool(s, d.data);
  const before = JSON.stringify(s);
  await expect(transitionLinkedSnapshot(s, 100000000n, true, policy(s))).rejects.toThrow(
    'REWARD_TIME_REGRESSION',
  );
  expect(JSON.stringify(s)).toBe(before);
});
it('preserves zero reward state in genuine retained external activity', () => {
  expect(
    decode(oldEvidence.before).data.rewardInfos.every(
      (r) => r.mint.toBase58() === '11111111111111111111111111111111',
    ),
  ).toBe(true);
});

it('halts reward growth when the native u128 product overflows, even if the quotient would fit', async () => {
  const s = await crossingFixture(true),
    d = decode(s);
  d.data.rewardInfos[0]!.emissionsPerSecondX64 = new BN(mask.toString());
  const prior = d.data.rewardInfos[0]!.growthGlobalX64.toString();
  await encodePool(s, d.data);
  const step = await transitionLinkedLeg(s, 100000000n, true, policy(s), 'BRIDGE');
  expect(decode(step.next).data.rewardInfos[0]!.growthGlobalX64.toString()).toBe(prior);
});
it('crosses a controlled zero-liquidity gap using captured initialized boundaries without accruing nonexistent rewards', async () => {
  const s = await crossingFixture(true, true, true),
    before = decode(s);
  expect(before.data.liquidity.isZero()).toBe(true);
  const step = await transitionLinkedLeg(s, 100000000n, true, policy(s), 'BRIDGE'),
    after = decode(step.next);
  expect(after.data.tickCurrentIndex).toBeLessThan(0);
  expect(after.data.liquidity.isZero()).toBe(false);
  expect(after.data.rewardInfos[0]!.growthGlobalX64.toString()).toBe(
    before.data.rewardInfos[0]!.growthGlobalX64.toString(),
  );
  expect(after.data.rewardLastUpdatedTimestamp.gt(before.data.rewardLastUpdatedTimestamp)).toBe(
    true,
  );
  expect(step.output).toBeGreaterThan(0n);
});
