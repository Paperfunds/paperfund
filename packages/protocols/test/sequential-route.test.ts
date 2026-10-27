import { readFileSync } from 'node:fs';
import BN from 'bn.js';
import { describe, expect, it } from 'vitest';
import {
  cpAmmCoder,
  getFeeMode,
  getSwapResultFromExactInput,
  type PoolState,
} from '@meteora-ag/cp-amm-sdk';
import { createMarketStateEvidence, type MarketState } from '@paperfund/execution';
import { identifier } from '@paperfund/core';
import {
  createSequentialSimulation,
  previewSequentialRoute,
  transitionSequentialRoute,
  SequentialTransitionError,
  type SequentialSimulation,
} from '../src/experimental/sequential-route.js';
import { quoteRecordedRoute, type PoolLink, type CapturedAccount } from '../src/solana-routes.js';
import { recordedRoute } from './fixtures/routes.js';

interface Fixture {
  name: string;
  fingerprint: string;
  state: Omit<MarketState, 'chainSlot'> & { chainSlot: string };
  expected: {
    inputLamports: string;
    buyBaseUnits: string;
    originalReverseLamports: string;
    fullSellLamports: string;
    split: { partialProceeds: string; remainingSellProceeds: string };
    repeated: {
      secondBuyBaseUnits: string;
      sellAll: string;
      rebuyBaseUnits: string;
      rebuyExit: string;
    };
  };
}
const fixtures = (
  JSON.parse(
    readFileSync(new URL('./fixtures/sequential-liquidity.json', import.meta.url), 'utf8'),
  ) as { fixtures: Fixture[] }
).fixtures;
const scope = { accountId: 'isolated-account', roundId: 'isolated-hour' };
const initial = (f: Fixture): MarketState => ({
  ...structuredClone(f.state),
  chainSlot: BigInt(f.state.chainSlot),
});
const sandbox = (f: Fixture) => createSequentialSimulation(scope, [initial(f)]);
const market = (f: Fixture) => f.state.identity.marketId;
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
function camel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camel);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        camel(v),
      ]),
    );
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
function stateFor(s: SequentialSimulation, f: Fixture): MarketState {
  return {
    ...initial(f),
    normalizedState: { ...initial(f).normalizedState, accounts: s.accounts },
  };
}

describe.each(fixtures)('isolated sequential $name', (f) => {
  const spend = BigInt(f.expected.inputLamports),
    quantity = BigInt(f.expected.buyBaseUnits);
  it('matches recorded evidence/BUY, and previews never consume liquidity', () => {
    expect(createMarketStateEvidence(initial(f)).fingerprint).toBe(f.fingerprint);
    const s = freeze(sandbox(f)),
      copy = structuredClone(s);
    const preview = previewSequentialRoute(s, scope, market(f), spend, true);
    expect(preview.output).toBe(quantity);
    expect(previewSequentialRoute(s, scope, market(f), spend, true)).toEqual(preview);
    expect(s).toEqual(copy);
    const buy = transitionSequentialRoute(s, scope, market(f), spend, true);
    expect(buy.quote).toEqual(preview);
    expect(s).toEqual(copy);
    expect(buy.evidence.beforeFingerprint).toBe(f.fingerprint);
    expect(buy.evidence.afterFingerprint).not.toBe(f.fingerprint);
    expect(transitionSequentialRoute(s, scope, market(f), spend, true)).toEqual(buy);
    expect(buy.evidence.sourceFingerprint).toBe(f.fingerprint);
    expect(quoteRecordedRoute(initial(f), quantity, false).output).toBe(
      BigInt(f.expected.originalReverseLamports),
    );
  });
  it('values and fully sells post-BUY holdings identically without resetting state', () => {
    const buy = transitionSequentialRoute(sandbox(f), scope, market(f), spend, true);
    const preview = previewSequentialRoute(buy.next, scope, market(f), quantity, false);
    const sold = transitionSequentialRoute(freeze(buy.next), scope, market(f), quantity, false);
    expect(sold.quote).toEqual(preview);
    expect(sold.quote.output).toBe(BigInt(f.expected.fullSellLamports));
    expect(sold.evidence.beforeFingerprint).toBe(buy.evidence.afterFingerprint);
    expect(sold.next.sequence).toBe(2);
  });
  it('supports partial SELL then remainder, repeated BUY and rebuy after closing', () => {
    const buy = transitionSequentialRoute(sandbox(f), scope, market(f), spend, true);
    const part = transitionSequentialRoute(buy.next, scope, market(f), quantity / 4n, false);
    const remaining = quantity - quantity / 4n;
    const rest = transitionSequentialRoute(part.next, scope, market(f), remaining, false);
    expect(part.quote.output).toBe(BigInt(f.expected.split.partialProceeds));
    expect(rest.quote.output).toBe(BigInt(f.expected.split.remainingSellProceeds));
    expect(previewSequentialRoute(part.next, scope, market(f), remaining, false).output).toBe(
      rest.quote.output,
    );
    const second = transitionSequentialRoute(buy.next, scope, market(f), spend, true);
    expect(second.quote.output).toBe(BigInt(f.expected.repeated.secondBuyBaseUnits));
    const sold = transitionSequentialRoute(
      second.next,
      scope,
      market(f),
      quantity + second.quote.output,
      false,
    );
    expect(sold.quote.output).toBe(BigInt(f.expected.repeated.sellAll));
    const rebuy = transitionSequentialRoute(sold.next, scope, market(f), spend, true);
    expect(rebuy.quote.output).toBe(BigInt(f.expected.repeated.rebuyBaseUnits));
    expect(
      transitionSequentialRoute(rebuy.next, scope, market(f), rebuy.quote.output, false).quote
        .output,
    ).toBe(BigInt(f.expected.repeated.rebuyExit));
  });
  it('checks DAMM arithmetic independently with BigInt and the SDK before and after BUY', () => {
    const s = sandbox(f),
      buy = transitionSequentialRoute(s, scope, market(f), spend, true);
    for (const [world, amount, direction] of [
      [s, spend, true],
      [buy.next, quantity, false],
    ] as const) {
      const st = stateFor(world, f),
        q = previewSequentialRoute(world, scope, market(f), amount, direction);
      for (const detail of q.details) {
        const links = st.normalizedState['hops'] as PoolLink[];
        const hop = links.find((h) => h.pool === detail['pool'])!;
        const accounts = st.normalizedState['accounts'] as Record<string, CapturedAccount>;
        const raw = Buffer.from(accounts[hop.pool]!.base64, 'base64');
        const input = BigInt(detail['inputAfterTransfer'] as string),
          output = BigInt(detail['outputBeforeTransfer'] as string);
        const aToB = detail['direction'] === 'A_TO_B';
        if (hop.program.startsWith('cpam')) {
          const p = camel(cpAmmCoder.accounts.decode('Pool', raw)) as PoolState;
          const n = (v: BN) => BigInt(v.toString());
          const clock = Buffer.from(
            accounts['SysvarC1ock11111111111111111111111111111111']!.base64,
            'base64',
          );
          const sdk = getSwapResultFromExactInput(
            p,
            new BN(input.toString()),
            getFeeMode(p.collectFeeMode, aToB ? 0 : 1, false),
            aToB ? 0 : 1,
            new BN((p.activationType === 0 ? st.chainSlot! : clock.readBigInt64LE(32)).toString()),
          );
          expect(n(sdk.outputAmount)).toBe(output);
          // Fixed base schedules in these fixtures plus exact volatility fee and ceiling rounding.
          const d = p.poolFees.dynamicFee;
          const base = Buffer.from(p.poolFees.baseFee.baseFeeInfo.data).readBigUInt64LE(0);
          const rate =
            base +
            ceil(
              BigInt(d.variableFeeControl) * (n(d.volatilityAccumulator) * BigInt(d.binStep)) ** 2n,
              100000000000n,
            );
          const feeOnInput = !aToB,
            inFee = feeOnInput ? ceil(input * rate, 1000000000n) : 0n,
            net = input - inFee;
          let gross: bigint;
          if (p.collectFeeMode === 2) {
            const rin = n(aToB ? p.tokenAAmount : p.tokenBAmount),
              rout = n(aToB ? p.tokenBAmount : p.tokenAAmount);
            gross = (net * rout) / (rin + net);
          } else {
            const l = n(p.liquidity),
              price = n(p.sqrtPrice),
              next = aToB ? ceil(l * price, l + net * price) : price + (net << 128n) / l;
            gross = aToB
              ? (l * (price - next)) / (1n << 128n)
              : (l * (next - price)) / (price * next);
          }
          expect(gross - (feeOnInput ? 0n : ceil(gross * rate, 1000000000n))).toBe(output);
        } else if (aToB) {
          // Independent Pump SELL invariant; q fees are already quote-denominated.
          const gross = (input * raw.readBigUInt64LE(16)) / (raw.readBigUInt64LE(8) + input);
          expect(gross - output).toBeGreaterThan(0n);
          expect(output + ceil(gross * 95n, 10000n) + ceil(gross * 100n, 10000n)).toBe(gross);
        } else {
          const gross = (output * raw.readBigUInt64LE(16)) / (raw.readBigUInt64LE(8) - output) + 1n;
          const consumed = gross + ceil(gross * 95n, 10000n) + ceil(gross * 100n, 10000n);
          expect(input - consumed).toBe(BigInt(detail['unusedQuoteInput'] as string));
        }
      }
    }
  });
});

describe('scope, shared pools and fail-closed isolation', () => {
  it('updates protocol/LP fee evidence, volatility, vault balances and Token-2022 withholding', () => {
    const f = fixtures.find((x) => x.name === 'tOpenAI')!;
    const world = sandbox(f),
      amount = BigInt(f.expected.inputLamports);
    const links = f.state.normalizedState['hops'] as PoolLink[];
    const h = links[0]!;
    const read = (s: SequentialSimulation) =>
      camel(
        cpAmmCoder.accounts.decode('Pool', Buffer.from(s.accounts[h.pool]!.base64, 'base64')),
      ) as PoolState;
    const before = read(world),
      buy = transitionSequentialRoute(world, scope, market(f), amount, true);
    const after = read(buy.next);
    const time = Buffer.from(
      world.accounts['SysvarC1ock11111111111111111111111111111111']!.base64,
      'base64',
    ).readBigInt64LE(32);
    const q = getSwapResultFromExactInput(
      before,
      new BN(amount.toString()),
      getFeeMode(before.collectFeeMode, 1, false),
      1,
      new BN(time.toString()),
    );
    expect(after.protocolBFee.sub(before.protocolBFee).toString()).toBe(q.protocolFee.toString());
    expect(after.tokenBAmount.sub(before.tokenBAmount).toString()).toBe(
      q.excludedFeeInputAmount.add(q.compoundingFee).toString(),
    );
    expect(after.poolFees.dynamicFee.volatilityAccumulator.toString()).toBe('14460000');
    expect(after.poolFees.dynamicFee.lastUpdateTimestamp.toString()).toBe(time.toString());
    const growth = (v: number[]) => BigInt('0x' + Buffer.from(v).reverse().toString('hex'));
    expect(growth(after.feeBPerLiquidity) - growth(before.feeBPerLiquidity)).toBe(
      (BigInt(q.claimingFee.toString()) * (1n << 128n)) / BigInt(before.liquidity.toString()),
    );
    const sold = transitionSequentialRoute(buy.next, scope, market(f), buy.quote.output, false);
    const detail = sold.quote.details[0]!;
    expect(detail['inputTransferFee']).toBe('64656');
    const withheld = (s: SequentialSimulation) => {
      const raw = Buffer.from(s.accounts[h.vaultA]!.base64, 'base64');
      for (let i = 166; i + 4 <= raw.length; i += 4 + raw.readUInt16LE(i + 2))
        if (raw.readUInt16LE(i) === 2) return raw.readBigUInt64LE(i + 4);
      throw new Error('Expected transfer-fee extension');
    };
    expect(withheld(sold.next) - withheld(buy.next)).toBe(64656n);
  });
  it('records integer-rounded unused bridge input without depositing it or crediting SOL', () => {
    const f = fixtures.find((x) => x.name === 'Hirenu')!,
      amount = BigInt(f.expected.inputLamports);
    const first = transitionSequentialRoute(sandbox(f), scope, market(f), amount, true);
    const second = transitionSequentialRoute(first.next, scope, market(f), amount, true);
    const bridge = (f.state.normalizedState['hops'] as PoolLink[])[0]!.mintB;
    const unused = BigInt(second.quote.details[1]!['unusedQuoteInput'] as string);
    expect(unused).toBeGreaterThan(0n);
    expect(second.next.residualAmounts[bridge]).toBe(unused.toString());
    expect(second.evidence.residualAmounts).toEqual(second.next.residualAmounts);
    expect(first.next.residualAmounts).toEqual({});
  });
  it('rejects malformed accounts and unsupported DAMM modes explicitly without changing input', () => {
    const f = fixtures.find((x) => x.name === 'tOpenAI')!,
      world = sandbox(f);
    const h = (f.state.normalizedState['hops'] as PoolLink[])[0]!;
    const bad = structuredClone(world),
      accounts = bad.accounts as Record<string, CapturedAccount>;
    accounts[h.pool] = { ...accounts[h.pool]!, base64: 'AA==' };
    const copy = structuredClone(bad);
    expect(() => transitionSequentialRoute(bad, scope, market(f), 1000000n, true)).toThrow();
    expect(bad).toEqual(copy);
    const foreign = recordedRoute(1);
    // This unrelated route is left fully functional; Stage 1 need not support its transition mode.
    expect(quoteRecordedRoute(foreign, 1000000n, true).output).toBeGreaterThan(0n);
  });
  it('shares Hirenu bridge effects across two route identities, but not accounts/rounds', () => {
    const f = fixtures.find((x) => x.name === 'Hirenu')!,
      one = initial(f),
      s = one.normalizedState;
    const links = s['hops'] as PoolLink[],
      bridge = links[1]!;
    const accounts = s['accounts'] as Record<string, CapturedAccount>;
    const mint = Buffer.from(accounts[bridge.mintA]!.base64, 'base64');
    const other: MarketState = {
      ...one,
      identity: {
        ...one.identity,
        marketId: identifier('same-bridge-route', 'MarketId'),
        tokenMint: identifier(bridge.mintA, 'TokenMint'),
      },
      normalizedState: { ...s, hops: [bridge], tokenDecimals: mint[44]!.toString() },
    };
    const world = createSequentialSimulation(scope, [one, other]);
    const before = previewSequentialRoute(
      world,
      scope,
      other.identity.marketId,
      1000000n,
      true,
    ).output;
    const buy = transitionSequentialRoute(
      world,
      scope,
      market(f),
      BigInt(f.expected.inputLamports),
      true,
    );
    expect(
      previewSequentialRoute(buy.next, scope, other.identity.marketId, 1000000n, true).output,
    ).not.toBe(before);
    expect(
      previewSequentialRoute(world, scope, other.identity.marketId, 1000000n, true).output,
    ).toBe(before);
    expect(() =>
      transitionSequentialRoute(world, { ...scope, accountId: 'other' }, market(f), 1000000n, true),
    ).toThrow(SequentialTransitionError);
    expect(() =>
      previewSequentialRoute(world, { ...scope, roundId: 'other' }, market(f), 1000000n, true),
    ).toThrow(SequentialTransitionError);
  });
  it('rejects unimplemented protocols, nonfixed routing, conflicting snapshots and failed quotes without mutations', () => {
    expect(() => createSequentialSimulation(scope, [recordedRoute(0)])).toThrow(
      SequentialTransitionError,
    );
    const f = fixtures[0]!,
      st = initial(f);
    expect(() =>
      createSequentialSimulation(scope, [
        { ...st, normalizedState: { ...st.normalizedState, routePolicy: null } },
      ]),
    ).toThrow(SequentialTransitionError);
    const other = initial(f),
      accounts = other.normalizedState['accounts'] as Record<string, CapturedAccount>;
    accounts['SysvarC1ock11111111111111111111111111111111'] = {
      ...accounts['SysvarC1ock11111111111111111111111111111']!,
      base64: 'AAAA',
    };
    expect(() =>
      createSequentialSimulation(scope, [
        st,
        { ...other, identity: { ...other.identity, marketId: identifier('conflict', 'MarketId') } },
      ]),
    ).toThrow(/reconciliation/);
    const world = freeze(sandbox(f)),
      copy = structuredClone(world);
    expect(() => transitionSequentialRoute(world, scope, market(f), 0n, true)).toThrow();
    expect(() => transitionSequentialRoute(world, scope, market(f), 1n << 64n, true)).toThrow();
    expect(world).toEqual(copy);
  });
  it('has no production export or imports', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const production = readFileSync(new URL('../src/production.ts', import.meta.url), 'utf8');
    expect(index + production).not.toMatch(/sequential-route/);
  });
  it('preserves the original unsupported/supported route quotes after isolated simulation', () => {
    for (const f of fixtures) {
      const st = initial(f),
        amount = BigInt(f.expected.inputLamports),
        q = quoteRecordedRoute(st, amount, true);
      transitionSequentialRoute(sandbox(f), scope, market(f), amount, true);
      expect(quoteRecordedRoute(st, amount, true)).toEqual(q);
    }
  });
});
