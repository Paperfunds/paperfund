import { genericActor, withGenericAccount } from '@paperfund/protocols';
import { identifier } from '@paperfund/core';
import type { DatabaseService } from '@paperfund/db';
import type { ExecutionRouter } from '@paperfund/execution';
import { exitPreflight } from './exit-preflight.js';

export interface LiveEntry {
  user_id: string;
  wallet_address: string;
  score: string;
  equityLamports: string;
  slotsUsed: number;
  openPositions: number;
  rank: number;
  tied: boolean;
  tieGroupSize: number;
}
type SnapshotAccount = {
  account_id?: string;
  user_id: string;
  wallet_address: string;
  cash: string;
  starting: string;
  slots: number;
  positions: Array<{
    market: string;
    venue: string;
    mint: string;
    quantity: string;
    basis: string;
  }>;
};

/** Entire account/position financial snapshot comes from one PostgreSQL statement.
 * Snapshot-local RPC deduplication never reaches BUY/SELL or settlement authority.
 */
export async function buildLiveStandings(
  database: DatabaseService,
  router: ExecutionRouter,
  roundId: string,
) {
  const accounts = (
    await database.pool.query<SnapshotAccount>(
      `select ca.id account_id, ca.user_id, u.wallet_address, ca.paper_sol_balance_lamports::text cash,
       ca.starting_paper_sol_lamports::text starting,
       (select count(*)::int from competition_token_slots s where s.competition_account_id = ca.id) slots,
       coalesce((select json_agg(json_build_object('market', p.market_id, 'venue', m.venue,
         'mint', a.mint_address, 'quantity', p.remaining_base_units::text, 'basis', p.cost_basis_lamports::text))
         from positions p join markets m on m.id = p.market_id join assets a on a.id = p.asset_id
         where p.competition_account_id = ca.id and p.status = 'OPEN'), '[]'::json) positions
     from competition_accounts ca join users u on u.id = ca.user_id
     where ca.hourly_round_id = $1 order by ca.user_id limit 1001`,
      [roundId],
    )
  ).rows;
  if (accounts.length > 1000)
    return {
      status: 'UNAVAILABLE' as const,
      reason: 'LIVE_CAPACITY_LIMIT',
      entries: [] as LiveEntry[],
    };
  const routes = new Map<string, ReturnType<ExecutionRouter['loadPositionRoute']>>();
  const readRouter = {
    loadPositionRoute(identity: Parameters<ExecutionRouter['loadPositionRoute']>[0]) {
      const actor = genericActor();
      const key = JSON.stringify(identity) + (actor?.isolateCaptures ? '::' + actor.accountId : '');
      if (!routes.has(key)) routes.set(key, router.loadPositionRoute(identity));
      return routes.get(key)!;
    },
  } as ExecutionRouter;
  let next = 0;
  let failed = false;
  const entries: LiveEntry[] = [];
  await Promise.all(
    Array.from({ length: Math.min(4, accounts.length) }, async () => {
      while (next < accounts.length) {
        const account = accounts[next++]!;
        try {
          let equity = BigInt(account.cash);
          for (const position of account.positions) {
            const value = await withGenericAccount(account.account_id ?? '', () =>
              exitPreflight(
                readRouter,
                {
                  protocolId: identifier(position.venue, 'ProtocolId'),
                  marketId: identifier(position.market, 'MarketId'),
                  tokenMint: identifier(position.mint, 'TokenMint'),
                },
                BigInt(position.quantity),
                BigInt(position.basis),
              ),
            );
            if (!value.full.executable) throw new Error('Full-exit valuation unavailable');
            equity += value.full.outputLamports!;
          }
          entries.push({
            user_id: account.user_id,
            wallet_address: account.wallet_address,
            score: (equity - BigInt(account.starting)).toString(),
            equityLamports: equity.toString(),
            slotsUsed: account.slots,
            openPositions: account.positions.length,
            rank: 0,
            tied: false,
            tieGroupSize: 1,
          });
        } catch {
          failed = true;
        }
      }
    }),
  );
  if (failed)
    return {
      status: 'UNAVAILABLE' as const,
      reason: 'POSITION_VALUATION_UNAVAILABLE',
      entries: [] as LiveEntry[],
    };
  entries.sort((a, b) =>
    BigInt(a.score) === BigInt(b.score)
      ? a.user_id.localeCompare(b.user_id)
      : BigInt(a.score) > BigInt(b.score)
        ? -1
        : 1,
  );
  const counts = new Map<string, number>();
  for (const row of entries) counts.set(row.score, (counts.get(row.score) ?? 0) + 1);
  let rank = 0;
  entries.forEach((row, index) => {
    if (index === 0 || entries[index - 1]!.score !== row.score) rank = index + 1;
    row.rank = rank;
    row.tieGroupSize = counts.get(row.score)!;
    row.tied = row.tieGroupSize > 1;
  });
  return { status: 'AVAILABLE' as const, reason: null, entries };
}
