import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { DirectionalMarketProvider } from './provider.js';
import { NON_SOL_SAMPLES } from '../simple-price-v2/non-sol.js';
import { jupiterQuote, blockTime } from '../simple-price-v2/jupiter.js';
import { quote as oldQuote } from '../../candidates/simple-price-v2/model.js';
import { quote, MODEL_VERSION } from '../../candidates/simple-price-v2-directional/model.js';
import { REAL_POLICY } from '../simple-price-v2/provider.js';
const save = (name: string, v: unknown) =>
  writeFileSync(
    'artifacts/simple-price-v2-directional-review/' + name,
    JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? x.toString() : x), 2),
  );
describe.skipIf(process.env['PAPERFUND_V2_DIRECTIONAL_LIVE'] !== '1')(
  'small read-only directional sample',
  () => {
    it('records fresh costs and failures, then independent all-in quotes without relabelling them as calibration', async () => {
      const provider = new DirectionalMarketProvider(),
        rows = [];
      for (const sample of NON_SOL_SAMPLES.slice(0, 2)) {
        const row: Record<string, unknown> = { ...sample };
        try {
          row['admitted'] = await provider.captureNonSol(sample.mint);
        } catch (error) {
          row['rejection'] = String(error);
        }
        row['review'] =
          provider.reviews.get(sample.mint) ?? provider.nonSol.reviews.get(sample.mint);
        const independent = [];
        for (const size of [100000000n, 1000000000n]) {
          try {
            const buy = await jupiterQuote(sample.mint, 'BUY', size, false),
              sell = await jupiterQuote(sample.mint, 'SELL', BigInt(buy.outAmount), false);
            independent.push({
              size,
              buy,
              sell,
              buyTime: await blockTime(buy.contextSlot),
              sellTime: await blockTime(sell.contextSlot),
            });
          } catch (error) {
            independent.push({ size, error: String(error) });
          }
        }
        row['independent'] = independent;
        rows.push(row);
        save('live-markets.json', rows);
      }
      expect(rows.length).toBe(2);
    }, 180000);
    it('retains exact fresh SOL reference results under the new candidate version', async () => {
      const provider = new DirectionalMarketProvider(),
        captured = await provider.captureSol('7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump'),
        e = captured.evidence,
        now = Date.now();
      const before = oldQuote('BUY', 1000000000n, e, e.identity, now, REAL_POLICY),
        after = quote('BUY', 1000000000n, e, e.identity, now, REAL_POLICY);
      expect(after).toEqual({ ...before, modelVersion: MODEL_VERSION });
      const sellBefore = oldQuote('SELL', before.output, e, e.identity, now, REAL_POLICY),
        sellAfter = quote('SELL', after.output, e, e.identity, now, REAL_POLICY);
      expect(sellAfter).toEqual({ ...sellBefore, modelVersion: MODEL_VERSION });
      save('sol-exact-regression.json', { captured, before, after, sellBefore, sellAfter });
    });
  },
);
