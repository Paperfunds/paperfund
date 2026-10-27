import { it, expect } from 'vitest';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
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
import { ReplayHarness } from './harness.js';
import { recoveryTick } from './worker.js';
import { encode } from './fixtures.js';
import { REQUIRED_CUTOFF_POLICY } from './diagnosis.js';
import type { Job } from './worker-child.js';
const root = 'artifacts/simple-price-v2-blocker-review/';
const cutoff = Date.parse('2030-01-01T13:00:00Z');
const children = new Set<ChildProcess>();
type Message = { type: string; pid?: number | undefined; result?: unknown; message?: string };
async function worker(
  h: ReplayHarness,
  phase: Job['phase'],
  now: number,
  mode: Job['mode'] = 'CONTROLLED_ARCHIVED_REPLAY',
  missing = false,
) {
  const child = fork(
    resolve('packages/execution/diagnostics/simple-price-v2-settlement/worker-child.ts'),
    [],
    {
      execArgv: ['--import', 'tsx'],
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env['PATH'] ?? '',
        SystemRoot: process.env['SystemRoot'] ?? '',
        TEMP: process.env['TEMP'] ?? '',
        TMP: process.env['TMP'] ?? '',
        TSX_TSCONFIG_PATH: resolve(
          'packages/execution/diagnostics/simple-price-v2-settlement/tsconfig.json',
        ),
      },
    },
  );
  children.add(child);
  const exited = new Promise<number | null>((r) =>
    child.once('exit', (code) => {
      children.delete(child);
      r(code);
    }),
  );
  let errors = '';
  child.stderr?.on('data', (s: Buffer) => {
    errors = (errors + s.toString()).slice(-4000);
  });
  const outcome = new Promise<Message>((done, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('OWNED_CHILD_TIMEOUT'));
    }, 40000);
    child.on('message', (m: Message) => {
      if (m.type === 'ERROR') {
        clearTimeout(timer);
        reject(Error(m.message ?? 'WORKER_ERROR'));
      } else {
        clearTimeout(timer);
        done(m);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 75) done({ type: 'CRASH_WITHOUT_ACK', pid: child.pid });
      else if (code !== 0) reject(Error('WORKER_EXIT:' + code + ':' + errors));
    });
  });
  const url = h.database.pool.options.connectionString;
  if (!url) throw Error('OWNED_DATABASE_URL_REQUIRED');
  child.send({
    url,
    token: h.token,
    directory: h.directory,
    now,
    phase,
    mode,
    missing,
  } satisfies Job);
  const result = await outcome;
  if (phase === 'PAUSE') return { result, child, exited };
  await exited;
  return { result, child, exited };
}
async function balances(h: ReplayHarness) {
  const accounts = (await h.database.pool.query('select id from competition_accounts order by id'))
    .rows as { id: string }[];
  return Promise.all(
    accounts.map(async (a) => {
      const r = await reconcileAccountLedger(h.database, a.id);
      expect(r.reconciled).toBe(true);
      expect(r.balancedJournalCount).toBe(r.journalCount);
      return { id: a.id, ...r };
    }),
  );
}
async function snapshot(h: ReplayHarness) {
  return {
    accounts: (await h.database.pool.query('select * from competition_accounts order by id')).rows,
    positions: (await h.database.pool.query('select * from positions order by id')).rows,
    fills: (await h.database.pool.query('select * from fills order by id')).rows,
    results: (await h.database.pool.query('select * from hourly_results order by id')).rows,
    daily: (await h.database.pool.query('select * from daily_results order by id')).rows,
    links: (await h.database.pool.query('select * from daily_result_hourly_results order by id'))
      .rows,
    holds: (
      await h.database.pool.query('select * from private_v2.settlement_control order by round_id')
    ).rows,
  };
}
async function fixtureFunding(h: ReplayHarness, round: string) {
  await ingestCreatorFeeEvents(
    h.database,
    new FixtureCreatorFeeSource([
      {
        transactionSignature: 'MOCK_REVENUE:' + round,
        eventIndex: 0,
        slot: 1n,
        eventTime: new Date(cutoff - 30000),
        creatorFeeLamports: 100000003n,
        sourceProgram: 'EXPLICIT_REWARD_TEST_FIXTURE',
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
async function clean(h: ReplayHarness) {
  for (const c of [...children]) {
    if (c.exitCode === null) c.kill();
  }
  await h.close();
}
it('real worker process interruption/restart, rollback before commit, lost ack after commit, rankings and reward eligibility', async () => {
  const h = new ReplayHarness(),
    notes: Record<string, unknown> = {
      financialInput:
        'Archived real SOL prices, fees and executable quotes; ONLY time/slot labels are controlled fixtures. Reward funding explicitly mocked.',
    };
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    await expect(
      recoveryTick(
        h.database,
        h.router,
        h.now,
        h.policy,
        'CONTROLLED_ARCHIVED_REPLAY',
        'wrong-token',
      ),
    ).rejects.toThrow('DISPOSABLE_DATABASE_GUARD_REQUIRED');
    expect(
      (await h.database.pool.query('select count(*)::int n from hourly_rounds')).rows[0].n,
    ).toBe(0);
    const startup = await recoveryTick(
        h.database,
        h.router,
        h.now,
        h.policy,
        'CONTROLLED_ARCHIVED_REPLAY',
        h.token,
      ),
      round = startup.ensured.currentRoundId;
    const i = h.original.identity,
      a = await h.user(),
      b = await h.user();
    await h.user();
    await h.user();
    const buy = await h.buy(a, i, '1');
    expect(buy.statusCode, buy.body).toBe(200);
    expect(buy.json().tokenQuantityReceivedBaseUnits).toBe('5370987144392');
    expect((await h.buy(b, i, '0.5')).statusCode).toBe(200);
    expect(
      (await h.sell(a, i, (BigInt(buy.json().tokenQuantityReceivedBaseUnits) / 2n).toString()))
        .statusCode,
    ).toBe(200);
    const paused = await worker(h, 'PAUSE', cutoff - 100);
    expect(paused.result.type).toBe('READY');
    paused.child.kill('SIGTERM');
    await paused.exited;
    notes['interruptedPid'] = paused.result.pid;
    h.now = new Date(cutoff + 100);
    await h.database.pool.query(
      "create function private_v2.inject_fill_failure() returns trigger language plpgsql as $$ begin if NEW.side='SELL' then raise exception 'CONTROLLED_BEFORE_COMMIT_FAULT'; end if; return NEW; end $$; create trigger controlled_fill_failure before insert on fills for each row execute function private_v2.inject_fill_failure()",
    );
    const failed = await worker(h, 'CRASH_AFTER_TICK', h.now.getTime());
    expect(failed.result.type).toBe('CRASH_WITHOUT_ACK');
    expect(
      (
        await h.database.pool.query(
          "select count(*)::int n from fills f join orders o on o.id=f.order_id where o.execution_context='FORCED_HOURLY_SETTLEMENT'",
        )
      ).rows[0].n,
    ).toBe(0);
    notes['beforeCommitRollback'] = await snapshot(h);
    await balances(h);
    await h.database.pool.query(
      'drop trigger controlled_fill_failure on fills; drop function private_v2.inject_fill_failure()',
    );
    const committed = await worker(h, 'CRASH_AFTER_TICK', h.now.getTime());
    expect(committed.result.type).toBe('CRASH_WITHOUT_ACK');
    const beforeRestart = await snapshot(h);
    expect(beforeRestart.results).toHaveLength(4);
    const restarted = await worker(h, 'RUN', h.now.getTime());
    expect(restarted.result.type).toBe('DONE');
    expect(await snapshot(h)).toEqual(beforeRestart);
    const leaderboard = await h.competition.hourlyLeaderboard(round);
    expect(leaderboard!.entries.map((x) => x.rank)).toEqual([1, 1, 3, 4]);
    const aResult = (
      await h.database.pool.query('select * from hourly_results where user_id=$1', [a.id])
    ).rows[0];
    expect(aResult.hourly_pnl_lamports).toBe('-40116378');
    const pool = await fixtureFunding(h, round);
    const same = await finalizeHourlyRewardPool(h.database, {
      hourlyRoundId: round,
      now: new Date(cutoff + 62000),
    });
    expect(same).toEqual(pool);
    const plan = await generateHourlyShadowPayoutPlan(h.database, {
      hourlyRoundId: round,
      now: new Date(cutoff + 62000),
    });
    const audit = await getPayoutPlanAudit(h.database, plan.id);
    expect(audit!.conservation.holds).toBe(true);
    notes['rewardPool'] = pool;
    notes['payoutPlan'] = audit;
    notes['leaderboard'] = leaderboard;
    notes['settledReconciliation'] = await balances(h);
    const entered = await h.competition.enterRound(a.id);
    expect(entered.paperSolBalanceLamports).toBe(10000000000n);
    notes['nextHourAccount'] = entered;
    h.now = new Date(cutoff + 3600100);
    await worker(h, 'RUN', h.now.getTime());
    await worker(h, 'RUN', h.now.getTime());
    const daily = (
      await h.database.pool.query(
        'select cumulative_pnl_lamports,completed_hourly_round_count from daily_results where user_id=$1',
        [a.id],
      )
    ).rows[0];
    expect(daily.cumulative_pnl_lamports).toBe('-40116378');
    expect(daily.completed_hourly_round_count).toBe(2);
    expect(
      (await h.database.pool.query('select count(*)::int n from daily_result_hourly_results'))
        .rows[0].n,
    ).toBe(5);
    expect(
      (await h.database.pool.query('select count(*)::int n from payout_executions')).rows[0].n,
    ).toBe(0);
    expect(
      (
        await h.database.pool.query(
          "select count(*)::int n from payout_plans where state not in ('CALCULATED','FROZEN','VALIDATED')",
        )
      ).rows[0].n,
    ).toBe(0);
    notes['final'] = await snapshot(h);
    await balances(h);
  } finally {
    writeFileSync(root + 'recovery-results-' + Date.now() + '.json', encode(notes));
    await clean(h);
  }
});
it('missing exit evidence and genuine retained dust recover to explicit durable REVIEW, never a fictional score', async () => {
  const h = new ReplayHarness(),
    notes: Record<string, unknown> = {
      financialInput: 'Same archived prices and quotes, mocked time/slot labels only.',
    };
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    const first = await recoveryTick(
        h.database,
        h.router,
        h.now,
        h.policy,
        'CONTROLLED_ARCHIVED_REPLAY',
        h.token,
      ),
      round = first.ensured.currentRoundId;
    const i = h.original.identity,
      a = await h.user(),
      b = await h.user();
    const buy = await h.buy(a, i, '0.1');
    expect(buy.statusCode, buy.body).toBe(200);
    expect((await h.buy(b, i, '0.1')).statusCode).toBe(200);
    const tiny = await h.sell(
      a,
      i,
      (BigInt(buy.json().tokenQuantityReceivedBaseUnits) - 1n).toString(),
    );
    expect(tiny.statusCode, tiny.body).toBe(200);
    expect(tiny.json().remainingQuantityBaseUnits).toBe('1');
    expect(tiny.json().remainingCostBasisLamports).toBe('1');
    h.now = new Date(cutoff + 100);
    await worker(h, 'RUN', h.now.getTime(), 'CONTROLLED_ARCHIVED_REPLAY', true);
    await worker(h, 'RUN', h.now.getTime());
    await worker(h, 'RUN', h.now.getTime());
    const before = await snapshot(h);
    expect(before.holds[0].status).toBe('REVIEW_REQUIRED');
    expect(before.holds[0].attempts).toBe(3);
    await worker(h, 'RUN', h.now.getTime());
    expect(await snapshot(h)).toEqual(before);
    await expect(h.competition.hourlyLeaderboard(round)).rejects.toThrow('finalized');
    await fixtureFunding(h, round);
    await expect(
      generateHourlyShadowPayoutPlan(h.database, {
        hourlyRoundId: round,
        now: new Date(cutoff + 62000),
      }),
    ).rejects.toThrow();
    const p = (
      await h.database.pool.query(
        'select remaining_base_units,cost_basis_lamports from positions where competition_account_id=$1',
        [a.accountId],
      )
    ).rows[0];
    expect(p).toEqual({ remaining_base_units: '1', cost_basis_lamports: '1' });
    expect(
      (
        await h.database.pool.query(
          "select count(*)::int n from journal_transactions where source_entity_type='SETTLEMENT_WRITEOFF'",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await h.database.pool.query('select count(*)::int n from payout_plans')).rows[0].n,
    ).toBe(0);
    notes['final'] = await snapshot(h);
    notes['reconciliation'] = await balances(h);
  } finally {
    writeFileSync(root + 'dust-review-results-' + Date.now() + '.json', encode(notes));
    await clean(h);
  }
});
it('unapproved real cutoff selection never fills a lucky first market and overdue restart preserves REVIEW', async () => {
  const h = new ReplayHarness(),
    notes: Record<string, unknown> = {
      financialInput:
        'Archived economic data, controlled fixture chronology. LIVE_POLICY_UNAPPROVED tests refusal, not a real fill.',
    };
  try {
    h.now = new Date(cutoff - 500);
    await h.start();
    const first = await recoveryTick(
        h.database,
        h.router,
        h.now,
        h.policy,
        'CONTROLLED_ARCHIVED_REPLAY',
        h.token,
      ),
      round = first.ensured.currentRoundId,
      u = await h.user();
    expect((await h.buy(u, h.original.identity, '0.1')).statusCode).toBe(200);
    h.now = new Date(cutoff + 7200100);
    for (let n = 0; n < 3; n++) await worker(h, 'RUN', h.now.getTime(), 'LIVE_POLICY_UNAPPROVED');
    const held = await snapshot(h);
    expect(held.holds.find((x) => x.round_id === round).status).toBe('REVIEW_REQUIRED');
    expect(held.results).toHaveLength(0);
    expect(JSON.stringify(held.holds)).toContain(REQUIRED_CUTOFF_POLICY);
    await worker(h, 'RUN', h.now.getTime(), 'LIVE_POLICY_UNAPPROVED');
    expect(await snapshot(h)).toEqual(held);
    expect((await h.database.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(1);
    notes['final'] = held;
    notes['reconciliation'] = await balances(h);
  } finally {
    writeFileSync(root + 'policy-hold-results-' + Date.now() + '.json', encode(notes));
    await clean(h);
  }
});
