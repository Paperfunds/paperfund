import { LinkedEngine as Stage1NonSolPumpSwap } from '../../../protocols/isolated/linked-pair/engine.js';
import {
  linkedBindings,
  linkedRoute,
  carryLinkedRoot,
} from '../../../protocols/isolated/linked-pair/shared-bridge.js';
import { supportedLinkedExit } from '../../../protocols/isolated/linked-pair/supported-exit.js';
import { reconcileCutoff, type CutoffFrontier, type CutoffSeal } from './cutoff.js';
import { flowHead, replayFlows, advanceFlow } from './flow-progress.js';
import {
  prepareRecovery,
  validateApproval,
  recordIncident,
  assertRecovered,
  type RecoveryProof,
  type RecoveryApproval,
} from './proof-recovery.js';
import { randomUUID } from 'node:crypto';
/** Opt-in candidate participant: existing accounting owns BEGIN/COMMIT, cash, basis and the BUY cap. */
import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { identifier } from '@paperfund/core';
import {
  ExecutionEngineError,
  createMarketStateEvidence,
  type MarketState,
  type MarketStateEvidence,
  type PositionExitValuationRequest,
  type SimulatedExecution,
  type BuySimulationRequest,
  type SellSimulationRequest,
} from '@paperfund/execution';
import type {
  DatabaseService,
  PersistedSettlementRequest,
  PersistedSettlementPlan,
} from '../../src/database.js';
import {
  LinkedPoolAdapter as NonSolPumpSwapAdapter,
  linkedState as pumpSwapStateFromSnapshot,
} from '../../../protocols/isolated/linked-pair/adapter.js';
import { genericPumpSwapIdentity } from '../../../protocols/src/generic-pump-swap.js';
import type { GenericPermission } from '../../../protocols/src/generic-access-context.js';
import { type Stage1Snapshot } from '../../../protocols/src/experimental/non-sol-pump-swap.js';
import { transitionLinkedSnapshot } from '../../../protocols/isolated/linked-pair/native-transition.js';
import {
  digest,
  newLinkedBranch,
  reconcileLinkedInterval,
  copyProviderInterval,
  type LinkedBranch,
  type ProviderInterval,
} from '../../../protocols/isolated/linked-pair/external-flow.js';
const VERSION = 'linked-native-atomic-v1',
  NORMALIZATION = 'linked-native-atomic-state-v1';
function reject(message: string): never {
  throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', message);
}
export interface Head {
  revision: string;
  initial_document: LinkedBranch;
  initial_hash: string;
  document: LinkedBranch;
  state_hash: string;
  round_id: string;
  base_state_hash?: string;
  flow_sequence?: string;
}
interface Cursor {
  head: Head;
  branch: LinkedBranch;
  interval: ProviderInterval | null;
  permission: GenericPermission;
  cutoff?: { hash: string; cutoff: string };
}
const executionHash = (e: SimulatedExecution) =>
  digest({ ...e, executionDetails: { hops: e.executionDetails?.['hops'] ?? null } });
function routeForIdentity(snapshot: Stage1Snapshot, identity: MarketState['identity']) {
  const binding = linkedBindings(snapshot).find(
    (r) => digest(genericPumpSwapIdentity(r.mint, r.quoteMint, r.bridgePool)) === digest(identity),
  );
  if (!binding) reject('LINKED_ROUTE_NOT_ADMITTED');
  return linkedRoute(snapshot, binding.mint, binding.bridgePool);
}
function identityForMint(snapshot: Stage1Snapshot, mint: string) {
  const route = linkedRoute(snapshot, mint);
  return genericPumpSwapIdentity(route.mint, route.quoteMint, route.bridgePool);
}
interface Pending extends Cursor {
  expires: number;
  next: LinkedBranch;
  executionHash: string;
  input: string;
  output: string;
  side: 'BUY' | 'SELL';
  at: string;
  routeMint: string;
  routeBridgePool?: string;
}
export class LinkedStateStore {
  constructor(
    readonly db: DatabaseService,
    readonly accountId: string,
    readonly roundId: string,
    readonly durableFlow = false,
    readonly proofRecovery = false,
  ) {}
  prepareRecovery(interval: ProviderInterval) {
    return prepareRecovery(this, interval);
  }
  async activateRecovery(
    interval: ProviderInterval,
    proof: RecoveryProof,
    approval: RecoveryApproval,
    nowMs: number,
  ) {
    if (!this.proofRecovery) reject('LINKED_RECOVERY_NOT_ENABLED');
    const prior = (
      await this.db.pool.query(
        'select proof_hash,approval_hash,sequence from linked_recovery_candidate.resolutions where account_id=$1 and generation=$2',
        [this.accountId, proof.generation],
      )
    ).rows[0];
    if (prior) {
      if (prior.proof_hash !== digest(proof) || prior.approval_hash !== digest(approval))
        reject('LINKED_RECOVERY_CONFLICT');
      await this.assertAvailable();
      return { advanced: false, sequence: String(prior.sequence) };
    }
    const activation = { proof, approval, nowMs };
    validateApproval(activation, this);
    const prepared = await this.prepareRecovery(interval);
    if (prepared.proofHash !== digest(proof)) reject('LINKED_RECOVERY_PROOF_CHANGED');
    return advanceFlow(this, interval, activation);
  }
  advanceFlow(interval: ProviderInterval) {
    if (!this.durableFlow) reject('LINKED_FLOW_NOT_ENABLED');
    return advanceFlow(this, interval);
  }
  async assertAvailable(client?: PoolClient) {
    const row = (
      await (client ?? this.db.pool).query(
        'select s.quarantined,q.reason from linked_candidate.route_status s left join linked_candidate.route_quarantine q using(account_id) where s.account_id=$1',
        [this.accountId],
      )
    ).rows[0];
    if (!row || (row.quarantined && !row.reason)) reject('LINKED_QUARANTINE_SCOPE_MISSING');
    if (row.reason) {
      if (!this.proofRecovery) reject('LINKED_ROUTE_QUARANTINED:' + row.reason);
      const c = client ?? (await this.db.pool.connect());
      try {
        await assertRecovered(c, this);
      } finally {
        if (!client) c.release();
      }
    }
  }
  async quarantine(interval: ProviderInterval, error: unknown) {
    const reason = error instanceof Error ? error.message : 'UNRECONCILABLE_FLOW';
    const client = await this.db.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        'linked-account:' + this.accountId,
      ]);
      const updated = await client.query(
        'update linked_candidate.route_status set quarantined=true where account_id=$1',
        [this.accountId],
      );
      if (updated.rowCount !== 1) reject('LINKED_QUARANTINE_SCOPE_MISSING');
      await client.query(
        'insert into linked_candidate.route_quarantine(account_id,interval_hash,reason,document) values($1,$2,$3,$4::jsonb) on conflict do nothing',
        [this.accountId, digest(interval), reason, JSON.stringify(interval)],
      );
      if (this.proofRecovery) await recordIncident(client, this.accountId, interval, reason);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async cutoff(client?: PoolClient): Promise<{ hash: string; document: CutoffSeal } | null> {
    const row = (
      await (client ?? this.db.pool).query<{ hash: string; document: CutoffSeal }>(
        'select hash,document from linked_candidate.cutoff_seals where account_id=$1',
        [this.accountId],
      )
    ).rows[0];
    if (!row) return null;
    if (
      row.document.accountId !== this.accountId ||
      row.document.roundId !== this.roundId ||
      digest(row.document) !== row.hash
    )
      reject('LINKED_CUTOFF_SEAL_CORRUPT');
    return row;
  }
  async sealCutoff(frontier: CutoffFrontier, cutoff: Date) {
    frontier = structuredClone(frontier);
    const c = await this.db.pool.connect();
    try {
      await c.query('begin');
      await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        'linked-account:' + this.accountId,
      ]);
      const r = (
        await c.query<{ state: string; ends_at_exclusive: Date }>(
          'select state,ends_at_exclusive from hourly_rounds where id=$1 for share',
          [this.roundId],
        )
      ).rows[0];
      if (!r || r.state !== 'SETTLING' || r.ends_at_exclusive.getTime() !== cutoff.getTime())
        reject('LINKED_CUTOFF_ROUND_MISMATCH');
      const old = await this.cutoff(c);
      if (old) {
        if (old.document.cutoff !== cutoff.toISOString()) reject('LINKED_CUTOFF_RESEAL');
        await c.query('commit');
        return old;
      }
      const head = await this.load(c),
        branch = await reconcileCutoff(head.document, frontier, cutoff.toISOString());
      const document: CutoffSeal = {
        version: 'LINKED_CUTOFF_SEAL_V1',
        accountId: this.accountId,
        roundId: this.roundId,
        cutoff: cutoff.toISOString(),
        revision: head.revision,
        beforeHash: head.state_hash,
        branch,
        frontier,
      };
      const hash = digest(document);
      await c.query('insert into linked_candidate.cutoff_seals values($1,$2,$3,$4::jsonb)', [
        this.accountId,
        this.roundId,
        hash,
        JSON.stringify(document),
      ]);
      await c.query('commit');
      return { hash, document };
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  async sealedBranch(head: Head, seal: { hash: string; document: CutoffSeal }) {
    if (head.revision === seal.document.revision) {
      if (head.state_hash !== seal.document.beforeHash) reject('LINKED_CUTOFF_PREDECESSOR_CHANGED');
      return structuredClone(seal.document.branch);
    }
    if (BigInt(head.revision) < BigInt(seal.document.revision))
      reject('LINKED_CUTOFF_REVISION_REGRESSED');
    const rows = (
      await this.db.pool.query<{ document: { cutoffSealHash?: string } }>(
        'select document from linked_candidate.receipts where account_id=$1 and revision>$2 order by revision',
        [this.accountId, seal.document.revision],
      )
    ).rows;
    if (
      BigInt(rows.length) !== BigInt(head.revision) - BigInt(seal.document.revision) ||
      rows.some((r) => r.document.cutoffSealHash !== seal.hash) ||
      digest(head.document.real) !== digest(seal.document.branch.real)
    )
      reject('LINKED_CUTOFF_CONTINUITY_UNPROVEN');
    return head.document;
  }
  async initialize(snapshot: Stage1Snapshot) {
    for (const binding of linkedBindings(snapshot)) {
      const route = linkedRoute(snapshot, binding.mint, binding.bridgePool);
      await new Stage1NonSolPumpSwap({
        purpose: 'READ_ONLY_STAGE1_VALIDATION',
        bridgeBinding: { quoteMint: route.quoteMint, pool: route.bridgePool },
      }).validate(route, { nowMs: Date.parse(route.observedAt), maxAgeMs: 10000 });
    }
    const c = await this.db.pool.connect();
    try {
      await c.query('begin');
      const a = (
        await c.query('select hourly_round_id from competition_accounts where id=$1 for update', [
          this.accountId,
        ])
      ).rows[0];
      if (a?.hourly_round_id !== this.roundId) reject('LINKED_ACCOUNT_ROUND_MISMATCH');
      if (
        (
          await c.query(
            'select 1 from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 limit 1',
            [this.accountId],
          )
        ).rows.length
      )
        reject('LINKED_FRESH_ACCOUNT_REQUIRED');
      const branch = newLinkedBranch(this.accountId, this.roundId, snapshot),
        h = digest(branch);
      const old = (
        await c.query<Head>('select * from linked_candidate.branches where account_id=$1', [
          this.accountId,
        ])
      ).rows[0];
      if (old && old.initial_hash !== h) reject('LINKED_INITIALIZATION_CONFLICT');
      await c.query(
        'insert into linked_candidate.branches values($1,$2,0,$3::jsonb,$4,$3::jsonb,$4) on conflict do nothing',
        [this.accountId, this.roundId, JSON.stringify(branch), h],
      );
      await c.query(
        'insert into linked_candidate.route_status(account_id) values($1) on conflict do nothing',
        [this.accountId],
      );
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  async load(client?: PoolClient): Promise<Head> {
    const c = client ?? (await this.db.pool.connect());
    try {
      const row = (
        await c.query<Head>(
          'select * from linked_candidate.branches where account_id=$1' +
            (client ? ' for update' : ''),
          [this.accountId],
        )
      ).rows[0];
      if (!row) reject('LINKED_STATE_MISSING_NO_RESET');
      if (
        row.round_id !== this.roundId ||
        row.document.accountId !== this.accountId ||
        row.document.roundId !== this.roundId ||
        row.document.version !== 'LINKED_BRANCH_V1' ||
        digest(row.document) !== row.state_hash ||
        digest(row.initial_document) !== row.initial_hash
      )
        reject('LINKED_STATE_CORRUPT');
      const receipts = (
        await c.query<{ revision: string; before_hash: string; after_hash: string }>(
          'select revision,before_hash,after_hash from linked_candidate.receipts where account_id=$1 order by revision',
          [this.accountId],
        )
      ).rows;
      let h = row.initial_hash,
        n = 0n;
      for (const r of receipts) {
        if (BigInt(r.revision) !== ++n || r.before_hash !== h)
          reject('LINKED_RECEIPT_CHAIN_CORRUPT');
        h = r.after_hash;
      }
      if (n !== BigInt(row.revision) || h !== row.state_hash)
        reject('LINKED_HEAD_RECEIPT_MISMATCH');
      return this.durableFlow
        ? flowHead(c, this.accountId, structuredClone(row))
        : structuredClone(row);
    } finally {
      if (!client) c.release();
    }
  }
  /** Independent replay from retained initial state/evidence/fills; missing/corrupt history cannot reset it. */
  async recover(verifyRecoveryEligibility = true) {
    const c = await this.db.pool.connect();
    try {
      await c.query('begin isolation level repeatable read read only');
      const head = await this.loadReadOnly(c);
      let branch = head.initial_document;
      const seal = await this.cutoff(c);
      let sealValidated = false;
      const events = (
        await c.query<{
          revision: string;
          document: Omit<Pending, 'head' | 'permission' | 'interval' | 'next'> & {
            replayAt?: number;
            flowSequence?: string;
            flowStateHash?: string;
          };
          interval_hash: string | null;
          after_hash: string;
        }>(
          'select revision,document,interval_hash,after_hash from linked_candidate.receipts where account_id=$1 order by revision',
          [this.accountId],
        )
      ).rows;
      for (const r of events) {
        if (this.durableFlow) {
          branch = await replayFlows(
            c,
            this.accountId,
            (BigInt(r.revision) - 1n).toString(),
            branch,
            r.document.flowSequence ?? '0',
          );
          if (r.document.flowStateHash && digest(branch) !== r.document.flowStateHash)
            reject('LINKED_FLOW_FILL_PREDECESSOR');
        }
        if (seal && !sealValidated && BigInt(r.revision) === BigInt(seal.document.revision) + 1n) {
          if (digest(branch) !== seal.document.beforeHash)
            reject('LINKED_CUTOFF_RESTART_PREDECESSOR');
          const reconciled = await reconcileCutoff(
            branch,
            seal.document.frontier,
            seal.document.cutoff,
          );
          if (digest(reconciled) !== digest(seal.document.branch))
            reject('LINKED_CUTOFF_RESTART_BRANCH');
          sealValidated = true;
        }
        if (r.interval_hash) {
          const raw = (
            await c.query<{ document: ProviderInterval }>(
              'select document from linked_candidate.provider_evidence where hash=$1',
              [r.interval_hash],
            )
          ).rows[0]?.document;
          if (!raw || digest(raw) !== r.interval_hash) reject('LINKED_PROVIDER_EVIDENCE_CORRUPT');
          branch = (
            await reconcileLinkedInterval(
              branch,
              raw,
              r.document.replayAt ?? Date.parse(r.document.at),
              10000,
            )
          ).branch;
        }
        const step = await transitionLinkedSnapshot(
          linkedRoute(
            branch.simulated,
            r.document.routeMint ?? branch.simulated.mint,
            r.document.routeBridgePool,
          ),
          BigInt(r.document.input),
          r.document.side === 'BUY',
          { nowMs: r.document.replayAt ?? Date.parse(r.document.at), maxAgeMs: 10000 },
        );
        if (step.quote.output.toString() !== r.document.output)
          reject('LINKED_OUTPUT_REPLAY_MISMATCH');
        branch = { ...branch, simulated: carryLinkedRoot(branch.simulated, step.next) };
        if (digest(branch) !== r.after_hash) reject('LINKED_SUCCESSOR_REPLAY_MISMATCH');
      }
      const effective = this.durableFlow ? await flowHead(c, this.accountId, head) : head;
      if (this.durableFlow)
        branch = await replayFlows(
          c,
          this.accountId,
          head.revision,
          branch,
          effective.flow_sequence ?? '0',
        );
      if (seal && !sealValidated) {
        if (head.revision !== seal.document.revision || digest(branch) !== seal.document.beforeHash)
          reject('LINKED_CUTOFF_RESTART_PREDECESSOR');
        const reconciled = await reconcileCutoff(
          branch,
          seal.document.frontier,
          seal.document.cutoff,
        );
        if (digest(reconciled) !== digest(seal.document.branch))
          reject('LINKED_CUTOFF_RESTART_BRANCH');
      }
      if (digest(branch) !== effective.state_hash) reject('LINKED_RESTART_HEAD_MISMATCH');
      if (this.proofRecovery && verifyRecoveryEligibility) await assertRecovered(c, this);
      await c.query('commit');
      return branch;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  private async loadReadOnly(c: PoolClient) {
    const row = (
      await c.query<Head>('select * from linked_candidate.branches where account_id=$1', [
        this.accountId,
      ])
    ).rows[0];
    if (
      !row ||
      row.round_id !== this.roundId ||
      digest(row.document) !== row.state_hash ||
      digest(row.initial_document) !== row.initial_hash
    )
      reject('LINKED_STATE_CORRUPT');
    return row;
  }
  async commit(
    client: PoolClient,
    input: Parameters<NonNullable<DatabaseService['commitMarketExecution']>>[1],
    pending: Pending,
    nowMs: number,
  ) {
    if (input.accountId !== this.accountId || input.roundId !== this.roundId)
      reject('LINKED_SCOPE_OR_CUTOFF_UNSUPPORTED');
    const status = (
      await client.query(
        'select quarantined from linked_candidate.route_status where account_id=$1 for update',
        [this.accountId],
      )
    ).rows[0];
    if (!status) reject('LINKED_ROUTE_QUARANTINED');
    if (status.quarantined) {
      if (!this.proofRecovery) reject('LINKED_ROUTE_QUARANTINED');
      await this.assertAvailable(client);
    }
    const seal = await this.cutoff(client);
    if (input.executionContext === 'FORCED_HOURLY_SETTLEMENT') {
      if (
        !seal ||
        pending.cutoff?.hash !== seal.hash ||
        pending.side !== 'SELL' ||
        input.execution.executedAt !== seal.document.cutoff
      )
        reject('LINKED_FORCED_SEAL_REQUIRED');
    } else if (seal || pending.cutoff) reject('LINKED_CUTOFF_NORMAL_FILL_FORBIDDEN');
    const age =
      (pending.cutoff ? Date.parse(pending.branch.real.observedAt) : nowMs) -
      Date.parse(pending.branch.real.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > 10000) reject('LINKED_COMMIT_CHECKPOINT_STALE');
    if (executionHash(input.execution) !== pending.executionHash)
      reject('LINKED_EXECUTION_CHANGED');
    const head = await this.load(client);
    if (head.revision !== pending.head.revision || head.state_hash !== pending.head.state_hash)
      reject('LINKED_PREDECESSOR_CHANGED_RETRY');
    const fill = (
      await client.query(
        'select f.execution_id,f.side,f.base_quantity::text,f.actual_input_lamports::text,f.actual_output_lamports::text,o.competition_account_id from fills f join orders o on o.id=f.order_id where f.id=$1',
        [input.fillId],
      )
    ).rows[0];
    if (
      !fill ||
      fill.execution_id !== input.execution.id ||
      fill.competition_account_id !== this.accountId ||
      fill.side !== pending.side ||
      (pending.side === 'BUY'
        ? fill.actual_input_lamports !== pending.input || fill.base_quantity !== pending.output
        : fill.base_quantity !== pending.input || fill.actual_output_lamports !== pending.output)
    )
      reject('LINKED_FILL_BINDING_MISMATCH');
    await pending.permission.authorizeLive?.(pending.side);
    const nextHash = digest(pending.next),
      rev = BigInt(head.revision) + 1n,
      intervalHash = pending.interval ? digest(pending.interval) : null;
    if (pending.interval) {
      await client.query(
        'insert into linked_candidate.provider_evidence values($1,$2::jsonb) on conflict do nothing',
        [intervalHash, JSON.stringify(pending.interval)],
      );
      const stored = (
        await client.query<{ document: ProviderInterval }>(
          'select document from linked_candidate.provider_evidence where hash=$1',
          [intervalHash],
        )
      ).rows[0];
      if (!stored || digest(stored.document) !== intervalHash)
        reject('LINKED_PROVIDER_HASH_CONFLICT');
    }
    const receipt = {
      ...(this.durableFlow
        ? { flowSequence: head.flow_sequence ?? '0', flowStateHash: head.state_hash }
        : {}),
      input: pending.input,
      output: pending.output,
      side: pending.side,
      at: pending.at,
      routeMint: pending.routeMint,
      ...(pending.routeBridgePool ? { routeBridgePool: pending.routeBridgePool } : {}),
      executionHash: pending.executionHash,
      branch: pending.branch,
      ...(pending.cutoff
        ? {
            cutoffSealHash: pending.cutoff.hash,
            replayAt: Date.parse(pending.branch.simulated.observedAt),
          }
        : {}),
    };
    await client.query(
      'insert into linked_candidate.receipts values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [
        this.accountId,
        rev.toString(),
        input.fillId,
        input.execution.id,
        head.base_state_hash ?? head.state_hash,
        nextHash,
        intervalHash,
        JSON.stringify(receipt),
      ],
    );
    await client.query(
      'update linked_candidate.branches set revision=$2,document=$3::jsonb,state_hash=$4 where account_id=$1',
      [this.accountId, rev.toString(), JSON.stringify(pending.next), nextHash],
    );
  }
}
/** Installing candidate tables is intentionally possible only in a disposable DB; no live migration. */
export async function installLinkedTestSchema(pool: Pool) {
  const name = (await pool.query<{ name: string }>('select current_database() name')).rows[0]!.name;
  if (!/^paperfund_linked_test_[a-z0-9_]+$/.test(name))
    reject('LINKED_DISPOSABLE_DATABASE_REQUIRED');
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('./partial-settlement.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('./quarantine.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('./flow-progress.sql', import.meta.url), 'utf8'));
}
export function linkedCandidateRuntime(
  base: DatabaseService,
  store: LinkedStateStore,
  options: {
    now: () => number;
    interval: (anchor: Stage1Snapshot) => Promise<ProviderInterval | null>;
    permission: (identity: MarketState['identity']) => Promise<GenericPermission>;
    selectRoute?: (mint: string, root: Stage1Snapshot) => Promise<MarketState['identity']>;
    cutoffFrontier?: (anchor: Stage1Snapshot, cutoff: Date) => Promise<CutoffFrontier>;
  },
) {
  if (base.preparePersistedSettlementStep || base.commitPersistedSettlementStep)
    reject('LINKED_EXISTING_SETTLEMENT_PARTICIPANT');
  const cursors = new WeakMap<MarketState, Cursor>(),
    pending = new Map<string, Pending>();
  const native = (s: Stage1Snapshot) =>
    new Stage1NonSolPumpSwap({
      purpose: 'READ_ONLY_STAGE1_VALIDATION',
      bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool },
    });
  const source = {
    engine: {
      quote: (s: Stage1Snapshot, q: bigint, b: boolean, p: { nowMs: number; maxAgeMs: number }) =>
        native(s).quote(s, q, b, p),
      exits: (s: Stage1Snapshot, q: bigint, p: { nowMs: number; maxAgeMs: number }) =>
        native(s).exits(s, q, p),
    },
    async loadMarketState(identity: MarketState['identity']) {
      await store.assertAvailable();
      const head = await store.load(),
        seal = await store.cutoff(),
        rawInterval = seal
          ? head.revision === seal.document.revision
            ? seal.document.frontier.interval
            : null
          : await options.interval(head.document.real),
        interval = rawInterval ? copyProviderInterval(rawInterval) : null,
        permission = await options.permission(identity);
      if (!permission.discover && !permission.exitBinding) reject('LINKED_AUTHORIZATION_REQUIRED');
      if (typeof permission.authorizeLive !== 'function')
        reject('LINKED_LIVE_AUTHORIZATION_REQUIRED');
      if (
        permission.exitBinding &&
        (permission.exitBinding.targetPool !==
          routeForIdentity(head.document.real, identity).targetPool ||
          permission.exitBinding.quoteMint !==
            routeForIdentity(head.document.real, identity).quoteMint ||
          permission.exitBinding.bridgePool !==
            routeForIdentity(head.document.real, identity).bridgePool)
      )
        reject('LINKED_EXIT_BINDING_CHANGED');
      const branch = seal
        ? await store.sealedBranch(head, seal)
        : interval
          ? (
              await (async () => {
                try {
                  return await reconcileLinkedInterval(
                    head.document,
                    interval,
                    options.now(),
                    10000,
                  );
                } catch (error) {
                  await store.quarantine(interval, error);
                  throw error;
                }
              })()
            ).branch
          : head.document;
      const s = routeForIdentity(branch.simulated, identity),
        expected = genericPumpSwapIdentity(s.mint, s.quoteMint, s.bridgePool);
      if (digest(identity) !== digest(expected)) reject('LINKED_ROUTE_IDENTITY_CHANGED');
      if (
        !seal &&
        (options.now() - Date.parse(branch.real.observedAt) > 10000 ||
          options.now() < Date.parse(branch.real.observedAt))
      )
        reject('LINKED_FRESHNESS_UNAVAILABLE');
      await native(s).validate(s, {
        nowMs: seal ? Date.parse(s.observedAt) : options.now(),
        maxAgeMs: 10000,
      });
      const state = await pumpSwapStateFromSnapshot(identity, s, native(s), VERSION, NORMALIZATION);
      const result = {
        ...state,
        normalizedState: {
          ...state.normalizedState,
          genericBuyAdmissionAllowed: !seal && permission.buy,
          linkedAccountId: store.accountId,
          linkedRoundId: store.roundId,
          linkedRevision: head.revision,
          linkedBranchHash: head.state_hash,
          ...(seal ? { linkedCutoffSealHash: seal.hash } : {}),
        },
      };
      cursors.set(result, {
        head,
        branch,
        interval,
        permission,
        ...(seal ? { cutoff: { hash: seal.hash, cutoff: seal.document.cutoff } } : {}),
      });
      return result;
    },
  };
  class Adapter extends NonSolPumpSwapAdapter {
    constructor() {
      super(source, {
        protocolId: identifier('GENERIC_PUMP_SWAP', 'ProtocolId'),
        adapterVersion: VERSION,
        normalizationVersion: NORMALIZATION,
        identity: genericPumpSwapIdentity,
        assertBinding: () => undefined,
        buysEnabled: false,
      });
    }
    private async track(
      r: BuySimulationRequest | SellSimulationRequest,
      s: MarketState,
      buy: boolean,
      result: SimulatedExecution,
    ) {
      const cursor = cursors.get(s);
      if (!cursor) return result; // Historical replay is pure and cannot commit.
      await cursor.permission.authorizeLive?.(buy ? 'BUY' : 'SELL');
      const amount = buy
        ? (r as BuySimulationRequest).requestedPaperSol
        : (r as SellSimulationRequest).requestedTokenQuantity;
      const step = await transitionLinkedSnapshot(
        routeForIdentity(cursor.branch.simulated, r.identity),
        amount,
        buy,
        {
          nowMs: cursor.cutoff ? Date.parse(cursor.branch.simulated.observedAt) : options.now(),
          maxAgeMs: 10000,
        },
      );
      if (
        step.quote.output !== result.actualOutput.amount ||
        step.quote.input !== result.actualInput.amount
      )
        reject('LINKED_NATIVE_FILL_MISMATCH');
      for (const [key, p] of pending) if (p.expires < Date.now()) pending.delete(key);
      if (pending.size >= 128) reject('LINKED_PENDING_CAPACITY');
      const token = randomUUID();
      pending.set(token, {
        expires: Date.now() + 30000,
        ...cursor,
        next: { ...cursor.branch, simulated: carryLinkedRoot(cursor.branch.simulated, step.next) },
        executionHash: executionHash(result),
        input: amount.toString(),
        output: step.quote.output.toString(),
        side: buy ? 'BUY' : 'SELL',
        at: r.executedAt,
        routeMint: r.identity.tokenMint,
        routeBridgePool: routeForIdentity(cursor.branch.simulated, r.identity).bridgePool,
      });
      return {
        ...result,
        executionDetails: { ...result.executionDetails, linkedCommitToken: token },
      };
    }
    override async valuePositionForExit(r: PositionExitValuationRequest, s: MarketState) {
      await transitionLinkedSnapshot(
        s.normalizedState['stage1Snapshot'] as unknown as Stage1Snapshot,
        r.tokenQuantity,
        false,
        { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 },
      );
      return super.valuePositionForExit(r, s);
    }
    override async simulateBuy(r: BuySimulationRequest, s: MarketState) {
      return this.track(r, s, true, await super.simulateBuy(r, s));
    }
    override async simulateSell(r: SellSimulationRequest, s: MarketState) {
      return this.track(r, s, false, await super.simulateSell(r, s));
    }
  }
  const plans = new Map<
    string,
    { request: PersistedSettlementRequest; plan: PersistedSettlementPlan; expires: number }
  >();
  // The optional amount is a server-only partial intent used to replay a valid interrupted step.
  // Ordinary worker planning always asks for the entire remaining holding.
  async function planSettlementStep(
    input: PersistedSettlementRequest,
    amount = input.quantity,
  ): Promise<PersistedSettlementPlan> {
    if (
      input.accountId !== store.accountId ||
      input.roundId !== store.roundId ||
      amount <= 0n ||
      amount > input.quantity
    )
      reject('LINKED_SETTLEMENT_SCOPE');
    const seal = await store.cutoff();
    if (!seal) reject('LINKED_FORCED_SEAL_REQUIRED');
    const position = (
      await store.db.pool.query<{
        remaining_base_units: string;
        cost_basis_lamports: string;
        status: string;
        market_id: string;
        mint_address: string;
      }>(
        'select p.remaining_base_units,p.cost_basis_lamports,p.status,p.market_id,a.mint_address from positions p join assets a on a.id=p.asset_id where p.id=$1 and p.competition_account_id=$2',
        [input.positionId, store.accountId],
      )
    ).rows[0];
    if (
      !position ||
      position.status !== 'OPEN' ||
      BigInt(position.remaining_base_units) !== input.quantity ||
      BigInt(position.cost_basis_lamports) !== input.basis ||
      position.market_id !== input.identity.marketId ||
      position.mint_address !== input.identity.tokenMint
    )
      reject('LINKED_SETTLEMENT_POSITION_CHANGED');
    if (
      (
        await store.db.pool.query(
          'select 1 from legacy_source_reviews where hourly_round_id=$1 limit 1',
          [store.roundId],
        )
      ).rows.length
    )
      reject('LINKED_EXISTING_REVIEW_REQUIRES_OPERATOR');
    const unproven = await store.db.pool.query(
      "select 1 from fills f join orders o on o.id=f.order_id join order_market_state_evidence e on e.order_id=o.id and e.purpose='SELL_EXECUTION' left join linked_candidate.settlement_steps s on s.fill_id=f.id where e.position_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT' and s.fill_id is null limit 1",
      [input.positionId],
    );
    if (unproven.rows.length) reject('LINKED_UNPROVEN_PRIOR_FORCED_FILL');
    const selectedIdentity = options.selectRoute
      ? await options.selectRoute(
          input.identity.tokenMint,
          (await store.sealedBranch(await store.load(), seal)).simulated,
        )
      : identityForMint(seal.document.branch.real, input.identity.tokenMint);
    const root = routeForIdentity(seal.document.branch.real, selectedIdentity),
      state = await source.loadMarketState(
        genericPumpSwapIdentity(root.mint, root.quoteMint, root.bridgePool),
      ),
      cursor = cursors.get(state)!;
    if (!cursor.cutoff) reject('LINKED_FORCED_SEAL_REQUIRED');
    const quote = await supportedLinkedExit(
        routeForIdentity(cursor.branch.simulated, state.identity),
        amount,
      ),
      evidence = createMarketStateEvidence(state);
    const idempotencyKey =
      'linked-forced-v1:' +
      digest({
        account: store.accountId,
        round: store.roundId,
        position: input.positionId,
        seal: seal.hash,
        revision: cursor.head.revision,
        beforeHash: cursor.head.state_hash,
        quantityBefore: input.quantity,
        quantity: quote.quantity,
      });
    const plan = { quantity: quote.quantity, output: quote.output, evidence, idempotencyKey };
    for (const [key, p] of plans) if (p.expires < Date.now()) plans.delete(key);
    if (quote.quantity > 0n) {
      if (plans.size >= 128 && !plans.has(idempotencyKey)) reject('LINKED_PENDING_CAPACITY');
      plans.set(idempotencyKey, {
        request: structuredClone(input),
        plan,
        expires: Date.now() + 30000,
      });
    }
    return plan;
  }
  const database: DatabaseService = {
    ...base,
    async valueMarketPortfolio(positions) {
      const values: { positionId: string; value: bigint; evidence: MarketStateEvidence }[] = [];
      let shadow: Stage1Snapshot | null = null,
        revision: string | null = null,
        anchor: string | null = null;
      for (const position of [...positions].sort((a, b) =>
        a.positionId.localeCompare(b.positionId),
      )) {
        const chosen = options.selectRoute
          ? await options.selectRoute(
              position.identity.tokenMint,
              (await store.load()).document.simulated,
            )
          : identityForMint((await store.load()).document.simulated, position.identity.tokenMint);
        const loaded = await source.loadMarketState(chosen),
          cursor = cursors.get(loaded)!;
        if (
          revision !== null &&
          (revision !== cursor.head.revision || anchor !== digest(cursor.branch))
        )
          reject('LINKED_PORTFOLIO_REVISION_CHANGED');
        revision = cursor.head.revision;
        anchor = digest(cursor.branch);
        shadow ??= structuredClone(cursor.branch.simulated);
        const selected = routeForIdentity(shadow, chosen),
          quote = await supportedLinkedExit(selected, position.quantity);
        const state = await pumpSwapStateFromSnapshot(
          chosen,
          selected,
          native(selected),
          VERSION,
          NORMALIZATION,
        );
        const evidence = createMarketStateEvidence({
          ...state,
          normalizedState: {
            ...state.normalizedState,
            linkedRevision: revision,
            linkedBranchHash: cursor.head.state_hash,
            linkedPortfolioPredecessor: digest(shadow),
          },
        });
        values.push({ positionId: position.positionId, value: quote.output, evidence });
        if (quote.quantity > 0n) {
          const step = await transitionLinkedSnapshot(selected, quote.quantity, false, {
            nowMs: Date.parse(selected.observedAt),
            maxAgeMs: 10000,
          });
          if (step.quote.output !== quote.output) reject('LINKED_PORTFOLIO_QUOTE_DISAGREEMENT');
          shadow = carryLinkedRoot(shadow, step.next);
        }
      }
      return positions.map((p) => values.find((v) => v.positionId === p.positionId)!);
    },
    preparePersistedSettlementStep: (input) => planSettlementStep(input),
    async commitPersistedSettlementStep(client, input) {
      const held = plans.get(input.idempotencyKey);
      if (!held || held.expires < Date.now()) reject('LINKED_SETTLEMENT_PLAN_MISSING');
      const { request, plan } = held;
      if (
        input.accountId !== store.accountId ||
        input.roundId !== store.roundId ||
        input.positionId !== request.positionId ||
        input.quantityBefore !== request.quantity ||
        input.basisBefore !== request.basis ||
        input.execution.actualInput.amount !== plan.quantity ||
        input.execution.actualOutput.amount !== plan.output ||
        input.evidence.fingerprint !== plan.evidence.fingerprint
      )
        reject('LINKED_SETTLEMENT_PLAN_CHANGED');
      const revision = (
          BigInt(String(plan.evidence.normalizedState['linkedRevision'])) + 1n
        ).toString(),
        head = await store.load(client);
      const receipt = (
        await client.query<{ fill_id: string; after_hash: string }>(
          'select fill_id,after_hash from linked_candidate.receipts where account_id=$1 and revision=$2',
          [store.accountId, revision],
        )
      ).rows[0];
      if (
        head.revision !== revision ||
        receipt?.fill_id !== input.fillId ||
        receipt.after_hash !== head.state_hash
      )
        reject('LINKED_FORCED_RECEIPT_REQUIRED');
      const fill = (
        await client.query<{ fee_lamports: string; market_state_evidence_id: string }>(
          'select fee_lamports,market_state_evidence_id from fills where id=$1',
          [input.fillId],
        )
      ).rows[0];
      if (!fill) reject('LINKED_FILL_BINDING_MISMATCH');
      await client.query(
        'insert into linked_candidate.settlement_steps values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          input.fillId,
          store.accountId,
          input.positionId,
          revision,
          String(plan.evidence.normalizedState['linkedCutoffSealHash']),
          input.quantityBefore.toString(),
          input.basisBefore.toString(),
          plan.quantity.toString(),
          plan.output.toString(),
          fill.fee_lamports,
          fill.market_state_evidence_id,
          input.idempotencyKey,
        ],
      );
      plans.delete(input.idempotencyKey);
    },
    async prepareMarketSettlement(roundId, cutoff) {
      await base.prepareMarketSettlement?.(roundId, cutoff);
      if (roundId !== store.roundId) reject('LINKED_CUTOFF_ROUND_SCOPE');
      if (await store.cutoff()) return;
      if (
        !(
          await store.db.pool.query(
            "select 1 from positions where competition_account_id=$1 and status='OPEN' limit 1",
            [store.accountId],
          )
        ).rows.length
      )
        return;
      if (!options.cutoffFrontier) reject('LINKED_CUTOFF_FRONTIER_REQUIRED');
      const head = await store.load();
      await store.assertAvailable();
      const frontier = structuredClone(await options.cutoffFrontier(head.document.real, cutoff));
      try {
        await store.sealCutoff(frontier, cutoff);
      } catch (error) {
        if (frontier.interval) await store.quarantine(frontier.interval, error);
        throw error;
      }
    },
    async bindMarketSettlementEvidence(accountId, evidence) {
      await base.bindMarketSettlementEvidence?.(accountId, evidence);
      if (accountId !== store.accountId) reject('LINKED_ACCOUNT_SCOPE_MISMATCH');
      const state = await source.loadMarketState(evidence.identity),
        cursor = cursors.get(state)!;
      if (
        !cursor.cutoff ||
        createMarketStateEvidence(state).fingerprint !==
          createMarketStateEvidence(evidence).fingerprint ||
        createMarketStateEvidence(evidence).fingerprint !== evidence.fingerprint
      )
        reject('LINKED_STALE_CUTOFF_EVIDENCE');
      cursors.set(evidence, cursor);
    },
    async lockMarketExecution(c, accountId) {
      if (accountId !== store.accountId) reject('LINKED_ACCOUNT_SCOPE_MISMATCH');
      await base.lockMarketExecution?.(c, accountId);
      await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        'linked-account:' + accountId,
      ]);
    },
    async commitMarketExecution(c, input) {
      await base.commitMarketExecution?.(c, input);
      const p = pending.get(String(input.execution.executionDetails?.['linkedCommitToken']));
      if (!p || p.expires < Date.now()) reject('LINKED_PENDING_EXECUTION_MISSING');
      try {
        await store.commit(c, input, p, options.now());
      } finally {
        pending.delete(String(input.execution.executionDetails?.['linkedCommitToken']));
      }
    },
  };
  return { database, adapter: new Adapter(), planSettlementStep };
}
