import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { canonicalExitPreflight } from '@paperfund/execution';
import { identifier } from '@paperfund/core';
import { reconcileAccountLedger, replayPersistedFill } from '@paperfund/db';
import { withGenericActor } from '@paperfund/protocols';
import { AtomicHarness } from './live-harness.js';
import { NON_SOL_SAMPLES } from '../simple-price-v2/non-sol.js';
import { PROTOCOL } from '../../integration/simple-price-v2-directional/adapter.js';
const run = Date.now(),
  h = new AtomicHarness(),
  notes: Record<string, unknown> = {};
const ok = (r: { statusCode: number; body: string }) => expect(r.statusCode, r.body).toBe(200);
type User = Awaited<ReturnType<AtomicHarness['user']>>;
async function state(u: User) {
  return (
    await h.database.pool.query(
      'select ca.*,(select count(*) from orders o where o.competition_account_id=ca.id) orders,(select count(*) from journal_transactions j where j.competition_account_id=ca.id) journals from competition_accounts ca where ca.id=$1',
      [u.accountId],
    )
  ).rows[0];
}
async function balance(u: User) {
  const r = await reconcileAccountLedger(h.database, u.accountId);
  expect(r.reconciled).toBe(true);
  expect(r.balancedJournalCount).toBe(r.journalCount);
  return r;
}
describe.skipIf(process.env['PAPERFUND_V2_ATOMIC_LIVE'] !== '1')(
  'real atomic providers through disposable accounting and API',
  () => {
    beforeAll(async () => {
      await h.start();
      await h.round();
      await h.register(NON_SOL_SAMPLES[1].mint, 'NON_SOL');
      await h.register(NON_SOL_SAMPLES[0].mint, 'NON_SOL');
      await h.register('7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump', 'SOL');
      notes['registrationFailures'] = Object.fromEntries(h.registrationFailures);
    }, 60000);
    afterAll(async () => {
      notes['providerReviews'] = Object.fromEntries(h.adapter?.provider.reviews ?? []);
      notes['captureAttempts'] = h.adapter?.provider.attempts;
      writeFileSync(
        'artifacts/simple-price-v2-atomic-review/api-results-' + run + '.json',
        JSON.stringify(notes, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
      );
      await h.close();
    }, 30000);
    it('TUSD repeats BUY, partially sells, sells ALL, values consistently and replays balanced fills', async () => {
      const i = h.markets.get(NON_SOL_SAMPLES[1].mint)!,
        u = await h.user(),
        a = await h.buy(u, i, '0.1'),
        b = await h.buy(u, i, '0.05');
      ok(a);
      ok(b);
      const view = await h.positions(u);
      ok(view);
      const q = BigInt(view.json().positions[0].tokenQuantityBaseUnits),
        partial = await h.sell(u, i, (q / 2n).toString());
      ok(partial);
      const remaining = await h.positions(u);
      ok(remaining);
      const end = await h.sell(u, i);
      ok(end);
      const fills = (
        await h.database.pool.query(
          'select f.id from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1',
          [u.accountId],
        )
      ).rows;
      for (const f of fills) await replayPersistedFill(h.database, h.router, f.id);
      notes['tusdRepeated'] = {
        a: a.json(),
        b: b.json(),
        view: view.json(),
        partial: partial.json(),
        remaining: remaining.json(),
        end: end.json(),
        reconciliation: await balance(u),
      };
    });
    it('TUSD immediate round trip and idempotency preserve exact accounting', async () => {
      const i = h.markets.get(NON_SOL_SAMPLES[1].mint)!,
        u = await h.user(),
        buy = await h.buy(u, i, '0.1', 'atomic-once');
      ok(buy);
      const before = await state(u),
        retry = await h.buy(u, i, '0.1', 'atomic-once');
      ok(retry);
      expect(await state(u)).toEqual(before);
      expect(retry.json().fillId).toBe(buy.json().fillId);
      const sell = await h.sell(u, i);
      ok(sell);
      expect(BigInt(sell.json().paperSolCreditedLamports)).toBeLessThan(100000000n);
      notes['tusdImmediate'] = {
        buy: buy.json(),
        sell: sell.json(),
        reconciliation: await balance(u),
      };
    });
    it('GOOG admits only supported fresh adaptive costs, otherwise rejects before financial mutation', async () => {
      const i = h.markets.get(NON_SOL_SAMPLES[0].mint)!,
        u = await h.user(),
        before = await state(u),
        buy = await h.buy(u, i, '0.1');
      if (buy.statusCode === 503) {
        expect(await state(u)).toEqual(before);
        notes['goog'] = {
          status: 'BLOCKED_BY_CURRENT_FEE_PROFILE',
          response: buy.json(),
          review: h.adapter.provider.reviews.get(i.mint),
          reconciliation: await balance(u),
        };
        return;
      }
      ok(buy);
      const q = BigInt(buy.json().tokenQuantityReceivedBaseUnits),
        partial = await h.sell(u, i, (q / 2n).toString());
      if (partial.statusCode === 503) {
        notes['goog'] = {
          status: 'BUY_PASSED_FRESH_EXIT_HELD',
          buy: buy.json(),
          partial: partial.json(),
          reconciliation: await balance(u),
        };
        return;
      }
      ok(partial);
      const end = await h.sell(u, i);
      expect([200, 503]).toContain(end.statusCode);
      notes['goog'] = {
        status: end.statusCode === 200 ? 'PASS' : 'PARTIAL_PASSED_FRESH_EXIT_HELD',
        buy: buy.json(),
        partial: partial.json(),
        end: end.json(),
        reconciliation: await balance(u),
      };
    });
    it('settlement and normal preflight agree exactly on the same real captured evidence', async () => {
      const i = h.markets.get(NON_SOL_SAMPLES[1].mint)!,
        u = await h.user();
      ok(await h.buy(u, i, '0.1'));
      const p = (await h.positions(u)).json().positions[0],
        q = BigInt(p.tokenQuantityBaseUnits),
        basis = BigInt(p.costBasisPaperSolLamports),
        before = await state(u);
      const identity = {
        protocolId: PROTOCOL,
        marketId: identifier(i.market, 'MarketId'),
        tokenMint: identifier(i.mint, 'TokenMint'),
      };
      const loaded = await withGenericActor(
        { intent: 'READ', accountId: u.accountId, systemRead: true, isolateCaptures: true },
        () => h.router.loadPositionRoute(identity, true),
      );
      const spy = vi
        .spyOn(h.router, 'loadPositionRoute')
        .mockResolvedValueOnce(loaded)
        .mockResolvedValueOnce(loaded);
      try {
        const normal = await canonicalExitPreflight(h.router, identity, q, basis, false),
          forced = await canonicalExitPreflight(h.router, identity, q, basis, true);
        expect(forced).toEqual(normal);
        expect(forced.status).toBe('FULL');
        expect(await state(u)).toEqual(before);
        notes['settlementPreflight'] = { normal, forced };
      } finally {
        spy.mockRestore();
      }
      ok(await h.sell(u, i));
      await balance(u);
    });
    it('SOL PumpSwap still uses preserved execution and accounting', async () => {
      const i = h.markets.get('7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump')!,
        u = await h.user(),
        buy = await h.buy(u, i, '0.1');
      ok(buy);
      const sell = await h.sell(u, i);
      ok(sell);
      notes['sol'] = { buy: buy.json(), sell: sell.json(), reconciliation: await balance(u) };
    });
    it('an incomplete response cannot mutate cash, orders, positions or journals; fresh recovery works', async () => {
      const i = h.markets.get(NON_SOL_SAMPLES[1].mint)!,
        u = await h.user(),
        before = await state(u),
        original = globalThis.fetch;
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const response = await original(url, init),
          r = init?.body
            ? (JSON.parse(String(init.body)) as { method: string; params: unknown[] })
            : undefined;
        if (
          String(url).includes('helius-rpc.com') &&
          r?.method === 'getMultipleAccounts' &&
          (r.params[0] as unknown[]).length >= 20
        ) {
          const body = (await response.json()) as { result: { value: unknown[] } };
          body.result.value[1] = null;
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return response;
      });
      try {
        expect((await h.buy(u, i, '0.1')).statusCode).toBe(503);
        expect(await state(u)).toEqual(before);
      } finally {
        spy.mockRestore();
      }
      ok(await h.buy(u, i, '0.1'));
      ok(await h.sell(u, i));
      await balance(u);
    });
    it('a terminal HTTP denial is explicit and receives only one network attempt', async () => {
      const i = h.markets.get(NON_SOL_SAMPLES[1].mint)!,
        u = await h.user(),
        before = await state(u),
        original = globalThis.fetch;
      let denied = 0;
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        if (String(url).includes('helius-rpc.com')) {
          denied++;
          return new Response(
            JSON.stringify({ error: { code: -32602, message: 'TEST_ACCESS_DENIED' } }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          );
        }
        return original(url, init);
      });
      try {
        const r = await h.buy(u, i, '0.1');
        expect(r.statusCode).toBe(503);
        expect(denied).toBe(1);
        expect(await state(u)).toEqual(before);
        notes['denial'] = {
          status: r.statusCode,
          networkAttempts: denied,
          review: h.adapter.provider.reviews.get(i.mint),
        };
      } finally {
        spy.mockRestore();
      }
      await balance(u);
    });
  },
);
