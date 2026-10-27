import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { AtomicMarketProvider, ATOMIC_POLICY } from './provider.js';
import { NON_SOL_SAMPLES } from '../simple-price-v2/non-sol.js';
import { quote } from '../../candidates/simple-price-v2-directional/model.js';
import type { Evidence } from '../../candidates/simple-price-v2-directional/model.js';
import { jupiterQuote, blockTime } from '../simple-price-v2/jupiter.js';
import { pack } from '../../integration/simple-price-v2-directional/adapter.js';
const root = 'artifacts/simple-price-v2-atomic-review/';
const run = Date.now();
const save = (name: string, v: unknown) =>
  writeFileSync(
    root + run + '-' + name,
    JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? x.toString() : x), 2),
  );
describe.skipIf(process.env['PAPERFUND_V2_ATOMIC_LIVE'] !== '1')(
  'authorized existing-provider atomic acquisition',
  () => {
    it('captures complete TUSD and GOOG snapshots and compares small independent all-in quotes', async () => {
      const provider = new AtomicMarketProvider(),
        rows: unknown[] = [];
      for (const s of [NON_SOL_SAMPLES[1], NON_SOL_SAMPLES[0]]) {
        const row: Record<string, unknown> = { ...s };
        try {
          const [capture, broker] = await Promise.all([
            provider.captureNonSol(s.mint),
            jupiterQuote(s.mint, 'BUY', 100000000n, false),
          ]);
          row['capture'] = capture;
          row['replay'] = pack(capture);
          row['brokerBuy'] = broker;
          row['brokerBuyTime'] = await blockTime(broker.contextSlot);
          const at = Date.now(),
            buy = quote(
              'BUY',
              100000000n,
              capture.evidence,
              capture.evidence.identity,
              at,
              ATOMIC_POLICY,
            ),
            sell = quote(
              'SELL',
              buy.output,
              capture.evidence,
              capture.evidence.identity,
              at,
              ATOMIC_POLICY,
            );
          row['buy'] = buy;
          row['sell'] = sell;
          const brokerSell = await jupiterQuote(s.mint, 'SELL', BigInt(broker.outAmount), false),
            exit = await provider.captureNonSol(s.mint);
          row['brokerSell'] = brokerSell;
          row['brokerSellTime'] = await blockTime(brokerSell.contextSlot);
          row['exitCapture'] = exit;
          row['sameInputCandidateSell'] = quote(
            'SELL',
            BigInt(broker.outAmount),
            exit.evidence,
            exit.evidence.identity,
            Date.now(),
            ATOMIC_POLICY,
          );
          expect(capture.observations.length).toBe(2);
          expect(
            capture.receipts.some(
              (r) =>
                r.upstream.includes('helius') &&
                r.request.method === 'getMultipleAccounts' &&
                (r.request.params[0] as unknown[]).length >= 20 &&
                r.status === 200,
            ),
          ).toBe(true);
          expect(sell.output).toBeLessThan(buy.input);
        } catch (error) {
          row['error'] = String(error);
          row['review'] = provider.reviews.get(s.mint);
          rows.push(row);
          save('atomic-read-only-comparisons.json', rows);
          if (
            s.mint !== NON_SOL_SAMPLES[0].mint ||
            String(error) !== 'Error: VARIABLE_ADAPTIVE_FEE_RANGE'
          )
            throw error;
          const diagnostic = provider.reviews.get(s.mint) as { diagnostic: { evidence: Evidence } };
          const c = diagnostic.diagnostic.evidence.directionalCosts!;
          expect([...c.BUY.proofs, ...c.SELL.proofs].some((p) => p.rateMin.n !== p.rateMax.n)).toBe(
            true,
          );
          continue;
        }
        rows.push(row);
        save('atomic-read-only-comparisons.json', rows);
      }
    }, 60000);
  },
);
it('preserved access evidence distinguishes provider rejection from invalid market contents', () => {
  const rows = JSON.parse(readFileSync(root + 'bounded-access-probes.json', 'utf8')) as {
    provider: string;
    accounts: number;
    status: number;
  }[];
  expect(rows.find((r) => r.provider === 'PUBLICNODE' && r.accounts === 1)?.status).toBe(200);
  expect(rows.find((r) => r.provider === 'PUBLICNODE' && r.accounts === 10)?.status).toBe(200);
  expect(rows.find((r) => r.provider === 'PUBLICNODE' && r.accounts === 20)?.status).toBe(403);
  expect(rows.find((r) => r.provider === 'EXISTING_HELIUS' && r.accounts === 20)?.status).toBe(200);
});
