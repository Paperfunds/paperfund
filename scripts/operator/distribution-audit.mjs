// Read-only production capture. Never imports signing or execution entry points.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withReadonlyDatabase } from './treasury.mjs';
import { discover, readonlyRpc } from './discovery.mjs';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const profile = read(path.join(process.env.LOCALAPPDATA, 'PaperfundOperator/runtime.json'));
const config = read(profile.operator.environmentFile);
const out = { at: new Date().toISOString(), readOnly: true };
out.database = await withReadonlyDatabase(async (c) => {
  const query = async (s, args = []) => (await c.query(s, args)).rows;
  const schema = await query(
    "select table_name,column_name,data_type from information_schema.columns where table_schema='public' order by table_name,ordinal_position",
  );
  const tables = new Set(schema.map((r) => r.table_name));
  const held = {};
  for (const t of ['legacy_source_reviews', 'legacy_settlement_liquidations'])
    held[t] = await query(`select * from ${t} order by 1`);
  held.positions = await query(
    'select * from positions where id in(select position_id from legacy_source_reviews) order by id',
  );
  held.accounts = await query(
    'select * from competition_accounts where id in(select competition_account_id from positions where id in(select position_id from legacy_source_reviews)) order by id',
  );
  const accounts = await query(
    "select a.*,u.wallet_address,r.state round_state,r.starts_at,r.ends_at_exclusive from competition_accounts a join users u on u.id=a.user_id join hourly_rounds r on r.id=a.hourly_round_id where r.starts_at>='2026-10-26T00:00:00Z' order by r.starts_at desc,a.id",
  );
  const ids = accounts.map((a) => a.id);
  const detail = {};
  for (const t of [
    'positions',
    'competition_token_slots',
    'orders',
    'journal_transactions',
    'ledger_entries',
    'hourly_results',
  ]) {
    const cols = schema.filter((r) => r.table_name === t).map((r) => r.column_name);
    if (cols.includes('competition_account_id'))
      detail[t] = await query(
        `select * from ${t} where competition_account_id=any($1::text[]) order by 1`,
        [ids],
      );
  }
  detail.fills = await query(
    'select f.* from fills f join orders o on o.id=f.order_id where o.competition_account_id=any($1::text[]) order by f.executed_at,f.id',
    [ids],
  );
  detail.evidence = await query(
    'select e.* from market_state_evidence e where e.id in(select f.market_state_evidence_id from fills f join orders o on o.id=f.order_id where o.competition_account_id=any($1::text[])) order by e.id',
    [ids],
  );
  const financial = {};
  for (const t of [
    'payout_stop_state',
    'creator_fee_ingestion_checkpoints',
    'creator_fee_reconciliation_findings',
    'payout_treasury_receipts',
    'payout_treasury_reservations',
    'payout_treasury_settlements',
    'mainnet_source_acceptances',
  ])
    if (tables.has(t)) financial[t] = await query(`select * from ${t} order by 1`);
  const counts = {};
  for (const t of [
    'orders',
    'fills',
    'journal_transactions',
    'ledger_entries',
    'competition_accounts',
    'creator_fee_events',
    'payout_executions',
    'payout_signed_transactions',
    'payout_broadcast_attempts',
    'legacy_source_reviews',
  ])
    counts[t] = (await query(`select count(*)::text n from ${t}`))[0].n;
  return {
    schema,
    counts,
    heldSHA256: digest(held),
    reviews: held.legacy_source_reviews,
    accounts,
    detail,
    financial,
    control: await query("select * from app_meta where key='generic_pumpswap_operator_control_v1'"),
    models: await query(
      'select adapter_version,count(*)::text n from fills group by adapter_version',
    ),
    recentRounds: await query('select * from hourly_rounds order by starts_at desc limit 8'),
  };
}, config.DATABASE_URL);
out.config = Object.fromEntries(
  [
    'PRIVATE_BETA_NON_PAYING',
    'PAYOUT_EXECUTION_ENABLED',
    'PAYOUT_SIGNER_TYPE',
    'CREATOR_FEE_INGESTION_ENABLED',
    'CREATOR_FEE_SHADOW_MODE',
    'PAPERFUND_TOKEN_MINT',
    'PAPERFUND_CREATOR_WALLET',
  ].map((k) => [k, config[k] ?? null]),
);
out.heartbeat = read('logs/worker-heartbeat.json');
out.http = await Promise.all(
  [
    'http://127.0.0.1:3000/ready',
    'https://api.paperfund.app/ready',
    'https://paperfund.app',
    'https://app.paperfund.app',
  ].map(async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      return { url, status: r.status, body: url.endsWith('/ready') ? await r.text() : undefined };
    } catch {
      return { url, error: 'UNAVAILABLE' };
    }
  }),
);
try {
  const { rpc } = await readonlyRpc();
  out.creator = await discover(rpc);
} catch (e) {
  out.creator = { error: e.message };
}
const dir = 'docs/reward-distribution-20261026';
fs.mkdirSync(dir, { recursive: true });
const dest = path.join(dir, `audit-${Date.now()}.json`);
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify(
    {
      file: dest,
      counts: out.database.counts,
      heldSHA256: out.database.heldSHA256,
      accounts: out.database.accounts.map((a) => ({ id: a.id, round: a.hourly_round_id })),
      http: out.http,
      creator: out.creator,
    },
    null,
    2,
  ),
);
