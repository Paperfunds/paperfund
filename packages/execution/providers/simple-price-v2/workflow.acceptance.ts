import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { reconcileAccountLedger, replayPersistedFill } from '@paperfund/db';
import { LiveHarness } from './live-harness.js';
import { settlePrivate } from '../../integration/simple-price-v2/settlement.js';
import { unpack } from '../../integration/simple-price-v2/adapter.js';
import type { Fill } from '../../candidates/simple-price-v2/model.js';
const h = new LiveHarness(),
  notes: Record<string, unknown> = {};
const mint = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const ok = (r: { statusCode: number; body: string }) => expect(r.statusCode, r.body).toBe(200);
async function balance(accountId: string) {
  const r = await reconcileAccountLedger(h.database, accountId);
  expect(r.reconciled).toBe(true);
  expect(r.balancedJournalCount).toBe(r.journalCount);
  expect(r.cashFromLedgerLamports).toBe(r.materializedCashLamports);
  expect(r.quantityFromFills).toBe(r.materializedQuantity);
  return r;
}
describe.skipIf(process.env['PAPERFUND_V2_READ_ONLY_LIVE'] !== '1')(
  'real reads through disposable original API/accounting',
  () => {
    beforeAll(() => h.start(), 60000);
    afterAll(async () => {
      mkdirSync('artifacts/simple-price-v2-provider-review', { recursive: true });
      writeFileSync(
        'artifacts/simple-price-v2-provider-review/live-api-numerical.json',
        JSON.stringify(notes, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
      );
      await h.close();
    }, 30000);
    it('fresh BUY, replay, valuation, partial exit, SELL ALL and balanced ledgers', async () => {
      await h.round();
      const i = await h.register(mint),
        u = await h.user();
      const b = await h.buy(u, i, '1', 'real-buy-replay');
      ok(b);
      const replay = await h.buy(u, i, '1', 'real-buy-replay');
      ok(replay);
      expect(replay.json().fillId).toBe(b.json().fillId);
      const view = await h.positions(u);
      ok(view);
      const q = BigInt(b.json().tokenQuantityReceivedBaseUnits);
      const half = await h.sell(u, i, (q / 2n).toString());
      ok(half);
      const rest = await h.sell(u, i);
      ok(rest);
      const fill = (
        await h.database.pool.query('select fee_breakdown from fills where id=$1', [
          b.json().fillId,
        ])
      ).rows[0];
      const audit = unpack<Fill>(fill.fee_breakdown.executionDetails.candidateReplayEnvelope);
      expect(audit.evidence.observations[0]!.upstream).toBe('https://api.mainnet-beta.solana.com');
      expect((await replayPersistedFill(h.database, h.router, b.json().fillId)).matched).toBe(true);
      notes['partialExit'] = {
        buy: b.json(),
        view: view.json(),
        half: half.json(),
        rest: rest.json(),
        buyCosts: audit.costs,
        fees: audit.fees,
        reconciliation: await balance(u.accountId),
      };
    });
    it('immediate BUY/SELL ALL and repeated BUYs use current evidence', async () => {
      const i = h.markets.get(mint)!,
        u = await h.user();
      const b = await h.buy(u, i);
      ok(b);
      const s = await h.sell(u, i);
      ok(s);
      expect(BigInt(s.json().paperSolCreditedLamports)).toBeLessThan(1000000000n);
      const a = await h.buy(u, i, '1');
      ok(a);
      const c = await h.buy(u, i, '0.5');
      ok(c);
      const end = await h.sell(u, i);
      ok(end);
      notes['roundTripAndRepeated'] = {
        buy: b.json(),
        sell: s.json(),
        repeatFirst: a.json(),
        repeatSecond: c.json(),
        repeatExit: end.json(),
        reconciliation: await balance(u.accountId),
      };
    });
    it('cross-token native source isolation, BUY cap and rapid idempotent concurrent requests', async () => {
      const i = await h.register('12PUFAUzgLj1onv3wSqX9ZagZBiaxofEjTd24CnQpump'),
        u = await h.user();
      const cap = await h.buy(u, i, '2.1');
      expect(cap.statusCode).toBe(409);
      const replies = await Promise.all([
        h.buy(u, i, '1', 'rapid-real'),
        h.buy(u, i, '1', 'rapid-real'),
      ]);
      replies.forEach(ok);
      expect(replies[0]!.json().fillId).toBe(replies[1]!.json().fillId);
      ok(await h.sell(u, i));
      notes['rapid'] = {
        responses: replies.map((r) => r.json()),
        reconciliation: await balance(u.accountId),
      };
    });
    it('read-provider outage cannot debit; recovery fetches fresh data', async () => {
      const i = h.markets.get(mint)!,
        u = await h.user(),
        before = await balance(u.accountId),
        original = globalThis.fetch;
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        if (String(url).includes('solana.com') || String(url).includes('publicnode.com'))
          throw new Error('PRIVATE_OUTAGE_TEST');
        return original(url, init);
      });
      try {
        const failed = await h.buy(u, i);
        expect(failed.statusCode).toBeGreaterThanOrEqual(400);
        expect((await balance(u.accountId)).materializedCashLamports).toBe(
          before.materializedCashLamports,
        );
        notes['outage'] = { status: failed.statusCode, body: failed.json() };
      } finally {
        spy.mockRestore();
      }
      ok(await h.buy(u, i));
      ok(await h.sell(u, i));
      await balance(u.accountId);
    });
    it('future cutoff cannot relabel current prices as future evidence; retries reach review hold', async () => {
      const i = h.markets.get(mint)!,
        u = await h.user();
      ok(await h.buy(u, i));
      const row = (
          await h.database.pool.query(
            "select id,ends_at_exclusive from hourly_rounds where state='OPEN' order by starts_at desc limit 1",
          )
        ).rows[0],
        round = row.id;
      const cutoff = new Date(row.ends_at_exclusive),
        before = await balance(u.accountId);
      const result = await settlePrivate(h.database, h.router, round, cutoff);
      expect(result.status).toBe('RETRY_PENDING');
      const second = await settlePrivate(h.database, h.router, round, cutoff);
      const third = await settlePrivate(h.database, h.router, round, cutoff);
      expect(third.status).toBe('REVIEW_REQUIRED');
      const again = await settlePrivate(h.database, h.router, round, cutoff);
      expect(again.status).toBe('REVIEW_REQUIRED');
      expect((await balance(u.accountId)).journalCount).toBe(before.journalCount);
      notes['settlement'] = {
        clockScope: 'ACCOUNTING_CUTOFF_ONLY; market timestamps remain real',
        result,
        second,
        third,
        again,
        reconciliation: before,
      };
    });
  },
);
