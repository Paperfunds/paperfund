import { createHash } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

import {
  basisPoints,
  identifier,
  paperSolBaseUnits,
  tokenBaseUnits,
  utcInstant,
  validateBuyAmount,
} from '@paperfund/core';
import {
  createMarketStateEvidence,
  ExecutionEngineError,
  type ExecutionRouter,
  type JsonObject,
  type MarketIdentity,
  type MarketStateEvidence,
  type SimulatedExecution,
} from '@paperfund/execution';

import type { DatabaseService } from './database.js';

export const DEFAULT_STARTING_PAPER_SOL_LAMPORTS = 10_000_000_000n;

export type FinancialErrorCode =
  | 'INVALID_FINANCIAL_INPUT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ENTITY_NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_POSITION'
  | 'ORDER_MISMATCH'
  | 'ROUND_NOT_OPEN'
  | 'OUTSIDE_ROUND_WINDOW'
  | 'INSUFFICIENT_PAPER_SOL'
  | 'MAX_BUY_RATIO_EXCEEDED'
  | 'TOKEN_SLOT_LIMIT_REACHED'
  | 'UNSUPPORTED_PROTOCOL'
  | 'MARKET_STATE_UNAVAILABLE'
  | 'POSITION_VALUATION_FAILED'
  | 'INVALID_EXECUTION_RESULT'
  | 'TOKEN_LIMIT_EXCEEDED'
  | 'FINALIZATION_CONFLICT'
  | 'DAILY_ATTRIBUTION_MISMATCH';

export class FinancialServiceError extends Error {
  readonly code: FinancialErrorCode;

  constructor(code: FinancialErrorCode, message: string) {
    super(message);
    this.name = 'FinancialServiceError';
    this.code = code;
  }
}

export interface CompetitionAccountFinancialState {
  readonly id: string;
  readonly userId: string;
  readonly hourlyRoundId: string;
  readonly startingPaperSolLamports: bigint;
  readonly paperSolBalanceLamports: bigint;
  readonly realizedPnlLamports: bigint;
  readonly finalSettledBalanceLamports: bigint | null;
  readonly hourlyPnlLamports: bigint | null;
}

export interface PositionState {
  readonly id: string;
  readonly competitionAccountId: string;
  readonly marketId: string;
  readonly assetId: string;
  readonly remainingBaseUnits: bigint;
  readonly costBasisLamports: bigint;
  readonly realizedPnlLamports: bigint;
  readonly status: 'OPEN' | 'CLOSED';
}

export interface FillResult {
  readonly fillId: string;
  readonly orderId: string;
  readonly position: PositionState;
  readonly paperSolBalanceLamports: bigint;
  readonly realizedPnlLamports: bigint;
  readonly costBasisLamportsRemoved: bigint;
  readonly fillRealizedPnlLamports: bigint;
}

export interface HourlyResultState {
  readonly id: string;
  readonly hourlyRoundId: string;
  readonly competitionAccountId: string;
  readonly userId: string;
  readonly finalSettledBalanceLamports: bigint;
  readonly startingPaperSolLamports: bigint;
  readonly hourlyPnlLamports: bigint;
  readonly finalizedAt: Date;
}

export interface DailyResultState {
  readonly id: string;
  readonly dailyCompetitionId: string;
  readonly userId: string;
  readonly cumulativePnlLamports: bigint;
  readonly completedHourlyRoundCount: number;
}

interface IdempotencyRow extends QueryResultRow {
  id: string;
  request_hash: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  result_entity_type: string | null;
  result_entity_id: string | null;
}

interface CompetitionAccountRow extends QueryResultRow {
  id: string;
  user_id: string;
  hourly_round_id: string;
  starting_paper_sol_lamports: string;
  paper_sol_balance_lamports: string;
  realized_pnl_lamports: string;
  final_settled_balance_lamports: string | null;
  hourly_pnl_lamports: string | null;
}

interface PositionRow extends QueryResultRow {
  id: string;
  competition_account_id: string;
  market_id: string;
  asset_id: string;
  remaining_base_units: string;
  cost_basis_lamports: string;
  realized_pnl_lamports: string;
  status: 'OPEN' | 'CLOSED';
}

interface HourlyResultRow extends QueryResultRow {
  id: string;
  hourly_round_id: string;
  competition_account_id: string;
  user_id: string;
  final_settled_balance_lamports: string;
  starting_paper_sol_lamports: string;
  hourly_pnl_lamports: string;
  finalized_at: Date;
}

interface DailyResultRow extends QueryResultRow {
  id: string;
  daily_competition_id: string;
  user_id: string;
  cumulative_pnl_lamports: string;
  completed_hourly_round_count: number;
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function assertNonEmpty(value: string, name: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', `${name} must be non-empty.`);
  }
}

function assertPositive(value: bigint, name: string): void {
  if (value <= 0n) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', `${name} must be positive.`);
  }
}

function firstRow<Row extends QueryResultRow>(result: QueryResult<Row>, entity: string): Row {
  const row = result.rows[0];
  if (!row) throw new FinancialServiceError('ENTITY_NOT_FOUND', `${entity} was not found.`);
  return row;
}

function toCompetitionAccount(row: CompetitionAccountRow): CompetitionAccountFinancialState {
  return {
    id: row.id,
    userId: row.user_id,
    hourlyRoundId: row.hourly_round_id,
    startingPaperSolLamports: BigInt(row.starting_paper_sol_lamports),
    paperSolBalanceLamports: BigInt(row.paper_sol_balance_lamports),
    realizedPnlLamports: BigInt(row.realized_pnl_lamports),
    finalSettledBalanceLamports:
      row.final_settled_balance_lamports === null
        ? null
        : BigInt(row.final_settled_balance_lamports),
    hourlyPnlLamports: row.hourly_pnl_lamports === null ? null : BigInt(row.hourly_pnl_lamports),
  };
}

function toPosition(row: PositionRow): PositionState {
  return {
    id: row.id,
    competitionAccountId: row.competition_account_id,
    marketId: row.market_id,
    assetId: row.asset_id,
    remainingBaseUnits: BigInt(row.remaining_base_units),
    costBasisLamports: BigInt(row.cost_basis_lamports),
    realizedPnlLamports: BigInt(row.realized_pnl_lamports),
    status: row.status,
  };
}

function toHourlyResult(row: HourlyResultRow): HourlyResultState {
  return {
    id: row.id,
    hourlyRoundId: row.hourly_round_id,
    competitionAccountId: row.competition_account_id,
    userId: row.user_id,
    finalSettledBalanceLamports: BigInt(row.final_settled_balance_lamports),
    startingPaperSolLamports: BigInt(row.starting_paper_sol_lamports),
    hourlyPnlLamports: BigInt(row.hourly_pnl_lamports),
    finalizedAt: row.finalized_at,
  };
}

function toDailyResult(row: DailyResultRow): DailyResultState {
  return {
    id: row.id,
    dailyCompetitionId: row.daily_competition_id,
    userId: row.user_id,
    cumulativePnlLamports: BigInt(row.cumulative_pnl_lamports),
    completedHourlyRoundCount: row.completed_hourly_round_count,
  };
}

export async function runFinancialTransaction<Result>(
  database: DatabaseService,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function claimIdempotency(
  client: PoolClient,
  input: {
    readonly operationClass: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly competitionAccountId?: string;
  },
): Promise<{ readonly record: IdempotencyRow; readonly replay: boolean }> {
  assertNonEmpty(input.idempotencyKey, 'Idempotency key');
  const recordId = `idempotency:${input.operationClass}:${input.idempotencyKey}`;
  await client.query(
    `insert into idempotency_records
      (id, operation_class, idempotency_key, request_hash, competition_account_id)
     values ($1, $2, $3, $4, $5)
     on conflict do nothing`,
    [
      recordId,
      input.operationClass,
      input.idempotencyKey,
      input.requestHash,
      input.competitionAccountId ?? null,
    ],
  );
  const record = firstRow(
    await client.query<IdempotencyRow>(
      `select id, request_hash, status, result_entity_type, result_entity_id
       from idempotency_records
       where operation_class = $1 and idempotency_key = $2
       for update`,
      [input.operationClass, input.idempotencyKey],
    ),
    'Idempotency record',
  );
  if (record.request_hash !== input.requestHash) {
    throw new FinancialServiceError(
      'IDEMPOTENCY_CONFLICT',
      'The idempotency key was already used with a different request.',
    );
  }
  return { record, replay: record.status === 'COMPLETED' };
}

async function completeIdempotency(
  client: PoolClient,
  recordId: string,
  resultEntityType: string,
  resultEntityId: string,
  competitionAccountId?: string,
): Promise<void> {
  await client.query(
    `update idempotency_records
     set status = 'COMPLETED', result_entity_type = $2, result_entity_id = $3,
         competition_account_id = coalesce(competition_account_id, $4), completed_at = now()
     where id = $1`,
    [recordId, resultEntityType, resultEntityId, competitionAccountId ?? null],
  );
}

type LedgerAccountCode =
  'CASH' | 'POSITION_COST' | 'HOURLY_STARTING_CAPITAL' | 'TRADING_PNL' | 'TRADING_FEES';

interface JournalEntryInput {
  readonly accountCode: LedgerAccountCode;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountLamports: bigint;
}

async function insertJournal(
  client: PoolClient,
  input: {
    readonly id: string;
    readonly competitionAccountId: string;
    readonly operationType: string;
    readonly sourceEntityType: string;
    readonly sourceEntityId: string;
    readonly idempotencyRecordId: string;
    readonly entries: readonly JournalEntryInput[];
  },
): Promise<void> {
  const debit = input.entries
    .filter(({ direction }) => direction === 'DEBIT')
    .reduce((total, { amountLamports }) => total + amountLamports, 0n);
  const credit = input.entries
    .filter(({ direction }) => direction === 'CREDIT')
    .reduce((total, { amountLamports }) => total + amountLamports, 0n);
  if (input.entries.length < 2 || debit !== credit || debit <= 0n) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Journal entries must balance.');
  }
  await client.query(
    `insert into journal_transactions
      (id, competition_account_id, operation_type, source_entity_type, source_entity_id, idempotency_record_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      input.competitionAccountId,
      input.operationType,
      input.sourceEntityType,
      input.sourceEntityId,
      input.idempotencyRecordId,
    ],
  );
  for (const [index, entry] of input.entries.entries()) {
    await client.query(
      `insert into ledger_entries
        (id, journal_transaction_id, competition_account_id, account_code, direction, amount_lamports)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        `${input.id}:entry:${index.toString()}`,
        input.id,
        input.competitionAccountId,
        entry.accountCode,
        entry.direction,
        entry.amountLamports,
      ],
    );
  }
}

export async function createUser(
  database: DatabaseService,
  input: { readonly id: string; readonly walletAddress: string },
): Promise<void> {
  assertNonEmpty(input.id, 'User ID');
  assertNonEmpty(input.walletAddress, 'Wallet address');
  await database.pool.query('insert into users (id, wallet_address) values ($1, $2)', [
    input.id,
    input.walletAddress,
  ]);
}

function isExactUtcHour(startsAt: Date, endsAtExclusive: Date): boolean {
  return (
    startsAt.getUTCMinutes() === 0 &&
    startsAt.getUTCSeconds() === 0 &&
    startsAt.getUTCMilliseconds() === 0 &&
    endsAtExclusive.getTime() === startsAt.getTime() + 3_600_000
  );
}

export async function createHourlyRound(
  database: DatabaseService,
  input: {
    readonly id: string;
    readonly startsAt: Date;
    readonly endsAtExclusive: Date;
    readonly startingPaperSolLamports?: bigint;
    readonly maxUniqueTokens?: number;
    readonly maxBuyRatioBps?: number;
    readonly rewardFinalizationGracePeriodSeconds?: number;
    readonly rulesVersion: string;
    readonly state?: 'SCHEDULED' | 'OPEN';
  },
): Promise<void> {
  if (!isExactUtcHour(input.startsAt, input.endsAtExclusive)) {
    throw new FinancialServiceError(
      'INVALID_FINANCIAL_INPUT',
      'Hourly rounds must use exact one-hour UTC-aligned windows.',
    );
  }
  await database.pool.query(
    `insert into hourly_rounds
      (id, starts_at, ends_at_exclusive, state, starting_paper_sol_lamports,
       max_unique_tokens, max_buy_ratio_bps, reward_finalization_grace_period_seconds, rules_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.startsAt,
      input.endsAtExclusive,
      input.state ?? 'SCHEDULED',
      input.startingPaperSolLamports ?? DEFAULT_STARTING_PAPER_SOL_LAMPORTS,
      input.maxUniqueTokens ?? 5,
      input.maxBuyRatioBps ?? 2000,
      input.rewardFinalizationGracePeriodSeconds ?? 60,
      input.rulesVersion,
    ],
  );
}

function utcDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function createDailyCompetition(
  database: DatabaseService,
  input: {
    readonly id: string;
    readonly utcDate: string;
    readonly startsAt: Date;
    readonly endsAtExclusive: Date;
    readonly state?: 'OPEN';
  },
): Promise<void> {
  if (
    input.startsAt.getUTCHours() !== 0 ||
    input.startsAt.getUTCMinutes() !== 0 ||
    input.startsAt.getUTCSeconds() !== 0 ||
    input.startsAt.getUTCMilliseconds() !== 0 ||
    input.endsAtExclusive.getTime() !== input.startsAt.getTime() + 86_400_000 ||
    utcDateString(input.startsAt) !== input.utcDate
  ) {
    throw new FinancialServiceError(
      'INVALID_FINANCIAL_INPUT',
      'Daily competitions must use one exact UTC calendar-day window.',
    );
  }
  await database.pool.query(
    `insert into daily_competitions (id, utc_date, starts_at, ends_at_exclusive, state)
     values ($1, $2, $3, $4, $5)`,
    [input.id, input.utcDate, input.startsAt, input.endsAtExclusive, input.state ?? 'OPEN'],
  );
}

export async function createAsset(
  database: DatabaseService,
  input: {
    readonly id: string;
    readonly mintAddress: string;
    readonly decimals: number;
    readonly symbol?: string;
    readonly name?: string;
  },
): Promise<void> {
  await database.pool.query(
    `insert into assets (id, mint_address, decimals, symbol, name) values ($1, $2, $3, $4, $5)`,
    [input.id, input.mintAddress, input.decimals, input.symbol ?? null, input.name ?? null],
  );
}

export async function createMarket(
  database: DatabaseService,
  input: {
    readonly id: string;
    readonly baseAssetId: string;
    readonly quoteAssetId: string;
    readonly venue: string;
    readonly providerMarketId: string;
  },
): Promise<void> {
  await database.pool.query(
    `insert into markets (id, base_asset_id, quote_asset_id, venue, provider_market_id)
     values ($1, $2, $3, $4, $5)`,
    [input.id, input.baseAssetId, input.quoteAssetId, input.venue, input.providerMarketId],
  );
}

async function getAccountStateWithClient(
  client: PoolClient,
  accountId: string,
  forUpdate = false,
): Promise<CompetitionAccountFinancialState> {
  return toCompetitionAccount(
    firstRow(
      await client.query<CompetitionAccountRow>(
        `select id, user_id, hourly_round_id, starting_paper_sol_lamports,
                paper_sol_balance_lamports, realized_pnl_lamports,
                final_settled_balance_lamports, hourly_pnl_lamports
         from competition_accounts where id = $1${forUpdate ? ' for update' : ''}`,
        [accountId],
      ),
      'Competition account',
    ),
  );
}

export async function getAccountFinancialState(
  database: DatabaseService,
  accountId: string,
): Promise<CompetitionAccountFinancialState> {
  const client = await database.pool.connect();
  try {
    return await getAccountStateWithClient(client, accountId);
  } finally {
    client.release();
  }
}

export async function initializeCompetitionAccount(
  database: DatabaseService,
  input: {
    readonly accountId: string;
    readonly userId: string;
    readonly hourlyRoundId: string;
    readonly idempotencyKey: string;
  },
): Promise<CompetitionAccountFinancialState> {
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database, async (client) => {
    const claimed = await claimIdempotency(client, {
      operationClass: 'HOURLY_ACCOUNT_INITIALIZATION',
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
    if (claimed.replay) {
      return getAccountStateWithClient(client, claimed.record.result_entity_id!);
    }
    const round = firstRow(
      await client.query<{ starting_paper_sol_lamports: string }>(
        'select starting_paper_sol_lamports from hourly_rounds where id = $1 for share',
        [input.hourlyRoundId],
      ),
      'Hourly round',
    );
    const startingBalance = BigInt(round.starting_paper_sol_lamports);
    const inserted = await client.query<{ id: string }>(
      `insert into competition_accounts
        (id, user_id, hourly_round_id, starting_paper_sol_lamports, paper_sol_balance_lamports)
       values ($1, $2, $3, $4, $4)
       on conflict (user_id, hourly_round_id) do nothing returning id`,
      [input.accountId, input.userId, input.hourlyRoundId, startingBalance],
    );
    const accountId =
      inserted.rows[0]?.id ??
      firstRow(
        await client.query<{ id: string }>(
          'select id from competition_accounts where user_id = $1 and hourly_round_id = $2',
          [input.userId, input.hourlyRoundId],
        ),
        'Competition account',
      ).id;
    if (inserted.rowCount === 1) {
      await insertJournal(client, {
        id: `journal:hourly-start:${accountId}`,
        competitionAccountId: accountId,
        operationType: 'HOURLY_STARTING_CREDIT',
        sourceEntityType: 'COMPETITION_ACCOUNT',
        sourceEntityId: accountId,
        idempotencyRecordId: claimed.record.id,
        entries: [
          { accountCode: 'CASH', direction: 'DEBIT', amountLamports: startingBalance },
          {
            accountCode: 'HOURLY_STARTING_CAPITAL',
            direction: 'CREDIT',
            amountLamports: startingBalance,
          },
        ],
      });
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      'COMPETITION_ACCOUNT',
      accountId,
      accountId,
    );
    return getAccountStateWithClient(client, accountId);
  });
}

export async function createOrder(
  database: DatabaseService,
  input: {
    readonly orderId: string;
    readonly accountId: string;
    readonly marketId: string;
    readonly side: 'BUY' | 'SELL';
    readonly requestedBaseUnits?: bigint;
    readonly requestedQuoteLamports?: bigint;
    readonly requestedAt: Date;
    readonly idempotencyKey: string;
  },
): Promise<string> {
  const validRequest =
    (input.side === 'BUY' &&
      input.requestedQuoteLamports !== undefined &&
      input.requestedQuoteLamports > 0n &&
      input.requestedBaseUnits === undefined) ||
    (input.side === 'SELL' &&
      input.requestedBaseUnits !== undefined &&
      input.requestedBaseUnits > 0n &&
      input.requestedQuoteLamports === undefined);
  if (!validRequest) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Order request is invalid.');
  }
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database, async (client) => {
    const authority = firstRow(
      await client.query<{ state: string; finalized_at: Date | null }>(
        `select r.state, a.finalized_at
         from competition_accounts a
         join hourly_rounds r on r.id = a.hourly_round_id
         where a.id = $1 for share of r`,
        [input.accountId],
      ),
      'Competition account',
    );
    if (authority.state !== 'OPEN' || authority.finalized_at !== null) {
      throw new FinancialServiceError('ROUND_NOT_OPEN', 'The hourly round is not open.');
    }
    const claimed = await claimIdempotency(client, {
      operationClass: 'ORDER_SUBMISSION',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.accountId,
    });
    if (claimed.replay) return claimed.record.result_entity_id!;
    await client.query(
      `insert into orders
        (id, competition_account_id, market_id, side, requested_base_units,
         requested_quote_lamports, idempotency_record_id, requested_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.orderId,
        input.accountId,
        input.marketId,
        input.side,
        input.requestedBaseUnits ?? null,
        input.requestedQuoteLamports ?? null,
        claimed.record.id,
        input.requestedAt,
      ],
    );
    await completeIdempotency(client, claimed.record.id, 'ORDER', input.orderId, input.accountId);
    return input.orderId;
  });
}

function assertPrice(value: string): void {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value) || /^0(?:\.0+)?$/.test(value)) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Execution price is invalid.');
  }
}

async function getPositionWithClient(
  client: PoolClient,
  positionId: string,
): Promise<PositionState> {
  return toPosition(
    firstRow(
      await client.query<PositionRow>(
        `select id, competition_account_id, market_id, asset_id, remaining_base_units,
                cost_basis_lamports, realized_pnl_lamports, status
         from positions where id = $1`,
        [positionId],
      ),
      'Position',
    ),
  );
}

async function getFillResult(client: PoolClient, fillId: string): Promise<FillResult> {
  const fill = firstRow(
    await client.query<{
      id: string;
      order_id: string;
      cost_basis_lamports_removed: string;
      realized_pnl_lamports: string;
      competition_account_id: string;
      position_id: string;
    }>(
      `select f.id, f.order_id, f.cost_basis_lamports_removed, f.realized_pnl_lamports,
              o.competition_account_id, p.id as position_id
       from fills f
       join orders o on o.id = f.order_id
       join positions p on p.competition_account_id = o.competition_account_id
                       and p.market_id = f.market_id
       where f.id = $1`,
      [fillId],
    ),
    'Fill',
  );
  const account = await getAccountStateWithClient(client, fill.competition_account_id);
  return {
    fillId: fill.id,
    orderId: fill.order_id,
    position: await getPositionWithClient(client, fill.position_id),
    paperSolBalanceLamports: account.paperSolBalanceLamports,
    realizedPnlLamports: account.realizedPnlLamports,
    costBasisLamportsRemoved: BigInt(fill.cost_basis_lamports_removed),
    fillRealizedPnlLamports: BigInt(fill.realized_pnl_lamports),
  };
}

export async function applyFill(
  database: DatabaseService,
  input: {
    readonly fillId: string;
    readonly executionId: string;
    readonly orderId: string;
    readonly baseQuantity: bigint;
    readonly quoteLamports: bigint;
    readonly executionPrice: string;
    readonly feeLamports: bigint;
    readonly executedAt: Date;
    readonly idempotencyKey: string;
    readonly completeOrder?: boolean;
  },
): Promise<FillResult> {
  assertPositive(input.baseQuantity, 'Fill base quantity');
  assertPositive(input.quoteLamports, 'Fill quote amount');
  if (input.feeLamports < 0n) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Fill fee cannot be negative.');
  }
  assertPrice(input.executionPrice);
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database, async (client) => {
    const order = firstRow(
      await client.query<{
        id: string;
        competition_account_id: string;
        market_id: string;
        side: 'BUY' | 'SELL';
        status: string;
        requested_base_units: string | null;
        requested_quote_lamports: string | null;
      }>(
        `select id, competition_account_id, market_id, side, status,
                requested_base_units, requested_quote_lamports
         from orders where id = $1 for update`,
        [input.orderId],
      ),
      'Order',
    );
    const account = await getAccountStateWithClient(client, order.competition_account_id, true);
    const claimed = await claimIdempotency(client, {
      operationClass: 'FILL_APPLICATION',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: order.competition_account_id,
    });
    if (claimed.replay) return getFillResult(client, claimed.record.result_entity_id!);
    if (
      order.status === 'REJECTED' ||
      order.status === 'CANCELLED' ||
      order.status === 'COMPLETED' ||
      account.finalSettledBalanceLamports !== null
    ) {
      throw new FinancialServiceError('ORDER_MISMATCH', 'The order cannot accept fills.');
    }
    const priorFills = firstRow(
      await client.query<{ base_quantity: string; quote_lamports: string }>(
        `select coalesce(sum(base_quantity), 0)::text as base_quantity,
                coalesce(sum(quote_lamports), 0)::text as quote_lamports
         from fills where order_id = $1`,
        [input.orderId],
      ),
      'Fill aggregate',
    );
    if (
      (order.side === 'BUY' &&
        BigInt(priorFills.quote_lamports) + input.quoteLamports >
          BigInt(order.requested_quote_lamports!)) ||
      (order.side === 'SELL' &&
        BigInt(priorFills.base_quantity) + input.baseQuantity > BigInt(order.requested_base_units!))
    ) {
      throw new FinancialServiceError('ORDER_MISMATCH', 'Fill exceeds the order request.');
    }
    const market = firstRow(
      await client.query<{ base_asset_id: string }>(
        'select base_asset_id from markets where id = $1',
        [order.market_id],
      ),
      'Market',
    );
    if (order.side === 'BUY') {
      const existingSlot = await client.query(
        `select id from competition_token_slots
         where competition_account_id = $1 and asset_id = $2`,
        [order.competition_account_id, market.base_asset_id],
      );
      if (existingSlot.rowCount === 0) {
        const capacity = firstRow(
          await client.query<{ used: number; maximum: number }>(
            `select count(s.id)::int as used, r.max_unique_tokens as maximum
             from competition_accounts a
             join hourly_rounds r on r.id = a.hourly_round_id
             left join competition_token_slots s on s.competition_account_id = a.id
             where a.id = $1 group by r.max_unique_tokens`,
            [order.competition_account_id],
          ),
          'Token-slot capacity',
        );
        if (capacity.used >= capacity.maximum) {
          throw new FinancialServiceError(
            'TOKEN_LIMIT_EXCEEDED',
            'The hourly unique-token limit has been reached.',
          );
        }
        await client.query(
          `insert into competition_token_slots
            (id, competition_account_id, asset_id, first_successful_buy_at)
           values ($1, $2, $3, $4)`,
          [
            `slot:${order.competition_account_id}:${market.base_asset_id}`,
            order.competition_account_id,
            market.base_asset_id,
            input.executedAt,
          ],
        );
      }
    }
    const existingPosition = await client.query<PositionRow>(
      `select id, competition_account_id, market_id, asset_id, remaining_base_units,
              cost_basis_lamports, realized_pnl_lamports, status
       from positions where competition_account_id = $1 and market_id = $2 for update`,
      [order.competition_account_id, order.market_id],
    );
    let position: PositionState;
    let costRemoved = 0n;
    let fillRealizedPnl = 0n;
    let nextCash = account.paperSolBalanceLamports;
    let nextRealizedPnl = account.realizedPnlLamports;
    const journalEntries: JournalEntryInput[] = [];
    if (order.side === 'BUY') {
      const cashDebit = input.quoteLamports + input.feeLamports;
      if (nextCash < cashDebit) {
        throw new FinancialServiceError(
          'INSUFFICIENT_BALANCE',
          'Paper SOL balance is insufficient.',
        );
      }
      nextCash -= cashDebit;
      const positionId =
        existingPosition.rows[0]?.id ??
        `position:${order.competition_account_id}:${order.market_id}`;
      if (existingPosition.rows[0]) {
        await client.query(
          `update positions
           set remaining_base_units = remaining_base_units + $2,
               cost_basis_lamports = cost_basis_lamports + $3,
               status = 'OPEN', closed_at = null, updated_at = now()
           where id = $1`,
          [positionId, input.baseQuantity, cashDebit],
        );
      } else {
        await client.query(
          `insert into positions
            (id, competition_account_id, market_id, asset_id, remaining_base_units,
             cost_basis_lamports, status, opened_at)
           values ($1, $2, $3, $4, $5, $6, 'OPEN', $7)`,
          [
            positionId,
            order.competition_account_id,
            order.market_id,
            market.base_asset_id,
            input.baseQuantity,
            cashDebit,
            input.executedAt,
          ],
        );
      }
      journalEntries.push(
        { accountCode: 'POSITION_COST', direction: 'DEBIT', amountLamports: cashDebit },
        { accountCode: 'CASH', direction: 'CREDIT', amountLamports: cashDebit },
      );
      position = await getPositionWithClient(client, positionId);
    } else {
      const row = existingPosition.rows[0];
      if (!row || row.status !== 'OPEN') {
        throw new FinancialServiceError('INSUFFICIENT_POSITION', 'No open position exists.');
      }
      const quantityBefore = BigInt(row.remaining_base_units);
      const costBefore = BigInt(row.cost_basis_lamports);
      if (input.baseQuantity > quantityBefore || input.feeLamports > input.quoteLamports) {
        throw new FinancialServiceError(
          'INSUFFICIENT_POSITION',
          'Sell fill exceeds available value.',
        );
      }
      costRemoved =
        input.baseQuantity === quantityBefore
          ? costBefore
          : (costBefore * input.baseQuantity) / quantityBefore;
      const netProceeds = input.quoteLamports - input.feeLamports;
      fillRealizedPnl = netProceeds - costRemoved;
      nextCash += netProceeds;
      nextRealizedPnl += fillRealizedPnl;
      const remainingQuantity = quantityBefore - input.baseQuantity;
      const remainingCost = costBefore - costRemoved;
      await client.query(
        `update positions
         set remaining_base_units = $2, cost_basis_lamports = $3,
             realized_pnl_lamports = realized_pnl_lamports + $4,
             status = $5, closed_at = $6, updated_at = now()
         where id = $1`,
        [
          row.id,
          remainingQuantity,
          remainingCost,
          fillRealizedPnl,
          remainingQuantity === 0n ? 'CLOSED' : 'OPEN',
          remainingQuantity === 0n ? input.executedAt : null,
        ],
      );
      if (netProceeds > 0n) {
        journalEntries.push({
          accountCode: 'CASH',
          direction: 'DEBIT',
          amountLamports: netProceeds,
        });
      }
      if (input.feeLamports > 0n) {
        journalEntries.push({
          accountCode: 'TRADING_FEES',
          direction: 'DEBIT',
          amountLamports: input.feeLamports,
        });
      }
      if (costRemoved > 0n) {
        journalEntries.push({
          accountCode: 'POSITION_COST',
          direction: 'CREDIT',
          amountLamports: costRemoved,
        });
      }
      const grossPnl = input.quoteLamports - costRemoved;
      if (grossPnl > 0n) {
        journalEntries.push({
          accountCode: 'TRADING_PNL',
          direction: 'CREDIT',
          amountLamports: grossPnl,
        });
      } else if (grossPnl < 0n) {
        journalEntries.push({
          accountCode: 'TRADING_PNL',
          direction: 'DEBIT',
          amountLamports: -grossPnl,
        });
      }
      position = await getPositionWithClient(client, row.id);
    }
    await client.query(
      `update competition_accounts
       set paper_sol_balance_lamports = $2, realized_pnl_lamports = $3 where id = $1`,
      [order.competition_account_id, nextCash, nextRealizedPnl],
    );
    await client.query(
      `insert into fills
        (id, order_id, market_id, execution_id, side, base_quantity, quote_lamports,
         execution_price, fee_lamports, cost_basis_lamports_removed,
         realized_pnl_lamports, idempotency_record_id, executed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.fillId,
        input.orderId,
        order.market_id,
        input.executionId,
        order.side,
        input.baseQuantity,
        input.quoteLamports,
        input.executionPrice,
        input.feeLamports,
        costRemoved,
        fillRealizedPnl,
        claimed.record.id,
        input.executedAt,
      ],
    );
    await insertJournal(client, {
      id: `journal:fill:${input.fillId}`,
      competitionAccountId: order.competition_account_id,
      operationType: order.side === 'BUY' ? 'SIMULATED_BUY' : 'SIMULATED_SELL',
      sourceEntityType: 'FILL',
      sourceEntityId: input.fillId,
      idempotencyRecordId: claimed.record.id,
      entries: journalEntries,
    });
    await client.query('update orders set status = $2, updated_at = now() where id = $1', [
      input.orderId,
      input.completeOrder === false ? 'PARTIALLY_FILLED' : 'COMPLETED',
    ]);
    await completeIdempotency(
      client,
      claimed.record.id,
      'FILL',
      input.fillId,
      order.competition_account_id,
    );
    return {
      fillId: input.fillId,
      orderId: input.orderId,
      position,
      paperSolBalanceLamports: nextCash,
      realizedPnlLamports: nextRealizedPnl,
      costBasisLamportsRemoved: costRemoved,
      fillRealizedPnlLamports: fillRealizedPnl,
    };
  });
}

async function getHourlyResultWithClient(
  client: PoolClient,
  resultId: string,
): Promise<HourlyResultState> {
  return toHourlyResult(
    firstRow(
      await client.query<HourlyResultRow>(
        `select id, hourly_round_id, competition_account_id, user_id,
                final_settled_balance_lamports, starting_paper_sol_lamports,
                hourly_pnl_lamports, finalized_at
         from hourly_results where id = $1`,
        [resultId],
      ),
      'Hourly result',
    ),
  );
}

export async function finalizeHourlyResult(
  database: DatabaseService,
  input: {
    readonly resultId: string;
    readonly accountId: string;
    readonly finalSettledBalanceLamports: bigint;
    readonly finalizedAt: Date;
    readonly idempotencyKey: string;
  },
): Promise<HourlyResultState> {
  if (input.finalSettledBalanceLamports < 0n) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Final balance cannot be negative.');
  }
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database, async (client) => {
    const account = await getAccountStateWithClient(client, input.accountId, true);
    const claimed = await claimIdempotency(client, {
      operationClass: 'HOURLY_RESULT_FINALIZATION',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.accountId,
    });
    if (claimed.replay) return getHourlyResultWithClient(client, claimed.record.result_entity_id!);
    if (
      account.finalSettledBalanceLamports !== null ||
      account.paperSolBalanceLamports !== input.finalSettledBalanceLamports
    ) {
      throw new FinancialServiceError(
        'FINALIZATION_CONFLICT',
        'Final balance does not match the unsettled competition account.',
      );
    }
    const openPositions = firstRow(
      await client.query<{ count: number }>(
        `select count(*)::int as count from positions
         where competition_account_id = $1 and status = 'OPEN'`,
        [input.accountId],
      ),
      'Open-position aggregate',
    );
    if (openPositions.count !== 0) {
      throw new FinancialServiceError(
        'FINALIZATION_CONFLICT',
        'All positions must be closed before hourly finalization.',
      );
    }
    const hourlyPnl = input.finalSettledBalanceLamports - account.startingPaperSolLamports;
    await client.query(
      `update competition_accounts
       set final_settled_balance_lamports = $2, hourly_pnl_lamports = $3, finalized_at = $4
       where id = $1`,
      [input.accountId, input.finalSettledBalanceLamports, hourlyPnl, input.finalizedAt],
    );
    await client.query(
      `insert into hourly_results
        (id, hourly_round_id, competition_account_id, user_id,
         final_settled_balance_lamports, starting_paper_sol_lamports,
         hourly_pnl_lamports, idempotency_record_id, finalized_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.resultId,
        account.hourlyRoundId,
        input.accountId,
        account.userId,
        input.finalSettledBalanceLamports,
        account.startingPaperSolLamports,
        hourlyPnl,
        claimed.record.id,
        input.finalizedAt,
      ],
    );
    await completeIdempotency(
      client,
      claimed.record.id,
      'HOURLY_RESULT',
      input.resultId,
      input.accountId,
    );
    return getHourlyResultWithClient(client, input.resultId);
  });
}

async function getDailyResultWithClient(
  client: PoolClient,
  resultId: string,
): Promise<DailyResultState> {
  return toDailyResult(
    firstRow(
      await client.query<DailyResultRow>(
        `select id, daily_competition_id, user_id, cumulative_pnl_lamports,
                completed_hourly_round_count
         from daily_results where id = $1`,
        [resultId],
      ),
      'Daily result',
    ),
  );
}

export async function contributeHourlyResultToDailyCompetition(
  database: DatabaseService,
  input: {
    readonly dailyResultId: string;
    readonly contributionId: string;
    readonly dailyCompetitionId: string;
    readonly hourlyResultId: string;
    readonly idempotencyKey: string;
  },
): Promise<DailyResultState> {
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database, async (client) => {
    const hourly = firstRow(
      await client.query<{
        user_id: string;
        competition_account_id: string;
        hourly_pnl_lamports: string;
        starts_at: Date;
      }>(
        `select h.user_id, h.competition_account_id, h.hourly_pnl_lamports, r.starts_at
         from hourly_results h join hourly_rounds r on r.id = h.hourly_round_id
         where h.id = $1 for share of h, r`,
        [input.hourlyResultId],
      ),
      'Hourly result',
    );
    const daily = firstRow(
      await client.query<{ starts_at: Date; ends_at_exclusive: Date }>(
        `select starts_at, ends_at_exclusive from daily_competitions where id = $1 for update`,
        [input.dailyCompetitionId],
      ),
      'Daily competition',
    );
    if (hourly.starts_at < daily.starts_at || hourly.starts_at >= daily.ends_at_exclusive) {
      throw new FinancialServiceError(
        'DAILY_ATTRIBUTION_MISMATCH',
        'The hourly round start time does not belong to this UTC day.',
      );
    }
    const claimed = await claimIdempotency(client, {
      operationClass: 'DAILY_RESULT_CONTRIBUTION',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: hourly.competition_account_id,
    });
    if (claimed.replay) return getDailyResultWithClient(client, claimed.record.result_entity_id!);
    const insertedDaily = await client.query<{ id: string }>(
      `insert into daily_results (id, daily_competition_id, user_id)
       values ($1, $2, $3)
       on conflict (daily_competition_id, user_id) do nothing returning id`,
      [input.dailyResultId, input.dailyCompetitionId, hourly.user_id],
    );
    const dailyResultId =
      insertedDaily.rows[0]?.id ??
      firstRow(
        await client.query<{ id: string }>(
          `select id from daily_results where daily_competition_id = $1 and user_id = $2`,
          [input.dailyCompetitionId, hourly.user_id],
        ),
        'Daily result',
      ).id;
    const link = await client.query(
      `insert into daily_result_hourly_results
        (id, daily_result_id, hourly_result_id, idempotency_record_id)
       values ($1, $2, $3, $4)
       on conflict (hourly_result_id) do nothing returning id`,
      [input.contributionId, dailyResultId, input.hourlyResultId, claimed.record.id],
    );
    if (link.rowCount === 1) {
      await client.query(
        `update daily_results
         set cumulative_pnl_lamports = cumulative_pnl_lamports + $2,
             completed_hourly_round_count = completed_hourly_round_count + 1,
             updated_at = now()
         where id = $1`,
        [dailyResultId, BigInt(hourly.hourly_pnl_lamports)],
      );
    } else {
      const existing = firstRow(
        await client.query<{ daily_result_id: string }>(
          `select daily_result_id from daily_result_hourly_results where hourly_result_id = $1`,
          [input.hourlyResultId],
        ),
        'Daily contribution',
      );
      if (existing.daily_result_id !== dailyResultId) {
        throw new FinancialServiceError(
          'DAILY_ATTRIBUTION_MISMATCH',
          'The hourly result was already attributed to another daily result.',
        );
      }
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      'DAILY_RESULT',
      dailyResultId,
      hourly.competition_account_id,
    );
    return getDailyResultWithClient(client, dailyResultId);
  });
}

export interface LedgerReconciliation {
  readonly accountId: string;
  readonly cashFromLedgerLamports: bigint;
  readonly materializedCashLamports: bigint;
  readonly positionCostFromLedgerLamports: bigint;
  readonly materializedPositionCostLamports: bigint;
  readonly quantityFromFills: bigint;
  readonly materializedQuantity: bigint;
  readonly startingCapitalLamports: bigint;
  readonly grossTradingPnlLamports: bigint;
  readonly tradingFeesLamports: bigint;
  readonly realizedPnlLamports: bigint;
  readonly balancedJournalCount: number;
  readonly journalCount: number;
  readonly reconciled: boolean;
}

export async function reconcileAccountLedger(
  database: DatabaseService,
  accountId: string,
): Promise<LedgerReconciliation> {
  const account = await getAccountFinancialState(database, accountId);
  const positionAggregate = firstRow(
    await database.pool.query<{ cost: string; quantity: string }>(
      `select coalesce(sum(cost_basis_lamports), 0)::text as cost,
              coalesce(sum(remaining_base_units), 0)::text as quantity
       from positions where competition_account_id = $1`,
      [accountId],
    ),
    'Position aggregate',
  );
  const fillAggregate = firstRow(
    await database.pool.query<{ quantity: string }>(
      `select coalesce(sum(case when f.side = 'BUY' then f.base_quantity else -f.base_quantity end), 0)::text as quantity
       from fills f join orders o on o.id = f.order_id where o.competition_account_id = $1`,
      [accountId],
    ),
    'Fill aggregate',
  );
  const ledger = await database.pool.query<{
    account_code: LedgerAccountCode;
    balance: string;
  }>(
    `select account_code,
            sum(case when direction = 'DEBIT' then amount_lamports else -amount_lamports end)::text as balance
     from ledger_entries where competition_account_id = $1 group by account_code`,
    [accountId],
  );
  const balance = (code: LedgerAccountCode) =>
    BigInt(ledger.rows.find(({ account_code }) => account_code === code)?.balance ?? '0');
  const journals = firstRow(
    await database.pool.query<{ total: string; balanced: string }>(
      `select count(*)::text as total,
              count(*) filter (where debit = credit)::text as balanced
       from (
         select j.id,
                coalesce(sum(e.amount_lamports) filter (where e.direction = 'DEBIT'), 0) as debit,
                coalesce(sum(e.amount_lamports) filter (where e.direction = 'CREDIT'), 0) as credit
         from journal_transactions j
         left join ledger_entries e on e.journal_transaction_id = j.id
         where j.competition_account_id = $1 group by j.id
       ) journal_balances`,
      [accountId],
    ),
    'Journal aggregate',
  );
  const cash = balance('CASH');
  const positionCost = balance('POSITION_COST');
  const startingCapital = -balance('HOURLY_STARTING_CAPITAL');
  const grossTradingPnl = -balance('TRADING_PNL');
  const tradingFees = balance('TRADING_FEES');
  const realizedPnl = grossTradingPnl - tradingFees;
  const materializedPositionCost = BigInt(positionAggregate.cost);
  const materializedQuantity = BigInt(positionAggregate.quantity);
  const quantityFromFills = BigInt(fillAggregate.quantity);
  const journalCount = Number(journals.total);
  const balancedJournalCount = Number(journals.balanced);
  return {
    accountId,
    cashFromLedgerLamports: cash,
    materializedCashLamports: account.paperSolBalanceLamports,
    positionCostFromLedgerLamports: positionCost,
    materializedPositionCostLamports: materializedPositionCost,
    quantityFromFills,
    materializedQuantity,
    startingCapitalLamports: startingCapital,
    grossTradingPnlLamports: grossTradingPnl,
    tradingFeesLamports: tradingFees,
    realizedPnlLamports: realizedPnl,
    balancedJournalCount,
    journalCount,
    reconciled:
      cash === account.paperSolBalanceLamports &&
      positionCost === materializedPositionCost &&
      quantityFromFills === materializedQuantity &&
      startingCapital === account.startingPaperSolLamports &&
      realizedPnl === account.realizedPnlLamports &&
      cash + positionCost === startingCapital + grossTradingPnl - tradingFees &&
      balancedJournalCount === journalCount,
  };
}

export interface AuthoritativePaperBuyResult {
  readonly orderId: string;
  readonly fillId: string;
  readonly executionId: string;
  readonly competitionAccountId: string;
  readonly marketId: string;
  readonly protocolId: string;
  readonly marketStateEvidenceId: string;
  readonly marketStateFingerprint: string;
  readonly requestedPaperSolLamports: bigint;
  readonly actualPaperSolInputLamports: bigint;
  readonly actualTokenOutputBaseUnits: bigint;
  readonly feeLamports: bigint;
  readonly adapterVersion: string;
  readonly paperSolBalanceLamports: bigint;
  readonly position: PositionState;
  readonly executedAt: Date;
}

interface AuthoritativeMarketRow extends QueryResultRow {
  id: string;
  venue: string;
  base_asset_id: string;
  mint_address: string;
}

interface AuthoritativePositionRow extends PositionRow {
  venue: string;
  mint_address: string;
}

function deterministicEntityId(kind: string, idempotencyKey: string): string {
  return `${kind}:${createHash('sha256').update(idempotencyKey).digest('hex')}`;
}

function executionPrice(numerator: bigint, denominator: bigint): string {
  const scale = 10n ** 18n;
  const scaled = (numerator * scale) / denominator;
  if (scaled <= 0n) {
    throw new FinancialServiceError(
      'INVALID_EXECUTION_RESULT',
      'Execution price is below supported precision.',
    );
  }
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(18, '0');
  return `${whole.toString()}.${fraction}`;
}

function normalizedFeeBreakdown(execution: SimulatedExecution): JsonObject {
  return {
    fees: execution.quote.fees.map((item) => ({
      category: item.category,
      asset: item.amount.asset,
      amount: item.amount.amount.toString(),
      ...(item.amount.asset === 'TOKEN' ? { tokenMint: item.amount.tokenMint } : {}),
    })),
  };
}

function paperSolFeeTotal(execution: SimulatedExecution): bigint {
  return execution.quote.fees.reduce(
    (total, item) => (item.amount.asset === 'PAPER_SOL' ? total + item.amount.amount : total),
    0n,
  );
}

function validateAuthoritativeExecution(input: {
  readonly execution: SimulatedExecution;
  readonly orderId: string;
  readonly executionId: string;
  readonly identity: MarketIdentity;
  readonly requestedPaperSolLamports: bigint;
  readonly availablePaperSolLamports: bigint;
  readonly evidence: MarketStateEvidence;
  readonly adapterVersion: string;
}): void {
  const execution = input.execution;
  if (
    execution.id !== input.executionId ||
    execution.orderId !== input.orderId ||
    execution.quote.orderId !== input.orderId ||
    execution.quote.protocolId !== input.identity.protocolId ||
    execution.quote.marketId !== input.identity.marketId ||
    execution.quote.adapterVersion !== input.adapterVersion ||
    execution.quote.marketStateFingerprint !== input.evidence.fingerprint ||
    execution.quote.normalizationVersion !== input.evidence.normalizationVersion ||
    input.evidence.identity.protocolId !== input.identity.protocolId ||
    input.evidence.identity.marketId !== input.identity.marketId ||
    input.evidence.identity.tokenMint !== input.identity.tokenMint ||
    input.evidence.adapterVersion !== input.adapterVersion ||
    execution.actualInput.asset !== 'PAPER_SOL' ||
    execution.actualOutput.asset !== 'TOKEN' ||
    execution.actualOutput.tokenMint !== input.identity.tokenMint ||
    execution.actualInput.amount <= 0n ||
    execution.actualOutput.amount <= 0n ||
    execution.actualInput.amount > input.requestedPaperSolLamports ||
    execution.actualInput.amount > input.availablePaperSolLamports
  ) {
    throw new FinancialServiceError(
      'INVALID_EXECUTION_RESULT',
      'The adapter returned an invalid or mismatched execution result.',
    );
  }
  const fees = paperSolFeeTotal(execution);
  if (fees < 0n || fees >= execution.actualInput.amount) {
    throw new FinancialServiceError(
      'INVALID_EXECUTION_RESULT',
      'The execution fee breakdown is inconsistent with total input.',
    );
  }
}

async function persistMarketStateEvidence(
  client: PoolClient,
  evidence: MarketStateEvidence,
): Promise<string> {
  const id = `market-state:${evidence.fingerprint}`;
  const rawSource = evidence.rawSource ?? null;
  if (rawSource && Buffer.byteLength(JSON.stringify(rawSource), 'utf8') > 65_536) {
    throw new FinancialServiceError(
      'INVALID_EXECUTION_RESULT',
      'Raw market-state evidence exceeds the 64 KiB safety limit.',
    );
  }
  await client.query(
    `insert into market_state_evidence
      (id, protocol_id, market_id, observed_at, chain_slot, chain_block_id,
       adapter_version, normalization_version, normalized_state, raw_source, state_fingerprint)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
     on conflict (state_fingerprint) do nothing`,
    [
      id,
      evidence.identity.protocolId,
      evidence.identity.marketId,
      new Date(evidence.observedAt),
      evidence.chainSlot,
      evidence.chainBlockId,
      evidence.adapterVersion,
      evidence.normalizationVersion,
      JSON.stringify(evidence.normalizedState),
      rawSource === null ? null : JSON.stringify(rawSource),
      evidence.fingerprint,
    ],
  );
  const persisted = firstRow(
    await client.query<{ id: string; protocol_id: string; market_id: string }>(
      `select id, protocol_id, market_id from market_state_evidence where state_fingerprint = $1`,
      [evidence.fingerprint],
    ),
    'Market-state evidence',
  );
  if (
    persisted.protocol_id !== evidence.identity.protocolId ||
    persisted.market_id !== evidence.identity.marketId
  ) {
    throw new FinancialServiceError(
      'INVALID_EXECUTION_RESULT',
      'The persisted evidence fingerprint has a conflicting identity.',
    );
  }
  return persisted.id;
}

async function getAuthoritativePaperBuyResult(
  client: PoolClient,
  fillId: string,
): Promise<AuthoritativePaperBuyResult> {
  const row = firstRow(
    await client.query<{
      fill_id: string;
      order_id: string;
      execution_id: string;
      competition_account_id: string;
      market_id: string;
      protocol_id: string;
      market_state_evidence_id: string;
      state_fingerprint: string;
      requested_quote_lamports: string;
      actual_input_lamports: string;
      base_quantity: string;
      fee_lamports: string;
      adapter_version: string;
      paper_sol_balance_lamports: string;
      position_id: string;
      executed_at: Date;
    }>(
      `select f.id as fill_id, f.order_id, f.execution_id, o.competition_account_id,
              f.market_id, f.protocol_id, f.market_state_evidence_id, e.state_fingerprint,
              o.requested_quote_lamports, f.actual_input_lamports, f.base_quantity,
              f.fee_lamports, f.adapter_version, a.paper_sol_balance_lamports,
              p.id as position_id, f.executed_at
       from fills f
       join orders o on o.id = f.order_id
       join competition_accounts a on a.id = o.competition_account_id
       join positions p on p.competition_account_id = o.competition_account_id
                       and p.market_id = f.market_id
       join market_state_evidence e on e.id = f.market_state_evidence_id
       where f.id = $1`,
      [fillId],
    ),
    'Authoritative paper buy',
  );
  return {
    orderId: row.order_id,
    fillId: row.fill_id,
    executionId: row.execution_id,
    competitionAccountId: row.competition_account_id,
    marketId: row.market_id,
    protocolId: row.protocol_id,
    marketStateEvidenceId: row.market_state_evidence_id,
    marketStateFingerprint: row.state_fingerprint,
    requestedPaperSolLamports: BigInt(row.requested_quote_lamports),
    actualPaperSolInputLamports: BigInt(row.actual_input_lamports),
    actualTokenOutputBaseUnits: BigInt(row.base_quantity),
    feeLamports: BigInt(row.fee_lamports),
    adapterVersion: row.adapter_version,
    paperSolBalanceLamports: BigInt(row.paper_sol_balance_lamports),
    position: await getPositionWithClient(client, row.position_id),
    executedAt: row.executed_at,
  };
}

function translateExecutionError(error: unknown, valuation: boolean): never {
  if (error instanceof FinancialServiceError) throw error;
  if (error instanceof ExecutionEngineError) {
    if (valuation) {
      throw new FinancialServiceError('POSITION_VALUATION_FAILED', error.message);
    }
    if (error.code === 'UNSUPPORTED_PROTOCOL') {
      throw new FinancialServiceError('UNSUPPORTED_PROTOCOL', error.message);
    }
    if (error.code === 'MARKET_STATE_UNAVAILABLE') {
      throw new FinancialServiceError('MARKET_STATE_UNAVAILABLE', error.message);
    }
    throw new FinancialServiceError('INVALID_EXECUTION_RESULT', error.message);
  }
  throw new FinancialServiceError(
    valuation ? 'POSITION_VALUATION_FAILED' : 'MARKET_STATE_UNAVAILABLE',
    valuation
      ? 'An open position could not be authoritatively valued.'
      : 'Authoritative market state is unavailable.',
  );
}

/**
 * Lock order: idempotency record, hourly round (SHARE), competition account (UPDATE), then all
 * open positions (UPDATE). The account lock serializes cash, 20% equity, slot, and position writes.
 */
export async function executePaperBuy(
  database: DatabaseService,
  router: ExecutionRouter,
  input: {
    readonly competitionAccountId: string;
    readonly marketId: string;
    readonly requestedPaperSolLamports: bigint;
    readonly idempotencyKey: string;
    readonly authoritativeTimestamp: Date;
  },
): Promise<AuthoritativePaperBuyResult> {
  assertPositive(input.requestedPaperSolLamports, 'Requested Paper SOL');
  if (Number.isNaN(input.authoritativeTimestamp.getTime())) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Timestamp is invalid.');
  }
  const requestHash = fingerprint({
    competitionAccountId: input.competitionAccountId,
    marketId: input.marketId,
    requestedPaperSolLamports: input.requestedPaperSolLamports,
    authoritativeTimestamp: input.authoritativeTimestamp,
  });
  const orderId = deterministicEntityId('authoritative-buy-order', input.idempotencyKey);
  const fillId = deterministicEntityId('authoritative-buy-fill', input.idempotencyKey);
  const executionId = deterministicEntityId('authoritative-buy-execution', input.idempotencyKey);

  return runFinancialTransaction(database, async (client) => {
    const claimed = await claimIdempotency(client, {
      operationClass: 'AUTHORITATIVE_PAPER_BUY',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.competitionAccountId,
    });
    if (claimed.replay) {
      return getAuthoritativePaperBuyResult(client, claimed.record.result_entity_id!);
    }

    const accountIdentity = firstRow(
      await client.query<{ hourly_round_id: string }>(
        'select hourly_round_id from competition_accounts where id = $1',
        [input.competitionAccountId],
      ),
      'Competition account',
    );
    const round = firstRow(
      await client.query<{
        state: string;
        starts_at: Date;
        ends_at_exclusive: Date;
        max_unique_tokens: number;
        max_buy_ratio_bps: number;
      }>(
        `select state, starts_at, ends_at_exclusive, max_unique_tokens, max_buy_ratio_bps
         from hourly_rounds where id = $1 for share`,
        [accountIdentity.hourly_round_id],
      ),
      'Hourly round',
    );
    if (round.state !== 'OPEN') {
      throw new FinancialServiceError('ROUND_NOT_OPEN', 'The hourly round is not open.');
    }
    if (
      input.authoritativeTimestamp < round.starts_at ||
      input.authoritativeTimestamp >= round.ends_at_exclusive
    ) {
      throw new FinancialServiceError(
        'OUTSIDE_ROUND_WINDOW',
        'The authoritative timestamp is outside the hourly round window.',
      );
    }

    const account = await getAccountStateWithClient(client, input.competitionAccountId, true);
    if (account.finalSettledBalanceLamports !== null) {
      throw new FinancialServiceError('ROUND_NOT_OPEN', 'The competition account is finalized.');
    }
    const targetMarket = firstRow(
      await client.query<AuthoritativeMarketRow>(
        `select m.id, m.venue, m.base_asset_id, a.mint_address
         from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
        [input.marketId],
      ),
      'Market',
    );
    const positions = (
      await client.query<AuthoritativePositionRow>(
        `select p.id, p.competition_account_id, p.market_id, p.asset_id,
                p.remaining_base_units, p.cost_basis_lamports, p.realized_pnl_lamports,
                p.status, m.venue, a.mint_address
         from positions p
         join markets m on m.id = p.market_id
         join assets a on a.id = p.asset_id
         where p.competition_account_id = $1 and p.status = 'OPEN'
         order by p.id for update of p`,
        [input.competitionAccountId],
      )
    ).rows;

    const valuations: {
      row: AuthoritativePositionRow;
      value: bigint;
      evidence: MarketStateEvidence;
    }[] = [];
    for (const position of positions) {
      const identity: MarketIdentity = {
        protocolId: identifier(position.venue, 'ProtocolId'),
        marketId: identifier(position.market_id, 'MarketId'),
        tokenMint: identifier(position.mint_address, 'TokenMint'),
      };
      try {
        const adapter = router.resolve(identity.protocolId);
        const state = await adapter.loadMarketState(identity);
        const evidence = createMarketStateEvidence(state);
        if (
          evidence.identity.protocolId !== identity.protocolId ||
          evidence.identity.marketId !== identity.marketId ||
          evidence.identity.tokenMint !== identity.tokenMint ||
          evidence.adapterVersion !== adapter.adapterVersion
        ) {
          throw new ExecutionEngineError(
            'INVALID_MARKET_STATE',
            'Loaded valuation state does not match its requested market.',
          );
        }
        const valuation = await adapter.valuePositionForExit(
          { identity, tokenQuantity: tokenBaseUnits(BigInt(position.remaining_base_units)) },
          state,
        );
        if (
          valuation.identity.marketId !== identity.marketId ||
          valuation.identity.protocolId !== identity.protocolId ||
          valuation.identity.tokenMint !== identity.tokenMint ||
          valuation.marketStateFingerprint !== evidence.fingerprint ||
          valuation.adapterVersion !== adapter.adapterVersion ||
          valuation.paperSolValue < 0n
        ) {
          throw new ExecutionEngineError(
            'INVALID_EXECUTION_RESULT',
            'Position valuation does not match its market state.',
          );
        }
        valuations.push({ row: position, value: valuation.paperSolValue, evidence });
      } catch (error) {
        translateExecutionError(error, true);
      }
    }

    const buyValidation = validateBuyAmount({
      requestedBuyAmount: paperSolBaseUnits(input.requestedPaperSolLamports),
      availablePaperSolCash: paperSolBaseUnits(account.paperSolBalanceLamports),
      authoritativePositionValues: valuations.map(({ value }) => paperSolBaseUnits(value)),
      maxBuyRatioBps: basisPoints(BigInt(round.max_buy_ratio_bps)),
    });
    if (!buyValidation.ok) {
      if (buyValidation.reason === 'INSUFFICIENT_PAPER_SOL') {
        throw new FinancialServiceError(
          'INSUFFICIENT_PAPER_SOL',
          'Available Paper SOL is insufficient.',
        );
      }
      if (buyValidation.reason === 'MAX_BUY_RATIO_EXCEEDED') {
        throw new FinancialServiceError(
          'MAX_BUY_RATIO_EXCEEDED',
          'The requested buy exceeds the round maximum-buy ratio.',
        );
      }
      throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Buy amount must be positive.');
    }

    const slotCapacity = firstRow(
      await client.query<{ used: number; existing: number }>(
        `select count(*)::int as used,
                count(*) filter (where asset_id = $2)::int as existing
         from competition_token_slots where competition_account_id = $1`,
        [input.competitionAccountId, targetMarket.base_asset_id],
      ),
      'Token-slot capacity',
    );
    if (slotCapacity.existing === 0 && slotCapacity.used >= round.max_unique_tokens) {
      throw new FinancialServiceError(
        'TOKEN_SLOT_LIMIT_REACHED',
        'The hourly unique-token limit has been reached.',
      );
    }

    const targetIdentity: MarketIdentity = {
      protocolId: identifier(targetMarket.venue, 'ProtocolId'),
      marketId: identifier(targetMarket.id, 'MarketId'),
      tokenMint: identifier(targetMarket.mint_address, 'TokenMint'),
    };
    let execution: SimulatedExecution;
    let buyEvidence: MarketStateEvidence;
    let adapterVersion: string;
    try {
      const adapter = router.resolve(targetIdentity.protocolId);
      const state = await adapter.loadMarketState(targetIdentity);
      buyEvidence = createMarketStateEvidence(state);
      adapterVersion = adapter.adapterVersion;
      execution = await adapter.simulateBuy(
        {
          orderId: identifier(orderId, 'OrderId'),
          executionId: identifier(executionId, 'ExecutionId'),
          identity: targetIdentity,
          requestedPaperSol: paperSolBaseUnits(input.requestedPaperSolLamports),
          executedAt: utcInstant(input.authoritativeTimestamp),
        },
        state,
      );
    } catch (error) {
      translateExecutionError(error, false);
    }
    validateAuthoritativeExecution({
      execution: execution!,
      orderId,
      executionId,
      identity: targetIdentity,
      requestedPaperSolLamports: input.requestedPaperSolLamports,
      availablePaperSolLamports: account.paperSolBalanceLamports,
      evidence: buyEvidence!,
      adapterVersion: adapterVersion!,
    });
    const actualInput = execution!.actualInput.amount;
    const tokenOutput = execution!.actualOutput.amount;
    const feeLamports = paperSolFeeTotal(execution!);
    const quoteLamports = actualInput - feeLamports;

    await client.query(
      `insert into orders
        (id, competition_account_id, market_id, side, requested_quote_lamports,
         status, idempotency_record_id, requested_at)
       values ($1, $2, $3, 'BUY', $4, 'COMPLETED', $5, $6)`,
      [
        orderId,
        input.competitionAccountId,
        input.marketId,
        input.requestedPaperSolLamports,
        claimed.record.id,
        input.authoritativeTimestamp,
      ],
    );
    for (const valuation of valuations) {
      const evidenceId = await persistMarketStateEvidence(client, valuation.evidence);
      await client.query(
        `insert into order_market_state_evidence
          (id, order_id, evidence_id, purpose, position_id, executable_value_lamports)
         values ($1, $2, $3, 'POSITION_EXIT_VALUATION', $4, $5)`,
        [
          `${orderId}:valuation:${valuation.row.id}`,
          orderId,
          evidenceId,
          valuation.row.id,
          valuation.value,
        ],
      );
    }
    const buyEvidenceId = await persistMarketStateEvidence(client, buyEvidence!);
    await client.query(
      `insert into order_market_state_evidence
        (id, order_id, evidence_id, purpose)
       values ($1, $2, $3, 'BUY_EXECUTION')`,
      [`${orderId}:buy-execution`, orderId, buyEvidenceId],
    );

    const existingPosition = positions.find(({ market_id }) => market_id === input.marketId);
    const positionId =
      existingPosition?.id ?? `position:${input.competitionAccountId}:${input.marketId}`;
    if (existingPosition) {
      await client.query(
        `update positions
         set remaining_base_units = remaining_base_units + $2,
             cost_basis_lamports = cost_basis_lamports + $3,
             status = 'OPEN', closed_at = null, updated_at = $4
         where id = $1`,
        [positionId, tokenOutput, actualInput, input.authoritativeTimestamp],
      );
    } else {
      await client.query(
        `insert into positions
          (id, competition_account_id, market_id, asset_id, remaining_base_units,
           cost_basis_lamports, status, opened_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $7)`,
        [
          positionId,
          input.competitionAccountId,
          input.marketId,
          targetMarket.base_asset_id,
          tokenOutput,
          actualInput,
          input.authoritativeTimestamp,
        ],
      );
    }
    await client.query(
      `insert into fills
        (id, order_id, market_id, execution_id, side, base_quantity, quote_lamports,
         execution_price, fee_lamports, actual_input_lamports, fee_breakdown,
         protocol_id, adapter_version, market_state_evidence_id,
         cost_basis_lamports_removed, realized_pnl_lamports, idempotency_record_id, executed_at)
       values ($1, $2, $3, $4, 'BUY', $5, $6, $7, $8, $9, $10::jsonb,
               $11, $12, $13, 0, 0, $14, $15)`,
      [
        fillId,
        orderId,
        input.marketId,
        executionId,
        tokenOutput,
        quoteLamports,
        executionPrice(actualInput, tokenOutput),
        feeLamports,
        actualInput,
        JSON.stringify(normalizedFeeBreakdown(execution!)),
        targetIdentity.protocolId,
        adapterVersion!,
        buyEvidenceId,
        claimed.record.id,
        input.authoritativeTimestamp,
      ],
    );
    if (slotCapacity.existing === 0) {
      await client.query(
        `insert into competition_token_slots
          (id, competition_account_id, asset_id, first_successful_buy_at)
         values ($1, $2, $3, $4)`,
        [
          `slot:${input.competitionAccountId}:${targetMarket.base_asset_id}`,
          input.competitionAccountId,
          targetMarket.base_asset_id,
          input.authoritativeTimestamp,
        ],
      );
    }
    await client.query(
      `update competition_accounts
       set paper_sol_balance_lamports = paper_sol_balance_lamports - $2 where id = $1`,
      [input.competitionAccountId, actualInput],
    );
    await insertJournal(client, {
      id: `journal:authoritative-buy:${fillId}`,
      competitionAccountId: input.competitionAccountId,
      operationType: 'AUTHORITATIVE_SIMULATED_BUY',
      sourceEntityType: 'FILL',
      sourceEntityId: fillId,
      idempotencyRecordId: claimed.record.id,
      entries: [
        { accountCode: 'POSITION_COST', direction: 'DEBIT', amountLamports: actualInput },
        { accountCode: 'CASH', direction: 'CREDIT', amountLamports: actualInput },
      ],
    });
    await completeIdempotency(
      client,
      claimed.record.id,
      'AUTHORITATIVE_BUY_FILL',
      fillId,
      input.competitionAccountId,
    );
    return getAuthoritativePaperBuyResult(client, fillId);
  });
}
