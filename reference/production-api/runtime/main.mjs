var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// apps/api/src/main.ts
import { parseApplicationEnvironment } from "./packages/config/dist/index.js";

// packages/db/src/database.ts
import { sql as sql2 } from "./node_modules/drizzle-orm/index.cjs";
import { drizzle } from "./node_modules/drizzle-orm/node-postgres/index.cjs";
import { Pool } from "./node_modules/pg/esm/index.mjs";

// packages/db/src/schema.ts
var schema_exports = {};
__export(schema_exports, {
  appMeta: () => appMeta,
  assets: () => assets,
  chartFillFxCaptureFailures: () => chartFillFxCaptureFailures,
  chartFillFxEvidence: () => chartFillFxEvidence,
  competitionAccounts: () => competitionAccounts,
  competitionTokenSlots: () => competitionTokenSlots,
  dailyCompetitions: () => dailyCompetitions,
  dailyResultHourlyResults: () => dailyResultHourlyResults,
  dailyResults: () => dailyResults,
  fills: () => fills,
  hourlyResults: () => hourlyResults,
  hourlyRounds: () => hourlyRounds,
  idempotencyRecords: () => idempotencyRecords,
  journalTransactions: () => journalTransactions,
  ledgerEntries: () => ledgerEntries,
  marketStateEvidence: () => marketStateEvidence,
  markets: () => markets,
  orderMarketStateEvidence: () => orderMarketStateEvidence,
  orders: () => orders,
  payoutAllocations: () => payoutAllocations,
  payoutApprovalAuthorizations: () => payoutApprovalAuthorizations,
  payoutApprovalSnapshots: () => payoutApprovalSnapshots,
  payoutAuthorityNonces: () => payoutAuthorityNonces,
  payoutBatchAllocations: () => payoutBatchAllocations,
  payoutBatches: () => payoutBatches,
  payoutBroadcastAttempts: () => payoutBroadcastAttempts,
  payoutExecutions: () => payoutExecutions,
  payoutOperationEvents: () => payoutOperationEvents,
  payoutPlanApprovals: () => payoutPlanApprovals,
  payoutPlans: () => payoutPlans,
  payoutRankBuckets: () => payoutRankBuckets,
  payoutSecurityEvents: () => payoutSecurityEvents,
  payoutSignedTransactions: () => payoutSignedTransactions,
  payoutStopState: () => payoutStopState,
  payoutTreasuryDays: () => payoutTreasuryDays,
  payoutTreasuryReceipts: () => payoutTreasuryReceipts,
  payoutTreasuryReservations: () => payoutTreasuryReservations,
  payoutTreasurySettlements: () => payoutTreasurySettlements,
  positions: () => positions,
  settlementWriteoffMetadataRepairs: () => settlementWriteoffMetadataRepairs,
  users: () => users
});
import { sql } from "./node_modules/drizzle-orm/index.cjs";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique
} from "./node_modules/drizzle-orm/pg-core/index.cjs";
var createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
var updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
var settlementWriteoffMetadataRepairs = pgTable(
  "settlement_writeoff_metadata_repairs",
  {
    journalTransactionId: text("journal_transaction_id").primaryKey().references(() => journalTransactions.id, { onDelete: "restrict", onUpdate: "restrict" }),
    tokenQuantity: numeric("token_quantity", { precision: 38, scale: 0 }).notNull(),
    costBasisLamports: bigint("cost_basis_lamports", { mode: "bigint" }).notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt
  },
  (table) => [
    check("settlement_writeoff_metadata_repairs_quantity", sql`${table.tokenQuantity} > 0`),
    check("settlement_writeoff_metadata_repairs_cost", sql`${table.costBasisLamports} >= 0`)
  ]
);
var appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt,
  updatedAt
});
var users = pgTable("users", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  createdAt
});
var hourlyRounds = pgTable(
  "hourly_rounds",
  {
    id: text("id").primaryKey(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().unique(),
    endsAtExclusive: timestamp("ends_at_exclusive", { withTimezone: true }).notNull().unique(),
    state: text("state").notNull().default("SCHEDULED"),
    startingPaperSolLamports: bigint("starting_paper_sol_lamports", { mode: "bigint" }).notNull(),
    maxUniqueTokens: integer("max_unique_tokens").notNull(),
    maxBuyRatioBps: integer("max_buy_ratio_bps").notNull(),
    rewardFinalizationGracePeriodSeconds: integer(
      "reward_finalization_grace_period_seconds"
    ).notNull(),
    rulesVersion: text("rules_version").notNull(),
    createdAt,
    finalizedAt: timestamp("finalized_at", { withTimezone: true })
  },
  (table) => [
    check(
      "hourly_rounds_exact_window",
      sql`${table.startsAt} = date_trunc('hour', ${table.startsAt}) and ${table.endsAtExclusive} = ${table.startsAt} + interval '1 hour'`
    ),
    check(
      "hourly_rounds_state_valid",
      sql`${table.state} in ('SCHEDULED', 'OPEN', 'CLOSING', 'SETTLING', 'FINALIZED', 'PAYING', 'PAID')`
    ),
    check("hourly_rounds_starting_balance_positive", sql`${table.startingPaperSolLamports} > 0`),
    check("hourly_rounds_token_limit_positive", sql`${table.maxUniqueTokens} > 0`),
    check(
      "hourly_rounds_buy_ratio_valid",
      sql`${table.maxBuyRatioBps} > 0 and ${table.maxBuyRatioBps} <= 10000`
    ),
    check(
      "hourly_rounds_grace_period_nonnegative",
      sql`${table.rewardFinalizationGracePeriodSeconds} >= 0`
    )
  ]
);
var dailyCompetitions = pgTable(
  "daily_competitions",
  {
    id: text("id").primaryKey(),
    utcDate: date("utc_date").notNull().unique(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().unique(),
    endsAtExclusive: timestamp("ends_at_exclusive", { withTimezone: true }).notNull().unique(),
    state: text("state").notNull().default("OPEN"),
    createdAt,
    finalizedAt: timestamp("finalized_at", { withTimezone: true })
  },
  (table) => [
    check(
      "daily_competitions_exact_utc_window",
      sql`${table.startsAt} = date_trunc('day', ${table.startsAt} at time zone 'UTC') at time zone 'UTC' and ${table.endsAtExclusive} = ${table.startsAt} + interval '1 day' and ${table.utcDate} = (${table.startsAt} at time zone 'UTC')::date`
    ),
    check(
      "daily_competitions_state_valid",
      sql`${table.state} in ('OPEN', 'CLOSING', 'FINALIZING', 'FINALIZED', 'PAYING', 'PAID')`
    )
  ]
);
var assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    mintAddress: text("mint_address").notNull().unique(),
    symbol: text("symbol"),
    name: text("name"),
    decimals: integer("decimals").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt
  },
  (table) => [check("assets_decimals_valid", sql`${table.decimals} between 0 and 255`)]
);
var markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey(),
    baseAssetId: text("base_asset_id").notNull().references(() => assets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    quoteAssetId: text("quote_asset_id").notNull().references(() => assets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    venue: text("venue").notNull(),
    providerMarketId: text("provider_market_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt
  },
  (table) => [
    unique("markets_venue_provider_unique").on(table.venue, table.providerMarketId),
    check("markets_distinct_assets", sql`${table.baseAssetId} <> ${table.quoteAssetId}`)
  ]
);
var competitionAccounts = pgTable(
  "competition_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "restrict" }),
    hourlyRoundId: text("hourly_round_id").notNull().references(() => hourlyRounds.id, { onDelete: "restrict", onUpdate: "restrict" }),
    startingPaperSolLamports: bigint("starting_paper_sol_lamports", { mode: "bigint" }).notNull(),
    paperSolBalanceLamports: bigint("paper_sol_balance_lamports", { mode: "bigint" }).notNull(),
    realizedPnlLamports: bigint("realized_pnl_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    finalSettledBalanceLamports: bigint("final_settled_balance_lamports", { mode: "bigint" }),
    hourlyPnlLamports: bigint("hourly_pnl_lamports", { mode: "bigint" }),
    createdAt,
    finalizedAt: timestamp("finalized_at", { withTimezone: true })
  },
  (table) => [
    unique("competition_accounts_user_round_unique").on(table.userId, table.hourlyRoundId),
    index("competition_accounts_round_idx").on(table.hourlyRoundId),
    check(
      "competition_accounts_starting_balance_positive",
      sql`${table.startingPaperSolLamports} > 0`
    ),
    check("competition_accounts_balance_nonnegative", sql`${table.paperSolBalanceLamports} >= 0`),
    check(
      "competition_accounts_finalization_consistent",
      sql`(${table.finalSettledBalanceLamports} is null and ${table.hourlyPnlLamports} is null and ${table.finalizedAt} is null) or (${table.finalSettledBalanceLamports} is not null and ${table.hourlyPnlLamports} = ${table.finalSettledBalanceLamports} - ${table.startingPaperSolLamports} and ${table.finalizedAt} is not null)`
    )
  ]
);
var competitionTokenSlots = pgTable(
  "competition_token_slots",
  {
    id: text("id").primaryKey(),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    firstSuccessfulBuyAt: timestamp("first_successful_buy_at", { withTimezone: true }).notNull()
  },
  (table) => [
    unique("competition_token_slots_account_asset_unique").on(
      table.competitionAccountId,
      table.assetId
    ),
    index("competition_token_slots_account_idx").on(table.competitionAccountId)
  ]
);
var idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: text("id").primaryKey(),
    operationClass: text("operation_class").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("PENDING"),
    competitionAccountId: text("competition_account_id").references(() => competitionAccounts.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    resultEntityType: text("result_entity_type"),
    resultEntityId: text("result_entity_id"),
    createdAt,
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    unique("idempotency_operation_key_unique").on(table.operationClass, table.idempotencyKey),
    check("idempotency_status_valid", sql`${table.status} in ('PENDING', 'COMPLETED', 'FAILED')`),
    check(
      "idempotency_completion_consistent",
      sql`(${table.status} = 'PENDING' and ${table.completedAt} is null) or (${table.status} <> 'PENDING' and ${table.completedAt} is not null)`
    )
  ]
);
var orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    marketId: text("market_id").notNull().references(() => markets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    side: text("side").notNull(),
    requestedBaseUnits: bigint("requested_base_units", { mode: "bigint" }),
    requestedQuoteLamports: bigint("requested_quote_lamports", { mode: "bigint" }),
    executionContext: text("execution_context").notNull().default("NORMAL_USER"),
    status: text("status").notNull().default("PENDING"),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    updatedAt,
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason")
  },
  (table) => [
    index("orders_account_time_idx").on(table.competitionAccountId, table.requestedAt),
    check("orders_side_valid", sql`${table.side} in ('BUY', 'SELL')`),
    check(
      "orders_execution_context_valid",
      sql`${table.executionContext} in ('NORMAL_USER', 'FORCED_HOURLY_SETTLEMENT')`
    ),
    check(
      "orders_status_valid",
      sql`${table.status} in ('PENDING', 'PARTIALLY_FILLED', 'COMPLETED', 'REJECTED', 'CANCELLED')`
    ),
    check(
      "orders_request_valid",
      sql`(${table.side} = 'BUY' and ${table.requestedQuoteLamports} > 0 and ${table.requestedBaseUnits} is null) or (${table.side} = 'SELL' and ${table.requestedBaseUnits} > 0 and ${table.requestedQuoteLamports} is null)`
    )
  ]
);
var positions = pgTable(
  "positions",
  {
    id: text("id").primaryKey(),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    marketId: text("market_id").notNull().references(() => markets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    remainingBaseUnits: bigint("remaining_base_units", { mode: "bigint" }).notNull().default(sql`0`),
    costBasisLamports: bigint("cost_basis_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    realizedPnlLamports: bigint("realized_pnl_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    status: text("status").notNull().default("OPEN"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    updatedAt,
    closedAt: timestamp("closed_at", { withTimezone: true })
  },
  (table) => [
    unique("positions_account_market_unique").on(table.competitionAccountId, table.marketId),
    check("positions_quantity_nonnegative", sql`${table.remainingBaseUnits} >= 0`),
    check("positions_cost_nonnegative", sql`${table.costBasisLamports} >= 0`),
    check("positions_status_valid", sql`${table.status} in ('OPEN', 'CLOSED')`),
    check(
      "positions_state_consistent",
      sql`(${table.status} = 'OPEN' and ${table.remainingBaseUnits} > 0 and ${table.costBasisLamports} > 0 and ${table.closedAt} is null) or (${table.status} = 'CLOSED' and ${table.remainingBaseUnits} = 0 and ${table.costBasisLamports} = 0 and ${table.closedAt} is not null)`
    )
  ]
);
var marketStateEvidence = pgTable(
  "market_state_evidence",
  {
    id: text("id").primaryKey(),
    protocolId: text("protocol_id").notNull(),
    marketId: text("market_id").notNull().references(() => markets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    chainSlot: bigint("chain_slot", { mode: "bigint" }),
    chainBlockId: text("chain_block_id"),
    adapterVersion: text("adapter_version").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    normalizedState: jsonb("normalized_state").notNull(),
    rawSource: jsonb("raw_source"),
    stateFingerprint: text("state_fingerprint").notNull().unique(),
    createdAt
  },
  (table) => [
    index("market_state_evidence_market_time_idx").on(table.marketId, table.observedAt),
    check("market_state_evidence_protocol_nonempty", sql`length(${table.protocolId}) > 0`),
    check("market_state_evidence_adapter_nonempty", sql`length(${table.adapterVersion}) > 0`),
    check(
      "market_state_evidence_normalization_nonempty",
      sql`length(${table.normalizationVersion}) > 0`
    )
  ]
);
var orderMarketStateEvidence = pgTable(
  "order_market_state_evidence",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict", onUpdate: "restrict" }),
    evidenceId: text("evidence_id").notNull().references(() => marketStateEvidence.id, { onDelete: "restrict", onUpdate: "restrict" }),
    purpose: text("purpose").notNull(),
    positionId: text("position_id").references(() => positions.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    executableValueLamports: bigint("executable_value_lamports", { mode: "bigint" }),
    createdAt
  },
  (table) => [
    unique("order_market_state_evidence_usage_unique").on(
      table.orderId,
      table.evidenceId,
      table.purpose,
      table.positionId
    ),
    index("order_market_state_evidence_order_idx").on(table.orderId),
    check(
      "order_market_state_evidence_purpose_valid",
      sql`${table.purpose} in ('BUY_EXECUTION', 'SELL_EXECUTION', 'POSITION_EXIT_VALUATION')`
    ),
    check(
      "order_market_state_evidence_value_nonnegative",
      sql`${table.executableValueLamports} is null or ${table.executableValueLamports} >= 0`
    )
  ]
);
var fills = pgTable(
  "fills",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict", onUpdate: "restrict" }),
    marketId: text("market_id").notNull().references(() => markets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    executionId: text("execution_id").notNull().unique(),
    side: text("side").notNull(),
    baseQuantity: bigint("base_quantity", { mode: "bigint" }).notNull(),
    quoteLamports: bigint("quote_lamports", { mode: "bigint" }).notNull(),
    executionPrice: numeric("execution_price", { precision: 38, scale: 18 }).notNull(),
    feeLamports: bigint("fee_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    actualInputLamports: bigint("actual_input_lamports", { mode: "bigint" }),
    actualOutputLamports: bigint("actual_output_lamports", { mode: "bigint" }),
    feeBreakdown: jsonb("fee_breakdown"),
    protocolId: text("protocol_id"),
    adapterVersion: text("adapter_version"),
    marketStateEvidenceId: text("market_state_evidence_id").references(
      () => marketStateEvidence.id,
      { onDelete: "restrict", onUpdate: "restrict" }
    ),
    costBasisLamportsRemoved: bigint("cost_basis_lamports_removed", { mode: "bigint" }).notNull().default(sql`0`),
    realizedPnlLamports: bigint("realized_pnl_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    createdAt
  },
  (table) => [
    index("fills_order_time_idx").on(table.orderId, table.executedAt),
    check("fills_side_valid", sql`${table.side} in ('BUY', 'SELL')`),
    check("fills_base_positive", sql`${table.baseQuantity} > 0`),
    check("fills_quote_positive", sql`${table.quoteLamports} > 0`),
    check("fills_price_positive", sql`${table.executionPrice} > 0`),
    check("fills_fee_nonnegative", sql`${table.feeLamports} >= 0`),
    check(
      "fills_actual_input_positive",
      sql`${table.actualInputLamports} is null or ${table.actualInputLamports} > 0`
    ),
    check(
      "fills_actual_output_positive",
      sql`${table.actualOutputLamports} is null or ${table.actualOutputLamports} > 0`
    ),
    check("fills_cost_removed_nonnegative", sql`${table.costBasisLamportsRemoved} >= 0`)
  ]
);
var hourlyResults = pgTable(
  "hourly_results",
  {
    id: text("id").primaryKey(),
    hourlyRoundId: text("hourly_round_id").notNull().references(() => hourlyRounds.id, { onDelete: "restrict", onUpdate: "restrict" }),
    competitionAccountId: text("competition_account_id").notNull().unique().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "restrict" }),
    finalSettledBalanceLamports: bigint("final_settled_balance_lamports", {
      mode: "bigint"
    }).notNull(),
    startingPaperSolLamports: bigint("starting_paper_sol_lamports", { mode: "bigint" }).notNull(),
    hourlyPnlLamports: bigint("hourly_pnl_lamports", { mode: "bigint" }).notNull(),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull()
  },
  (table) => [
    unique("hourly_results_round_account_unique").on(
      table.hourlyRoundId,
      table.competitionAccountId
    ),
    index("hourly_results_round_idx").on(table.hourlyRoundId),
    check(
      "hourly_results_pnl_exact",
      sql`${table.hourlyPnlLamports} = ${table.finalSettledBalanceLamports} - ${table.startingPaperSolLamports}`
    ),
    check(
      "hourly_results_final_balance_nonnegative",
      sql`${table.finalSettledBalanceLamports} >= 0`
    )
  ]
);
var dailyResults = pgTable(
  "daily_results",
  {
    id: text("id").primaryKey(),
    dailyCompetitionId: text("daily_competition_id").notNull().references(() => dailyCompetitions.id, { onDelete: "restrict", onUpdate: "restrict" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "restrict" }),
    cumulativePnlLamports: bigint("cumulative_pnl_lamports", { mode: "bigint" }).notNull().default(sql`0`),
    completedHourlyRoundCount: integer("completed_hourly_round_count").notNull().default(0),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("daily_results_competition_user_unique").on(table.dailyCompetitionId, table.userId),
    check(
      "daily_results_completed_count_nonnegative",
      sql`${table.completedHourlyRoundCount} >= 0`
    )
  ]
);
var dailyResultHourlyResults = pgTable(
  "daily_result_hourly_results",
  {
    id: text("id").primaryKey(),
    dailyResultId: text("daily_result_id").notNull().references(() => dailyResults.id, { onDelete: "restrict", onUpdate: "restrict" }),
    hourlyResultId: text("hourly_result_id").notNull().unique().references(() => hourlyResults.id, { onDelete: "restrict", onUpdate: "restrict" }),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contributedAt: timestamp("contributed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("daily_result_hourly_results_pair_unique").on(table.dailyResultId, table.hourlyResultId)
  ]
);
var payoutPlans = pgTable(
  "payout_plans",
  {
    id: text("id").primaryKey(),
    competitionType: text("competition_type").notNull(),
    hourlyRoundId: text("hourly_round_id").references(() => hourlyRounds.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    dailyCompetitionId: text("daily_competition_id").references(() => dailyCompetitions.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    prizePoolLamports: bigint("prize_pool_lamports", { mode: "bigint" }).notNull(),
    curveVersion: text("curve_version").notNull(),
    tiePolicyVersion: text("tie_policy_version").notNull(),
    participantCount: integer("participant_count").notNull(),
    nominalWinnerCount: integer("nominal_winner_count").notNull(),
    actualWinnerCount: integer("actual_winner_count").notNull(),
    state: text("state").notNull().default("CALCULATED"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    configSnapshot: jsonb("config_snapshot").notNull(),
    sourceResultSnapshot: jsonb("source_result_snapshot").notNull(),
    totalAllocatedLamports: bigint("total_allocated_lamports", { mode: "bigint" }).notNull(),
    conservationHolds: boolean("conservation_holds").notNull(),
    createdAt
  },
  (table) => [
    unique("payout_plans_hour_curve_unique").on(table.hourlyRoundId, table.curveVersion),
    unique("payout_plans_daily_curve_unique").on(table.dailyCompetitionId, table.curveVersion),
    index("payout_plans_state_idx").on(table.state, table.calculatedAt),
    check("payout_plans_type_valid", sql`${table.competitionType} in ('HOURLY','DAILY')`),
    check(
      "payout_plans_source_exact",
      sql`(${table.competitionType} = 'HOURLY' and ${table.hourlyRoundId} is not null and ${table.dailyCompetitionId} is null) or (${table.competitionType} = 'DAILY' and ${table.hourlyRoundId} is null and ${table.dailyCompetitionId} is not null)`
    ),
    check(
      "payout_plans_state_valid",
      sql`${table.state} in ('CALCULATED','FROZEN','VALIDATED','APPROVED','SIGNED','BROADCAST','VERIFIED','FAILED_RETRYABLE','FAILED_FINAL','RECONCILIATION_REQUIRED')`
    ),
    check(
      "payout_plans_counts_valid",
      sql`${table.participantCount} >= 0 and ${table.nominalWinnerCount} > 0 and ${table.actualWinnerCount} >= 0`
    ),
    check(
      "payout_plans_amounts_valid",
      sql`${table.prizePoolLamports} >= 0 and ${table.totalAllocatedLamports} >= 0`
    ),
    check(
      "payout_plans_conservation_exact",
      sql`${table.conservationHolds} and ${table.prizePoolLamports} = ${table.totalAllocatedLamports}`
    )
  ]
);
var payoutRankBuckets = pgTable(
  "payout_rank_buckets",
  {
    id: text("id").primaryKey(),
    payoutPlanId: text("payout_plan_id").notNull().references(() => payoutPlans.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    weightPpm: bigint("weight_ppm", { mode: "bigint" }).notNull(),
    floorAllocationLamports: bigint("floor_allocation_lamports", { mode: "bigint" }).notNull(),
    remainderBasis: bigint("remainder_basis", { mode: "bigint" }).notNull(),
    finalAllocationLamports: bigint("final_allocation_lamports", { mode: "bigint" }).notNull(),
    createdAt
  },
  (table) => [
    unique("payout_rank_buckets_plan_ordinal_unique").on(table.payoutPlanId, table.ordinal),
    check("payout_rank_buckets_ordinal_positive", sql`${table.ordinal} > 0`),
    check(
      "payout_rank_buckets_values_nonnegative",
      sql`${table.weightPpm} >= 0 and ${table.floorAllocationLamports} >= 0 and ${table.remainderBasis} >= 0 and ${table.finalAllocationLamports} >= 0`
    )
  ]
);
var payoutAllocations = pgTable(
  "payout_allocations",
  {
    id: text("id").primaryKey(),
    payoutPlanId: text("payout_plan_id").notNull().references(() => payoutPlans.id, { onDelete: "restrict", onUpdate: "restrict" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "restrict" }),
    competitiveRank: integer("competitive_rank").notNull(),
    tieGroupSize: integer("tie_group_size").notNull(),
    ordinalStart: integer("ordinal_start").notNull(),
    ordinalEnd: integer("ordinal_end").notNull(),
    fundedOrdinalCount: integer("funded_ordinal_count").notNull(),
    allocatedLamports: bigint("allocated_lamports", { mode: "bigint" }).notNull(),
    dustAdjustmentLamports: bigint("dust_adjustment_lamports", { mode: "bigint" }).notNull(),
    allocationExplanation: jsonb("allocation_explanation").notNull(),
    createdAt
  },
  (table) => [
    unique("payout_allocations_plan_user_unique").on(table.payoutPlanId, table.userId),
    index("payout_allocations_user_idx").on(table.userId, table.createdAt),
    check(
      "payout_allocations_rank_valid",
      sql`${table.competitiveRank} > 0 and ${table.tieGroupSize} > 0 and ${table.ordinalStart} > 0 and ${table.ordinalEnd} >= ${table.ordinalStart} and ${table.fundedOrdinalCount} > 0`
    ),
    check(
      "payout_allocations_amount_valid",
      sql`${table.allocatedLamports} >= 0 and ${table.dustAdjustmentLamports} >= 0 and ${table.dustAdjustmentLamports} <= 1`
    )
  ]
);
var payoutPlanApprovals = pgTable("payout_plan_approvals", {
  id: text("id").primaryKey(),
  payoutPlanId: text("payout_plan_id").notNull().unique().references(() => payoutPlans.id),
  approvalMethod: text("approval_method").notNull(),
  approverIdentifier: text("approver_identifier").notNull(),
  planSnapshotHash: text("plan_snapshot_hash").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
  createdAt
});
var payoutExecutions = pgTable("payout_executions", {
  id: text("id").primaryKey(),
  payoutPlanId: text("payout_plan_id").notNull().unique().references(() => payoutPlans.id),
  network: text("network").notNull(),
  treasuryAddress: text("treasury_address").notNull(),
  signerType: text("signer_type").notNull(),
  safetyVersion: text("safety_version"),
  state: text("state").notNull(),
  totalPayoutLamports: bigint("total_payout_lamports", { mode: "bigint" }).notNull(),
  estimatedFeeLamports: bigint("estimated_fee_lamports", { mode: "bigint" }).notNull(),
  preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
  lastBroadcastAt: timestamp("last_broadcast_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  failureCode: text("failure_code"),
  failureDetail: text("failure_detail"),
  createdAt,
  updatedAt
});
var payoutBatches = pgTable(
  "payout_batches",
  {
    id: text("id").primaryKey(),
    payoutExecutionId: text("payout_execution_id").notNull().references(() => payoutExecutions.id),
    batchIndex: integer("batch_index").notNull(),
    intentVersion: text("intent_version").notNull(),
    intentHash: text("intent_hash").notNull().unique(),
    state: text("state").notNull(),
    recipientCount: integer("recipient_count").notNull(),
    totalLamports: bigint("total_lamports", { mode: "bigint" }).notNull(),
    feeLamports: bigint("fee_lamports", { mode: "bigint" }).notNull(),
    recentBlockhash: text("recent_blockhash").notNull(),
    lastValidBlockHeight: bigint("last_valid_block_height", { mode: "bigint" }).notNull(),
    unsignedTransactionBase64: text("unsigned_transaction_base64").notNull(),
    signedTransactionBase64: text("signed_transaction_base64"),
    transactionSignature: text("transaction_signature").unique(),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
    lastBroadcastAt: timestamp("last_broadcast_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    confirmationSlot: bigint("confirmation_slot", { mode: "bigint" }),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("payout_batches_execution_index_unique").on(table.payoutExecutionId, table.batchIndex)
  ]
);
var payoutBatchAllocations = pgTable(
  "payout_batch_allocations",
  {
    payoutBatchId: text("payout_batch_id").notNull().references(() => payoutBatches.id),
    payoutAllocationId: text("payout_allocation_id").notNull().unique().references(() => payoutAllocations.id),
    ordinal: integer("ordinal").notNull(),
    destinationAddress: text("destination_address").notNull(),
    lamports: bigint("lamports", { mode: "bigint" }).notNull(),
    createdAt
  },
  (table) => [
    unique("payout_batch_allocations_ordinal_unique").on(table.payoutBatchId, table.ordinal)
  ]
);
var payoutBroadcastAttempts = pgTable(
  "payout_broadcast_attempts",
  {
    id: text("id").primaryKey(),
    payoutBatchId: text("payout_batch_id").notNull().references(() => payoutBatches.id),
    attemptNumber: integer("attempt_number").notNull(),
    transactionSignature: text("transaction_signature").notNull(),
    outcome: text("outcome").notNull(),
    rpcDetail: text("rpc_detail"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    createdAt
  },
  (table) => [
    unique("payout_broadcast_attempts_batch_number_unique").on(
      table.payoutBatchId,
      table.attemptNumber
    )
  ]
);
var journalTransactions = pgTable(
  "journal_transactions",
  {
    id: text("id").primaryKey(),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    operationType: text("operation_type").notNull(),
    sourceEntityType: text("source_entity_type").notNull(),
    sourceEntityId: text("source_entity_id").notNull(),
    idempotencyRecordId: text("idempotency_record_id").notNull().unique().references(() => idempotencyRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt
  },
  (table) => [
    index("journal_transactions_account_time_idx").on(table.competitionAccountId, table.createdAt)
  ]
);
var ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    journalTransactionId: text("journal_transaction_id").notNull().references(() => journalTransactions.id, { onDelete: "restrict", onUpdate: "restrict" }),
    competitionAccountId: text("competition_account_id").notNull().references(() => competitionAccounts.id, { onDelete: "restrict", onUpdate: "restrict" }),
    accountCode: text("account_code").notNull(),
    direction: text("direction").notNull(),
    amountLamports: bigint("amount_lamports", { mode: "bigint" }).notNull(),
    createdAt
  },
  (table) => [
    index("ledger_entries_account_time_idx").on(table.competitionAccountId, table.createdAt),
    index("ledger_entries_journal_idx").on(table.journalTransactionId),
    check(
      "ledger_entries_account_code_valid",
      sql`${table.accountCode} in ('CASH', 'POSITION_COST', 'HOURLY_STARTING_CAPITAL', 'TRADING_PNL', 'TRADING_FEES')`
    ),
    check("ledger_entries_direction_valid", sql`${table.direction} in ('DEBIT', 'CREDIT')`),
    check("ledger_entries_amount_positive", sql`${table.amountLamports} > 0`)
  ]
);
var chartFillFxEvidence = pgTable(
  "chart_fill_fx_evidence",
  {
    fillId: text("fill_id").notNull().references(() => fills.id, { onDelete: "restrict", onUpdate: "restrict" }),
    version: text("version").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    fxAt: timestamp("fx_at", { withTimezone: true }).notNull(),
    rate: numeric("rate", { precision: 38, scale: 18 }).notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt
  },
  (table) => [
    primaryKey({ columns: [table.fillId, table.version] }),
    check("chart_fill_fx_rate_positive", sql`${table.rate} > 0`)
  ]
);
var chartFillFxCaptureFailures = pgTable(
  "chart_fill_fx_capture_failures",
  {
    fillId: text("fill_id").notNull().references(() => fills.id, { onDelete: "restrict", onUpdate: "restrict" }),
    version: text("version").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    createdAt
  },
  (table) => [
    primaryKey({ columns: [table.fillId, table.version] }),
    check("chart_capture_status_unavailable", sql`${table.status} = 'UNAVAILABLE'`)
  ]
);
var payoutApprovalSnapshots = pgTable("payout_approval_snapshots", {
  approvalId: text("approval_id").primaryKey().references(() => payoutPlanApprovals.id, {
    onDelete: "restrict",
    onUpdate: "restrict"
  }),
  snapshotVersion: text("snapshot_version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt
});
var payoutSignedTransactions = pgTable("payout_signed_transactions", {
  payoutBatchId: text("payout_batch_id").primaryKey().references(() => payoutBatches.id, { onDelete: "restrict" }),
  transactionSignature: text("transaction_signature").notNull().unique(),
  intentHash: text("intent_hash").notNull(),
  unsignedTransactionBase64: text("unsigned_transaction_base64").notNull(),
  signedTransactionBase64: text("signed_transaction_base64").notNull(),
  recentBlockhash: text("recent_blockhash").notNull(),
  lastValidBlockHeight: bigint("last_valid_block_height", { mode: "bigint" }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutOperationEvents = pgTable("payout_operation_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  payoutExecutionId: text("payout_execution_id").notNull().references(() => payoutExecutions.id, { onDelete: "restrict" }),
  payoutBatchId: text("payout_batch_id").references(() => payoutBatches.id, { onDelete: "restrict" }),
  transactionSignature: text("transaction_signature"),
  event: text("event").notNull(),
  detail: jsonb("detail").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutStopState = pgTable("payout_stop_state", {
  singleton: boolean("singleton").primaryKey().default(true),
  stopped: boolean("stopped").notNull().default(true),
  generation: bigint("generation", { mode: "bigint" }).notNull().default(0n),
  reason: text("reason").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutSecurityEvents = pgTable("payout_security_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  actor: text("actor"),
  action: text("action").notNull(),
  planId: text("plan_id"),
  outcome: text("outcome").notNull(),
  reason: text("reason").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutAuthorityNonces = pgTable("payout_authority_nonces", {
  issuer: text("issuer").notNull(),
  nonce: text("nonce").notNull(),
  action: text("action").notNull(),
  planId: text("plan_id").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  signedRequest: jsonb("signed_request").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
}, (table) => [primaryKey({ columns: [table.issuer, table.nonce] })]);
var payoutApprovalAuthorizations = pgTable("payout_approval_authorizations", {
  approvalId: text("approval_id").primaryKey().references(() => payoutPlanApprovals.id, { onDelete: "restrict" }),
  subject: text("subject").notNull(),
  signedRequest: jsonb("signed_request").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
});
var payoutTreasuryReceipts = pgTable("payout_treasury_receipts", {
  identity: text("identity").primaryKey(),
  kind: text("kind").notNull(),
  // creator_fee_events is an existing SQL-defined table; the companion SQL enforces this FK.
  creatorFeeEventId: text("creator_fee_event_id"),
  allocations: jsonb("allocations").notNull(),
  network: text("network").notNull(),
  treasury: text("treasury").notNull(),
  lamports: bigint("lamports", { mode: "bigint" }).notNull(),
  finalizedSlot: bigint("finalized_slot", { mode: "bigint" }).notNull(),
  evidenceHash: text("evidence_hash").notNull()
});
var payoutTreasuryReservations = pgTable("payout_treasury_reservations", {
  planId: text("plan_id").primaryKey().references(() => payoutPlans.id, { onDelete: "restrict" }),
  sourceKey: text("source_key").notNull().unique(),
  approvalHash: text("approval_hash").notNull(),
  fundingHash: text("funding_hash").notNull(),
  principal: bigint("principal", { mode: "bigint" }).notNull(),
  feeBudget: bigint("fee_budget", { mode: "bigint" }).notNull(),
  recipients: jsonb("recipients").notNull(),
  network: text("network").notNull(),
  treasury: text("treasury").notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull()
});
var payoutTreasuryDays = pgTable(
  "payout_treasury_days",
  {
    planId: text("plan_id").notNull().references(() => payoutTreasuryReservations.planId, { onDelete: "restrict" }),
    utcDay: date("utc_day").notNull(),
    exposure: bigint("exposure", { mode: "bigint" }).notNull()
  },
  (table) => [primaryKey({ columns: [table.planId, table.utcDay] })]
);
var payoutTreasurySettlements = pgTable("payout_treasury_settlements", {
  batchId: text("batch_id").primaryKey().references(() => payoutBatches.id, { onDelete: "restrict" }),
  planId: text("plan_id").notNull().references(() => payoutTreasuryReservations.planId, { onDelete: "restrict" }),
  signature: text("signature").notNull().unique(),
  principal: bigint("principal", { mode: "bigint" }).notNull(),
  fee: bigint("fee", { mode: "bigint" }).notNull(),
  finalizedSlot: bigint("finalized_slot", { mode: "bigint" }).notNull()
});

// packages/db/src/database.ts
function createDatabase(databaseUrl, admission = {}) {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on("error", () => {
  });
  const client = drizzle(pool, { schema: schema_exports });
  return {
    authorizePaperBuy: admission.authorizePaperBuy ?? (async () => false),
    client,
    pool,
    async healthCheck() {
      try {
        await client.execute(sql2`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await pool.end();
    }
  };
}

// packages/db/src/legacy-settlement.ts
import { createHash } from "node:crypto";

// packages/db/src/payout-service.ts
import {
  DAILY_PAYOUT_CURVE_VERSION,
  HOURLY_PAYOUT_CURVE_VERSION,
  PAYOUT_TIE_POLICY_VERSION,
  allocatePayouts,
  competitionConfig,
  identifier
} from "./packages/core/dist/index.js";
var PayoutPlanError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
async function getPayoutPlanAudit(database2, planId) {
  const plan = (await database2.pool.query("select * from payout_plans where id=$1", [planId])).rows[0];
  if (!plan) return null;
  const buckets = (await database2.pool.query(
    `select ordinal,weight_ppm::text,floor_allocation_lamports::text,remainder_basis::text,
              final_allocation_lamports::text from payout_rank_buckets
       where payout_plan_id=$1 order by ordinal`,
    [planId]
  )).rows;
  const allocations = (await database2.pool.query(
    `select a.user_id,u.wallet_address,a.competitive_rank,a.tie_group_size,a.ordinal_start,
              a.ordinal_end,a.funded_ordinal_count,a.allocated_lamports::text,
              a.dust_adjustment_lamports::text,a.allocation_explanation
       from payout_allocations a join users u on u.id=a.user_id
       where a.payout_plan_id=$1 order by a.competitive_rank,a.user_id`,
    [planId]
  )).rows;
  return {
    id: plan.id,
    competitionType: plan.competition_type,
    hourlyRoundId: plan.hourly_round_id,
    dailyCompetitionId: plan.daily_competition_id,
    prizePoolLamports: BigInt(plan.prize_pool_lamports),
    curveVersion: plan.curve_version,
    tiePolicyVersion: plan.tie_policy_version,
    participantCount: plan.participant_count,
    nominalWinnerCount: plan.nominal_winner_count,
    actualWinnerCount: plan.actual_winner_count,
    state: plan.state,
    calculatedAt: plan.calculated_at,
    frozenAt: plan.frozen_at,
    validatedAt: plan.validated_at,
    configSnapshot: plan.config_snapshot,
    sourceLeaderboard: plan.source_result_snapshot,
    rankBuckets: buckets.map((row) => ({
      ordinal: row.ordinal,
      weightPpm: BigInt(row.weight_ppm),
      floorAllocationLamports: BigInt(row.floor_allocation_lamports),
      remainderBasis: BigInt(row.remainder_basis),
      finalAllocationLamports: BigInt(row.final_allocation_lamports)
    })),
    allocations: allocations.map((row) => ({
      userId: row.user_id,
      walletAddress: row.wallet_address,
      competitiveRank: row.competitive_rank,
      tied: row.tie_group_size > 1,
      tieGroupSize: row.tie_group_size,
      ordinalStart: row.ordinal_start,
      ordinalEnd: row.ordinal_end,
      fundedOrdinalCount: row.funded_ordinal_count,
      allocatedLamports: BigInt(row.allocated_lamports),
      dustAdjustmentLamports: BigInt(row.dust_adjustment_lamports),
      explanation: row.allocation_explanation
    })),
    conservation: {
      totalAllocatedLamports: BigInt(plan.total_allocated_lamports),
      prizePoolLamports: BigInt(plan.prize_pool_lamports),
      holds: plan.conservation_holds
    }
  };
}
async function getHourlyPayoutWinners(database2, hourlyRoundId) {
  const plan = (await database2.pool.query(
    `select id from payout_plans where hourly_round_id=$1 order by calculated_at desc limit 1`,
    [hourlyRoundId]
  )).rows[0];
  return plan ? getPayoutPlanAudit(database2, plan.id) : null;
}
async function getDailyPayoutWinners(database2, idOrDate) {
  const plan = (await database2.pool.query(
    `select p.id from payout_plans p join daily_competitions d on d.id=p.daily_competition_id
       where d.id=$1 or d.utc_date::text=$1 order by p.calculated_at desc limit 1`,
    [idOrDate]
  )).rows[0];
  return plan ? getPayoutPlanAudit(database2, plan.id) : null;
}
async function getUserRewardAllocations(database2, userId) {
  const rows = await database2.pool.query(
    `select id from payout_plans p
     where exists (
       select 1 from jsonb_array_elements(p.source_result_snapshot) source
       where source->>'userId'=$1
     ) order by calculated_at desc`,
    [userId]
  );
  const results = [];
  for (const row of rows.rows) {
    const audit = await getPayoutPlanAudit(database2, row.id);
    const source = audit?.sourceLeaderboard.find((item) => item["userId"] === userId);
    const allocation = audit?.allocations.find((item) => item.userId === userId);
    if (audit && source) {
      results.push({
        payoutPlanId: audit.id,
        competitionType: audit.competitionType,
        hourlyRoundId: audit.hourlyRoundId,
        dailyCompetitionId: audit.dailyCompetitionId,
        competitiveRank: Number(source["competitiveRank"]),
        tied: Number(source["tieGroupSize"]) > 1,
        tieGroupSize: Number(source["tieGroupSize"]),
        won: Boolean(allocation),
        rewardAllocationLamports: allocation?.allocatedLamports ?? 0n,
        status: allocation ? audit.state === "VERIFIED" ? "PAID" : ["SIGNED", "BROADCAST"].includes(audit.state) ? "PROCESSING" : ["FAILED_RETRYABLE", "FAILED_FINAL", "RECONCILIATION_REQUIRED"].includes(
          audit.state
        ) ? "FAILED_REVIEW" : audit.state === "APPROVED" ? "APPROVED" : "PENDING" : "NOT_A_WINNER",
        payoutPlanState: audit.state
      });
    }
  }
  return results;
}

// packages/db/src/legacy-settlement.ts
var LEGACY_SETTLEMENT_POLICY = "legacy-single-liquidation-v1";
async function recordSettlementReview(client, round, position, reason) {
  await client.query(
    `insert into legacy_source_reviews(id,hourly_round_id,position_id,reason)
  values($1,$2,$3,$4) on conflict do nothing`,
    [
      "review:" + createHash("sha256").update(JSON.stringify([round, position, reason])).digest("hex"),
      round,
      position,
      reason
    ]
  );
}

// packages/db/src/financial-service.ts
import { withGenericAccount } from "./packages/protocols/dist/index.js";
import { createHash as createHash2 } from "node:crypto";
import {
  basisPoints,
  identifier as identifier2,
  paperSolBaseUnits,
  tokenBaseUnits,
  utcInstant,
  validateBuyAmount
} from "./packages/core/dist/index.js";
import {
  createMarketStateEvidence,
  canonicalExitPreflight,
  ExecutionEngineError
} from "./packages/execution/dist/index.js";
var FinancialServiceError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "FinancialServiceError";
    this.code = code;
  }
};
async function assertPaperBuyAdmission(database2, context) {
  let allowed = false;
  try {
    allowed = await database2.authorizePaperBuy?.(context) === true;
  } catch {
  }
  if (!allowed) throw new FinancialServiceError("PAPER_BUY_DISABLED", "Paper BUY entry is disabled by server admission control.");
}
function canonicalize(value) {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== void 0).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}
function fingerprint(value) {
  return createHash2("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}
function assertNonEmpty(value, name) {
  if (value.length === 0 || value.trim() !== value) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", `${name} must be non-empty.`);
  }
}
function assertPositive(value, name) {
  if (value <= 0n) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", `${name} must be positive.`);
  }
}
function firstRow(result, entity) {
  const row = result.rows[0];
  if (!row) throw new FinancialServiceError("ENTITY_NOT_FOUND", `${entity} was not found.`);
  return row;
}
function toCompetitionAccount(row) {
  return {
    id: row.id,
    userId: row.user_id,
    hourlyRoundId: row.hourly_round_id,
    startingPaperSolLamports: BigInt(row.starting_paper_sol_lamports),
    paperSolBalanceLamports: BigInt(row.paper_sol_balance_lamports),
    realizedPnlLamports: BigInt(row.realized_pnl_lamports),
    finalSettledBalanceLamports: row.final_settled_balance_lamports === null ? null : BigInt(row.final_settled_balance_lamports),
    hourlyPnlLamports: row.hourly_pnl_lamports === null ? null : BigInt(row.hourly_pnl_lamports)
  };
}
function toPosition(row) {
  return {
    id: row.id,
    competitionAccountId: row.competition_account_id,
    marketId: row.market_id,
    assetId: row.asset_id,
    remainingBaseUnits: BigInt(row.remaining_base_units),
    costBasisLamports: BigInt(row.cost_basis_lamports),
    realizedPnlLamports: BigInt(row.realized_pnl_lamports),
    status: row.status
  };
}
async function runFinancialTransaction(database2, operation) {
  const client = await database2.pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
async function claimIdempotency(client, input) {
  assertNonEmpty(input.idempotencyKey, "Idempotency key");
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
      input.competitionAccountId ?? null
    ]
  );
  const record = firstRow(
    await client.query(
      `select id, request_hash, status, result_entity_type, result_entity_id
       from idempotency_records
       where operation_class = $1 and idempotency_key = $2
       for update`,
      [input.operationClass, input.idempotencyKey]
    ),
    "Idempotency record"
  );
  if (record.request_hash !== input.requestHash) {
    throw new FinancialServiceError(
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used with a different request."
    );
  }
  return { record, replay: record.status === "COMPLETED" };
}
async function completeIdempotency(client, recordId, resultEntityType, resultEntityId, competitionAccountId) {
  await client.query(
    `update idempotency_records
     set status = 'COMPLETED', result_entity_type = $2, result_entity_id = $3,
         competition_account_id = coalesce(competition_account_id, $4), completed_at = now()
     where id = $1`,
    [recordId, resultEntityType, resultEntityId, competitionAccountId ?? null]
  );
}
async function insertJournal(client, input) {
  const debit = input.entries.filter(({ direction }) => direction === "DEBIT").reduce((total, { amountLamports }) => total + amountLamports, 0n);
  const credit = input.entries.filter(({ direction }) => direction === "CREDIT").reduce((total, { amountLamports }) => total + amountLamports, 0n);
  const zeroCostWriteoff = input.operationType === "FORCED_HOURLY_SETTLEMENT_WRITEOFF" && input.entries.length === 0 && input.metadata?.["costBasisLamports"] === "0";
  if (!zeroCostWriteoff && (input.entries.length < 2 || debit !== credit || debit <= 0n)) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Journal entries must balance.");
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
      JSON.stringify(input.metadata ?? {})
    ]
  );
  for (const [index2, entry] of input.entries.entries()) {
    await client.query(
      `insert into ledger_entries
        (id, journal_transaction_id, competition_account_id, account_code, direction, amount_lamports)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        `${input.id}:entry:${index2.toString()}`,
        input.id,
        input.competitionAccountId,
        entry.accountCode,
        entry.direction,
        entry.amountLamports
      ]
    );
  }
}
async function getAccountStateWithClient(client, accountId, forUpdate = false) {
  return toCompetitionAccount(
    firstRow(
      await client.query(
        `select id, user_id, hourly_round_id, starting_paper_sol_lamports,
                paper_sol_balance_lamports, realized_pnl_lamports,
                final_settled_balance_lamports, hourly_pnl_lamports
         from competition_accounts where id = $1${forUpdate ? " for update" : ""}`,
        [accountId]
      ),
      "Competition account"
    )
  );
}
async function initializeCompetitionAccount(database2, input) {
  const requestHash = fingerprint({
    accountId: input.accountId,
    userId: input.userId,
    hourlyRoundId: input.hourlyRoundId
  });
  return runFinancialTransaction(database2, async (client) => {
    const claimed = await claimIdempotency(client, {
      operationClass: "HOURLY_ACCOUNT_INITIALIZATION",
      idempotencyKey: input.idempotencyKey,
      requestHash
    });
    if (claimed.replay) {
      return getAccountStateWithClient(client, claimed.record.result_entity_id);
    }
    const round = firstRow(
      await client.query(
        `select starting_paper_sol_lamports, state, starts_at, ends_at_exclusive
         from hourly_rounds where id = $1 for share`,
        [input.hourlyRoundId]
      ),
      "Hourly round"
    );
    if (input.requireOpenAt && (round.state !== "OPEN" || input.requireOpenAt < round.starts_at || input.requireOpenAt >= round.ends_at_exclusive)) {
      throw new FinancialServiceError(
        "ROUND_NOT_OPEN",
        "The hourly round is not open for account entry."
      );
    }
    const startingBalance = BigInt(round.starting_paper_sol_lamports);
    const inserted = await client.query(
      `insert into competition_accounts
        (id, user_id, hourly_round_id, starting_paper_sol_lamports, paper_sol_balance_lamports)
       values ($1, $2, $3, $4, $4)
       on conflict (user_id, hourly_round_id) do nothing returning id`,
      [input.accountId, input.userId, input.hourlyRoundId, startingBalance]
    );
    const accountId = inserted.rows[0]?.id ?? firstRow(
      await client.query(
        "select id from competition_accounts where user_id = $1 and hourly_round_id = $2",
        [input.userId, input.hourlyRoundId]
      ),
      "Competition account"
    ).id;
    if (inserted.rowCount === 1) {
      await insertJournal(client, {
        id: `journal:hourly-start:${accountId}`,
        competitionAccountId: accountId,
        operationType: "HOURLY_STARTING_CREDIT",
        sourceEntityType: "COMPETITION_ACCOUNT",
        sourceEntityId: accountId,
        idempotencyRecordId: claimed.record.id,
        entries: [
          { accountCode: "CASH", direction: "DEBIT", amountLamports: startingBalance },
          {
            accountCode: "HOURLY_STARTING_CAPITAL",
            direction: "CREDIT",
            amountLamports: startingBalance
          }
        ]
      });
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      "COMPETITION_ACCOUNT",
      accountId,
      accountId
    );
    return getAccountStateWithClient(client, accountId);
  });
}
async function getPositionWithClient(client, positionId) {
  return toPosition(
    firstRow(
      await client.query(
        `select id, competition_account_id, market_id, asset_id, remaining_base_units,
                cost_basis_lamports, realized_pnl_lamports, status
         from positions where id = $1`,
        [positionId]
      ),
      "Position"
    )
  );
}
function deterministicEntityId(kind, idempotencyKey2) {
  return `${kind}:${createHash2("sha256").update(idempotencyKey2).digest("hex")}`;
}
function executionPrice(numerator, denominator) {
  const scale = 10n ** 18n;
  const scaled = numerator * scale / denominator;
  if (scaled <= 0n) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "Execution price is below supported precision."
    );
  }
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(18, "0");
  return `${whole.toString()}.${fraction}`;
}
function normalizedFeeBreakdown(execution) {
  return {
    canonicalRoute: execution.executionDetails?.["canonicalRoute"] ?? null,
    executionDetails: execution.executionDetails ?? null,
    fees: execution.quote.fees.map((item) => ({
      category: item.category,
      asset: item.amount.asset,
      amount: item.amount.amount.toString(),
      ...item.amount.asset === "TOKEN" ? { tokenMint: item.amount.tokenMint } : {}
    }))
  };
}
function paperSolFeeTotal(execution) {
  return execution.quote.fees.reduce(
    (total, item) => item.amount.asset === "PAPER_SOL" ? total + item.amount.amount : total,
    0n
  );
}
function validateAuthoritativeExecution(input) {
  const execution = input.execution;
  if (execution.id !== input.executionId || execution.orderId !== input.orderId || execution.quote.orderId !== input.orderId || execution.quote.protocolId !== input.identity.protocolId || execution.quote.marketId !== input.identity.marketId || execution.quote.adapterVersion !== input.adapterVersion || execution.quote.marketStateFingerprint !== input.evidence.fingerprint || execution.quote.normalizationVersion !== input.evidence.normalizationVersion || input.evidence.identity.protocolId !== input.identity.protocolId || input.evidence.identity.marketId !== input.identity.marketId || input.evidence.identity.tokenMint !== input.identity.tokenMint || input.evidence.adapterVersion !== input.adapterVersion || execution.actualInput.asset !== "PAPER_SOL" || execution.actualOutput.asset !== "TOKEN" || execution.actualOutput.tokenMint !== input.identity.tokenMint || typeof execution.actualInput.amount !== "bigint" || typeof execution.actualOutput.amount !== "bigint" || execution.actualInput.amount <= 0n || execution.actualOutput.amount <= 0n || execution.actualInput.amount > input.requestedPaperSolLamports || execution.actualInput.amount > input.availablePaperSolLamports) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "The adapter returned an invalid or mismatched execution result."
    );
  }
  const fees = paperSolFeeTotal(execution);
  if (fees < 0n || fees >= execution.actualInput.amount) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "The execution fee breakdown is inconsistent with total input."
    );
  }
}
async function persistMarketStateEvidence(client, evidence) {
  const id = `market-state:${evidence.fingerprint}`;
  const rawSource = evidence.rawSource ?? null;
  if (rawSource && Buffer.byteLength(JSON.stringify(rawSource), "utf8") > 65536) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "Raw market-state evidence exceeds the 64 KiB safety limit."
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
      evidence.fingerprint
    ]
  );
  const persisted = firstRow(
    await client.query(
      `select id, protocol_id, market_id from market_state_evidence where state_fingerprint = $1`,
      [evidence.fingerprint]
    ),
    "Market-state evidence"
  );
  if (persisted.protocol_id !== evidence.identity.protocolId || persisted.market_id !== evidence.identity.marketId) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "The persisted evidence fingerprint has a conflicting identity."
    );
  }
  return persisted.id;
}
async function getAuthoritativePaperBuyResult(client, fillId) {
  const row = firstRow(
    await client.query(
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
      [fillId]
    ),
    "Authoritative paper buy"
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
    executedAt: row.executed_at
  };
}
function translateExecutionError(error, valuation) {
  if (error instanceof FinancialServiceError) throw error;
  if (error instanceof ExecutionEngineError) {
    if (valuation) {
      throw new FinancialServiceError("POSITION_VALUATION_FAILED", error.message);
    }
    if (error.code === "UNSUPPORTED_PROTOCOL") {
      throw new FinancialServiceError("UNSUPPORTED_PROTOCOL", error.message);
    }
    if (error.code === "MARKET_STATE_UNAVAILABLE") {
      throw new FinancialServiceError("MARKET_STATE_UNAVAILABLE", error.message);
    }
    if (error.code === "PROTOCOL_DISABLED" || error.code === "INSUFFICIENT_EXECUTABLE_LIQUIDITY" || error.code === "ZERO_EXECUTABLE_OUTPUT" || error.code === "ADAPTER_VERSION_UNAVAILABLE" || error.code === "EVIDENCE_CORRUPTED") {
      throw new FinancialServiceError(error.code, error.message);
    }
    if (error.code === "MARKET_ACCOUNT_NOT_FOUND" || error.code === "MARKET_MIGRATED" || error.code === "MIGRATION_DESTINATION_UNAVAILABLE" || error.code === "UNSUPPORTED_MIGRATED_PROTOCOL" || error.code === "POSITION_EXECUTION_ROUTE_UNAVAILABLE" || error.code === "RPC_TIMEOUT" || error.code === "RPC_UNAVAILABLE" || error.code === "RPC_ERROR") {
      throw new FinancialServiceError(error.code, error.message);
    }
    throw new FinancialServiceError("INVALID_EXECUTION_RESULT", error.message);
  }
  throw new FinancialServiceError(
    valuation ? "POSITION_VALUATION_FAILED" : "MARKET_STATE_UNAVAILABLE",
    valuation ? "An open position could not be authoritatively valued." : "Authoritative market state is unavailable."
  );
}
async function executePaperBuy(database2, router2, input) {
  await assertPaperBuyAdmission(database2, { accountId: input.competitionAccountId });
  assertPositive(input.requestedPaperSolLamports, "Requested Paper SOL");
  if (Number.isNaN(input.authoritativeTimestamp.getTime())) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Timestamp is invalid.");
  }
  const requestHash = fingerprint({
    competitionAccountId: input.competitionAccountId,
    marketId: input.marketId,
    requestedPaperSolLamports: input.requestedPaperSolLamports
  });
  const orderId = deterministicEntityId("authoritative-buy-order", input.idempotencyKey);
  const fillId = deterministicEntityId("authoritative-buy-fill", input.idempotencyKey);
  const executionId = deterministicEntityId("authoritative-buy-execution", input.idempotencyKey);
  return runFinancialTransaction(database2, async (client) => {
    await assertPaperBuyAdmission(database2, { accountId: input.competitionAccountId, client });
    await database2.lockMarketExecution?.(client, input.competitionAccountId);
    const claimed = await claimIdempotency(client, {
      operationClass: "AUTHORITATIVE_PAPER_BUY",
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.competitionAccountId
    });
    if (claimed.replay) {
      return getAuthoritativePaperBuyResult(client, claimed.record.result_entity_id);
    }
    const accountIdentity = firstRow(
      await client.query(
        "select hourly_round_id from competition_accounts where id = $1",
        [input.competitionAccountId]
      ),
      "Competition account"
    );
    const round = firstRow(
      await client.query(
        `select state, starts_at, ends_at_exclusive, max_unique_tokens, max_buy_ratio_bps
         from hourly_rounds where id = $1 for share`,
        [accountIdentity.hourly_round_id]
      ),
      "Hourly round"
    );
    if (round.state !== "OPEN") {
      throw new FinancialServiceError("ROUND_NOT_OPEN", "The hourly round is not open.");
    }
    if (input.authoritativeTimestamp < round.starts_at || input.authoritativeTimestamp >= round.ends_at_exclusive) {
      throw new FinancialServiceError(
        "OUTSIDE_ROUND_WINDOW",
        "The authoritative timestamp is outside the hourly round window."
      );
    }
    const account = await getAccountStateWithClient(client, input.competitionAccountId, true);
    if (account.finalSettledBalanceLamports !== null) {
      throw new FinancialServiceError("ROUND_NOT_OPEN", "The competition account is finalized.");
    }
    const targetMarket = firstRow(
      await client.query(
        `select m.id, m.venue, m.base_asset_id, a.mint_address
         from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
        [input.marketId]
      ),
      "Market"
    );
    const positions2 = (await client.query(
      `select p.id, p.competition_account_id, p.market_id, p.asset_id,
                p.remaining_base_units, p.cost_basis_lamports, p.realized_pnl_lamports,
                p.status, m.venue, a.mint_address
         from positions p
         join markets m on m.id = p.market_id
         join assets a on a.id = p.asset_id
         where p.competition_account_id = $1 and p.status = 'OPEN'
         order by p.id for update of p`,
      [input.competitionAccountId]
    )).rows;
    const valuations = [];
    if (database2.valueMarketPortfolio) {
      try {
        const values = await database2.valueMarketPortfolio(
          positions2.map((p) => ({
            positionId: p.id,
            identity: {
              protocolId: identifier2(p.venue, "ProtocolId"),
              marketId: identifier2(p.market_id, "MarketId"),
              tokenMint: identifier2(p.mint_address, "TokenMint")
            },
            quantity: BigInt(p.remaining_base_units)
          }))
        );
        if (values.length !== positions2.length)
          throw new ExecutionEngineError(
            "INVALID_EXECUTION_RESULT",
            "Portfolio valuation is incomplete."
          );
        for (const [i, value] of values.entries()) {
          const row = positions2[i];
          if (value.positionId !== row.id || typeof value.value !== "bigint" || value.value < 0n || value.evidence.identity.tokenMint !== row.mint_address)
            throw new ExecutionEngineError(
              "INVALID_EXECUTION_RESULT",
              "Portfolio valuation does not match the locked positions."
            );
          valuations.push({ row, value: value.value, evidence: value.evidence });
        }
      } catch (error) {
        translateExecutionError(error, true);
      }
    } else for (const position of positions2) {
      const identity = {
        protocolId: identifier2(position.venue, "ProtocolId"),
        marketId: identifier2(position.market_id, "MarketId"),
        tokenMint: identifier2(position.mint_address, "TokenMint")
      };
      try {
        const exit = await withGenericAccount(
          input.competitionAccountId,
          () => canonicalExitPreflight(
            router2,
            identity,
            BigInt(position.remaining_base_units),
            BigInt(position.cost_basis_lamports)
          )
        );
        valuations.push({
          row: position,
          value: exit.maxExecutableOutputLamports,
          evidence: exit.evidence
        });
      } catch (error) {
        translateExecutionError(error, true);
      }
    }
    const buyValidation = validateBuyAmount({
      requestedBuyAmount: paperSolBaseUnits(input.requestedPaperSolLamports),
      availablePaperSolCash: paperSolBaseUnits(account.paperSolBalanceLamports),
      authoritativePositionValues: valuations.map(({ value }) => paperSolBaseUnits(value)),
      maxBuyRatioBps: basisPoints(BigInt(round.max_buy_ratio_bps))
    });
    if (!buyValidation.ok) {
      if (buyValidation.reason === "INSUFFICIENT_PAPER_SOL") {
        throw new FinancialServiceError(
          "INSUFFICIENT_PAPER_SOL",
          "Available Paper SOL is insufficient."
        );
      }
      if (buyValidation.reason === "MAX_BUY_RATIO_EXCEEDED") {
        throw new FinancialServiceError(
          "MAX_BUY_RATIO_EXCEEDED",
          "The requested buy exceeds the round maximum-buy ratio."
        );
      }
      throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Buy amount must be positive.");
    }
    const slotCapacity = firstRow(
      await client.query(
        `select count(*)::int as used,
                count(*) filter (where asset_id = $2)::int as existing
         from competition_token_slots where competition_account_id = $1`,
        [input.competitionAccountId, targetMarket.base_asset_id]
      ),
      "Token-slot capacity"
    );
    if (slotCapacity.existing === 0 && slotCapacity.used >= round.max_unique_tokens) {
      throw new FinancialServiceError(
        "TOKEN_SLOT_LIMIT_REACHED",
        "The hourly unique-token limit has been reached."
      );
    }
    const targetIdentity = {
      protocolId: identifier2(targetMarket.venue, "ProtocolId"),
      marketId: identifier2(targetMarket.id, "MarketId"),
      tokenMint: identifier2(targetMarket.mint_address, "TokenMint")
    };
    let execution;
    let buyEvidence;
    let adapterVersion;
    let executionIdentity = targetIdentity;
    try {
      const { route, adapter, state } = await withGenericAccount(
        input.competitionAccountId,
        () => router2.loadPositionRoute(targetIdentity)
      );
      executionIdentity = route.executionIdentity;
      const selectedHops = state.normalizedState["hops"];
      if (Array.isArray(selectedHops) && selectedHops.some(
        (hop) => hop !== null && typeof hop === "object" && !Array.isArray(hop) && (hop["pool"] === "J7wveuS29NdZDEDuJp8C7W1BvkkLU88bWHsCtLGaCcbx" || hop["pool"] === "2bDQiRwzoeqLfZ2nQ8decjqhDyAp8f1kx8WW33jwhYXH")
      )) {
        throw new FinancialServiceError(
          "UNSUPPORTED_PROTOCOL",
          "New BUYs through this pool are temporarily unsupported pending sequential-liquidity simulation support."
        );
      }
      if (route.migrated) {
        await client.query(
          `insert into markets (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
           select $1, base_asset_id, quote_asset_id, $2, $1,
                  jsonb_build_object('migrationResolvedFromMarketId', id)
           from markets where id = $3 on conflict do nothing`,
          [executionIdentity.marketId, executionIdentity.protocolId, targetIdentity.marketId]
        );
      }
      const destination = firstRow(
        await client.query(
          `select m.id, m.venue, m.base_asset_id, a.mint_address
         from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
          [executionIdentity.marketId]
        ),
        "Execution market"
      );
      if (destination.venue !== executionIdentity.protocolId || destination.base_asset_id !== targetMarket.base_asset_id || destination.mint_address !== targetIdentity.tokenMint) {
        throw new ExecutionEngineError(
          "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
          "Resolved BUY market does not match its origin asset."
        );
      }
      buyEvidence = createMarketStateEvidence(state);
      adapterVersion = adapter.adapterVersion;
      execution = await adapter.simulateBuy(
        {
          orderId: identifier2(orderId, "OrderId"),
          executionId: identifier2(executionId, "ExecutionId"),
          identity: executionIdentity,
          requestedPaperSol: paperSolBaseUnits(input.requestedPaperSolLamports),
          executedAt: utcInstant(input.authoritativeTimestamp)
        },
        state
      );
    } catch (error) {
      translateExecutionError(error, false);
    }
    validateAuthoritativeExecution({
      execution,
      orderId,
      executionId,
      identity: executionIdentity,
      requestedPaperSolLamports: input.requestedPaperSolLamports,
      availablePaperSolLamports: account.paperSolBalanceLamports,
      evidence: buyEvidence,
      adapterVersion
    });
    const actualInput = execution.actualInput.amount;
    const tokenOutput = execution.actualOutput.amount;
    const feeLamports = paperSolFeeTotal(execution);
    const quoteLamports = actualInput - feeLamports;
    await assertPaperBuyAdmission(database2, { accountId: input.competitionAccountId, client });
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
        input.authoritativeTimestamp
      ]
    );
    for (const valuation of valuations) {
      if (valuation.evidence.identity.marketId !== valuation.row.market_id) {
        await client.query(
          `insert into markets (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
           select $1, base_asset_id, quote_asset_id, $2, $1,
                  jsonb_build_object('migrationResolvedFromMarketId', id)
           from markets where id = $3 on conflict do nothing`,
          [
            valuation.evidence.identity.marketId,
            valuation.evidence.identity.protocolId,
            valuation.row.market_id
          ]
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
          valuation.value
        ]
      );
    }
    const buyEvidenceId = await persistMarketStateEvidence(client, buyEvidence);
    const existingPosition = positions2.find(({ market_id }) => market_id === input.marketId) ?? (await client.query(
      `select p.id, p.competition_account_id, p.market_id, p.asset_id,
                  p.remaining_base_units, p.cost_basis_lamports, p.realized_pnl_lamports,
                  p.status, m.venue, a.mint_address
           from positions p
           join markets m on m.id = p.market_id
           join assets a on a.id = p.asset_id
           where p.competition_account_id = $1 and p.market_id = $2 for update of p`,
      [input.competitionAccountId, input.marketId]
    )).rows[0];
    const positionId = existingPosition?.id ?? `position:${input.competitionAccountId}:${input.marketId}`;
    if (existingPosition) {
      await client.query(
        `update positions
         set remaining_base_units = remaining_base_units + $2,
             cost_basis_lamports = cost_basis_lamports + $3,
             status = 'OPEN', closed_at = null, updated_at = $4
         where id = $1`,
        [positionId, tokenOutput, actualInput, input.authoritativeTimestamp]
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
          input.authoritativeTimestamp
        ]
      );
    }
    await client.query(
      `insert into order_market_state_evidence
        (id, order_id, evidence_id, purpose, position_id)
       values ($1, $2, $3, 'BUY_EXECUTION', $4)`,
      [`${orderId}:buy-execution`, orderId, buyEvidenceId, positionId]
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
        JSON.stringify(normalizedFeeBreakdown(execution)),
        executionIdentity.protocolId,
        adapterVersion,
        buyEvidenceId,
        claimed.record.id,
        input.authoritativeTimestamp
      ]
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
          input.authoritativeTimestamp
        ]
      );
    }
    await client.query(
      `update competition_accounts
       set paper_sol_balance_lamports = paper_sol_balance_lamports - $2 where id = $1`,
      [input.competitionAccountId, actualInput]
    );
    await insertJournal(client, {
      id: `journal:authoritative-buy:${fillId}`,
      competitionAccountId: input.competitionAccountId,
      operationType: "AUTHORITATIVE_SIMULATED_BUY",
      sourceEntityType: "FILL",
      sourceEntityId: fillId,
      idempotencyRecordId: claimed.record.id,
      entries: [
        { accountCode: "POSITION_COST", direction: "DEBIT", amountLamports: actualInput },
        { accountCode: "CASH", direction: "CREDIT", amountLamports: actualInput }
      ]
    });
    await database2.commitMarketExecution?.(client, { accountId: input.competitionAccountId, roundId: accountIdentity.hourly_round_id, fillId, execution, executionContext: "NORMAL_USER" });
    await completeIdempotency(
      client,
      claimed.record.id,
      "AUTHORITATIVE_BUY_FILL",
      fillId,
      input.competitionAccountId
    );
    return getAuthoritativePaperBuyResult(client, fillId);
  });
}
async function getAuthoritativePaperSellResult(client, fillId) {
  const row = firstRow(
    await client.query(
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
      [fillId]
    ),
    "Authoritative paper sell"
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
    executedAt: row.executed_at
  };
}
function validateAuthoritativeSellExecution(input) {
  const { execution } = input;
  if (execution.id !== input.executionId || execution.orderId !== input.orderId || execution.quote.orderId !== input.orderId || execution.quote.protocolId !== input.identity.protocolId || execution.quote.marketId !== input.identity.marketId || execution.quote.adapterVersion !== input.adapterVersion || execution.quote.marketStateFingerprint !== input.evidence.fingerprint || execution.quote.normalizationVersion !== input.evidence.normalizationVersion || input.evidence.identity.protocolId !== input.identity.protocolId || input.evidence.identity.marketId !== input.identity.marketId || input.evidence.identity.tokenMint !== input.identity.tokenMint || input.evidence.adapterVersion !== input.adapterVersion || execution.actualInput.asset !== "TOKEN" || execution.actualInput.tokenMint !== input.identity.tokenMint || execution.actualInput.amount !== input.requestedTokenQuantity || execution.actualOutput.asset !== "PAPER_SOL" || typeof execution.actualOutput.amount !== "bigint" || execution.actualOutput.amount <= 0n) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "The adapter returned an invalid or mismatched SELL execution result."
    );
  }
  const fees = paperSolFeeTotal(execution);
  if (fees < 0n) {
    throw new FinancialServiceError(
      "INVALID_EXECUTION_RESULT",
      "The SELL fee breakdown is invalid."
    );
  }
}
async function prepareAuthoritativeSell(database2, router2, input, ids, pinned) {
  const market = firstRow(
    await database2.pool.query(
      `select m.id, m.venue, m.base_asset_id, a.mint_address
       from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
      [input.marketId]
    ),
    "Market"
  );
  const identity = {
    protocolId: identifier2(market.venue, "ProtocolId"),
    marketId: identifier2(market.id, "MarketId"),
    tokenMint: identifier2(market.mint_address, "TokenMint")
  };
  try {
    if (pinned && (pinned.identity.tokenMint !== identity.tokenMint || createMarketStateEvidence(pinned).fingerprint !== pinned.fingerprint))
      throw new FinancialServiceError("EVIDENCE_CORRUPTED", "Pinned liquidation evidence is invalid.");
    const { route, adapter, state } = pinned ? {
      route: {
        originIdentity: identity,
        executionIdentity: pinned.identity,
        migrated: pinned.identity.marketId !== identity.marketId
      },
      adapter: router2.resolveVersion(pinned.identity.protocolId, pinned.adapterVersion),
      state: pinned
    } : await withGenericAccount(
      input.competitionAccountId,
      () => router2.loadPositionRoute(identity, input.executionContext === "FORCED_HOURLY_SETTLEMENT")
    );
    if (route.migrated) {
      await database2.pool.query(
        `insert into markets
          (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
         select $1, base_asset_id, quote_asset_id, $2, $1,
                jsonb_build_object('migrationResolvedFromMarketId', id)
         from markets where id = $3
         on conflict do nothing`,
        [route.executionIdentity.marketId, route.executionIdentity.protocolId, identity.marketId]
      );
    }
    const executionMarket = (await database2.pool.query(
      `select m.id, m.venue, m.base_asset_id, a.mint_address
         from markets m join assets a on a.id = m.base_asset_id where m.id = $1`,
      [route.executionIdentity.marketId]
    )).rows[0];
    if (!executionMarket || executionMarket.venue !== route.executionIdentity.protocolId || executionMarket.base_asset_id !== market.base_asset_id || executionMarket.mint_address !== market.mint_address) {
      throw new ExecutionEngineError(
        "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
        "The resolved execution market is not registered for this position asset."
      );
    }
    const evidence = createMarketStateEvidence(state);
    if (input.executionContext === "FORCED_HOURLY_SETTLEMENT" && pinned)
      await database2.bindMarketSettlementEvidence?.(input.competitionAccountId, pinned);
    const execution = await adapter.simulateSell(
      {
        orderId: identifier2(ids.orderId, "OrderId"),
        executionId: identifier2(ids.executionId, "ExecutionId"),
        identity: route.executionIdentity,
        requestedTokenQuantity: tokenBaseUnits(input.requestedTokenQuantity),
        executedAt: utcInstant(input.authoritativeTimestamp)
      },
      state
    );
    validateAuthoritativeSellExecution({
      execution,
      orderId: ids.orderId,
      executionId: ids.executionId,
      identity: route.executionIdentity,
      requestedTokenQuantity: input.requestedTokenQuantity,
      evidence,
      adapterVersion: adapter.adapterVersion
    });
    return {
      identity: route.executionIdentity,
      state,
      evidence,
      execution,
      adapterVersion: adapter.adapterVersion
    };
  } catch (error) {
    translateExecutionError(error, false);
  }
}
async function executeAuthoritativePaperSell(database2, router2, input) {
  if (input.requestedTokenQuantity <= 0n) {
    throw new FinancialServiceError(
      "INVALID_SELL_QUANTITY",
      "Requested token quantity must be positive."
    );
  }
  if (Number.isNaN(input.authoritativeTimestamp.getTime())) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Timestamp is invalid.");
  }
  const requestHash = fingerprint({
    competitionAccountId: input.competitionAccountId,
    marketId: input.marketId,
    requestedTokenQuantity: input.idempotencyIntent ?? input.requestedTokenQuantity,
    executionContext: input.executionContext
  });
  const prefix = input.idempotencyIntent === "ALL" ? "authoritative-sell-all" : input.executionContext === "FORCED_HOURLY_SETTLEMENT" ? "forced-settlement-sell" : "authoritative-sell";
  const orderId = deterministicEntityId(`${prefix}-order`, input.idempotencyKey);
  const fillId = deterministicEntityId(`${prefix}-fill`, input.idempotencyKey);
  const executionId = deterministicEntityId(`${prefix}-execution`, input.idempotencyKey);
  const operationClass = input.idempotencyIntent === "ALL" ? "AUTHORITATIVE_PAPER_SELL_ALL" : input.executionContext === "FORCED_HOURLY_SETTLEMENT" ? "FORCED_HOURLY_SETTLEMENT_SELL" : "AUTHORITATIVE_PAPER_SELL";
  const existingClient = await database2.pool.connect();
  try {
    const existing = await existingClient.query(
      `select id, request_hash, status, result_entity_type, result_entity_id
       from idempotency_records where operation_class = $1 and idempotency_key = $2`,
      [operationClass, input.idempotencyKey]
    );
    const record = existing.rows[0];
    if (record) {
      if (record.request_hash !== requestHash) {
        throw new FinancialServiceError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used with a different request."
        );
      }
      if (record.status === "COMPLETED" && record.result_entity_id) {
        return await getAuthoritativePaperSellResult(existingClient, record.result_entity_id);
      }
    }
  } finally {
    existingClient.release();
  }
  const prepared = await prepareAuthoritativeSell(database2, router2, input, {
    orderId,
    executionId
  }, input.settlementEvidence);
  if (input.executionContext === "FORCED_HOURLY_SETTLEMENT" && (!input.settlementEvidence || prepared.execution.actualOutput.amount !== input.settlementNetLimit))
    throw new FinancialServiceError("SETTLEMENT_REVIEW", "Forced execution must match its one pinned capacity quote.");
  return runFinancialTransaction(database2, async (client) => {
    await database2.lockMarketExecution?.(client, input.competitionAccountId);
    const claimed = await claimIdempotency(client, {
      operationClass,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.competitionAccountId
    });
    if (claimed.replay) {
      return getAuthoritativePaperSellResult(client, claimed.record.result_entity_id);
    }
    const authority = firstRow(
      await client.query(
        `select a.hourly_round_id, r.state, r.starts_at, r.ends_at_exclusive
         from competition_accounts a join hourly_rounds r on r.id = a.hourly_round_id
         where a.id = $1 for share of r`,
        [input.competitionAccountId]
      ),
      "Competition account"
    );
    if (input.executionContext === "NORMAL_USER") {
      if (authority.state !== "OPEN") {
        throw new FinancialServiceError("ROUND_NOT_OPEN", "The hourly round is not open.");
      }
      if (input.authoritativeTimestamp < authority.starts_at || input.authoritativeTimestamp >= authority.ends_at_exclusive) {
        throw new FinancialServiceError(
          "OUTSIDE_ROUND_WINDOW",
          "The authoritative timestamp is outside the hourly round window."
        );
      }
    } else if (authority.state !== "SETTLING") {
      throw new FinancialServiceError(
        "SETTLEMENT_EXECUTION_FAILED",
        "Forced liquidation requires the round to be SETTLING."
      );
    }
    const account = await getAccountStateWithClient(client, input.competitionAccountId, true);
    if (account.finalSettledBalanceLamports !== null) {
      throw new FinancialServiceError("ROUND_NOT_OPEN", "The competition account is finalized.");
    }
    const positionRow = firstRow(
      await client.query(
        `select id, competition_account_id, market_id, asset_id, remaining_base_units,
                cost_basis_lamports, realized_pnl_lamports, status
         from positions where competition_account_id = $1 and market_id = $2 for update`,
        [input.competitionAccountId, input.marketId]
      ),
      "Position"
    );
    const quantityBefore = BigInt(positionRow.remaining_base_units);
    const costBefore = BigInt(positionRow.cost_basis_lamports);
    if (input.idempotencyIntent === "ALL" && input.requestedTokenQuantity !== quantityBefore) {
      throw new FinancialServiceError(
        "INVALID_SELL_QUANTITY",
        "The position changed while preparing SELL ALL; retry the same idempotent request."
      );
    }
    if (positionRow.status !== "OPEN" || input.requestedTokenQuantity > quantityBefore) {
      throw new FinancialServiceError(
        "INSUFFICIENT_TOKEN_BALANCE",
        "Requested SELL quantity exceeds the open token balance."
      );
    }
    if (input.executionContext === "FORCED_HOURLY_SETTLEMENT" && !input.persistedSettlementStep) {
      const prior = await client.query(`select 1 from fills f join orders o on o.id=f.order_id
        join order_market_state_evidence e on e.order_id=o.id
        where e.position_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT' limit 1`, [positionRow.id]);
      if (prior.rowCount) throw new FinancialServiceError("SETTLEMENT_REVIEW", "A prior forced liquidation requires independent review; capacity cannot be reused.");
    }
    const netProceeds = prepared.execution.actualOutput.amount;
    const feeLamports = paperSolFeeTotal(prepared.execution);
    const grossProceeds = netProceeds + feeLamports;
    const isFullSell = input.requestedTokenQuantity === quantityBefore;
    const costRemoved = isFullSell ? costBefore : costBefore * input.requestedTokenQuantity / quantityBefore;
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
        input.authoritativeTimestamp
      ]
    );
    await client.query(
      `insert into order_market_state_evidence
        (id, order_id, evidence_id, purpose, position_id)
       values ($1, $2, $3, 'SELL_EXECUTION', $4)`,
      [`${orderId}:sell-execution`, orderId, evidenceId, positionRow.id]
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
        remainingQuantity === 0n ? "CLOSED" : "OPEN",
        remainingQuantity === 0n ? input.authoritativeTimestamp : null,
        input.authoritativeTimestamp
      ]
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
        input.authoritativeTimestamp
      ]
    );
    if (input.executionContext === "FORCED_HOURLY_SETTLEMENT" && !input.persistedSettlementStep) {
      await client.query(`insert into legacy_settlement_liquidations
       (position_id,hourly_round_id,policy_version,quantity_before,basis_before,sold_quantity,net_proceeds,fee_lamports,evidence_id,fill_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        positionRow.id,
        authority.hourly_round_id,
        LEGACY_SETTLEMENT_POLICY,
        quantityBefore.toString(),
        costBefore,
        input.requestedTokenQuantity.toString(),
        netProceeds,
        feeLamports,
        evidenceId,
        fillId
      ]);
      if (remainingQuantity > 0n) await recordSettlementReview(client, authority.hourly_round_id, positionRow.id, "PARTIAL_LIQUIDATION_REMAINDER");
    }
    await client.query(
      `update competition_accounts
       set paper_sol_balance_lamports = paper_sol_balance_lamports + $2,
           realized_pnl_lamports = realized_pnl_lamports + $3
       where id = $1`,
      [input.competitionAccountId, netProceeds, fillPnl]
    );
    const entries = [];
    if (netProceeds > 0n) {
      entries.push({ accountCode: "CASH", direction: "DEBIT", amountLamports: netProceeds });
    }
    if (feeLamports > 0n) {
      entries.push({
        accountCode: "TRADING_FEES",
        direction: "DEBIT",
        amountLamports: feeLamports
      });
    }
    if (costRemoved > 0n) {
      entries.push({
        accountCode: "POSITION_COST",
        direction: "CREDIT",
        amountLamports: costRemoved
      });
    }
    const grossPnl = grossProceeds - costRemoved;
    if (grossPnl > 0n) {
      entries.push({ accountCode: "TRADING_PNL", direction: "CREDIT", amountLamports: grossPnl });
    } else if (grossPnl < 0n) {
      entries.push({ accountCode: "TRADING_PNL", direction: "DEBIT", amountLamports: -grossPnl });
    }
    await insertJournal(client, {
      id: `journal:${prefix}:${fillId}`,
      competitionAccountId: input.competitionAccountId,
      operationType: input.executionContext === "FORCED_HOURLY_SETTLEMENT" ? "FORCED_HOURLY_SETTLEMENT_SELL" : "AUTHORITATIVE_SIMULATED_SELL",
      sourceEntityType: "FILL",
      sourceEntityId: fillId,
      idempotencyRecordId: claimed.record.id,
      entries
    });
    await database2.commitMarketExecution?.(client, { accountId: input.competitionAccountId, roundId: authority.hourly_round_id, fillId, execution: prepared.execution, executionContext: input.executionContext });
    if (input.persistedSettlementStep) {
      if (input.executionContext !== "FORCED_HOURLY_SETTLEMENT" || !database2.commitPersistedSettlementStep)
        throw new FinancialServiceError("SETTLEMENT_REVIEW", "Persisted settlement participant is required.");
      await database2.commitPersistedSettlementStep(client, { accountId: input.competitionAccountId, roundId: authority.hourly_round_id, positionId: positionRow.id, quantityBefore, basisBefore: costBefore, fillId, idempotencyKey: input.idempotencyKey, execution: prepared.execution, evidence: prepared.evidence });
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      "AUTHORITATIVE_SELL_FILL",
      fillId,
      input.competitionAccountId
    );
    return getAuthoritativePaperSellResult(client, fillId);
  });
}
async function executePaperSell(database2, router2, input) {
  return executeAuthoritativePaperSell(database2, router2, {
    ...input,
    executionContext: "NORMAL_USER"
  });
}
async function executePaperSellAll(database2, router2, input) {
  const requestHash = fingerprint({
    competitionAccountId: input.competitionAccountId,
    marketId: input.marketId,
    requestedTokenQuantity: "ALL",
    executionContext: "NORMAL_USER"
  });
  const existing = await database2.pool.connect();
  try {
    const record = (await existing.query(
      `select id, request_hash, status, result_entity_type, result_entity_id
         from idempotency_records
         where operation_class = 'AUTHORITATIVE_PAPER_SELL_ALL' and idempotency_key = $1`,
      [input.idempotencyKey]
    )).rows[0];
    if (record) {
      if (record.request_hash !== requestHash) {
        throw new FinancialServiceError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used with a different request."
        );
      }
      if (record.status === "COMPLETED" && record.result_entity_id) {
        return await getAuthoritativePaperSellResult(existing, record.result_entity_id);
      }
    }
  } finally {
    existing.release();
  }
  const row = (await database2.pool.query(
    `select remaining_base_units from positions
       where competition_account_id = $1 and market_id = $2 and status = 'OPEN'`,
    [input.competitionAccountId, input.marketId]
  )).rows[0];
  if (!row) {
    throw new FinancialServiceError(
      "INSUFFICIENT_TOKEN_BALANCE",
      "No open token balance exists for SELL ALL."
    );
  }
  return executeAuthoritativePaperSell(database2, router2, {
    ...input,
    requestedTokenQuantity: BigInt(row.remaining_base_units),
    executionContext: "NORMAL_USER",
    idempotencyIntent: "ALL"
  });
}
var ONE_TIME_DUST_RESOLUTION = Object.freeze({
  reason: "OPERATOR_APPROVED_DUST_RESOLUTION_V1",
  roundId: "hourly:2026-10-10T23:00:00.000Z",
  marketId: "FHYwo1cVWX2NyixiK22jpM7N1RA1A35qGszMG7v6sYBf",
  mint: "FB5ViYXcLNSEcy8R2Jg1DmJwP36mizZsPKvAprM8pump",
  accountId: "account:hourly:2026-10-10T23:00:00.000Z:user:feb89522289b86e10f3bcaf3a54231c823690d2a5904fc5e80c137c8cbece4f8",
  positionId: "position:account:hourly:2026-10-10T23:00:00.000Z:user:feb89522289b86e10f3bcaf3a54231c823690d2a5904fc5e80c137c8cbece4f8:FHYwo1cVWX2NyixiK22jpM7N1RA1A35qGszMG7v6sYBf"
});

// packages/db/src/competition-service.ts
async function getCurrentRound(database2, now) {
  const result = await database2.pool.query(
    `select id, starts_at, ends_at_exclusive, state, starting_paper_sol_lamports,
            max_unique_tokens, max_buy_ratio_bps, reward_finalization_grace_period_seconds
     from hourly_rounds where starts_at <= $1 and ends_at_exclusive > $1 limit 1`,
    [now]
  );
  const row = result.rows[0];
  return row ? {
    id: row.id,
    startsAt: row.starts_at,
    endsAtExclusive: row.ends_at_exclusive,
    state: row.state,
    startingPaperSolLamports: BigInt(row.starting_paper_sol_lamports),
    maxUniqueTokens: row.max_unique_tokens,
    maxBuyRatioBps: row.max_buy_ratio_bps,
    rewardFinalizationGracePeriodSeconds: row.reward_finalization_grace_period_seconds
  } : null;
}
async function enterCurrentRound(database2, input) {
  const round = await getCurrentRound(database2, input.now);
  if (!round || round.state !== "OPEN") {
    throw new FinancialServiceError("ROUND_NOT_OPEN", "The current hourly round is not open.");
  }
  return initializeCompetitionAccount(database2, {
    accountId: `account:${round.id}:${input.userId}`,
    userId: input.userId,
    hourlyRoundId: round.id,
    idempotencyKey: `round-entry:${round.id}:${input.userId}`,
    requireOpenAt: input.now
  });
}
async function getCurrentDailyCompetition(database2, now) {
  const result = await database2.pool.query(
    `select d.id, d.utc_date::text, d.starts_at, d.ends_at_exclusive, d.state,
            count(distinct dr.user_id)::int participant_count,
            count(dr.id)::int result_count
     from daily_competitions d left join daily_results dr on dr.daily_competition_id = d.id
     where d.starts_at <= $1 and d.ends_at_exclusive > $1
     group by d.id limit 1`,
    [now]
  );
  const row = result.rows[0];
  return row ? {
    id: row.id,
    utcDate: row.utc_date,
    startsAt: row.starts_at,
    endsAtExclusive: row.ends_at_exclusive,
    state: row.state,
    participantCount: row.participant_count,
    resultCount: row.result_count
  } : null;
}

// packages/db/src/creator-fee-ingestion.ts
import { safeErrorMessage } from "./packages/core/dist/index.js";
import { createHash as createHash4 } from "node:crypto";
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, WRAPPED_SOL_MINT } from "./packages/protocols/dist/index.js";
import bs58 from "./node_modules/bs58/src/cjs/index.cjs";
import { PublicKey } from "./node_modules/@solana/web3.js/lib/index.cjs.js";

// packages/db/src/reward-service.ts
import { createHash as createHash3 } from "node:crypto";
import {
  competitionConfig as competitionConfig2,
  identifier as identifier3,
  isHourlyRewardEconomicsConserved,
  processHourlyRewardEconomics,
  validateCompetitionConfig
} from "./packages/core/dist/index.js";
var defaultRewardAccountingConfig = {
  allocationMode: "NORMAL",
  baselineWindow: 12,
  lambdaBps: 6000n,
  configurationVersion: "phase-5a-v1"
};
var RewardAccountingError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
function runtimeCompetitionConfig(config2) {
  return validateCompetitionConfig({
    ...competitionConfig2,
    version: config2.configurationVersion,
    rewardBuffer: {
      ...competitionConfig2.rewardBuffer,
      baselineWindowCompletedHours: config2.baselineWindow,
      lambdaBps: config2.lambdaBps
    }
  });
}
function exactPool(row) {
  return {
    id: row.id,
    hourlyRoundId: row.hourly_round_id,
    creatorFeeLamports: BigInt(row.creator_fee_lamports),
    allocationMode: row.allocation_mode,
    naturalHourlyLamports: BigInt(row.natural_hourly_lamports),
    explicitBufferContributionLamports: BigInt(row.explicit_buffer_contribution_lamports),
    dailyAllocationLamports: BigInt(row.daily_allocation_lamports),
    platformAllocationLamports: BigInt(row.platform_allocation_lamports),
    baselineLamports: row.baseline_lamports === null ? null : BigInt(row.baseline_lamports),
    baselineInputRoundIds: row.baseline_input_round_ids,
    baselineWindow: row.baseline_window,
    lambdaBps: BigInt(row.lambda_bps),
    splitRatesBps: {
      hourly: BigInt(row.hourly_rate_bps),
      daily: BigInt(row.daily_rate_bps),
      buffer: BigInt(row.buffer_rate_bps),
      platform: BigInt(row.platform_rate_bps)
    },
    finalizationGraceSeconds: row.finalization_grace_seconds,
    dynamicTargetLamports: BigInt(row.dynamic_target_lamports),
    dynamicBufferDepositLamports: BigInt(row.dynamic_buffer_deposit_lamports),
    dynamicBufferSupportLamports: BigInt(row.dynamic_buffer_support_lamports),
    finalHourlyPrizeLamports: BigInt(row.final_hourly_prize_lamports),
    startingBufferLamports: BigInt(row.starting_buffer_lamports),
    endingBufferLamports: BigInt(row.ending_buffer_lamports),
    configurationVersion: row.configuration_version,
    status: row.status,
    finalizedAt: row.finalized_at,
    frozenAt: row.frozen_at,
    ...row.starts_at ? { startsAt: row.starts_at } : {},
    ...row.ends_at_exclusive ? { endsAtExclusive: row.ends_at_exclusive } : {}
  };
}
async function loadPool(client, roundId) {
  return (await client.query(
    `select p.*, r.starts_at, r.ends_at_exclusive
       from hourly_reward_pools p join hourly_rounds r on r.id = p.hourly_round_id
       where p.hourly_round_id = $1`,
    [roundId]
  )).rows[0];
}
async function getHourlyRewardPool(database2, roundId, config2 = defaultRewardAccountingConfig) {
  const client = await database2.pool.connect();
  try {
    const row = await loadPool(client, roundId);
    return row ? exactPool(row) : getProvisionalHourlyRewardPool(database2, roundId, config2);
  } finally {
    client.release();
  }
}
async function getProvisionalHourlyRewardPool(database2, roundId, rewardConfig = defaultRewardAccountingConfig) {
  const row = (await database2.pool.query(
    `select r.id,r.starts_at,r.ends_at_exclusive,
              coalesce(sum(e.creator_fee_lamports) filter (
                where e.verification_status = 'VERIFIED' and e.accounting_status = 'ATTRIBUTED'
              ),0)::text verified_fees
       from hourly_rounds r left join creator_fee_events e on e.hourly_round_id = r.id
       where r.id = $1 group by r.id`,
    [roundId]
  )).rows[0];
  if (!row) return null;
  const config2 = runtimeCompetitionConfig(rewardConfig);
  const split = processHourlyRewardEconomics({
    creatorFeeLamports: BigInt(row.verified_fees),
    mode: rewardConfig.allocationMode,
    currentBufferLamports: 0n,
    previousCompletedNaturalHourlyRewards: [],
    config: config2
  });
  if (!split.ok)
    throw new RewardAccountingError("REWARD_ECONOMICS_INVALID", "Provisional split failed.");
  return {
    hourlyRoundId: row.id,
    startsAt: row.starts_at,
    endsAtExclusive: row.ends_at_exclusive,
    status: "PROVISIONAL",
    verifiedCreatorFeeLamports: BigInt(row.verified_fees),
    provisionalNaturalHourlyLamports: split.economics.naturalHourlyLamports,
    provisionalDailyAllocationLamports: split.economics.dailyContributionLamports,
    dynamicSmoothingFinal: false
  };
}
async function getCurrentHourlyRewardPool(database2, now, config2 = defaultRewardAccountingConfig) {
  const round = (await database2.pool.query(
    "select id from hourly_rounds where starts_at <= $1 and ends_at_exclusive > $1 limit 1",
    [now]
  )).rows[0];
  return round ? getHourlyRewardPool(database2, round.id, config2) : null;
}
async function getCurrentDailyRewardPool(database2, now, rewardConfig = defaultRewardAccountingConfig) {
  const daily = (await database2.pool.query(
    "select id,starts_at,ends_at_exclusive from daily_competitions where starts_at <= $1 and ends_at_exclusive > $1 limit 1",
    [now]
  )).rows[0];
  if (!daily) return null;
  const frozen = (await database2.pool.query(
    `select coalesce(sum(c.amount_lamports),0)::text accumulated
       from daily_reward_contributions c join daily_reward_pools p on p.id = c.daily_reward_pool_id
       where p.daily_competition_id = $1`,
    [daily.id]
  )).rows[0];
  const provisional = (await database2.pool.query(
    `select coalesce(sum(e.creator_fee_lamports),0)::text amount
       from creator_fee_events e join hourly_rounds r on r.id = e.hourly_round_id
       where r.starts_at >= $1 and r.starts_at < $2
         and e.verification_status = 'VERIFIED' and e.accounting_status = 'ATTRIBUTED'`,
    [daily.starts_at, daily.ends_at_exclusive]
  )).rows[0];
  const split = processHourlyRewardEconomics({
    creatorFeeLamports: BigInt(provisional.amount),
    mode: rewardConfig.allocationMode,
    currentBufferLamports: 0n,
    previousCompletedNaturalHourlyRewards: [],
    config: runtimeCompetitionConfig(rewardConfig)
  });
  if (!split.ok) {
    throw new RewardAccountingError("REWARD_ECONOMICS_INVALID", "Daily provisional split failed.");
  }
  return {
    dailyCompetitionId: daily.id,
    startsAt: daily.starts_at,
    endsAtExclusive: daily.ends_at_exclusive,
    status: "PROVISIONAL",
    frozenContributionsLamports: BigInt(frozen.accumulated),
    provisionalContributionLamports: split.economics.dailyContributionLamports,
    accumulatedLamports: BigInt(frozen.accumulated) + split.economics.dailyContributionLamports
  };
}
async function reconcileHourlyRewardPool(database2, roundId) {
  const pool = await getHourlyRewardPool(database2, roundId);
  if (!pool || !("id" in pool)) return pool;
  const events = (await database2.pool.query(
    `select id,transaction_signature,event_index,slot,event_time,creator_fee_lamports,
              source_program,token_project_identity,observed_at,accounting_status
       from creator_fee_events where hourly_round_id = $1 and accounting_status = 'COUNTED'
       order by event_time,transaction_signature,event_index`,
    [roundId]
  )).rows;
  const movements = (await database2.pool.query(
    `select reason,amount_lamports,starting_balance_lamports,ending_balance_lamports
       from reward_buffer_movements where hourly_reward_pool_id = $1 order by created_at,id`,
    [pool.id]
  )).rows;
  return {
    ...pool,
    verifiedFeeEvents: events,
    bufferMovements: movements,
    conservation: {
      leftLamports: pool.creatorFeeLamports + pool.startingBufferLamports,
      rightLamports: pool.finalHourlyPrizeLamports + pool.dailyAllocationLamports + pool.platformAllocationLamports + pool.endingBufferLamports,
      holds: pool.creatorFeeLamports + pool.startingBufferLamports === pool.finalHourlyPrizeLamports + pool.dailyAllocationLamports + pool.platformAllocationLamports + pool.endingBufferLamports
    }
  };
}

// packages/db/src/creator-fee-ingestion.ts
var PUMP_TRADE_EVENT = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
var PUMP_BUY = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
var PUMP_BUY_EXACT_SOL_IN = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]);
var PUMP_SELL = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
var PUMP_BUY_V2 = Buffer.from([184, 23, 238, 97, 103, 197, 211, 61]);
var PUMP_BUY_EXACT_QUOTE_IN_V2 = Buffer.from([194, 171, 28, 70, 104, 77, 91, 47]);
var PUMP_SELL_V2 = Buffer.from([93, 246, 130, 60, 231, 233, 64, 178]);
var PUMP_BUY_V3 = Buffer.from([7, 5, 29, 196, 245, 23, 101, 80]);
var PUMP_BUY_EXACT_QUOTE_IN_V3 = Buffer.from([225, 247, 80, 30, 213, 179, 132, 136]);
var PUMP_SELL_V3 = Buffer.from([28, 146, 222, 119, 38, 196, 105, 213]);
var PUMP_AMM_BUY_EVENT = Buffer.from([103, 244, 82, 31, 44, 245, 119, 119]);
var PUMP_AMM_SELL_EVENT = Buffer.from([62, 47, 55, 10, 165, 3, 220, 42]);
var PUMP_AMM_BUY_EXACT_QUOTE_IN = Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]);

// packages/db/src/payout-treasury.ts
import { AsyncLocalStorage } from "node:async_hooks";
import {
  competitionConfig as competitionConfig3,
  processHourlyRewardEconomics as processHourlyRewardEconomics2
} from "./packages/core/dist/index.js";

// packages/db/src/payout-approval.ts
import { createHash as createHash5 } from "node:crypto";
import { PublicKey as PublicKey2 } from "./node_modules/@solana/web3.js/lib/index.cjs.js";
import { buildPayoutBatches } from "./packages/core/dist/index.js";

// packages/db/src/payout-treasury.ts
var scope = new AsyncLocalStorage();

// packages/db/src/payout-security.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
import { createPublicKey, verify } from "node:crypto";
var current = new AsyncLocalStorage2();

// packages/db/src/payout-execution.ts
import { buildPayoutBatches as buildPayoutBatches2, PAYOUT_INTENT_VERSION } from "./packages/core/dist/index.js";
import {
  Connection,
  PublicKey as PublicKey3,
  SystemInstruction,
  SystemProgram,
  Transaction
} from "./node_modules/@solana/web3.js/lib/index.cjs.js";
import bs582 from "./node_modules/bs58/src/cjs/index.cjs";

// packages/db/src/generic-capability.ts
import { randomUUID } from "node:crypto";
import { ExecutionEngineError as ExecutionEngineError2 } from "./packages/execution/dist/index.js";
import { genericActor } from "./packages/protocols/dist/index.js";
var KEY = "generic_pumpswap_operator_control_v1";
var ID = /^user:[a-f0-9]{64}$/;
function deny(reason) {
  throw new ExecutionEngineError2("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
}
function genericCapabilityOptions(config2) {
  const c = config2;
  return {
    armed: c["GENERIC_PUMPSWAP_ENABLED"] === true,
    entries: c["GENERIC_PUMPSWAP_BUYS_ENABLED"] === true,
    normalUserAccess: c["GENERIC_PUMPSWAP_NORMAL_USER_ACCESS_ENABLED"] === true,
    operatorIds: Array.isArray(c["GENERIC_PUMPSWAP_OPERATOR_USER_IDS"]) ? c["GENERIC_PUMPSWAP_OPERATOR_USER_IDS"] : [],
    entrySeconds: typeof c["GENERIC_PUMPSWAP_ENTRY_SECONDS"] === "number" ? c["GENERIC_PUMPSWAP_ENTRY_SECONDS"] : 900
  };
}
var GenericCapability = class {
  constructor(db, options, now = Date.now) {
    this.db = db;
    this.options = options;
    this.now = now;
    if (options.operatorIds.length > 1 || options.operatorIds.some((id) => !ID.test(id)))
      throw Error("GENERIC_OPERATOR_SCOPE_INVALID");
    if (options.entries && (!options.armed || options.operatorIds.length === 0))
      throw Error("GENERIC_ENTRY_REQUIRES_OPERATOR");
    this.controllers = new Set(options.operatorIds);
  }
  db;
  options;
  now;
  controllers;
  async mode() {
    if (!this.options.armed) return "HARD_STOP";
    const r = await this.db.pool.query({
      text: "select value from app_meta where key=$1",
      values: [KEY],
      query_timeout: 600
    });
    if (!r.rows[0]) return "EXIT_ONLY";
    try {
      const v = JSON.parse(r.rows[0].value);
      if (v.schema !== "GENERIC_OPERATOR_CONTROL_V1") return "HARD_STOP";
      if (v.mode === "HARD_STOP" || v.mode === "EXIT_ONLY") return v.mode;
      if (v.mode === "ENTRY" && typeof v.expiresAt === "number")
        return v.expiresAt > this.now() ? "ENTRY" : "EXIT_ONLY";
    } catch {
    }
    return "HARD_STOP";
  }
  async status(userId) {
    const mode = await this.mode();
    return {
      userId,
      armed: this.options.armed,
      // Compatibility field now describes uniform trading access, not a role.
      entitled: this.options.armed && this.options.normalUserAccess === true,
      canControl: this.controllers.has(userId),
      mode,
      entriesEnabled: this.options.armed && this.options.entries && this.options.normalUserAccess === true && mode === "ENTRY",
      exitPolicy: "OWNED_IMMUTABLE_GENERIC_FILL_AND_FRESH_ROUTE"
    };
  }
  async control(userId, mode) {
    if (!this.controllers.has(userId)) deny("GENERIC_OPERATOR_ENTITLEMENT_REQUIRED");
    if (!this.options.armed) deny("GENERIC_CAPABILITY_NOT_ARMED");
    if (mode === "ENTRY" && (!this.options.entries || this.options.normalUserAccess !== true))
      deny("GENERIC_ENTRY_NOT_ARMED");
    if (!["ENTRY", "EXIT_ONLY", "HARD_STOP"].includes(mode)) deny("GENERIC_CONTROL_INVALID");
    const record = {
      schema: "GENERIC_OPERATOR_CONTROL_V1",
      mode,
      actorUserId: userId,
      version: randomUUID(),
      at: new Date(this.now()).toISOString(),
      expiresAt: mode === "ENTRY" ? this.now() + this.options.entrySeconds * 1e3 : null
    };
    await this.db.pool.query(
      "insert into app_meta(key,value) values($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()",
      [KEY, JSON.stringify(record)]
    );
    return this.status(userId);
  }
  async exitPosition(mint, userId, system, accountId, forSettlement) {
    const r = await this.db.pool.query({
      text: `select f.protocol_id protocol,e.protocol_id evidence_protocol,e.adapter_version adapter,e.normalization_version normalization,e.normalized_state->'stage1Snapshot'->>'quoteMint' quote,
    e.normalized_state->'stage1Snapshot'->>'bridgePool' bridge,e.normalized_state->'stage1Snapshot'->>'targetPool' target,
    e.normalized_state->'stage1Snapshot'->>'mint' mint
    from positions p join competition_accounts ca on ca.id=p.competition_account_id join hourly_rounds h on h.id=ca.hourly_round_id join assets a on a.id=p.asset_id
    join lateral(select x.* from fills x join orders o on o.id=x.order_id join markets m on m.id=x.market_id
      where o.competition_account_id=ca.id and m.base_asset_id=p.asset_id and x.side='BUY' and x.base_quantity>0 and o.status='COMPLETED'
      order by x.executed_at desc,x.id desc limit 1) f on true
    join market_state_evidence e on e.id=f.market_state_evidence_id and e.market_id=f.market_id and e.protocol_id=f.protocol_id
    where a.mint_address=$1 and p.status='OPEN' and p.remaining_base_units>0
      and ($3::boolean or ca.user_id=$2::text) and ($4::text is null or ca.id=$4::text)
      and ca.final_settled_balance_lamports is null
      and (($6::boolean and h.state='SETTLING' and h.ends_at_exclusive<=$5)
        or (not $6::boolean and h.state='OPEN' and h.starts_at<=$5 and h.ends_at_exclusive>$5))
    order by f.executed_at desc,f.id desc limit 1`,
      values: [
        mint,
        userId ?? null,
        system,
        accountId ?? null,
        new Date(this.now()),
        forSettlement
      ],
      query_timeout: 600
    });
    const row = r.rows[0];
    if (!row) return void 0;
    if (row.protocol !== row.evidence_protocol || !row.adapter || !row.normalization)
      deny("GENERIC_EXIT_EVIDENCE_INVALID");
    if (row.protocol !== "GENERIC_PUMP_SWAP") return { binding: void 0 };
    if (row.evidence_protocol !== "GENERIC_PUMP_SWAP" || row.adapter !== "generic-pump-swap-orca-v1" || row.normalization !== "generic-pump-swap-accounts-v1" || row.mint !== mint || !row.quote || !row.bridge || !row.target)
      deny("GENERIC_EXIT_EVIDENCE_INVALID");
    return { binding: { quoteMint: row.quote, bridgePool: row.bridge, targetPool: row.target } };
  }
  async resolve(mint, quote, forSettlement) {
    if (!this.options.armed) return { discover: false, buy: false };
    const actor = genericActor(), system = this.options.systemSettlement === true && forSettlement || actor?.systemRead === true;
    if (!actor?.userId && !system) return { discover: false, buy: false };
    if (system && !actor?.accountId) deny("GENERIC_SYSTEM_ACCOUNT_SCOPE_REQUIRED");
    if (actor?.accountId && !system) {
      const own = await this.db.pool.query(
        "select id from competition_accounts where id=$1 and user_id=$2",
        [actor.accountId, actor.userId]
      );
      if (!own.rows[0]) deny("GENERIC_ACCOUNT_OWNER_MISMATCH");
    }
    const mode = await this.mode();
    if (mode === "HARD_STOP") deny("GENERIC_HARD_STOP");
    const eligible = !!actor?.userId && this.options.normalUserAccess === true, position = await this.exitPosition(
      mint,
      actor?.userId,
      system,
      actor?.accountId,
      forSettlement
    ), binding = position?.binding;
    if (binding && binding.quoteMint !== quote) deny("GENERIC_EXIT_QUOTE_CHANGED");
    const buy = !system && eligible && this.options.entries && mode === "ENTRY";
    const authorizeLive = async (kind) => {
      if (kind === "BUY" && actor?.intent !== "BUY") deny("GENERIC_READ_SCOPE_CANNOT_EXECUTE");
      if (kind === "SELL" && !forSettlement && actor?.intent !== "SELL")
        deny("GENERIC_READ_SCOPE_CANNOT_EXECUTE");
      const fresh = await this.mode();
      if (fresh === "HARD_STOP") deny("GENERIC_HARD_STOP");
      if (kind === "BUY" && (!buy || !this.options.entries || this.options.normalUserAccess !== true || fresh !== "ENTRY"))
        deny("GENERIC_OPERATOR_ENTRY_DISABLED");
      if (kind === "SELL") {
        const current2 = await this.exitPosition(
          mint,
          actor?.userId,
          system,
          actor?.accountId,
          forSettlement
        );
        if (!position || !current2) deny("GENERIC_OWNED_EXIT_EVIDENCE_REQUIRED");
        if (JSON.stringify(current2.binding) !== JSON.stringify(binding))
          deny("GENERIC_EXIT_EVIDENCE_CHANGED");
      }
    };
    if (binding) return { discover: false, buy, exitBinding: binding, authorizeLive };
    if (position || eligible && !system) return { discover: true, buy, authorizeLive };
    return { discover: false, buy: false };
  }
};

// apps/api/src/main.ts
import {
  createProductionExecutionRouter,
  advisoryReadContext,
  rpcProviderIdentity
} from "./packages/protocols/dist/index.js";

// apps/api/src/safe-diagnostics.ts
import { redactDiagnostic, safeErrorMessage as safeErrorMessage2 } from "./packages/core/dist/index.js";
var sources = () => [process.env["SOLANA_RPC_URL"], process.env["SOLANA_WS_URL"]];
var safeApiDiagnostic = (value, context) => redactDiagnostic(value, [...sources(), context]);
var safeApiErrorMessage = (error) => safeErrorMessage2(error, sources());
function safeApiSerializedError(error) {
  const safe = safeApiDiagnostic(error);
  const fields = safe && typeof safe === "object" ? safe : {};
  return {
    ...fields,
    type: typeof fields["name"] === "string" ? fields["name"] : "Error",
    message: typeof fields["message"] === "string" ? fields["message"] : "[Diagnostic error]",
    stack: typeof fields["stack"] === "string" ? fields["stack"] : ""
  };
}
function safeLogArgument(value, context) {
  const safe = safeApiDiagnostic(value, context);
  if (!value || typeof value !== "object" || !safe || typeof safe !== "object") return safe;
  try {
    const fields = safe;
    const own = Object.getOwnPropertyDescriptors(value);
    const request = own["req"];
    if (request && "value" in request) {
      const req = request.value;
      fields["req"] = safeApiDiagnostic(
        { id: req.id, method: req.method, url: req.url, hostname: req.hostname, ip: req.ip },
        context
      );
    }
    const response = own["res"];
    if (response && "value" in response) {
      const res = response.value;
      fields["res"] = safeApiDiagnostic({ statusCode: res.statusCode }, context);
    }
    return fields;
  } catch {
    return "[Log diagnostic unavailable]";
  }
}
function safeApiLoggerOptions(level) {
  return {
    level,
    hooks: {
      logMethod(args, method) {
        method.apply(
          this,
          args.map((value) => safeLogArgument(value, args))
        );
      }
    },
    serializers: { err: safeApiSerializedError, error: safeApiSerializedError }
  };
}

// apps/api/src/app.ts
import { withGenericActor } from "./packages/protocols/dist/index.js";
import { randomUUID as randomUUID3 } from "node:crypto";
import fastify from "./node_modules/fastify/fastify.js";
import { ExecutionEngineError as ExecutionEngineError3 } from "./packages/execution/dist/index.js";

// apps/api/src/auth.ts
import { createHash as createHash6, createPublicKey as createPublicKey2, randomBytes, randomUUID as randomUUID2, verify as verify2 } from "node:crypto";
var BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function decodeBase58(value) {
  if (!value || [...value].some((character) => !BASE58_ALPHABET.includes(character))) {
    throw new Error("Invalid base58 value.");
  }
  let number = 0n;
  for (const character of value) {
    number = number * 58n + BigInt(BASE58_ALPHABET.indexOf(character));
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number % 256n));
    number /= 256n;
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}
function isSolanaPublicKey(value) {
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}
function decodeSignature(value) {
  try {
    const base58 = decodeBase58(value);
    if (base58.length === 64) return base58;
  } catch {
  }
  const base64 = Buffer.from(value, "base64");
  if (base64.length !== 64 || base64.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error("Signature must be a 64-byte base58 or base64 value.");
  }
  return base64;
}
var AuthService = class {
  constructor(database2, redis2, challengeTtlSeconds, sessionTtlSeconds, now = () => /* @__PURE__ */ new Date()) {
    this.database = database2;
    this.redis = redis2;
    this.challengeTtlSeconds = challengeTtlSeconds;
    this.sessionTtlSeconds = sessionTtlSeconds;
    this.now = now;
  }
  database;
  redis;
  challengeTtlSeconds;
  sessionTtlSeconds;
  now;
  async createChallenge(walletAddress) {
    if (!isSolanaPublicKey(walletAddress)) throw new Error("Invalid Solana wallet address.");
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + this.challengeTtlSeconds * 1e3);
    const nonce = randomBytes(32).toString("base64url");
    const challengeId = randomUUID2();
    const message = [
      "Paperfund Authentication",
      "Purpose: Sign in to Paperfund (message only; no transaction)",
      `Wallet: ${walletAddress}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expires At: ${expiresAt.toISOString()}`
    ].join("\n");
    const record = { walletAddress, message, expiresAt: expiresAt.toISOString() };
    await this.redis.setExpiring(
      `auth:challenge:${challengeId}`,
      JSON.stringify(record),
      this.challengeTtlSeconds
    );
    return { challengeId, message, issuedAt, expiresAt };
  }
  async verifyChallenge(input) {
    if (!isSolanaPublicKey(input.walletAddress)) throw new Error("Invalid Solana wallet address.");
    const raw = await this.redis.take(`auth:challenge:${input.challengeId}`);
    if (!raw) throw new Error("Challenge is invalid, expired, or already used.");
    const challenge = JSON.parse(raw);
    if (challenge.walletAddress !== input.walletAddress || challenge.message !== input.message || this.now() >= new Date(challenge.expiresAt))
      throw new Error("Challenge validation failed.");
    const publicKey = createPublicKey2({
      key: Buffer.concat([ED25519_SPKI_PREFIX, decodeBase58(input.walletAddress)]),
      format: "der",
      type: "spki"
    });
    if (!verify2(
      null,
      Buffer.from(challenge.message, "utf8"),
      publicKey,
      decodeSignature(input.signature)
    )) {
      throw new Error("Wallet signature is invalid.");
    }
    const id = `user:${createHash6("sha256").update(input.walletAddress).digest("hex")}`;
    await this.database.pool.query(
      `insert into users (id, wallet_address) values ($1, $2)
       on conflict (wallet_address) do nothing`,
      [id, input.walletAddress]
    );
    const user = (await this.database.pool.query(
      "select id, wallet_address from users where wallet_address = $1",
      [input.walletAddress]
    )).rows[0];
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + this.sessionTtlSeconds * 1e3);
    const session = {
      id: user.id,
      walletAddress: user.wallet_address,
      expiresAt: expiresAt.toISOString()
    };
    await this.redis.setExpiring(
      `auth:session:${token}`,
      JSON.stringify(session),
      this.sessionTtlSeconds
    );
    return { token, user: { id: session.id, walletAddress: session.walletAddress }, expiresAt };
  }
  async authenticate(token) {
    if (!token) return null;
    const raw = await this.redis.get(`auth:session:${token}`);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return this.now() < new Date(session.expiresAt) ? { id: session.id, walletAddress: session.walletAddress } : null;
  }
  async logout(token) {
    if (token) await this.redis.delete(`auth:session:${token}`);
  }
};

// apps/api/src/app.ts
var ApiError = class extends Error {
  constructor(code, message, statusCode = 400, details) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
  code;
  statusCode;
  details;
};
function exactJson(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(exactJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, exactJson(item)]));
  }
  return value;
}
function cookieValue(request, name) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        throw new ApiError("INVALID_REQUEST", "Session cookie is invalid.");
      }
    }
  }
  return void 0;
}
function sessionToken(request) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return cookieValue(request, "paperfund_session");
}
function stringField(body, key, maxLength) {
  if (!body || typeof body !== "object")
    throw new ApiError("INVALID_REQUEST", "Request body must be an object.");
  const value = body[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new ApiError("INVALID_REQUEST", `${key} is invalid.`, 400, { field: key });
  }
  return value;
}
function idempotencyKey(request) {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new ApiError(
      "INVALID_REQUEST",
      "Idempotency-Key header is required and must be at most 128 characters."
    );
  }
  return value.trim();
}
function pagination(query) {
  const record = query ?? {};
  const parsed = record["limit"] === void 0 ? 25 : Number(record["limit"]);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ApiError("INVALID_REQUEST", "limit must be an integer from 1 to 100.");
  }
  const cursor = record["cursor"];
  if (cursor !== void 0 && (typeof cursor !== "string" || cursor.length > 512)) {
    throw new ApiError("INVALID_REQUEST", "cursor is invalid.");
  }
  return { limit: parsed, ...typeof cursor === "string" ? { cursor } : {} };
}
var statusByCode = {
  UNAUTHENTICATED: 401,
  PAPER_BUY_DISABLED: 403,
  INVALID_REQUEST: 400,
  INVALID_FINANCIAL_INPUT: 400,
  INVALID_SELL_QUANTITY: 400,
  ROUND_NOT_OPEN: 409,
  SETTLEMENT_REVIEW: 409,
  PAYOUT_SETTLEMENT_REVIEW: 409,
  OUTSIDE_ROUND_WINDOW: 409,
  INSUFFICIENT_PAPER_SOL: 409,
  INSUFFICIENT_BALANCE: 409,
  INSUFFICIENT_TOKEN_BALANCE: 409,
  INSUFFICIENT_POSITION: 409,
  MAX_BUY_RATIO_EXCEEDED: 409,
  TOKEN_SLOT_LIMIT_REACHED: 409,
  MARKET_STATE_UNAVAILABLE: 503,
  MARKET_ACCOUNT_NOT_FOUND: 422,
  INVALID_MARKET_STATE: 422,
  INVALID_EXECUTION_RESULT: 503,
  INSUFFICIENT_EXECUTABLE_LIQUIDITY: 409,
  ZERO_EXECUTABLE_OUTPUT: 409,
  RPC_TIMEOUT: 503,
  RPC_ERROR: 503,
  RPC_UNAVAILABLE: 503,
  MARKET_MIGRATED: 409,
  MIGRATION_DESTINATION_UNAVAILABLE: 503,
  UNSUPPORTED_MIGRATED_PROTOCOL: 422,
  POSITION_EXECUTION_ROUTE_UNAVAILABLE: 503,
  UNSUPPORTED_PROTOCOL: 422,
  UNSUPPORTED_MARKET: 422,
  PROTOCOL_DISABLED: 503,
  IDEMPOTENCY_CONFLICT: 409,
  ENTITY_NOT_FOUND: 404,
  FINALIZATION_CONFLICT: 409,
  PAYOUT_SOURCE_NOT_FOUND: 404,
  PAYOUT_PLAN_NOT_FOUND: 404,
  PAYOUT_SOURCE_NOT_READY: 409,
  PAYOUT_SOURCE_NOT_FINAL: 409,
  DAILY_REWARD_NOT_READY: 409
};
function buildApp(dependencies) {
  const app2 = fastify({
    logger: dependencies.logger === false ? false : safeApiLoggerOptions(dependencies.config.LOG_LEVEL),
    // Only the local Cloudflare Tunnel may supply the forwarding chain.
    trustProxy: ["127.0.0.1", "::1"],
    genReqId: () => randomUUID3()
  });
  const fullConfig = dependencies.config;
  const allowedOrigins = new Set(
    (fullConfig.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean)
  );
  const betaWallets = new Set(fullConfig.BETA_WALLET_ALLOWLIST ?? []);
  if ([...betaWallets].some((wallet) => !isSolanaPublicKey(wallet)))
    throw new Error("Invalid public wallet in beta allowlist.");
  function requireBetaInvite(wallet) {
    if (fullConfig.BETA_INVITE_ONLY && !betaWallets.has(wallet))
      throw new ApiError(
        "BETA_INVITE_REQUIRED",
        "This private beta requires an invited wallet.",
        403
      );
  }
  app2.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("cache-control", "no-store");
    reply.header("vary", "Origin");
    const origin = request.headers.origin;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && (origin && !allowedOrigins.has(origin) || !origin && request.headers["sec-fetch-site"] === "cross-site" && !request.headers.authorization?.startsWith("Bearer ")))
      throw new ApiError("ORIGIN_NOT_ALLOWED", "Request origin is not allowed.", 403);
    if (origin && allowedOrigins.has(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
      reply.header("access-control-allow-headers", "Content-Type,Authorization,Idempotency-Key");
      return reply.code(204).send();
    }
  });
  app2.setErrorHandler((error, request, reply) => {
    const domainError = error instanceof ApiError || error instanceof FinancialServiceError || error instanceof PayoutPlanError || error instanceof RewardAccountingError || error instanceof ExecutionEngineError3;
    const frameworkStatus = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : void 0;
    const invalidFrameworkRequest = frameworkStatus !== void 0 && frameworkStatus >= 400 && frameworkStatus < 500;
    const code = domainError ? error.code : invalidFrameworkRequest ? "INVALID_REQUEST" : "INTERNAL_ERROR";
    const status = error instanceof ApiError ? error.statusCode : invalidFrameworkRequest ? frameworkStatus : statusByCode[code] ?? 500;
    if (status >= 500) request.log.error({ err: error, code }, "API request failed");
    else request.log.warn({ code }, "API request rejected");
    return reply.code(status).send({
      error: {
        code: safeApiDiagnostic(code, error),
        message: domainError ? safeApiErrorMessage(error) : invalidFrameworkRequest ? "Request is invalid." : "An internal error occurred.",
        ...error instanceof ApiError && error.details ? { details: safeApiDiagnostic(error.details, error) } : {},
        requestId: request.id
      }
    });
  });
  app2.get("/health", async () => ({ status: "ok", application: "paperfund-api" }));
  app2.get("/ready", async (_request, reply) => {
    const [databaseReady, redisReady] = await Promise.all([
      dependencies.database.healthCheck(),
      dependencies.redis.healthCheck()
    ]);
    const services = {
      database: databaseReady ? "ok" : "unavailable",
      redis: redisReady ? "ok" : "unavailable"
    };
    const ready = databaseReady && redisReady;
    if (!ready) app2.log.warn({ services }, "Infrastructure readiness check failed");
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ok" : "unavailable", services });
  });
  if (!dependencies.auth || !dependencies.competition) return app2;
  const auth2 = dependencies.auth;
  const competition2 = dependencies.competition;
  async function user(request) {
    const authenticated = await auth2.authenticate(sessionToken(request));
    if (!authenticated) throw new ApiError("UNAUTHENTICATED", "Authentication is required.", 401);
    requireBetaInvite(authenticated.walletAddress);
    return authenticated;
  }
  const scoped = (owner, intent, work) => withGenericActor(
    {
      userId: owner.id,
      intent,
      isolateCaptures: dependencies.genericCapability?.options.armed === true
    },
    work
  );
  app2.get("/api/v1/capabilities/generic-pumpswap", async (request, reply) => {
    const owner = await user(request);
    reply.header("cache-control", "no-store");
    if (!dependencies.genericCapability)
      return {
        userId: owner.id,
        armed: false,
        entitled: false,
        mode: "HARD_STOP",
        entriesEnabled: false
      };
    return dependencies.genericCapability.status(owner.id);
  });
  app2.post("/api/v1/capabilities/generic-pumpswap/control", async (request, reply) => {
    const owner = await user(request);
    reply.header("cache-control", "no-store");
    const body = request.body;
    if (!body || Object.keys(body).length !== 1 || !["ENTRY", "EXIT_ONLY", "HARD_STOP"].includes(String(body["mode"])))
      throw new ApiError("INVALID_REQUEST", "Only an exact generic control mode is accepted.");
    if (!dependencies.genericCapability)
      throw new ApiError(
        "GENERIC_CAPABILITY_NOT_CONFIGURED",
        "Generic control is not configured.",
        503
      );
    try {
      const result = await dependencies.genericCapability.control(
        owner.id,
        body["mode"]
      );
      request.log.info({ event: "generic_mode_changed", actorUserId: owner.id, mode: result.mode });
      return result;
    } catch (error) {
      if (error instanceof ExecutionEngineError3)
        throw new ApiError(
          error.message,
          error.message,
          error.message === "GENERIC_OPERATOR_ENTITLEMENT_REQUIRED" ? 403 : 409
        );
      throw error;
    }
  });
  function rateLimit(scope2) {
    return async (request) => {
      if (!dependencies.redis.incrementWindow) return;
      const max = scope2 === "auth" ? fullConfig.API_RATE_LIMIT_AUTH_MAX ?? 20 : fullConfig.API_RATE_LIMIT_TRADE_MAX ?? 30;
      const subject = request.ip;
      const count = await dependencies.redis.incrementWindow(
        `rate:${scope2}:${subject}`,
        fullConfig.API_RATE_LIMIT_WINDOW_SECONDS ?? 60
      );
      if (count > max) throw new ApiError("RATE_LIMITED", "Too many requests.", 429);
    };
  }
  app2.post("/api/v1/auth/challenge", { preHandler: rateLimit("auth") }, async (request, reply) => {
    const walletAddress = stringField(request.body, "walletAddress", 64);
    if (!isSolanaPublicKey(walletAddress))
      throw new ApiError("INVALID_REQUEST", "walletAddress is not a Solana public key.");
    requireBetaInvite(walletAddress);
    return reply.send(exactJson(await auth2.createChallenge(walletAddress)));
  });
  app2.post("/api/v1/auth/verify", { preHandler: rateLimit("auth") }, async (request, reply) => {
    try {
      const transport = request.body && typeof request.body === "object" ? request.body["transport"] : void 0;
      if (transport !== void 0 && transport !== "extension") {
        throw new ApiError("INVALID_REQUEST", "transport is invalid.");
      }
      requireBetaInvite(stringField(request.body, "walletAddress", 64));
      const result = await auth2.verifyChallenge({
        walletAddress: stringField(request.body, "walletAddress", 64),
        challengeId: stringField(request.body, "challengeId", 64),
        message: stringField(request.body, "message", 2048),
        signature: stringField(request.body, "signature", 128)
      });
      if (transport !== "extension") {
        const sameSite = fullConfig.COOKIE_SAME_SITE ?? "lax";
        const secure = fullConfig.COOKIE_SECURE === true;
        reply.header(
          "set-cookie",
          `paperfund_session=${encodeURIComponent(result.token)}; Path=/; HttpOnly; Max-Age=${fullConfig.AUTH_SESSION_TTL_SECONDS ?? 86400}; SameSite=${sameSite}${secure ? "; Secure" : ""}`
        );
      }
      return reply.send(
        exactJson({
          user: result.user,
          expiresAt: result.expiresAt,
          ...transport === "extension" ? { sessionToken: result.token } : {}
        })
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("INVALID_REQUEST", safeApiErrorMessage(error));
    }
  });
  app2.post("/api/v1/auth/logout", async (request, reply) => {
    await auth2.logout(sessionToken(request));
    reply.header("set-cookie", "paperfund_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
    return reply.code(204).send();
  });
  app2.get("/api/v1/auth/me", async (request) => ({ user: await user(request) }));
  app2.get("/api/v1/rounds/current", async () => {
    const now = /* @__PURE__ */ new Date();
    return exactJson({ round: await competition2.getCurrentRound(), serverTime: now });
  });
  app2.post(
    "/api/v1/rounds/current/enter",
    async (request) => exactJson(await competition2.enterRound((await user(request)).id))
  );
  app2.get("/api/v1/rounds/current/account", async (request) => {
    const account = await competition2.getCurrentAccount((await user(request)).id);
    if (!account)
      throw new ApiError(
        "ROUND_ACCOUNT_NOT_FOUND",
        "The authenticated wallet has not entered the current round.",
        404
      );
    return exactJson({
      accountId: account.id,
      roundId: account.hourly_round_id,
      paperSolLamports: account.paper_sol_balance_lamports,
      startingPaperSolLamports: account.starting_paper_sol_lamports,
      realizedPnlLamports: account.realized_pnl_lamports,
      slotsUsed: account.slots_used,
      slotLimit: account.max_unique_tokens,
      roundState: account.state,
      positions: account.positions.map((position) => ({
        id: position.id,
        mint: position.mint_address,
        originMarketId: position.market_id,
        originProtocol: position.venue,
        tokenDecimals: position.decimals,
        tokenQuantityBaseUnits: position.remaining_base_units,
        costBasisPaperSolLamports: position.cost_basis_lamports,
        realizedPnlLamports: position.realized_pnl_lamports,
        ...position.updated_at ? { updatedAt: position.updated_at } : {},
        valuation: {
          status: "UNAVAILABLE",
          reason: "VALUATION_NOT_REQUESTED",
          valuedAt: /* @__PURE__ */ new Date()
        }
      }))
    });
  });
  app2.post("/api/v1/trades/buy", { preHandler: rateLimit("trade") }, async (request) => {
    const authenticated = await user(request);
    const mint = stringField(request.body, "mint", 64);
    if (!isSolanaPublicKey(mint)) throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    const result = await scoped(
      authenticated,
      "BUY",
      () => competition2.buy(authenticated.id, {
        mint,
        paperSol: stringField(request.body, "paperSol", 32),
        idempotencyKey: idempotencyKey(request)
      })
    );
    request.log.info(
      {
        userId: authenticated.id,
        roundAccountId: result.competitionAccountId,
        orderId: result.orderId,
        mint,
        protocol: result.protocolId,
        executionId: result.executionId
      },
      "Paper BUY completed"
    );
    return exactJson({
      orderId: result.orderId,
      fillId: result.fillId,
      executionId: result.executionId,
      tokenMint: mint,
      executionProtocol: result.protocolId,
      requestedPaperSolLamports: result.requestedPaperSolLamports,
      actualPaperSolSpentLamports: result.actualPaperSolInputLamports,
      tokenQuantityReceivedBaseUnits: result.actualTokenOutputBaseUnits,
      feeLamports: result.feeLamports,
      evidenceFingerprint: result.marketStateFingerprint,
      newCashBalanceLamports: result.paperSolBalanceLamports,
      newPositionQuantityBaseUnits: result.position.remainingBaseUnits,
      costBasisPaperSolLamports: result.position.costBasisLamports,
      executedAt: result.executedAt
    });
  });
  app2.get("/api/v1/trades/buy-preflight", async (request, reply) => {
    const mint = request.query.mint;
    if (typeof mint !== "string" || !isSolanaPublicKey(mint)) {
      throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    }
    const controller = new AbortController();
    const close = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.on("close", close);
    try {
      const owner = await user(request);
      return exactJson(
        await scoped(
          owner,
          "READ",
          () => competition2.buyPreflight(
            owner.id,
            mint,
            AbortSignal.any([controller.signal, AbortSignal.timeout(14e3)])
          )
        )
      );
    } finally {
      reply.raw.removeListener("close", close);
    }
  });
  app2.post("/api/v1/trades/sell", { preHandler: rateLimit("trade") }, async (request) => {
    const authenticated = await user(request);
    const mint = stringField(request.body, "mint", 64);
    if (!isSolanaPublicKey(mint)) throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    const quantity = stringField(request.body, "quantity", 80);
    if (quantity !== "ALL" && !/^[1-9][0-9]*$/.test(quantity))
      throw new ApiError("INVALID_REQUEST", "quantity must be positive base units or ALL.");
    const result = await scoped(
      authenticated,
      "SELL",
      () => competition2.sell(authenticated.id, {
        mint,
        quantity,
        idempotencyKey: idempotencyKey(request)
      })
    );
    request.log.info(
      {
        userId: authenticated.id,
        roundAccountId: result.competitionAccountId,
        orderId: result.orderId,
        mint,
        protocol: result.protocolId,
        executionId: result.executionId
      },
      "Paper SELL completed"
    );
    return exactJson({
      orderId: result.orderId,
      fillId: result.fillId,
      executionId: result.executionId,
      tokenMint: mint,
      executionProtocol: result.protocolId,
      tokenAmountSoldBaseUnits: result.actualTokenInputBaseUnits,
      grossPaperSolLamports: result.actualNetPaperSolOutputLamports + result.feeLamports,
      feeLamports: result.feeLamports,
      paperSolCreditedLamports: result.actualNetPaperSolOutputLamports,
      costBasisRemovedLamports: result.costBasisLamportsRemoved,
      realizedPnlLamports: result.fillRealizedPnlLamports,
      remainingQuantityBaseUnits: result.position.remainingBaseUnits,
      remainingCostBasisLamports: result.position.costBasisLamports,
      newCashBalanceLamports: result.paperSolBalanceLamports,
      evidenceFingerprint: result.marketStateFingerprint,
      executedAt: result.executedAt
    });
  });
  app2.get("/api/v1/trades", async (request) => {
    const mint = request.query.mint;
    if (mint !== void 0 && (typeof mint !== "string" || !isSolanaPublicKey(mint)))
      throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    return exactJson(
      await competition2.trades((await user(request)).id, pagination(request.query), mint)
    );
  });
  app2.get("/api/v1/positions/viewed", async (request, reply) => {
    const mint = request.query.mint;
    if (typeof mint !== "string" || !isSolanaPublicKey(mint))
      throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3e3)]);
    const disconnected = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.on("close", disconnected);
    const wait = (task) => new Promise((resolve, reject) => {
      const abort = () => reject(
        new ApiError("ADVISORY_DEADLINE_EXCEEDED", "Live valuation deadline exceeded.", 503)
      );
      if (signal.aborted) {
        void task.catch(() => {
        });
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      void task.then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        }
      );
    });
    try {
      const owner = await wait(user(request));
      reply.header("cache-control", "no-store");
      if (dependencies.redis.incrementWindow) {
        const count = await wait(
          dependencies.redis.incrementWindow(`rate:valuation:${owner.id}`, 60)
        );
        if (count > (fullConfig.API_RATE_LIMIT_VALUATION_MAX ?? 240)) {
          reply.header("retry-after", "60");
          throw new ApiError("RATE_LIMITED", "Advisory refresh rate exceeded.", 429);
        }
      }
      signal.throwIfAborted();
      return exactJson({
        ...await wait(
          scoped(owner, "READ", () => competition2.viewedPosition(owner.id, mint, signal))
        ),
        requestId: request.id
      });
    } finally {
      reply.raw.removeListener("close", disconnected);
    }
  });
  app2.get("/api/v1/positions", async (request, reply) => {
    const controller = new AbortController();
    const close = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.on("close", close);
    let result;
    try {
      const owner = await user(request);
      result = await scoped(
        owner,
        "READ",
        () => competition2.getPositions(
          owner.id,
          AbortSignal.any([controller.signal, AbortSignal.timeout(14e3)])
        )
      );
    } finally {
      reply.raw.removeListener("close", close);
    }
    if (!result)
      throw new ApiError(
        "ROUND_ACCOUNT_NOT_FOUND",
        "The authenticated wallet has not entered the current round.",
        404
      );
    return exactJson({
      accountId: result.accountId,
      roundId: result.roundId,
      cashLamports: result.cashLamports,
      startingPaperSolLamports: result.startingPaperSolLamports,
      valuationStatus: result.valuationStatus,
      executablePositionsLamports: result.executablePositionsLamports,
      portfolioEquityLamports: result.portfolioEquityLamports,
      livePnlLamports: result.livePnlLamports,
      valuedAt: result.valuedAt,
      positions: result.positions.map((position) => ({
        id: position.id,
        mint: position.mint_address,
        originMarketId: position.market_id,
        originProtocol: position.venue,
        tokenDecimals: position.decimals,
        tokenQuantityBaseUnits: position.remaining_base_units,
        costBasisPaperSolLamports: position.cost_basis_lamports,
        realizedPnlLamports: position.realized_pnl_lamports,
        ...position.updated_at ? { updatedAt: position.updated_at } : {},
        valuation: position.valuation,
        sellPreflight: position.sellPreflight
      }))
    });
  });
  app2.get(
    "/api/v1/results/hourly",
    async (request) => exactJson(await competition2.hourlyResults((await user(request)).id, pagination(request.query)))
  );
  app2.get(
    "/api/v1/leaderboards/daily",
    async () => exactJson(await competition2.dailyLeaderboard())
  );
  app2.get("/api/v1/leaderboards/hourly/live", async (request) => {
    const roundId = request.query.roundId;
    if (roundId !== void 0 && (typeof roundId !== "string" || roundId.length > 128))
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(
      await competition2.liveHourlyLeaderboard(typeof roundId === "string" ? roundId : void 0)
    );
  });
  app2.get("/api/v1/leaderboards/hourly", async (request) => {
    const roundId = request.query.roundId;
    if (roundId !== void 0 && (typeof roundId !== "string" || roundId.length > 128))
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(
      await competition2.hourlyLeaderboard(typeof roundId === "string" ? roundId : void 0)
    );
  });
  app2.get(
    "/api/v1/competitions/daily/current",
    async () => exactJson({ competition: await competition2.currentDailyCompetition(), serverTime: /* @__PURE__ */ new Date() })
  );
  app2.get(
    "/api/v1/rewards/hourly/current",
    async () => exactJson(await competition2.currentHourlyRewardPool())
  );
  app2.get("/api/v1/rewards/hourly/:roundId", async (request) => {
    const roundId = request.params.roundId;
    if (roundId.length === 0 || roundId.length > 128)
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(await competition2.hourlyRewardPool(roundId));
  });
  app2.get("/api/v1/rewards/hourly/:roundId/reconciliation", async (request) => {
    const roundId = request.params.roundId;
    if (roundId.length === 0 || roundId.length > 128)
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(await competition2.rewardReconciliation(roundId));
  });
  app2.get(
    "/api/v1/rewards/daily/current",
    async () => exactJson(await competition2.currentDailyRewardPool())
  );
  app2.get("/api/v1/rewards/hourly/:roundId/winners", async (request) => {
    const roundId = request.params.roundId;
    if (roundId.length === 0 || roundId.length > 128)
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(await competition2.hourlyPayoutWinners(roundId));
  });
  app2.get("/api/v1/rewards/daily/:idOrDate/winners", async (request) => {
    const idOrDate = request.params.idOrDate;
    if (idOrDate.length === 0 || idOrDate.length > 128)
      throw new ApiError("INVALID_REQUEST", "Daily competition identifier is invalid.");
    return exactJson(await competition2.dailyPayoutWinners(idOrDate));
  });
  app2.get("/api/v1/payout-plans/:planId", async (request) => {
    const planId = request.params.planId;
    if (planId.length === 0 || planId.length > 512)
      throw new ApiError("INVALID_REQUEST", "Payout plan identifier is invalid.");
    return exactJson(await competition2.payoutPlan(planId));
  });
  app2.get(
    "/api/v1/rewards/me",
    async (request) => exactJson(await competition2.userRewardAllocations((await user(request)).id))
  );
  app2.get("/api/v1/chart-metadata/:context", async (request) => {
    await user(request);
    const context = request.params.context;
    if (!isSolanaPublicKey(context)) throw new ApiError("INVALID_REQUEST", "context is invalid.");
    try {
      return exactJson(await competition2.chartMetadata(context));
    } catch (error) {
      const reason = safeApiErrorMessage(error);
      if ([
        "CHART_TOKEN_METADATA_MISSING",
        "INVALID_TOKEN_DECIMALS",
        "AUTHORITATIVE_SUPPLY_UNAVAILABLE"
      ].includes(reason))
        throw new ApiError(reason, reason, 503);
      throw error;
    }
  });
  app2.get("/api/v1/markets/:mint", async (request, reply) => {
    const mint = request.params.mint;
    if (!isSolanaPublicKey(mint)) throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    const controller = new AbortController();
    const close = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.on("close", close);
    let result;
    try {
      const owner = await auth2.authenticate(sessionToken(request));
      result = owner ? await scoped(owner, "READ", () => competition2.marketSupport(mint, controller.signal)) : await competition2.marketSupport(mint, controller.signal);
    } finally {
      reply.raw.removeListener("close", close);
    }
    controller.signal.throwIfAborted();
    request.log[result.supported ? "info" : "warn"]({
      event: "market_resolution",
      requestedContext: mint,
      resolvedMint: result.mint,
      supported: result.supported,
      ..."diagnostics" in result ? { diagnostics: result.diagnostics, reason: result.reason } : {}
    });
    return exactJson(
      "diagnostics" in result ? {
        ...result,
        diagnostics: safeApiDiagnostic(result.diagnostics),
        reason: safeApiDiagnostic(result.reason, result.diagnostics)
      } : result
    );
  });
  return app2;
}

// apps/api/src/competition.ts
import { withGenericSystemRead } from "./packages/protocols/dist/index.js";
import { withAdvisoryRead as withAdvisoryRead2 } from "./packages/protocols/dist/index.js";
import { createHash as createHash9 } from "node:crypto";

// apps/api/src/advisory-valuations.ts
import {
  ExecutionEngineError as ExecutionEngineError4
} from "./packages/execution/dist/index.js";
import { genericActor as genericActor2, withAdvisoryRead } from "./packages/protocols/dist/index.js";

// apps/api/src/exit-preflight.ts
import { canonicalExitPreflight as canonicalExitPreflight2 } from "./packages/execution/dist/index.js";
async function exitPreflight(...args) {
  const { evidence, ...result } = await canonicalExitPreflight2(...args);
  void evidence;
  return result;
}

// apps/api/src/advisory-valuations.ts
var emptyMetrics = () => ({ rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 });
var AdvisoryValuations = class {
  constructor(source, now = Date.now, limits = { maxConcurrent: 4, backgroundConcurrent: 2 }) {
    this.source = source;
    this.now = now;
    this.limits = limits;
  }
  source;
  now;
  limits;
  recent = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  slots = /* @__PURE__ */ new Map();
  cooldownUntil = 0;
  get retryAfterMs() {
    return Math.max(0, this.cooldownUntil - Date.now());
  }
  active = 0;
  background = 0;
  get concurrent() {
    return this.active;
  }
  invalidate() {
    this.recent.clear();
  }
  async capture(identity, priority, signal) {
    signal?.throwIfAborted();
    const actor = genericActor2();
    const key = JSON.stringify(identity) + (actor?.isolateCaptures ? JSON.stringify([actor.userId ?? "system", actor.accountId ?? null]) : "");
    const saved = this.recent.get(key);
    if (saved && saved.until > this.now())
      return {
        ...saved,
        route: { ...saved.route, state: structuredClone(saved.route.state) },
        shared: true
      };
    this.recent.delete(key);
    if (this.retryAfterMs > 0) throw new Error("ADVISORY_RATE_LIMITED");
    let entry = this.pending.get(key);
    const shared = !!entry;
    if (!entry) {
      if (this.active >= this.limits.maxConcurrent || priority === "background" && this.background >= Math.min(this.limits.backgroundConcurrent, this.limits.maxConcurrent - 1))
        throw new ExecutionEngineError4("MARKET_STATE_UNAVAILABLE", "ADVISORY_BUSY");
      this.active++;
      if (priority === "background") this.background++;
      const controller = new AbortController();
      const deadline = setTimeout(
        () => controller.abort(new Error("ADVISORY_DEADLINE_EXCEEDED")),
        2200
      );
      const metrics = emptyMetrics();
      const previousSlot = this.slots.get(key);
      const context = {
        signal: controller.signal,
        metrics,
        ...previousSlot !== void 0 ? { minimumSlot: previousSlot } : {}
      };
      const started = performance.now();
      const value = withAdvisoryRead(context, () => this.source.loadPositionRoute(identity));
      const current2 = {
        controller,
        refs: 0,
        value: Promise.resolve({})
      };
      current2.value = this.wait(value, controller.signal).then((route) => {
        const slot = route.state.chainSlot;
        if (slot === null || slot > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error("SNAPSHOT_SLOT_UNAVAILABLE");
        if (previousSlot !== void 0 && slot < BigInt(previousSlot))
          throw new Error("SNAPSHOT_SLOT_REGRESSION");
        const chainTime = route.state.normalizedState["chainTime"];
        if (typeof chainTime === "string" && (!Number.isFinite(Date.parse(chainTime)) || this.now() - Date.parse(chainTime) > 2500 || Date.parse(chainTime) > this.now() + 1e3))
          throw new Error("SNAPSHOT_FRESHNESS_UNAVAILABLE");
        if (this.now() - Date.parse(route.state.observedAt) > 2200)
          throw new Error("SNAPSHOT_EXPIRED");
        if (this.slots.size >= 256) this.slots.delete(this.slots.keys().next().value);
        this.slots.set(key, Number(slot));
        const result = { route, metrics, routeMs: performance.now() - started };
        if (this.recent.size >= 256) this.recent.delete(this.recent.keys().next().value);
        this.recent.set(key, { ...result, until: this.now() + 250 });
        return result;
      }).finally(() => {
        this.cooldownUntil = Math.max(this.cooldownUntil, metrics.rateLimitedUntil ?? 0);
        clearTimeout(deadline);
        if (this.pending.get(key) === current2) this.pending.delete(key);
        this.active--;
        if (priority === "background") this.background--;
      });
      void current2.value.catch(() => {
      });
      this.pending.set(key, current2);
      entry = current2;
    }
    entry.refs++;
    try {
      const result = await this.wait(entry.value, signal);
      return {
        ...result,
        route: { ...result.route, state: structuredClone(result.route.state) },
        shared
      };
    } finally {
      entry.refs--;
      if (entry.refs === 0 && this.pending.get(key) === entry)
        entry.controller.abort(new Error("ADVISORY_NO_CONSUMERS"));
    }
  }
  wait(value, signal) {
    if (!signal) return value;
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      void value.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  router(priority = "background", signal) {
    return {
      loadPositionRoute: async (identity) => (await this.capture(identity, priority, signal)).route
    };
  }
  async preflight(identity, quantity, basis, priority = "background", signal) {
    const requested = performance.now();
    const capture = await this.capture(identity, priority, signal);
    const waited = performance.now() - requested;
    const started = performance.now();
    const exit = await withAdvisoryRead(
      { signal: signal ?? AbortSignal.timeout(2200), metrics: emptyMetrics() },
      () => exitPreflight(
        { loadPositionRoute: async () => capture.route },
        identity,
        quantity,
        basis
      )
    );
    return {
      exit,
      chainTime: typeof capture.route.state.normalizedState["chainTime"] === "string" ? capture.route.state.normalizedState["chainTime"] : null,
      metrics: {
        ...capture.metrics,
        routeMs: waited,
        captureRouteMs: capture.routeMs,
        captureRpcRequests: capture.metrics.rpcRequests,
        captureRpcMs: capture.metrics.rpcMs,
        rpcRequests: capture.shared ? 0 : capture.metrics.rpcRequests,
        rpcMs: capture.shared ? 0 : capture.metrics.rpcMs,
        quoteMs: performance.now() - started,
        shared: capture.shared,
        concurrent: this.active
      }
    };
  }
};

// apps/api/src/competition.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import {
  basisPoints as basisPoints2,
  calculateEffectiveMaxBuy,
  calculateMaxBuyByRatio,
  calculatePortfolioEquity,
  identifier as identifier5,
  paperSolBaseUnits as paperSolBaseUnits2,
  paperSolFromSolString
} from "./packages/core/dist/index.js";
import {
  ExecutionEngineError as ExecutionEngineError5,
  executionRouteRecord
} from "./packages/execution/dist/index.js";
import {
  PUMP_FUN_PROTOCOL_ID,
  WRAPPED_SOL_MINT as WRAPPED_SOL_MINT2,
  pumpBondingCurveAddress,
  chartMintSupply
} from "./packages/protocols/dist/index.js";

// apps/api/src/live-leaderboard.ts
import { genericActor as genericActor3, withGenericAccount as withGenericAccount2 } from "./packages/protocols/dist/index.js";
import { identifier as identifier4 } from "./packages/core/dist/index.js";
async function buildLiveStandings(database2, router2, roundId) {
  const accounts = (await database2.pool.query(
    `select ca.id account_id, ca.user_id, u.wallet_address, ca.paper_sol_balance_lamports::text cash,
       ca.starting_paper_sol_lamports::text starting,
       (select count(*)::int from competition_token_slots s where s.competition_account_id = ca.id) slots,
       coalesce((select json_agg(json_build_object('market', p.market_id, 'venue', m.venue,
         'mint', a.mint_address, 'quantity', p.remaining_base_units::text, 'basis', p.cost_basis_lamports::text))
         from positions p join markets m on m.id = p.market_id join assets a on a.id = p.asset_id
         where p.competition_account_id = ca.id and p.status = 'OPEN'), '[]'::json) positions
     from competition_accounts ca join users u on u.id = ca.user_id
     where ca.hourly_round_id = $1 order by ca.user_id limit 1001`,
    [roundId]
  )).rows;
  if (accounts.length > 1e3)
    return {
      status: "UNAVAILABLE",
      reason: "LIVE_CAPACITY_LIMIT",
      entries: []
    };
  const routes = /* @__PURE__ */ new Map();
  const readRouter = {
    loadPositionRoute(identity) {
      const actor = genericActor3();
      const key = JSON.stringify(identity) + (actor?.isolateCaptures ? "::" + actor.accountId : "");
      if (!routes.has(key)) routes.set(key, router2.loadPositionRoute(identity));
      return routes.get(key);
    }
  };
  let next = 0;
  let failed = false;
  const entries = [];
  await Promise.all(
    Array.from({ length: Math.min(4, accounts.length) }, async () => {
      while (next < accounts.length) {
        const account = accounts[next++];
        try {
          let equity = BigInt(account.cash);
          for (const position of account.positions) {
            const value = await withGenericAccount2(
              account.account_id ?? "",
              () => exitPreflight(
                readRouter,
                {
                  protocolId: identifier4(position.venue, "ProtocolId"),
                  marketId: identifier4(position.market, "MarketId"),
                  tokenMint: identifier4(position.mint, "TokenMint")
                },
                BigInt(position.quantity),
                BigInt(position.basis)
              )
            );
            if (!value.full.executable) throw new Error("Full-exit valuation unavailable");
            equity += value.full.outputLamports;
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
            tieGroupSize: 1
          });
        } catch {
          failed = true;
        }
      }
    })
  );
  if (failed)
    return {
      status: "UNAVAILABLE",
      reason: "POSITION_VALUATION_UNAVAILABLE",
      entries: []
    };
  entries.sort(
    (a, b) => BigInt(a.score) === BigInt(b.score) ? a.user_id.localeCompare(b.user_id) : BigInt(a.score) > BigInt(b.score) ? -1 : 1
  );
  const counts = /* @__PURE__ */ new Map();
  for (const row of entries) counts.set(row.score, (counts.get(row.score) ?? 0) + 1);
  let rank = 0;
  entries.forEach((row, index2) => {
    if (index2 === 0 || entries[index2 - 1].score !== row.score) rank = index2 + 1;
    row.rank = rank;
    row.tieGroupSize = counts.get(row.score);
    row.tied = row.tieGroupSize > 1;
  });
  return { status: "AVAILABLE", reason: null, entries };
}

// apps/api/src/chart-fx-live.ts
import { createHash as createHash7 } from "node:crypto";
var CAPTURED_FX_VERSION = "CAPTURED_EXECUTION_FX_V1";
var COINBASE_FX_SOURCE = "COINBASE_SOL_USD_LAST_TRADE";
var unavailable = (reason) => ({ status: "UNAVAILABLE", reason });
var CoinbaseExecutionFxProvider = class {
  constructor(fetcher = fetch, now = Date.now) {
    this.fetcher = fetcher;
    this.now = now;
  }
  fetcher;
  now;
  latest;
  requests = [];
  async lookup(time) {
    const target = time.getTime();
    if (!Number.isFinite(target) || Math.abs(this.now() - target) > 5e3)
      return unavailable("CAPTURED_FX_EXECUTION_WINDOW_EXPIRED");
    if (!this.latest || this.latest.expires < this.now())
      this.latest = { expires: this.now() + 250, value: this.read(target) };
    const result = await this.latest.value;
    if (result.status !== "AVAILABLE") return result;
    if (Math.abs(Date.parse(result.fxAt) - target) > 5e3) return unavailable("STALE_CAPTURED_FX");
    return { ...result, requestedAt: new Date(Math.floor(target / 1e3) * 1e3).toISOString() };
  }
  async read(target) {
    let failure = "CAPTURED_FX_PROVIDER_UNAVAILABLE";
    for (let attempt = 0; attempt < 2; attempt++) {
      this.requests = this.requests.filter((t) => this.now() - t < 1e3);
      if (this.requests.length >= 5) return unavailable("CAPTURED_FX_RATE_LIMITED");
      this.requests.push(this.now());
      try {
        const response = await this.fetcher(
          attempt === 0 ? "https://api.exchange.coinbase.com/products/SOL-USD/ticker" : "https://api.exchange.coinbase.com/products/SOL-USD/trades?limit=100",
          { signal: AbortSignal.timeout(700) }
        );
        if (!response.ok) {
          if (response.status !== 429 && response.status < 500)
            return unavailable("CAPTURED_FX_PROVIDER_REJECTED");
        } else {
          const payload = await response.json();
          const retrieved = this.now();
          const candidates = attempt === 0 ? [payload] : Array.isArray(payload) ? payload : [];
          failure = "INVALID_CAPTURED_FX";
          for (const item of candidates.slice(0, 100)) {
            if (!item || typeof item !== "object") continue;
            const raw = item;
            if (typeof raw.price !== "string" || !/^\d+(?:\.\d{1,18})?$/.test(raw.price) || BigInt(raw.price.replace(".", "")) <= 0n || typeof raw.trade_id !== "number" || !Number.isSafeInteger(raw.trade_id) || raw.trade_id < 0 || typeof raw.time !== "string")
              continue;
            const observed = Date.parse(raw.time);
            if (!Number.isFinite(observed)) continue;
            if (observed > retrieved + 1e3 || retrieved - observed > 5e3 || Math.abs(observed - target) > 5e3) {
              failure = "STALE_CAPTURED_FX";
              continue;
            }
            return {
              status: "AVAILABLE",
              version: CAPTURED_FX_VERSION,
              source: COINBASE_FX_SOURCE,
              feedId: "SOL-USD",
              requestedAt: "",
              fxAt: raw.time,
              rate: raw.price,
              retrievedAt: new Date(retrieved).toISOString(),
              sourceObservationId: String(raw.trade_id),
              responseHash: createHash7("sha256").update(JSON.stringify(item)).digest("hex")
            };
          }
        }
      } catch {
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return unavailable(failure);
  }
};

// apps/api/src/chart-fx.ts
import { createHash as createHash8 } from "node:crypto";
var SOL_USD_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
var CHART_FX_VERSION = "HISTORICAL_FX_AT_EXECUTION_V1";
var unavailable2 = (reason) => ({ status: "UNAVAILABLE", reason });
var PythHistoricalFxProvider = class {
  constructor(key = () => process.env["PYTH_API_KEY"], fetcher = fetch, now = Date.now) {
    this.key = key;
    this.fetcher = fetcher;
    this.now = now;
  }
  key;
  fetcher;
  now;
  cache = /* @__PURE__ */ new Map();
  requests = [];
  lookup(time) {
    const seconds = Math.floor(time.getTime() / 1e3);
    if (!Number.isSafeInteger(seconds) || seconds < 0)
      return Promise.resolve(unavailable2("INVALID_FILL_TIMESTAMP"));
    if (!this.key()) return Promise.resolve(unavailable2("HISTORICAL_FX_PROVIDER_NOT_CONFIGURED"));
    const cached = this.cache.get(seconds);
    if (cached && cached.expires > this.now()) return cached.value;
    const value = this.read(seconds);
    if (this.cache.size >= 1e3) this.cache.delete(this.cache.keys().next().value);
    const item = { expires: this.now() + 3e4, value };
    this.cache.set(seconds, item);
    void value.then((result) => {
      if (result.status === "AVAILABLE") item.expires = Infinity;
    });
    return value;
  }
  async read(seconds) {
    for (let attempt = 0; attempt < 3; attempt++) {
      this.requests = this.requests.filter((t) => this.now() - t < 1e4);
      if (this.requests.length >= 10) return unavailable2("HISTORICAL_FX_RATE_LIMITED");
      this.requests.push(this.now());
      try {
        const response = await this.fetcher(
          `https://pyth.dourolabs.app/hermes/v2/updates/price/${seconds}?ids[]=${SOL_USD_FEED}`,
          {
            headers: { Authorization: `Bearer ${this.key()}` },
            signal: AbortSignal.timeout(700)
          }
        );
        if (!response.ok) {
          if (response.status === 401 || response.status === 403)
            return unavailable2("HISTORICAL_FX_PROVIDER_UNAUTHORIZED");
          if (response.status === 404) return unavailable2("HISTORICAL_FX_UNAVAILABLE");
          if (response.status !== 429 && response.status < 500)
            return unavailable2("HISTORICAL_FX_PROVIDER_REJECTED");
          if (attempt === 2) return unavailable2("HISTORICAL_FX_PROVIDER_UNAVAILABLE");
        } else {
          const raw = await response.json();
          const quote = raw.parsed?.find((p) => p.id === SOL_USD_FEED)?.price;
          if (!quote || !/^\d+$/.test(quote.price) || BigInt(quote.price) <= 0n || !/^\d+$/.test(quote.conf) || BigInt(quote.conf) >= BigInt(quote.price) || !Number.isInteger(quote.expo) || Math.abs(quote.expo) > 18 || !Number.isSafeInteger(quote.publish_time) || quote.publish_time < seconds || quote.publish_time - seconds > 5)
            return unavailable2("INVALID_HISTORICAL_FX");
          const digits = quote.price.padStart(-quote.expo + 1, "0");
          const rate = quote.expo >= 0 ? quote.price + "0".repeat(quote.expo) : `${digits.slice(0, quote.expo)}.${digits.slice(quote.expo)}`;
          return {
            status: "AVAILABLE",
            version: CHART_FX_VERSION,
            source: "PYTH_HERMES_TIMESTAMP",
            feedId: SOL_USD_FEED,
            requestedAt: new Date(seconds * 1e3).toISOString(),
            fxAt: new Date(quote.publish_time * 1e3).toISOString(),
            rate,
            rawPrice: quote.price,
            exponent: quote.expo,
            confidence: quote.conf,
            retrievedAt: new Date(this.now()).toISOString(),
            responseHash: createHash8("sha256").update(JSON.stringify(raw)).digest("hex")
          };
        }
      } catch {
        if (attempt === 2) return unavailable2("HISTORICAL_FX_PROVIDER_UNAVAILABLE");
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
    return unavailable2("HISTORICAL_FX_UNAVAILABLE");
  }
};
var provider = new PythHistoricalFxProvider();
async function historicalFillFx(database2, fillId, time, source) {
  try {
    const saved = (await database2.pool.query(
      "select evidence from chart_fill_fx_evidence where fill_id = $1 and version = any($2::text[]) order by version limit 1",
      [fillId, [CAPTURED_FX_VERSION, CHART_FX_VERSION]]
    )).rows[0];
    if (saved) return saved.evidence;
    if (!source) {
      const failure = (await database2.pool.query(
        "select reason from chart_fill_fx_capture_failures where fill_id=$1 and version=$2",
        [fillId, CAPTURED_FX_VERSION]
      )).rows[0];
      return unavailable2(failure?.reason ?? "HISTORICAL_FX_NOT_CAPTURED");
    }
    const result = await source.lookup(time);
    if (result.status !== "AVAILABLE") return result;
    await database2.pool.query(
      `insert into chart_fill_fx_evidence(fill_id,version,executed_at,source,fx_at,rate,evidence)
      select id,$3,executed_at,$4,$5,$6,$7::jsonb from fills where id=$1 and executed_at=$2
      on conflict (fill_id,version) do nothing`,
      [
        fillId,
        time,
        result.version,
        result.source,
        result.fxAt,
        result.rate,
        JSON.stringify({ ...result, fillTimestamp: time.toISOString() })
      ]
    );
    return (await database2.pool.query(
      "select evidence from chart_fill_fx_evidence where fill_id = $1 and version = $2",
      [fillId, result.version]
    )).rows[0]?.evidence ?? unavailable2("HISTORICAL_FX_PERSISTENCE_UNAVAILABLE");
  } catch {
    return unavailable2("HISTORICAL_FX_PERSISTENCE_UNAVAILABLE");
  }
}
async function saveCapturedFillFx(database2, fillId, time, observation) {
  try {
    const result = await observation;
    let valid = result;
    if (result.status === "AVAILABLE" && (result.version !== CAPTURED_FX_VERSION || Math.abs(Date.parse(result.fxAt) - time.getTime()) > 5e3 || Date.parse(result.requestedAt) !== Math.floor(time.getTime() / 1e3) * 1e3))
      valid = unavailable2("CAPTURED_FX_NOT_AT_FILL_TIME");
    if (valid.status === "UNAVAILABLE") {
      await database2.pool.query(
        "insert into chart_fill_fx_capture_failures(fill_id,version,status,reason) values($1,$2,$3,$4) on conflict do nothing",
        [fillId, CAPTURED_FX_VERSION, valid.status, valid.reason]
      );
      return historicalFillFx(database2, fillId, time);
    }
    return await historicalFillFx(database2, fillId, time, { lookup: async () => valid });
  } catch {
    return unavailable2("CAPTURED_FX_PERSISTENCE_UNAVAILABLE");
  }
}

// apps/api/src/competition.ts
function unavailableValuation(error, valuedAt) {
  const code = error instanceof ExecutionEngineError5 ? error.code : "MARKET_STATE_UNAVAILABLE";
  const unsupported = [
    "UNSUPPORTED_PROTOCOL",
    "UNSUPPORTED_MIGRATED_PROTOCOL",
    "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
    "MIGRATION_DESTINATION_UNAVAILABLE"
  ].includes(code);
  return {
    status: unsupported ? "UNSUPPORTED_ROUTE" : "UNAVAILABLE",
    reason: code,
    valuedAt
  };
}
function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function decodeCursor(value) {
  if (!value) return null;
  try {
    const result = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof result["timestamp"] !== "string" || typeof result["id"] !== "string")
      throw new Error();
    return { timestamp: result["timestamp"], id: result["id"] };
  } catch {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Pagination cursor is invalid.");
  }
}
function rankRows(rows) {
  const scoreCounts = /* @__PURE__ */ new Map();
  for (const row of rows) scoreCounts.set(row.score, (scoreCounts.get(row.score) ?? 0) + 1);
  let previous = null;
  let rank = 0;
  return rows.map((row, index2) => {
    const score = BigInt(row.score);
    if (previous === null || score !== previous) rank = index2 + 1;
    previous = score;
    const tieGroupSize = scoreCounts.get(row.score);
    return { ...row, rank, tied: tieGroupSize > 1, tieGroupSize };
  });
}
var CompetitionService = class {
  constructor(database2, router2, now = () => /* @__PURE__ */ new Date(), rewardConfig = defaultRewardAccountingConfig, chartFx = new CoinbaseExecutionFxProvider(), advisoryLimits = { maxConcurrent: 4, backgroundConcurrent: 2 }, genericArmed = false) {
    this.database = database2;
    this.router = router2;
    this.now = now;
    this.rewardConfig = rewardConfig;
    this.chartFx = chartFx;
    this.advisoryLimits = advisoryLimits;
    this.genericArmed = genericArmed;
    this.advisory = new AdvisoryValuations(router2, () => this.now().getTime(), advisoryLimits);
  }
  database;
  router;
  now;
  rewardConfig;
  chartFx;
  advisoryLimits;
  genericArmed;
  advisory;
  advisorySqlActive = 0;
  advisoryViews = 0;
  metadataReads = 0;
  liveCache;
  async liveHourlyLeaderboard(roundId) {
    const round = (await this.database.pool.query(
      roundId ? "select id, starts_at, ends_at_exclusive, state from hourly_rounds where id = $1" : "select id, starts_at, ends_at_exclusive, state from hourly_rounds where starts_at <= $1 order by starts_at desc limit 1",
      [roundId ?? this.now()]
    )).rows[0];
    if (!round) return null;
    const serverTime = this.now();
    if (round.state === "FINALIZED") {
      const final = await this.hourlyLeaderboard(round.id);
      return {
        round,
        phase: "FINALIZED",
        status: "AVAILABLE",
        serverTime,
        entries: final.entries,
        reason: null
      };
    }
    if (round.state !== "OPEN" || serverTime >= round.ends_at_exclusive) {
      return {
        round,
        phase: "SETTLING",
        status: "AVAILABLE",
        serverTime,
        entries: [],
        reason: null
      };
    }
    const key = round.id;
    if (!this.liveCache || this.liveCache.key !== key || this.liveCache.expires <= Date.now()) {
      const pending = withGenericSystemRead(
        () => buildLiveStandings(this.database, this.advisory.router(), key),
        this.genericArmed
      );
      const cache = { key, expires: Number.POSITIVE_INFINITY, pending };
      this.liveCache = cache;
      void pending.then(
        () => {
          cache.expires = Date.now() + 2e3;
        },
        () => {
          cache.expires = 0;
        }
      );
    }
    const result = await this.liveCache.pending;
    const fresh = (await this.database.pool.query(
      "select state from hourly_rounds where id = $1",
      [key]
    )).rows[0];
    if (fresh?.state !== "OPEN" || this.now() >= round.ends_at_exclusive) {
      return {
        round: { ...round, state: fresh?.state ?? round.state },
        phase: "SETTLING",
        status: "AVAILABLE",
        serverTime: this.now(),
        entries: [],
        reason: null
      };
    }
    return { round, phase: "LIVE", ...result, serverTime };
  }
  getCurrentRound() {
    return getCurrentRound(this.database, this.now());
  }
  enterRound(userId) {
    return enterCurrentRound(this.database, { userId, now: this.now() });
  }
  async getCurrentAccount(userId) {
    const now = this.now();
    const result = await this.database.pool.query(
      `select ca.id, ca.hourly_round_id, ca.starting_paper_sol_lamports,
              ca.paper_sol_balance_lamports, ca.realized_pnl_lamports, r.state,
              r.max_unique_tokens, r.max_buy_ratio_bps,
              (select count(*)::int from competition_token_slots s where s.competition_account_id = ca.id) slots_used
       from competition_accounts ca join hourly_rounds r on r.id = ca.hourly_round_id
       where ca.user_id = $1 and r.starts_at <= $2 and r.ends_at_exclusive > $2`,
      [userId, now]
    );
    const account = result.rows[0];
    if (!account) return null;
    const positions2 = await this.getPositionsForAccount(account.id);
    return { ...account, positions: positions2 };
  }
  async getPositionsForAccount(accountId) {
    return (await this.database.pool.query(
      `select p.id, p.market_id, a.mint_address, a.decimals, m.venue,
                p.remaining_base_units, p.cost_basis_lamports, p.realized_pnl_lamports, p.updated_at
         from positions p join assets a on a.id = p.asset_id join markets m on m.id = p.market_id
         where p.competition_account_id = $1 and p.status = 'OPEN' order by p.opened_at, p.id`,
      [accountId]
    )).rows;
  }
  async getPositions(userId, signal) {
    const account = await this.getCurrentAccount(userId);
    if (!account) return null;
    const positions2 = await this.valuePositions(account.positions, signal);
    const available = positions2.every(({ valuation }) => valuation.status === "AVAILABLE");
    const conservativeValues = positions2.map(
      ({ valuation, sellPreflight }) => valuation.status === "AVAILABLE" ? valuation.executablePaperSolLamports : sellPreflight?.maxExecutableOutputLamports ?? null
    );
    const conservativelyValued = conservativeValues.every((value) => value !== null);
    const executablePositionsLamports = conservativelyValued ? conservativeValues.reduce((total, value) => total + value, 0n) : null;
    const portfolioEquityLamports = executablePositionsLamports === null ? null : BigInt(account.paper_sol_balance_lamports) + executablePositionsLamports;
    return {
      accountId: account.id,
      roundId: account.hourly_round_id,
      cashLamports: BigInt(account.paper_sol_balance_lamports),
      startingPaperSolLamports: BigInt(account.starting_paper_sol_lamports),
      valuationStatus: available ? "AVAILABLE" : "UNAVAILABLE",
      equityValuationStatus: !conservativelyValued ? "UNAVAILABLE" : available ? "FULL" : "PARTIAL_LIQUIDITY",
      executablePositionsLamports,
      portfolioEquityLamports,
      livePnlLamports: portfolioEquityLamports === null ? null : portfolioEquityLamports - BigInt(account.starting_paper_sol_lamports),
      valuedAt: this.now(),
      positions: positions2
    };
  }
  async valuePositions(positions2, signal) {
    const values = [];
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(2, positions2.length) }, async () => {
        while (cursor < positions2.length) {
          const index2 = cursor++;
          const position = positions2[index2];
          const valuedAt = this.now();
          try {
            signal?.throwIfAborted();
            const { exit } = await this.advisory.preflight(
              {
                protocolId: identifier5(position.venue, "ProtocolId"),
                marketId: identifier5(position.market_id, "MarketId"),
                tokenMint: identifier5(position.mint_address, "TokenMint")
              },
              BigInt(position.remaining_base_units),
              BigInt(position.cost_basis_lamports),
              "background",
              signal
            );
            values[index2] = {
              ...position,
              sellPreflight: exit,
              valuation: exit.full.executable ? {
                status: "AVAILABLE",
                executablePaperSolLamports: exit.full.outputLamports,
                unrealizedPnlLamports: exit.full.outputLamports - BigInt(position.cost_basis_lamports),
                currentProtocol: exit.currentProtocol,
                evidenceFingerprint: exit.evidenceFingerprint,
                observedAt: exit.observedAt,
                chainSlot: exit.chainSlot,
                valuedAt
              } : { status: "UNAVAILABLE", reason: exit.status, valuedAt }
            };
          } catch (error) {
            values[index2] = { ...position, valuation: unavailableValuation(error, valuedAt) };
          }
        }
      })
    );
    return values;
  }
  /** One coherent owner-scoped financial snapshot; never hold a DB transaction during RPC. */
  async viewedSnapshot(userId, mint) {
    if (this.advisorySqlActive >= 8)
      throw new ExecutionEngineError5("MARKET_STATE_UNAVAILABLE", "ADVISORY_SQL_BUSY");
    this.advisorySqlActive++;
    const query = this.database.pool.query({
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
      query_timeout: 600
    });
    const settled = query.finally(() => {
      this.advisorySqlActive--;
    });
    void settled.catch(() => {
    });
    let timeout;
    try {
      const result = await Promise.race([
        settled,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new ExecutionEngineError5("MARKET_STATE_UNAVAILABLE", "ADVISORY_SQL_TIMEOUT")),
            600
          );
        })
      ]);
      return result.rows[0];
    } catch (error) {
      if (error instanceof ExecutionEngineError5) throw error;
      throw new ExecutionEngineError5("MARKET_STATE_UNAVAILABLE", "ADVISORY_SQL_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
  async viewedPosition(userId, mint, signal) {
    this.advisoryViews++;
    try {
      const started = performance.now();
      const row = await this.viewedSnapshot(userId, mint);
      let sqlMs = performance.now() - started;
      const revision = (r) => createHash9("sha256").update(
        JSON.stringify([
          r.account_id,
          r.round_id,
          r.id,
          r.quantity,
          r.basis,
          r.realized,
          r.updated_at,
          r.financial_version
        ])
      ).digest("hex");
      const envelope = {
        userId,
        accountId: row?.account_id ?? null,
        roundId: row?.round_id ?? null,
        mint,
        revision: row?.id ? revision(row) : null,
        financialVersion: row?.financial_version ?? null,
        positionUpdatedAt: row?.id ? row.updated_at.toISOString() : null,
        snapshotAt: null,
        chainSlot: null,
        chainTime: null,
        completedAt: this.now().toISOString()
      };
      if (!row)
        return {
          ...envelope,
          status: "UNAVAILABLE",
          reason: "ROUND_ACCOUNT_NOT_FOUND",
          position: null
        };
      if (row.round_state !== "OPEN")
        return { ...envelope, status: "ROUND_CLOSED", reason: "ROUND_NOT_OPEN", position: null };
      if (!row.id)
        return { ...envelope, status: "NOT_HELD", reason: "POSITION_NOT_OPEN", position: null };
      const position = {
        id: row.id,
        mint,
        originMarketId: row.market_id,
        originProtocol: row.venue,
        tokenDecimals: row.decimals,
        tokenQuantityBaseUnits: row.quantity,
        costBasisPaperSolLamports: row.basis,
        realizedPnlLamports: row.realized
      };
      try {
        signal?.throwIfAborted();
        const { exit, metrics, chainTime } = await this.advisory.preflight(
          {
            protocolId: identifier5(row.venue, "ProtocolId"),
            marketId: identifier5(row.market_id, "MarketId"),
            tokenMint: identifier5(mint, "TokenMint")
          },
          BigInt(row.quantity),
          BigInt(row.basis),
          "viewed",
          signal
        );
        const checkStart = performance.now(), fresh = await this.viewedSnapshot(userId, mint);
        sqlMs += performance.now() - checkStart;
        signal?.throwIfAborted();
        if (!fresh || fresh.round_state !== "OPEN" || this.now() >= row.ends_at)
          return {
            ...envelope,
            completedAt: this.now().toISOString(),
            status: "ROUND_CLOSED",
            reason: "ROUND_CHANGED",
            position: null
          };
        if (!fresh.id)
          return {
            ...envelope,
            financialVersion: fresh.financial_version ?? null,
            revision: null,
            positionUpdatedAt: null,
            completedAt: this.now().toISOString(),
            status: "NOT_HELD",
            reason: "POSITION_NOT_OPEN",
            position: null
          };
        if (revision(fresh) !== envelope.revision)
          return {
            ...envelope,
            financialVersion: fresh.financial_version ?? null,
            revision: revision(fresh),
            positionUpdatedAt: fresh.updated_at.toISOString(),
            completedAt: this.now().toISOString(),
            status: "UNAVAILABLE",
            reason: "POSITION_REVISION_CHANGED",
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
                status: "UNAVAILABLE",
                reason: "POSITION_REVISION_CHANGED",
                valuedAt: this.now()
              }
            }
          };
        if (exit.chainSlot === null || !chainTime || !Number.isFinite(Date.parse(chainTime)) || Date.now() - Date.parse(chainTime) > 2500 || Date.parse(chainTime) > Date.now() + 1e3 || Date.now() - Date.parse(exit.observedAt) > 2500)
          throw new Error("SNAPSHOT_FRESHNESS_UNAVAILABLE");
        const valuation = exit.full.executable ? {
          status: "AVAILABLE",
          executablePaperSolLamports: exit.full.outputLamports,
          unrealizedPnlLamports: exit.full.outputLamports - BigInt(row.basis),
          currentProtocol: exit.currentProtocol,
          evidenceFingerprint: exit.evidenceFingerprint,
          observedAt: exit.observedAt,
          chainSlot: exit.chainSlot,
          valuedAt: this.now()
        } : { status: "UNAVAILABLE", reason: exit.status, valuedAt: this.now() };
        return {
          ...envelope,
          status: exit.full.executable ? "AVAILABLE" : "UNAVAILABLE",
          reason: exit.full.executable ? null : exit.status,
          snapshotAt: exit.observedAt,
          chainSlot: exit.chainSlot,
          chainTime,
          completedAt: this.now().toISOString(),
          retryAfterMs: this.advisory.retryAfterMs,
          position: { ...position, valuation, sellPreflight: exit },
          ...process.env["VALUATION_DIAGNOSTICS_ENABLED"] === "true" ? { metrics: { ...metrics, sqlMs, concurrentRequests: this.advisoryViews } } : {}
        };
      } catch (error) {
        const reason = signal?.aborted ? "ADVISORY_CANCELED" : error instanceof Error && /^(ADVISORY_|SNAPSHOT_)/.test(error.message) ? safeApiErrorMessage(error) : error instanceof ExecutionEngineError5 ? error.code : "VALUATION_UNAVAILABLE";
        return {
          ...envelope,
          status: "UNAVAILABLE",
          reason,
          completedAt: this.now().toISOString(),
          retryAfterMs: this.advisory.retryAfterMs,
          position: {
            ...position,
            valuation: { status: "UNAVAILABLE", reason, valuedAt: this.now() }
          }
        };
      }
    } finally {
      this.advisoryViews--;
    }
  }
  async buyPreflight(userId, mint, signal) {
    const account = await this.getCurrentAccount(userId);
    if (!account) {
      throw new FinancialServiceError(
        "ENTITY_NOT_FOUND",
        "Enter the current round before trading."
      );
    }
    const positions2 = await this.valuePositions(account.positions);
    const allAvailable = positions2.every(({ valuation }) => valuation.status === "AVAILABLE");
    const conservativeValues = positions2.map(
      ({ valuation, sellPreflight }) => valuation.status === "AVAILABLE" ? valuation.executablePaperSolLamports : sellPreflight?.maxExecutableOutputLamports ?? null
    );
    const conservativelyValued = conservativeValues.every((value) => value !== null);
    const positionValues = conservativelyValued ? conservativeValues.map((value) => paperSolBaseUnits2(value)) : null;
    const cash = paperSolBaseUnits2(BigInt(account.paper_sol_balance_lamports));
    const equity = positionValues ? calculatePortfolioEquity(cash, positionValues) : null;
    const ratio = basisPoints2(BigInt(account.max_buy_ratio_bps));
    const maxByRatio = equity === null ? null : calculateMaxBuyByRatio(equity, ratio);
    const effectiveMax = maxByRatio === null ? null : calculateEffectiveMaxBuy(cash, maxByRatio);
    const slot = (await this.database.pool.query(
      `select count(*)::int existing
         from competition_token_slots s join assets a on a.id = s.asset_id
         where s.competition_account_id = $1 and a.mint_address = $2`,
      [account.id, mint]
    )).rows[0];
    let market;
    try {
      signal?.throwIfAborted();
      market = await this.marketSupport(mint, signal);
    } catch (error) {
      market = {
        mint,
        supported: false,
        reason: error instanceof ExecutionEngineError5 ? error.code : "MARKET_STATE_UNAVAILABLE"
      };
    }
    const targetAlreadyConsumesSlot = (slot?.existing ?? 0) > 0;
    return {
      accountId: account.id,
      roundId: account.hourly_round_id,
      cashLamports: cash,
      executablePositionsLamports: positionValues === null ? null : positionValues.reduce((total, value) => total + value, 0n),
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
      valuationStatus: allAvailable ? "AVAILABLE" : "UNAVAILABLE",
      equityValuationStatus: !conservativelyValued ? "UNAVAILABLE" : allAvailable ? "FULL" : "PARTIAL_LIQUIDITY",
      blockingReason: !market.supported ? market.reason : "genericEntryAllowed" in market && market.genericEntryAllowed !== true ? "GENERIC_OPERATOR_ENTRY_DISABLED" : !conservativelyValued ? "PORTFOLIO_EQUITY_UNAVAILABLE" : null,
      unavailablePositions: positions2.filter(({ valuation }) => valuation.status !== "AVAILABLE").map(({ id, mint_address, valuation }) => ({
        id,
        mint: mint_address,
        reason: valuation.status !== "AVAILABLE" ? valuation.reason : null
      })),
      unavailablePositionIds: positions2.filter(({ valuation }) => valuation.status !== "AVAILABLE").map(({ id }) => id),
      serverTime: this.now()
    };
  }
  async ensurePumpMarket(mint) {
    const identity = this.router.mintResolver ? await this.router.mintResolver(mint) : {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: identifier5(await pumpBondingCurveAddress(mint), "MarketId"),
      tokenMint: identifier5(mint, "TokenMint")
    };
    const marketId = identity.marketId;
    let route;
    let state;
    try {
      const resolved = await this.router.loadPositionRoute(identity);
      route = resolved.route;
      state = resolved.state;
    } catch (error) {
      if (error instanceof ExecutionEngineError5) throw error;
      throw new ExecutionEngineError5("MARKET_STATE_UNAVAILABLE", "Market state is unavailable.");
    }
    const decimalsValue = state.normalizedState["tokenDecimals"];
    const decimals = typeof decimalsValue === "string" ? Number(decimalsValue) : NaN;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new ExecutionEngineError5("INVALID_MARKET_STATE", "Token decimals are invalid.");
    }
    const assetId = `asset:${mint}`;
    await this.database.pool.query(
      `insert into assets (id, mint_address, decimals) values ($1, $2, $3)
       on conflict (mint_address) do update set decimals = excluded.decimals`,
      [assetId, mint, decimals]
    );
    const persistedAssetId = (await this.database.pool.query(
      "select id from assets where mint_address = $1",
      [mint]
    )).rows[0].id;
    await this.database.pool.query(
      `insert into assets (id, mint_address, decimals, symbol, name)
       values ('asset:wrapped-sol', $1, 9, 'SOL', 'Wrapped SOL') on conflict (mint_address) do nothing`,
      [WRAPPED_SOL_MINT2]
    );
    const quoteAssetId = (await this.database.pool.query(
      "select id from assets where mint_address = $1",
      [WRAPPED_SOL_MINT2]
    )).rows[0].id;
    await this.database.pool.query(
      `insert into markets (id, base_asset_id, quote_asset_id, venue, provider_market_id)
       values ($1, $2, $3, $4, $1) on conflict do nothing`,
      [marketId, persistedAssetId, quoteAssetId, identity.protocolId]
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
          marketId
        ]
      );
    }
    return {
      identity,
      decimals,
      protocolId: route.executionIdentity.protocolId,
      migrated: route.migrated,
      state
    };
  }
  chartMetadataReads = 0;
  async chartMetadata(context) {
    if (this.chartMetadataReads >= 2)
      throw new ExecutionEngineError5("MARKET_STATE_UNAVAILABLE", "CHART_METADATA_BUSY");
    if (!this.router.chartMetadataResolver) throw new Error("CHART_TOKEN_METADATA_MISSING");
    this.chartMetadataReads++;
    try {
      return await withAdvisoryRead2(
        {
          signal: AbortSignal.timeout(8e3),
          metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 }
        },
        () => this.router.chartMetadataResolver(context)
      );
    } finally {
      this.chartMetadataReads--;
    }
  }
  async marketSupport(mint, signal) {
    if (this.metadataReads >= 2)
      throw new ExecutionEngineError5("MARKET_STATE_UNAVAILABLE", "ADVISORY_METADATA_BUSY");
    this.metadataReads++;
    const bounded = AbortSignal.any([
      signal ?? AbortSignal.timeout(8e3),
      AbortSignal.timeout(8e3)
    ]);
    try {
      return await withAdvisoryRead2(
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
              supported: true,
              executionProtocol: state.identity.protocolId,
              status: market.migrated ? "MIGRATED_POOL" : market.identity.protocolId === PUMP_FUN_PROTOCOL_ID ? "ACTIVE_BONDING_CURVE" : "RESOLVED_ROUTE",
              route: state.normalizedState["hops"] ?? null,
              routeIdentity: executionRouteRecord(state, true),
              ...state.identity.protocolId === "GENERIC_PUMP_SWAP" ? {
                genericEntryAllowed: state.normalizedState["genericBuyAdmissionAllowed"] === true
              } : {},
              chainSlot: state.chainSlot?.toString() ?? null,
              marketId: state.identity.marketId,
              originMarketId: market.identity.marketId,
              tokenDecimals: market.decimals,
              tokenSupplyBaseUnits: chartMintSupply(state.normalizedState, mint)
            };
          } catch (error) {
            if (error instanceof ExecutionEngineError5 && [
              "MARKET_ACCOUNT_NOT_FOUND",
              "UNSUPPORTED_PROTOCOL",
              "UNSUPPORTED_MIGRATED_PROTOCOL",
              "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
              "INSUFFICIENT_EXECUTABLE_LIQUIDITY"
            ].includes(error.code)) {
              return {
                mint,
                supported: false,
                reason: error.code,
                diagnostics: safeApiErrorMessage(error)
              };
            }
            throw error;
          }
        }
      );
    } finally {
      this.metadataReads--;
    }
  }
  async buy(userId, input) {
    await assertPaperBuyAdmission(this.database, { userId });
    const account = await this.getCurrentAccount(userId);
    if (!account)
      throw new FinancialServiceError(
        "ENTITY_NOT_FOUND",
        "Enter the current round before trading."
      );
    let requestedPaperSolLamports;
    try {
      requestedPaperSolLamports = paperSolFromSolString(input.paperSol);
    } catch {
      throw new FinancialServiceError(
        "INVALID_FINANCIAL_INPUT",
        "paperSol must be non-negative decimal text with at most nine decimal places."
      );
    }
    const originMarketId = account.positions.find((p) => p.mint_address === input.mint)?.market_id ?? await pumpBondingCurveAddress(input.mint);
    const registered = (await this.database.pool.query(
      "select id, venue from markets where id = $1",
      [originMarketId]
    )).rows[0];
    const market = registered ? {
      identity: {
        protocolId: identifier5(registered.venue ?? PUMP_FUN_PROTOCOL_ID, "ProtocolId"),
        marketId: identifier5(originMarketId, "MarketId"),
        tokenMint: identifier5(input.mint, "TokenMint")
      }
    } : await this.ensurePumpMarket(input.mint);
    const executionTime = this.now();
    const chartObservation = Promise.resolve().then(() => this.chartFx.lookup(executionTime)).catch(() => ({
      status: "UNAVAILABLE",
      reason: "CAPTURED_FX_PROVIDER_UNAVAILABLE"
    }));
    const result = await executePaperBuy(this.database, this.router, {
      competitionAccountId: account.id,
      marketId: market.identity.marketId,
      requestedPaperSolLamports,
      idempotencyKey: `user:${userId}:${input.idempotencyKey}`,
      authoritativeTimestamp: executionTime
    });
    this.liveCache = void 0;
    this.advisory.invalidate();
    try {
      void saveCapturedFillFx(
        this.database,
        result.fillId,
        result.executedAt,
        chartObservation
      ).catch(() => {
      });
    } catch {
    }
    return result;
  }
  async sell(userId, input) {
    const account = await this.getCurrentAccount(userId);
    if (!account)
      throw new FinancialServiceError(
        "ENTITY_NOT_FOUND",
        "Enter the current round before trading."
      );
    let position = account.positions.find(({ mint_address }) => mint_address === input.mint);
    const wasOpen = position !== void 0;
    if (!position) {
      position = (await this.database.pool.query(
        `select p.id, p.market_id, a.mint_address, a.decimals, m.venue,
                p.remaining_base_units, p.cost_basis_lamports, p.realized_pnl_lamports
         from positions p join assets a on a.id = p.asset_id join markets m on m.id = p.market_id
         where p.competition_account_id = $1 and a.mint_address = $2
         order by p.updated_at desc limit 1`,
        [account.id, input.mint]
      )).rows[0];
    }
    if (!position)
      throw new FinancialServiceError(
        "INSUFFICIENT_TOKEN_BALANCE",
        "No position exists for this mint."
      );
    const scopedKey = `user:${userId}:${input.idempotencyKey}`;
    const executionTime = this.now();
    const chartObservation = Promise.resolve().then(() => this.chartFx.lookup(executionTime)).catch(() => ({
      status: "UNAVAILABLE",
      reason: "CAPTURED_FX_PROVIDER_UNAVAILABLE"
    }));
    if (input.quantity === "ALL") {
      const result2 = await executePaperSellAll(this.database, this.router, {
        competitionAccountId: account.id,
        marketId: position.market_id,
        idempotencyKey: scopedKey,
        authoritativeTimestamp: executionTime
      });
      this.liveCache = void 0;
      try {
        void saveCapturedFillFx(
          this.database,
          result2.fillId,
          result2.executedAt,
          chartObservation
        ).catch(() => {
        });
      } catch {
      }
      return result2;
    }
    if (!wasOpen) {
      const replay = (await this.database.pool.query(
        `select id from idempotency_records
           where operation_class = 'AUTHORITATIVE_PAPER_SELL' and idempotency_key = $1`,
        [scopedKey]
      )).rows[0];
      if (!replay) {
        throw new FinancialServiceError(
          "INSUFFICIENT_TOKEN_BALANCE",
          "No open position exists for this mint."
        );
      }
    }
    const quantity = BigInt(input.quantity);
    const result = await executePaperSell(this.database, this.router, {
      competitionAccountId: account.id,
      marketId: position.market_id,
      requestedTokenQuantity: quantity,
      idempotencyKey: scopedKey,
      authoritativeTimestamp: executionTime
    });
    this.liveCache = void 0;
    try {
      void saveCapturedFillFx(
        this.database,
        result.fillId,
        result.executedAt,
        chartObservation
      ).catch(() => {
      });
    } catch {
    }
    return result;
  }
  async trades(userId, page, mint) {
    const cursor = decodeCursor(page.cursor);
    const values = [userId, page.limit + 1];
    let cursorSql = "";
    if (cursor) {
      values.push(cursor.timestamp, cursor.id);
      cursorSql = "and (f.executed_at, f.id) < ($3::timestamptz, $4)";
    }
    if (mint) {
      values.push(mint);
      cursorSql += ` and a.mint_address = $${values.length}`;
    }
    const rows = (await this.database.pool.query(
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
      values
    )).rows;
    const items = [];
    const chartDeadline = Date.now() + 2500;
    for (let start = 0; start < Math.min(rows.length, page.limit); start += 4) {
      items.push(
        ...await Promise.all(
          rows.slice(start, Math.min(start + 4, page.limit)).map(async ({ chart_state, ...row }) => {
            const fx = mint && Date.now() < chartDeadline ? await historicalFillFx(this.database, row.id, row.executed_at) : { status: "UNAVAILABLE", reason: "HISTORICAL_FX_ENRICHMENT_PENDING" };
            return {
              ...row,
              token_supply_base_units: chartMintSupply(chart_state, row.mint_address),
              sol_usd_at_execution: fx.status === "AVAILABLE" ? fx.rate : null,
              sol_usd_fx: fx
            };
          })
        )
      );
    }
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > page.limit && last ? encodeCursor({ timestamp: last.executed_at.toISOString(), id: last.id }) : null
    };
  }
  async hourlyResults(userId, page) {
    const offset = page.cursor ? Number(page.cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Cursor is invalid.");
    const rows = (await this.database.pool.query(
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
      [userId, page.limit + 1, offset]
    )).rows;
    return {
      items: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? String(offset + page.limit) : null
    };
  }
  async dailyLeaderboard() {
    const daily = await getCurrentDailyCompetition(this.database, this.now());
    if (!daily) return null;
    const rows = (await this.database.pool.query(
      `select dr.user_id, u.wallet_address, dr.cumulative_pnl_lamports score,
              dr.completed_hourly_round_count
       from daily_results dr join users u on u.id = dr.user_id
       where dr.daily_competition_id = $1
       order by dr.cumulative_pnl_lamports desc, dr.user_id`,
      [daily.id]
    )).rows;
    return { dailyCompetition: daily, entries: rankRows(rows) };
  }
  async hourlyLeaderboard(roundId) {
    let id = roundId;
    if (!id) {
      id = (await this.database.pool.query(
        `select id from hourly_rounds where state = 'FINALIZED' order by starts_at desc limit 1`
      )).rows[0]?.id;
    }
    if (!id) return null;
    const round = (await this.database.pool.query("select id, starts_at, ends_at_exclusive, state from hourly_rounds where id = $1", [id])).rows[0];
    if (!round || round.state !== "FINALIZED")
      throw new FinancialServiceError(
        "FINALIZATION_CONFLICT",
        "Hourly leaderboard is available only for finalized rounds."
      );
    const rows = (await this.database.pool.query(
      `select hr.user_id, u.wallet_address, hr.hourly_pnl_lamports score,
              hr.final_settled_balance_lamports
       from hourly_results hr join users u on u.id = hr.user_id
       where hr.hourly_round_id = $1 order by hr.hourly_pnl_lamports desc, hr.user_id`,
      [id]
    )).rows;
    return { round, entries: rankRows(rows) };
  }
  async currentDailyCompetition() {
    return getCurrentDailyCompetition(this.database, this.now());
  }
  currentHourlyRewardPool() {
    return getCurrentHourlyRewardPool(this.database, this.now(), this.rewardConfig);
  }
  hourlyRewardPool(roundId) {
    return getHourlyRewardPool(this.database, roundId, this.rewardConfig);
  }
  currentDailyRewardPool() {
    return getCurrentDailyRewardPool(this.database, this.now(), this.rewardConfig);
  }
  rewardReconciliation(roundId) {
    return reconcileHourlyRewardPool(this.database, roundId);
  }
  async publicPayoutPlan(plan) {
    if (!plan) return null;
    return {
      ...plan,
      sourceLeaderboard: plan.sourceLeaderboard.map((row) => ({
        walletAddress: row["walletAddress"],
        score: row["score"],
        competitiveRank: row["competitiveRank"],
        tieGroupSize: row["tieGroupSize"]
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
          fundedOrdinals: row.explanation["fundedOrdinals"],
          combinedFundedLamports: row.explanation["combinedFundedLamports"],
          equalFloorLamports: row.explanation["equalFloorLamports"],
          tieDustLamports: row.explanation["tieDustLamports"]
        }
      }))
    };
  }
  async payoutPlan(planId) {
    return this.publicPayoutPlan(await getPayoutPlanAudit(this.database, planId));
  }
  async hourlyPayoutWinners(roundId) {
    return this.publicPayoutPlan(await getHourlyPayoutWinners(this.database, roundId));
  }
  async dailyPayoutWinners(idOrDate) {
    return this.publicPayoutPlan(await getDailyPayoutWinners(this.database, idOrDate));
  }
  userRewardAllocations(userId) {
    return getUserRewardAllocations(this.database, userId);
  }
};

// apps/api/src/redis.ts
import { Redis } from "./node_modules/ioredis/built/index.js";
function createRedis(redisUrl) {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1
  });
  client.on("error", () => {
  });
  return {
    async healthCheck() {
      try {
        if (client.status === "wait") {
          await client.connect();
        }
        return await client.ping() === "PONG";
      } catch {
        return false;
      }
    },
    async get(key) {
      return client.get(key);
    },
    async setExpiring(key, value, ttlSeconds) {
      await client.set(key, value, "EX", ttlSeconds);
    },
    async take(key) {
      const result = await client.eval(
        "local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]) end; return v",
        1,
        key
      );
      return typeof result === "string" ? result : null;
    },
    async delete(key) {
      await client.del(key);
    },
    async incrementWindow(key, ttlSeconds) {
      const result = await client.eval(
        "local v=redis.call('INCR',KEYS[1]); if v==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return v",
        1,
        key,
        ttlSeconds
      );
      return Number(result);
    },
    async close() {
      if (client.status === "end") {
        return;
      }
      if (client.status === "wait") {
        client.disconnect();
        return;
      }
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  };
}

// apps/api/src/main.ts
var config = parseApplicationEnvironment(process.env);
var database = createDatabase(config.DATABASE_URL);
var redis = createRedis(config.REDIS_URL);
var genericCapability = new GenericCapability(database, genericCapabilityOptions(config));
var router = createProductionExecutionRouter({
  genericPumpSwapEnabled: config.GENERIC_PUMPSWAP_ENABLED,
  genericPumpSwapBuysEnabled: config.GENERIC_PUMPSWAP_BUYS_ENABLED,
  genericAccessResolver: (mint, quote, settlement) => genericCapability.resolve(mint, quote, settlement),
  nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
  nonSolPumpSwapRoutes: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES,
  rpcUrl: config.SOLANA_RPC_URL,
  rpcTimeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
  commitment: config.SOLANA_COMMITMENT,
  log: (event, metadata) => {
    if (advisoryReadContext() && !config.VALUATION_DIAGNOSTICS_ENABLED) return;
    if (!event.startsWith("LAUNCHLAB_") && ![
      "BUY_ROUTE",
      "SELL_ROUTE",
      "EXECUTABLE_VALUATION",
      "EXECUTION_VALUATION_ANOMALY",
      "IMMEDIATE_VALUATION_UNAVAILABLE",
      "ROUTE_UNAVAILABLE",
      ...config.VALUATION_DIAGNOSTICS_ENABLED ? ["RPC_READ_RETRY"] : []
    ].includes(event))
      return;
    const failed = /FAILED|UNAVAILABLE|MIGRATING/.test(event);
    app.log[failed ? "warn" : "info"]({ event, ...metadata });
  }
});
var auth = new AuthService(
  database,
  redis,
  config.AUTH_CHALLENGE_TTL_SECONDS,
  config.AUTH_SESSION_TTL_SECONDS
);
var competition = new CompetitionService(
  database,
  router,
  () => /* @__PURE__ */ new Date(),
  {
    allocationMode: config.REWARD_ALLOCATION_MODE,
    baselineWindow: config.REWARD_BASELINE_WINDOW,
    lambdaBps: BigInt(config.REWARD_LAMBDA_BPS),
    configurationVersion: "phase-5a-v1"
  },
  void 0,
  {
    maxConcurrent: config.ADVISORY_MAX_CONCURRENT,
    backgroundConcurrent: config.ADVISORY_BACKGROUND_CONCURRENT
  },
  config.GENERIC_PUMPSWAP_ENABLED
);
var app = buildApp({ config, database, redis, auth, competition, genericCapability });
var shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  app.log.info({ signal }, "Graceful shutdown started");
  try {
    await app.close();
    await database.close();
    await redis.close();
    app.log.info("Graceful shutdown completed");
  } catch (error) {
    app.log.error({ error }, "Graceful shutdown failed");
    process.exitCode = 1;
  }
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info(
    {
      host: config.API_HOST,
      port: config.API_PORT,
      rpcProvider: rpcProviderIdentity(config.SOLANA_RPC_URL),
      commitment: config.SOLANA_COMMITMENT,
      websocketConfigured: Boolean(config.SOLANA_WS_URL),
      nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
      nonSolPumpSwapAllowedMints: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES.map((r) => r.mint)
    },
    "API listening"
  );
} catch (error) {
  app.log.fatal({ error }, "API startup failed");
  await shutdown("SIGTERM");
  process.exitCode = 1;
}
