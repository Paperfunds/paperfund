import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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

export const hourlyRounds = pgTable(
  'hourly_rounds',
  {
    id: text('id').primaryKey(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().unique(),
    endsAtExclusive: timestamp('ends_at_exclusive', { withTimezone: true }).notNull().unique(),
    state: text('state').notNull().default('SCHEDULED'),
    startingPaperSolLamports: bigint('starting_paper_sol_lamports', { mode: 'bigint' }).notNull(),
    maxUniqueTokens: integer('max_unique_tokens').notNull(),
    maxBuyRatioBps: integer('max_buy_ratio_bps').notNull(),
    rewardFinalizationGracePeriodSeconds: integer(
      'reward_finalization_grace_period_seconds',
    ).notNull(),
    rulesVersion: text('rules_version').notNull(),
    createdAt,
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'hourly_rounds_exact_window',
      sql`${table.startsAt} = date_trunc('hour', ${table.startsAt}) and ${table.endsAtExclusive} = ${table.startsAt} + interval '1 hour'`,
    ),
    check(
      'hourly_rounds_state_valid',
      sql`${table.state} in ('SCHEDULED', 'OPEN', 'CLOSING', 'SETTLING', 'FINALIZED', 'PAYING', 'PAID')`,
    ),
    check('hourly_rounds_starting_balance_positive', sql`${table.startingPaperSolLamports} > 0`),
    check('hourly_rounds_token_limit_positive', sql`${table.maxUniqueTokens} > 0`),
    check(
      'hourly_rounds_buy_ratio_valid',
      sql`${table.maxBuyRatioBps} > 0 and ${table.maxBuyRatioBps} <= 10000`,
    ),
    check(
      'hourly_rounds_grace_period_nonnegative',
      sql`${table.rewardFinalizationGracePeriodSeconds} >= 0`,
    ),
  ],
);

export const dailyCompetitions = pgTable(
  'daily_competitions',
  {
    id: text('id').primaryKey(),
    utcDate: date('utc_date').notNull().unique(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().unique(),
    endsAtExclusive: timestamp('ends_at_exclusive', { withTimezone: true }).notNull().unique(),
    state: text('state').notNull().default('OPEN'),
    createdAt,
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'daily_competitions_exact_utc_window',
      sql`${table.startsAt} = date_trunc('day', ${table.startsAt} at time zone 'UTC') at time zone 'UTC' and ${table.endsAtExclusive} = ${table.startsAt} + interval '1 day' and ${table.utcDate} = (${table.startsAt} at time zone 'UTC')::date`,
    ),
    check(
      'daily_competitions_state_valid',
      sql`${table.state} in ('OPEN', 'CLOSING', 'FINALIZING', 'FINALIZED', 'PAYING', 'PAID')`,
    ),
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

export const competitionAccounts = pgTable(
  'competition_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    hourlyRoundId: text('hourly_round_id')
      .notNull()
      .references(() => hourlyRounds.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    startingPaperSolLamports: bigint('starting_paper_sol_lamports', { mode: 'bigint' }).notNull(),
    paperSolBalanceLamports: bigint('paper_sol_balance_lamports', { mode: 'bigint' }).notNull(),
    realizedPnlLamports: bigint('realized_pnl_lamports', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    finalSettledBalanceLamports: bigint('final_settled_balance_lamports', { mode: 'bigint' }),
    hourlyPnlLamports: bigint('hourly_pnl_lamports', { mode: 'bigint' }),
    createdAt,
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    unique('competition_accounts_user_round_unique').on(table.userId, table.hourlyRoundId),
    index('competition_accounts_round_idx').on(table.hourlyRoundId),
    check(
      'competition_accounts_starting_balance_positive',
      sql`${table.startingPaperSolLamports} > 0`,
    ),
    check('competition_accounts_balance_nonnegative', sql`${table.paperSolBalanceLamports} >= 0`),
    check(
      'competition_accounts_finalization_consistent',
      sql`(${table.finalSettledBalanceLamports} is null and ${table.hourlyPnlLamports} is null and ${table.finalizedAt} is null) or (${table.finalSettledBalanceLamports} is not null and ${table.hourlyPnlLamports} = ${table.finalSettledBalanceLamports} - ${table.startingPaperSolLamports} and ${table.finalizedAt} is not null)`,
    ),
  ],
);

export const competitionTokenSlots = pgTable(
  'competition_token_slots',
  {
    id: text('id').primaryKey(),
    competitionAccountId: text('competition_account_id')
      .notNull()
      .references(() => competitionAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    firstSuccessfulBuyAt: timestamp('first_successful_buy_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('competition_token_slots_account_asset_unique').on(
      table.competitionAccountId,
      table.assetId,
    ),
    index('competition_token_slots_account_idx').on(table.competitionAccountId),
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
    competitionAccountId: text('competition_account_id').references(() => competitionAccounts.id, {
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
    competitionAccountId: text('competition_account_id')
      .notNull()
      .references(() => competitionAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    marketId: text('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    side: text('side').notNull(),
    requestedBaseUnits: bigint('requested_base_units', { mode: 'bigint' }),
    requestedQuoteLamports: bigint('requested_quote_lamports', { mode: 'bigint' }),
    executionContext: text('execution_context').notNull().default('NORMAL_USER'),
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
    index('orders_account_time_idx').on(table.competitionAccountId, table.requestedAt),
    check('orders_side_valid', sql`${table.side} in ('BUY', 'SELL')`),
    check(
      'orders_execution_context_valid',
      sql`${table.executionContext} in ('NORMAL_USER', 'FORCED_HOURLY_SETTLEMENT')`,
    ),
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
    competitionAccountId: text('competition_account_id')
      .notNull()
      .references(() => competitionAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
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
    unique('positions_account_market_unique').on(table.competitionAccountId, table.marketId),
    check('positions_quantity_nonnegative', sql`${table.remainingBaseUnits} >= 0`),
    check('positions_cost_nonnegative', sql`${table.costBasisLamports} >= 0`),
    check('positions_status_valid', sql`${table.status} in ('OPEN', 'CLOSED')`),
    check(
      'positions_state_consistent',
      sql`(${table.status} = 'OPEN' and ${table.remainingBaseUnits} > 0 and ${table.costBasisLamports} > 0 and ${table.closedAt} is null) or (${table.status} = 'CLOSED' and ${table.remainingBaseUnits} = 0 and ${table.costBasisLamports} = 0 and ${table.closedAt} is not null)`,
    ),
  ],
);

export const marketStateEvidence = pgTable(
  'market_state_evidence',
  {
    id: text('id').primaryKey(),
    protocolId: text('protocol_id').notNull(),
    marketId: text('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    chainSlot: bigint('chain_slot', { mode: 'bigint' }),
    chainBlockId: text('chain_block_id'),
    adapterVersion: text('adapter_version').notNull(),
    normalizationVersion: text('normalization_version').notNull(),
    normalizedState: jsonb('normalized_state').notNull(),
    rawSource: jsonb('raw_source'),
    stateFingerprint: text('state_fingerprint').notNull().unique(),
    createdAt,
  },
  (table) => [
    index('market_state_evidence_market_time_idx').on(table.marketId, table.observedAt),
    check('market_state_evidence_protocol_nonempty', sql`length(${table.protocolId}) > 0`),
    check('market_state_evidence_adapter_nonempty', sql`length(${table.adapterVersion}) > 0`),
    check(
      'market_state_evidence_normalization_nonempty',
      sql`length(${table.normalizationVersion}) > 0`,
    ),
  ],
);

export const orderMarketStateEvidence = pgTable(
  'order_market_state_evidence',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    evidenceId: text('evidence_id')
      .notNull()
      .references(() => marketStateEvidence.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    purpose: text('purpose').notNull(),
    positionId: text('position_id').references(() => positions.id, {
      onDelete: 'restrict',
      onUpdate: 'restrict',
    }),
    executableValueLamports: bigint('executable_value_lamports', { mode: 'bigint' }),
    createdAt,
  },
  (table) => [
    unique('order_market_state_evidence_usage_unique').on(
      table.orderId,
      table.evidenceId,
      table.purpose,
      table.positionId,
    ),
    index('order_market_state_evidence_order_idx').on(table.orderId),
    check(
      'order_market_state_evidence_purpose_valid',
      sql`${table.purpose} in ('BUY_EXECUTION', 'SELL_EXECUTION', 'POSITION_EXIT_VALUATION')`,
    ),
    check(
      'order_market_state_evidence_value_nonnegative',
      sql`${table.executableValueLamports} is null or ${table.executableValueLamports} >= 0`,
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
    actualInputLamports: bigint('actual_input_lamports', { mode: 'bigint' }),
    actualOutputLamports: bigint('actual_output_lamports', { mode: 'bigint' }),
    feeBreakdown: jsonb('fee_breakdown'),
    protocolId: text('protocol_id'),
    adapterVersion: text('adapter_version'),
    marketStateEvidenceId: text('market_state_evidence_id').references(
      () => marketStateEvidence.id,
      { onDelete: 'restrict', onUpdate: 'restrict' },
    ),
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
    check(
      'fills_actual_input_positive',
      sql`${table.actualInputLamports} is null or ${table.actualInputLamports} > 0`,
    ),
    check(
      'fills_actual_output_positive',
      sql`${table.actualOutputLamports} is null or ${table.actualOutputLamports} > 0`,
    ),
    check('fills_cost_removed_nonnegative', sql`${table.costBasisLamportsRemoved} >= 0`),
  ],
);

export const hourlyResults = pgTable(
  'hourly_results',
  {
    id: text('id').primaryKey(),
    hourlyRoundId: text('hourly_round_id')
      .notNull()
      .references(() => hourlyRounds.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    competitionAccountId: text('competition_account_id')
      .notNull()
      .unique()
      .references(() => competitionAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    finalSettledBalanceLamports: bigint('final_settled_balance_lamports', {
      mode: 'bigint',
    }).notNull(),
    startingPaperSolLamports: bigint('starting_paper_sol_lamports', { mode: 'bigint' }).notNull(),
    hourlyPnlLamports: bigint('hourly_pnl_lamports', { mode: 'bigint' }).notNull(),
    idempotencyRecordId: text('idempotency_record_id')
      .notNull()
      .unique()
      .references(() => idempotencyRecords.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('hourly_results_round_account_unique').on(
      table.hourlyRoundId,
      table.competitionAccountId,
    ),
    index('hourly_results_round_idx').on(table.hourlyRoundId),
    check(
      'hourly_results_pnl_exact',
      sql`${table.hourlyPnlLamports} = ${table.finalSettledBalanceLamports} - ${table.startingPaperSolLamports}`,
    ),
    check(
      'hourly_results_final_balance_nonnegative',
      sql`${table.finalSettledBalanceLamports} >= 0`,
    ),
  ],
);

export const dailyResults = pgTable(
  'daily_results',
  {
    id: text('id').primaryKey(),
    dailyCompetitionId: text('daily_competition_id')
      .notNull()
      .references(() => dailyCompetitions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    cumulativePnlLamports: bigint('cumulative_pnl_lamports', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    completedHourlyRoundCount: integer('completed_hourly_round_count').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique('daily_results_competition_user_unique').on(table.dailyCompetitionId, table.userId),
    check(
      'daily_results_completed_count_nonnegative',
      sql`${table.completedHourlyRoundCount} >= 0`,
    ),
  ],
);

export const dailyResultHourlyResults = pgTable(
  'daily_result_hourly_results',
  {
    id: text('id').primaryKey(),
    dailyResultId: text('daily_result_id')
      .notNull()
      .references(() => dailyResults.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    hourlyResultId: text('hourly_result_id')
      .notNull()
      .unique()
      .references(() => hourlyResults.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    idempotencyRecordId: text('idempotency_record_id')
      .notNull()
      .unique()
      .references(() => idempotencyRecords.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    contributedAt: timestamp('contributed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('daily_result_hourly_results_pair_unique').on(table.dailyResultId, table.hourlyResultId),
  ],
);

export const payoutPlans = pgTable(
  'payout_plans',
  {
    id: text('id').primaryKey(),
    competitionType: text('competition_type').notNull(),
    hourlyRoundId: text('hourly_round_id').references(() => hourlyRounds.id, {
      onDelete: 'restrict',
      onUpdate: 'restrict',
    }),
    dailyCompetitionId: text('daily_competition_id').references(() => dailyCompetitions.id, {
      onDelete: 'restrict',
      onUpdate: 'restrict',
    }),
    prizePoolLamports: bigint('prize_pool_lamports', { mode: 'bigint' }).notNull(),
    curveVersion: text('curve_version').notNull(),
    tiePolicyVersion: text('tie_policy_version').notNull(),
    participantCount: integer('participant_count').notNull(),
    nominalWinnerCount: integer('nominal_winner_count').notNull(),
    actualWinnerCount: integer('actual_winner_count').notNull(),
    state: text('state').notNull().default('CALCULATED'),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull(),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    configSnapshot: jsonb('config_snapshot').notNull(),
    sourceResultSnapshot: jsonb('source_result_snapshot').notNull(),
    totalAllocatedLamports: bigint('total_allocated_lamports', { mode: 'bigint' }).notNull(),
    conservationHolds: boolean('conservation_holds').notNull(),
    createdAt,
  },
  (table) => [
    unique('payout_plans_hour_curve_unique').on(table.hourlyRoundId, table.curveVersion),
    unique('payout_plans_daily_curve_unique').on(table.dailyCompetitionId, table.curveVersion),
    index('payout_plans_state_idx').on(table.state, table.calculatedAt),
    check('payout_plans_type_valid', sql`${table.competitionType} in ('HOURLY','DAILY')`),
    check(
      'payout_plans_source_exact',
      sql`(${table.competitionType} = 'HOURLY' and ${table.hourlyRoundId} is not null and ${table.dailyCompetitionId} is null) or (${table.competitionType} = 'DAILY' and ${table.hourlyRoundId} is null and ${table.dailyCompetitionId} is not null)`,
    ),
    check(
      'payout_plans_state_valid',
      sql`${table.state} in ('CALCULATED','FROZEN','VALIDATED','APPROVED')`,
    ),
    check(
      'payout_plans_counts_valid',
      sql`${table.participantCount} >= 0 and ${table.nominalWinnerCount} > 0 and ${table.actualWinnerCount} >= 0`,
    ),
    check(
      'payout_plans_amounts_valid',
      sql`${table.prizePoolLamports} >= 0 and ${table.totalAllocatedLamports} >= 0`,
    ),
    check(
      'payout_plans_conservation_exact',
      sql`${table.conservationHolds} and ${table.prizePoolLamports} = ${table.totalAllocatedLamports}`,
    ),
  ],
);

export const payoutRankBuckets = pgTable(
  'payout_rank_buckets',
  {
    id: text('id').primaryKey(),
    payoutPlanId: text('payout_plan_id')
      .notNull()
      .references(() => payoutPlans.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    ordinal: integer('ordinal').notNull(),
    weightPpm: bigint('weight_ppm', { mode: 'bigint' }).notNull(),
    floorAllocationLamports: bigint('floor_allocation_lamports', { mode: 'bigint' }).notNull(),
    remainderBasis: bigint('remainder_basis', { mode: 'bigint' }).notNull(),
    finalAllocationLamports: bigint('final_allocation_lamports', { mode: 'bigint' }).notNull(),
    createdAt,
  },
  (table) => [
    unique('payout_rank_buckets_plan_ordinal_unique').on(table.payoutPlanId, table.ordinal),
    check('payout_rank_buckets_ordinal_positive', sql`${table.ordinal} > 0`),
    check(
      'payout_rank_buckets_values_nonnegative',
      sql`${table.weightPpm} >= 0 and ${table.floorAllocationLamports} >= 0 and ${table.remainderBasis} >= 0 and ${table.finalAllocationLamports} >= 0`,
    ),
  ],
);

export const payoutAllocations = pgTable(
  'payout_allocations',
  {
    id: text('id').primaryKey(),
    payoutPlanId: text('payout_plan_id')
      .notNull()
      .references(() => payoutPlans.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    competitiveRank: integer('competitive_rank').notNull(),
    tieGroupSize: integer('tie_group_size').notNull(),
    ordinalStart: integer('ordinal_start').notNull(),
    ordinalEnd: integer('ordinal_end').notNull(),
    fundedOrdinalCount: integer('funded_ordinal_count').notNull(),
    allocatedLamports: bigint('allocated_lamports', { mode: 'bigint' }).notNull(),
    dustAdjustmentLamports: bigint('dust_adjustment_lamports', { mode: 'bigint' }).notNull(),
    allocationExplanation: jsonb('allocation_explanation').notNull(),
    createdAt,
  },
  (table) => [
    unique('payout_allocations_plan_user_unique').on(table.payoutPlanId, table.userId),
    index('payout_allocations_user_idx').on(table.userId, table.createdAt),
    check(
      'payout_allocations_rank_valid',
      sql`${table.competitiveRank} > 0 and ${table.tieGroupSize} > 0 and ${table.ordinalStart} > 0 and ${table.ordinalEnd} >= ${table.ordinalStart} and ${table.fundedOrdinalCount} > 0`,
    ),
    check(
      'payout_allocations_amount_valid',
      sql`${table.allocatedLamports} >= 0 and ${table.dustAdjustmentLamports} >= 0 and ${table.dustAdjustmentLamports} <= 1`,
    ),
  ],
);

export const journalTransactions = pgTable(
  'journal_transactions',
  {
    id: text('id').primaryKey(),
    competitionAccountId: text('competition_account_id')
      .notNull()
      .references(() => competitionAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
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
    index('journal_transactions_account_time_idx').on(table.competitionAccountId, table.createdAt),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    journalTransactionId: text('journal_transaction_id')
      .notNull()
      .references(() => journalTransactions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    competitionAccountId: text('competition_account_id')
      .notNull()
      .references(() => competitionAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    accountCode: text('account_code').notNull(),
    direction: text('direction').notNull(),
    amountLamports: bigint('amount_lamports', { mode: 'bigint' }).notNull(),
    createdAt,
  },
  (table) => [
    index('ledger_entries_account_time_idx').on(table.competitionAccountId, table.createdAt),
    index('ledger_entries_journal_idx').on(table.journalTransactionId),
    check(
      'ledger_entries_account_code_valid',
      sql`${table.accountCode} in ('CASH', 'POSITION_COST', 'HOURLY_STARTING_CAPITAL', 'TRADING_PNL', 'TRADING_FEES')`,
    ),
    check('ledger_entries_direction_valid', sql`${table.direction} in ('DEBIT', 'CREDIT')`),
    check('ledger_entries_amount_positive', sql`${table.amountLamports} > 0`),
  ],
);
