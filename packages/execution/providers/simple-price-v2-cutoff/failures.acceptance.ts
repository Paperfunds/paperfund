import { it, expect, vi } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { AtomicHarness } from '../simple-price-v2-atomic/live-harness.js';
import { NON_SOL_SAMPLES } from '../simple-price-v2/non-sol.js';
import { CandidateError } from '../../candidates/simple-price-v2-directional/model.js';
import { settlePrivate } from '../../integration/simple-price-v2/settlement.js';
import { reconcileAccountLedger } from '@paperfund/db';

const id = Date.now(),
  root = 'artifacts/simple-price-v2-cutoff-review/';
const encode = (value: unknown) =>
  JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
it.skipIf(process.env['PAPERFUND_V2_ACTUAL_FAILURES'] !== '1')(
  'actual-cutoff unavailable exit and one-unit dust remain explicit, with no invented recovery',
  async () => {
    const h = new AtomicHarness(),
      notes: unknown[] = [];
    const log = (event: string, data: unknown) => {
      const row = { at: new Date().toISOString(), event, data };
      notes.push(row);
      appendFileSync(root + id + '-failures-events.jsonl', encode(row) + '\n');
      console.log(encode(row));
    };
    let restore: (() => void) | undefined;
    try {
      await h.start();
      const round = await h.round(),
        i = await h.register(NON_SOL_SAMPLES[1].mint, 'NON_SOL'),
        u = await h.user();
      const state = async () => ({
        account: (
          await h.database.pool.query('select * from competition_accounts where id=$1', [
            u.accountId,
          ])
        ).rows,
        positions: (
          await h.database.pool.query('select * from positions where competition_account_id=$1', [
            u.accountId,
          ])
        ).rows,
        journals: (
          await h.database.pool.query(
            'select * from journal_transactions where competition_account_id=$1 order by id',
            [u.accountId],
          )
        ).rows,
        fills: (
          await h.database.pool.query(
            'select f.* from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 order by f.id',
            [u.accountId],
          )
        ).rows,
      });
      const buy = await h.buy(u, i, '0.1');
      expect(buy.statusCode, buy.body).toBe(200);
      log('BUY', buy.json());
      let before = await state();
      const outage = vi
        .spyOn(h.adapter.provider, 'captureNonSol')
        .mockRejectedValue(new CandidateError('RPC_UNAVAILABLE'));
      try {
        const r = await h.sell(u, i);
        expect(r.statusCode).toBe(503);
        expect(await state()).toEqual(before);
        log('OUTAGE_NO_MUTATION', r.json());
      } finally {
        outage.mockRestore();
      }
      const fetch = globalThis.fetch;
      const incomplete = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const r = await fetch(url, init);
        const request = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (
          String(url).includes('helius-rpc.com') &&
          request?.method === 'getMultipleAccounts' &&
          request.params[0].length >= 20
        ) {
          const body = (await r.json()) as { result: { value: unknown[] } };
          body.result.value[1] = null;
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return r;
      });
      try {
        const r = await h.sell(u, i);
        expect(r.statusCode).toBe(503);
        expect(await state()).toEqual(before);
        log('INCOMPLETE_NO_MUTATION', r.json());
      } finally {
        incomplete.mockRestore();
      }
      const archived = await h.adapter.provider.captureNonSol(i.mint);
      await new Promise((r) => setTimeout(r, 6100));
      const stale = vi.spyOn(h.adapter.provider, 'captureNonSol').mockResolvedValue(archived);
      try {
        const r = await h.sell(u, i);
        expect(r.statusCode).toBe(503);
        expect(await state()).toEqual(before);
        log('STALE_NO_MUTATION', r.json());
      } finally {
        stale.mockRestore();
      }
      const q = BigInt(buy.json().tokenQuantityReceivedBaseUnits);
      const partial = await h.sell(u, i, (q - 1n).toString());
      expect(partial.statusCode, partial.body).toBe(200);
      log('ONE_UNIT_REMAINDER', partial.json());
      before = await state();
      log('WAITING_REAL_CUTOFF', round);
      while (Date.now() < round.cutoff.getTime()) {
        await new Promise((r) =>
          setTimeout(r, Math.min(55000, round.cutoff.getTime() - Date.now())),
        );
      }
      log('ACTUAL_CUTOFF', { expected: round.cutoff, lagMs: Date.now() - round.cutoff.getTime() });
      const missing = vi
        .spyOn(h.adapter.provider, 'captureNonSol')
        .mockRejectedValue(new CandidateError('RPC_UNAVAILABLE'));
      restore = () => missing.mockRestore();
      const first = await settlePrivate(h.database, h.router, round.id, new Date());
      expect(first.status).toBe('RETRY_PENDING');
      log('MISSING_PRICE_RETRY', first);
      restore();
      restore = undefined;
      const second = await settlePrivate(h.database, h.router, round.id, new Date());
      log('FRESH_DUST_RETRY', second);
      const third = await settlePrivate(h.database, h.router, round.id, new Date());
      log('DUST_REVIEW', third);
      expect(third.status).toBe('REVIEW_REQUIRED');
      expect(await state()).toEqual(before);
      expect(
        (
          await h.database.pool.query(
            "select count(*)::int n from journal_transactions where source_entity_type='SETTLEMENT_WRITEOFF'",
          )
        ).rows[0].n,
      ).toBe(0);
      const held = await settlePrivate(h.database, h.router, round.id, new Date());
      expect(held.status).toBe('REVIEW_REQUIRED');
      expect(held.attempts).toBe(3);
      const reconciliation = await reconcileAccountLedger(h.database, u.accountId);
      expect(reconciliation.reconciled).toBe(true);
      log('PERSISTENT_HOLD_NO_WRITEOFF', {
        held,
        reconciliation,
        state: await state(),
        round: (
          await h.database.pool.query('select state from hourly_rounds where id=$1', [round.id])
        ).rows,
      });
    } finally {
      restore?.();
      writeFileSync(root + id + '-failure-results.json', encode(notes));
      await h.close();
    }
  },
);
