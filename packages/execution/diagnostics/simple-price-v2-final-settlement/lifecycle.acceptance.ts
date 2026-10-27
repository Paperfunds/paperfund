import { it, expect } from 'vitest';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  reconcileAccountLedger,
  ingestCreatorFeeEvents,
  FixtureCreatorFeeSource,
  finalizeHourlyRewardPool,
  generateHourlyShadowPayoutPlan,
  getPayoutPlanAudit,
} from '@paperfund/db';
import { FinalHarness } from './harness.js';
import { privateTick, acknowledgeReview } from './worker.js';
import { controlledReplay, encode } from '../simple-price-v2-settlement/fixtures.js';
import type { Job } from './worker-child.js';
const cutoff = Date.parse('2030-01-01T13:00:00Z');
const root = 'artifacts/simple-price-v2-final-settlement-review/';
async function child(h: FinalHarness, lostAck = false) {
  const c = fork(
    resolve('packages/execution/diagnostics/simple-price-v2-final-settlement/worker-child.ts'),
    [],
    {
      execArgv: ['--import', 'tsx'],
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        PATH: process.env['PATH'] ?? '',
        SystemRoot: process.env['SystemRoot'] ?? '',
        TEMP: process.env['TEMP'] ?? '',
        TMP: process.env['TMP'] ?? '',
        TSX_TSCONFIG_PATH: resolve(
          'packages/execution/diagnostics/simple-price-v2-final-settlement/tsconfig.json',
        ),
      },
    },
  );
  const outcome = new Promise<number | null>((done, reject) => {
    const timer = setTimeout(() => {
      c.kill();
      reject(Error('OWNED_WORKER_TIMEOUT'));
    }, 30000);
    c.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    c.once('exit', (code) => {
      clearTimeout(timer);
      done(code);
    });
  });
  c.send({
    url: h.database.pool.options.connectionString!,
    token: h.token,
    directory: h.directory,
    now: h.now.getTime(),
    lostAck,
  } satisfies Job);
  expect(await outcome).toBe(lostAck ? 75 : 0);
}
async function state(h: FinalHarness) {
  const tables = [
    'competition_accounts',
    'positions',
    'fills',
    'journal_transactions',
    'ledger_entries',
    'hourly_results',
    'daily_results',
    'daily_result_hourly_results',
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (t) => [
        t,
        (await h.database.pool.query('select * from ' + t + ' order by id')).rows,
      ]),
    ),
  );
}
async function balances(h: FinalHarness) {
  const accounts = (await h.database.pool.query('select id from competition_accounts')).rows;
  const results = [];
  for (const a of accounts) {
    const r = await reconcileAccountLedger(h.database, a.id);
    expect(r.reconciled).toBe(true);
    expect(r.balancedJournalCount).toBe(r.journalCount);
    results.push(r);
  }
  return results;
}
async function funding(h: FinalHarness, round: string) {
  await ingestCreatorFeeEvents(
    h.database,
    new FixtureCreatorFeeSource([
      {
        transactionSignature: 'MOCK_ONLY_FINAL_POLICY:' + round,
        eventIndex: 0,
        slot: 1n,
        eventTime: new Date(cutoff - 30000),
        creatorFeeLamports: 100000003n,
        sourceProgram: 'EXPLICIT_MOCK_REVENUE',
        tokenProjectIdentity: 'NO_REAL_FUNDING',
        observedAt: new Date(cutoff - 30000),
        normalizedMetadata: { fixture: true, noRealRevenue: true },
        verificationStatus: 'VERIFIED',
      },
    ]),
  );
  return finalizeHourlyRewardPool(h.database, {
    hourlyRoundId: round,
    now: new Date(cutoff + 61000),
  });
}
it('pinned pre-cutoff SELL ALL survives provider outage, delayed process restart, lost ack and concurrency with exact accounting/rewards', async () => {
  const h = new FinalHarness(),
    notes: Record<string, unknown> = {
      clock: 'CONTROLLED',
      price: 'ARCHIVED_REAL_SOL',
      funding: 'MOCK_ONLY',
    };
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    const round = (await privateTick(h.archive, h.directory, h.now)).currentRoundId;
    const a = await h.user(),
      b = await h.user();
    await h.user();
    await h.user();
    const buy = await h.buy(a, h.original.identity, '1');
    expect(buy.statusCode, buy.body).toBe(200);
    expect(buy.json().tokenQuantityReceivedBaseUnits).toBe('5370987144392');
    expect((await h.buy(b, h.original.identity, '0.5')).statusCode).toBe(200);
    expect(
      (
        await h.sell(
          a,
          h.original.identity,
          (BigInt(buy.json().tokenQuantityReceivedBaseUnits) / 2n).toString(),
        )
      ).statusCode,
    ).toBe(200);
    const e = controlledReplay(h.original, cutoff - 500);
    const captureId = await h.archive.capture(e, h.now.getTime());
    // No provider access after cutoff; actual child recreates only the durable archive reader.
    h.now = new Date(cutoff + 7200100);
    await child(h, true);
    const first = await state(h);
    await Promise.all([child(h), privateTick(h.archive, h.directory, h.now)]);
    expect(await state(h)).toEqual(first);
    expect(
      (
        await h.database.pool.query(
          'select status,passes from final_v2.control where round_id=$1',
          [round],
        )
      ).rows[0],
    ).toEqual({ status: 'FINALIZED', passes: 1 });
    expect(
      (
        await h.database.pool.query('select capture_id from final_v2.decisions where round_id=$1', [
          round,
        ])
      ).rows[0].capture_id,
    ).toBe(captureId);
    const leaderboard = await h.competition.hourlyLeaderboard(round);
    expect(leaderboard!.entries.map((e) => e.rank)).toEqual([1, 1, 3, 4]);
    expect(
      (
        await h.database.pool.query(
          'select hourly_pnl_lamports from hourly_results where user_id=$1',
          [a.id],
        )
      ).rows[0].hourly_pnl_lamports,
    ).toBe('-40116378');
    const pool = await funding(h, round);
    const plan = await generateHourlyShadowPayoutPlan(h.database, {
      hourlyRoundId: round,
      now: new Date(cutoff + 62000),
    });
    const audit = await getPayoutPlanAudit(h.database, plan.id);
    expect(audit!.conservation.holds).toBe(true);
    expect(audit!.allocations.map((a) => a.allocatedLamports.toString())).toEqual([
      '19816397',
      '19816397',
      '13216909',
      '10150299',
    ]);
    const next = await h.competition.enterRound(a.id);
    expect(next.paperSolBalanceLamports).toBe(10000000000n);
    h.now = new Date(cutoff + 10800100);
    await child(h);
    await child(h);
    const daily = (
      await h.database.pool.query(
        'select cumulative_pnl_lamports,completed_hourly_round_count from daily_results where user_id=$1',
        [a.id],
      )
    ).rows[0];
    expect(daily).toEqual({
      cumulative_pnl_lamports: '-40116378',
      completed_hourly_round_count: 2,
    });
    expect(
      (await h.database.pool.query('select count(*)::int n from payout_executions')).rows[0].n,
    ).toBe(0);
    notes['pool'] = pool;
    notes['audit'] = audit;
    notes['daily'] = daily;
    notes['ledger'] = await balances(h);
    notes['final'] = await state(h);
  } finally {
    writeFileSync(root + 'settled-' + Date.now() + '.json', encode(notes), { flag: 'wx' });
    await h.close();
  }
});
it('missing pre-cutoff evidence creates durable REVIEW and blocks affected hourly/daily payouts while subsequent hours continue', async () => {
  const h = new FinalHarness(),
    notes: Record<string, unknown> = { clock: 'CONTROLLED' };
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    const round = (await privateTick(h.archive, h.directory, h.now)).currentRoundId,
      u = await h.user();
    expect((await h.buy(u, h.original.identity, '0.1')).statusCode).toBe(200);
    const before = await state(h);
    h.now = new Date(cutoff + 1);
    // Realistic late receipt is explicitly ineligible even with an old source timestamp.
    await h.archive.capture(controlledReplay(h.original, cutoff - 500), cutoff + 1);
    await Promise.all([child(h), privateTick(h.archive, h.directory, h.now)]);
    const held = await state(h);
    expect(held).toEqual(before);
    const controls = (
      await h.database.pool.query('select * from final_v2.control where round_id=$1', [round])
    ).rows;
    expect(controls[0].status).toBe('REVIEW_REQUIRED');
    expect(controls[0].passes).toBe(1);
    expect(JSON.stringify(controls)).toContain('MISSING_DURABLE_PRE_CUTOFF_CAPTURE');
    await child(h);
    expect(await state(h)).toEqual(held);
    expect(
      (
        await h.database.pool.query('select passes from final_v2.control where round_id=$1', [
          round,
        ])
      ).rows[0].passes,
    ).toBe(1);
    await acknowledgeReview(
      h.archive,
      round,
      'TEST_OPERATOR',
      'TEST_CASE',
      'Inspect unavailable evidence; no financial remedy authorized',
    );
    await expect(acknowledgeReview(h.archive, round, '', '', '')).rejects.toThrow('PROVENANCE');
    await expect(
      h.database.pool.query("update final_v2.control set status='RUNNING' where round_id=$1", [
        round,
      ]),
    ).rejects.toThrow('TERMINAL_REVIEW');
    await expect(
      h.database.pool.query(
        "insert into payout_plans(id,competition_type,hourly_round_id) values('PRIVATE_HELD_PLAN','HOURLY',$1)",
        [round],
      ),
    ).rejects.toThrow('PRIVATE_SETTLEMENT_REVIEW_PAYOUT_HOLD');
    await expect(
      h.database.pool.query(
        "insert into payout_plans(id,competition_type,daily_competition_id) values('PRIVATE_HELD_DAY','DAILY','daily:2030-01-01')",
      ),
    ).rejects.toThrow('PRIVATE_SETTLEMENT_REVIEW_PAYOUT_HOLD');
    await expect(h.competition.hourlyLeaderboard(round)).rejects.toThrow();
    await funding(h, round);
    await expect(
      generateHourlyShadowPayoutPlan(h.database, {
        hourlyRoundId: round,
        now: new Date(cutoff + 62000),
      }),
    ).rejects.toThrow();
    const fresh = await h.competition.enterRound(u.id);
    expect(fresh.paperSolBalanceLamports).toBe(10000000000n);
    h.now = new Date(cutoff + 3600100);
    await child(h);
    await child(h);
    expect(
      (await h.database.pool.query('select count(*)::int n from hourly_results')).rows[0].n,
    ).toBe(1);
    expect(
      (await h.database.pool.query('select count(*)::int n from payout_plans')).rows[0].n,
    ).toBe(0);
    expect(
      (await h.database.pool.query('select count(*)::int n from payout_executions')).rows[0].n,
    ).toBe(0);
    notes['control'] = controls;
    notes['ledger'] = await balances(h);
    notes['final'] = await state(h);
  } finally {
    writeFileSync(root + 'review-' + Date.now() + '.json', encode(notes), { flag: 'wx' });
    await h.close();
  }
});
it('one-unit remainder stays 1 quantity/1 basis in REVIEW; no zero-capacity fallback or write-off', async () => {
  const h = new FinalHarness();
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    const round = (await privateTick(h.archive, h.directory, h.now)).currentRoundId,
      u = await h.user();
    const buy = await h.buy(u, h.original.identity, '0.1');
    expect(buy.statusCode).toBe(200);
    const sell = await h.sell(
      u,
      h.original.identity,
      (BigInt(buy.json().tokenQuantityReceivedBaseUnits) - 1n).toString(),
    );
    expect(sell.statusCode, sell.body).toBe(200);
    expect(sell.json().remainingCostBasisLamports).toBe('1');
    await h.archive.capture(controlledReplay(h.original, cutoff - 500), cutoff - 500);
    const before = await state(h);
    h.now = new Date(cutoff + 100);
    await child(h);
    await child(h);
    expect(await state(h)).toEqual(before);
    expect(
      (
        await h.database.pool.query('select status from final_v2.control where round_id=$1', [
          round,
        ])
      ).rows[0].status,
    ).toBe('REVIEW_REQUIRED');
    expect(
      (
        await h.database.pool.query(
          "select count(*)::int n from journal_transactions where source_entity_type='SETTLEMENT_WRITEOFF'",
        )
      ).rows[0].n,
    ).toBe(0);
    writeFileSync(
      root + 'dust-' + Date.now() + '.json',
      encode({ ledger: await balances(h), state: await state(h) }),
      { flag: 'wx' },
    );
  } finally {
    await h.close();
  }
});
