import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { withReadonlyDatabase } from './treasury.mjs';
import {
  replayPersistedFill,
  reconcileAccountLedger,
} from '../../packages/db/src/financial-service.js';
import { createProductionExecutionRouter } from '../../packages/protocols/src/production.js';
import type { DatabaseService } from '../../packages/db/src/database.js';
import {
  currentQuoteHourlyProof,
  currentQuoteDailyProof,
} from '../../packages/db/src/current-quote-proof.js';
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const profile = read(path.join(process.env.LOCALAPPDATA!, 'PaperfundOperator/runtime.json'));
const cfg = read(profile.operator.environmentFile);
const router = createProductionExecutionRouter({
  rpcUrl: 'https://invalid.invalid',
  rpcTimeoutMs: 1,
  commitment: 'finalized',
  genericPumpSwapEnabled: true,
});
const result = await withReadonlyDatabase(async (c: PoolClient) => {
  const db = {
    pool: {
      query: c.query.bind(c),
      connect: async () => ({ query: c.query.bind(c), release() {} }),
    },
  } as unknown as DatabaseService;
  const accounts = (
    await c.query(
      "select a.id from competition_accounts a join hourly_rounds h on h.id=a.hourly_round_id where h.starts_at>='2026-10-26T00:00:00Z' order by a.id",
    )
  ).rows;
  const ledgers = [];
  for (const a of accounts)
    ledgers.push({ account: a.id, reconciliation: await reconcileAccountLedger(db, a.id) });
  const fills = (
    await c.query(
      "select f.id from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id join hourly_rounds h on h.id=a.hourly_round_id where h.starts_at>='2026-10-26T00:00:00Z' order by f.executed_at,f.id",
    )
  ).rows;
  const replays = [];
  for (const f of fills) {
    try {
      replays.push(await replayPersistedFill(db, router, f.id));
    } catch (e) {
      replays.push({
        fillId: f.id,
        matched: false,
        message: e instanceof Error ? e.message : 'REPLAY_FAILED',
      });
    }
  }
  const rounds = (
    await c.query(
      "select distinct a.hourly_round_id from competition_accounts a join hourly_rounds h on h.id=a.hourly_round_id where h.starts_at>='2026-10-26T00:00:00Z' order by a.hourly_round_id",
    )
  ).rows;
  const proofs = [];
  for (const r of rounds) proofs.push(await currentQuoteHourlyProof(db, router, r.hourly_round_id));
  const days = (await c.query("select id from daily_competitions where utc_date='2026-10-26'"))
    .rows;
  const dailyProofs = [];
  for (const d of days) dailyProofs.push(await currentQuoteDailyProof(db, router, d.id));
  return { ledgers, replays, proofs, dailyProofs };
}, cfg.DATABASE_URL);
const out = { at: new Date().toISOString(), readOnly: true, networkMarketReads: false, ...result };
fs.writeFileSync(
  'docs/reward-distribution-20261026/replay.json',
  JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
);
console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
