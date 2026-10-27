import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { WRAPPED_SOL_MINT } from '@paperfund/protocols';
import { AtomicMarketProvider, ATOMIC_POLICY } from './provider.js';
import { NON_SOL_SAMPLES } from '../simple-price-v2/non-sol.js';
import { jupiterRead, verifyJupiter, blockTime } from '../simple-price-v2/jupiter.js';
import { quote } from '../../candidates/simple-price-v2-directional/model.js';
const run = Date.now();
describe.skipIf(process.env['PAPERFUND_V2_ATOMIC_LIVE'] !== '1')(
  'small independent restricted-venue quote comparison',
  () => {
    it('records exact route, slot, time and input equality without assuming broker authority', async () => {
      const p = new AtomicMarketProvider(),
        rows: unknown[] = [];
      for (const sample of [NON_SOL_SAMPLES[1], NON_SOL_SAMPLES[0]]) {
        const row: Record<string, unknown> = { ...sample };
        let tokenInput = 0n;
        for (const side of ['BUY', 'SELL'] as const) {
          const input = side === 'BUY' ? 100000000n : tokenInput;
          if (input <= 0n) break;
          const inputMint = side === 'BUY' ? WRAPPED_SOL_MINT : sample.mint,
            outputMint = side === 'BUY' ? sample.mint : WRAPPED_SOL_MINT;
          const q = verifyJupiter(
            await jupiterRead(
              'swap/v1/quote?' +
                new URLSearchParams({
                  inputMint,
                  outputMint,
                  amount: input.toString(),
                  swapMode: 'ExactIn',
                  slippageBps: '0',
                  onlyDirectRoutes: 'false',
                  dexes: 'Pump.fun Amm,Whirlpool',
                }),
            ),
            inputMint,
            outputMint,
            input,
          );
          if (side === 'BUY') tokenInput = BigInt(q.outAmount);
          const quoteTime = await blockTime(q.contextSlot);
          try {
            const c = await p.captureNonSol(sample.mint),
              e = c.evidence,
              fill = quote(side, input, e, e.identity, Date.now(), ATOMIC_POLICY),
              target = [e.identity.market, e.directionalCosts!.route[1]],
              actual = [...new Set(q.routePlan.map((r) => r.swapInfo.ammKey))],
              sameRoute = actual.length === 2 && actual.every((x) => target.includes(x));
            const timeSkewMs = Math.max(
                ...e.observations.map((o) => Math.abs(o.observedAtMs - quoteTime)),
              ),
              slotSkew = e.observations.reduce((a, o) => {
                const d = o.slot! - BigInt(q.contextSlot),
                  n = d < 0n ? -d : d;
                return n > a ? n : a;
              }, 0n),
              delta = fill.output - BigInt(q.outAmount);
            row[side] = {
              broker: q,
              quoteTime,
              candidate: fill,
              receipts: c.receipts,
              sameRoute,
              timeSkewMs,
              slotSkew,
              withinComparisonWindow:
                timeSkewMs <= ATOMIC_POLICY.maxSkewMs && slotSkew <= ATOMIC_POLICY.maxQuoteSlotSkew,
              delta,
              errorNanoBps: (delta * 10000000000000n) / BigInt(q.outAmount),
            };
          } catch (error) {
            row[side] = {
              broker: q,
              quoteTime,
              admission: String(error),
              review: p.reviews.get(sample.mint),
            };
          }
        }
        rows.push(row);
        writeFileSync(
          'artifacts/simple-price-v2-atomic-review/independent-quotes-' + run + '.json',
          JSON.stringify(rows, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
        );
      }
      expect(rows.length).toBe(2);
    }, 60000);
  },
);
