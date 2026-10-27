import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { IntegrationHarness, SOL, POLICY } from './test-harness.js';
import { directionalFixture } from '../../candidates/simple-price-v2-directional/fixtures.js';
import { quote, snapshotHash } from '../../candidates/simple-price-v2-directional/model.js';
import { settlePrivate } from '../simple-price-v2/settlement.js';
import { reconcileAccountLedger, replayPersistedFill } from '@paperfund/db';
const h = new IntegrationHarness();
const ok = (r: { statusCode: number; body: string }) => expect(r.statusCode, r.body).toBe(200);
async function setup() {
  const round = await h.round(),
    base = await h.market(),
    i = { ...base, quote: 'PUMP' },
    user = await h.user();
  h.markets.set(i.mint, i);
  h.observations.set(i.mint, directionalFixture(i, h.now.getTime()));
  await h.database.pool.query(
    "insert into assets(id,mint_address,decimals) values('fixture-pump','fixture-pump',6) on conflict do nothing",
  );
  await h.database.pool.query("update markets set quote_asset_id='fixture-pump' where id=$1", [
    i.market,
  ]);
  return { round, i, user };
}
async function balanced(id: string) {
  const r = await reconcileAccountLedger(h.database, id);
  expect(r.reconciled).toBe(true);
  expect(r.balancedJournalCount).toBe(r.journalCount);
  expect(r.cashFromLedgerLamports).toBe(r.materializedCashLamports);
  return r;
}
async function financialState(id: string) {
  return (
    await h.database.pool.query(
      'select ca.*,(select count(*) from orders o where o.competition_account_id=ca.id) orders,(select count(*) from fills f join orders o on o.id=f.order_id where o.competition_account_id=ca.id) fills,(select count(*) from journal_transactions j where j.competition_account_id=ca.id) journals from competition_accounts ca where ca.id=$1',
      [id],
    )
  ).rows[0];
}
describe('new directional version through unchanged disposable PostgreSQL and API', () => {
  beforeAll(() => h.start(), 60000);
  afterAll(() => h.close(), 30000);
  it('repeated BUY, partial SELL, SELL ALL, valuation, journals and persisted replay agree', async () => {
    const { i, user } = await setup();
    ok(await h.buy(user, i));
    ok(await h.buy(user, i, '0.5'));
    const p = (await h.positions(user)).json(),
      q = BigInt(p.positions[0].tokenQuantityBaseUnits);
    ok(await h.sell(user, i, (q / 2n).toString(), 'half-exit'));
    const before = await financialState(user.accountId);
    ok(await h.sell(user, i, (q / 2n).toString(), 'half-exit'));
    expect(await financialState(user.accountId)).toEqual(before);
    const remaining = (await h.positions(user)).json(),
      final = await h.sell(user, i);
    ok(final);
    expect(final.json().newCashBalanceLamports).toBe(remaining.portfolioEquityLamports);
    const fills = (
      await h.database.pool.query(
        'select f.id from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1',
        [user.accountId],
      )
    ).rows;
    for (const f of fills) await replayPersistedFill(h.database, h.router, f.id);
    const audit = await balanced(user.accountId);
    expect(audit.materializedCashLamports).toBeLessThan(10n * SOL);
    h.notes['repeated'] = { p, remaining, final: final.json(), audit };
  });
  it('500 proportional API exits cannot produce splitting profit', async () => {
    const { i, user } = await setup();
    const b = await h.buy(user, i);
    ok(b);
    const q = BigInt(b.json().tokenQuantityReceivedBaseUnits),
      e = h.observations.get(i.mint)!,
      full = quote('SELL', q, e, i, h.now.getTime(), POLICY).output;
    let remaining = q,
      net = 0n;
    for (let n = 0; n < 500; n++) {
      const qty = n === 499 ? remaining : q / 500n,
        r = await h.sell(user, i, qty.toString());
      ok(r);
      net += BigInt(r.json().paperSolCreditedLamports);
      remaining -= qty;
    }
    expect(net).toBeLessThanOrEqual(full);
    expect(full - net).toBeLessThan(500n);
    await balanced(user.accountId);
    h.notes['splits'] = { full, net, loss: full - net };
  }, 60000);
  it('fresh independent BUY/SELL fee changes and market movement reprice remaining equity', async () => {
    const { i, user } = await setup();
    ok(await h.buy(user, i));
    const first = (await h.positions(user)).json(),
      q = BigInt(first.positions[0].tokenQuantityBaseUnits);
    ok(await h.sell(user, i, (q / 4n).toString()));
    h.now = new Date(h.now.getTime() + 1);
    h.observations.set(
      i.mint,
      directionalFixture(i, h.now.getTime(), 4000n, 8000n, { n: 11n, d: 500n }),
    );
    const p = (await h.positions(user)).json(),
      r = await h.sell(user, i);
    ok(r);
    expect(r.json().newCashBalanceLamports).toBe(p.portfolioEquityLamports);
    await balanced(user.accountId);
  });
  it('missing, conflicting and stale cost evidence rejects without any financial mutation', async () => {
    const { i, user } = await setup();
    ok(await h.buy(user, i));
    const before = await financialState(user.accountId),
      e = h.observations.get(i.mint)!;
    const bad = structuredClone(e);
    Object.assign(bad.directionalCosts!.SELL.proofs[0]!, { upstream: 'forged' });
    Object.assign(bad.calibration, { snapshotHash: snapshotHash(bad) });
    h.observations.set(i.mint, bad);
    expect((await h.sell(user, i)).statusCode).toBe(503);
    expect(await financialState(user.accountId)).toEqual(before);
    h.observations.set(i.mint, e);
    h.now = new Date(h.now.getTime() + 5001);
    expect((await h.sell(user, i)).statusCode).toBe(503);
    expect(await financialState(user.accountId)).toEqual(before);
    await balanced(user.accountId);
  });
  it('forced settlement uses current directional exit valuation and retry stays idempotent', async () => {
    const { round, i, user } = await setup();
    ok(await h.buy(user, i));
    const p = (await h.positions(user)).json();
    h.now = round.cutoff;
    h.observations.set(i.mint, directionalFixture(i, h.now.getTime()));
    expect((await settlePrivate(h.database, h.router, round.id, h.now)).status).toBe('FINALIZED');
    const after = await financialState(user.accountId);
    expect(after.paper_sol_balance_lamports.toString()).toBe(p.portfolioEquityLamports);
    expect((await settlePrivate(h.database, h.router, round.id, h.now)).status).toBe('FINALIZED');
    expect(await financialState(user.accountId)).toEqual(after);
    await balanced(user.accountId);
  });
  it('20% cap, five lifetime slots and cross-token peaks retain existing rules', async () => {
    const { i, user } = await setup();
    expect((await h.buy(user, i, '2.1')).statusCode).toBe(409);
    ok(await h.buy(user, i, '0.1'));
    ok(await h.sell(user, i));
    for (let n = 0; n < 4; n++) {
      const m = await h.market();
      ok(await h.buy(user, m, '0.1'));
    }
    const sixth = await h.market();
    expect((await h.buy(user, sixth, '0.1')).statusCode).toBe(409);
    await balanced(user.accountId);
  });
  it('historical original v2 round cannot execute through the new directional version', async () => {
    await h.round('simple-price-candidate-v2');
    const i = await h.market(),
      user = await h.user();
    const before = await financialState(user.accountId);
    expect((await h.buy(user, i)).statusCode).toBe(400);
    expect(await financialState(user.accountId)).toEqual(before);
  });
});
