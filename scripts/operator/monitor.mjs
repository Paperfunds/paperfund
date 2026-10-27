import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, json, hash } from './common.mjs';
import { publicError } from './errors.mjs';
export const STATE = resolve(ROOT, 'logs/operator/fees-state.json');
export async function readMonitor() {
  try {
    return JSON.parse(await readFile(STATE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, status: 'NOT_STARTED', receipts: {} };
    throw Error('MONITOR_STATE_UNREADABLE', { cause: e });
  }
}
export async function writeMonitor(state) {
  await mkdir(resolve(ROOT, 'logs/operator'), { recursive: true });
  const tmp = STATE + '.' + process.pid + '.tmp';
  await writeFile(tmp, json(state), { mode: 0o600 });
  await rename(tmp, STATE);
}
export function reconcileObservation(state, observation, now = new Date().toISOString()) {
  const receipts = { ...(state.receipts ?? {}) };
  let added = 0;
  for (const r of observation.received?.receipts ?? []) {
    if (receipts[r.identity] && hash(json(receipts[r.identity])) !== hash(json(r)))
      throw Error('RECEIPT_IDENTITY_CONFLICT');
    if (!receipts[r.identity]) {
      receipts[r.identity] = r;
      added++;
    }
  }
  return {
    ...state,
    version: 1,
    status: observation.received?.error ? 'PARTIAL' : 'RUNNING',
    lastCheckedAt: now,
    lastSuccessfulObservation: observation,
    lastSuccessfulObservationAt: observation.observedAt,
    nextObservationAt: new Date(Date.parse(now) + 3600000).toISOString(),
    lastError: observation.received?.error ?? null,
    receipts,
    newReceipts: added,
    fundingLedgerCredit: '0',
    automaticClaiming: {
      enabled: false,
      reason: 'SEPARATE_TRANSACTION_APPROVAL_AND_ENROLLED_SIGNER_REQUIRED',
    },
  };
}
export function failedObservation(state, error, now = new Date().toISOString()) {
  return {
    ...state,
    status: 'RETRYING',
    lastCheckedAt: now,
    lastError: publicError(error),
    nextObservationAt: new Date(Date.parse(now) + 60000).toISOString(),
  };
}
export async function monitorStatus() {
  const state = await readMonitor();
  let heartbeat;
  try {
    heartbeat = JSON.parse(
      await readFile(resolve(ROOT, 'logs/operator/fees-heartbeat.json'), 'utf8'),
    );
  } catch {
    /* No heartbeat means observer unavailable. */
  }
  const age = Date.now() - Date.parse(heartbeat?.heartbeatAt);
  const alive = Number.isFinite(age) && age >= -1000 && age < 30000;
  return {
    ...state,
    status: alive ? state.status : 'NOT_RUNNING',
    heartbeatAt: heartbeat?.heartbeatAt ?? null,
    processId: heartbeat?.processId ?? null,
    mode: 'READ_ONLY_NO_KEY_NO_FINANCIAL_EFFECTS',
  };
}
