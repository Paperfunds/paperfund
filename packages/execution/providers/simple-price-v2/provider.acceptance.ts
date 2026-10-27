import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from '@paperfund/protocols';
import {
  assertMintCosts,
  RealMarketProvider,
  REAL_POLICY,
  normalizeNative,
  ENDPOINTS,
} from './provider.js';
import { assertRealState } from './adapter.js';
import { pack } from '../../integration/simple-price-v2/adapter.js';
import type { MarketState } from '@paperfund/execution';
import { identifier, utcInstant } from '@paperfund/core';
import { PUMP_SWAP_PROTOCOL_ID } from '@paperfund/protocols';
import { jupiterRead, jupiterQuote, blockTime, verifyJupiter } from './jupiter.js';
import { quote, snapshotHash } from '../../candidates/simple-price-v2/model.js';
import { IsolatedHighWater } from '../../candidates/simple-price-v2/high-water.js';
import { inspectExistingRoute } from './routes.js';
export const REVIEW = 'artifacts/simple-price-v2-provider-review';
export const MARKETS = [
  { label: 'PumpSwap SOL', mint: '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump' },
  { label: 'moderate PumpSwap SOL', mint: '12PUFAUzgLj1onv3wSqX9ZagZBiaxofEjTd24CnQpump' },
  { label: 'thin historical PumpSwap', mint: '6FDw6jns8g7czuRucp5993RBNRPvqtMfv5Jv3hjnpump' },
  { label: 'established JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  { label: 'non-SOL PINKY', mint: '36sagUqFTtRexLToDforaTaWve4HdCuzH3EXNAtLwfUQ' },
  { label: 'composed NVDAx', mint: 'BsCrE8ZBoqwzv1Yix8uV6S7MmvmH6R7B5Nv3Su8CtmN3' },
  { label: 'problematic BabyBaton', mint: '48Fx5EWQ2RSUshqiNzx1VfWSvFwNgMft2nxbqwbXpump' },
];
export const errorCode = (error: unknown) =>
  error instanceof Error
    ? ('code' in error ? String(error.code) + ':' : '') + error.message
    : String(error);
export const save = (name: string, value: unknown) => {
  mkdirSync(REVIEW, { recursive: true });
  writeFileSync(
    join(REVIEW, name),
    JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );
};
describe('isolated real-provider boundary, offline', () => {
  // Explicit synthetic decoder-shaped boundary inputs. Never returned by RealMarketProvider.
  const state = (): MarketState => ({
    identity: {
      protocolId: PUMP_SWAP_PROTOCOL_ID,
      marketId: identifier('TEST_ONLY_POOL', 'MarketId'),
      tokenMint: identifier('TEST_ONLY_MINT', 'TokenMint'),
    },
    observedAt: utcInstant(1000000),
    chainSlot: 10n,
    chainBlockId: null,
    adapterVersion: 'TEST_ONLY',
    normalizationVersion: 'TEST_ONLY',
    normalizedState: {
      model: 'PUMP_SWAP_CANONICAL_POOL',
      quoteMint: WRAPPED_SOL_MINT,
      tokenDecimals: '6',
      lpFeeBps: '20',
      protocolFeeBps: '5',
      creatorFeeBps: '7',
      creatorFeeApplies: true,
      isMayhemMode: false,
      isCashbackCoin: false,
      disableFlags: '0',
      chainTime: new Date(1000000).toISOString(),
      effectiveQuoteReserves: '1000',
      baseReserves: '1000000',
    },
  });
  const mint = () => {
    const b = Buffer.alloc(82);
    b[45] = 1;
    return b;
  };
  it('admits standard initialized SPL and bare Token-2022 mints', () => {
    expect(() => assertMintCosts(SPL_TOKEN_PROGRAM_ID, mint())).not.toThrow();
    expect(() => assertMintCosts(TOKEN_2022_PROGRAM_ID, mint())).not.toThrow();
  });
  it('rejects unknown ownership, uninitialized or malformed mint evidence', () => {
    expect(() => assertMintCosts('fake', mint())).toThrow();
    expect(() => assertMintCosts(SPL_TOKEN_PROGRAM_ID, Buffer.alloc(82))).toThrow();
    expect(() => assertMintCosts(TOKEN_2022_PROGRAM_ID, Buffer.alloc(165))).toThrow();
  });
  it('rejects transfer fees and hooks instead of claiming fee-free base transfers', () => {
    for (const type of [1, 14]) {
      const b = Buffer.alloc(172);
      mint().copy(b);
      b[165] = 1;
      b.writeUInt16LE(type, 166);
      b.writeUInt16LE(2, 168);
      expect(() => assertMintCosts(TOKEN_2022_PROGRAM_ID, b)).toThrow('UNVERIFIED_TOKEN_COSTS');
    }
  });
  it('admits metadata-only extensions and rejects duplicate or truncated TLV', () => {
    const b = Buffer.alloc(172);
    mint().copy(b);
    b[165] = 1;
    b.writeUInt16LE(18, 166);
    b.writeUInt16LE(2, 168);
    expect(() => assertMintCosts(TOKEN_2022_PROGRAM_ID, b)).not.toThrow();
    b.writeUInt16LE(5, 168);
    expect(() => assertMintCosts(TOKEN_2022_PROGRAM_ID, b)).toThrow();
  });
  it('rejects wrong Jupiter mints, slots, amounts and charged platform fees', () => {
    const q = {
      inputMint: 'A',
      outputMint: 'B',
      inAmount: '1',
      outAmount: '2',
      swapMode: 'ExactIn',
      contextSlot: 1,
      platformFee: null,
      routePlan: [{ swapInfo: { ammKey: 'pool' } }],
    };
    expect(verifyJupiter(q, 'A', 'B', 1n)).toEqual(q);
    for (const patch of [
      { inputMint: 'X' },
      { inAmount: '2' },
      { contextSlot: 1.5 },
      { outAmount: '0' },
      { platformFee: { amount: '1' } },
    ])
      expect(() => verifyJupiter({ ...q, ...patch }, 'A', 'B', 1n)).toThrow();
  });
  it('normalizes current fee components and uses source Clock rather than response receipt time', () => {
    const a = state(),
      b = state(),
      e = normalizeNative([a, b], []);
    expect(e.fees.map((f) => f.bps)).toEqual([20n, 5n, 7n]);
    expect(e.observations[0]!.observedAtMs).toBe(1000000);
    expect(e.observations.map((o) => o.upstream)).toEqual([...ENDPOINTS]);
    expect(e.observations[0]!.price).toEqual({ n: 1000n, d: 1000000n });
  });
  it('rejects conflicting token, market and fee evidence before fitting', () => {
    const a = state();
    for (const patch of [
      { quoteMint: 'NON_SOL' },
      { lpFeeBps: '21' },
      { tokenDecimals: '9' },
      { isMayhemMode: true },
      { isCashbackCoin: true },
      { disableFlags: '16' },
    ])
      expect(() =>
        normalizeNative(
          [a, { ...state(), normalizedState: { ...state().normalizedState, ...patch } }],
          [],
        ),
      ).toThrow('UNVERIFIED_NATIVE_CONVENTION');
    expect(() =>
      normalizeNative(
        [
          a,
          {
            ...state(),
            identity: { ...state().identity, tokenMint: identifier('WRONG', 'TokenMint') },
          },
        ],
        [],
      ),
    ).toThrow();
  });
  it('rejects absent source time and refuses fixture provenance on the real adapter', () => {
    const s = state();
    expect(() =>
      normalizeNative(
        [s, { ...s, normalizedState: { ...s.normalizedState, chainTime: null } }],
        [],
      ),
    ).toThrow('SOURCE_TIME_UNAVAILABLE');
    expect(() =>
      assertRealState({
        ...s,
        normalizedState: {
          fixtureOnly: true,
          fixtureLabel: 'NOT_LIVE_EXECUTABLE_EVIDENCE',
          policy: pack(REAL_POLICY),
        },
      }),
    ).toThrow('REAL_PRICE_PROVENANCE_REQUIRED');
  });
});

describe.skipIf(process.env['PAPERFUND_V2_READ_ONLY_LIVE'] !== '1')(
  'read-only live mainnet capture; no financial database',
  () => {
    it('records supported and explicitly blocked markets, native costs and independent quotes', async () => {
      const provider = new RealMarketProvider(),
        rows: unknown[] = [];
      const recent = (await jupiterRead('tokens/v2/recent')) as {
        id: string;
        createdAt?: string;
        firstPool?: unknown;
      }[];
      const fresh = recent[0];
      if (fresh) MARKETS.push({ label: 'newly launched (discovery age only)', mint: fresh.id });
      save('recent-discovery.json', recent);
      for (const market of MARKETS) {
        const row: Record<string, unknown> = { ...market };
        try {
          const capture = await provider.capture(market.mint),
            e = capture.evidence;
          row['capture'] = capture;
          const path = join(mkdtempSync(join(tmpdir(), 'paperfund-simple-v2-real-')), 'authority');
          const high = new IsolatedHighWater(path, REAL_POLICY);
          await high.accept(e, Date.now());
          const buy = quote('BUY', 1000000000n, e, e.identity, Date.now(), REAL_POLICY);
          const sell = quote('SELL', buy.output, e, e.identity, Date.now(), REAL_POLICY);
          const half = quote(
            'SELL',
            buy.output / 2n,
            e,
            e.identity,
            Date.now(),
            REAL_POLICY,
            undefined,
            buy.output,
          );
          const rest = quote(
            'SELL',
            buy.output - buy.output / 2n,
            e,
            e.identity,
            Date.now(),
            REAL_POLICY,
            undefined,
            buy.output,
          );
          row['candidate'] = {
            buy,
            sell,
            partialNet: half.output + rest.output,
            splitDust: sell.output - half.output - rest.output,
          };
          let fragmented = 0n;
          const base = buy.output / 300n,
            rem = buy.output % 300n;
          for (let j = 0n; j < 300n; j++)
            fragmented += quote(
              'SELL',
              base + (j < rem ? 1n : 0n),
              e,
              e.identity,
              Date.now(),
              REAL_POLICY,
              undefined,
              buy.output,
            ).output;
          expect(fragmented).toBeLessThanOrEqual(sell.output);
          row['fragmentation300'] = {
            fullNet: sell.output,
            splitNet: fragmented,
            roundingLoss: sell.output - fragmented,
          };
          expect(() => quote('BUY', 3000000000n, e, e.identity, Date.now(), REAL_POLICY)).toThrow(
            'UNSUPPORTED_SIZE_RANGE',
          );
          expect(sell.output).toBeLessThan(buy.input);
          const reopened = new IsolatedHighWater(path, REAL_POLICY);
          await reopened.accept(e, Date.now());
          try {
            const stale = {
              ...structuredClone(e),
              observations: e.observations.map((o, index) =>
                index === 0 ? { ...o, slot: o.slot! - 1n } : o,
              ),
            };
            stale.calibration = { ...stale.calibration, snapshotHash: snapshotHash(stale) };
            await reopened.accept(stale, Date.now());
            throw new Error('REGRESSION_WAS_ACCEPTED');
          } catch (error) {
            row['regressionRejection'] = errorCode(error);
            expect(errorCode(error)).toBe('REGRESSING_EVIDENCE:REGRESSING_EVIDENCE');
          }
          const conflict = {
            ...e,
            observations: e.observations.map((o, index) =>
              index === 0 ? { ...o, price: { n: o.price.n * 2n, d: o.price.d } } : o,
            ),
          };
          await expect(reopened.accept(conflict, Date.now())).rejects.toThrow();
          await expect(reopened.accept(e, Date.now() + 10000)).rejects.toThrow(
            'STALE_OR_INVALID_EVIDENCE',
          );
          if (
            path !== reopened.directory ||
            !path.startsWith(join(tmpdir(), 'paperfund-simple-v2-real-'))
          )
            throw new Error('UNSAFE_TEST_CLEANUP');
          rmSync(path, { recursive: true }); // Verified exact owned temporary subdirectory.
        } catch (error) {
          row['candidateBlocked'] = errorCode(error);
          row['failedReceipts'] = provider.auditFailure();
          row['existingRouteDiagnostic'] = await inspectExistingRoute(market.mint);
        }
        try {
          const direct = !['non-SOL PINKY', 'composed NVDAx', 'problematic BabyBaton'].includes(
            market.label,
          );
          const buy = await jupiterQuote(market.mint, 'BUY', 1000000000n, direct),
            buyTime = await blockTime(buy.contextSlot);
          const coherent = await provider
            .capture(market.mint)
            .catch((error) => ({ blocked: errorCode(error) }));
          const sell = await jupiterQuote(market.mint, 'SELL', BigInt(buy.outAmount), direct),
            sellTime = await blockTime(sell.contextSlot);
          row['jupiter'] = { buy, buyTime, sell, sellTime };
          if ('evidence' in coherent) {
            const e = coherent.evidence,
              now = Date.now();
            try {
              const cb = quote('BUY', 1000000000n, e, e.identity, now, REAL_POLICY),
                cs = quote('SELL', BigInt(buy.outAmount), e, e.identity, now, REAL_POLICY);
              const buyError = cb.output - BigInt(buy.outAmount),
                sellError = cs.output - BigInt(sell.outAmount);
              const skew =
                Math.max(buyTime, sellTime, ...e.observations.map((o) => o.observedAtMs)) -
                Math.min(buyTime, sellTime, ...e.observations.map((o) => o.observedAtMs));
              const samePool =
                buy.routePlan.length === 1 &&
                sell.routePlan.length === 1 &&
                buy.routePlan[0]?.swapInfo.ammKey === e.identity.market &&
                sell.routePlan[0]?.swapInfo.ammKey === e.identity.market;
              row['independentComparison'] = {
                candidateBuy: cb.output,
                jupiterBuy: BigInt(buy.outAmount),
                buyErrorBps: ((cb.output - BigInt(buy.outAmount)) * 10000n) / BigInt(buy.outAmount),
                candidateSell: cs.output,
                jupiterSell: BigInt(sell.outAmount),
                sellErrorBps:
                  ((cs.output - BigInt(sell.outAmount)) * 10000n) / BigInt(sell.outAmount),
                exactBuyErrorBaseUnits: buyError,
                exactSellErrorLamports: sellError,
                withinOneBasisPoint:
                  (buyError < 0n ? -buyError : buyError) * 10000n <= BigInt(buy.outAmount) &&
                  (sellError < 0n ? -sellError : sellError) * 10000n <= BigInt(sell.outAmount),
                comparisonStatus:
                  samePool && skew <= REAL_POLICY.maxSkewMs
                    ? 'SAME_POOL_TIME_COHERENT_DIAGNOSTIC'
                    : 'UNVERIFIED_ROUTE_OR_TIME',
                maxTimeSkewMs:
                  Math.max(buyTime, sellTime, ...e.observations.map((o) => o.observedAtMs)) -
                  Math.min(buyTime, sellTime, ...e.observations.map((o) => o.observedAtMs)),
                samePool:
                  buy.routePlan.length === 1 &&
                  sell.routePlan.length === 1 &&
                  buy.routePlan[0]?.swapInfo.ammKey === e.identity.market &&
                  sell.routePlan[0]?.swapInfo.ammKey === e.identity.market,
                capture: coherent,
              };
            } catch (error) {
              row['independentComparisonBlocked'] = errorCode(error);
            }
          } else row['independentComparisonBlocked'] = coherent;
        } catch (error) {
          row['jupiterBlocked'] = errorCode(error);
        }
        rows.push(row);
        save('live-markets.json', rows);
      }
      expect(rows.length).toBeGreaterThanOrEqual(7);
      save(
        'price-diagnostics.json',
        await jupiterRead(
          'price/v3?ids=' + WRAPPED_SOL_MINT + ',' + MARKETS.map((m) => m.mint).join(','),
        ),
      );
    }, 180000);
  },
);
