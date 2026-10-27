import {
  ensureCurrentAndNextRounds,
  ensureDailyCompetition,
  openDueRounds,
  settleHourlyRound,
} from '@paperfund/db';
import { ExecutionRouter } from '@paperfund/execution';
import type { ProtocolAdapter } from '@paperfund/execution';
import { withGenericActor } from '@paperfund/protocols';
import { join } from 'node:path';
import { IsolatedV2Adapter } from '../../integration/simple-price-v2-directional/adapter.js';
import { IsolatedHighWater } from '../../candidates/simple-price-v2-directional/high-water.js';
import { bindPrivateRound } from '../../integration/simple-price-v2-directional/service.js';
import type { CutoffArchive } from './archive.js';

/** This adapter can only read a pinned private archive. It cannot acquire or fabricate market prices. */
export function cutoffRouter(
  archive: CutoffArchive,
  round: string,
  cutoff: number,
  directory: string,
) {
  const adapter = new IsolatedV2Adapter(
    archive.db,
    archive.token,
    archive.execution,
    async (identity) =>
      archive.select(
        round,
        {
          mint: identity.tokenMint,
          market: identity.marketId,
          quote: (
            await archive.db.pool.query('select quote_asset_id from markets where id=$1', [
              identity.marketId,
            ])
          ).rows[0].quote_asset_id,
        },
        cutoff,
      ),
    new IsolatedHighWater(
      join(directory, 'cutoff-replay-' + Buffer.from(round).toString('hex')),
      archive.execution,
    ),
    () => new Date(cutoff),
  );
  const wrapper: ProtocolAdapter = {
    protocolId: adapter.protocolId,
    adapterVersion: adapter.adapterVersion,
    loadMarketState: async (identity) => {
      const s = await adapter.loadMarketState(identity);
      return {
        ...s,
        normalizationVersion: s.normalizationVersion + ':PROPOSED_PRE_CUTOFF_V1',
        normalizedState: {
          ...s.normalizedState,
          cutoffSelection: archive.binding,
          cutoffMs: String(cutoff),
        },
      };
    },
    simulateBuy: async () => {
      throw Error('CUTOFF_ARCHIVE_SELL_ONLY');
    },
    simulateSell: async (request, state) => {
      if (new Date(request.executedAt).getTime() !== cutoff)
        throw Error('PINNED_CUTOFF_EXECUTION_REQUIRED');
      return adapter.simulateSell(request, state);
    },
    valuePositionForExit: (request, state) => adapter.valuePositionForExit(request, state),
  };
  return new ExecutionRouter([wrapper]);
}
export async function privateTick(archive: CutoffArchive, directory: string, now: Date) {
  await archive.verifyBinding();
  const db = archive.db,
    lock = await db.pool.connect();
  try {
    await lock.query("select pg_advisory_lock(hashtext('private-final-cutoff-worker'))");
    await ensureDailyCompetition(db, now);
    const ensured = await ensureCurrentAndNextRounds(db, now);
    for (const id of [ensured.currentRoundId, ensured.nextRoundId])
      if (
        !(await db.pool.query('select 1 from private_v2.round_models where round_id=$1', [id]))
          .rowCount
      )
        await bindPrivateRound(db, id, archive.execution);
    await openDueRounds(db, now);
    const due = (
      await db.pool.query<{ id: string; ends_at_exclusive: Date }>(
        `select id,ends_at_exclusive from hourly_rounds
      where ends_at_exclusive<=$1 and state in ('OPEN','CLOSING','SETTLING') order by starts_at`,
        [now],
      )
    ).rows;
    for (const r of due) {
      const control = (
        await db.pool.query('select * from final_v2.control where round_id=$1', [r.id])
      ).rows[0];
      if (control?.status === 'REVIEW_REQUIRED' || control?.status === 'FINALIZED') continue;
      const cutoff = r.ends_at_exclusive.getTime();
      // Persist all selections before any liquidation; unsupported market cannot cause lucky ordering.
      const markets = (
        await db.pool.query<{ mint: string; market: string; quote: string }>(
          `select distinct a.mint_address mint,m.id market,m.quote_asset_id quote
        from positions p join competition_accounts ca on ca.id=p.competition_account_id
        join markets m on m.id=p.market_id join assets a on a.id=p.asset_id
        where ca.hourly_round_id=$1 and p.status='OPEN' order by m.id`,
          [r.id],
        )
      ).rows;
      let selectionFailure: string | null = null;
      for (const i of markets)
        try {
          await archive.select(r.id, i, cutoff);
        } catch (error) {
          selectionFailure = error instanceof Error ? error.message : 'INVALID_CUTOFF_EVIDENCE';
        }
      await db.pool.query(
        `insert into final_v2.control(round_id,status) values($1,'RUNNING') on conflict do nothing`,
        [r.id],
      );
      const router = cutoffRouter(archive, r.id, cutoff, directory);
      if (selectionFailure) {
        const fail = selectionFailure;
        router.loadPositionRoute = async () => {
          throw Error(fail);
        };
      }
      let status = 'REVIEW_REQUIRED',
        failures: unknown;
      try {
        const result = await withGenericActor(
          { intent: 'READ', systemRead: true, isolateCaptures: true },
          () => settleHourlyRound(db, router, { hourlyRoundId: r.id, authoritativeTimestamp: now }),
        );
        status =
          result.state === 'FINALIZED' && !selectionFailure ? 'FINALIZED' : 'REVIEW_REQUIRED';
        failures = { selectionFailure, failures: result.failures };
      } catch (error) {
        failures = {
          selectionFailure,
          reason: error instanceof Error ? error.message : 'SETTLEMENT_OPERATIONAL_FAILURE',
        };
      }
      await lock.query('begin');
      try {
        await lock.query(
          'update final_v2.control set status=$2,passes=passes+1,failures=$3::jsonb where round_id=$1',
          [r.id, status, JSON.stringify(failures)],
        );
        await lock.query(
          'insert into final_v2.audit(round_id,at_ms,event,details) values($1,$2,$3,$4::jsonb)',
          [r.id, now.getTime(), status, JSON.stringify({ binding: archive.binding, failures })],
        );
        await lock.query('commit');
      } catch (error) {
        await lock.query('rollback');
        throw error;
      }
    }
    // Same daily eligibility as original worker; an unresolved round prevents its day from finalizing.
    await db.pool.query(
      "update daily_competitions set state='FINALIZING' where ends_at_exclusive<=$1 and state in ('OPEN','CLOSING')",
      [now],
    );
    await db.pool.query(
      `update daily_competitions d set state='FINALIZED',finalized_at=$1 where d.state='FINALIZING'
      and not exists(select 1 from hourly_rounds r where r.starts_at>=d.starts_at and r.starts_at<d.ends_at_exclusive and r.state<>'FINALIZED')`,
      [now],
    );
    return ensured;
  } finally {
    await lock.query("select pg_advisory_unlock(hashtext('private-final-cutoff-worker'))");
    lock.release();
  }
}
// Audited acknowledgement only; never clears a hold, chooses a replacement price or writes financial entries.
export async function acknowledgeReview(
  archive: CutoffArchive,
  round: string,
  operator: string,
  reference: string,
  note: string,
) {
  await archive.verifyBinding();
  if (!operator.trim() || !reference.trim() || !note.trim())
    throw Error('REVIEW_AUDIT_PROVENANCE_REQUIRED');
  const c = (
    await archive.db.pool.query('select status from final_v2.control where round_id=$1', [round])
  ).rows[0];
  if (c?.status !== 'REVIEW_REQUIRED') throw Error('DURABLE_REVIEW_REQUIRED');
  await archive.db.pool.query(
    'insert into final_v2.audit(round_id,at_ms,event,details) values($1,$2,$3,$4::jsonb)',
    [
      round,
      archive.clock(),
      'OPERATOR_ACKNOWLEDGED',
      JSON.stringify({ operator, reference, note }),
    ],
  );
}
