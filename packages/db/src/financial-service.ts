import { createHash } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

import type { DatabaseService } from './database.js';

export const INITIAL_SEASON_ALLOCATION_LAMPORTS = 10_000_000_000n;

export type FinancialErrorCode =
  | 'INVALID_FINANCIAL_INPUT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ENTITY_NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_POSITION'
  | 'ORDER_MISMATCH';

export class FinancialServiceError extends Error {
  readonly code: FinancialErrorCode;

  constructor(code: FinancialErrorCode, message: string) {
    super(message);
    this.name = 'FinancialServiceError';
    this.code = code;
  }
}

export interface SeasonAccountFinancialState {
  readonly id: string;
  readonly userId: string;
  readonly seasonId: string;
  readonly status: string;
  readonly initialAllocationLamports: bigint;
  readonly cumulativeTopUpLamports: bigint;
  readonly cashBalanceLamports: bigint;
  readonly realizedPnlLamports: bigint;
}

export interface PositionState {
  readonly id: string;
  readonly seasonAccountId: string;
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
  readonly cashBalanceLamports: bigint;
  readonly realizedPnlLamports: bigint;
  readonly costBasisLamportsRemoved: bigint;
  readonly fillRealizedPnlLamports: bigint;
}

interface IdempotencyRow extends QueryResultRow {
  id: string;
  request_hash: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  result_entity_type: string | null;
  result_entity_id: string | null;
}

interface SeasonAccountRow extends QueryResultRow {
  id: string;
  user_id: string;
  season_id: string;
  status: string;
  initial_allocation_lamports: string;
  cumulative_top_up_lamports: string;
  cash_balance_lamports: string;
  realized_pnl_lamports: string;
}

interface PositionRow extends QueryResultRow {
  id: string;
  season_account_id: string;
  market_id: string;
  asset_id: string;
  remaining_base_units: string;
  cost_basis_lamports: string;
  realized_pnl_lamports: string;
  status: 'OPEN' | 'CLOSED';
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

function toSeasonAccount(row: SeasonAccountRow): SeasonAccountFinancialState {
  return {
    id: row.id,
    userId: row.user_id,
    seasonId: row.season_id,
    status: row.status,
    initialAllocationLamports: BigInt(row.initial_allocation_lamports),
    cumulativeTopUpLamports: BigInt(row.cumulative_top_up_lamports),
    cashBalanceLamports: BigInt(row.cash_balance_lamports),
    realizedPnlLamports: BigInt(row.realized_pnl_lamports),
  };
}

function toPosition(row: PositionRow): PositionState {
  return {
    id: row.id,
    seasonAccountId: row.season_account_id,
    marketId: row.market_id,
    assetId: row.asset_id,
    remainingBaseUnits: BigInt(row.remaining_base_units),
    costBasisLamports: BigInt(row.cost_basis_lamports),
    realizedPnlLamports: BigInt(row.realized_pnl_lamports),
    status: row.status,
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
    readonly seasonAccountId?: string;
  },
): Promise<{ readonly record: IdempotencyRow; readonly replay: boolean }> {
  assertNonEmpty(input.idempotencyKey, 'Idempotency key');
  const recordId = `idempotency:${input.operationClass}:${input.idempotencyKey}`;
  await client.query(
    `insert into idempotency_records
      (id, operation_class, idempotency_key, request_hash, season_account_id)
     values ($1, $2, $3, $4, $5)
     on conflict do nothing`,
    [
      recordId,
      input.operationClass,
      input.idempotencyKey,
      input.requestHash,
      input.seasonAccountId ?? null,
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
  seasonAccountId?: string,
): Promise<void> {
  await client.query(
    `update idempotency_records
     set status = 'COMPLETED', result_entity_type = $2, result_entity_id = $3,
         season_account_id = coalesce(season_account_id, $4), completed_at = now()
     where id = $1`,
    [recordId, resultEntityType, resultEntityId, seasonAccountId ?? null],
  );
}

type LedgerAccountCode =
  'CASH' | 'POSITION_COST' | 'STARTING_CAPITAL' | 'TOP_UP_CAPITAL' | 'TRADING_PNL' | 'TRADING_FEES';

interface JournalEntryInput {
  readonly accountCode: LedgerAccountCode;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountLamports: bigint;
}

async function insertJournal(
  client: PoolClient,
  input: {
    readonly id: string;
    readonly seasonAccountId: string;
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
      (id, season_account_id, operation_type, source_entity_type, source_entity_id, idempotency_record_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      input.seasonAccountId,
      input.operationType,
      input.sourceEntityType,
      input.sourceEntityId,
      input.idempotencyRecordId,
    ],
  );
  for (const [index, entry] of input.entries.entries()) {
    await client.query(
      `insert into ledger_entries
        (id, journal_transaction_id, season_account_id, account_code, direction, amount_lamports)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        `${input.id}:entry:${index.toString()}`,
        input.id,
        input.seasonAccountId,
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

function isUtcMonthlyInterval(startsAt: Date, endsAt: Date): boolean {
  if (
    startsAt.getUTCDate() !== 1 ||
    startsAt.getUTCHours() !== 0 ||
    startsAt.getUTCMinutes() !== 0 ||
    startsAt.getUTCSeconds() !== 0 ||
    startsAt.getUTCMilliseconds() !== 0
  ) {
    return false;
  }
  const expectedEnd = new Date(startsAt.getTime());
  expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);
  return expectedEnd.getTime() === endsAt.getTime();
}

export async function createCompetitionSeason(
  database: DatabaseService,
  input: {
    readonly id: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly rulesVersion: string;
    readonly status?: 'SCHEDULED' | 'OPEN';
  },
): Promise<void> {
  if (!isUtcMonthlyInterval(input.startsAt, input.endsAt)) {
    throw new FinancialServiceError(
      'INVALID_FINANCIAL_INPUT',
      'Competition seasons must use exact UTC calendar-month boundaries.',
    );
  }
  await database.pool.query(
    `insert into competition_seasons
      (id, starts_at, ends_at, status, initial_allocation_lamports, rules_version)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      input.startsAt,
      input.endsAt,
      input.status ?? 'SCHEDULED',
      INITIAL_SEASON_ALLOCATION_LAMPORTS,
      input.rulesVersion,
    ],
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
    `insert into assets (id, mint_address, decimals, symbol, name)
     values ($1, $2, $3, $4, $5)`,
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
    `insert into markets
      (id, base_asset_id, quote_asset_id, venue, provider_market_id)
     values ($1, $2, $3, $4, $5)`,
    [input.id, input.baseAssetId, input.quoteAssetId, input.venue, input.providerMarketId],
  );
}

export async function initializeSeasonAccount(
  database: DatabaseService,
  input: {
    readonly accountId: string;
    readonly userId: string;
    readonly seasonId: string;
    readonly idempotencyKey: string;
  },
): Promise<SeasonAccountFinancialState> {
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database, async (client) => {
    const claimed = await claimIdempotency(client, {
      operationClass: 'SEASON_ACCOUNT_INITIALIZATION',
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
    if (claimed.replay) {
      return getAccountStateWithClient(client, claimed.record.result_entity_id!);
    }
    const season = firstRow(
      await client.query<{ initial_allocation_lamports: string }>(
        `select initial_allocation_lamports from competition_seasons where id = $1 for share`,
        [input.seasonId],
      ),
      'Competition season',
    );
    const allocation = BigInt(season.initial_allocation_lamports);
    const inserted = await client.query<{ id: string }>(
      `insert into season_accounts
        (id, user_id, season_id, initial_allocation_lamports, cash_balance_lamports)
       values ($1, $2, $3, $4, $4)
       on conflict (user_id, season_id) do nothing
       returning id`,
      [input.accountId, input.userId, input.seasonId, allocation],
    );
    const accountId =
      inserted.rows[0]?.id ??
      firstRow(
        await client.query<{ id: string }>(
          'select id from season_accounts where user_id = $1 and season_id = $2',
          [input.userId, input.seasonId],
        ),
        'Season account',
      ).id;
    if (inserted.rowCount === 1) {
      await insertJournal(client, {
        id: `journal:starting-allocation:${accountId}`,
        seasonAccountId: accountId,
        operationType: 'STARTING_ALLOCATION',
        sourceEntityType: 'SEASON_ACCOUNT',
        sourceEntityId: accountId,
        idempotencyRecordId: claimed.record.id,
        entries: [
          { accountCode: 'CASH', direction: 'DEBIT', amountLamports: allocation },
          { accountCode: 'STARTING_CAPITAL', direction: 'CREDIT', amountLamports: allocation },
        ],
      });
    }
    await completeIdempotency(client, claimed.record.id, 'SEASON_ACCOUNT', accountId, accountId);
    return getAccountStateWithClient(client, accountId);
  });
}

async function getAccountStateWithClient(
  client: PoolClient,
  accountId: string,
  forUpdate = false,
): Promise<SeasonAccountFinancialState> {
  const row = firstRow(
    await client.query<SeasonAccountRow>(
      `select id, user_id, season_id, status, initial_allocation_lamports,
              cumulative_top_up_lamports, cash_balance_lamports, realized_pnl_lamports
       from season_accounts where id = $1${forUpdate ? ' for update' : ''}`,
      [accountId],
    ),
    'Season account',
  );
  return toSeasonAccount(row);
}

export async function getAccountFinancialState(
  database: DatabaseService,
  accountId: string,
): Promise<SeasonAccountFinancialState> {
  const client = await database.pool.connect();
  try {
    return await getAccountStateWithClient(client, accountId);
  } finally {
    client.release();
  }
}

export async function applyPaperTopUp(
  database: DatabaseService,
  input: {
    readonly accountId: string;
    readonly amountLamports: bigint;
    readonly idempotencyKey: string;
  },
): Promise<SeasonAccountFinancialState> {
  assertPositive(input.amountLamports, 'Top-up amount');
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database, async (client) => {
    await getAccountStateWithClient(client, input.accountId, true);
    const claimed = await claimIdempotency(client, {
      operationClass: 'PAPER_TOP_UP',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      seasonAccountId: input.accountId,
    });
    if (claimed.replay) return getAccountStateWithClient(client, input.accountId);
    await client.query(
      `update season_accounts
       set cash_balance_lamports = cash_balance_lamports + $2,
           cumulative_top_up_lamports = cumulative_top_up_lamports + $2
       where id = $1`,
      [input.accountId, input.amountLamports],
    );
    await insertJournal(client, {
      id: `journal:top-up:${claimed.record.id}`,
      seasonAccountId: input.accountId,
      operationType: 'PAPER_TOP_UP',
      sourceEntityType: 'SEASON_ACCOUNT',
      sourceEntityId: input.accountId,
      idempotencyRecordId: claimed.record.id,
      entries: [
        { accountCode: 'CASH', direction: 'DEBIT', amountLamports: input.amountLamports },
        {
          accountCode: 'TOP_UP_CAPITAL',
          direction: 'CREDIT',
          amountLamports: input.amountLamports,
        },
      ],
    });
    await completeIdempotency(
      client,
      claimed.record.id,
      'SEASON_ACCOUNT',
      input.accountId,
      input.accountId,
    );
    return getAccountStateWithClient(client, input.accountId);
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
    const claimed = await claimIdempotency(client, {
      operationClass: 'ORDER_SUBMISSION',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      seasonAccountId: input.accountId,
    });
    if (claimed.replay) return claimed.record.result_entity_id!;
    await client.query(
      `insert into orders
        (id, season_account_id, market_id, side, requested_base_units,
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
        season_account_id: string;
        market_id: string;
        side: 'BUY' | 'SELL';
        status: string;
        requested_base_units: string | null;
        requested_quote_lamports: string | null;
      }>(
        `select id, season_account_id, market_id, side, status,
                requested_base_units, requested_quote_lamports
         from orders where id = $1 for update`,
        [input.orderId],
      ),
      'Order',
    );
    const account = await getAccountStateWithClient(client, order.season_account_id, true);
    const claimed = await claimIdempotency(client, {
      operationClass: 'FILL_APPLICATION',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      seasonAccountId: order.season_account_id,
    });
    if (claimed.replay) {
      return getFillResult(client, claimed.record.result_entity_id!);
    }
    if (
      order.status === 'REJECTED' ||
      order.status === 'CANCELLED' ||
      order.status === 'COMPLETED'
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
    const existingPosition = await client.query<PositionRow>(
      `select id, season_account_id, market_id, asset_id, remaining_base_units,
              cost_basis_lamports, realized_pnl_lamports, status
       from positions where season_account_id = $1 and market_id = $2 for update`,
      [order.season_account_id, order.market_id],
    );

    let position: PositionState;
    let costRemoved = 0n;
    let fillRealizedPnl = 0n;
    let nextCash = account.cashBalanceLamports;
    let nextRealizedPnl = account.realizedPnlLamports;
    const journalEntries: JournalEntryInput[] = [];

    if (order.side === 'BUY') {
      const cashDebit = input.quoteLamports + input.feeLamports;
      if (account.cashBalanceLamports < cashDebit) {
        throw new FinancialServiceError(
          'INSUFFICIENT_BALANCE',
          'Paper SOL balance is insufficient.',
        );
      }
      nextCash -= cashDebit;
      const positionId =
        existingPosition.rows[0]?.id ?? `position:${order.season_account_id}:${order.market_id}`;
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
            (id, season_account_id, market_id, asset_id, remaining_base_units,
             cost_basis_lamports, status, opened_at)
           values ($1, $2, $3, $4, $5, $6, 'OPEN', $7)`,
          [
            positionId,
            order.season_account_id,
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
      `update season_accounts
       set cash_balance_lamports = $2, realized_pnl_lamports = $3
       where id = $1`,
      [order.season_account_id, nextCash, nextRealizedPnl],
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
      seasonAccountId: order.season_account_id,
      operationType: order.side === 'BUY' ? 'SIMULATED_BUY' : 'SIMULATED_SELL',
      sourceEntityType: 'FILL',
      sourceEntityId: input.fillId,
      idempotencyRecordId: claimed.record.id,
      entries: journalEntries,
    });
    await client.query(`update orders set status = $2, updated_at = now() where id = $1`, [
      input.orderId,
      input.completeOrder === false ? 'PARTIALLY_FILLED' : 'COMPLETED',
    ]);
    await completeIdempotency(
      client,
      claimed.record.id,
      'FILL',
      input.fillId,
      order.season_account_id,
    );
    return {
      fillId: input.fillId,
      orderId: input.orderId,
      position,
      cashBalanceLamports: nextCash,
      realizedPnlLamports: nextRealizedPnl,
      costBasisLamportsRemoved: costRemoved,
      fillRealizedPnlLamports: fillRealizedPnl,
    };
  });
}

async function getPositionWithClient(
  client: PoolClient,
  positionId: string,
): Promise<PositionState> {
  return toPosition(
    firstRow(
      await client.query<PositionRow>(
        `select id, season_account_id, market_id, asset_id, remaining_base_units,
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
      season_account_id: string;
      position_id: string;
    }>(
      `select f.id, f.order_id, f.cost_basis_lamports_removed, f.realized_pnl_lamports,
              o.season_account_id, p.id as position_id
       from fills f
       join orders o on o.id = f.order_id
       join positions p on p.season_account_id = o.season_account_id and p.market_id = f.market_id
       where f.id = $1`,
      [fillId],
    ),
    'Fill',
  );
  const account = await getAccountStateWithClient(client, fill.season_account_id);
  return {
    fillId: fill.id,
    orderId: fill.order_id,
    position: await getPositionWithClient(client, fill.position_id),
    cashBalanceLamports: account.cashBalanceLamports,
    realizedPnlLamports: account.realizedPnlLamports,
    costBasisLamportsRemoved: BigInt(fill.cost_basis_lamports_removed),
    fillRealizedPnlLamports: BigInt(fill.realized_pnl_lamports),
  };
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
  readonly topUpCapitalLamports: bigint;
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
       from positions where season_account_id = $1`,
      [accountId],
    ),
    'Position aggregate',
  );
  const fillAggregate = firstRow(
    await database.pool.query<{ quantity: string }>(
      `select coalesce(sum(case when f.side = 'BUY' then f.base_quantity else -f.base_quantity end), 0)::text as quantity
       from fills f join orders o on o.id = f.order_id where o.season_account_id = $1`,
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
     from ledger_entries where season_account_id = $1 group by account_code`,
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
         where j.season_account_id = $1 group by j.id
       ) journal_balances`,
      [accountId],
    ),
    'Journal aggregate',
  );
  const cash = balance('CASH');
  const positionCost = balance('POSITION_COST');
  const startingCapital = -balance('STARTING_CAPITAL');
  const topUpCapital = -balance('TOP_UP_CAPITAL');
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
    materializedCashLamports: account.cashBalanceLamports,
    positionCostFromLedgerLamports: positionCost,
    materializedPositionCostLamports: materializedPositionCost,
    quantityFromFills,
    materializedQuantity,
    startingCapitalLamports: startingCapital,
    topUpCapitalLamports: topUpCapital,
    grossTradingPnlLamports: grossTradingPnl,
    tradingFeesLamports: tradingFees,
    realizedPnlLamports: realizedPnl,
    balancedJournalCount,
    journalCount,
    reconciled:
      cash === account.cashBalanceLamports &&
      positionCost === materializedPositionCost &&
      quantityFromFills === materializedQuantity &&
      startingCapital === account.initialAllocationLamports &&
      topUpCapital === account.cumulativeTopUpLamports &&
      realizedPnl === account.realizedPnlLamports &&
      cash + positionCost === startingCapital + topUpCapital + grossTradingPnl - tradingFees &&
      balancedJournalCount === journalCount,
  };
}
