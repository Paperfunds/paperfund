import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { PumpSwapProtocolAdapter } from '@paperfund/protocols';
import type { MarketState } from '@paperfund/execution';
import { quote } from './model.js';
import type { Evidence, Policy } from './model.js';

interface RecordedRow {
  input: string;
  buyQuote: { receivedAt: string; quote: { outAmount: string } };
  sellQuote: { quote: { outAmount: string } };
  currentBuy: { input: string; output: string };
  currentSell: { input: string; output: string };
  candidateBuy: { input: string; output: string };
  candidateSell: { input: string; output: string };
}
interface RecordedMarket {
  pool: { name: string };
  state: MarketState;
  calibration: Evidence;
  rows: RecordedRow[];
}
const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/2026-10-13-pumpswap-quotes.json', import.meta.url), 'utf8'),
) as { policy: Policy; records: RecordedMarket[] };
function restore<T>(value: T): T {
  const keys = new Set([
    'n',
    'd',
    'slot',
    'chainSlot',
    'bps',
    'depthLamports',
    'baseSpreadBps',
    'maxDiscrepancyBps',
    'maxMovementBps',
  ]);
  return JSON.parse(JSON.stringify(value), (key, v: unknown) =>
    keys.has(key) && typeof v === 'string' && /^[0-9]+$/.test(v) ? BigInt(v) : v,
  ) as T;
}
describe('recorded independent Jupiter quote evaluation (no network)', () => {
  for (const raw of recorded.records) {
    const state = restore(raw.state),
      evidence = restore(raw.calibration),
      policy = restore(recorded.policy);
    const adapter = new PumpSwapProtocolAdapter({ loadMarketState: async () => state });
    for (const row of raw.rows)
      it(`${raw.pool.name} ${row.input} lamports: old engine and held-out candidate against public executable quote`, async () => {
        const requested = BigInt(row.input),
          externalToken = BigInt(row.buyQuote.quote.outAmount);
        const executedAt = utcInstant(state.observedAt);
        const currentBuy = await adapter.simulateBuy(
          {
            identity: state.identity,
            orderId: identifier('replay-b', 'OrderId'),
            executionId: identifier('replay-b-fill', 'ExecutionId'),
            requestedPaperSol: paperSolBaseUnits(requested),
            executedAt,
          },
          state,
        );
        const currentSell = await adapter.simulateSell(
          {
            identity: state.identity,
            orderId: identifier('replay-s', 'OrderId'),
            executionId: identifier('replay-s-fill', 'ExecutionId'),
            requestedTokenQuantity: tokenBaseUnits(externalToken),
            executedAt,
          },
          state,
        );
        expect(currentBuy.actualOutput.amount).toBe(BigInt(row.currentBuy.output));
        expect(currentSell.actualOutput.amount).toBe(BigInt(row.currentSell.output));
        const buy = quote(
          'BUY',
          requested,
          evidence,
          evidence.identity,
          Date.parse(row.buyQuote.receivedAt),
          policy,
        );
        const sell = quote(
          'SELL',
          externalToken,
          evidence,
          evidence.identity,
          Date.parse(row.buyQuote.receivedAt),
          policy,
        );
        expect(buy.output).toBe(BigInt(row.candidateBuy.output));
        expect(sell.output).toBe(BigInt(row.candidateSell.output));
        // Evaluation envelope for these samples only, not a universal production tolerance.
        for (const [candidate, reference] of [
          [buy.output, externalToken],
          [sell.output, BigInt(row.sellQuote.quote.outAmount)],
        ]) {
          const delta = candidate! > reference! ? candidate! - reference! : reference! - candidate!;
          expect(delta * 1_000_000n).toBeLessThanOrEqual(reference! * 50n);
        }
      });
  }
});
