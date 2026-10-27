import { LEGACY_SETTLEMENT_POLICY, recordSettlementReview } from './legacy-settlement.js';
import { withGenericAccount } from '@paperfund/protocols';
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
  canonicalExitPreflight,
  ExecutionEngineError,
  type ExecutionRouter,
  type JsonObject,
  type MarketIdentity,
  type MarketState,
  type MarketStateEvidence,
  type SimulatedExecution,
} from '@paperfund/execution';

import type { DatabaseService, PaperBuyAdmissionContext } from './database.js';

export const DEFAULT_STARTING_PAPER_SOL_LAMPORTS = 10_000_000_000n;

export type FinancialErrorCode =
  | 'PAPER_BUY_DISABLED'
  | 'INVALID_FINANCIAL_INPUT'
  | 'INVALID_SELL_QUANTITY'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ENTITY_NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_POSITION'
  | 'INSUFFICIENT_TOKEN_BALANCE'
  | 'ORDER_MISMATCH'
  | 'ROUND_NOT_OPEN'
  | 'OUTSIDE_ROUND_WINDOW'
  | 'INSUFFICIENT_PAPER_SOL'
  | 'MAX_BUY_RATIO_EXCEEDED'
  | 'TOKEN_SLOT_LIMIT_REACHED'
  | 'UNSUPPORTED_PROTOCOL'
  | 'MARKET_STATE_UNAVAILABLE'
  | 'MARKET_ACCOUNT_NOT_FOUND'
  | 'MARKET_MIGRATED'
  | 'MIGRATION_DESTINATION_UNAVAILABLE'
  | 'UNSUPPORTED_MIGRATED_PROTOCOL'
  | 'POSITION_EXECUTION_ROUTE_UNAVAILABLE'
  | 'RPC_TIMEOUT'
  | 'RPC_ERROR'
  | 'RPC_UNAVAILABLE'
  | 'POSITION_VALUATION_FAILED'
  | 'INVALID_EXECUTION_RESULT'
  | 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'
  | 'ZERO_EXECUTABLE_OUTPUT'
  | 'PROTOCOL_DISABLED'
  | 'ADAPTER_VERSION_UNAVAILABLE'
  | 'EVIDENCE_CORRUPTED'
  | 'SETTLEMENT_INCOMPLETE'
  | 'SETTLEMENT_EXECUTION_FAILED'
  | 'TOKEN_LIMIT_EXCEEDED'
  | 'FINALIZATION_CONFLICT'
  | 'DAILY_ATTRIBUTION_MISMATCH'
  | 'SETTLEMENT_REVIEW';

export class FinancialServiceError extends Error {
  readonly code: FinancialErrorCode;

  constructor(code: FinancialErrorCode, message: string) {
    super(message);
    this.name = 'FinancialServiceError';
    this.code = code;
  }
}

/** Fail closed independently of protocol flags, terminal, expired grants or idempotent results. */
export async function assertPaperBuyAdmission(database: DatabaseService, context: PaperBuyAdmissionContext): Promise<void> {
  let allowed = false;
  try { allowed = (await database.authorizePaperBuy?.(context)) === true; } catch { /* unavailable authority denies */ }
  if (!allowed) throw new FinancialServiceError('PAPER_BUY_DISABLED', 'Paper BUY entry is disabled by server admission control.');
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
    readonly metadata?: JsonObject;
    readonly entries: readonly JournalEntryInput[];
  },
): Promise<void> {
  const debit = input.entries
    .filter(({ direction }) => direction === 'DEBIT')
    .reduce((total, { amountLamports }) => total + amountLamports, 0n);
  const credit = input.entries
    .filter(({ direction }) => direction === 'CREDIT')
    .reduce((total, { amountLamports }) => total + amountLamports, 0n);
  const zeroCostWriteoff =
    input.operationType === 'FORCED_HOURLY_SETTLEMENT_WRITEOFF' &&
    input.entries.length === 0 &&
    input.metadata?.['costBasisLamports'] === '0';
  if (!zeroCostWriteoff && (input.entries.length < 2 || debit !== credit || debit <= 0n)) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Journal entries must balance.');
  }
  await client.query(
    `insert into journal_transactions
      (id, competition_account_id, operation_type, source_entity_type, source_entity_id, idempotency_record_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.competitionAccountId,
      input.operationType,
      input.sourceEntityType,
      input.sourceEntityId,
      input.idempotencyRecordId,
      JSON.stringify(input.metadata ?? {}),
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
    /** When supplied by the product entry API, admission is checked under the round lock. */
    readonly requireOpenAt?: Date;
  },
): Promise<CompetitionAccountFinancialState> {
  const requestHash = fingerprint({
    accountId: input.accountId,
    userId: input.userId,
    hourlyRoundId: input.hourlyRoundId,
  });
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
      await client.query<{
        starting_paper_sol_lamports: string;
        state: string;
        starts_at: Date;
        ends_at_exclusive: Date;
      }>(
        `select starting_paper_sol_lamports, state, starts_at, ends_at_exclusive
         from hourly_rounds where id = $1 for share`,
        [input.hourlyRoundId],
      ),
      'Hourly round',
    );
    if (
      input.requireOpenAt &&
      (round.state !== 'OPEN' ||
        input.requireOpenAt < round.starts_at ||
        input.requireOpenAt >= round.ends_at_exclusive)
    ) {
      throw new FinancialServiceError(
        'ROUND_NOT_OPEN',
        'The hourly round is not open for account entry.',
      );
    }
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
  if (input.side === 'BUY') await assertPaperBuyAdmission(database, { accountId: input.accountId });
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
    if (input.side === 'BUY') await assertPaperBuyAdmission(database, { accountId: input.accountId, client });
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
    if (order.side === 'BUY') await assertPaperBuyAdmission(database, { accountId: order.competition_account_id, client });
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
  const writeoffAggregate = firstRow<{ quantity: string }>(
    await database.pool.query(
      `select coalesce(sum(coalesce(r.token_quantity, (j.metadata->>'tokenQuantity')::numeric)), 0)::text as quantity
       from journal_transactions j left join settlement_writeoff_metadata_repairs r on r.journal_transaction_id = j.id
       where j.competition_account_id = $1 and j.source_entity_type = 'SETTLEMENT_WRITEOFF'`,
      [accountId],
    ),
    'Settlement write-off aggregate',
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
  const quantityFromFills = BigInt(fillAggregate.quantity) - BigInt(writeoffAggregate.quantity);
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
    canonicalRoute: execution.executionDetails?.['canonicalRoute'] ?? null,
    executionDetails: execution.executionDetails ?? null,
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
    typeof execution.actualInput.amount !== 'bigint' ||
    typeof execution.actualOutput.amount !== 'bigint' ||
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
       left join order_market_state_evidence link on link.order_id = o.id and link.purpose = 'BUY_EXECUTION'
       join positions p on p.competition_account_id = o.competition_account_id
                       and (p.id = link.position_id or (link.position_id is null and p.market_id = f.market_id))
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
    if (
      error.code === 'PROTOCOL_DISABLED' ||
      error.code === 'INSUFFICIENT_EXECUTABLE_LIQUIDITY' ||
      error.code === 'ZERO_EXECUTABLE_OUTPUT' ||
      error.code === 'ADAPTER_VERSION_UNAVAILABLE' ||
      error.code === 'EVIDENCE_CORRUPTED'
    ) {
      throw new FinancialServiceError(error.code, error.message);
    }
    if (
      error.code === 'MARKET_ACCOUNT_NOT_FOUND' ||
      error.code === 'MARKET_MIGRATED' ||
      error.code === 'MIGRATION_DESTINATION_UNAVAILABLE' ||
      error.code === 'UNSUPPORTED_MIGRATED_PROTOCOL' ||
      error.code === 'POSITION_EXECUTION_ROUTE_UNAVAILABLE' ||
      error.code === 'RPC_TIMEOUT' ||
      error.code === 'RPC_UNAVAILABLE' ||
      error.code === 'RPC_ERROR'
    ) {
      throw new FinancialServiceError(error.code, error.message);
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
  await assertPaperBuyAdmission(database, { accountId: input.competitionAccountId });
  assertPositive(input.requestedPaperSolLamports, 'Requested Paper SOL');
  if (Number.isNaN(input.authoritativeTimestamp.getTime())) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Timestamp is invalid.');
  }
  const requestHash = fingerprint({
    competitionAccountId: input.competitionAccountId,
    marketId: input.marketId,
    requestedPaperSolLamports: input.requestedPaperSolLamports,
  });
  const orderId = deterministicEntityId('authoritative-buy-order', input.idempotencyKey);
  const fillId = deterministicEntityId('authoritative-buy-fill', input.idempotencyKey);
  const executionId = deterministicEntityId('authoritative-buy-execution', input.idempotencyKey);

  return runFinancialTransaction(database, async (client) => {
    await assertPaperBuyAdmission(database, { accountId: input.competitionAccountId, client });
    await database.lockMarketExecution?.(client, input.competitionAccountId);
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
    if (database.valueMarketPortfolio) {
      try {
        const values = await database.valueMarketPortfolio(
          positions.map((p) => ({
            positionId: p.id,
            identity: {
              protocolId: identifier(p.venue, 'ProtocolId'),
              marketId: identifier(p.market_id, 'MarketId'),
              tokenMint: identifier(p.mint_address, 'TokenMint'),
            },
            quantity: BigInt(p.remaining_base_units),
          })),
        );
        if (values.length !== positions.length)
          throw new ExecutionEngineError(
            'INVALID_EXECUTION_RESULT',
            'Portfolio valuation is incomplete.',
          );
        for (const [i, value] of values.entries()) {
          const row = positions[i]!;
          if (
            value.positionId !== row.id ||
            typeof value.value !== 'bigint' ||
            value.value < 0n ||
            value.evidence.identity.tokenMint !== row.mint_address
          )
            throw new ExecutionEngineError(
              'INVALID_EXECUTION_RESULT',
              'Portfolio valuation does not match the locked positions.',
            );
          valuations.push({ row, value: value.value, evidence: value.evidence });
        }
      } catch (error) {
        translateExecutionError(error, true);
      }
    } else for (const position of positions) {
      const identity: MarketIdentity = {
        protocolId: identifier(position.venue, 'ProtocolId'),
        marketId: identifier(position.market_id, 'MarketId'),
        tokenMint: identifier(position.mint_address, 'TokenMint'),
      };
      try {
        const exit = await withGenericAccount(input.competitionAccountId, () =>
          canonicalExitPreflight(
            router,
            identity,
            BigInt(position.remaining_base_units),
            BigInt(position.cost_basis_lamports),
          ),
        );
        valuations.push({
          row: position,
          value: exit.maxExecutableOutputLamports,
          evidence: exit.evidence,
        });
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
    let executionIdentity = targetIdentity;
    try {
      const { route, adapter, state } = await withGenericAccount(input.competitionAccountId, () =>
        router.loadPositionRoute(targetIdentity),
      );
      executionIdentity = route.executionIdentity;
      // Temporary new-BUY containment only. Inspect the selected route, never discovery
      // candidates or mint identity. SELL, settlement and historical replay bypass this point.
      const selectedHops = state.normalizedState['hops'];
      if (
        Array.isArray(selectedHops) &&
        selectedHops.some(
          (hop) =>
            hop !== null &&
            typeof hop === 'object' &&
            !Array.isArray(hop) &&
            (hop['pool'] === 'J7wveuS29NdZDEDuJp8C7W1BvkkLU88bWHsCtLGaCcbx' ||
              hop['pool'] === '2bDQiRwzoeqLfZ2nQ8decjqhDyAp8f1kx8WW33jwhYXH'),
        )
      ) {
        throw new FinancialServiceError(
          'UNSUPPORTED_PROTOCOL',
          'New BUYs through this pool are temporarily unsupported pending sequential-liquidity simulation support.',
        );
      }
      if (route.migrated) {
        await client.query(
          `insert into markets (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
           select $1, base_asset_id, quote_asset_id, $2, $1,
                  jsonb_build_object('migrationResolvedFromMarketId', id)
           from markets where id = $3 on conflict do nothing`,
          [executionIdentity.marketId, executionIdentity.protocolId, targetIdentity.marketId],
        );
      }
      const destination = firstRow(
        await client.query<AuthoritativeMarketRow>(
          `select m.id, m.venue, m.base_asset_id, a.mint_address
         from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
          [executionIdentity.marketId],
        ),
        'Execution market',
      );
      if (
        destination.venue !== executionIdentity.protocolId ||
        destination.base_asset_id !== targetMarket.base_asset_id ||
        destination.mint_address !== targetIdentity.tokenMint
      ) {
        throw new ExecutionEngineError(
          'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
          'Resolved BUY market does not match its origin asset.',
        );
      }
      buyEvidence = createMarketStateEvidence(state);
      adapterVersion = adapter.adapterVersion;
      execution = await adapter.simulateBuy(
        {
          orderId: identifier(orderId, 'OrderId'),
          executionId: identifier(executionId, 'ExecutionId'),
          identity: executionIdentity,
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
      identity: executionIdentity,
      requestedPaperSolLamports: input.requestedPaperSolLamports,
      availablePaperSolLamports: account.paperSolBalanceLamports,
      evidence: buyEvidence!,
      adapterVersion: adapterVersion!,
    });
    const actualInput = execution!.actualInput.amount;
    const tokenOutput = execution!.actualOutput.amount;
    const feeLamports = paperSolFeeTotal(execution!);
    const quoteLamports = actualInput - feeLamports;
    await assertPaperBuyAdmission(database, { accountId: input.competitionAccountId, client });

    await client.query(
      `insert into orders
        (id, competition_account_id, market_id, side, requested_quote_lamports,
         status, idempotency_record_id, requested_at)
       values ($1, $2, $3, 'BUY', $4, 'COMPLETED', $5, $6)`,
      [
        orderId,
        input.competitionAccountId,
        executionIdentity.marketId,
        input.requestedPaperSolLamports,
        claimed.record.id,
        input.authoritativeTimestamp,
      ],
    );
    for (const valuation of valuations) {
      // A later migration/composed venue may be first observed while valuing a holding.
      // Register its economic asset linkage before persisting the snapshot's FK.
      if (valuation.evidence.identity.marketId !== valuation.row.market_id) {
        await client.query(
          `insert into markets (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
           select $1, base_asset_id, quote_asset_id, $2, $1,
                  jsonb_build_object('migrationResolvedFromMarketId', id)
           from markets where id = $3 on conflict do nothing`,
          [
            valuation.evidence.identity.marketId,
            valuation.evidence.identity.protocolId,
            valuation.row.market_id,
          ],
        );
      }
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

    const existingPosition =
      positions.find(({ market_id }) => market_id === input.marketId) ??
      (
        await client.query<AuthoritativePositionRow>(
          `select p.id, p.competition_account_id, p.market_id, p.asset_id,
                  p.remaining_base_units, p.cost_basis_lamports, p.realized_pnl_lamports,
                  p.status, m.venue, a.mint_address
           from positions p
           join markets m on m.id = p.market_id
           join assets a on a.id = p.asset_id
           where p.competition_account_id = $1 and p.market_id = $2 for update of p`,
          [input.competitionAccountId, input.marketId],
        )
      ).rows[0];
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
      `insert into order_market_state_evidence
        (id, order_id, evidence_id, purpose, position_id)
       values ($1, $2, $3, 'BUY_EXECUTION', $4)`,
      [`${orderId}:buy-execution`, orderId, buyEvidenceId, positionId],
    );
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
        executionIdentity.marketId,
        executionId,
        tokenOutput,
        quoteLamports,
        executionPrice(actualInput, tokenOutput),
        feeLamports,
        actualInput,
        JSON.stringify(normalizedFeeBreakdown(execution!)),
        executionIdentity.protocolId,
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
    await database.commitMarketExecution?.(client, { accountId: input.competitionAccountId, roundId: accountIdentity.hourly_round_id, fillId, execution: execution!, executionContext: 'NORMAL_USER' });
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

export type SellExecutionContext = 'NORMAL_USER' | 'FORCED_HOURLY_SETTLEMENT';

export interface AuthoritativePaperSellResult {
  readonly orderId: string;
  readonly fillId: string;
  readonly executionId: string;
  readonly competitionAccountId: string;
  readonly marketId: string;
  readonly protocolId: string;
  readonly executionContext: SellExecutionContext;
  readonly marketStateEvidenceId: string;
  readonly marketStateFingerprint: string;
  readonly requestedTokenQuantity: bigint;
  readonly actualTokenInputBaseUnits: bigint;
  readonly actualNetPaperSolOutputLamports: bigint;
  readonly feeLamports: bigint;
  readonly costBasisLamportsRemoved: bigint;
  readonly fillRealizedPnlLamports: bigint;
  readonly adapterVersion: string;
  readonly paperSolBalanceLamports: bigint;
  readonly position: PositionState;
  readonly executedAt: Date;
}

async function getAuthoritativePaperSellResult(
  client: PoolClient,
  fillId: string,
): Promise<AuthoritativePaperSellResult> {
  const row = firstRow(
    await client.query<{
      fill_id: string;
      order_id: string;
      execution_id: string;
      competition_account_id: string;
      market_id: string;
      protocol_id: string;
      execution_context: SellExecutionContext;
      market_state_evidence_id: string;
      state_fingerprint: string;
      requested_base_units: string;
      base_quantity: string;
      actual_output_lamports: string;
      fee_lamports: string;
      cost_basis_lamports_removed: string;
      realized_pnl_lamports: string;
      adapter_version: string;
      paper_sol_balance_lamports: string;
      position_id: string;
      executed_at: Date;
    }>(
      `select f.id as fill_id, f.order_id, f.execution_id, o.competition_account_id,
              f.market_id, f.protocol_id, o.execution_context,
              f.market_state_evidence_id, e.state_fingerprint, o.requested_base_units,
              f.base_quantity, f.actual_output_lamports, f.fee_lamports,
              f.cost_basis_lamports_removed, f.realized_pnl_lamports,
              f.adapter_version, a.paper_sol_balance_lamports,
              p.id as position_id, f.executed_at
       from fills f
       join orders o on o.id = f.order_id
       join competition_accounts a on a.id = o.competition_account_id
       join order_market_state_evidence oe on oe.order_id = o.id
                       and oe.evidence_id = f.market_state_evidence_id
                       and oe.purpose = 'SELL_EXECUTION'
       join positions p on p.id = oe.position_id
       join market_state_evidence e on e.id = f.market_state_evidence_id
       where f.id = $1`,
      [fillId],
    ),
    'Authoritative paper sell',
  );
  return {
    orderId: row.order_id,
    fillId: row.fill_id,
    executionId: row.execution_id,
    competitionAccountId: row.competition_account_id,
    marketId: row.market_id,
    protocolId: row.protocol_id,
    executionContext: row.execution_context,
    marketStateEvidenceId: row.market_state_evidence_id,
    marketStateFingerprint: row.state_fingerprint,
    requestedTokenQuantity: BigInt(row.requested_base_units),
    actualTokenInputBaseUnits: BigInt(row.base_quantity),
    actualNetPaperSolOutputLamports: BigInt(row.actual_output_lamports),
    feeLamports: BigInt(row.fee_lamports),
    costBasisLamportsRemoved: BigInt(row.cost_basis_lamports_removed),
    fillRealizedPnlLamports: BigInt(row.realized_pnl_lamports),
    adapterVersion: row.adapter_version,
    paperSolBalanceLamports: BigInt(row.paper_sol_balance_lamports),
    position: await getPositionWithClient(client, row.position_id),
    executedAt: row.executed_at,
  };
}

function validateAuthoritativeSellExecution(input: {
  readonly execution: SimulatedExecution;
  readonly orderId: string;
  readonly executionId: string;
  readonly identity: MarketIdentity;
  readonly requestedTokenQuantity: bigint;
  readonly evidence: MarketStateEvidence;
  readonly adapterVersion: string;
}): void {
  const { execution } = input;
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
    execution.actualInput.asset !== 'TOKEN' ||
    execution.actualInput.tokenMint !== input.identity.tokenMint ||
    execution.actualInput.amount !== input.requestedTokenQuantity ||
    execution.actualOutput.asset !== 'PAPER_SOL' ||
    typeof execution.actualOutput.amount !== 'bigint' ||
    execution.actualOutput.amount <= 0n
  ) {
    throw new FinancialServiceError(
      'INVALID_EXECUTION_RESULT',
      'The adapter returned an invalid or mismatched SELL execution result.',
    );
  }
  const fees = paperSolFeeTotal(execution);
  if (fees < 0n) {
    throw new FinancialServiceError(
      'INVALID_EXECUTION_RESULT',
      'The SELL fee breakdown is invalid.',
    );
  }
}

interface PreparedSell {
  readonly identity: MarketIdentity;
  readonly state: MarketState;
  readonly evidence: MarketStateEvidence;
  readonly execution: SimulatedExecution;
  readonly adapterVersion: string;
}

async function prepareAuthoritativeSell(
  database: DatabaseService,
  router: ExecutionRouter,
  input: {
    readonly competitionAccountId: string;
    readonly marketId: string;
    readonly requestedTokenQuantity: bigint;
    readonly idempotencyKey: string;
    readonly authoritativeTimestamp: Date;
    readonly executionContext: SellExecutionContext;
  },
  ids: { readonly orderId: string; readonly executionId: string },
  pinned?: MarketStateEvidence,
): Promise<PreparedSell> {
  const market = firstRow(
    await database.pool.query<AuthoritativeMarketRow>(
      `select m.id, m.venue, m.base_asset_id, a.mint_address
       from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
      [input.marketId],
    ),
    'Market',
  );
  const identity: MarketIdentity = {
    protocolId: identifier(market.venue, 'ProtocolId'),
    marketId: identifier(market.id, 'MarketId'),
    tokenMint: identifier(market.mint_address, 'TokenMint'),
  };
  try {
    if (pinned && (pinned.identity.tokenMint !== identity.tokenMint ||
        createMarketStateEvidence(pinned).fingerprint !== pinned.fingerprint))
      throw new FinancialServiceError('EVIDENCE_CORRUPTED','Pinned liquidation evidence is invalid.');
    const { route, adapter, state } = pinned ? {
      route: {originIdentity:identity, executionIdentity:pinned.identity,
        migrated:pinned.identity.marketId !== identity.marketId},
      adapter: router.resolveVersion(pinned.identity.protocolId,pinned.adapterVersion), state:pinned,
    } : await withGenericAccount(input.competitionAccountId, () =>
      router.loadPositionRoute(identity, input.executionContext === 'FORCED_HOURLY_SETTLEMENT'),
    );
    if (route.migrated) {
      await database.pool.query(
        `insert into markets
          (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
         select $1, base_asset_id, quote_asset_id, $2, $1,
                jsonb_build_object('migrationResolvedFromMarketId', id)
         from markets where id = $3
         on conflict do nothing`,
        [route.executionIdentity.marketId, route.executionIdentity.protocolId, identity.marketId],
      );
    }
    const executionMarket = (
      await database.pool.query<AuthoritativeMarketRow>(
        `select m.id, m.venue, m.base_asset_id, a.mint_address
         from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
        [route.executionIdentity.marketId],
      )
    ).rows[0];
    if (
      !executionMarket ||
      executionMarket.venue !== route.executionIdentity.protocolId ||
      executionMarket.base_asset_id !== market.base_asset_id ||
      executionMarket.mint_address !== market.mint_address
    ) {
      throw new ExecutionEngineError(
        'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
        'The resolved execution market is not registered for this position asset.',
      );
    }
    const evidence = createMarketStateEvidence(state);
    if (input.executionContext === 'FORCED_HOURLY_SETTLEMENT' && pinned)
      await database.bindMarketSettlementEvidence?.(input.competitionAccountId, pinned);
    const execution = await adapter.simulateSell(
      {
        orderId: identifier(ids.orderId, 'OrderId'),
        executionId: identifier(ids.executionId, 'ExecutionId'),
        identity: route.executionIdentity,
        requestedTokenQuantity: tokenBaseUnits(input.requestedTokenQuantity),
        executedAt: utcInstant(input.authoritativeTimestamp),
      },
      state,
    );
    validateAuthoritativeSellExecution({
      execution,
      orderId: ids.orderId,
      executionId: ids.executionId,
      identity: route.executionIdentity,
      requestedTokenQuantity: input.requestedTokenQuantity,
      evidence,
      adapterVersion: adapter.adapterVersion,
    });
    return {
      identity: route.executionIdentity,
      state,
      evidence,
      execution,
      adapterVersion: adapter.adapterVersion,
    };
  } catch (error) {
    translateExecutionError(error, false);
  }
}

async function executeAuthoritativePaperSell(
  database: DatabaseService,
  router: ExecutionRouter,
  input: {
    readonly competitionAccountId: string;
    readonly marketId: string;
    readonly requestedTokenQuantity: bigint;
    readonly idempotencyKey: string;
    readonly authoritativeTimestamp: Date;
    readonly executionContext: SellExecutionContext;
    readonly idempotencyIntent?: 'ALL';
    readonly settlementEvidence?: MarketStateEvidence;
    readonly settlementNetLimit?: bigint;
    readonly persistedSettlementStep?: boolean;
  },
): Promise<AuthoritativePaperSellResult> {
  if (input.requestedTokenQuantity <= 0n) {
    throw new FinancialServiceError(
      'INVALID_SELL_QUANTITY',
      'Requested token quantity must be positive.',
    );
  }
  if (Number.isNaN(input.authoritativeTimestamp.getTime())) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Timestamp is invalid.');
  }
  const requestHash = fingerprint({
    competitionAccountId: input.competitionAccountId,
    marketId: input.marketId,
    requestedTokenQuantity: input.idempotencyIntent ?? input.requestedTokenQuantity,
    executionContext: input.executionContext,
  });
  const prefix =
    input.idempotencyIntent === 'ALL'
      ? 'authoritative-sell-all'
      : input.executionContext === 'FORCED_HOURLY_SETTLEMENT'
        ? 'forced-settlement-sell'
        : 'authoritative-sell';
  const orderId = deterministicEntityId(`${prefix}-order`, input.idempotencyKey);
  const fillId = deterministicEntityId(`${prefix}-fill`, input.idempotencyKey);
  const executionId = deterministicEntityId(`${prefix}-execution`, input.idempotencyKey);
  const operationClass =
    input.idempotencyIntent === 'ALL'
      ? 'AUTHORITATIVE_PAPER_SELL_ALL'
      : input.executionContext === 'FORCED_HOURLY_SETTLEMENT'
        ? 'FORCED_HOURLY_SETTLEMENT_SELL'
        : 'AUTHORITATIVE_PAPER_SELL';
  const existingClient = await database.pool.connect();
  try {
    const existing = await existingClient.query<IdempotencyRow>(
      `select id, request_hash, status, result_entity_type, result_entity_id
       from idempotency_records where operation_class = $1 and idempotency_key = $2`,
      [operationClass, input.idempotencyKey],
    );
    const record = existing.rows[0];
    if (record) {
      if (record.request_hash !== requestHash) {
        throw new FinancialServiceError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key was already used with a different request.',
        );
      }
      if (record.status === 'COMPLETED' && record.result_entity_id) {
        return await getAuthoritativePaperSellResult(existingClient, record.result_entity_id);
      }
    }
  } finally {
    existingClient.release();
  }
  const prepared = await prepareAuthoritativeSell(database, router, input, {
    orderId,
    executionId,
  }, input.settlementEvidence);
  if (input.executionContext === 'FORCED_HOURLY_SETTLEMENT' &&
      (!input.settlementEvidence || prepared.execution.actualOutput.amount !== input.settlementNetLimit))
    throw new FinancialServiceError('SETTLEMENT_REVIEW','Forced execution must match its one pinned capacity quote.');

  return runFinancialTransaction(database, async (client) => {
    await database.lockMarketExecution?.(client, input.competitionAccountId);
    const claimed = await claimIdempotency(client, {
      operationClass,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.competitionAccountId,
    });
    if (claimed.replay) {
      return getAuthoritativePaperSellResult(client, claimed.record.result_entity_id!);
    }
    const authority = firstRow(
      await client.query<{
        hourly_round_id: string;
        state: string;
        starts_at: Date;
        ends_at_exclusive: Date;
      }>(
        `select a.hourly_round_id, r.state, r.starts_at, r.ends_at_exclusive
         from competition_accounts a join hourly_rounds r on r.id = a.hourly_round_id
         where a.id = $1 for share of r`,
        [input.competitionAccountId],
      ),
      'Competition account',
    );
    if (input.executionContext === 'NORMAL_USER') {
      if (authority.state !== 'OPEN') {
        throw new FinancialServiceError('ROUND_NOT_OPEN', 'The hourly round is not open.');
      }
      if (
        input.authoritativeTimestamp < authority.starts_at ||
        input.authoritativeTimestamp >= authority.ends_at_exclusive
      ) {
        throw new FinancialServiceError(
          'OUTSIDE_ROUND_WINDOW',
          'The authoritative timestamp is outside the hourly round window.',
        );
      }
    } else if (authority.state !== 'SETTLING') {
      throw new FinancialServiceError(
        'SETTLEMENT_EXECUTION_FAILED',
        'Forced liquidation requires the round to be SETTLING.',
      );
    }
    const account = await getAccountStateWithClient(client, input.competitionAccountId, true);
    if (account.finalSettledBalanceLamports !== null) {
      throw new FinancialServiceError('ROUND_NOT_OPEN', 'The competition account is finalized.');
    }
    const positionRow = firstRow(
      await client.query<PositionRow>(
        `select id, competition_account_id, market_id, asset_id, remaining_base_units,
                cost_basis_lamports, realized_pnl_lamports, status
         from positions where competition_account_id = $1 and market_id = $2 for update`,
        [input.competitionAccountId, input.marketId],
      ),
      'Position',
    );
    const quantityBefore = BigInt(positionRow.remaining_base_units);
    const costBefore = BigInt(positionRow.cost_basis_lamports);
    if (input.idempotencyIntent === 'ALL' && input.requestedTokenQuantity !== quantityBefore) {
      throw new FinancialServiceError(
        'INVALID_SELL_QUANTITY',
        'The position changed while preparing SELL ALL; retry the same idempotent request.',
      );
    }
    if (positionRow.status !== 'OPEN' || input.requestedTokenQuantity > quantityBefore) {
      throw new FinancialServiceError(
        'INSUFFICIENT_TOKEN_BALANCE',
        'Requested SELL quantity exceeds the open token balance.',
      );
    }
    if(input.executionContext === 'FORCED_HOURLY_SETTLEMENT' && !input.persistedSettlementStep) {
      const prior=await client.query(`select 1 from fills f join orders o on o.id=f.order_id
        join order_market_state_evidence e on e.order_id=o.id
        where e.position_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT' limit 1`,[positionRow.id]);
      if(prior.rowCount) throw new FinancialServiceError('SETTLEMENT_REVIEW','A prior forced liquidation requires independent review; capacity cannot be reused.');
    }
    const netProceeds = prepared.execution.actualOutput.amount;
    const feeLamports = paperSolFeeTotal(prepared.execution);
    const grossProceeds = netProceeds + feeLamports;
    const isFullSell = input.requestedTokenQuantity === quantityBefore;
    const costRemoved = isFullSell
      ? costBefore
      : (costBefore * input.requestedTokenQuantity) / quantityBefore;
    const fillPnl = netProceeds - costRemoved;
    const remainingQuantity = quantityBefore - input.requestedTokenQuantity;
    const remainingCost = costBefore - costRemoved;
    const evidenceId = await persistMarketStateEvidence(client, prepared.evidence);

    await client.query(
      `insert into orders
        (id, competition_account_id, market_id, side, requested_base_units,
         execution_context, status, idempotency_record_id, requested_at)
       values ($1, $2, $3, 'SELL', $4, $5, 'COMPLETED', $6, $7)`,
      [
        orderId,
        input.competitionAccountId,
        prepared.identity.marketId,
        input.requestedTokenQuantity,
        input.executionContext,
        claimed.record.id,
        input.authoritativeTimestamp,
      ],
    );
    await client.query(
      `insert into order_market_state_evidence
        (id, order_id, evidence_id, purpose, position_id)
       values ($1, $2, $3, 'SELL_EXECUTION', $4)`,
      [`${orderId}:sell-execution`, orderId, evidenceId, positionRow.id],
    );
    await client.query(
      `update positions
       set remaining_base_units = $2, cost_basis_lamports = $3,
           realized_pnl_lamports = realized_pnl_lamports + $4,
           status = $5, closed_at = $6, updated_at = $7
       where id = $1`,
      [
        positionRow.id,
        remainingQuantity,
        remainingCost,
        fillPnl,
        remainingQuantity === 0n ? 'CLOSED' : 'OPEN',
        remainingQuantity === 0n ? input.authoritativeTimestamp : null,
        input.authoritativeTimestamp,
      ],
    );
    await client.query(
      `insert into fills
        (id, order_id, market_id, execution_id, side, base_quantity, quote_lamports,
         execution_price, fee_lamports, actual_output_lamports, fee_breakdown,
         protocol_id, adapter_version, market_state_evidence_id,
         cost_basis_lamports_removed, realized_pnl_lamports, idempotency_record_id, executed_at)
       values ($1, $2, $3, $4, 'SELL', $5, $6, $7, $8, $9, $10::jsonb,
               $11, $12, $13, $14, $15, $16, $17)`,
      [
        fillId,
        orderId,
        prepared.identity.marketId,
        executionId,
        input.requestedTokenQuantity,
        grossProceeds,
        executionPrice(netProceeds, input.requestedTokenQuantity),
        feeLamports,
        netProceeds,
        JSON.stringify(normalizedFeeBreakdown(prepared.execution)),
        prepared.identity.protocolId,
        prepared.adapterVersion,
        evidenceId,
        costRemoved,
        fillPnl,
        claimed.record.id,
        input.authoritativeTimestamp,
      ],
    );
    if(input.executionContext === 'FORCED_HOURLY_SETTLEMENT' && !input.persistedSettlementStep) {
      await client.query(`insert into legacy_settlement_liquidations
       (position_id,hourly_round_id,policy_version,quantity_before,basis_before,sold_quantity,net_proceeds,fee_lamports,evidence_id,fill_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[positionRow.id,authority.hourly_round_id,LEGACY_SETTLEMENT_POLICY,
         quantityBefore.toString(),costBefore,input.requestedTokenQuantity.toString(),netProceeds,feeLamports,evidenceId,fillId]);
      if(remainingQuantity>0n) await recordSettlementReview(client,authority.hourly_round_id,positionRow.id,'PARTIAL_LIQUIDATION_REMAINDER');
    }
    await client.query(
      `update competition_accounts
       set paper_sol_balance_lamports = paper_sol_balance_lamports + $2,
           realized_pnl_lamports = realized_pnl_lamports + $3
       where id = $1`,
      [input.competitionAccountId, netProceeds, fillPnl],
    );
    const entries: JournalEntryInput[] = [];
    if (netProceeds > 0n) {
      entries.push({ accountCode: 'CASH', direction: 'DEBIT', amountLamports: netProceeds });
    }
    if (feeLamports > 0n) {
      entries.push({
        accountCode: 'TRADING_FEES',
        direction: 'DEBIT',
        amountLamports: feeLamports,
      });
    }
    if (costRemoved > 0n) {
      entries.push({
        accountCode: 'POSITION_COST',
        direction: 'CREDIT',
        amountLamports: costRemoved,
      });
    }
    const grossPnl = grossProceeds - costRemoved;
    if (grossPnl > 0n) {
      entries.push({ accountCode: 'TRADING_PNL', direction: 'CREDIT', amountLamports: grossPnl });
    } else if (grossPnl < 0n) {
      entries.push({ accountCode: 'TRADING_PNL', direction: 'DEBIT', amountLamports: -grossPnl });
    }
    await insertJournal(client, {
      id: `journal:${prefix}:${fillId}`,
      competitionAccountId: input.competitionAccountId,
      operationType:
        input.executionContext === 'FORCED_HOURLY_SETTLEMENT'
          ? 'FORCED_HOURLY_SETTLEMENT_SELL'
          : 'AUTHORITATIVE_SIMULATED_SELL',
      sourceEntityType: 'FILL',
      sourceEntityId: fillId,
      idempotencyRecordId: claimed.record.id,
      entries,
    });
    await database.commitMarketExecution?.(client, { accountId: input.competitionAccountId, roundId: authority.hourly_round_id, fillId, execution: prepared.execution, executionContext: input.executionContext });
    if(input.persistedSettlementStep){
      if(input.executionContext!=='FORCED_HOURLY_SETTLEMENT'||!database.commitPersistedSettlementStep)
        throw new FinancialServiceError('SETTLEMENT_REVIEW','Persisted settlement participant is required.');
      await database.commitPersistedSettlementStep(client,{accountId:input.competitionAccountId,roundId:authority.hourly_round_id,positionId:positionRow.id,quantityBefore,basisBefore:costBefore,fillId,idempotencyKey:input.idempotencyKey,execution:prepared.execution,evidence:prepared.evidence});
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      'AUTHORITATIVE_SELL_FILL',
      fillId,
      input.competitionAccountId,
    );
    return getAuthoritativePaperSellResult(client, fillId);
  });
}

/** Recover only uniquely provable legacy quantity evidence; never rewrite financial history. */
export async function repairLegacySettlementWriteoffMetadata(
  database: DatabaseService,
  accountId: string,
): Promise<void> {
  await runFinancialTransaction(database, async (client) => {
    await client.query('select id from competition_accounts where id = $1 for update', [accountId]);
    const legacy = await client.query<{
      id: string;
      source_entity_id: string;
      idempotency_record_id: string;
    }>(
      `select j.id, j.source_entity_id, j.idempotency_record_id from journal_transactions j
       left join settlement_writeoff_metadata_repairs r on r.journal_transaction_id = j.id
       where j.competition_account_id = $1 and j.operation_type = 'FORCED_HOURLY_SETTLEMENT_WRITEOFF'
         and j.source_entity_type = 'SETTLEMENT_WRITEOFF' and j.metadata = '{}'::jsonb
         and r.journal_transaction_id is null order by j.id`,
      [accountId],
    );
    for (const journal of legacy.rows) {
      const invalid = () =>
        new FinancialServiceError(
          'FINALIZATION_CONFLICT',
          `Legacy write-off ${journal.id} cannot be reconstructed uniquely from immutable fills and ledger.`,
        );
      const position = (
        await client.query<{
          asset_id: string;
          market_id: string;
          status: string;
          remaining_base_units: string;
          cost_basis_lamports: string;
          realized_pnl_lamports: string;
        }>('select * from positions where id = $1 and competition_account_id = $2 for update', [
          journal.source_entity_id,
          accountId,
        ])
      ).rows[0];
      if (
        !position ||
        position.status !== 'CLOSED' ||
        BigInt(position.remaining_base_units) !== 0n ||
        BigInt(position.cost_basis_lamports) !== 0n
      )
        throw invalid();
      // Asset linkage handles migrated SELL venues. Multiple economic positions are ambiguous.
      const peers = await client.query(
        'select id from positions where competition_account_id = $1 and asset_id = $2',
        [accountId, position.asset_id],
      );
      const writeoffs = await client.query(
        `select id from journal_transactions where competition_account_id = $1
         and source_entity_type = 'SETTLEMENT_WRITEOFF' and source_entity_id = $2`,
        [accountId, journal.source_entity_id],
      );
      const idempotency = (
        await client.query<IdempotencyRow>(
          `select * from idempotency_records where id = $1
          and competition_account_id = $2 and operation_class = 'FORCED_HOURLY_SETTLEMENT_WRITEOFF'`,
          [journal.idempotency_record_id, accountId],
        )
      ).rows[0];
      if (
        peers.rowCount !== 1 ||
        writeoffs.rowCount !== 1 ||
        idempotency?.status !== 'COMPLETED' ||
        idempotency.result_entity_type !== 'SETTLEMENT_WRITEOFF' ||
        idempotency.result_entity_id !== journal.source_entity_id
      )
        throw invalid();
      const fills = await client.query<{
        id: string;
        side: string;
        base_quantity: string;
        quote_lamports: string;
        fee_lamports: string;
        actual_input_lamports: string | null;
        cost_basis_lamports_removed: string;
        realized_pnl_lamports: string;
      }>(
        `select f.* from fills f join orders o on o.id = f.order_id
          join markets m on m.id = f.market_id
          where o.competition_account_id = $1 and m.base_asset_id = $2 order by f.id`,
        [accountId, position.asset_id],
      );
      let quantity = 0n,
        cost = 0n,
        pnl = 0n;
      for (const fill of fills.rows) {
        quantity += (fill.side === 'BUY' ? 1n : -1n) * BigInt(fill.base_quantity);
        cost +=
          fill.side === 'BUY'
            ? BigInt(
                fill.actual_input_lamports ??
                  (BigInt(fill.quote_lamports) + BigInt(fill.fee_lamports)).toString(),
              )
            : -BigInt(fill.cost_basis_lamports_removed);
        pnl += BigInt(fill.realized_pnl_lamports);
      }
      const entries = await client.query<{
        account_code: string;
        direction: string;
        amount_lamports: string;
      }>(
        'select account_code, direction, amount_lamports from ledger_entries where journal_transaction_id = $1',
        [journal.id],
      );
      if (
        quantity <= 0n ||
        cost <= 0n ||
        BigInt(position.realized_pnl_lamports) !== pnl - cost ||
        entries.rowCount !== 2 ||
        !entries.rows.some(
          (e) =>
            e.account_code === 'TRADING_PNL' &&
            e.direction === 'DEBIT' &&
            BigInt(e.amount_lamports) === cost,
        ) ||
        !entries.rows.some(
          (e) =>
            e.account_code === 'POSITION_COST' &&
            e.direction === 'CREDIT' &&
            BigInt(e.amount_lamports) === cost,
        )
      )
        throw invalid();
      await client.query(
        `insert into settlement_writeoff_metadata_repairs
         (journal_transaction_id, token_quantity, cost_basis_lamports, evidence) values ($1, $2, $3, $4::jsonb)`,
        [
          journal.id,
          quantity,
          cost,
          JSON.stringify({
            reason: 'LEGACY_WRITEOFF_METADATA_RECOVERY_V1',
            positionId: journal.source_entity_id,
            marketId: position.market_id,
            fillIds: fills.rows.map((f) => f.id),
            method:
              'Immutable BUY quantity minus SELL quantity; capitalized BUY cost minus removed SELL basis; matching write-off ledger and closed-position P&L.',
          }),
        ],
      );
    }
  });
}

/** Record an immutable zero-value remainder write-off after executable settlement capacity is exhausted. */
async function writeOffSettlementRemainder(
  database: DatabaseService,
  input: {
    readonly competitionAccountId: string;
    readonly positionId: string;
    readonly marketId: string;
    readonly tokenQuantity: bigint;
    readonly costBasis: bigint;
    readonly evidence: MarketStateEvidence;
    readonly authoritativeTimestamp: Date;
    readonly idempotencyKey: string;
    readonly transactionClient?: PoolClient;
    readonly operatorResolution?: JsonObject;
    readonly persistedCutoff?: {roundId:string;identity:MarketIdentity};
  },
): Promise<void> {
  if (input.tokenQuantity <= 0n) return;
  const applyWriteoff = async (client: PoolClient) => {
    await client.query('select id from competition_accounts where id = $1 for update', [
      input.competitionAccountId,
    ]);
    const round = firstRow(
      await client.query<{ state: string }>(
        `select r.state from hourly_rounds r join competition_accounts a on a.hourly_round_id = r.id
       where a.id = $1 for share of r`,
        [input.competitionAccountId],
      ),
      'Hourly round',
    );
    if (round.state !== 'SETTLING')
      throw new FinancialServiceError('FINALIZATION_CONFLICT', 'Write-off requires SETTLING.');
    const requestHash = fingerprint({
      positionId: input.positionId,
      marketId: input.marketId,
      competitionAccountId: input.competitionAccountId,
      authoritativeTimestamp: input.authoritativeTimestamp,
    });
    const claimed = await claimIdempotency(client, {
      operationClass: 'FORCED_HOURLY_SETTLEMENT_WRITEOFF',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.competitionAccountId,
    });
    if (claimed.replay) return;
    const position = firstRow<{
      status: string;
      remaining_base_units: string;
      cost_basis_lamports: string;
    }>(
      await client.query(
        `select status, remaining_base_units, cost_basis_lamports from positions where id = $1 and competition_account_id = $2 for update`,
        [input.positionId, input.competitionAccountId],
      ),
      'Position',
    );
    const quantity = BigInt(position.remaining_base_units);
    const cost = BigInt(position.cost_basis_lamports);
    if (position.status !== 'OPEN' || quantity === 0n) {
      await completeIdempotency(
        client,
        claimed.record.id,
        'SETTLEMENT_WRITEOFF',
        input.positionId,
        input.competitionAccountId,
      );
      return;
    }
    if (quantity !== input.tokenQuantity || cost !== input.costBasis) {
      throw new FinancialServiceError(
        'SETTLEMENT_INCOMPLETE',
        'Position changed after zero-capacity observation; reload before write-off.',
      );
    }
    await client.query(
      `update positions set remaining_base_units = 0, cost_basis_lamports = 0,
         realized_pnl_lamports = realized_pnl_lamports - $2, status = 'CLOSED',
         closed_at = $3, updated_at = $3 where id = $1`,
      [input.positionId, cost, input.authoritativeTimestamp],
    );
    await client.query(
      `update competition_accounts set realized_pnl_lamports = realized_pnl_lamports - $2 where id = $1`,
      [input.competitionAccountId, cost],
    );
    await insertJournal(client, {
      id: `journal:forced-writeoff:${input.positionId}`,
      competitionAccountId: input.competitionAccountId,
      operationType: 'FORCED_HOURLY_SETTLEMENT_WRITEOFF',
      sourceEntityType: 'SETTLEMENT_WRITEOFF',
      sourceEntityId: input.positionId,
      idempotencyRecordId: claimed.record.id,
      metadata: {
        tokenQuantity: quantity.toString(),
        costBasisLamports: cost.toString(),
        marketId: input.marketId,
        reason: input.operatorResolution
          ? 'OPERATOR_APPROVED_DUST_RESOLUTION_V1'
          : 'NO_POSITIVE_AUTHORITATIVE_EXECUTABLE_EXIT',
        ...(input.operatorResolution ? { operatorResolution: input.operatorResolution } : {}),
        marketStateEvidence: JSON.parse(
          JSON.stringify(input.evidence, (_, value: unknown) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
        ) as JsonObject,
      },
      entries:
        cost === 0n
          ? []
          : [
              { accountCode: 'TRADING_PNL', direction: 'DEBIT', amountLamports: cost },
              { accountCode: 'POSITION_COST', direction: 'CREDIT', amountLamports: cost },
            ],
    });
    if(input.persistedCutoff){
      if(!database.commitPersistedSettlementWriteoff)throw new FinancialServiceError('SETTLEMENT_REVIEW','Persisted cutoff write-off participant is required.');
      await database.commitPersistedSettlementWriteoff(client,{accountId:input.competitionAccountId,roundId:input.persistedCutoff.roundId,
        positionId:input.positionId,identity:input.persistedCutoff.identity,quantity,basis:cost,
        idempotencyKey:input.idempotencyKey,evidence:input.evidence,journalId:`journal:forced-writeoff:${input.positionId}`});
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      'SETTLEMENT_WRITEOFF',
      input.positionId,
      input.competitionAccountId,
    );
  };
  if (input.transactionClient) await applyWriteoff(input.transactionClient);
  else await runFinancialTransaction(database, applyWriteoff);
}

/** Server-authoritative normal user SELL. Forced settlement uses the internal context only. */
export async function executePaperSell(
  database: DatabaseService,
  router: ExecutionRouter,
  input: {
    readonly competitionAccountId: string;
    readonly marketId: string;
    readonly requestedTokenQuantity: bigint;
    readonly idempotencyKey: string;
    readonly authoritativeTimestamp: Date;
  },
): Promise<AuthoritativePaperSellResult> {
  return executeAuthoritativePaperSell(database, router, {
    ...input,
    executionContext: 'NORMAL_USER',
  });
}

/** Exact full-position SELL. The quantity is snapshotted, then confirmed again under row lock. */
export async function executePaperSellAll(
  database: DatabaseService,
  router: ExecutionRouter,
  input: {
    readonly competitionAccountId: string;
    readonly marketId: string;
    readonly idempotencyKey: string;
    readonly authoritativeTimestamp: Date;
  },
): Promise<AuthoritativePaperSellResult> {
  const requestHash = fingerprint({
    competitionAccountId: input.competitionAccountId,
    marketId: input.marketId,
    requestedTokenQuantity: 'ALL',
    executionContext: 'NORMAL_USER',
  });
  const existing = await database.pool.connect();
  try {
    const record = (
      await existing.query<IdempotencyRow>(
        `select id, request_hash, status, result_entity_type, result_entity_id
         from idempotency_records
         where operation_class = 'AUTHORITATIVE_PAPER_SELL_ALL' and idempotency_key = $1`,
        [input.idempotencyKey],
      )
    ).rows[0];
    if (record) {
      if (record.request_hash !== requestHash) {
        throw new FinancialServiceError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key was already used with a different request.',
        );
      }
      if (record.status === 'COMPLETED' && record.result_entity_id) {
        return await getAuthoritativePaperSellResult(existing, record.result_entity_id);
      }
    }
  } finally {
    existing.release();
  }
  const row = (
    await database.pool.query<{ remaining_base_units: string }>(
      `select remaining_base_units from positions
       where competition_account_id = $1 and market_id = $2 and status = 'OPEN'`,
      [input.competitionAccountId, input.marketId],
    )
  ).rows[0];
  if (!row) {
    throw new FinancialServiceError(
      'INSUFFICIENT_TOKEN_BALANCE',
      'No open token balance exists for SELL ALL.',
    );
  }
  return executeAuthoritativePaperSell(database, router, {
    ...input,
    requestedTokenQuantity: BigInt(row.remaining_base_units),
    executionContext: 'NORMAL_USER',
    idempotencyIntent: 'ALL',
  });
}

export interface SettlementFailure {
  readonly competitionAccountId: string;
  readonly marketId: string | null;
  readonly code: FinancialErrorCode;
  readonly message: string;
  readonly disposition: 'RETRY' | 'OPERATIONAL_ERROR';
}

export interface HourlySettlementResult {
  readonly hourlyRoundId: string;
  readonly state: 'SETTLING' | 'FINALIZED';
  readonly forcedSells: readonly AuthoritativePaperSellResult[];
  readonly hourlyResults: readonly HourlyResultState[];
  readonly failures: readonly SettlementFailure[];
}

async function enterHourlySettlement(
  database: DatabaseService,
  hourlyRoundId: string,
  authoritativeTimestamp: Date,
): Promise<{ readonly state: string; readonly endsAtExclusive: Date }> {
  return runFinancialTransaction(database, async (client) => {
    const round = firstRow(
      await client.query<{ state: string; ends_at_exclusive: Date }>(
        `select state, ends_at_exclusive from hourly_rounds where id = $1 for update`,
        [hourlyRoundId],
      ),
      'Hourly round',
    );
    if (round.state === 'FINALIZED') {
      return { state: round.state, endsAtExclusive: round.ends_at_exclusive };
    }
    if (authoritativeTimestamp < round.ends_at_exclusive) {
      throw new FinancialServiceError(
        'OUTSIDE_ROUND_WINDOW',
        'Hourly settlement cannot begin before the exclusive cutoff.',
      );
    }
    if (round.state === 'OPEN') {
      await client.query(`update hourly_rounds set state = 'CLOSING' where id = $1`, [
        hourlyRoundId,
      ]);
      round.state = 'CLOSING';
    }
    if (round.state === 'CLOSING') {
      await client.query(`update hourly_rounds set state = 'SETTLING' where id = $1`, [
        hourlyRoundId,
      ]);
      round.state = 'SETTLING';
    }
    if (round.state !== 'SETTLING') {
      throw new FinancialServiceError(
        'SETTLEMENT_EXECUTION_FAILED',
        `Round state ${round.state} cannot enter settlement.`,
      );
    }
    return { state: round.state, endsAtExclusive: round.ends_at_exclusive };
  });
}

function settlementFailure(
  error: unknown,
  competitionAccountId: string,
  marketId: string | null,
): SettlementFailure {
  const retryCodes = new Set([
    'RPC_UNAVAILABLE',
    'RPC_TIMEOUT',
    'RPC_ERROR',
    'MARKET_STATE_UNAVAILABLE',
    'MARKET_ACCOUNT_NOT_FOUND',
    'MIGRATION_DESTINATION_UNAVAILABLE',
    'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
    'MARKET_MIGRATED',
    'SETTLEMENT_INCOMPLETE',
    'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
    'ZERO_EXECUTABLE_OUTPUT',
  ]);
  if (error instanceof FinancialServiceError) {
    return {
      competitionAccountId,
      marketId,
      code: error.code,
      message: error.message,
      disposition: retryCodes.has(error.code) ? 'RETRY' : 'OPERATIONAL_ERROR',
    };
  }
  if (error instanceof ExecutionEngineError) {
    return {
      competitionAccountId,
      marketId,
      code: error.code as FinancialErrorCode,
      message: error.message,
      disposition: retryCodes.has(error.code) ? 'RETRY' : 'OPERATIONAL_ERROR',
    };
  }
  return {
    competitionAccountId,
    marketId,
    code: 'SETTLEMENT_EXECUTION_FAILED',
    message: 'Forced settlement failed without a safe authoritative result.',
    disposition: 'OPERATIONAL_ERROR',
  };
}

/**
 * Retryable round settlement. Each forced position commits independently; account and round
 * finalization occur only after all positions are closed and reconciled.
 */
export async function settleHourlyRound(
  database: DatabaseService,
  router: ExecutionRouter,
  input: {
    readonly hourlyRoundId: string;
    readonly authoritativeTimestamp: Date;
  },
): Promise<HourlySettlementResult> {
  // Serialize whole passes across processes, including snapshot selection and finalization.
  // Partial sales still commit individually, so crashes resume from persisted quantity.
  const lock = await database.pool.connect();
  try {
    await lock.query(
      "select pg_advisory_lock(hashtextextended('hourly-settlement:' || $1::text, 0))",
      [input.hourlyRoundId],
    );
    return await settleHourlyRoundPass(database, router, input);
  } finally {
    try {
      await lock.query(
        "select pg_advisory_unlock(hashtextextended('hourly-settlement:' || $1::text, 0))",
        [input.hourlyRoundId],
      );
    } finally {
      lock.release();
    }
  }
}

async function settleHourlyRoundPass(
  database: DatabaseService,
  router: ExecutionRouter,
  input: {
    readonly hourlyRoundId: string;
    readonly authoritativeTimestamp: Date;
  },
): Promise<HourlySettlementResult> {
  if (Number.isNaN(input.authoritativeTimestamp.getTime())) {
    throw new FinancialServiceError('INVALID_FINANCIAL_INPUT', 'Timestamp is invalid.');
  }
  const entered = await enterHourlySettlement(
    database,
    input.hourlyRoundId,
    input.authoritativeTimestamp,
  );
  if (entered.state === 'FINALIZED') {
    const existing = await database.pool.query<HourlyResultRow>(
      `select id, hourly_round_id, competition_account_id, user_id,
              final_settled_balance_lamports, starting_paper_sol_lamports,
              hourly_pnl_lamports, finalized_at
       from hourly_results where hourly_round_id = $1 order by competition_account_id`,
      [input.hourlyRoundId],
    );
    return {
      hourlyRoundId: input.hourlyRoundId,
      state: 'FINALIZED',
      forcedSells: [],
      hourlyResults: existing.rows.map(toHourlyResult),
      failures: [],
    };
  }

  try {
    await database.prepareMarketSettlement?.(input.hourlyRoundId, entered.endsAtExclusive);
  } catch (error) {
    return { hourlyRoundId: input.hourlyRoundId, state: 'SETTLING', forcedSells: [], hourlyResults: [],
      failures: [settlementFailure(error, '', null)] };
  }

  const positions = (
    await database.pool.query<{
      id: string;
      competition_account_id: string;
      market_id: string;
      remaining_base_units: string;
      cost_basis_lamports: string;
      venue: string;
      mint_address: string;
    }>(
      `select p.id, p.competition_account_id, p.market_id, p.remaining_base_units, p.cost_basis_lamports,
              m.venue, a.mint_address
       from positions p
       join competition_accounts ca on ca.id = p.competition_account_id
       join markets m on m.id = p.market_id
       join assets a on a.id = p.asset_id
       where ca.hourly_round_id = $1 and p.status = 'OPEN'
       order by m.venue, p.market_id, a.mint_address`,
      [input.hourlyRoundId],
    )
  ).rows;
  const forcedSells: AuthoritativePaperSellResult[] = [];
  const failures: SettlementFailure[] = [];
  for (const position of positions) {
    try {
      const identity: MarketIdentity = {
        protocolId: identifier(position.venue, 'ProtocolId'),
        marketId: identifier(position.market_id, 'MarketId'),
        tokenMint: identifier(position.mint_address, 'TokenMint'),
      };
      const prior=(await database.pool.query(`select f.id from fills f join orders o on o.id=f.order_id
        join order_market_state_evidence e on e.order_id=o.id
        where e.position_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT' limit 1`,[position.id])).rows;
      const persistedParticipant = database.persistedSettlementAccount?.(position.competition_account_id, identity) ?? !!database.preparePersistedSettlementStep;
      if(prior.length && !persistedParticipant) {
        await recordSettlementReview(database.pool,input.hourlyRoundId,position.id,'PRIOR_FORCED_CAPACITY_ALREADY_CONSUMED');
        throw new FinancialServiceError('SETTLEMENT_REVIEW','Previously consumed forced liquidity cannot be reloaded.');
      }
      const current=(await database.pool.query<{status:string;remaining_base_units:string;cost_basis_lamports:string}>(
        'select status,remaining_base_units,cost_basis_lamports from positions where id=$1',[position.id])).rows[0]!;
      if(current.status==='CLOSED')continue;
      const quantity=BigInt(current.remaining_base_units),basis=BigInt(current.cost_basis_lamports);
      if(persistedParticipant){
        if(!database.preparePersistedSettlementStep || !database.commitPersistedSettlementStep)throw new FinancialServiceError('SETTLEMENT_REVIEW','Incomplete persisted settlement participant.');
        const plan=await withGenericAccount(position.competition_account_id,()=>database.preparePersistedSettlementStep!({accountId:position.competition_account_id,roundId:input.hourlyRoundId,positionId:position.id,identity,quantity,basis}));
        if(plan.writeoff===true&&plan.output===0n&&plan.quantity===quantity){
          await writeOffSettlementRemainder(database,{competitionAccountId:position.competition_account_id,positionId:position.id,marketId:position.market_id,
            tokenQuantity:quantity,costBasis:basis,evidence:plan.evidence,authoritativeTimestamp:entered.endsAtExclusive,idempotencyKey:plan.idempotencyKey,
            persistedCutoff:{roundId:input.hourlyRoundId,identity}});
          continue;
        }
        if(plan.quantity<=0n||plan.quantity>quantity||plan.output<=0n)throw new FinancialServiceError('SETTLEMENT_REVIEW','No supported positive persisted exit; remainder stays in REVIEW.');
        forcedSells.push(await executeAuthoritativePaperSell(database,router,{
          competitionAccountId:position.competition_account_id,marketId:position.market_id,
          requestedTokenQuantity:plan.quantity,idempotencyKey:plan.idempotencyKey,
          authoritativeTimestamp:entered.endsAtExclusive,executionContext:'FORCED_HOURLY_SETTLEMENT',
          settlementEvidence:plan.evidence,settlementNetLimit:plan.output,persistedSettlementStep:true,
        }));
        continue;
      }
      const capacity=await withGenericAccount(position.competition_account_id,()=>canonicalExitPreflight(router,identity,quantity,basis,true));
      if(capacity.maxExecutableQuantityBaseUnits===0n) {
        await writeOffSettlementRemainder(database,{
          competitionAccountId:position.competition_account_id,positionId:position.id,marketId:position.market_id,
          tokenQuantity:quantity,costBasis:basis,evidence:capacity.evidence,authoritativeTimestamp:entered.endsAtExclusive,
          idempotencyKey:`hourly-settlement-writeoff:${input.hourlyRoundId}:${position.id}`,
        });
      } else forcedSells.push(await executeAuthoritativePaperSell(database,router,{
        competitionAccountId:position.competition_account_id,marketId:position.market_id,
        requestedTokenQuantity:capacity.maxExecutableQuantityBaseUnits,
        idempotencyKey:`hourly-settlement-once-v1:${input.hourlyRoundId}:${position.id}`,
        authoritativeTimestamp:entered.endsAtExclusive,executionContext:'FORCED_HOURLY_SETTLEMENT',
        settlementEvidence:capacity.evidence,settlementNetLimit:capacity.maxExecutableOutputLamports,
      }));
    } catch (error) {
      if(error instanceof FinancialServiceError && ['SETTLEMENT_REVIEW','EVIDENCE_CORRUPTED','INVALID_EXECUTION_RESULT','FINALIZATION_CONFLICT'].includes(error.code))
        await recordSettlementReview(database.pool,input.hourlyRoundId,position.id,error.code);
      failures.push(settlementFailure(error, position.competition_account_id, position.market_id));
    }
  }

  const accounts = (
    await database.pool.query<{ id: string }>(
      `select id from competition_accounts where hourly_round_id = $1 order by id`,
      [input.hourlyRoundId],
    )
  ).rows;
  const hourlyResults: HourlyResultState[] = [];
  for (const account of accounts) {
    const unresolved = firstRow(
      await database.pool.query<{ count: number }>(
        `select count(*)::int as count from positions
         where competition_account_id = $1 and status = 'OPEN'`,
        [account.id],
      ),
      'Open-position aggregate',
    );
    if (unresolved.count !== 0) continue;
    try {
      const existing = await database.pool.query<HourlyResultRow>(
        `select id, hourly_round_id, competition_account_id, user_id,
                final_settled_balance_lamports, starting_paper_sol_lamports,
                hourly_pnl_lamports, finalized_at
         from hourly_results where competition_account_id = $1`,
        [account.id],
      );
      let hourlyResult = existing.rows[0] ? toHourlyResult(existing.rows[0]) : undefined;
      if (!hourlyResult) {
        await repairLegacySettlementWriteoffMetadata(database, account.id);
        const reconciliation = await reconcileAccountLedger(database, account.id);
        if (!reconciliation.reconciled || reconciliation.materializedCashLamports < 0n) {
          throw new FinancialServiceError(
            'FINALIZATION_CONFLICT',
            'Account ledger does not reconcile for finalization.',
          );
        }
        hourlyResult = await finalizeHourlyResult(database, {
          resultId: `hourly-result:${account.id}`,
          accountId: account.id,
          finalSettledBalanceLamports: reconciliation.materializedCashLamports,
          finalizedAt: entered.endsAtExclusive,
          idempotencyKey: `hourly-result:${input.hourlyRoundId}:${account.id}`,
        });
      }
      hourlyResults.push(hourlyResult);

      const daily = firstRow(
        await database.pool.query<{ id: string }>(
          `select d.id from daily_competitions d
           join hourly_rounds r on r.id = $1
           where r.starts_at >= d.starts_at and r.starts_at < d.ends_at_exclusive`,
          [input.hourlyRoundId],
        ),
        'Daily competition',
      );
      await contributeHourlyResultToDailyCompetition(database, {
        dailyResultId: `daily-result:${daily.id}:${hourlyResult.userId}`,
        contributionId: `daily-contribution:${hourlyResult.id}`,
        dailyCompetitionId: daily.id,
        hourlyResultId: hourlyResult.id,
        idempotencyKey: `daily-contribution:${hourlyResult.id}`,
      });
    } catch (error) {
      failures.push(settlementFailure(error, account.id, null));
    }
  }

  const finalState = await runFinancialTransaction(database, async (client) => {
    const round = firstRow(
      await client.query<{ state: string }>(
        'select state from hourly_rounds where id = $1 for update',
        [input.hourlyRoundId],
      ),
      'Hourly round',
    );
    if (round.state === 'FINALIZED') return 'FINALIZED' as const;
    const readiness = firstRow(
      await client.query<{ accounts: number; results: number; open_positions: number }>(
        `select
           (select count(*)::int from competition_accounts where hourly_round_id = $1) accounts,
           (select count(*)::int from hourly_results where hourly_round_id = $1) results,
           (select count(*)::int from positions p join competition_accounts a
              on a.id = p.competition_account_id
            where a.hourly_round_id = $1 and p.status = 'OPEN') open_positions`,
        [input.hourlyRoundId],
      ),
      'Settlement readiness',
    );
    if (
      round.state === 'SETTLING' &&
      readiness.open_positions === 0 &&
      readiness.results === readiness.accounts &&
      failures.length === 0
    ) {
      await client.query(
        `update hourly_rounds set state = 'FINALIZED', finalized_at = $2 where id = $1`,
        [input.hourlyRoundId, input.authoritativeTimestamp],
      );
      return 'FINALIZED' as const;
    }
    return 'SETTLING' as const;
  });

  return {
    hourlyRoundId: input.hourlyRoundId,
    state: finalState,
    forcedSells,
    hourlyResults,
    failures:
      finalState === 'SETTLING' && failures.length === 0
        ? [
            {
              competitionAccountId: '',
              marketId: null,
              code: 'SETTLEMENT_INCOMPLETE',
              message: 'The round remains incomplete and retryable.',
              disposition: 'RETRY',
            },
          ]
        : failures,
  };
}

export interface PersistedFillReplayResult {
  readonly fillId: string;
  readonly matched: true;
  readonly marketStateFingerprint: string;
  readonly adapterVersion: string;
}

/** Read-only audit replay. It never mutates financial or evidence records. */
export async function replayPersistedFill(
  database: DatabaseService,
  router: ExecutionRouter,
  fillId: string,
): Promise<PersistedFillReplayResult> {
  const row = firstRow(
    await database.pool.query<{
      fill_id: string;
      order_id: string;
      execution_id: string;
      side: 'BUY' | 'SELL';
      requested_base_units: string | null;
      requested_quote_lamports: string | null;
      base_quantity: string;
      actual_input_lamports: string | null;
      actual_output_lamports: string | null;
      fee_lamports: string;
      executed_at: Date;
      protocol_id: string;
      adapter_version: string;
      market_id: string;
      mint_address: string;
      observed_at: Date;
      chain_slot: string | null;
      chain_block_id: string | null;
      normalization_version: string;
      normalized_state: JsonObject;
      raw_source: JsonObject | null;
      state_fingerprint: string;
    }>(
      `select f.id fill_id, f.order_id, f.execution_id, f.side,
              o.requested_base_units, o.requested_quote_lamports,
              f.base_quantity, f.actual_input_lamports, f.actual_output_lamports,
              f.fee_lamports, f.executed_at, f.protocol_id, f.adapter_version,
              f.market_id, a.mint_address, e.observed_at, e.chain_slot,
              e.chain_block_id, e.normalization_version, e.normalized_state,
              e.raw_source, e.state_fingerprint
       from fills f
       join orders o on o.id = f.order_id
       join markets m on m.id = f.market_id
       join assets a on a.id = m.base_asset_id
       join market_state_evidence e on e.id = f.market_state_evidence_id
       where f.id = $1`,
      [fillId],
    ),
    'Persisted fill',
  );
  if (!row.protocol_id || !row.adapter_version) {
    throw new FinancialServiceError(
      'ADAPTER_VERSION_UNAVAILABLE',
      'The fill does not identify a replayable adapter version.',
    );
  }
  const identity: MarketIdentity = {
    protocolId: identifier(row.protocol_id, 'ProtocolId'),
    marketId: identifier(row.market_id, 'MarketId'),
    tokenMint: identifier(row.mint_address, 'TokenMint'),
  };
  const state: MarketState = {
    identity,
    observedAt: utcInstant(row.observed_at),
    chainSlot: row.chain_slot === null ? null : BigInt(row.chain_slot),
    chainBlockId: row.chain_block_id,
    adapterVersion: row.adapter_version,
    normalizationVersion: row.normalization_version,
    normalizedState: row.normalized_state,
    ...(row.raw_source === null ? {} : { rawSource: row.raw_source }),
  };
  const evidence = createMarketStateEvidence(state);
  if (evidence.fingerprint !== row.state_fingerprint) {
    throw new FinancialServiceError(
      'EVIDENCE_CORRUPTED',
      'Persisted market-state evidence fingerprint is invalid.',
    );
  }
  let adapter;
  try {
    adapter = router.resolveVersion(identity.protocolId, row.adapter_version);
  } catch (error) {
    translateExecutionError(error, false);
  }
  let replay: SimulatedExecution;
  try {
    replay =
      row.side === 'BUY'
        ? await adapter!.simulateBuy(
            {
              orderId: identifier(row.order_id, 'OrderId'),
              executionId: identifier(row.execution_id, 'ExecutionId'),
              identity,
              requestedPaperSol: paperSolBaseUnits(BigInt(row.requested_quote_lamports!)),
              executedAt: utcInstant(row.executed_at),
            },
            state,
          )
        : await adapter!.simulateSell(
            {
              orderId: identifier(row.order_id, 'OrderId'),
              executionId: identifier(row.execution_id, 'ExecutionId'),
              identity,
              requestedTokenQuantity: tokenBaseUnits(BigInt(row.requested_base_units!)),
              executedAt: utcInstant(row.executed_at),
            },
            state,
          );
  } catch (error) {
    translateExecutionError(error, false);
  }
  const replayFees = paperSolFeeTotal(replay!);
  const matched =
    replay!.quote.marketStateFingerprint === row.state_fingerprint &&
    replayFees === BigInt(row.fee_lamports) &&
    (row.side === 'BUY'
      ? replay!.actualInput.asset === 'PAPER_SOL' &&
        replay!.actualInput.amount === BigInt(row.actual_input_lamports!) &&
        replay!.actualOutput.asset === 'TOKEN' &&
        replay!.actualOutput.amount === BigInt(row.base_quantity)
      : replay!.actualInput.asset === 'TOKEN' &&
        replay!.actualInput.amount === BigInt(row.base_quantity) &&
        replay!.actualOutput.asset === 'PAPER_SOL' &&
        replay!.actualOutput.amount === BigInt(row.actual_output_lamports!));
  if (!matched) {
    throw new FinancialServiceError(
      'INVALID_EXECUTION_RESULT',
      'Persisted fill does not match deterministic replay output.',
    );
  }
  return {
    fillId,
    matched: true,
    marketStateFingerprint: row.state_fingerprint,
    adapterVersion: row.adapter_version,
  };
}

/** Exact incident scope; never used by the normal worker or a public API. */
export const ONE_TIME_DUST_RESOLUTION = Object.freeze({
  reason: 'OPERATOR_APPROVED_DUST_RESOLUTION_V1',
  roundId: 'hourly:2026-10-10T23:00:00.000Z',
  marketId: 'FHYwo1cVWX2NyixiK22jpM7N1RA1A35qGszMG7v6sYBf',
  mint: 'FB5ViYXcLNSEcy8R2Jg1DmJwP36mizZsPKvAprM8pump',
  accountId:
    'account:hourly:2026-10-10T23:00:00.000Z:user:feb89522289b86e10f3bcaf3a54231c823690d2a5904fc5e80c137c8cbece4f8',
  positionId:
    'position:account:hourly:2026-10-10T23:00:00.000Z:user:feb89522289b86e10f3bcaf3a54231c823690d2a5904fc5e80c137c8cbece4f8:FHYwo1cVWX2NyixiK22jpM7N1RA1A35qGszMG7v6sYBf',
});

export async function resolveOneTimeDustSettlement(
  database: DatabaseService,
  router: ExecutionRouter,
  input: {
    execute?: boolean;
    operatorIdentifier?: string;
    approvalReference?: string;
    acknowledgement?: string;
    payoutExecutionDisabled?: boolean;
    target?: Partial<Record<keyof typeof ONE_TIME_DUST_RESOLUTION, string>>;
  } = {},
) {
  const scope = ONE_TIME_DUST_RESOLUTION;
  const report = {
    scope,
    eligible: false,
    resolved: false,
    alreadyResolved: false,
    liveExecutionBlocked: true,
    abortReasons: [] as string[],
    checks: {} as Record<string, boolean>,
    position: null as null | {
      remainingBaseUnits: string;
      costBasisLamports: string;
      cashLamports: string;
      projectedPositionPnlLamports: string;
      projectedAccountPnlLamports: string;
      projectedHourlyPnlLamports: string;
    },
  };
  const check = (name: string, ok: boolean) => {
    report.checks[name] = ok;
    if (!ok) report.abortReasons.push(name);
    return ok;
  };
  check(
    'EXACT_REQUEST_SCOPE',
    !input.target ||
      Object.entries(input.target).every(
        ([key, value]) => value === scope[key as keyof typeof scope],
      ),
  );
  if (input.execute)
    check(
      'EXPLICIT_OPERATOR_AUTHORIZATION',
      !!input.operatorIdentifier?.trim() &&
        !!input.approvalReference?.trim() &&
        input.acknowledgement === scope.reason,
    );
  if (report.abortReasons.length) return report;
  const client = await database.pool.connect();
  try {
    await client.query(input.execute ? 'begin' : 'begin read only');
    await client.query("set local statement_timeout='15000ms'");
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended('hourly-settlement:' || $1::text, 0))",
      [scope.roundId],
    );
    const row = (
      await client.query<{
        account_id: string;
        round_id: string;
        market_id: string;
        mint: string;
        venue: string;
        quote_mint: string;
        state: string;
        status: string;
        quantity: string;
        basis: string;
        cash: string;
        position_pnl: string;
        account_pnl: string;
        starting: string;
        ends_at_exclusive: Date;
      }>(
        `select a.id account_id,a.hourly_round_id round_id,p.market_id,b.mint_address mint,m.venue,
      q.mint_address quote_mint,r.state,p.status,p.remaining_base_units quantity,p.cost_basis_lamports basis,
      a.paper_sol_balance_lamports cash,p.realized_pnl_lamports position_pnl,a.realized_pnl_lamports account_pnl,
      a.starting_paper_sol_lamports starting,r.ends_at_exclusive from positions p
      join competition_accounts a on a.id=p.competition_account_id join hourly_rounds r on r.id=a.hourly_round_id
      join markets m on m.id=p.market_id join assets b on b.id=p.asset_id and b.id=m.base_asset_id
      join assets q on q.id=m.quote_asset_id where p.id=$1`,
        [scope.positionId],
      )
    ).rows[0];
    if (
      !check(
        'EXACT_PERSISTED_IDENTITY',
        !!row &&
          row.account_id === scope.accountId &&
          row.round_id === scope.roundId &&
          row.market_id === scope.marketId &&
          row.mint === scope.mint &&
          row.venue === 'PUMP_FUN' &&
          row.quote_mint === 'So11111111111111111111111111111111111111112',
      )
    ) {
      await client.query('rollback');
      return report;
    }
    const target = row!;
    if (input.execute) {
      await client.query('select id from competition_accounts where id=$1 for update', [
        scope.accountId,
      ]);
      await client.query('select id from hourly_rounds where id=$1 for share', [scope.roundId]);
      await client.query('select id from positions where id=$1 for update', [scope.positionId]);
      Object.assign(
        target,
        (
          await client.query(
            `select remaining_base_units quantity,cost_basis_lamports basis,
        realized_pnl_lamports position_pnl,status from positions where id=$1`,
            [scope.positionId],
          )
        ).rows[0],
      );
      Object.assign(
        target,
        (
          await client.query(
            `select paper_sol_balance_lamports cash,realized_pnl_lamports account_pnl
        from competition_accounts where id=$1`,
            [scope.accountId],
          )
        ).rows[0],
      );
      target.state = (
        await client.query('select state from hourly_rounds where id=$1', [scope.roundId])
      ).rows[0].state;
    }
    report.position = {
      remainingBaseUnits: target.quantity,
      costBasisLamports: target.basis,
      cashLamports: target.cash,
      projectedPositionPnlLamports: (BigInt(target.position_pnl) - BigInt(target.basis)).toString(),
      projectedAccountPnlLamports: (BigInt(target.account_pnl) - BigInt(target.basis)).toString(),
      projectedHourlyPnlLamports: (BigInt(target.cash) - BigInt(target.starting)).toString(),
    };
    const prior = (
      await client.query('select metadata from journal_transactions where id=$1', [
        `journal:forced-writeoff:${scope.positionId}`,
      ])
    ).rows[0];
    if (prior?.metadata.reason === scope.reason && target.status === 'CLOSED') {
      report.alreadyResolved = true;
      report.liveExecutionBlocked = false;
      await client.query('rollback');
      return report;
    }
    check(
      'SETTLING_OPEN_POSITION',
      target.state === 'SETTLING' &&
        target.status === 'OPEN' &&
        BigInt(target.quantity) > 0n &&
        !prior,
    );

    const anchors = (
      await client.query(
        `select f.id,f.base_quantity,f.actual_input_lamports,e.state_fingerprint from fills f
      join orders o on o.id=f.order_id join market_state_evidence e on e.id=f.market_state_evidence_id
      where o.competition_account_id=$1 and f.market_id=$2 and f.side='BUY' order by f.executed_at`,
        [scope.accountId, scope.marketId],
      )
    ).rows;
    const expected = [
      [
        'authoritative-buy-fill:88d568303333dedf773f3a1537800bb3b25c53e01ac687e72dc392900699d615',
        '32418102410735',
        '946297321',
        '416e01d775742231ea85d5c3f3c2736533df5fc89d1599d91dc10149077fa027',
      ],
      [
        'authoritative-buy-fill:6a047be2e2896f7e4ccc85a42d92aa43fe7c773a15dd084c454ae9b780131e64',
        '29264708405028',
        '851667589',
        '779175f4414b24e38b0e726b52cbd69e601eb769bd3bebfbd8aeaaa7b93e8f99',
      ],
    ];
    check(
      'RECORDED_BUY_BINDING',
      anchors.length === 2 &&
        expected.every(
          (a, i) =>
            a.join('|') ===
            [
              anchors[i]?.id,
              anchors[i]?.base_quantity,
              anchors[i]?.actual_input_lamports,
              anchors[i]?.state_fingerprint,
            ].join('|'),
        ),
    );
    const history = (
      await client.query(
        `select f.id,f.base_quantity,f.quote_lamports,f.actual_output_lamports,f.fee_lamports,
      e.state_fingerprint,e.chain_slot,e.normalized_state->>'realSolReserves' reserve,i.idempotency_key
      from fills f join orders o on o.id=f.order_id join market_state_evidence e on e.id=f.market_state_evidence_id
      join idempotency_records i on i.id=o.idempotency_record_id where o.competition_account_id=$1 and f.market_id=$2
      and o.execution_context='FORCED_HOURLY_SETTLEMENT' order by f.created_at desc limit 32`,
        [scope.accountId, scope.marketId],
      )
    ).rows;
    check(
      'PERSISTENT_RECORDED_DUST',
      history.length === 32 &&
        new Set(history.map((h) => h.id)).size === 32 &&
        new Set(history.map((h) => h.chain_slot)).size >= 2 &&
        history.every(
          (h) =>
            h.reserve === '5' &&
            h.base_quantity === '214600' &&
            h.quote_lamports === '5' &&
            h.actual_output_lamports === '3' &&
            h.fee_lamports === '2',
        ) &&
        history.every(
          (h, i) =>
            i === 0 ||
            BigInt(history[i - 1]!.idempotency_key.split(':').at(-1)!) + 214600n ===
              BigInt(h.idempotency_key.split(':').at(-1)!),
        ) &&
        BigInt(history[0]?.idempotency_key.split(':').at(-1) ?? '0') - 214600n ===
          BigInt(target.quantity),
    );
    const plans = (
      await client.query(
        `select p.state,
      exists(select 1 from payout_plan_approvals a where a.payout_plan_id=p.id) approved,
      exists(select 1 from payout_executions e where e.payout_plan_id=p.id) execution from payout_plans p
      where p.hourly_round_id=$1 or p.daily_competition_id in (select id from daily_competitions where utc_date='2026-10-10')`,
        [scope.roundId],
      )
    ).rows;
    check(
      'PAYOUT_REVIEW_GATE',
      input.payoutExecutionDisabled === true &&
        plans.every(
          (p) =>
            ['CALCULATED', 'FROZEN', 'VALIDATED'].includes(p.state) && !p.approved && !p.execution,
        ),
    );
    const readDatabase = {
      pool: {
        query: client.query.bind(client),
        connect: async () => ({ query: client.query.bind(client), release() {} }),
      },
    } as unknown as DatabaseService;
    check(
      'FINANCIAL_RECONCILIATION',
      (await reconcileAccountLedger(readDatabase, scope.accountId)).reconciled,
    );
    if (report.checks['RECORDED_BUY_BINDING']) {
      for (const anchor of anchors) {
        check(
          `HISTORICAL_REPLAY:${anchor.id}`,
          (await replayPersistedFill(readDatabase, router, anchor.id)).matched,
        );
      }
    }
    if (!report.abortReasons.length) {
      const capacity = await canonicalExitPreflight(
        router,
        {
          protocolId: identifier('PUMP_FUN', 'ProtocolId'),
          marketId: identifier(scope.marketId, 'MarketId'),
          tokenMint: identifier(scope.mint, 'TokenMint'),
        },
        BigInt(target.quantity),
        BigInt(target.basis),
        true,
      );
      const state = capacity.evidence,
        n = state.normalizedState;
      check(
        'FRESH_DIRECT_PUMP_EVIDENCE',
        state.identity.protocolId === 'PUMP_FUN' &&
          state.identity.marketId === scope.marketId &&
          state.identity.tokenMint === scope.mint &&
          n['model'] === 'PUMP_FUN_BONDING_CURVE' &&
          n['bondingCurveAddress'] === scope.marketId &&
          n['quoteAsset'] === 'SOL' &&
          n['complete'] === false &&
          n['realSolReserves'] === '5' &&
          n['protocolFeeBps'] === '95' &&
          n['creatorFeeBps'] === '30' &&
          state.chainSlot !== null &&
          state.chainSlot >= BigInt(history[0]!.chain_slot) &&
          Number.isFinite(Date.parse(state.observedAt)) &&
          Date.now() - Date.parse(state.observedAt) >= -1000 &&
          Date.now() - Date.parse(state.observedAt) <= 30000,
      );
      check(
        'EXACT_PARTIAL_DUST_CAPACITY',
        !capacity.full.executable &&
          capacity.maxExecutableQuantityBaseUnits === 214600n &&
          capacity.maxExecutableQuantityBaseUnits < BigInt(target.quantity) &&
          capacity.maxExecutableOutputLamports === 3n,
      );
      report.eligible = !report.abortReasons.length;
      report.liveExecutionBlocked = !report.eligible;
      if (input.execute && report.eligible) {
        await writeOffSettlementRemainder(database, {
          competitionAccountId: scope.accountId,
          positionId: scope.positionId,
          marketId: scope.marketId,
          tokenQuantity: BigInt(target.quantity),
          costBasis: BigInt(target.basis),
          evidence: state,
          authoritativeTimestamp: target.ends_at_exclusive,
          idempotencyKey: `hourly-settlement-writeoff:${scope.roundId}:${scope.positionId}`,
          transactionClient: client,
          operatorResolution: {
            policy: scope.reason,
            operatorIdentifier: input.operatorIdentifier!.trim(),
            approvalReference: input.approvalReference!.trim(),
            resolvedAt: new Date().toISOString(),
            quotedExecutableQuantity: '214600',
            quotedExecutableProceeds: '3',
            creditedProceeds: '0',
            payoutReviewGate: 'EXPLICIT_PAYOUT_APPROVAL_REQUIRED',
            historicalFillIds: history.map((h) => h.id),
            historicalStateFingerprints: history.map((h) => h.state_fingerprint),
          },
        });
        if (!(await reconcileAccountLedger(readDatabase, scope.accountId)).reconciled)
          throw new FinancialServiceError(
            'FINALIZATION_CONFLICT',
            'Post-resolution accounting does not reconcile.',
          );
        await client.query('commit');
        report.resolved = true;
        return report;
      }
    }
    await client.query('rollback');
    return report;
  } catch (error) {
    await client.query('rollback');
    report.eligible = false;
    report.liveExecutionBlocked = true;
    report.abortReasons.push(
      error instanceof FinancialServiceError || error instanceof ExecutionEngineError
        ? error.code
        : 'INCONCLUSIVE_VALIDATION',
    );
    return report;
  } finally {
    client.release();
  }
}
