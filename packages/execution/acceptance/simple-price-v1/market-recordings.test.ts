import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { quote, replayFill } from '../../candidates/simple-price-v1/model.js';
import type { Fill } from '../../candidates/simple-price-v1/model.js';

interface AnalysisRow {
  label: string;
  amount: string;
  status: string;
  modeledBuy?: Fill;
  modeledSell?: Fill;
  nativeBuyFees?: { amount: { amount: string }; category: string }[];
  candidateOutput?: null;
  frozenPriorComparison?: {
    depthLamports: string;
    baseSpreadBps: string;
    buyOutput: string;
    sellOutput: string;
  } | null;
}
const data = JSON.parse(
  readFileSync(new URL('./recordings/2026-10-13-market-acceptance.json', import.meta.url), 'utf8'),
) as {
  analysis: { results: AnalysisRow[] };
  rawPublicCaptures: {
    records: {
      label: string;
      status?: string;
      recorded?: { side: string; input: string | null; output: string | null }[];
    }[];
  };
};
function restoreFill(fill: Fill): Fill {
  const keys = new Set([
    'n',
    'd',
    'slot',
    'bps',
    'amount',
    'input',
    'output',
    'gross',
    'requestedInput',
    'spreadLossLamports',
    'depthLamports',
    'baseSpreadBps',
    'maxDiscrepancyBps',
    'maxMovementBps',
  ]);
  return JSON.parse(JSON.stringify(fill), (k, v: unknown) =>
    keys.has(k) && typeof v === 'string' && /^[0-9]+$/.test(v) ? BigInt(v) : v,
  ) as Fill;
}
describe('expanded independently captured market records — review only', () => {
  for (const row of data.analysis.results.filter((r) => r.modeledBuy))
    it(`${row.label} / ${row.amount} — no duplicate fees, unchanged frozen parameters`, () => {
      const buy = restoreFill(row.modeledBuy!),
        sell = restoreFill(row.modeledSell!);
      expect(replayFill(buy)).toEqual(buy);
      expect(replayFill(sell)).toEqual(sell);
      expect(buy.evidence.quality.depthLamports).toBe(100_000_000_000n);
      expect(buy.evidence.quality.baseSpreadBps).toBe(10n);
      expect(buy.fees.map((f) => f.amount)).toEqual(
        row.nativeBuyFees!.map((f) => BigInt(f.amount.amount)),
      );
      expect(buy.input).toBe(buy.gross + buy.fees.reduce((sum, f) => sum + f.amount, 0n));
      expect(sell.output).toBe(sell.gross - sell.fees.reduce((sum, f) => sum + f.amount, 0n));
      expect(row.status).toMatch(
        /INCOHERENT_SNAPSHOT|STALE_OR_INVALID_EVIDENCE|QUOTE_STATE_SLOT_SKEW/,
      );
      if (row.frozenPriorComparison) {
        const e = structuredClone(buy.evidence);
        Object.assign(e.quality, {
          depthLamports: BigInt(row.frozenPriorComparison.depthLamports),
          baseSpreadBps: BigInt(row.frozenPriorComparison.baseSpreadBps),
        });
        expect(
          quote('BUY', buy.requestedInput, e, buy.identity, buy.executedAtMs, buy.policy).output,
        ).toBe(BigInt(row.frozenPriorComparison.buyOutput));
        expect(
          quote('SELL', sell.input, e, sell.identity, sell.executedAtMs, sell.policy).output,
        ).toBe(BigInt(row.frozenPriorComparison.sellOutput));
      }
    });
  it('does not invent candidate fills for the unsupported live non-SOL capture', () => {
    const rows = data.analysis.results.filter((r) => r.label === 'non-sol-pinky-djt-composed');
    expect(rows).toHaveLength(2);
    expect(
      rows.every((r) => r.status.startsWith('UNSUPPORTED') && r.candidateOutput === null),
    ).toBe(true);
  });
  it('preserves the recorded historical loss and rejects imaginary historical price substitution', () => {
    const r = data.rawPublicCaptures.records.find((r) => r.label === 'historical-BabyBaton')!;
    expect(r.status).toBe('UNSUPPORTED_INDEPENDENT_EXECUTION_TIME_PRICE_AND_COST_EVIDENCE');
    const buy = r.recorded!.find((f) => f.side === 'BUY')!,
      sell = r.recorded!.find((f) => f.side === 'SELL')!;
    expect(BigInt(sell.output!) - BigInt(buy.input!)).toBe(-949_125_915n);
  });
});
