/** Explicit operator-only recovery. No HTTP endpoint, installer, env switch or automatic activation. */
import type { PoolClient } from 'pg';
import type { Head, LinkedStateStore } from './store.js';
import {
  digest,
  reconcileLinkedInterval,
  type LinkedBranch,
  type ProviderInterval,
} from '../../../protocols/isolated/linked-pair/external-flow.js';
import { gunzipSync } from 'node:zlib';
type Client = Pick<PoolClient, 'query'>;
const fail = (s: string): never => {
  throw Error('LINKED_RECOVERY_' + s);
};
export interface RecoveryProof {
  schema: 'LINKED_PROOF_RECOVERY_V1';
  accountId: string;
  roundId: string;
  generation: string;
  incidentHash: string;
  reason: string;
  revision: string;
  sequence: string;
  beforeHash: string;
  evidenceHash: string;
  afterHash: string;
  financialHash: string;
}
export interface RecoveryApproval {
  schema: 'LINKED_RECOVERY_APPROVAL_V1';
  proofHash: string;
  accountId: string;
  roundId: string;
  operator: string;
  reference: string;
  issuedAt: string;
  expiresAt: string;
  mode: 'RECOVERY_ONLY_BUY_DISABLED';
}
export interface RecoveryActivation {
  proof: RecoveryProof;
  approval: RecoveryApproval;
  nowMs: number;
}
export async function financialHash(c: Client, account: string) {
  const data: Record<string, unknown> = {};
  data.account = (
    await c.query('select to_jsonb(a) document from competition_accounts a where id=$1', [account])
  ).rows[0]?.document;
  if (!data.account) fail('ACCOUNT_MISSING');
  for (const table of ['orders', 'positions', 'journal_transactions', 'ledger_entries'])
    data[table] = (
      await c.query(
        `select to_jsonb(t) document from ${table} t where competition_account_id=$1 order by id`,
        [account],
      )
    ).rows.map((r) => r.document);
  data.fills = (
    await c.query(
      'select to_jsonb(f) document from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 order by f.id',
      [account],
    )
  ).rows.map((r) => r.document);
  data.receipts = (
    await c.query(
      'select to_jsonb(r) document from linked_candidate.receipts r where account_id=$1 order by revision',
      [account],
    )
  ).rows.map((r) => r.document);
  return digest(data);
}
async function original(c: Client, account: string) {
  return (
    await c.query('select * from linked_candidate.route_quarantine where account_id=$1', [account])
  ).rows[0];
}
async function latest(c: Client, account: string) {
  return (
    await c.query(
      'select i.*,r.proof_hash from linked_recovery_candidate.incidents i left join linked_recovery_candidate.resolutions r using(account_id,generation) where i.account_id=$1 order by i.generation desc limit 1',
      [account],
    )
  ).rows[0];
}
function unchangedIncident(interval: ProviderInterval, incidentHash: string) {
  if (digest(interval) === incidentHash) return;
  const old = structuredClone(interval);
  delete old.token2022;
  if (!interval.token2022 || digest(old) !== incidentHash) fail('INCIDENT_EVIDENCE_CHANGED');
}
export async function prepareRecovery(store: LinkedStateStore, interval: ProviderInterval) {
  if (!store.durableFlow) fail('DURABLE_FLOW_REQUIRED');
  const recovered = await store.recover(false),
    head = await store.load();
  if (digest(recovered) !== head.state_hash) fail('PREDECESSOR_CHANGED');
  const c = await store.db.pool.connect();
  try {
    await c.query('begin isolation level repeatable read read only');
    const q = await original(c, store.accountId);
    if (!q || digest(q.document) !== q.interval_hash) fail('INCIDENT_MISSING_OR_CORRUPT');
    const incident = store.proofRecovery
      ? ((await latest(c, store.accountId)) ?? { ...q, generation: '0' })
      : { ...q, generation: '0' };
    if (incident.proof_hash) fail('NO_UNRESOLVED_INCIDENT');
    if (digest(incident.document) !== incident.interval_hash) fail('INCIDENT_CORRUPT');
    unchangedIncident(interval, incident.interval_hash);
    if (digest(head.document.real) !== digest(interval.before)) fail('PREDECESSOR_CHANGED');
    const result = await reconcileLinkedInterval(
      head.document,
      interval,
      Date.parse(interval.after.observedAt),
      10000,
    );
    const proof: RecoveryProof = {
      schema: 'LINKED_PROOF_RECOVERY_V1',
      accountId: store.accountId,
      roundId: store.roundId,
      generation: String(incident.generation),
      incidentHash: incident.interval_hash,
      reason: incident.reason,
      revision: head.revision,
      sequence: head.flow_sequence ?? '0',
      beforeHash: head.state_hash,
      evidenceHash: digest(interval),
      afterHash: digest(result.branch),
      financialHash: await financialHash(c, store.accountId),
    };
    const check = (
      await c.query(
        'select b.revision,coalesce(h.state_hash,b.state_hash) state_hash,coalesce(h.sequence,0)::text flow_sequence from linked_candidate.branches b left join linked_flow_candidate.heads h on h.account_id=b.account_id and h.fill_revision=b.revision where b.account_id=$1',
        [store.accountId],
      )
    ).rows[0];
    if (
      check?.state_hash !== head.state_hash ||
      check.revision !== head.revision ||
      check.flow_sequence !== (head.flow_sequence ?? '0')
    )
      fail('PREDECESSOR_CHANGED');
    await c.query('commit');
    return {
      proof,
      proofHash: digest(proof),
      branch: result.branch,
      events: result.events,
      failedTransactions: result.failedTransactions,
    };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
export function validateApproval(a: RecoveryActivation, store: LinkedStateStore) {
  const { proof: p, approval: q, nowMs: now } = a;
  if (!store.proofRecovery || !store.durableFlow) fail('NOT_ENABLED');
  if (
    p.schema !== 'LINKED_PROOF_RECOVERY_V1' ||
    q.schema !== 'LINKED_RECOVERY_APPROVAL_V1' ||
    q.mode !== 'RECOVERY_ONLY_BUY_DISABLED' ||
    q.proofHash !== digest(p) ||
    p.accountId !== store.accountId ||
    q.accountId !== store.accountId ||
    p.roundId !== store.roundId ||
    q.roundId !== store.roundId ||
    !q.operator.trim() ||
    !q.reference.trim()
  )
    fail('APPROVAL_SCOPE');
  const from = Date.parse(q.issuedAt),
    until = Date.parse(q.expiresAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(from) ||
    !Number.isFinite(until) ||
    from > now ||
    until <= now ||
    until - from > 20 * 60000
  )
    fail('APPROVAL_TIME');
}
/** Run under account advisory/status locks. Only copies the original audit incident, never edits it. */
export async function recordIncident(
  c: Client,
  account: string,
  interval: ProviderInterval,
  reason: string,
) {
  const q = await original(c, account);
  if (!q || digest(q.document) !== q.interval_hash) fail('INCIDENT_CORRUPT');
  await c.query(
    'insert into linked_recovery_candidate.incidents values($1,0,$2,$3,$4::jsonb) on conflict do nothing',
    [account, q.interval_hash, q.reason, JSON.stringify(q.document)],
  );
  const last = await latest(c, account),
    hash = digest(interval);
  if (!last) fail('INCIDENT_MISSING');
  if (!last.proof_hash && last.interval_hash === hash && last.reason === reason) return;
  await c.query('insert into linked_recovery_candidate.incidents values($1,$2,$3,$4,$5::jsonb)', [
    account,
    (BigInt(last.generation) + 1n).toString(),
    hash,
    reason,
    JSON.stringify(interval),
  ]);
}
export async function checkActivation(
  c: Client,
  store: LinkedStateStore,
  a: RecoveryActivation,
  head: Head,
  interval: ProviderInterval,
) {
  validateApproval(a, store);
  const p = a.proof;
  if (
    p.beforeHash !== head.state_hash ||
    p.revision !== head.revision ||
    p.sequence !== (head.flow_sequence ?? '0') ||
    p.evidenceHash !== digest(interval) ||
    p.financialHash !== (await financialHash(c, store.accountId))
  )
    fail('PREDECESSOR_OR_FINANCIAL_CHANGED');
  const q = await original(c, store.accountId);
  if (!q || digest(q.document) !== q.interval_hash) fail('INCIDENT_MISSING');
  // First activation imports the original incident as generation0 with identical content.
  await c.query(
    'insert into linked_recovery_candidate.incidents values($1,0,$2,$3,$4::jsonb) on conflict do nothing',
    [store.accountId, q.interval_hash, q.reason, JSON.stringify(q.document)],
  );
  const incidents = (
    await c.query(
      'select i.* from linked_recovery_candidate.incidents i left join linked_recovery_candidate.resolutions r using(account_id,generation) where i.account_id=$1 and r.account_id is null order by generation',
      [store.accountId],
    )
  ).rows;
  if (
    incidents.length !== 1 ||
    String(incidents[0].generation) !== p.generation ||
    incidents[0].interval_hash !== p.incidentHash ||
    incidents[0].reason !== p.reason ||
    digest(incidents[0].document) !== p.incidentHash
  )
    fail('INCIDENT_CHANGED_OR_MULTIPLE_HOLDS');
  unchangedIncident(interval, p.incidentHash);
}
export async function recordResolution(
  c: Client,
  store: LinkedStateStore,
  a: RecoveryActivation,
  head: Head,
  branch: LinkedBranch,
  sequence: string,
) {
  if (
    digest(branch) !== a.proof.afterHash ||
    (await financialHash(c, store.accountId)) !== a.proof.financialHash
  )
    fail('SUCCESSOR_OR_FINANCIAL_CHANGED');
  await c.query(
    'insert into linked_recovery_candidate.resolutions values($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [
      store.accountId,
      a.proof.generation,
      digest(a.proof),
      digest(a.approval),
      head.revision,
      sequence,
      JSON.stringify({ proof: a.proof, approval: a.approval, predecessor: head.document }),
    ],
  );
}
const verified = new Set<string>();
/** Historical proof validation is not permission to BUY and never asserts quote freshness. */
export async function assertRecovered(c: Client, store: LinkedStateStore) {
  const q = (
    await c.query(
      'select interval_hash,reason from linked_candidate.route_quarantine where account_id=$1',
      [store.accountId],
    )
  ).rows[0];
  if (!q) return;
  const rows = (
    await c.query(
      'select i.account_id,i.generation,i.interval_hash,i.reason,r.proof_hash,r.approval_hash,r.fill_revision,r.sequence from linked_recovery_candidate.incidents i left join linked_recovery_candidate.resolutions r using(account_id,generation) where i.account_id=$1 order by i.generation',
      [store.accountId],
    )
  ).rows;
  if (
    !rows.length ||
    rows[0].generation !== '0' ||
    rows[0].interval_hash !== q.interval_hash ||
    rows[0].reason !== q.reason
  )
    fail('ORIGINAL_HOLD_NOT_PROVEN');
  let generation = 0n;
  for (const row of rows) {
    if (BigInt(row.generation) !== generation++) fail('INCIDENT_SEQUENCE_GAP');
    if (!row.proof_hash) fail('UNRESOLVED_INCIDENT:' + row.reason);
    const step = (
      await c.query(
        'select * from linked_flow_candidate.steps where account_id=$1 and fill_revision=$2 and sequence=$3',
        [store.accountId, row.fill_revision, row.sequence],
      )
    ).rows[0];
    if (!step) fail('RESOLUTION_STEP_MISSING');
    const key = digest({ round: store.roundId, row, step });
    if (verified.has(key)) continue;
    const full = (
      await c.query(
        'select i.document incident,r.document resolution from linked_recovery_candidate.incidents i join linked_recovery_candidate.resolutions r using(account_id,generation) where i.account_id=$1 and i.generation=$2',
        [store.accountId, row.generation],
      )
    ).rows[0];
    if (!full) fail('RESOLUTION_MISSING');
    const {
      proof: p,
      approval: a,
      predecessor,
    } = full.resolution as {
      proof: RecoveryProof;
      approval: RecoveryApproval;
      predecessor: LinkedBranch;
    };
    if (
      digest(p) !== row.proof_hash ||
      digest(a) !== row.approval_hash ||
      p.accountId !== store.accountId ||
      p.roundId !== store.roundId ||
      p.incidentHash !== row.interval_hash ||
      p.reason !== row.reason ||
      p.generation !== String(row.generation) ||
      digest(full.incident) !== p.incidentHash ||
      digest(predecessor) !== p.beforeHash ||
      a.proofHash !== row.proof_hash
    )
      fail('RESOLUTION_CORRUPT');
    validateApproval({ proof: p, approval: a, nowMs: Date.parse(a.issuedAt) }, store);
    if (
      !step ||
      step.before_hash !== p.beforeHash ||
      step.after_hash !== p.afterHash ||
      step.evidence_hash !== p.evidenceHash ||
      String(step.fill_revision) !== p.revision ||
      BigInt(step.sequence) !== BigInt(p.sequence) + 1n
    )
      fail('RESOLUTION_STEP_MISSING');
    const payload = (
      await c.query('select payload from linked_flow_candidate.evidence where hash=$1', [
        p.evidenceHash,
      ])
    ).rows[0]?.payload;
    if (!payload) fail('RESOLUTION_EVIDENCE_MISSING');
    const interval = JSON.parse(gunzipSync(payload).toString()) as ProviderInterval;
    if (digest(interval) !== p.evidenceHash) fail('RESOLUTION_EVIDENCE_CORRUPT');
    unchangedIncident(interval, p.incidentHash);
    const replay = await reconcileLinkedInterval(
      predecessor,
      interval,
      Date.parse(interval.after.observedAt),
      10000,
    );
    if (digest(replay.branch) !== p.afterHash) fail('RESOLUTION_REPLAY_CHANGED');
    verified.add(key);
    if (verified.size > 256) verified.delete(verified.values().next().value!);
  }
}
