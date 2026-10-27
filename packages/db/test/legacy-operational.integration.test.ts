import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, fundAndApprove } from './legacy-beta-fixture.js';
import { createDatabase, type DatabaseService } from '../src/database.js';
import {
  createHourlyRound,
  settleHourlyRound,
  executePaperSellAll,
  reconcileAccountLedger,
} from '../src/financial-service.js';
import { finalizeHourlyRewardPool } from '../src/reward-service.js';
import { generateDailyShadowPayoutPlan, finalizeDailyRewardPool } from '../src/payout-service.js';
import { runHourlyLifecycleTick } from '../src/competition-service.js';

it('a database fault rolls back the whole forced financial operation and a later worker completes it once', async () => {
  const f = await fixture();
  try {
    await f.db.pool
      .query(`create function fixture_reject_liquidation() returns trigger language plpgsql as $$ begin raise exception 'CONTROLLED_ATOMIC_FAILURE'; end $$;
   create trigger fixture_reject before insert on legacy_settlement_liquidations for each row execute function fixture_reject_liquidation()`);
    const tables = [
      'competition_accounts',
      'positions',
      'fills',
      'ledger_entries',
      'journal_transactions',
      'idempotency_records',
    ];
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (t) => [
            t,
            (
              await f.db.pool.query(
                "select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from " +
                  t +
                  ' t',
              )
            ).rows[0].data,
          ]),
        ),
      );
    const before = await snapshot();
    await f.close();
    expect(await snapshot()).toEqual(before);
    expect(
      (await f.db.pool.query('select count(*)::int n from legacy_settlement_liquidations')).rows[0]
        .n,
    ).toBe(0);
    expect(
      (await f.db.pool.query('select count(*)::int n from legacy_source_reviews')).rows[0].n,
    ).toBe(0);
    await f.db.pool.query('drop trigger fixture_reject on legacy_settlement_liquidations');
    expect((await f.close()).state).toBe('FINALIZED');
    expect(
      (await f.db.pool.query('select count(*)::int n from legacy_settlement_liquidations')).rows[0]
        .n,
    ).toBe(2);
    for (const user of f.users)
      expect((await reconcileAccountLedger(f.db, user)).reconciled).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 30000);

it('requires all 24 canonical hours and exact daily contribution links before daily rewards', async () => {
  const f = await fixture();
  try {
    await f.close();
    const p = await fundAndApprove(f);
    await expect(
      generateDailyShadowPayoutPlan(f.db, { dailyCompetitionId: 'day', now: p.now }),
    ).rejects.toMatchObject({ code: 'PAYOUT_SETTLEMENT_REVIEW' });
    for (let hour = 1; hour < 24; hour++) {
      const start = new Date(+f.dayStart + hour * 3600000),
        end = new Date(+start + 3600000),
        id = 'empty:' + hour;
      await createHourlyRound(f.db, {
        id,
        startsAt: start,
        endsAtExclusive: end,
        state: 'OPEN',
        rulesVersion: 'legacy-beta-fixture',
      });
      expect(
        (
          await settleHourlyRound(f.db, f.router, {
            hourlyRoundId: id,
            authoritativeTimestamp: end,
          })
        ).state,
      ).toBe('FINALIZED');
      await f.qualify(id);
      await finalizeHourlyRewardPool(f.db, { hourlyRoundId: id, now: new Date(+end + 120000) });
    }
    const now = new Date(+f.dayStart + 86400000 + 120000);
    await runHourlyLifecycleTick(f.db, f.router, now);
    await finalizeDailyRewardPool(f.db, { dailyCompetitionId: 'day', now });
    const daily = await generateDailyShadowPayoutPlan(f.db, { dailyCompetitionId: 'day', now });
    expect(daily.prizePoolLamports).toBe(2700n);
    expect(daily.allocations).toHaveLength(2);
    const links = (
      await f.db.pool
        .query(`select d.user_id,d.cumulative_pnl_lamports,sum(h.hourly_pnl_lamports)::text exact,count(*)::int n
   from daily_results d join daily_result_hourly_results l on l.daily_result_id=d.id join hourly_results h on h.id=l.hourly_result_id
   where d.daily_competition_id='day' group by d.user_id,d.cumulative_pnl_lamports`)
    ).rows;
    expect(links).toHaveLength(2);
    for (const l of links) expect(l.cumulative_pnl_lamports).toBe(l.exact);
  } finally {
    await f.cleanup();
  }
}, 30000);

it('restricted API and worker logins execute normal exits/settlement but cannot qualify, approve, change STOP or bypass immutable evidence', async () => {
  const f = await fixture(),
    suffix = randomUUID().replaceAll('-', '');
  const names = ['api_' + suffix, 'worker_' + suffix];
  const services: DatabaseService[] = [];
  try {
    for (const [i, name] of names.entries()) {
      const password = randomUUID();
      await f.db.pool.query(
        'create role "' +
          name +
          '" login password \'' +
          password +
          "' nosuperuser nocreatedb nocreaterole noreplication nobypassrls",
      );
      await f.db.pool.query(
        'grant ' +
          (i === 0 ? 'paperfund_beta_api' : 'paperfund_beta_worker') +
          ' to "' +
          name +
          '"',
      );
      const url = new URL(f.db.pool.options.connectionString!);
      url.username = name;
      url.password = password;
      services.push(createDatabase(url.toString()));
    }
    await executePaperSellAll(services[0]!, f.router, {
      competitionAccountId: 'alice',
      marketId: f.state.identity.marketId,
      idempotencyKey: 'api-full-exit',
      authoritativeTimestamp: new Date(+f.start + 120000),
    });
    const settled = await settleHourlyRound(services[1]!, f.router, {
      hourlyRoundId: f.round,
      authoritativeTimestamp: f.end,
    });
    expect(settled.failures).toEqual([]);
    expect(settled.state).toBe('FINALIZED');
    for (const service of services) {
      await expect(service.pool.query('create table forbidden(id int)')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        service.pool.query(
          "insert into legacy_test_qualifications values('hour','TEST_ONLY_LOCALNET',repeat('a',64),'{}',default)",
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        service.pool.query('update payout_stop_state set stopped=false,generation=generation+1'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(service.pool.query('delete from fills')).rejects.toMatchObject({
        code: '42501',
      });
    }
    const role = (
      await services[0]!.pool.query(
        'select rolsuper,rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname=current_user',
      )
    ).rows[0];
    expect(Object.values(role)).toEqual([false, false, false, false]);
  } finally {
    for (const s of services) await s.close();
    await f.cleanup();
  }
}, 30000);

it('a lost acknowledgement after committed full liquidation resumes without repeating the fill or minting cash', async () => {
  const f = await fixture();
  try {
    let lost = false;
    const wrapped = {
      ...f.db,
      pool: {
        ...f.db.pool,
        query: f.db.pool.query.bind(f.db.pool),
        connect: async () => {
          const client = await f.db.pool.connect();
          const query = client.query.bind(client);
          return new Proxy(client, {
            get(target, key) {
              if (key === 'query')
                return async (...args: unknown[]) => {
                  const result = await (query as (...a: unknown[]) => Promise<unknown>)(...args);
                  if (!lost && String(args[0]).trim().toLowerCase() === 'commit') {
                    const n = (
                      await f.db.pool.query(
                        'select count(*)::int n from legacy_settlement_liquidations',
                      )
                    ).rows[0].n;
                    if (n > 0) {
                      lost = true;
                      throw Error('CONTROLLED_LOST_COMMIT_ACK');
                    }
                  }
                  return result;
                };
              const value = Reflect.get(target, key);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        },
      } as unknown as DatabaseService['pool'],
    } as DatabaseService;
    await settleHourlyRound(wrapped, f.router, {
      hourlyRoundId: f.round,
      authoritativeTimestamp: f.end,
    });
    expect(lost).toBe(true);
    expect((await f.close()).state).toBe('FINALIZED');
    expect(
      (await f.db.pool.query('select count(*)::int n from legacy_settlement_liquidations')).rows[0]
        .n,
    ).toBe(2);
    expect(
      (await f.db.pool.query('select count(*)::int n from legacy_source_reviews')).rows[0].n,
    ).toBe(0);
    for (const user of f.users)
      expect((await reconcileAccountLedger(f.db, user)).reconciled).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 30000);
