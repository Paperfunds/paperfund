import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DatabaseService } from './database.js';
import { PayoutPlanError } from './payout-service.js';

export const LEGACY_SETTLEMENT_POLICY = 'legacy-single-liquidation-v1';
export async function recordSettlementReview(
  client: Pick<PoolClient, 'query'>,
  round: string,
  position: string | null,
  reason: string,
) {
  await client.query(
    `insert into legacy_source_reviews(id,hourly_round_id,position_id,reason)
  values($1,$2,$3,$4) on conflict do nothing`,
    [
      'review:' +
        createHash('sha256')
          .update(JSON.stringify([round, position, reason]))
          .digest('hex'),
      round,
      position,
      reason,
    ],
  );
}
export async function assertLegacySource(
  database: Pick<DatabaseService, 'pool'>,
  kind: string,
  source: string,
) {
  const row = (
    await database.pool.query<{ allowed: boolean }>('select legacy_source_allowed($1,$2) allowed', [
      kind,
      source,
    ])
  ).rows[0];
  if (!row?.allowed)
    throw new PayoutPlanError(
      'PAYOUT_SETTLEMENT_REVIEW',
      'Settlement is REVIEW/non-payable or lacks qualified policy evidence.',
    );
}
