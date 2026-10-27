import { safeApiErrorMessage } from './safe-diagnostics.js';
import { withGenericSystemRead } from '@paperfund/protocols';
import { withAdvisoryRead } from '@paperfund/protocols';
import type { QueryConfig } from 'pg';
import { createHash } from 'node:crypto';
import { AdvisoryValuations } from './advisory-valuations.js';
import type { HistoricalChartFx } from '@paperfund/shared/browser';
import { randomUUID } from 'node:crypto';

import {
  basisPoints,
  calculateEffectiveMaxBuy,
  calculateMaxBuyByRatio,
  calculatePortfolioEquity,
  identifier,
  paperSolBaseUnits,
  paperSolFromSolString,
} from '@paperfund/core';
import {
  enterCurrentRound,
  executePaperBuy,
  assertPaperBuyAdmission,
  executePaperSell,
  executePaperSellAll,
  FinancialServiceError,
  getCurrentDailyCompetition,
  getCurrentDailyRewardPool,
  getCurrentHourlyRewardPool,
  getDailyPayoutWinners,
  getHourlyRewardPool,
  getHourlyPayoutWinners,
  getPayoutPlanAudit,
  getUserRewardAllocations,
  reconcileHourlyRewardPool,
  getCurrentRound,
  defaultRewardAccountingConfig,
  type RewardAccountingConfig,
  type DatabaseService,
} from '@paperfund/db';
import {
  ExecutionEngineError,
  executionRouteRecord,
  type ExecutionRouter,
  type MarketIdentity,
  type MarketState,
} from '@paperfund/execution';
import {
  PUMP_FUN_PROTOCOL_ID,
  WRAPPED_SOL_MINT,
  pumpBondingCurveAddress,
  chartMintSupply,
} from '@paperfund/protocols';
import type { exitPreflight } from './exit-preflight.js';
import { buildLiveStandings } from './live-leaderboard.js';
import { historicalFillFx, saveCapturedFillFx, type HistoricalFxProvider } from './chart-fx.js';
import { CoinbaseExecutionFxProvider } from './chart-fx-live.js';

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
  updated_at?: Date;
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
  readonly advisory: AdvisoryValuations;
  private advisorySqlActive = 0;
  private advisoryViews = 0;
  private metadataReads = 0;
  private liveCache:
    | {
        key: string;
        expires: number;
        pending: Promise<Awaited<ReturnType<typeof buildLiveStandings>>>;
      }
    | undefined;

  async liveHourlyLeaderboard(roundId?: string) {
    const round = (
      await this.database.pool.query<{
        id: string;
        starts_at: Date;
        ends_at_exclusive: Date;
        state: string;
      }>(
        roundId
          ? 'select id, starts_at, ends_at_exclusive, state from hourly_rounds where id = $1'
          : 'select id, starts_at, ends_at_exclusive, state from hourly_rounds where starts_at <= $1 order by starts_at desc limit 1',
        [roundId ?? this.now()],
      )
    ).rows[0];
    if (!round) return null;
    const serverTime = this.now();
    if (round.state === 'FINALIZED') {
      const final = await this.hourlyLeaderboard(round.id);
      return {
        round,
        phase: 'FINALIZED' as const,
        status: 'AVAILABLE' as const,
        serverTime,
        entries: final!.entries,
        reason: null,
      };
    }
    if (round.state !== 'OPEN' || serverTime >= round.ends_at_exclusive) {
      return {
        round,
        phase: 'SETTLING' as const,
        status: 'AVAILABLE' as const,
        serverTime,
        entries: [],
        reason: null,
      };
    }
    const key = round.id;
    if (!this.liveCache || this.liveCache.key !== key || this.liveCache.expires <= Date.now()) {
      const pending = withGenericSystemRead(
        () => buildLiveStandings(this.database, this.advisory.router(), key),
        this.genericArmed,
      );
      const cache = { key, expires: Number.POSITIVE_INFINITY, pending };
      this.liveCache = cache;
      void pending.then(
        () => {
          cache.expires = Date.now() + 2000;
        },
        () => {
          cache.expires = 0;
        },
      );
    }
    const result = await this.liveCache.pending;
    const fresh = (
      await this.database.pool.query<{ state: string }>(
        'select state from hourly_rounds where id = $1',
        [key],
      )
    ).rows[0];
    if (fresh?.state !== 'OPEN' || this.now() >= round.ends_at_exclusive) {
      return {
        round: { ...round, state: fresh?.state ?? round.state },
        phase: 'SETTLING' as const,
        status: 'AVAILABLE' as const,
        serverTime: this.now(),
        entries: [],
        reason: null,
      };
    }
    return { round, phase: 'LIVE' as const, ...result, serverTime };
  }
  constructor(
    readonly database: DatabaseService,
    readonly router: ExecutionRouter,
    readonly now: () => Date = () => new Date(),
    readonly rewardConfig: RewardAccountingConfig = defaultRewardAccountingConfig,
    readonly chartFx: HistoricalFxProvider = new CoinbaseExecutionFxProvider(),
    readonly advisoryLimits = { maxConcurrent: 4, backgroundConcurrent: 2 },
    readonly genericArmed = false,
  ) {
    this.advisory = new AdvisoryValuations(router, () => this.now().getTime(), advisoryLimits);
  }

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
                p.remaining_base_units, p.cost_basis_lamports, p.realized_pnl_lamports, p.updated_at
         from positions p join assets a on a.id = p.asset_id join markets m on m.id = p.market_id
         where p.competition_account_id = $1 and p.status = 'OPEN' order by p.opened_at, p.id`,
        [accountId],
      )
    ).rows;
  }

  async getPositions(userId: string, signal?: AbortSignal) {
    const account = await this.getCurrentAccount(userId);
    if (!account) return null;
    const positions = await this.valuePositions(account.positions, signal);
    const available = positions.every(({ valuation }) => valuation.status === 'AVAILABLE');
    const conservativeValues = positions.map(({ valuation, sellPreflight }) =>
      valuation.status === 'AVAILABLE'
        ? valuation.executablePaperSolLamports
        : (sellPreflight?.maxExecutableOutputLamports ?? null),
    );
    const conservativelyValued = conservativeValues.every((value) => value !== null);
    const executablePositionsLamports = conservativelyValued
      ? conservativeValues.reduce((total, value) => total + value!, 0n)
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
      equityValuationStatus: !conservativelyValued
        ? ('UNAVAILABLE' as const)
        : available
          ? ('FULL' as const)
          : ('PARTIAL_LIQUIDITY' as const),
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

  private async valuePositions(positions: readonly PositionRow[], signal?: AbortSignal) {
    const values: Array<
      PositionRow & {
        valuation: PositionValuation;
        sellPreflight?: Awaited<ReturnType<typeof exitPreflight>>;
      }
    > = [];
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(2, positions.length) }, async () => {
        while (cursor < positions.length) {
          const index = cursor++;
          const position = positions[index]!;
          const valuedAt = this.now();
          try {
            signal?.throwIfAborted();
            const { exit } = await this.advisory.preflight(
              {
                protocolId: identifier(position.venue, 'ProtocolId'),
                marketId: identifier(position.market_id, 'MarketId'),
                tokenMint: identifier(position.mint_address, 'TokenMint'),
              },
              BigInt(position.remaining_base_units),
              BigInt(position.cost_basis_lamports),
              'background',
              signal,
            );
            values[index] = {
              ...position,
              sellPreflight: exit,
              valuation: exit.full.executable
                ? {
                    status: 'AVAILABLE',
                    executablePaperSolLamports: exit.full.outputLamports!,
                    unrealizedPnlLamports:
                      exit.full.outputLamports! - BigInt(position.cost_basis_lamports),
                    currentProtocol: exit.currentProtocol,
                    evidenceFingerprint: exit.evidenceFingerprint,
                    observedAt: exit.observedAt,
                    chainSlot: exit.chainSlot,
                    valuedAt,
                  }
                : { status: 'UNAVAILABLE', reason: exit.status, valuedAt },
            };
          } catch (error) {
            values[index] = { ...position, valuation: unavailableValuation(error, valuedAt) };
          }
        }
      }),
    );
    return values;
  }

  /** One coherent owner-scoped financial snapshot; never hold a DB transaction during RPC. */
  private async viewedSnapshot(userId: string, mint: string) {
    if (this.advisorySqlActive >= 8)
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'ADVISORY_SQL_BUSY');
    this.advisorySqlActive++;
    const query = this.database.pool.query<{
      account_id: string;
      round_id: string;
      round_state: string;
      ends_at: Date;
      id: string | null;
      market_id: string;
      venue: string;
      decimals: number;
      quantity: string;
      basis: string;
      realized: string;
      updated_at: Date;
      financial_version?: string;
    }>({
      text: `select ca.id account_id,hr.id round_id,hr.state round_state,hr.ends_at_exclusive ends_at,
      p.id,p.market_id,m.venue,a.decimals,p.remaining_base_units::text quantity,
      p.cost_basis_lamports::text basis,p.realized_pnl_lamports::text realized,p.updated_at,
      (select count(*)::text from fills vf join orders vo on vo.id=vf.order_id join markets vm on vm.id=vf.market_id
       where vo.competition_account_id=ca.id and vm.base_asset_id=a.id) financial_version
      from competition_accounts ca join hourly_rounds hr on hr.id=ca.hourly_round_id
      left join assets a on a.mint_address=$2
      left join positions p on p.competition_account_id=ca.id and p.asset_id=a.id and p.status='OPEN'
      left join markets m on m.id=p.market_id
      where ca.user_id=$1 and hr.starts_at <= $3 and hr.ends_at_exclusive > $3`,
      values: [userId, mint, this.now()],
      query_timeout: 600,
    } as QueryConfig & { query_timeout: number });
    const settled = query.finally(() => {
      this.advisorySqlActive--;
    });
    void settled.catch(() => {});
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        settled,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'ADVISORY_SQL_TIMEOUT')),
            600,
          );
        }),
      ]);
      return result.rows[0];
    } catch (error) {
      if (error instanceof ExecutionEngineError) throw error;
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'ADVISORY_SQL_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }
  async viewedPosition(userId: string, mint: string, signal?: AbortSignal) {
    this.advisoryViews++;
    try {
      const started = performance.now();
      const row = await this.viewedSnapshot(userId, mint);
      let sqlMs = performance.now() - started;
      const revision = (r: NonNullable<typeof row>) =>
        createHash('sha256')
          .update(
            JSON.stringify([
              r.account_id,
              r.round_id,
              r.id,
              r.quantity,
              r.basis,
              r.realized,
              r.updated_at,
              r.financial_version,
            ]),
          )
          .digest('hex');
      const envelope = {
        userId,
        accountId: row?.account_id ?? null,
        roundId: row?.round_id ?? null,
        mint,
        revision: row?.id ? revision(row) : null,
        financialVersion: row?.financial_version ?? null,
        positionUpdatedAt: row?.id ? row.updated_at.toISOString() : null,
        snapshotAt: null as string | null,
        chainSlot: null as string | null,
        chainTime: null as string | null,
        completedAt: this.now().toISOString(),
      };
      if (!row)
        return {
          ...envelope,
          status: 'UNAVAILABLE',
          reason: 'ROUND_ACCOUNT_NOT_FOUND',
          position: null,
        };
      if (row.round_state !== 'OPEN')
        return { ...envelope, status: 'ROUND_CLOSED', reason: 'ROUND_NOT_OPEN', position: null };
      if (!row.id)
        return { ...envelope, status: 'NOT_HELD', reason: 'POSITION_NOT_OPEN', position: null };
      const position = {
        id: row.id,
        mint,
        originMarketId: row.market_id,
        originProtocol: row.venue,
        tokenDecimals: row.decimals,
        tokenQuantityBaseUnits: row.quantity,
        costBasisPaperSolLamports: row.basis,
        realizedPnlLamports: row.realized,
      };
      try {
        signal?.throwIfAborted();
        const { exit, metrics, chainTime } = await this.advisory.preflight(
          {
            protocolId: identifier(row.venue, 'ProtocolId'),
            marketId: identifier(row.market_id, 'MarketId'),
            tokenMint: identifier(mint, 'TokenMint'),
          },
          BigInt(row.quantity),
          BigInt(row.basis),
          'viewed',
          signal,
        );
        const checkStart = performance.now(),
          fresh = await this.viewedSnapshot(userId, mint);
        sqlMs += performance.now() - checkStart;
        signal?.throwIfAborted();
        if (!fresh || fresh.round_state !== 'OPEN' || this.now() >= row.ends_at)
          return {
            ...envelope,
            completedAt: this.now().toISOString(),
            status: 'ROUND_CLOSED',
            reason: 'ROUND_CHANGED',
            position: null,
          };
        if (!fresh.id)
          return {
            ...envelope,
            financialVersion: fresh.financial_version ?? null,
            revision: null,
            positionUpdatedAt: null,
            completedAt: this.now().toISOString(),
            status: 'NOT_HELD',
            reason: 'POSITION_NOT_OPEN',
            position: null,
          };
        if (revision(fresh) !== envelope.revision)
          return {
            ...envelope,
            financialVersion: fresh.financial_version ?? null,
            revision: revision(fresh),
            positionUpdatedAt: fresh.updated_at.toISOString(),
            completedAt: this.now().toISOString(),
            status: 'UNAVAILABLE',
            reason: 'POSITION_REVISION_CHANGED',
            position: {
              ...position,
              id: fresh.id,
              originMarketId: fresh.market_id,
              originProtocol: fresh.venue,
              tokenDecimals: fresh.decimals,
              tokenQuantityBaseUnits: fresh.quantity,
              costBasisPaperSolLamports: fresh.basis,
              realizedPnlLamports: fresh.realized,
              valuation: {
                status: 'UNAVAILABLE' as const,
                reason: 'POSITION_REVISION_CHANGED',
                valuedAt: this.now(),
              },
            },
          };
        if (
          exit.chainSlot === null ||
          !chainTime ||
          !Number.isFinite(Date.parse(chainTime)) ||
          Date.now() - Date.parse(chainTime) > 2500 ||
          Date.parse(chainTime) > Date.now() + 1000 ||
          Date.now() - Date.parse(exit.observedAt) > 2500
        )
          throw new Error('SNAPSHOT_FRESHNESS_UNAVAILABLE');
        const valuation = exit.full.executable
          ? {
              status: 'AVAILABLE' as const,
              executablePaperSolLamports: exit.full.outputLamports!,
              unrealizedPnlLamports: exit.full.outputLamports! - BigInt(row.basis),
              currentProtocol: exit.currentProtocol,
              evidenceFingerprint: exit.evidenceFingerprint,
              observedAt: exit.observedAt,
              chainSlot: exit.chainSlot,
              valuedAt: this.now(),
            }
          : { status: 'UNAVAILABLE' as const, reason: exit.status, valuedAt: this.now() };
        return {
          ...envelope,
          status: exit.full.executable ? 'AVAILABLE' : 'UNAVAILABLE',
          reason: exit.full.executable ? null : exit.status,
          snapshotAt: exit.observedAt,
          chainSlot: exit.chainSlot,
          chainTime,
          completedAt: this.now().toISOString(),
          retryAfterMs: this.advisory.retryAfterMs,
          position: { ...position, valuation, sellPreflight: exit },
          ...(process.env['VALUATION_DIAGNOSTICS_ENABLED'] === 'true'
            ? { metrics: { ...metrics, sqlMs, concurrentRequests: this.advisoryViews } }
            : {}),
        };
      } catch (error) {
        const reason = signal?.aborted
          ? 'ADVISORY_CANCELED'
          : error instanceof Error && /^(ADVISORY_|SNAPSHOT_)/.test(error.message)
            ? safeApiErrorMessage(error)
            : error instanceof ExecutionEngineError
              ? error.code
              : 'VALUATION_UNAVAILABLE';
        return {
          ...envelope,
          status: 'UNAVAILABLE',
          reason,
          completedAt: this.now().toISOString(),
          retryAfterMs: this.advisory.retryAfterMs,
          position: {
            ...position,
            valuation: { status: 'UNAVAILABLE', reason, valuedAt: this.now() },
          },
        };
      }
    } finally {
      this.advisoryViews--;
    }
  }

  async buyPreflight(userId: string, mint: string, signal?: AbortSignal) {
    const account = await this.getCurrentAccount(userId);
    if (!account) {
      throw new FinancialServiceError(
        'ENTITY_NOT_FOUND',
        'Enter the current round before trading.',
      );
    }
    const positions = await this.valuePositions(account.positions);
    const allAvailable = positions.every(({ valuation }) => valuation.status === 'AVAILABLE');
    const conservativeValues = positions.map(({ valuation, sellPreflight }) =>
      valuation.status === 'AVAILABLE'
        ? valuation.executablePaperSolLamports
        : (sellPreflight?.maxExecutableOutputLamports ?? null),
    );
    const conservativelyValued = conservativeValues.every((value) => value !== null);
    const positionValues = conservativelyValued
      ? conservativeValues.map((value) => paperSolBaseUnits(value!))
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
      signal?.throwIfAborted();
      market = await this.marketSupport(mint, signal);
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
      equityValuationStatus: !conservativelyValued
        ? ('UNAVAILABLE' as const)
        : allAvailable
          ? ('FULL' as const)
          : ('PARTIAL_LIQUIDITY' as const),
      blockingReason: !market.supported
        ? market.reason
        : 'genericEntryAllowed' in market && market.genericEntryAllowed !== true
          ? 'GENERIC_OPERATOR_ENTRY_DISABLED'
          : !conservativelyValued
            ? 'PORTFOLIO_EQUITY_UNAVAILABLE'
            : null,
      unavailablePositions: positions
        .filter(({ valuation }) => valuation.status !== 'AVAILABLE')
        .map(({ id, mint_address, valuation }) => ({
          id,
          mint: mint_address,
          reason: valuation.status !== 'AVAILABLE' ? valuation.reason : null,
        })),
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
    state: MarketState;
  }> {
    const identity: MarketIdentity = this.router.mintResolver
      ? await this.router.mintResolver(mint)
      : {
          protocolId: PUMP_FUN_PROTOCOL_ID,
          marketId: identifier(await pumpBondingCurveAddress(mint), 'MarketId'),
          tokenMint: identifier(mint, 'TokenMint'),
        };
    const marketId = identity.marketId;
    let route;
    let state;
    try {
      const resolved = await this.router.loadPositionRoute(identity);
      route = resolved.route;
      state = resolved.state;
    } catch (error) {
      if (error instanceof ExecutionEngineError) throw error;
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'Market state is unavailable.');
    }
    const decimalsValue = state.normalizedState['tokenDecimals'];
    const decimals = typeof decimalsValue === 'string' ? Number(decimalsValue) : NaN;
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
      [marketId, persistedAssetId, quoteAssetId, identity.protocolId],
    );
    if (route.migrated) {
      await this.database.pool.query(
        `insert into markets (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
         values ($1, $2, $3, $4, $1, jsonb_build_object('migrationResolvedFromMarketId', $5::text))
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
      state,
    };
  }

  private chartMetadataReads = 0;
  async chartMetadata(context: string) {
    if (this.chartMetadataReads >= 2)
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'CHART_METADATA_BUSY');
    if (!this.router.chartMetadataResolver) throw new Error('CHART_TOKEN_METADATA_MISSING');
    this.chartMetadataReads++;
    try {
      return await withAdvisoryRead(
        {
          signal: AbortSignal.timeout(8000),
          metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 },
        },
        () => this.router.chartMetadataResolver!(context),
      );
    } finally {
      this.chartMetadataReads--;
    }
  }

  async marketSupport(mint: string, signal?: AbortSignal) {
    if (this.metadataReads >= 2)
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'ADVISORY_METADATA_BUSY');
    this.metadataReads++;
    const bounded = AbortSignal.any([
      signal ?? AbortSignal.timeout(8000),
      AbortSignal.timeout(8000),
    ]);
    try {
      return await withAdvisoryRead(
        { signal: bounded, metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 } },
        async () => {
          try {
            const requestedContext = mint;
            if (this.router.contextResolver) mint = await this.router.contextResolver(mint);
            const market = await this.ensurePumpMarket(mint);
            const state = market.state;
            return {
              mint,
              requestedContext,
              supported: true as const,
              executionProtocol: state.identity.protocolId,
              status: market.migrated
                ? 'MIGRATED_POOL'
                : market.identity.protocolId === PUMP_FUN_PROTOCOL_ID
                  ? 'ACTIVE_BONDING_CURVE'
                  : 'RESOLVED_ROUTE',
              route: state.normalizedState['hops'] ?? null,
              routeIdentity: executionRouteRecord(state, true),
              ...(state.identity.protocolId === 'GENERIC_PUMP_SWAP'
                ? {
                    genericEntryAllowed:
                      state.normalizedState['genericBuyAdmissionAllowed'] === true,
                  }
                : {}),
              chainSlot: state.chainSlot?.toString() ?? null,
              marketId: state.identity.marketId,
              originMarketId: market.identity.marketId,
              tokenDecimals: market.decimals,
              tokenSupplyBaseUnits: chartMintSupply(state.normalizedState, mint),
            };
          } catch (error) {
            if (
              error instanceof ExecutionEngineError &&
              [
                'MARKET_ACCOUNT_NOT_FOUND',
                'UNSUPPORTED_PROTOCOL',
                'UNSUPPORTED_MIGRATED_PROTOCOL',
                'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
                'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
              ].includes(error.code)
            ) {
              return {
                mint,
                supported: false as const,
                reason: error.code,
                diagnostics: safeApiErrorMessage(error),
              };
            }
            throw error;
          }
        },
      );
    } finally {
      this.metadataReads--;
    }
  }

  async buy(userId: string, input: { mint: string; paperSol: string; idempotencyKey: string }) {
    await assertPaperBuyAdmission(this.database, { userId });
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
    const originMarketId =
      account.positions.find((p) => p.mint_address === input.mint)?.market_id ??
      (await pumpBondingCurveAddress(input.mint));
    const registered = (
      await this.database.pool.query<{ id: string; venue: string }>(
        'select id, venue from markets where id = $1',
        [originMarketId],
      )
    ).rows[0];
    const market = registered
      ? {
          identity: {
            protocolId: identifier(registered.venue ?? PUMP_FUN_PROTOCOL_ID, 'ProtocolId'),
            marketId: identifier(originMarketId, 'MarketId'),
            tokenMint: identifier(input.mint, 'TokenMint'),
          },
        }
      : await this.ensurePumpMarket(input.mint);
    const executionTime = this.now();
    // Start optional presentation capture in parallel; it cannot gate execution or alter the quote.
    const chartObservation = Promise.resolve()
      .then(() => this.chartFx.lookup(executionTime))
      .catch(() => ({
        status: 'UNAVAILABLE' as const,
        reason: 'CAPTURED_FX_PROVIDER_UNAVAILABLE',
      }));
    const result = await executePaperBuy(this.database, this.router, {
      competitionAccountId: account.id,
      marketId: market.identity.marketId,
      requestedPaperSolLamports,
      idempotencyKey: `user:${userId}:${input.idempotencyKey}`,
      authoritativeTimestamp: executionTime,
    });
    this.liveCache = undefined;
    this.advisory.invalidate();
    try {
      void saveCapturedFillFx(
        this.database,
        result.fillId,
        result.executedAt,
        chartObservation,
      ).catch(() => {
        /* Optional enrichment completes independently of the trade response. */
      });
    } catch {
      /* The BUY already committed; optional display failure cannot change its outcome. */
    }
    return result;
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
    const executionTime = this.now();
    const chartObservation = Promise.resolve()
      .then(() => this.chartFx.lookup(executionTime))
      .catch(() => ({
        status: 'UNAVAILABLE' as const,
        reason: 'CAPTURED_FX_PROVIDER_UNAVAILABLE',
      }));
    if (input.quantity === 'ALL') {
      const result = await executePaperSellAll(this.database, this.router, {
        competitionAccountId: account.id,
        marketId: position.market_id,
        idempotencyKey: scopedKey,
        authoritativeTimestamp: executionTime,
      });
      this.liveCache = undefined;
      try {
        void saveCapturedFillFx(
          this.database,
          result.fillId,
          result.executedAt,
          chartObservation,
        ).catch(() => {
          /* Optional enrichment completes independently of the trade response. */
        });
      } catch {
        /* Optional display only. */
      }
      return result;
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
    const result = await executePaperSell(this.database, this.router, {
      competitionAccountId: account.id,
      marketId: position.market_id,
      requestedTokenQuantity: quantity,
      idempotencyKey: scopedKey,
      authoritativeTimestamp: executionTime,
    });
    this.liveCache = undefined;
    try {
      void saveCapturedFillFx(
        this.database,
        result.fillId,
        result.executedAt,
        chartObservation,
      ).catch(() => {
        /* Optional enrichment completes independently of the trade response. */
      });
    } catch {
      /* Optional display only. */
    }
    return result;
  }

  async trades(userId: string, page: PageOptions, mint?: string) {
    const cursor = decodeCursor(page.cursor);
    const values: unknown[] = [userId, page.limit + 1];
    let cursorSql = '';
    if (cursor) {
      values.push(cursor.timestamp, cursor.id);
      cursorSql = 'and (f.executed_at, f.id) < ($3::timestamptz, $4)';
    }
    if (mint) {
      values.push(mint);
      cursorSql += ` and a.mint_address = $${values.length}`;
    }
    const rows = (
      await this.database.pool.query<{
        id: string;
        order_id: string;
        hourly_round_id: string;
        side: string;
        execution_context: string;
        mint_address: string;
        chart_state: MarketState['normalizedState'] | null;
        competition_account_id: string;
        owner_user_id: string;
        chart_closures: { id: string; quantity: string | null; at: string }[] | null;
        protocol_id: string;
        requested_base_units: string | null;
        requested_quote_lamports: string | null;
        base_quantity: string;
        quote_lamports: string;
        fee_lamports: string;
        actual_input_lamports: string | null;
        actual_output_lamports: string | null;
        realized_pnl_lamports: string;
        cost_basis_lamports_removed: string;
        executed_at: Date;
      }>(
        `select f.id, f.order_id, ca.id as competition_account_id, ca.user_id as owner_user_id, ca.hourly_round_id, f.side, o.execution_context,
                a.mint_address, a.decimals as token_decimals, f.protocol_id, o.requested_base_units, o.requested_quote_lamports,
                f.base_quantity, f.quote_lamports, f.fee_lamports, f.actual_input_lamports,
                f.actual_output_lamports, f.realized_pnl_lamports, f.cost_basis_lamports_removed, f.executed_at,
                mse.normalized_state as chart_state,
                (select jsonb_agg(jsonb_build_object('id',j.id,'quantity',coalesce(j.metadata->>'tokenQuantity',r.token_quantity::text),'at',j.created_at))
                 from journal_transactions j join positions cp on cp.id=j.source_entity_id
                 left join settlement_writeoff_metadata_repairs r on r.journal_transaction_id=j.id
                 where j.competition_account_id=ca.id and cp.asset_id=a.id
                 and j.operation_type='FORCED_HOURLY_SETTLEMENT_WRITEOFF') as chart_closures
         from fills f join orders o on o.id = f.order_id
         join competition_accounts ca on ca.id = o.competition_account_id
         join markets m on m.id = f.market_id join assets a on a.id = m.base_asset_id
         left join market_state_evidence mse on mse.id = f.market_state_evidence_id
         where ca.user_id = $1 ${cursorSql}
         order by f.executed_at desc, f.id desc limit $2`,
        values,
      )
    ).rows;
    const items: Array<
      Omit<(typeof rows)[number], 'chart_state'> & {
        token_supply_base_units: string | null;
        sol_usd_at_execution: string | null;
        sol_usd_fx: HistoricalChartFx;
      }
    > = [];
    const chartDeadline = Date.now() + 2500;
    // Bounded reads; oracle availability cannot block financial trade history.
    for (let start = 0; start < Math.min(rows.length, page.limit); start += 4) {
      items.push(
        ...(await Promise.all(
          rows
            .slice(start, Math.min(start + 4, page.limit))
            .map(async ({ chart_state, ...row }) => {
              const fx =
                mint && Date.now() < chartDeadline
                  ? await historicalFillFx(this.database, row.id, row.executed_at)
                  : { status: 'UNAVAILABLE' as const, reason: 'HISTORICAL_FX_ENRICHMENT_PENDING' };
              return {
                ...row,
                token_supply_base_units: chartMintSupply(chart_state, row.mint_address),
                sol_usd_at_execution: fx.status === 'AVAILABLE' ? fx.rate : null,
                sol_usd_fx: fx,
              };
            }),
        )),
      );
    }
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
              hr.hourly_pnl_lamports, hr.finalized_at,
              pa.competitive_rank reward_rank,
              pa.allocated_lamports reward_allocation_lamports,
              pp.state payout_plan_state
       from hourly_results hr join hourly_rounds r on r.id = hr.hourly_round_id
       left join payout_plans pp on pp.hourly_round_id=hr.hourly_round_id
       left join payout_allocations pa on pa.payout_plan_id=pp.id and pa.user_id=hr.user_id
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

  private async publicPayoutPlan(plan: Awaited<ReturnType<typeof getPayoutPlanAudit>>) {
    if (!plan) return null;
    return {
      ...plan,
      sourceLeaderboard: plan.sourceLeaderboard.map((row) => ({
        walletAddress: row['walletAddress'],
        score: row['score'],
        competitiveRank: row['competitiveRank'],
        tieGroupSize: row['tieGroupSize'],
      })),
      allocations: plan.allocations.map((row) => ({
        walletAddress: row.walletAddress,
        competitiveRank: row.competitiveRank,
        tied: row.tied,
        tieGroupSize: row.tieGroupSize,
        ordinalStart: row.ordinalStart,
        ordinalEnd: row.ordinalEnd,
        fundedOrdinalCount: row.fundedOrdinalCount,
        allocatedLamports: row.allocatedLamports,
        dustAdjustmentLamports: row.dustAdjustmentLamports,
        explanation: {
          fundedOrdinals: row.explanation['fundedOrdinals'],
          combinedFundedLamports: row.explanation['combinedFundedLamports'],
          equalFloorLamports: row.explanation['equalFloorLamports'],
          tieDustLamports: row.explanation['tieDustLamports'],
        },
      })),
    };
  }

  async payoutPlan(planId: string) {
    return this.publicPayoutPlan(await getPayoutPlanAudit(this.database, planId));
  }

  async hourlyPayoutWinners(roundId: string) {
    return this.publicPayoutPlan(await getHourlyPayoutWinners(this.database, roundId));
  }

  async dailyPayoutWinners(idOrDate: string) {
    return this.publicPayoutPlan(await getDailyPayoutWinners(this.database, idOrDate));
  }

  userRewardAllocations(userId: string) {
    return getUserRewardAllocations(this.database, userId);
  }
}

export function newRequestId(): string {
  return randomUUID();
}
