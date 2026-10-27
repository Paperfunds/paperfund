import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { createRedis } from '../../../../apps/api/src/redis.js';
import { reconcileAccountLedger, replayPersistedFill } from '@paperfund/db';
import { AtomicHarness } from '../simple-price-v2-atomic/live-harness.js';
import { settlePrivate } from '../../integration/simple-price-v2/settlement.js';
import { NON_SOL_SAMPLES } from '../simple-price-v2/non-sol.js';

const run = Date.now(),
  root = 'artifacts/simple-price-v2-cutoff-review/';
const encode = (v: unknown) =>
  JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
const log = (event: string, data: unknown = {}) => {
  const row = { at: new Date().toISOString(), event, data };
  appendFileSync(root + run + '-events.jsonl', encode(row) + '\n');
  console.log(encode(row));
};
const markets = [
  { name: 'SOL', mint: '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump', kind: 'SOL' as const },
  { name: 'TUSD', mint: NON_SOL_SAMPLES[1].mint, kind: 'NON_SOL' as const },
  { name: 'GOOG', mint: NON_SOL_SAMPLES[0].mint, kind: 'NON_SOL' as const },
];
type User = Awaited<ReturnType<AtomicHarness['user']>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it.skipIf(process.env['PAPERFUND_V2_ACTUAL_CUTOFF'] !== '1')(
  'two consecutive actual UTC cutoffs, real market evidence and disposable accounting',
  async () => {
    const h = new AtomicHarness(),
      token = randomUUID(),
      label = 'paperfund.v2.cutoff=' + token;
    let redisId: string | undefined, queue: Redis | undefined;
    const results: unknown[] = [],
      failures: unknown[] = [];
    const roundCount = process.env['PAPERFUND_V2_REMAINING_CUTOFFS'] === '1' ? 1 : 2;
    let ownedDirectory: string | undefined;
    const startOwner = h.owner.start.bind(h.owner);
    h.owner.start = async () => {
      const owned = await startOwner();
      ownedDirectory = owned.directory;
      return owned;
    };
    async function balance(u: User) {
      const r = await reconcileAccountLedger(h.database, u.accountId);
      expect(r.reconciled).toBe(true);
      expect(r.balancedJournalCount).toBe(r.journalCount);
      return r;
    }
    async function action(
      name: string,
      work: () => Promise<{ statusCode: number; json(): unknown }>,
    ) {
      const r = await work();
      const data = { name, status: r.statusCode, body: r.json() };
      log('API', data);
      if (r.statusCode !== 200) failures.push(data);
      return r;
    }
    try {
      redisId = execFileSync(
        'docker',
        [
          'run',
          '--detach',
          '--rm',
          '--pull=never',
          '--name',
          'paperfund-v2-cutoff-' + token,
          '--label',
          label,
          '--publish',
          '127.0.0.1::6379',
          '--tmpfs',
          '/data:rw,size=64m',
          'redis:8-alpine',
          'redis-server',
          '--save',
          '',
          '--appendonly',
          'no',
        ],
        { encoding: 'utf8' },
      ).trim();
      const info = JSON.parse(
        execFileSync('docker', ['inspect', redisId], { encoding: 'utf8' }),
      )[0];
      const port = info.NetworkSettings.Ports['6379/tcp'][0];
      expect(port.HostIp).toBe('127.0.0.1');
      expect(
        info.Mounts.some((m: { Type: string }) => m.Type === 'bind' || m.Type === 'volume'),
      ).toBe(false);
      const url = 'redis://127.0.0.1:' + port.HostPort;
      const realRedis = createRedis(url);
      expect(await realRedis.healthCheck()).toBe(true);
      Object.assign(h.redis, realRedis);
      queue = new Redis(url);
      await h.start();
      // Observability only: retain actual immutable captures and the execution time passed by the core.
      for (const method of ['captureSol', 'captureNonSol'] as const) {
        const original = h.adapter.provider[method].bind(h.adapter.provider);
        Object.assign(h.adapter.provider, {
          [method]: async (mint: string) => {
            const capture = await original(mint);
            writeFileSync(
              root + run + '-capture-' + Date.now() + '-' + method + '.json',
              encode(capture),
            );
            return capture;
          },
        });
      }
      const originalSell = h.adapter.simulateSell.bind(h.adapter);
      h.adapter.simulateSell = async (request, state) => {
        log('SELL_TIME_DIAGNOSTIC', {
          executedAt: request.executedAt,
          observedAt: state.observedAt,
          chainSlot: state.chainSlot,
          normalized: state.normalizedState['candidate'],
        });
        return originalSell(request, state);
      };
      log('ENVIRONMENT', {
        postgres:
          'new UUID-owned tmpfs PostgreSQL 17, twelve existing migrations plus private schema',
        redisId,
        redisPort: port.HostPort,
        redis: 'new tmpfs Redis 8',
        api: 'Fastify.inject, real AuthService/financial service',
        clock: 'actual Date.now/new Date, no fake timers',
        worker:
          'isolated SQL settlement wrapper with Redis job/checkpoint; no production worker entry point',
        providers: ['Solana public', 'PublicNode SOL delegate', 'configured Helius non-SOL'],
      });
      for (const m of markets) {
        try {
          await h.register(m.mint, m.kind);
          log('REGISTERED', m);
        } catch {
          log('REGISTRATION_UNAVAILABLE', m);
          failures.push({ registration: m.name });
        }
      }
      let nextRound: Awaited<ReturnType<AtomicHarness['round']>> | undefined;
      for (let n = 0; n < roundCount; n++) {
        const round = nextRound ?? (await h.round());
        const users: User[] = [];
        log('ROUND_OPEN', { n, ...round });
        // Independent accounts prevent one unavailable market from suppressing another market's validation.
        for (const m of markets) {
          const u = await h.user();
          users.push(u);
          expect(
            (
              await h.database.pool.query(
                'select paper_sol_balance_lamports::text cash from competition_accounts where id=$1',
                [u.accountId],
              )
            ).rows[0].cash,
          ).toBe('10000000000');
          if (!h.markets.has(m.mint)) continue;
          const i = h.markets.get(m.mint)!;
          const a = await action(m.name + ' BUY', () => h.buy(u, i, '0.1'));
          if (a.statusCode === 200) {
            await action(m.name + ' duplicate BUY', () =>
              h.buy(u, i, '0.05', 'repeat-' + round.id + '-' + m.name),
            );
            await action(m.name + ' duplicate BUY replay', () =>
              h.buy(u, i, '0.05', 'repeat-' + round.id + '-' + m.name),
            );
            const rows = (
              await h.database.pool.query(
                "select remaining_base_units::text q from positions where competition_account_id=$1 and status='OPEN'",
                [u.accountId],
              )
            ).rows;
            if (rows[0])
              await action(m.name + ' partial SELL', () =>
                h.sell(u, i, (BigInt(rows[0].q) / 2n).toString()),
              );
            await action(m.name + ' valuation', () => h.positions(u));
            await action(m.name + ' SELL ALL', () => h.sell(u, i));
            await action(m.name + ' reBUY for cutoff', () => h.buy(u, i, '0.1'));
            // Leave a genuine open remainder for forced settlement.
          }
          log('PRE_CUTOFF_RECONCILIATION', {
            n,
            market: m.name,
            account: u.accountId,
            reconciliation: await balance(u),
          });
        }
        // Flat accounts create a real competition tie without fabricated financial transactions.
        users.push(await h.user(), await h.user());
        const cap = await action('20% rejection', () =>
          h.buy(users[3]!, h.markets.get(markets[0]!.mint)!, '2.1'),
        );
        expect(cap.statusCode).not.toBe(200);
        log('WORKER_PAUSED', { round: round.id, persistedJob: true });
        await queue.rpush('cutoff:jobs', round.id);
        await queue.set(
          'cutoff:checkpoint',
          encode({ round: round.id, status: 'WAITING', cutoff: round.cutoff }),
        );
        while (Date.now() < round.cutoff.getTime()) {
          await sleep(Math.min(55000, round.cutoff.getTime() - Date.now()));
          log('REAL_CLOCK_WAIT', { cutoff: round.cutoff });
        }
        const lagMs = Date.now() - round.cutoff.getTime();
        // A resumed machine must not label a later hourly window as the requested boundary.
        if (lagMs >= 3600000) {
          log('CUTOFF_WINDOW_MISSED', { n, expected: round.cutoff, lagMs });
          throw Error('ACTUAL_BOUNDARY_NOT_OBSERVED_NO_LATE_REHEARSAL');
        }
        log('ACTUAL_CUTOFF_OBSERVED', {
          n,
          expected: round.cutoff,
          lagMs,
        });
        // The original API must reject the ended window even before a settlement pass transitions state.
        const late = await action('post-cutoff BUY', () =>
          h.buy(users[3]!, h.markets.get(markets[0]!.mint)!, '0.1'),
        );
        expect(late.statusCode).not.toBe(200);
        // Next hour opens independently of the prior round's settlement/hold.
        nextRound = await h.round();
        log('NEXT_ROUND_INDEPENDENT_OPEN', nextRound);
        const resetUser = await h.user();
        expect(
          (
            await h.database.pool.query(
              'select paper_sol_balance_lamports::text cash from competition_accounts where id=$1',
              [resetUser.accountId],
            )
          ).rows[0].cash,
        ).toBe('10000000000');
        log('NEXT_ROUND_FRESH_ACCOUNT', { id: resetUser.accountId, cash: '10000000000' });
        log('WORKER_RESUMED', {
          persisted: await queue.get('cutoff:checkpoint'),
          queued: await queue.lrange('cutoff:jobs', 0, -1),
        });
        const controls = [];
        // Three is the preserved private retry budget; never rearm a REVIEW_REQUIRED round.
        for (let attempt = 0; attempt < 3; attempt++) {
          const control = await settlePrivate(h.database, h.router, round.id, new Date());
          controls.push(control);
          log('SETTLEMENT_PASS', { n, control });
          if (control.status !== 'RETRY_PENDING') break;
          await sleep(3000);
        }
        const duplicate = await Promise.all([
          settlePrivate(h.database, h.router, round.id, new Date()),
          settlePrivate(h.database, h.router, round.id, new Date()),
        ]);
        log('DUPLICATE_SETTLEMENT', duplicate);
        await queue.lrem('cutoff:jobs', 1, round.id);
        await queue.set(
          'cutoff:checkpoint',
          encode({ round: round.id, status: controls.at(-1)?.status }),
        );
        const accountResults = [];
        for (const u of users)
          accountResults.push({ account: u.accountId, reconciliation: await balance(u) });
        const fills = (
          await h.database.pool.query(
            'select f.id from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id where a.hourly_round_id=$1',
            [round.id],
          )
        ).rows;
        for (const f of fills) await replayPersistedFill(h.database, h.router, f.id);
        const summary = {
          n,
          round,
          controls,
          duplicate,
          accounts: accountResults,
          hourly: (
            await h.database.pool.query('select * from hourly_results where hourly_round_id=$1', [
              round.id,
            ])
          ).rows,
          daily: (await h.database.pool.query('select * from daily_results')).rows,
          attribution: (
            await h.database.pool.query('select id,utc_date::text,state from daily_competitions')
          ).rows,
          leaderboard: await h.competition
            .hourlyLeaderboard(round.id)
            .catch(() => ({ status: 'UNAVAILABLE_NOT_FINALIZED' })),
          positions: (
            await h.database.pool.query(
              'select p.* from positions p join competition_accounts a on a.id=p.competition_account_id where a.hourly_round_id=$1',
              [round.id],
            )
          ).rows,
          writeoffs: (
            await h.database.pool.query(
              "select count(*) from journal_transactions where source_entity_type='SETTLEMENT_WRITEOFF'",
            )
          ).rows,
        };
        results.push(summary);
        writeFileSync(
          root + run + '-round-' + n + '.json',
          encode({
            summary,
            reviews: Object.fromEntries(h.adapter.provider.reviews),
            attempts: h.adapter.provider.attempts,
          }),
        );
        log('ROUND_RECONCILED', { n, control: controls.at(-1), accounts: accountResults });
        if (n === 0 && Date.now() >= round.cutoff.getTime() + 3600000)
          throw Error('MISSED_CONSECUTIVE_WINDOW');
      }
      writeFileSync(root + run + '-result.json', encode({ results, failures }));
      log('FINISHED', { rounds: results.length, failures: failures.length });
    } finally {
      writeFileSync(root + run + '-partial-result.json', encode({ results, failures }));
      if (h.database) {
        const tables = [
          'hourly_rounds',
          'competition_accounts',
          'positions',
          'orders',
          'fills',
          'market_state_evidence',
          'hourly_results',
          'daily_competitions',
          'daily_results',
          'daily_result_hourly_results',
          'private_v2.settlement_control',
          'private_v2.round_models',
          'private_v2.position_peaks',
          'competition_token_slots',
          'journal_transactions',
          'ledger_entries',
        ];
        const archive = await h.database.pool.query(
          'select json_build_object(' +
            tables
              .map(
                (t) =>
                  "'" +
                  t +
                  "',(select coalesce(json_agg(t),'[]'::json) from (select * from " +
                  t +
                  ') t)',
              )
              .join(',') +
            ') archive',
        );
        writeFileSync(root + run + '-financial-archive.json', encode(archive.rows[0].archive));
        if (ownedDirectory)
          cpSync(
            join(ownedDirectory, 'atomic-provider-authority'),
            root + run + '-provider-authority',
            { recursive: true, errorOnExist: true, force: false },
          );
        writeFileSync(
          root + run + '-final-database.json',
          encode({
            rounds: (await h.database.pool.query('select * from hourly_rounds')).rows,
            accounts: (await h.database.pool.query('select * from competition_accounts')).rows,
            holds: (await h.database.pool.query('select * from private_v2.settlement_control'))
              .rows,
            payoutCounts: (
              await h.database.pool.query(
                'select (select count(*) from payout_plans) plans,(select count(*) from payout_executions) executions',
              )
            ).rows,
          }),
        );
      }
      if (queue) await queue.quit();
      await h.close();
      if (redisId) {
        const info = JSON.parse(
          execFileSync('docker', ['inspect', redisId], { encoding: 'utf8' }),
        )[0];
        expect(info.Config.Labels['paperfund.v2.cutoff']).toBe(token);
        execFileSync('docker', ['rm', '--force', redisId], { stdio: 'ignore' });
      }
      log('OWNED_SERVICES_REMOVED');
    }
  },
);
