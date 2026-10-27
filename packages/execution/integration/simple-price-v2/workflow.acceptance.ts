import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { IntegrationHarness, SOL, POLICY } from './test-harness.js';
import { settlePrivate } from './settlement.js';
import { MODEL_VERSION, quote, replayFill } from '../../candidates/simple-price-v2/model.js';
import { synthetic, rebind } from '../../candidates/simple-price-v2/test-support.js';
import {
  reconcileAccountLedger,
  replayPersistedFill,
  executePaperBuy,
  settleHourlyRound,
  initializeCompetitionAccount,
} from '@paperfund/db';
import { ExecutionRouter } from '@paperfund/execution';
import {
  ReferenceProtocolAdapter,
  REFERENCE_PROTOCOL_ID,
  REFERENCE_ADAPTER_VERSION,
} from '@paperfund/protocols';
import { identifier } from '@paperfund/core';
import { bindPrivateRound } from './service.js';
import { unpack } from './adapter.js';
import type { Fill } from '../../candidates/simple-price-v2/model.js';
import type { BuyResult, SellResult } from '../../../shared/src/browser.js';
const h = new IntegrationHarness();
type User = Awaited<ReturnType<IntegrationHarness['user']>>;
async function setup() {
  const round = await h.round(),
    market = await h.market(),
    user = await h.user();
  return { round, market, user };
}
async function balance(user: User) {
  const r = await reconcileAccountLedger(h.database, user.accountId);
  expect(r.reconciled).toBe(true);
  expect(r.balancedJournalCount).toBe(r.journalCount);
  expect(r.cashFromLedgerLamports).toBe(r.materializedCashLamports);
  expect(r.positionCostFromLedgerLamports).toBe(r.materializedPositionCostLamports);
  expect(r.quantityFromFills).toBe(r.materializedQuantity);
  return r;
}
async function snapshot(user: User) {
  return (
    await h.database.pool.query(
      'select ca.paper_sol_balance_lamports,ca.realized_pnl_lamports,(select count(*) from fills f join orders o on o.id=f.order_id where o.competition_account_id=ca.id) fills,(select count(*) from journal_transactions j where j.competition_account_id=ca.id) journals from competition_accounts ca where ca.id=$1',
      [user.accountId],
    )
  ).rows[0];
}
function ok(response: { statusCode: number; body: string; json: () => unknown }) {
  expect(response.statusCode, response.body).toBe(200);
}
describe('v2 through actual PostgreSQL accounting and unchanged HTTP routes', () => {
  beforeAll(() => h.start(), 60000);
  afterAll(() => h.close(), 30000);
  it('a late database failure rolls back cash, position peak, slot, fill, journal and idempotency together', async () => {
    const { market, user } = await setup(),
      before = await snapshot(user);
    await h.database.pool.query(`
      create function private_v2.reject_test_fill() returns trigger language plpgsql as $$
      begin raise exception 'DISPOSABLE_TEST_FILL_FAILURE'; end $$;
      create trigger private_test_failure before insert on fills
      for each row execute function private_v2.reject_test_fill();
    `);
    try {
      const failed = await h.buy(user, market, '0.1', 'retry-after-db-failure');
      expect(failed.statusCode).toBe(500);
      expect(await snapshot(user)).toEqual(before);
      const state = (
        await h.database.pool.query(
          'select (select count(*) from positions where competition_account_id=$1)::int positions,(select count(*) from competition_token_slots where competition_account_id=$1)::int slots,(select count(*) from private_v2.position_peaks)::int peaks',
          [user.accountId],
        )
      ).rows[0];
      expect(state).toEqual({ positions: 0, slots: 0, peaks: 0 });
    } finally {
      await h.database.pool.query(
        'drop trigger private_test_failure on fills; drop function private_v2.reject_test_fill()',
      );
    }
    ok(await h.buy(user, market, '0.1', 'retry-after-db-failure'));
    await balance(user);
  });
  it('authentication, missing-account and malformed-request errors retain the existing API semantics', async () => {
    const { user, market } = await setup();
    await h.round();
    const unauth = await h.app.inject({ url: '/api/v1/rounds/current/account' });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.json().error.code).toBe('UNAUTHENTICATED');
    const missing = await h.positions(user);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('ROUND_ACCOUNT_NOT_FOUND');
    const viewed = await h.app.inject({
      url: '/api/v1/positions/viewed?mint=' + market.mint,
      headers: user.headers,
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json().reason).toBe('ROUND_ACCOUNT_NOT_FOUND');
    const malformed = await h.sell(user, market, '0');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('INVALID_REQUEST');
  });
  it('preserves the per-order BUY cap rather than introducing an aggregate position limit', async () => {
    const { user, market } = await setup();
    for (let n = 0; n < 3; n++) ok(await h.buy(user, market));
    const positions = (await h.positions(user)).json();
    expect(positions.positions[0].costBasisPaperSolLamports).toBe('3000000000');
    await balance(user);
  });
  it('viewed positions and immutable trade history keep the shared extension/browser contract', async () => {
    const { market, user } = await setup();
    const buy = await h.buy(user, market);
    ok(buy);
    // This unchanged endpoint also checks Date.now(), so align that clock with the explicit fixture UTC clock.
    const systemClock = vi.spyOn(Date, 'now').mockImplementation(() => h.now.getTime());
    let viewed: Awaited<ReturnType<typeof h.app.inject>>;
    try {
      viewed = await h.app.inject({
        url: '/api/v1/positions/viewed?mint=' + market.mint,
        headers: user.headers,
      });
    } finally {
      systemClock.mockRestore();
    }
    ok(viewed);
    expect(viewed.json().status, viewed.body).toBe('AVAILABLE');
    expect(viewed.json().accountId).toBe(user.accountId);
    expect(viewed.json().position.tokenQuantityBaseUnits).toBe(
      buy.json().tokenQuantityReceivedBaseUnits,
    );
    ok(await h.sell(user, market));
    const history = await h.app.inject({
      url: '/api/v1/trades?mint=' + market.mint,
      headers: user.headers,
    });
    ok(history);
    expect(history.json().items.length).toBe(2);
    for (const row of history.json().items) {
      expect(row.competition_account_id).toBe(user.accountId);
      expect(row.owner_user_id).toBe(user.id);
      expect(row.mint_address).toBe(market.mint);
      expect(row.token_decimals).toBe(6);
      expect(typeof row.base_quantity).toBe('string');
    }
    await balance(user);
  });
  it('10 SOL initialization, signed auth, exact BUY/SELL fields and one-side costs', async () => {
    const { market, user } = await setup();
    const account = (
      await h.app.inject({ url: '/api/v1/rounds/current/account', headers: user.headers })
    ).json();
    expect(account.paperSolLamports).toBe('10000000000');
    expect(account.slotsUsed).toBe(0);
    const rb = await h.buy(user, market);
    ok(rb);
    const b = rb.json() as BuyResult & Record<string, string>;
    expect(b.actualPaperSolSpentLamports).toBe('1000000000');
    expect(b.tokenQuantityReceivedBaseUnits).toBe('986485151906');
    expect(b.feeLamports).toBe('3686361');
    expect(b.newCashBalanceLamports).toBe('9000000000');
    const p = await h.positions(user);
    ok(p);
    const valued = p.json();
    expect(valued.positions[0].tokenQuantityBaseUnits).toBe(b.tokenQuantityReceivedBaseUnits);
    expect(valued.positions[0].costBasisPaperSolLamports).toBe('1000000000');
    expect(valued.positions[0].valuation.executablePaperSolLamports).toBe('973234341');
    const rs = await h.sell(user, market);
    ok(rs);
    const s = rs.json() as SellResult & Record<string, string>;
    expect(s.paperSolCreditedLamports).toBe('973234341');
    expect(s.feeLamports).toBe('3614341');
    expect(s.realizedPnlLamports).toBe('-26765659');
    expect(s.remainingQuantityBaseUnits).toBe('0');
    expect(s.newCashBalanceLamports).toBe(valued.portfolioEquityLamports);
    const reconciliation = await balance(user);
    expect(reconciliation.materializedCashLamports).toBe(9_973_234_341n);
    h.notes.immediate = { buy: b, sell: s, reconciliation };
  });
  it('partial SELL then SELL ALL equals fresh remaining valuation with coherent basis/AVG', async () => {
    const { market, user } = await setup();
    const b = (await h.buy(user, market)).json();
    const q = BigInt(b.tokenQuantityReceivedBaseUnits);
    const r = await h.sell(user, market, (q / 2n).toString());
    ok(r);
    const first = r.json();
    expect(BigInt(first.remainingCostBasisLamports)).toBe(SOL - (SOL * (q / 2n)) / q);
    const p = (await h.positions(user)).json(),
      last = await h.sell(user, market);
    ok(last);
    expect(last.json().paperSolCreditedLamports).toBe(
      p.positions[0].valuation.executablePaperSolLamports,
    );
    expect(
      BigInt(first.paperSolCreditedLamports) + BigInt(last.json().paperSolCreditedLamports),
    ).toBe(973_234_340n);
    await balance(user);
    h.notes.partial = { first, last: last.json() };
  });
  it('repeated BUYs retain weighted acquisition basis and reset peak only after full close/rebuy', async () => {
    const { market, user } = await setup();
    const a = (await h.buy(user, market)).json(),
      b = (await h.buy(user, market, '0.5')).json();
    const p = (await h.positions(user)).json().positions[0];
    expect(BigInt(p.tokenQuantityBaseUnits)).toBe(
      BigInt(a.tokenQuantityReceivedBaseUnits) + BigInt(b.tokenQuantityReceivedBaseUnits),
    );
    expect(p.costBasisPaperSolLamports).toBe('1500000000');
    const avg = { n: 1_500_000_000n, d: BigInt(p.tokenQuantityBaseUnits) };
    await h.sell(user, market, (BigInt(p.tokenQuantityBaseUnits) / 2n).toString());
    const peak = (
      await h.database.pool.query(
        'select peak_quantity from private_v2.position_peaks where position_id=$1',
        [p.id],
      )
    ).rows[0].peak_quantity;
    expect(peak).toBe(p.tokenQuantityBaseUnits);
    ok(await h.sell(user, market));
    const rebuy = await h.buy(user, market, '0.1');
    ok(rebuy);
    const after = (
      await h.database.pool.query(
        'select peak_quantity from private_v2.position_peaks where position_id=$1',
        [p.id],
      )
    ).rows[0].peak_quantity;
    expect(after).toBe(rebuy.json().tokenQuantityReceivedBaseUnits);
    const current = (
      await h.app.inject({ url: '/api/v1/rounds/current/account', headers: user.headers })
    ).json();
    expect(current.slotsUsed).toBe(1);
    await balance(user);
    h.notes.weightedAvg = {
      quantity: p.tokenQuantityBaseUnits,
      basis: p.costBasisPaperSolLamports,
      avg,
    };
  });
  it('rapid and concurrent requests serialize, duplicate IDs apply one fill, changed intents reject', async () => {
    const { market, user } = await setup();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => h.buy(user, market, '0.1', 'rapid-' + i)),
    );
    results.forEach(ok);
    const before = await snapshot(user);
    const [a, b] = await Promise.all([
      h.buy(user, market, '0.1', 'duplicate'),
      h.buy(user, market, '0.1', 'duplicate'),
    ]);
    ok(a);
    ok(b);
    expect(a.json().fillId).toBe(b.json().fillId);
    const after = await snapshot(user);
    expect(Number(after.fills) - Number(before.fills)).toBe(1);
    const bad = await h.buy(user, market, '0.2', 'duplicate');
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    const [s1, s2] = await Promise.all([
      h.sell(user, market, 'ALL', 'duplicate-sell'),
      h.sell(user, market, 'ALL', 'duplicate-sell'),
    ]);
    ok(s1);
    ok(s2);
    expect(s1.json().fillId).toBe(s2.json().fillId);
    await balance(user);
  });
  it('different tokens preserve their quantities, basis, fees and source evidence', async () => {
    const { market, user } = await setup(),
      other = await h.market();
    ok(await h.buy(user, market));
    ok(await h.buy(user, other, '0.5'));
    h.move(market, { n: 2n, d: 1000n });
    const p = (await h.positions(user)).json();
    expect(p.positions.length).toBe(2);
    const a = p.positions.find((x: { mint: string }) => x.mint === market.mint),
      b = p.positions.find((x: { mint: string }) => x.mint === other.mint);
    expect(BigInt(a.valuation.executablePaperSolLamports)).toBeGreaterThan(SOL);
    expect(BigInt(b.valuation.executablePaperSolLamports)).toBeLessThan(SOL / 2n);
    ok(await h.sell(user, other));
    await balance(user);
  });
  it('20% cap uses actual executable portfolio equity and rejects cap-plus-one atomically', async () => {
    const { market, user } = await setup(),
      other = await h.market();
    const initial = await h.buy(user, market, '2.000000001');
    expect(initial.statusCode).toBe(409);
    expect(initial.json().error.code).toBe('MAX_BUY_RATIO_EXCEEDED');
    ok(await h.buy(user, market));
    h.move(market, { n: 2n, d: 1000n });
    const pre = await h.app.inject({
      url: '/api/v1/trades/buy-preflight?mint=' + other.mint,
      headers: user.headers,
    });
    ok(pre);
    const maximum = BigInt(pre.json().maxBuyLamports),
      amount = maximum + 1n;
    const sol = (amount / SOL).toString() + '.' + (amount % SOL).toString().padStart(9, '0'),
      before = await snapshot(user);
    const rejected = await h.buy(user, other, sol);
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('MAX_BUY_RATIO_EXCEEDED');
    expect(await snapshot(user)).toEqual(before);
    await balance(user);
  });
  it('five unique token slots survive exits; the sixth and concurrent final-slot contenders cannot bypass', async () => {
    const { user } = await setup();
    for (let i = 0; i < 4; i++) {
      const m = await h.market();
      ok(await h.buy(user, m, '0.1'));
      ok(await h.sell(user, m));
    }
    const a = await h.market(),
      b = await h.market();
    const attempted = await Promise.all([h.buy(user, a, '0.1'), h.buy(user, b, '0.1')]);
    expect(attempted.filter((r) => r.statusCode === 200).length).toBe(1);
    expect(
      attempted.filter((r) => r.json().error?.code === 'TOKEN_SLOT_LIMIT_REACHED').length,
    ).toBe(1);
    expect(
      (await h.app.inject({ url: '/api/v1/rounds/current/account', headers: user.headers })).json()
        .slotsUsed,
    ).toBe(5);
    await balance(user);
  });
  it('multiple accounts in the same token keep different peaks and independent cached valuations', async () => {
    const { market, user } = await setup(),
      other = await h.user();
    ok(await h.buy(user, market));
    const b = (await h.buy(other, market, '0.5')).json();
    const first = (await h.positions(user)).json().positions[0],
      qty = BigInt(first.tokenQuantityBaseUnits);
    ok(await h.sell(user, market, (qty / 2n).toString()));
    const [pa, pb] = await Promise.all([h.positions(user), h.positions(other)]);
    ok(pa);
    ok(pb);
    const e = synthetic(market, h.now.getTime());
    const expectedA = quote(
      'SELL',
      qty - qty / 2n,
      e,
      market,
      h.now.getTime(),
      POLICY,
      undefined,
      qty,
    );
    const expectedB = quote(
      'SELL',
      BigInt(b.tokenQuantityReceivedBaseUnits),
      e,
      market,
      h.now.getTime(),
      POLICY,
      undefined,
      BigInt(b.tokenQuantityReceivedBaseUnits),
    );
    expect(pa.json().positions[0].valuation.executablePaperSolLamports).toBe(
      expectedA.output.toString(),
    );
    expect(pb.json().positions[0].valuation.executablePaperSolLamports).toBe(
      expectedB.output.toString(),
    );
    expect(expectedA.output).not.toBe(expectedB.output);
    await balance(user);
    await balance(other);
    const publicRanks = await h.app.inject({ url: '/api/v1/leaderboards/hourly/live' });
    ok(publicRanks);
    expect(publicRanks.json().status).toBe('AVAILABLE');
    expect(publicRanks.json().entries.length).toBe(2);
  });
  it('fresh market rises and falls reprice partial exits without freezing old values', async () => {
    const { market, user } = await setup(),
      b = (await h.buy(user, market)).json(),
      q = BigInt(b.tokenQuantityReceivedBaseUnits) / 4n;
    const a = (await h.sell(user, market, q.toString())).json();
    h.move(market, { n: 2n, d: 1000n });
    const rising = await h.sell(user, market, q.toString());
    ok(rising);
    expect(BigInt(rising.json().paperSolCreditedLamports)).toBeGreaterThan(
      BigInt(a.paperSolCreditedLamports),
    );
    h.move(market, { n: 3n, d: 4000n });
    const p = (await h.positions(user)).json(),
      down = await h.sell(user, market);
    ok(down);
    expect(down.json().newCashBalanceLamports).toBe(p.portfolioEquityLamports);
    await balance(user);
  });
  it('stale/conflicting evidence and unquoted sizes reject without fills, ledger or cash changes', async () => {
    const { market, user } = await setup();
    ok(await h.buy(user, market));
    const before = await snapshot(user);
    const bad = structuredClone(synthetic(market, h.now.getTime() + 1));
    Object.assign(bad.observations[1]!, { price: { n: 2n, d: 1000n } });
    h.observations.set(market.mint, rebind(bad));
    h.now = new Date(h.now.getTime() + 1);
    expect((await h.sell(user, market)).statusCode).toBe(503);
    h.observations.set(market.mint, synthetic(market, h.now.getTime()));
    h.now = new Date(h.now.getTime() + 5001);
    expect((await h.sell(user, market)).statusCode).toBe(503);
    expect(await snapshot(user)).toEqual(before);
    h.observations.clear();
    const tiny = await h.buy(user, market, '0.000000001');
    expect(tiny.statusCode).toBe(503);
    expect(await snapshot(user)).toEqual(before);
    await balance(user);
  });
  it('synthetic non-SOL conversion works and durable FX regression rejects without record mutation', async () => {
    const { market, user } = await setup();
    Object.assign(market, { quote: 'QUOTE_FIXTURE' });
    const prior = synthetic(market, h.now.getTime(), { n: 1n, d: 2000n }, undefined, undefined, {
      n: 2n,
      d: 1n,
    });
    h.observations.set(market.mint, prior);
    const b = await h.buy(user, market);
    ok(b);
    const before = await snapshot(user),
      next = structuredClone(
        synthetic(market, h.now.getTime() + 1, { n: 1n, d: 2000n }, undefined, undefined, {
          n: 2n,
          d: 1n,
        }),
      );
    Object.assign(next.conversion!.observations[0]!, { slot: BigInt(h.now.getTime()) - 1n });
    h.now = new Date(h.now.getTime() + 1);
    h.observations.set(market.mint, rebind(next));
    expect((await h.sell(user, market)).statusCode).toBe(503);
    expect(await snapshot(user)).toEqual(before);
    h.observations.set(
      market.mint,
      synthetic(market, h.now.getTime(), { n: 1n, d: 2000n }, undefined, undefined, {
        n: 2n,
        d: 1n,
      }),
    );
    ok(await h.sell(user, market));
    await balance(user);
  });
  it('500 consecutive HTTP partial exits cannot improve cash or duplicate a journal', async () => {
    const { market, user } = await setup(),
      b = (await h.buy(user, market)).json(),
      quantity = BigInt(b.tokenQuantityReceivedBaseUnits);
    const full = BigInt(
      (await h.positions(user)).json().positions[0].valuation.executablePaperSolLamports,
    );
    const base = quantity / 500n,
      rem = quantity % 500n;
    let net = 0n;
    for (let n = 0n; n < 500n; n++) {
      const response = await h.sell(user, market, (base + (n < rem ? 1n : 0n)).toString());
      ok(response);
      net += BigInt(response.json().paperSolCreditedLamports);
    }
    expect(net).toBeLessThanOrEqual(full);
    expect(full - net).toBe(341n);
    const s = await snapshot(user);
    expect(Number(s.fills)).toBe(501);
    expect(Number(s.journals)).toBe(502);
    const r = await balance(user);
    expect(r.materializedQuantity).toBe(0n);
    h.notes.split500 = { full, net, roundingLoss: full - net, reconciliation: r };
  }, 180000);
  it('persisted fills replay unchanged v2 behavior, bound peak and evidence after closure', async () => {
    const { market, user } = await setup();
    const b = (await h.buy(user, market)).json(),
      q = BigInt(b.tokenQuantityReceivedBaseUnits) / 2n;
    const s = (await h.sell(user, market, q.toString())).json();
    ok(await h.sell(user, market));
    for (const id of [b.fillId, s.fillId]) {
      expect((await replayPersistedFill(h.database, h.router, id)).matched).toBe(true);
      const row = (await h.database.pool.query('select fee_breakdown from fills where id=$1', [id]))
        .rows[0];
      const details = row.fee_breakdown.executionDetails?.candidateReplayEnvelope;
      expect(details).toBeDefined();
      const fill = unpack<Fill>(details);
      expect(replayFill(fill).modelVersion).toBe(MODEL_VERSION);
    }
    await balance(user);
  });
  it('UTC cutoff rejects new orders; forced SELL, result finalization and daily aggregation are idempotent', async () => {
    const { round, market, user } = await setup();
    ok(await h.buy(user, market));
    h.now = round.cutoff;
    const reject = await h.buy(user, market, '0.1');
    expect([404, 409]).toContain(reject.statusCode);
    const result = await settlePrivate(h.database, h.router, round.id, h.now);
    expect(result.status).toBe('FINALIZED');
    const before = await snapshot(user);
    const again = await settlePrivate(h.database, h.router, round.id, h.now);
    expect(again.status).toBe('FINALIZED');
    expect(await snapshot(user)).toEqual(before);
    const records = (
      await h.database.pool.query('select * from hourly_results where competition_account_id=$1', [
        user.accountId,
      ])
    ).rows;
    expect(records.length).toBe(1);
    expect(records[0].hourly_pnl_lamports).toBe('-26765659');
    const links = (
      await h.database.pool.query(
        'select * from daily_result_hourly_results where hourly_result_id=$1',
        [records[0].id],
      )
    ).rows;
    expect(links.length).toBe(1);
    await balance(user);
    const leaderboard = await h.app.inject({
      url: '/api/v1/leaderboards/hourly?roundId=' + encodeURIComponent(round.id),
    });
    ok(leaderboard);
    expect(leaderboard.json().entries[0].score).toBe('-26765659');
    h.notes.settlement = { result, hourly: records[0], leaderboard: leaderboard.json() };
  });
  it('temporary price outage retries through the original settlement engine and recovers', async () => {
    const { round, market, user } = await setup();
    ok(await h.buy(user, market));
    h.now = round.cutoff;
    h.missing.add(market.mint);
    const failed = await settlePrivate(h.database, h.router, round.id, h.now);
    expect(failed.status).toBe('RETRY_PENDING');
    const before = await snapshot(user);
    expect(Number(before.fills)).toBe(1);
    h.missing.clear();
    const recovery = await settlePrivate(h.database, h.router, round.id, h.now);
    expect(recovery.status).toBe('FINALIZED');
    await balance(user);
  });
  it('exhausted missing-price hold persists in disposable SQL and does not automatically rearm', async () => {
    const { round, market, user } = await setup();
    ok(await h.buy(user, market));
    h.now = round.cutoff;
    h.missing.add(market.mint);
    for (let n = 0; n < 3; n++) await settlePrivate(h.database, h.router, round.id, h.now);
    const before = await snapshot(user);
    h.missing.clear();
    const held = await settlePrivate(h.database, h.router, round.id, h.now);
    expect(held.status).toBe('REVIEW_REQUIRED');
    expect(await snapshot(user)).toEqual(before);
    expect(
      (
        await h.database.pool.query(
          'select count(*)::int n from hourly_results where competition_account_id=$1',
          [user.accountId],
        )
      ).rows[0].n,
    ).toBe(0);
    await balance(user);
  });
  it('sub-lamport remainder gets a review hold, never production-style zero-capacity write-off', async () => {
    const { round, market, user } = await setup(),
      b = (await h.buy(user, market)).json();
    ok(await h.sell(user, market, (BigInt(b.tokenQuantityReceivedBaseUnits) - 1n).toString()));
    h.now = round.cutoff;
    for (let n = 0; n < 3; n++) await settlePrivate(h.database, h.router, round.id, h.now);
    const rows = (
      await h.database.pool.query(
        'select remaining_base_units,cost_basis_lamports,status from positions where competition_account_id=$1',
        [user.accountId],
      )
    ).rows;
    expect(rows[0]).toMatchObject({
      remaining_base_units: '1',
      cost_basis_lamports: '1',
      status: 'OPEN',
    });
    const writeoff = (
      await h.database.pool.query(
        "select count(*)::int n from journal_transactions where competition_account_id=$1 and source_entity_type='SETTLEMENT_WRITEOFF'",
        [user.accountId],
      )
    ).rows[0];
    expect(writeoff.n).toBe(0);
    await balance(user);
  });
  it('bindings are immutable; legacy version cannot trade through v2 and recorded legacy fills settle separately', async () => {
    const round = await h.round(REFERENCE_ADAPTER_VERSION),
      market = await h.market(),
      user = await h.user();
    const blocked = await h.buy(user, market);
    expect(blocked.statusCode).toBe(400);
    await expect(bindPrivateRound(h.database, round.id, POLICY)).rejects.toThrow(
      'MODEL_BINDING_REQUIRES_UNOPENED_EMPTY_ROUND',
    );
    await expect(
      h.database.pool.query(
        'update private_v2.round_models set model_version=$2 where round_id=$1',
        [round.id, MODEL_VERSION],
      ),
    ).rejects.toThrow('PRIVATE_MODEL_BINDING_IMMUTABLE');
    const fixture = {
      identity: {
        protocolId: REFERENCE_PROTOCOL_ID,
        marketId: identifier(market.market, 'MarketId'),
        tokenMint: identifier(market.mint, 'TokenMint'),
      },
      observedAt: h.now.toISOString(),
      quoteLamportsPerTokenBaseUnit: 1n,
      buyFeeBps: 0n,
      sellFeeBps: 0n,
    };
    const oldAdapter = new ReferenceProtocolAdapter([fixture]);
    // Actual installed reference version is recorded, never relabelled v2.
    expect(oldAdapter.adapterVersion).toBe(REFERENCE_ADAPTER_VERSION);
    await h.database.pool.query('update markets set venue=$2 where id=$1', [
      market.market,
      REFERENCE_PROTOCOL_ID,
    ]);
    const oldRouter = new ExecutionRouter([oldAdapter]);
    const buy = await executePaperBuy(h.database, oldRouter, {
      competitionAccountId: user.accountId,
      marketId: market.market,
      requestedPaperSolLamports: SOL,
      idempotencyKey: 'old-' + round.id,
      authoritativeTimestamp: h.now,
    });
    h.now = round.cutoff;
    const result = await settleHourlyRound(h.database, oldRouter, {
      hourlyRoundId: round.id,
      authoritativeTimestamp: h.now,
    });
    expect(result.state).toBe('FINALIZED');
    expect((await replayPersistedFill(h.database, oldRouter, buy.fillId)).matched).toBe(true);
    await expect(replayPersistedFill(h.database, h.router, buy.fillId)).rejects.toThrow();
    const next = await h.round(),
      nextAccount = 'next:' + user.id;
    await initializeCompetitionAccount(h.database, {
      accountId: nextAccount,
      userId: user.id,
      hourlyRoundId: next.id,
      idempotencyKey: nextAccount,
    });
    expect(
      (
        await h.database.pool.query(
          'select paper_sol_balance_lamports from competition_accounts where id=$1',
          [nextAccount],
        )
      ).rows[0].paper_sol_balance_lamports,
    ).toBe('10000000000');
    h.notes.versions = {
      oldModel: oldAdapter.adapterVersion,
      newModel: MODEL_VERSION,
      oldSettled: true,
      newRound: next.id,
    };
  });
  it('two finalized hourly results accumulate exact signed daily P&L once through unchanged contracts', async () => {
    const first = await h.round(undefined, new Date('2030-01-10T01:00:00Z')),
      market = await h.market(),
      user = await h.user();
    ok(await h.buy(user, market));
    ok(await h.sell(user, market));
    h.now = first.cutoff;
    expect((await settlePrivate(h.database, h.router, first.id, h.now)).status).toBe('FINALIZED');
    const second = await h.round(undefined, new Date('2030-01-10T02:00:00Z'));
    const entered = await h.app.inject({
      method: 'POST',
      url: '/api/v1/rounds/current/enter',
      headers: user.headers,
    });
    ok(entered);
    const account = (
      await h.app.inject({ url: '/api/v1/rounds/current/account', headers: user.headers })
    ).json();
    const nextUser = { ...user, accountId: account.accountId };
    expect(account.paperSolLamports).toBe('10000000000');
    ok(await h.buy(nextUser, market));
    ok(await h.sell(nextUser, market));
    h.now = second.cutoff;
    expect((await settlePrivate(h.database, h.router, second.id, h.now)).status).toBe('FINALIZED');
    await settleHourlyRound(h.database, h.router, {
      hourlyRoundId: second.id,
      authoritativeTimestamp: h.now,
    });
    const daily = await h.app.inject({ url: '/api/v1/leaderboards/daily' });
    ok(daily);
    const row = daily.json().entries.find((r: { user_id: string }) => r.user_id === user.id);
    expect(row.score).toBe('-53531318');
    expect(row.completed_hourly_round_count).toBe(2);
    await balance(user);
    await balance(nextUser);
    h.notes.daily = row;
  });
  it('23:00 UTC round retains its start-day attribution after next-day settlement', async () => {
    const round = await h.round(undefined, new Date('2030-02-01T23:00:00Z')),
      market = await h.market(),
      user = await h.user();
    ok(await h.buy(user, market));
    h.now = round.cutoff;
    expect(h.now.toISOString()).toBe('2030-02-02T00:00:00.000Z');
    expect((await settlePrivate(h.database, h.router, round.id, h.now)).status).toBe('FINALIZED');
    const row = (
      await h.database.pool.query(
        'select dc.utc_date::text utc_date,dr.cumulative_pnl_lamports from daily_results dr join daily_competitions dc on dc.id=dr.daily_competition_id where dr.user_id=$1',
        [user.id],
      )
    ).rows[0];
    expect(row.utc_date).toBe('2030-02-01');
    expect(row.cumulative_pnl_lamports).toBe('-26765659');
    await balance(user);
    h.notes.midnight = row;
  });
  it('payouts remain impossible: no funded revenue, plans, signer, broadcasts or payout endpoint', async () => {
    const counts = (
      await h.database.pool.query(
        'select (select count(*) from creator_fee_events)::int revenues,(select count(*) from payout_plans)::int plans,(select count(*) from payout_executions)::int executions,(select count(*) from payout_broadcast_attempts)::int broadcasts',
      )
    ).rows[0];
    expect(counts).toEqual({ revenues: 0, plans: 0, executions: 0, broadcasts: 0 });
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payouts/execute',
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    h.notes.payoutIsolation = counts;
  });
});
