import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt,
  updatedAt,
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  walletAddress: text('wallet_address').notNull().unique(),
  createdAt,
});

export const competitionSeasons = pgTable(
  'competition_seasons',
  {
    id: text('id').primaryKey(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('SCHEDULED'),
    initialAllocationLamports: bigint('initial_allocation_lamports', { mode: 'bigint' }).notNull(),
    rulesVersion: text('rules_version').notNull(),
    createdAt,
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    check('competition_seasons_time_order', sql`${table.startsAt} < ${table.endsAt}`),
    check(
      'competition_seasons_status_valid',
      sql`${table.status} in ('SCHEDULED', 'OPEN', 'FINALIZING', 'FINALIZED')`,
    ),
    check(
      'competition_seasons_initial_allocation_positive',
      sql`${table.initialAllocationLamports} > 0`,
    ),
  ],
);

export const seasonAccounts = pgTable(
  'season_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    seasonId: text('season_id')
      .notNull()
      .references(() => competitionSeasons.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    status: text('status').notNull().default('ACTIVE'),
    initialAllocationLamports: bigint('initial_allocation_lamports', { mode: 'bigint' }).notNull(),
    cumulativeTopUpLamports: bigint('cumulative_top_up_lamports', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    cashBalanceLamports: bigint('cash_balance_lamports', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    realizedPnlLamports: bigint('realized_pnl_lamports', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt,
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    unique('season_accounts_user_season_unique').on(table.userId, table.seasonId),
    index('season_accounts_season_idx').on(table.seasonId),
    check('season_accounts_status_valid', sql`${table.status} in ('ACTIVE', 'FINALIZED')`),
    check(
      'season_accounts_initial_allocation_nonnegative',
      sql`${table.initialAllocationLamports} >= 0`,
    ),
    check('season_accounts_top_up_nonnegative', sql`${table.cumulativeTopUpLamports} >= 0`),
    check('season_accounts_cash_nonnegative', sql`${table.cashBalanceLamports} >= 0`),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    mintAddress: text('mint_address').notNull().unique(),
    symbol: text('symbol'),
    name: text('name'),
    decimals: integer('decimals').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt,
  },
  (table) => [check('assets_decimals_valid', sql`${table.decimals} between 0 and 255`)],
);

export const markets = pgTable(
  'markets',
  {
    id: text('id').primaryKey(),
    baseAssetId: text('base_asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    quoteAssetId: text('quote_asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    venue: text('venue').notNull(),
    providerMarketId: text('provider_market_id').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt,
  },
  (table) => [
    unique('markets_venue_provider_unique').on(table.venue, table.providerMarketId),
    check('markets_distinct_assets', sql`${table.baseAssetId} <> ${table.quoteAssetId}`),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: text('id').primaryKey(),
    operationClass: text('operation_class').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('PENDING'),
    seasonAccountId: text('season_account_id').references(() => seasonAccounts.id, {
      onDelete: 'restrict',
      onUpdate: 'restrict',
    }),
    resultEntityType: text('result_entity_type'),
    resultEntityId: text('result_entity_id'),
    createdAt,
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('idempotency_operation_key_unique').on(table.operationClass, table.idempotencyKey),
    check('idempotency_status_valid', sql`${table.status} in ('PENDING', 'COMPLETED', 'FAILED')`),
    check(
      'idempotency_completion_consistent',
      sql`(${table.status} = 'PENDING' and ${table.completedAt} is null) or (${table.status} <> 'PENDING' and ${table.completedAt} is not null)`,
    ),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    seasonAccountId: text('season_account_id')
      .notNull()
      .references(() => seasonAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    marketId: text('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    side: text('side').notNull(),
    requestedBaseUnits: bigint('requested_base_units', { mode: 'bigint' }),
    requestedQuoteLamports: bigint('requested_quote_lamports', { mode: 'bigint' }),
    status: text('status').notNull().default('PENDING'),
    idempotencyRecordId: text('idempotency_record_id')
      .notNull()
      .unique()
      .references(() => idempotencyRecords.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    updatedAt,
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
  },
  (table) => [
    index('orders_account_time_idx').on(table.seasonAccountId, table.requestedAt),
    check('orders_side_valid', sql`${table.side} in ('BUY', 'SELL')`),
    check(
      'orders_status_valid',
      sql`${table.status} in ('PENDING', 'PARTIALLY_FILLED', 'COMPLETED', 'REJECTED', 'CANCELLED')`,
    ),
    check(
      'orders_request_valid',
      sql`(${table.side} = 'BUY' and ${table.requestedQuoteLamports} > 0 and ${table.requestedBaseUnits} is null) or (${table.side} = 'SELL' and ${table.requestedBaseUnits} > 0 and ${table.requestedQuoteLamports} is null)`,
    ),
  ],
);

export const positions = pgTable(
  'positions',
  {
    id: text('id').primaryKey(),
    seasonAccountId: text('season_account_id')
      .notNull()
      .references(() => seasonAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    marketId: text('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    remainingBaseUnits: bigint('remaining_base_units', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    costBasisLamports: bigint('cost_basis_lamports', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    realizedPnlLamports: bigint('realized_pnl_lamports', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    status: text('status').notNull().default('OPEN'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    updatedAt,
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    unique('positions_account_market_unique').on(table.seasonAccountId, table.marketId),
    check('positions_quantity_nonnegative', sql`${table.remainingBaseUnits} >= 0`),
    check('positions_cost_nonnegative', sql`${table.costBasisLamports} >= 0`),
    check('positions_status_valid', sql`${table.status} in ('OPEN', 'CLOSED')`),
    check(
      'positions_state_consistent',
      sql`(${table.status} = 'OPEN' and ${table.remainingBaseUnits} > 0 and ${table.costBasisLamports} > 0 and ${table.closedAt} is null) or (${table.status} = 'CLOSED' and ${table.remainingBaseUnits} = 0 and ${table.costBasisLamports} = 0 and ${table.closedAt} is not null)`,
    ),
  ],
);

export const fills = pgTable(
  'fills',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    marketId: text('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    executionId: text('execution_id').notNull().unique(),
    side: text('side').notNull(),
    baseQuantity: bigint('base_quantity', { mode: 'bigint' }).notNull(),
    quoteLamports: bigint('quote_lamports', { mode: 'bigint' }).notNull(),
    executionPrice: numeric('execution_price', { precision: 38, scale: 18 }).notNull(),
    feeLamports: bigint('fee_lamports', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    costBasisLamportsRemoved: bigint('cost_basis_lamports_removed', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    realizedPnlLamports: bigint('realized_pnl_lamports', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    idempotencyRecordId: text('idempotency_record_id')
      .notNull()
      .unique()
      .references(() => idempotencyRecords.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    index('fills_order_time_idx').on(table.orderId, table.executedAt),
    check('fills_side_valid', sql`${table.side} in ('BUY', 'SELL')`),
    check('fills_base_positive', sql`${table.baseQuantity} > 0`),
    check('fills_quote_positive', sql`${table.quoteLamports} > 0`),
    check('fills_price_positive', sql`${table.executionPrice} > 0`),
    check('fills_fee_nonnegative', sql`${table.feeLamports} >= 0`),
    check('fills_cost_removed_nonnegative', sql`${table.costBasisLamportsRemoved} >= 0`),
  ],
);

export const journalTransactions = pgTable(
  'journal_transactions',
  {
    id: text('id').primaryKey(),
    seasonAccountId: text('season_account_id')
      .notNull()
      .references(() => seasonAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    operationType: text('operation_type').notNull(),
    sourceEntityType: text('source_entity_type').notNull(),
    sourceEntityId: text('source_entity_id').notNull(),
    idempotencyRecordId: text('idempotency_record_id')
      .notNull()
      .unique()
      .references(() => idempotencyRecords.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt,
  },
  (table) => [
    index('journal_transactions_account_time_idx').on(table.seasonAccountId, table.createdAt),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    journalTransactionId: text('journal_transaction_id')
      .notNull()
      .references(() => journalTransactions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    seasonAccountId: text('season_account_id')
      .notNull()
      .references(() => seasonAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    accountCode: text('account_code').notNull(),
    direction: text('direction').notNull(),
    amountLamports: bigint('amount_lamports', { mode: 'bigint' }).notNull(),
    createdAt,
  },
  (table) => [
    index('ledger_entries_account_time_idx').on(table.seasonAccountId, table.createdAt),
    index('ledger_entries_journal_idx').on(table.journalTransactionId),
    check(
      'ledger_entries_account_code_valid',
      sql`${table.accountCode} in ('CASH', 'POSITION_COST', 'STARTING_CAPITAL', 'TOP_UP_CAPITAL', 'TRADING_PNL', 'TRADING_FEES')`,
    ),
    check('ledger_entries_direction_valid', sql`${table.direction} in ('DEBIT', 'CREDIT')`),
    check('ledger_entries_amount_positive', sql`${table.amountLamports} > 0`),
  ],
);
