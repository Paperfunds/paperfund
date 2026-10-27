import { CompetitionService } from '../../../../apps/api/src/competition.js';
import { FinancialServiceError, defaultRewardAccountingConfig } from '@paperfund/db';
import { withGenericActor, genericActor } from '@paperfund/protocols';
import type { DatabaseService } from '../../../db/src/database.js';
import type { ExecutionRouter } from '@paperfund/execution';
import { MODEL_VERSION, fingerprint } from '../../candidates/simple-price-v2-directional/model.js';
import type { Policy } from '../../candidates/simple-price-v2-directional/model.js';

const noDisplayFx = {
  lookup: async () => ({ status: 'UNAVAILABLE' as const, reason: 'ISOLATED_TEST_NO_EXTERNAL_FX' }),
};
/** Original financial services and API serialization remain intact. Only test DI/scoping is added. */
export class IsolatedCompetitionService extends CompetitionService {
  constructor(
    db: DatabaseService,
    router: ExecutionRouter,
    now: () => Date,
    private policy: Policy,
  ) {
    super(
      db,
      router,
      now,
      defaultRewardAccountingConfig,
      noDisplayFx,
      { maxConcurrent: 4, backgroundConcurrent: 2 },
      true,
    );
  }
  async withAccount<T>(id: string, work: () => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query(
        "select pg_advisory_lock(hashtextextended('private-v2-account:'||$1::text,0))",
        [id],
      );
      const bound = (
        await client.query<{ model_version: string; policy_hash: string }>(
          'select rm.* from competition_accounts ca join private_v2.round_models rm on rm.round_id=ca.hourly_round_id where ca.id=$1',
          [id],
        )
      ).rows[0];
      if (bound?.model_version !== MODEL_VERSION || bound.policy_hash !== fingerprint(this.policy))
        throw new FinancialServiceError(
          'INVALID_FINANCIAL_INPUT',
          'PRIVATE_MODEL_VERSION_MISMATCH',
        );
      return await withGenericActor(
        {
          ...genericActor(),
          intent: genericActor()?.intent ?? 'READ',
          accountId: id,
          isolateCaptures: true,
        },
        work,
      );
    } finally {
      await client.query(
        "select pg_advisory_unlock(hashtextextended('private-v2-account:'||$1::text,0))",
        [id],
      );
      client.release();
    }
  }
  private async scoped<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const account = await super.getCurrentAccount(userId);
    if (!account) return work();
    return this.withAccount(account.id, async () => {
      this.advisory.invalidate();
      try {
        return await work();
      } finally {
        this.advisory.invalidate();
      }
    });
  }
  override buy(userId: string, input: Parameters<CompetitionService['buy']>[1]) {
    return this.scoped(userId, () => super.buy(userId, input));
  }
  override sell(userId: string, input: Parameters<CompetitionService['sell']>[1]) {
    return this.scoped(userId, () => super.sell(userId, input));
  }
  override getPositions(userId: string, signal?: AbortSignal) {
    return this.scoped(userId, () => super.getPositions(userId, signal));
  }
  override buyPreflight(userId: string, mint: string, signal?: AbortSignal) {
    return this.scoped(userId, () => super.buyPreflight(userId, mint, signal));
  }
  override viewedPosition(userId: string, mint: string, signal?: AbortSignal) {
    return this.scoped(userId, () => super.viewedPosition(userId, mint, signal));
  }
  override liveHourlyLeaderboard(roundId?: string) {
    return withGenericActor({ intent: 'READ', systemRead: true, isolateCaptures: true }, () =>
      super.liveHourlyLeaderboard(roundId),
    );
  }
}

/** Held rounds/accounts retain their model. No fallback into v2 when an old position exists. */
export async function bindPrivateRound(
  database: DatabaseService,
  roundId: string,
  policy: Policy,
  model = MODEL_VERSION,
) {
  const round = (
    await database.pool.query<{ state: string }>('select state from hourly_rounds where id=$1', [
      roundId,
    ])
  ).rows[0];
  const activity = (
    await database.pool.query<{ n: number }>(
      'select count(*)::int n from competition_accounts where hourly_round_id=$1',
      [roundId],
    )
  ).rows[0]!.n;
  if (round?.state !== 'SCHEDULED' || activity)
    throw new Error('MODEL_BINDING_REQUIRES_UNOPENED_EMPTY_ROUND');
  await database.pool.query(
    'insert into private_v2.round_models(round_id,model_version,policy_hash) values($1,$2,$3)',
    [roundId, model, fingerprint(policy)],
  );
}
