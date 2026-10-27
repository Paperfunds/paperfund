/** Independent, nonfinancial flow frontier. Original fill revisions and ledger are untouched. */
import { gzipSync, gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import type { PoolClient } from 'pg';
import {FootprintReceiptRequired} from '../../../protocols/isolated/linked-pair/footprint.js';
import type { Head, LinkedStateStore } from './store.js';
import {
  validateApproval,
  checkActivation,
  recordResolution,
  type RecoveryActivation,
} from './proof-recovery.js';
import {
  digest,
  retainProviderInterval,
  serializeProviderInterval,
  reconcileLinkedInterval,
  type LinkedBranch,
  type ProviderInterval,
} from '../../../protocols/isolated/linked-pair/external-flow.js';
const fail = (s: string): never => {
  throw Error('LINKED_FLOW_' + s);
};
const timing = (name: string, start: number, detail: Record<string, string | number>) => {
  performance.measure(name, { start, detail });
  performance.clearMeasures(name);
};
// A verified immutable proof may be reused by API/worker compositions in this process.
// Never cache a pending write; every restart reconstructs the proof from retained evidence.
const verifiedSteps = new Map<string, LinkedBranch>();
export async function flowHead(c: PoolClient, account: string, base: Head): Promise<Head> {
  const h = (
    await c.query(
      'select * from linked_flow_candidate.heads where account_id=$1 and fill_revision=$2',
      [account, base.revision],
    )
  ).rows[0];
  if (!h) return { ...base, base_state_hash: base.state_hash, flow_sequence: '0' };
  if (h.base_hash !== base.state_hash || digest(h.document) !== h.state_hash) fail('HEAD_CORRUPT');
  const rows = (
    await c.query(
      'select sequence,base_hash,before_hash,after_hash from linked_flow_candidate.steps where account_id=$1 and fill_revision=$2 order by sequence',
      [account, base.revision],
    )
  ).rows;
  let n = 0n,
    hash = base.state_hash;
  for (const r of rows) {
    if (BigInt(r.sequence) !== ++n || r.base_hash !== base.state_hash || r.before_hash !== hash)
      fail('CHAIN_CORRUPT');
    hash = r.after_hash;
  }
  if (n !== BigInt(h.sequence) || hash !== h.state_hash) fail('HEAD_PROOF_MISSING');
  return {
    ...base,
    base_state_hash: base.state_hash,
    flow_sequence: h.sequence,
    document: h.document,
    state_hash: h.state_hash,
  };
}
export async function replayFlows(
  c: PoolClient,
  account: string,
  revision: string,
  branch: LinkedBranch,
  sequence: string,
) {
  const rows = (
    await c.query(
      'select s.* from linked_flow_candidate.steps s where s.account_id=$1 and s.fill_revision=$2 and s.sequence<=$3 order by s.sequence',
      [account, revision, sequence],
    )
  ).rows;
  let n = 0n;
  const baseHash = digest(branch);
  for (const r of rows) {
    if (BigInt(r.sequence) !== ++n || r.base_hash !== baseHash || r.before_hash !== digest(branch))
      fail('REPLAY_CHAIN');
    const key = digest({
        before: r.before_hash,
        after: r.after_hash,
        evidence: r.evidence_hash,
        at: +new Date(r.replay_at),
      }),
      cached = verifiedSteps.get(key);
    if (cached) {
      branch = structuredClone(cached);
      continue;
    }
    const payload = (
      await c.query('select payload from linked_flow_candidate.evidence where hash=$1', [
        r.evidence_hash,
      ])
    ).rows[0]?.payload;
    if (!payload) fail('EVIDENCE_MISSING');
    const e = retainProviderInterval(
      JSON.parse(gunzipSync(payload).toString()) as ProviderInterval,
    );
    if (digest(e) !== r.evidence_hash || +new Date(r.replay_at) !== Date.parse(e.after.observedAt))
      fail('EVIDENCE_CORRUPT');
    branch = (await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000))
      .branch;
    if (digest(branch) !== r.after_hash) fail('REPLAY_SUCCESSOR');
    verifiedSteps.set(key, structuredClone(branch));
    if (verifiedSteps.size > 512) verifiedSteps.delete(verifiedSteps.keys().next().value!);
  }
  if (n !== BigInt(sequence)) fail('REPLAY_MISSING');
  return branch;
}
export async function advanceFlow(
  store: LinkedStateStore,
  supplied: ProviderInterval,
  recovery?: RecoveryActivation,
) {
  if (recovery) validateApproval(recovery, store);
  else await store.assertAvailable();
  const interval = retainProviderInterval(supplied),
    expected = await store.load(),
    hash = digest(interval);
  if (digest(expected.document.real) === digest(interval.after))
    return { advanced: false, sequence: expected.flow_sequence ?? '0' };
  if (digest(expected.document.real) !== digest(interval.before)) fail('PREDECESSOR_CHANGED_RETRY');
  // Historical catch-up is validation at its retained bank time, never a fresh-price assertion.
  let branch: LinkedBranch;
  const reconciling = performance.now();
  try {
    branch = (
      await reconcileLinkedInterval(
        expected.document,
        interval,
        Date.parse(interval.after.observedAt),
        10000,
      )
    ).branch;
  } catch (e) {
    // A concurrent fill can expand the required footprint set. Acquire against the
    // new persisted impact; an incomplete projection never becomes a checkpoint.
    if(e instanceof FootprintReceiptRequired)throw e;
    await store.quarantine(interval, e);
    throw e;
  }
  timing('linked.flow.reconcile', reconciling, { from: interval.before.slot, to: interval.after.slot });
  const encoding = performance.now();
  const afterHash = digest(branch),
    payload = gzipSync(Buffer.from(serializeProviderInterval(interval)), { level: 1 });
  timing('linked.flow.encode', encoding, { bytes: payload.length });
  const writing = performance.now();
  const c = await store.db.pool.connect();
  try {
    await c.query('begin');
    if (recovery)
      await c.query('select id from competition_accounts where id=$1 for update', [
        store.accountId,
      ]);
    await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      'linked-account:' + store.accountId,
    ]);
    const status = (
      await c.query(
        'select quarantined from linked_candidate.route_status where account_id=$1 for update',
        [store.accountId],
      )
    ).rows[0];
    if (!status) fail('QUARANTINED');
    if (status.quarantined && !recovery) {
      if (!store.proofRecovery) fail('QUARANTINED');
      await store.assertAvailable(c);
    }
    const head = await store.load(c);
    if (
      head.revision !== expected.revision ||
      head.state_hash !== expected.state_hash ||
      head.flow_sequence !== expected.flow_sequence
    )
      fail('PREDECESSOR_CHANGED_RETRY');
    if (recovery) await checkActivation(c, store, recovery, head, interval);
    const round = (
      await c.query('select state,ends_at_exclusive from hourly_rounds where id=$1 for share', [
        store.roundId,
      ])
    ).rows[0];
    if (
      !round ||
      !['OPEN', 'CLOSING', 'SETTLING'].includes(round.state) ||
      Date.parse(interval.after.observedAt) >= +round.ends_at_exclusive ||
      (await store.cutoff(c))
    )
      fail('CUTOFF_SEALED_OR_PAST');
    const inserted = await c.query(
      'insert into linked_flow_candidate.evidence values($1,$2) on conflict do nothing',
      [hash, payload],
    );
    // Compare canonical content, not gzip byte encoding, on a reused evidence key.
    if (!inserted.rowCount) {
      const saved = (
        await c.query('select payload from linked_flow_candidate.evidence where hash=$1', [hash])
      ).rows[0];
      if (
        !saved ||
        digest(retainProviderInterval(JSON.parse(gunzipSync(saved.payload).toString()))) !== hash
      )
        fail('EVIDENCE_CONFLICT');
    }
    const sequence = (BigInt(head.flow_sequence ?? '0') + 1n).toString(),
      base = head.base_state_hash ?? head.state_hash;
    await c.query('insert into linked_flow_candidate.steps values($1,$2,$3,$4,$5,$6,$7,$8)', [
      store.accountId,
      head.revision,
      sequence,
      base,
      head.state_hash,
      afterHash,
      hash,
      new Date(interval.after.observedAt),
    ]);
    if (sequence === '1')
      await c.query('insert into linked_flow_candidate.heads values($1,$2,$3,$4,$5,$6::jsonb)', [
        store.accountId,
        head.revision,
        base,
        sequence,
        afterHash,
        JSON.stringify(branch),
      ]);
    else {
      const updated = await c.query(
        'update linked_flow_candidate.heads set sequence=$3,state_hash=$4,document=$5::jsonb where account_id=$1 and fill_revision=$2 and sequence=$6 and state_hash=$7',
        [
          store.accountId,
          head.revision,
          sequence,
          afterHash,
          JSON.stringify(branch),
          head.flow_sequence,
          head.state_hash,
        ],
      );
      if (updated.rowCount !== 1) fail('HEAD_CHANGED_RETRY');
    }
    if (recovery) await recordResolution(c, store, recovery, head, branch, sequence);
    await c.query('commit');
    timing('linked.flow.commit', writing, { from: interval.before.slot, to: interval.after.slot, sequence });
    return { advanced: true, sequence, slot: branch.real.slot };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
