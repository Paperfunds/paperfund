/** Isolated transaction interface. Never exported, wired or allowed on the running database. */
import type { Pool, PoolClient } from 'pg';
import {
  Stage1Error,
  prepareStage1Transition,
  replayStage1,
  stage1Hash,
  type Stage1Model,
  type Stage1Request,
  type Stage1Scope,
  type Stage1Transition,
} from '../../../protocols/src/experimental/pump-reserve-stage1.js';

function fail(code: string): never {
  throw new Stage1Error(code);
}
export type IsolatedExecutionWriter = (
  client: PoolClient,
  transition: Stage1Transition,
) => Promise<void>;
export async function writeStage1ExecutionReceipt(
  client: PoolClient,
  transition: Stage1Transition,
) {
  await client.query(
    'insert into pump_stage1.execution_receipts(execution_id,scope_hash,request_hash,result_hash) values($1,$2,$3,$4)',
    [
      transition.request.executionId,
      transition.scopeHash,
      transition.requestHash,
      transition.resultHash,
    ],
  );
}
export class IsolatedPumpStage1Store {
  constructor(
    private readonly pool: Pool,
    private readonly isolatedDatabaseName: string,
  ) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      const db = await client.query<{ name: string }>('select current_database() name');
      if (
        db.rows[0]?.name !== this.isolatedDatabaseName ||
        !/^paperfund_pump_stage1_[a-z0-9_]+$/.test(this.isolatedDatabaseName)
      )
        fail('ISOLATED_DATABASE_REQUIRED');
      await client.query('begin');
      await client.query("set local statement_timeout = '5s'");
      await client.query("set local idle_in_transaction_session_timeout = '5s'");
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      if (error instanceof Stage1Error) throw error;
      if ((error as { code?: string }).code === '23505') fail('DUPLICATE_EXECUTION');
      throw error;
    } finally {
      client.release();
    }
  }
  private async owner(client: PoolClient, authenticatedUserId: string, scope: Stage1Scope) {
    const r = await client.query<{
      user_id: string;
      hourly_round_id: string;
      starts_at: Date;
      ends_at_exclusive: Date;
      state: string;
    }>(
      'select ca.user_id,ca.hourly_round_id,h.starts_at,h.ends_at_exclusive,h.state from competition_accounts ca join hourly_rounds h on h.id=ca.hourly_round_id where ca.id=$1 for share of ca,h',
      [scope.accountId],
    );
    const row = r.rows[0];
    if (
      !row ||
      row.user_id !== authenticatedUserId ||
      scope.userId !== authenticatedUserId ||
      row.hourly_round_id !== scope.roundId ||
      row.starts_at.toISOString() !== scope.startsAt ||
      row.ends_at_exclusive.toISOString() !== scope.endsAtExclusive
    )
      fail('SERVER_ACCOUNT_ROUND_OWNER_MISMATCH');
    return row.state;
  }
  async initialize(authenticatedUserId: string, model: Stage1Model) {
    if (model.revision !== 0) fail('NEW_MODEL_BASE_REQUIRED');
    await replayStage1(model, []);
    return this.transaction(async (client) => {
      if ((await this.owner(client, authenticatedUserId, model.scope)) !== 'OPEN')
        fail('ROUND_NOT_OPEN');
      await client.query(
        'insert into pump_stage1.models(scope_hash,account_id,round_id,revision,state_hash,anchor,state) values($1,$2,$3,0,$4,$5,$5)',
        [
          stage1Hash(model.scope),
          model.scope.accountId,
          model.scope.roundId,
          model.hash,
          JSON.stringify(model),
        ],
      );
    });
  }
  async execute(
    authenticatedUserId: string,
    scope: Stage1Scope,
    request: Stage1Request,
    writer: IsolatedExecutionWriter,
  ) {
    return this.transaction(async (client) => {
      const roundState = await this.owner(client, authenticatedUserId, scope);
      const key = stage1Hash(scope);
      const heads = await client.query<{ state: Stage1Model }>(
        'select state from pump_stage1.models where scope_hash=$1 for update',
        [key],
      );
      const current = heads.rows[0]?.state;
      if (!current) return fail('PREDECESSOR_MODEL_MISSING');
      const prior = await client.query<{ record: Stage1Transition; result_state: Stage1Model }>(
        'select record,result_state from pump_stage1.transitions where scope_hash=$1 and request_key=$2',
        [key, request.key],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].record.requestHash !== stage1Hash(request))
          return fail('IDEMPOTENCY_CONFLICT');
        return {
          model: prior.rows[0].result_state,
          transition: prior.rows[0].record,
          replayed: true,
        };
      }
      if (request.phase === 'OPEN' ? roundState !== 'OPEN' : roundState !== 'SETTLING')
        fail('ROUND_EXECUTION_STATE_INVALID');
      const result = await prepareStage1Transition(current, scope, request);
      if (typeof writer !== 'function') fail('ATOMIC_EXECUTION_WRITER_REQUIRED');
      await writer(client, result.transition);
      const receipt = await client.query<{
        scope_hash: string;
        request_hash: string;
        result_hash: string;
        same_tx: boolean;
      }>(
        'select scope_hash,request_hash,result_hash,created_xid=txid_current() same_tx from pump_stage1.execution_receipts where execution_id=$1',
        [request.executionId],
      );
      const bound = receipt.rows[0];
      if (
        !bound ||
        !bound.same_tx ||
        bound.scope_hash !== key ||
        bound.request_hash !== result.transition.requestHash ||
        bound.result_hash !== result.model.hash
      )
        fail('SUCCESSFUL_SAME_TRANSACTION_EXECUTION_REQUIRED');
      await client.query(
        'insert into pump_stage1.transitions(scope_hash,revision,parent_revision,transition_id,request_key,execution_id,record,result_state) values($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          key,
          result.model.revision,
          result.model.revision === 1 ? null : result.model.revision - 1,
          result.transition.id,
          request.key,
          request.executionId,
          JSON.stringify(result.transition),
          JSON.stringify(result.model),
        ],
      );
      const changed = await client.query(
        'update pump_stage1.models set revision=$1,state_hash=$2,state=$3 where scope_hash=$4 and revision=$5 and state_hash=$6',
        [
          result.model.revision,
          result.model.hash,
          JSON.stringify(result.model),
          key,
          current.revision,
          current.hash,
        ],
      );
      if (changed.rowCount !== 1) fail('STALE_PREDECESSOR');
      return { ...result, replayed: false };
    });
  }
  async recover(authenticatedUserId: string, scope: Stage1Scope) {
    return this.transaction(async (client) => {
      await this.owner(client, authenticatedUserId, scope);
      const key = stage1Hash(scope);
      const heads = await client.query<{ anchor: Stage1Model; state_hash: string }>(
        'select anchor,state_hash from pump_stage1.models where scope_hash=$1 for share',
        [key],
      );
      const head = heads.rows[0];
      if (!head) return fail('PREDECESSOR_MODEL_MISSING');
      const records = await client.query<{ record: Stage1Transition }>(
        'select record from pump_stage1.transitions where scope_hash=$1 order by revision',
        [key],
      );
      const rebuilt = await replayStage1(
        head.anchor,
        records.rows.map((r) => r.record),
      );
      if (rebuilt.hash !== head.state_hash) fail('DURABLE_REPLAY_HASH_MISMATCH');
      return rebuilt;
    });
  }
}
