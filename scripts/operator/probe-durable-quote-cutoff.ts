// Live market/durability probe ONLY. Isolated DB, no competition accounts, trades or entitlements.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { readSetting } from './common.mjs';
import { createProductionExecutionRouter } from '../../packages/protocols/src/production.js';
import {
  captureCutoffState,
  verifyDurableQuoteCutoff,
  type CurrentCutoffCapture,
  type CutoffHeader,
} from '../../packages/protocols/src/cutoff-capture.js';
import { FinalizedRpc } from '../../apps/api/isolated/verified-routes/finalized-connector.js';
const url = await readSetting('SOLANA_RPC_URL');
if (!url) throw Error('RPC_NOT_CONFIGURED');
const root = 'docs/reward-accounting-20261027',
  name = 'durable_probe_' + randomUUID().replaceAll('-', '');
fs.mkdirSync(root, { recursive: true });
const admin = new Pool({
  connectionString: 'postgresql://beta:disposable-beta-only@127.0.0.1:55462/beta',
});
const cutoff = new Date(Math.ceil((Date.now() + 30000) / 3600000) * 3600000);
const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
const router = createProductionExecutionRouter({
    rpcUrl: url,
    rpcTimeoutMs: 3000,
    commitment: 'confirmed',
  }),
  rpc = new FinalizedRpc(url, 3000);
const errors: string[] = [];
let pool: Pool | undefined;
try {
  await admin.query('create database "' + name + '"');
  pool = new Pool({
    connectionString: 'postgresql://beta:disposable-beta-only@127.0.0.1:55462/' + name,
  });
  await pool.query(`create table captures(id text primary key,body jsonb not null,at_time timestamptz not null default clock_timestamp(),xid xid8 not null default pg_current_xact_id());
 create table certificates(id text primary key references captures(id),at_time timestamptz not null,marker pg_lsn not null,flushed pg_lsn not null);
 create function certify(cid text,cutoff timestamptz) returns boolean language plpgsql as $$declare c captures;m pg_lsn;f pg_lsn;t timestamptz;begin
 select * into strict c from captures where id=cid;if c.xid=pg_current_xact_id_if_assigned() then raise exception 'UNCOMMITTED_CAPTURE';end if;
 if current_setting('fsync')<>'on' or current_setting('full_page_writes')<>'on' then raise exception 'DURABILITY_NOT_QUALIFIED';end if;
 m:=pg_logical_emit_message(false,'paperfund-quote-probe',cid,true);f:=pg_current_wal_flush_lsn();t:=clock_timestamp();
 if f<m or t+interval '100 milliseconds'>=cutoff then raise exception 'NOT_DURABLE_PRE_CUTOFF';end if;
 insert into certificates values(cid,t,m,f) on conflict do nothing;return true;end $$;`);
  const mint = '3JVd8Z3kEEXBaBoZo9rcWk4MHJPSUAf6zAjvAF5spump';
  while (Date.now() < +cutoff - 300) {
    if (Date.now() < +cutoff - 15000) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    try {
      const c = await captureCutoffState(async () => {
        const id = await router.mintResolver!(mint);
        return (await router.loadPositionRoute(id)).state;
      }, 'confirmed');
      await pool.query(
        'insert into captures(id,body) values($1,$2::jsonb) on conflict do nothing',
        [c.hash, json(c)],
      );
      await pool.query('select certify($1,$2)', [c.hash, cutoff]);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'CAPTURE_FAILED');
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const rows = (
    await pool.query(
      'select c.*,p.at_time certified_at,p.marker,p.flushed from captures c join certificates p using(id) order by c.at_time desc,c.id',
    )
  ).rows;
  const row = rows[0];
  let technicalQualified = false,
    header: CutoffHeader | undefined,
    finalizedAt: Date | undefined;
  if (row) {
    const c = {
      ...row.body,
      evidence: { ...row.body.evidence, chainSlot: BigInt(row.body.evidence.chainSlot) },
    } as CurrentCutoffCapture;
    while (Date.now() < +cutoff + 59000) {
      try {
        const result = await rpc.call<Omit<CutoffHeader, 'slot'>>('getBlock', [
          Number(c.evidence.chainSlot),
          {
            commitment: 'finalized',
            transactionDetails: 'none',
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ]);
        if (result) {
          header = { ...result, slot: Number(c.evidence.chainSlot) };
          finalizedAt = (await pool.query('select clock_timestamp() at_time')).rows[0].at_time;
          verifyDurableQuoteCutoff(c, header, cutoff, {
            receivedAt: row.at_time,
            certifiedAt: row.certified_at,
            finalizedAt: finalizedAt!,
            maxAgeMs: 10000,
            uncertaintyMs: 100,
          });
          technicalQualified = true;
          break;
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'FINALITY_FAILED');
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const out = {
    at: new Date().toISOString(),
    cutoff,
    network: 'mainnet-beta',
    mint,
    technicalQualified,
    rows,
    header,
    finalizedAt,
    errors,
    productionReadOnly: true,
    isolatedDatabase: name,
    competitionAccountsCreated: 0,
    entitlementsCreated: 0,
    financialAccepted: false,
    reason:
      'Market and WAL probe only; authenticated UTC/provider and genuine competition qualification remain separate',
  };
  const path = root + '/live-durable-cutoff.json',
    fd = fs.openSync(path, 'wx');
  try {
    fs.writeFileSync(fd, json(out) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  console.log(
    json({ cutoff, technicalQualified, captures: rows.length, financialAccepted: false }),
  );
} finally {
  if (pool) await pool.end();
  await admin.query('drop database if exists "' + name + '" with(force)');
  await admin.end();
}
