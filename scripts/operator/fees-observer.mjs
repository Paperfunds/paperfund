import {captureRoundEvidence} from './round-evidence.mjs';
import {captureDelay} from './round-evidence-core.mjs';
import pg from 'pg';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, readSetting, json } from './common.mjs';
import { captureDiscovery } from './discovery.mjs';
import { readMonitor, writeMonitor, reconcileObservation, failedObservation } from './monitor.mjs';
const pool = new pg.Pool({
  connectionString: await readSetting('DATABASE_URL'),
  max: 1,
  connectionTimeoutMillis: 3000,
  application_name: 'paperfund-readonly-fee-monitor',
  options: '-c default_transaction_read_only=on',
});
const client = await pool.connect();
let stopping = false,
  heartbeatTimer, nextEvidenceAt=0;
client.on('error', () => {
  console.error('MONITOR_LOCK_CONNECTION_LOST');
  process.exitCode = 1;
  stopping = true;
});
const locked = (await client.query('select pg_try_advisory_lock(3188,20261019) locked')).rows[0]
  .locked;
if (!locked) {
  client.release();
  await pool.end();
  throw Error('FEE_MONITOR_ALREADY_RUNNING');
}
const startedAt = new Date().toISOString();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    stopping = true;
  });
try {
  let state = await readMonitor();
  await mkdir(resolve(ROOT, 'logs/operator'), { recursive: true });
  const heartbeat = () =>
    writeFile(
      resolve(ROOT, 'logs/operator/fees-heartbeat.json'),
      json({
        processId: process.pid,
        startedAt,
        heartbeatAt: new Date().toISOString(),
        nextObservationAt: state.nextObservationAt,
        mode: 'READ_ONLY_NO_CLAIM_NO_SIGN_NO_SEND',
      }),
    );
  await heartbeat();
  heartbeatTimer = setInterval(
    () =>
      heartbeat().catch(() => {
        stopping = true;
        process.exitCode = 1;
      }),
    10000,
  );
  while (!stopping) {
    if(Date.now()>=nextEvidenceAt){try{await captureRoundEvidence();}catch{console.error('ROUND_EVIDENCE_CAPTURE_FAILED_REVIEW');}nextEvidenceAt=Date.now()+captureDelay(Date.now());}

    if (!state.nextObservationAt || Date.parse(state.nextObservationAt) <= Date.now()) {
      try {
        state = reconcileObservation(state, await captureDiscovery());
      } catch (e) {
        state = failedObservation(state, e);
      }
      await writeMonitor(state);
      await heartbeat();
      console.log(
        json({
          event: 'fee_monitor_check',
          status: state.status,
          lastCheckedAt: state.lastCheckedAt,
          nextObservationAt: state.nextObservationAt,
          error: state.lastError,
        }),
      );
    }
    await new Promise((ok) => setTimeout(ok, 1000));
  }
} finally {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await client.query('select pg_advisory_unlock(3188,20261019)').catch(() => {});
  client.release();
  await pool.end();
}
