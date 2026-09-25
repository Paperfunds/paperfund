import { randomUUID } from 'node:crypto';

import {
  basisPoints,
  calculateEffectiveMaxBuy,
  calculateMaxBuyByRatio,
  calculatePortfolioEquity,
  identifier,
  paperSolBaseUnits,
  paperSolFromSolString,
  tokenBaseUnits,
} from '@paperfund/core';
import {
  enterCurrentRound,
  executePaperBuy,
  executePaperSell,
  executePaperSellAll,
  FinancialServiceError,
  getCurrentDailyCompetition,
  getCurrentDailyRewardPool,
  getCurrentHourlyRewardPool,
  getHourlyRewardPool,
  reconcileHourlyRewardPool,
  getCurrentRound,
  defaultRewardAccountingConfig,
  type RewardAccountingConfig,
  type DatabaseService,
} from '@paperfund/db';
import {
  ExecutionEngineError,
  valuePortfolioPositions,
  type ExecutionRouter,
  type MarketIdentity,
} from '@paperfund/execution';
import {
  PUMP_FUN_PROTOCOL_ID,
  WRAPPED_SOL_MINT,
  pumpBondingCurveAddress,
} from '@paperfund/protocols';

export interface PageOptions {
  readonly limit: number;
  readonly cursor?: string;
}

type PositionRow = {
  id: string;
  market_id: string;
  mint_address: string;
  decimals: number;
  venue: string;
  remaining_base_units: string;
  cost_basis_lamports: string;
  realized_pnl_lamports: string;
};

export type PositionValuation =
  | {
      readonly status: 'AVAILABLE';
      readonly executablePaperSolLamports: bigint;
      readonly unrealizedPnlLamports: bigint;
      readonly currentProtocol: string;
      readonly evidenceFingerprint: string;
      readonly observedAt: string;
      readonly chainSlot: bigint | null;
      readonly valuedAt: Date;
    }
  | {
      readonly status: 'UNAVAILABLE' | 'STALE' | 'UNSUPPORTED_ROUTE';
      readonly reason: string;
      readonly valuedAt: Date;
    };

function unavailableValuation(error: unknown, valuedAt: Date): PositionValuation {
  const code = error instanceof ExecutionEngineError ? error.code : 'MARKET_STATE_UNAVAILABLE';
  const unsupported = [
    'UNSUPPORTED_PROTOCOL',
    'UNSUPPORTED_MIGRATED_PROTOCOL',
    'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
    'MIGRATION_DESTINATION_UNAVAILABLE',
  ].includes(code);
  return {
    status: unsupported ? 'UNSUPPORTED_ROUTE' : 'UNAVAILABLE',
    reason: code,
    valuedAt,
  };
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor(value: string | undefined): { timestamp: string; id: string } | null {
  if (!value) return null;
  try {
    const result = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof result['timestamp'] !== 'string' || typeof result['id'] !== 'string')
      throw new Error();
    return { timestamp: result['timestamp'], id: result['id'] };
  } catch {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Pagination cursor is invalid.');
  }
}

function rankRows<Row extends { score: string; user_id: string }>(rows: Row[]) {
  const scoreCounts = new Map<string, number>();
  for (const row of rows) scoreCounts.set(row.score, (scoreCounts.get(row.score) ?? 0) + 1);
  let previous: bigint | null = null;
  let rank = 0;
  return rows.map((row, index) => {
    const score = BigInt(row.score);
    if (previous === null || score !== previous) rank = index + 1;
    previous = score;
    const tieGroupSize = scoreCounts.get(row.score)!;
    return { ...row, rank, tied: tieGroupSize > 1, tieGroupSize };
  });
}

export class CompetitionService {
  constructor(
    readonly database: DatabaseService,
    readonly router: ExecutionRouter,
    readonly now: () => Date = () => new Date(),
    readonly rewardConfig: RewardAccountingConfig = defaultRewardAccountingConfig,
  ) {}

  getCurrentRound() {
    return getCurrentRound(this.database, this.now());
  }

  enterRound(userId: string) {
    return enterCurrentRound(this.database, { userId, now: this.now() });
  }

  async getCurrentAccount(userId: string) {
    const now = this.now();
    const result = await this.database.pool.query<{
      id: string;
      hourly_round_id: string;
      starting_paper_sol_lamports: string;
      paper_sol_balance_lamports: string;
      realized_pnl_lamports: string;
      state: string;
      max_unique_tokens: number;
      max_buy_ratio_bps: number;
      slots_used: number;
    }>(
      `select ca.id, ca.hourly_round_id, ca.starting_paper_sol_lamports,
              ca.paper_sol_balance_lamports, ca.realized_pnl_lamports, r.state,
              r.max_unique_tokens, r.max_buy_ratio_bps,
              (select count(*)::int from competition_token_slots s where s.competition_account_id = ca.id) slots_used
       from competition_accounts ca join hourly_rounds r on r.id = ca.hourly_round_id
       where ca.user_id = $1 and r.starts_at <= $2 and r.ends_at_exclusive > $2`,
      [userId, now],
    );
    const account = result.rows[0];
    if (!account) return null;
    const positions = await this.getPositionsForAccount(account.id);
    return { ...account, positions };
  }

  private async getPositionsForAccount(accountId: string) {
    return (
      await this.database.pool.query<PositionRow>(
        `select p.id, p.market_id, a.mint_address, a.decimals, m.venue,
                p.remaining_base_units, p.cost_basis_lamports, p.realized_pnl_lamports
         from positions p join assets a on a.id = p.asset_id join markets m on m.id = p.market_id
         where p.competition_account_id = $1 and p.status = 'OPEN' order by p.opened_at, p.id`,
        [accountId],
      )
    ).rows;
  }

  async getPositions(userId: string) {
    const account = await this.getCurrentAccount(userId);
    if (!account) return null;
    const positions = await this.valuePositions(account.positions);
    const available = positions.every(({ valuation }) => valuation.status === 'AVAILABLE');
    const executablePositionsLamports = available
      ? positions.reduce(
          (total, { valuation }) =>
            total + (valuation.status === 'AVAILABLE' ? valuation.executablePaperSolLamports : 0n),
          0n,
        )
      : null;
    const portfolioEquityLamports =
      executablePositionsLamports === null
        ? null
        : BigInt(account.paper_sol_balance_lamports) + executablePositionsLamports;
    return {
      accountId: account.id,
      roundId: account.hourly_round_id,
      cashLamports: BigInt(account.paper_sol_balance_lamports),
      startingPaperSolLamports: BigInt(account.starting_paper_sol_lamports),
      valuationStatus: available ? ('AVAILABLE' as const) : ('UNAVAILABLE' as const),
      executablePositionsLamports,
      portfolioEquityLamports,
      livePnlLamports:
        portfolioEquityLamports === null
          ? null
          : portfolioEquityLamports - BigInt(account.starting_paper_sol_lamports),
      valuedAt: this.now(),
      positions,
    };
  }

  private async valuePositions(positions: readonly PositionRow[]) {
    const values: Array<PositionRow & { valuation: PositionValuation }> = [];
    for (const position of positions) {
      const valuedAt = this.now();
      try {
        const result = await valuePortfolioPositions(this.router, [
          {
            identity: {
              protocolId: identifier(position.venue, 'ProtocolId'),
              marketId: identifier(position.market_id, 'MarketId'),
              tokenMint: identifier(position.mint_address, 'TokenMint'),
            },
            tokenQuantity: tokenBaseUnits(BigInt(position.remaining_base_units)),
          },
        ]);
        const valued = result.positions[0]!;
        values.push({
          ...position,
          valuation: {
            status: 'AVAILABLE',
            executablePaperSolLamports: valued.value.paperSolValue,
            unrealizedPnlLamports:
              valued.value.paperSolValue - BigInt(position.cost_basis_lamports),
            currentProtocol: valued.value.identity.protocolId,
            evidenceFingerprint: valued.evidence.fingerprint,
            observedAt: valued.evidence.observedAt,
            chainSlot: valued.evidence.chainSlot,
            valuedAt,
          },
        });
      } catch (error) {
        values.push({ ...position, valuation: unavailableValuation(error, valuedAt) });
      }
    }
    return values;
  }

  async buyPreflight(userId: string, mint: string) {
    const account = await this.getCurrentAccount(userId);
    if (!account) {
      throw new FinancialServiceError(
        'ENTITY_NOT_FOUND',
        'Enter the current round before trading.',
      );
    }
    const positions = await this.valuePositions(account.positions);
    const allAvailable = positions.every(({ valuation }) => valuation.status === 'AVAILABLE');
    const positionValues = allAvailable
      ? positions.map(({ valuation }) =>
          paperSolBaseUnits(
            valuation.status === 'AVAILABLE' ? valuation.executablePaperSolLamports : 0n,
          ),
        )
      : null;
    const cash = paperSolBaseUnits(BigInt(account.paper_sol_balance_lamports));
    const equity = positionValues ? calculatePortfolioEquity(cash, positionValues) : null;
    const ratio = basisPoints(BigInt(account.max_buy_ratio_bps));
    const maxByRatio = equity === null ? null : calculateMaxBuyByRatio(equity, ratio);
    const effectiveMax = maxByRatio === null ? null : calculateEffectiveMaxBuy(cash, maxByRatio);
    const slot = (
      await this.database.pool.query<{ existing: number }>(
        `select count(*)::int existing
         from competition_token_slots s join assets a on a.id = s.asset_id
         where s.competition_account_id = $1 and a.mint_address = $2`,
        [account.id, mint],
      )
    ).rows[0];
    let market:
      | Awaited<ReturnType<CompetitionService['marketSupport']>>
      | { mint: string; supported: false; reason: string };
    try {
      market = await this.marketSupport(mint);
    } catch (error) {
      market = {
        mint,
        supported: false,
        reason: error instanceof ExecutionEngineError ? error.code : 'MARKET_STATE_UNAVAILABLE',
      };
    }
    const targetAlreadyConsumesSlot = (slot?.existing ?? 0) > 0;
    return {
      accountId: account.id,
      roundId: account.hourly_round_id,
      cashLamports: cash,
      executablePositionsLamports:
        positionValues === null
          ? null
          : positionValues.reduce<bigint>((total, value) => total + value, 0n),
      portfolioEquityLamports: equity,
      maxBuyByRatioLamports: maxByRatio,
      maxBuyLamports: effectiveMax,
      maxBuyRatioBps: ratio,
      slotsUsed: account.slots_used,
      slotLimit: account.max_unique_tokens,
      targetAlreadyConsumesSlot,
      requiresNewSlot: !targetAlreadyConsumesSlot,
      slotAvailable: targetAlreadyConsumesSlot || account.slots_used < account.max_unique_tokens,
      marketSupported: market.supported,
      protocol: market.supported ? market.executionProtocol : null,
      marketStatus: market.supported ? market.status : market.reason,
      valuationStatus: allAvailable ? ('AVAILABLE' as const) : ('UNAVAILABLE' as const),
      unavailablePositionIds: positions
        .filter(({ valuation }) => valuation.status !== 'AVAILABLE')
        .map(({ id }) => id),
      serverTime: this.now(),
    };
  }

  private async ensurePumpMarket(mint: string): Promise<{
    identity: MarketIdentity;
    decimals: number;
    protocolId: string;
    migrated: boolean;
  }> {
    const marketId = await pumpBondingCurveAddress(mint);
    const identity: MarketIdentity = {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: identifier(marketId, 'MarketId'),
      tokenMint: identifier(mint, 'TokenMint'),
    };
    let route;
    let state;
    try {
      const resolved = await this.router.resolvePositionRoute(identity);
      route = resolved.route;
      state = await resolved.adapter.loadMarketState(route.executionIdentity);
    } catch (error) {
      if (error instanceof ExecutionEngineError) throw error;
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'Market state is unavailable.');
    }
    const decimalsValue = state.normalizedState['tokenDecimals'];
    const decimals = typeof decimalsValue === 'string' ? Number(decimalsValue) : 6;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Token decimals are invalid.');
    }
    const assetId = `asset:${mint}`;
    await this.database.pool.query(
      `insert into assets (id, mint_address, decimals) values ($1, $2, $3)
       on conflict (mint_address) do update set decimals = excluded.decimals`,
      [assetId, mint, decimals],
    );
    const persistedAssetId = (
      await this.database.pool.query<{ id: string }>(
        'select id from assets where mint_address = $1',
        [mint],
      )
    ).rows[0]!.id;
    await this.database.pool.query(
      `insert into assets (id, mint_address, decimals, symbol, name)
       values ('asset:wrapped-sol', $1, 9, 'SOL', 'Wrapped SOL') on conflict (mint_address) do nothing`,
      [WRAPPED_SOL_MINT],
    );
    const quoteAssetId = (
      await this.database.pool.query<{ id: string }>(
        'select id from assets where mint_address = $1',
        [WRAPPED_SOL_MINT],
      )
    ).rows[0]!.id;
    await this.database.pool.query(
      `insert into markets (id, base_asset_id, quote_asset_id, venue, provider_market_id)
       values ($1, $2, $3, $4, $1) on conflict do nothing`,
      [marketId, persistedAssetId, quoteAssetId, PUMP_FUN_PROTOCOL_ID],
    );
    if (route.migrated) {
      await this.database.pool.query(
        `insert into markets (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
         values ($1, $2, $3, $4, $1, jsonb_build_object('migrationResolvedFromMarketId', $5))
         on conflict do nothing`,
        [
          route.executionIdentity.marketId,
          persistedAssetId,
          quoteAssetId,
          route.executionIdentity.protocolId,
          marketId,
        ],
      );
    }
    return {
      identity,
      decimals,
      protocolId: route.executionIdentity.protocolId,
      migrated: route.migrated,
    };
  }

  async marketSupport(mint: string) {
    try {
      const market = await this.ensurePumpMarket(mint);
      const route = await this.router.resolvePositionRoute(market.identity);
      return {
        mint,
        supported: true,
        executionProtocol: route.route.executionIdentity.protocolId,
        status: route.route.migrated ? 'MIGRATED_POOL' : 'ACTIVE_BONDING_CURVE',
        marketId: route.route.executionIdentity.marketId,
        originMarketId: market.identity.marketId,
        tokenDecimals: market.decimals,
      };
    } catch (error) {
      if (
        error instanceof ExecutionEngineError &&
        [
          'MARKET_ACCOUNT_NOT_FOUND',
          'UNSUPPORTED_PROTOCOL',
          'UNSUPPORTED_MIGRATED_PROTOCOL',
        ].includes(error.code)
      ) {
        return { mint, supported: false, reason: error.code };
      }
      throw error;
    }
  }

  async buy(userId: string, input: { mint: string; paperSol: string; idempotencyKey: string }) {
    const account = await this.getCurrentAccount(userId);
    if (!account)
      throw new FinancialServiceError(
        'ENTITY_NOT_FOUND',
        'Enter the current round before trading.',
      );
    let requestedPaperSolLamports;
    try {
      requestedPaperSolLamports = paperSolFromSolString(input.paperSol);
    } catch {
      throw new FinancialServiceError(
        'INVALID_FINANCIAL_INPUT',
        'paperSol must be non-negative decimal text with at most nine decimal places.',
      );
    }
    const originMarketId = await pumpBondingCurveAddress(input.mint);
    const registered = (
      await this.database.pool.query<{ id: string }>('select id from markets where id = $1', [
        originMarketId,
      ])
    ).rows[0];
    const market = registered
      ? {
          identity: {
            protocolId: PUMP_FUN_PROTOCOL_ID,
            marketId: identifier(originMarketId, 'MarketId'),
            tokenMint: identifier(input.mint, 'TokenMint'),
          },
        }
      : await this.ensurePumpMarket(input.mint);
    return executePaperBuy(this.database, this.router, {
      competitionAccountId: account.id,
      marketId: market.identity.marketId,
      requestedPaperSolLamports,
      idempotencyKey: `user:${userId}:${input.idempotencyKey}`,
      authoritativeTimestamp: this.now(),
    });
  }

  async sell(userId: string, input: { mint: string; quantity: string; idempotencyKey: string }) {
    const account = await this.getCurrentAccount(userId);
    if (!account)
      throw new FinancialServiceError(
        'ENTITY_NOT_FOUND',
        'Enter the current round before trading.',
      );
    let position = account.positions.find(({ mint_address }) => mint_address === input.mint);
    const wasOpen = position !== undefined;
    if (!position) {
      position = (
        await this.database.pool.query<{
          id: string;
          market_id: string;
          mint_address: string;
          decimals: number;
          venue: string;
          remaining_base_units: string;
          cost_basis_lamports: string;
          realized_pnl_lamports: string;
        }>(
          `select p.id, p.market_id, a.mint_address, a.decimals, m.venue,
                p.remaining_base_units, p.cost_basis_lamports, p.realized_pnl_lamports
         from positions p join assets a on a.id = p.asset_id join markets m on m.id = p.market_id
         where p.competition_account_id = $1 and a.mint_address = $2
         order by p.updated_at desc limit 1`,
          [account.id, input.mint],
        )
      ).rows[0];
    }
    if (!position)
      throw new FinancialServiceError(
        'INSUFFICIENT_TOKEN_BALANCE',
        'No position exists for this mint.',
      );
    const scopedKey = `user:${userId}:${input.idempotencyKey}`;
    if (input.quantity === 'ALL') {
      return executePaperSellAll(this.database, this.router, {
        competitionAccountId: account.id,
        marketId: position.market_id,
        idempotencyKey: scopedKey,
        authoritativeTimestamp: this.now(),
      });
    }
    if (!wasOpen) {
      const replay = (
        await this.database.pool.query<{ id: string }>(
          `select id from idempotency_records
           where operation_class = 'AUTHORITATIVE_PAPER_SELL' and idempotency_key = $1`,
          [scopedKey],
        )
      ).rows[0];
      if (!replay) {
        throw new FinancialServiceError(
          'INSUFFICIENT_TOKEN_BALANCE',
          'No open position exists for this mint.',
        );
      }
    }
    const quantity = BigInt(input.quantity);
    return executePaperSell(this.database, this.router, {
      competitionAccountId: account.id,
      marketId: position.market_id,
      requestedTokenQuantity: quantity,
      idempotencyKey: scopedKey,
      authoritativeTimestamp: this.now(),
    });
  }

  async trades(userId: string, page: PageOptions) {
    const cursor = decodeCursor(page.cursor);
    const values: unknown[] = [userId, page.limit + 1];
    let cursorSql = '';
    if (cursor) {
      values.push(cursor.timestamp, cursor.id);
      cursorSql = 'and (f.executed_at, f.id) < ($3::timestamptz, $4)';
    }
    const rows = (
      await this.database.pool.query<{
        id: string;
        order_id: string;
        hourly_round_id: string;
        side: string;
        execution_context: string;
        mint_address: string;
        protocol_id: string;
        requested_base_units: string | null;
        requested_quote_lamports: string | null;
        base_quantity: string;
        quote_lamports: string;
        fee_lamports: string;
        actual_input_lamports: string | null;
        actual_output_lamports: string | null;
        realized_pnl_lamports: string;
        executed_at: Date;
      }>(
        `select f.id, f.order_id, ca.hourly_round_id, f.side, o.execution_context,
                a.mint_address, f.protocol_id, o.requested_base_units, o.requested_quote_lamports,
                f.base_quantity, f.quote_lamports, f.fee_lamports, f.actual_input_lamports,
                f.actual_output_lamports, f.realized_pnl_lamports, f.executed_at
         from fills f join orders o on o.id = f.order_id
         join competition_accounts ca on ca.id = o.competition_account_id
         join markets m on m.id = f.market_id join assets a on a.id = m.base_asset_id
         where ca.user_id = $1 ${cursorSql}
         order by f.executed_at desc, f.id desc limit $2`,
        values,
      )
    ).rows;
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor({ timestamp: last.executed_at.toISOString(), id: last.id })
          : null,
    };
  }

  async hourlyResults(userId: string, page: PageOptions) {
    const offset = page.cursor ? Number(page.cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Cursor is invalid.');
    const rows = (
      await this.database.pool.query(
        `select hr.id, hr.hourly_round_id, r.starts_at, r.ends_at_exclusive,
              hr.starting_paper_sol_lamports, hr.final_settled_balance_lamports,
              hr.hourly_pnl_lamports, hr.finalized_at
       from hourly_results hr join hourly_rounds r on r.id = hr.hourly_round_id
       where hr.user_id = $1 order by r.starts_at desc limit $2 offset $3`,
        [userId, page.limit + 1, offset],
      )
    ).rows;
    return {
      items: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? String(offset + page.limit) : null,
    };
  }

  async dailyLeaderboard() {
    const daily = await getCurrentDailyCompetition(this.database, this.now());
    if (!daily) return null;
    const rows = (
      await this.database.pool.query<{
        user_id: string;
        wallet_address: string;
        score: string;
        completed_hourly_round_count: number;
      }>(
        `select dr.user_id, u.wallet_address, dr.cumulative_pnl_lamports score,
              dr.completed_hourly_round_count
       from daily_results dr join users u on u.id = dr.user_id
       where dr.daily_competition_id = $1
       order by dr.cumulative_pnl_lamports desc, dr.user_id`,
        [daily.id],
      )
    ).rows;
    return { dailyCompetition: daily, entries: rankRows(rows) };
  }

  async hourlyLeaderboard(roundId?: string) {
    let id = roundId;
    if (!id) {
      id = (
        await this.database.pool.query<{ id: string }>(
          `select id from hourly_rounds where state = 'FINALIZED' order by starts_at desc limit 1`,
        )
      ).rows[0]?.id;
    }
    if (!id) return null;
    const round = (
      await this.database.pool.query<{
        id: string;
        starts_at: Date;
        ends_at_exclusive: Date;
        state: string;
      }>('select id, starts_at, ends_at_exclusive, state from hourly_rounds where id = $1', [id])
    ).rows[0];
    if (!round || round.state !== 'FINALIZED')
      throw new FinancialServiceError(
        'FINALIZATION_CONFLICT',
        'Hourly leaderboard is available only for finalized rounds.',
      );
    const rows = (
      await this.database.pool.query<{
        user_id: string;
        wallet_address: string;
        score: string;
        final_settled_balance_lamports: string;
      }>(
        `select hr.user_id, u.wallet_address, hr.hourly_pnl_lamports score,
              hr.final_settled_balance_lamports
       from hourly_results hr join users u on u.id = hr.user_id
       where hr.hourly_round_id = $1 order by hr.hourly_pnl_lamports desc, hr.user_id`,
        [id],
      )
    ).rows;
    return { round, entries: rankRows(rows) };
  }

  async currentDailyCompetition() {
    return getCurrentDailyCompetition(this.database, this.now());
  }
  currentHourlyRewardPool() {
    return getCurrentHourlyRewardPool(this.database, this.now(), this.rewardConfig);
  }

  hourlyRewardPool(roundId: string) {
    return getHourlyRewardPool(this.database, roundId, this.rewardConfig);
  }

  currentDailyRewardPool() {
    return getCurrentDailyRewardPool(this.database, this.now(), this.rewardConfig);
  }

  rewardReconciliation(roundId: string) {
    return reconcileHourlyRewardPool(this.database, roundId);
  }
}

export function newRequestId(): string {
  return randomUUID();
}
