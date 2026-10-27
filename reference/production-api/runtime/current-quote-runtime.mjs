var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// apps/api/isolated/verified-routes/production-composition.ts
import { paperSolBaseUnits as paperSolBaseUnits8, identifier as identifier13 } from "./packages/core/dist/index.js";
import {
  ExecutionRouter as ExecutionRouter2,
  ExecutionEngineError as ExecutionEngineError18,
  canonicalExitPreflight as canonicalExitPreflight3
} from "./packages/execution/dist/index.js";

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
async function getPayoutPlanAudit(database, planId) {
  const plan = (await database.pool.query("select * from payout_plans where id=$1", [planId])).rows[0];
  if (!plan) return null;
  const buckets = (await database.pool.query(
    `select ordinal,weight_ppm::text,floor_allocation_lamports::text,remainder_basis::text,
              final_allocation_lamports::text from payout_rank_buckets
       where payout_plan_id=$1 order by ordinal`,
    [planId]
  )).rows;
  const allocations = (await database.pool.query(
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
async function getHourlyPayoutWinners(database, hourlyRoundId2) {
  const plan = (await database.pool.query(
    `select id from payout_plans where hourly_round_id=$1 order by calculated_at desc limit 1`,
    [hourlyRoundId2]
  )).rows[0];
  return plan ? getPayoutPlanAudit(database, plan.id) : null;
}
async function getDailyPayoutWinners(database, idOrDate) {
  const plan = (await database.pool.query(
    `select p.id from payout_plans p join daily_competitions d on d.id=p.daily_competition_id
       where d.id=$1 or d.utc_date::text=$1 order by p.calculated_at desc limit 1`,
    [idOrDate]
  )).rows[0];
  return plan ? getPayoutPlanAudit(database, plan.id) : null;
}
async function getUserRewardAllocations(database, userId) {
  const rows = await database.pool.query(
    `select id from payout_plans p
     where exists (
       select 1 from jsonb_array_elements(p.source_result_snapshot) source
       where source->>'userId'=$1
     ) order by calculated_at desc`,
    [userId]
  );
  const results = [];
  for (const row of rows.rows) {
    const audit = await getPayoutPlanAudit(database, row.id);
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
var DEFAULT_STARTING_PAPER_SOL_LAMPORTS = 10000000000n;
var FinancialServiceError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "FinancialServiceError";
    this.code = code;
  }
};
async function assertPaperBuyAdmission(database, context) {
  let allowed = false;
  try {
    allowed = await database.authorizePaperBuy?.(context) === true;
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
      Object.entries(value).filter(([, item]) => item !== void 0).sort(([left], [right]) => left.localeCompare(right)).map(([key2, item]) => [key2, canonicalize(item)])
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
function toHourlyResult(row) {
  return {
    id: row.id,
    hourlyRoundId: row.hourly_round_id,
    competitionAccountId: row.competition_account_id,
    userId: row.user_id,
    finalSettledBalanceLamports: BigInt(row.final_settled_balance_lamports),
    startingPaperSolLamports: BigInt(row.starting_paper_sol_lamports),
    hourlyPnlLamports: BigInt(row.hourly_pnl_lamports),
    finalizedAt: row.finalized_at
  };
}
function toDailyResult(row) {
  return {
    id: row.id,
    dailyCompetitionId: row.daily_competition_id,
    userId: row.user_id,
    cumulativePnlLamports: BigInt(row.cumulative_pnl_lamports),
    completedHourlyRoundCount: row.completed_hourly_round_count
  };
}
async function runFinancialTransaction(database, operation) {
  const client = await database.pool.connect();
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
async function getAccountFinancialState(database, accountId) {
  const client = await database.pool.connect();
  try {
    return await getAccountStateWithClient(client, accountId);
  } finally {
    client.release();
  }
}
async function initializeCompetitionAccount(database, input) {
  const requestHash = fingerprint({
    accountId: input.accountId,
    userId: input.userId,
    hourlyRoundId: input.hourlyRoundId
  });
  return runFinancialTransaction(database, async (client) => {
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
async function getHourlyResultWithClient(client, resultId) {
  return toHourlyResult(
    firstRow(
      await client.query(
        `select id, hourly_round_id, competition_account_id, user_id,
                final_settled_balance_lamports, starting_paper_sol_lamports,
                hourly_pnl_lamports, finalized_at
         from hourly_results where id = $1`,
        [resultId]
      ),
      "Hourly result"
    )
  );
}
async function finalizeHourlyResult(database, input) {
  if (input.finalSettledBalanceLamports < 0n) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Final balance cannot be negative.");
  }
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database, async (client) => {
    const account = await getAccountStateWithClient(client, input.accountId, true);
    const claimed = await claimIdempotency(client, {
      operationClass: "HOURLY_RESULT_FINALIZATION",
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.accountId
    });
    if (claimed.replay) return getHourlyResultWithClient(client, claimed.record.result_entity_id);
    if (account.finalSettledBalanceLamports !== null || account.paperSolBalanceLamports !== input.finalSettledBalanceLamports) {
      throw new FinancialServiceError(
        "FINALIZATION_CONFLICT",
        "Final balance does not match the unsettled competition account."
      );
    }
    const openPositions = firstRow(
      await client.query(
        `select count(*)::int as count from positions
         where competition_account_id = $1 and status = 'OPEN'`,
        [input.accountId]
      ),
      "Open-position aggregate"
    );
    if (openPositions.count !== 0) {
      throw new FinancialServiceError(
        "FINALIZATION_CONFLICT",
        "All positions must be closed before hourly finalization."
      );
    }
    const hourlyPnl = input.finalSettledBalanceLamports - account.startingPaperSolLamports;
    await client.query(
      `update competition_accounts
       set final_settled_balance_lamports = $2, hourly_pnl_lamports = $3, finalized_at = $4
       where id = $1`,
      [input.accountId, input.finalSettledBalanceLamports, hourlyPnl, input.finalizedAt]
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
        input.finalizedAt
      ]
    );
    await completeIdempotency(
      client,
      claimed.record.id,
      "HOURLY_RESULT",
      input.resultId,
      input.accountId
    );
    return getHourlyResultWithClient(client, input.resultId);
  });
}
async function getDailyResultWithClient(client, resultId) {
  return toDailyResult(
    firstRow(
      await client.query(
        `select id, daily_competition_id, user_id, cumulative_pnl_lamports,
                completed_hourly_round_count
         from daily_results where id = $1`,
        [resultId]
      ),
      "Daily result"
    )
  );
}
async function contributeHourlyResultToDailyCompetition(database, input) {
  const requestHash = fingerprint(input);
  return runFinancialTransaction(database, async (client) => {
    const hourly = firstRow(
      await client.query(
        `select h.user_id, h.competition_account_id, h.hourly_pnl_lamports, r.starts_at
         from hourly_results h join hourly_rounds r on r.id = h.hourly_round_id
         where h.id = $1 for share of h, r`,
        [input.hourlyResultId]
      ),
      "Hourly result"
    );
    const daily = firstRow(
      await client.query(
        `select starts_at, ends_at_exclusive from daily_competitions where id = $1 for update`,
        [input.dailyCompetitionId]
      ),
      "Daily competition"
    );
    if (hourly.starts_at < daily.starts_at || hourly.starts_at >= daily.ends_at_exclusive) {
      throw new FinancialServiceError(
        "DAILY_ATTRIBUTION_MISMATCH",
        "The hourly round start time does not belong to this UTC day."
      );
    }
    const claimed = await claimIdempotency(client, {
      operationClass: "DAILY_RESULT_CONTRIBUTION",
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: hourly.competition_account_id
    });
    if (claimed.replay) return getDailyResultWithClient(client, claimed.record.result_entity_id);
    const insertedDaily = await client.query(
      `insert into daily_results (id, daily_competition_id, user_id)
       values ($1, $2, $3)
       on conflict (daily_competition_id, user_id) do nothing returning id`,
      [input.dailyResultId, input.dailyCompetitionId, hourly.user_id]
    );
    const dailyResultId = insertedDaily.rows[0]?.id ?? firstRow(
      await client.query(
        `select id from daily_results where daily_competition_id = $1 and user_id = $2`,
        [input.dailyCompetitionId, hourly.user_id]
      ),
      "Daily result"
    ).id;
    const link2 = await client.query(
      `insert into daily_result_hourly_results
        (id, daily_result_id, hourly_result_id, idempotency_record_id)
       values ($1, $2, $3, $4)
       on conflict (hourly_result_id) do nothing returning id`,
      [input.contributionId, dailyResultId, input.hourlyResultId, claimed.record.id]
    );
    if (link2.rowCount === 1) {
      await client.query(
        `update daily_results
         set cumulative_pnl_lamports = cumulative_pnl_lamports + $2,
             completed_hourly_round_count = completed_hourly_round_count + 1,
             updated_at = now()
         where id = $1`,
        [dailyResultId, BigInt(hourly.hourly_pnl_lamports)]
      );
    } else {
      const existing = firstRow(
        await client.query(
          `select daily_result_id from daily_result_hourly_results where hourly_result_id = $1`,
          [input.hourlyResultId]
        ),
        "Daily contribution"
      );
      if (existing.daily_result_id !== dailyResultId) {
        throw new FinancialServiceError(
          "DAILY_ATTRIBUTION_MISMATCH",
          "The hourly result was already attributed to another daily result."
        );
      }
    }
    await completeIdempotency(
      client,
      claimed.record.id,
      "DAILY_RESULT",
      dailyResultId,
      hourly.competition_account_id
    );
    return getDailyResultWithClient(client, dailyResultId);
  });
}
async function reconcileAccountLedger(database, accountId) {
  const account = await getAccountFinancialState(database, accountId);
  const positionAggregate = firstRow(
    await database.pool.query(
      `select coalesce(sum(cost_basis_lamports), 0)::text as cost,
              coalesce(sum(remaining_base_units), 0)::text as quantity
       from positions where competition_account_id = $1`,
      [accountId]
    ),
    "Position aggregate"
  );
  const fillAggregate = firstRow(
    await database.pool.query(
      `select coalesce(sum(case when f.side = 'BUY' then f.base_quantity else -f.base_quantity end), 0)::text as quantity
       from fills f join orders o on o.id = f.order_id where o.competition_account_id = $1`,
      [accountId]
    ),
    "Fill aggregate"
  );
  const writeoffAggregate = firstRow(
    await database.pool.query(
      `select coalesce(sum(coalesce(r.token_quantity, (j.metadata->>'tokenQuantity')::numeric)), 0)::text as quantity
       from journal_transactions j left join settlement_writeoff_metadata_repairs r on r.journal_transaction_id = j.id
       where j.competition_account_id = $1 and j.source_entity_type = 'SETTLEMENT_WRITEOFF'`,
      [accountId]
    ),
    "Settlement write-off aggregate"
  );
  const ledger = await database.pool.query(
    `select account_code,
            sum(case when direction = 'DEBIT' then amount_lamports else -amount_lamports end)::text as balance
     from ledger_entries where competition_account_id = $1 group by account_code`,
    [accountId]
  );
  const balance = (code) => BigInt(ledger.rows.find(({ account_code }) => account_code === code)?.balance ?? "0");
  const journals = firstRow(
    await database.pool.query(
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
      [accountId]
    ),
    "Journal aggregate"
  );
  const cash = balance("CASH");
  const positionCost = balance("POSITION_COST");
  const startingCapital = -balance("HOURLY_STARTING_CAPITAL");
  const grossTradingPnl = -balance("TRADING_PNL");
  const tradingFees = balance("TRADING_FEES");
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
    reconciled: cash === account.paperSolBalanceLamports && positionCost === materializedPositionCost && quantityFromFills === materializedQuantity && startingCapital === account.startingPaperSolLamports && realizedPnl === account.realizedPnlLamports && cash + positionCost === startingCapital + grossTradingPnl - tradingFees && balancedJournalCount === journalCount
  };
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
async function executePaperBuy(database, router, input) {
  await assertPaperBuyAdmission(database, { accountId: input.competitionAccountId });
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
  return runFinancialTransaction(database, async (client) => {
    await assertPaperBuyAdmission(database, { accountId: input.competitionAccountId, client });
    await database.lockMarketExecution?.(client, input.competitionAccountId);
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
    if (database.valueMarketPortfolio) {
      try {
        const values = await database.valueMarketPortfolio(
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
            router,
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
        () => router.loadPositionRoute(targetIdentity)
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
    await database.commitMarketExecution?.(client, { accountId: input.competitionAccountId, roundId: accountIdentity.hourly_round_id, fillId, execution, executionContext: "NORMAL_USER" });
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
async function prepareAuthoritativeSell(database, router, input, ids, pinned) {
  const market = firstRow(
    await database.pool.query(
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
      adapter: router.resolveVersion(pinned.identity.protocolId, pinned.adapterVersion),
      state: pinned
    } : await withGenericAccount(
      input.competitionAccountId,
      () => router.loadPositionRoute(identity, input.executionContext === "FORCED_HOURLY_SETTLEMENT")
    );
    if (route.migrated) {
      await database.pool.query(
        `insert into markets
          (id, base_asset_id, quote_asset_id, venue, provider_market_id, metadata)
         select $1, base_asset_id, quote_asset_id, $2, $1,
                jsonb_build_object('migrationResolvedFromMarketId', id)
         from markets where id = $3
         on conflict do nothing`,
        [route.executionIdentity.marketId, route.executionIdentity.protocolId, identity.marketId]
      );
    }
    const executionMarket = (await database.pool.query(
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
      await database.bindMarketSettlementEvidence?.(input.competitionAccountId, pinned);
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
async function executeAuthoritativePaperSell(database, router, input) {
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
  const existingClient = await database.pool.connect();
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
  const prepared = await prepareAuthoritativeSell(database, router, input, {
    orderId,
    executionId
  }, input.settlementEvidence);
  if (input.executionContext === "FORCED_HOURLY_SETTLEMENT" && (!input.settlementEvidence || prepared.execution.actualOutput.amount !== input.settlementNetLimit))
    throw new FinancialServiceError("SETTLEMENT_REVIEW", "Forced execution must match its one pinned capacity quote.");
  return runFinancialTransaction(database, async (client) => {
    await database.lockMarketExecution?.(client, input.competitionAccountId);
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
    await database.commitMarketExecution?.(client, { accountId: input.competitionAccountId, roundId: authority.hourly_round_id, fillId, execution: prepared.execution, executionContext: input.executionContext });
    if (input.persistedSettlementStep) {
      if (input.executionContext !== "FORCED_HOURLY_SETTLEMENT" || !database.commitPersistedSettlementStep)
        throw new FinancialServiceError("SETTLEMENT_REVIEW", "Persisted settlement participant is required.");
      await database.commitPersistedSettlementStep(client, { accountId: input.competitionAccountId, roundId: authority.hourly_round_id, positionId: positionRow.id, quantityBefore, basisBefore: costBefore, fillId, idempotencyKey: input.idempotencyKey, execution: prepared.execution, evidence: prepared.evidence });
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
async function repairLegacySettlementWriteoffMetadata(database, accountId) {
  await runFinancialTransaction(database, async (client) => {
    await client.query("select id from competition_accounts where id = $1 for update", [accountId]);
    const legacy = await client.query(
      `select j.id, j.source_entity_id, j.idempotency_record_id from journal_transactions j
       left join settlement_writeoff_metadata_repairs r on r.journal_transaction_id = j.id
       where j.competition_account_id = $1 and j.operation_type = 'FORCED_HOURLY_SETTLEMENT_WRITEOFF'
         and j.source_entity_type = 'SETTLEMENT_WRITEOFF' and j.metadata = '{}'::jsonb
         and r.journal_transaction_id is null order by j.id`,
      [accountId]
    );
    for (const journal of legacy.rows) {
      const invalid = () => new FinancialServiceError(
        "FINALIZATION_CONFLICT",
        `Legacy write-off ${journal.id} cannot be reconstructed uniquely from immutable fills and ledger.`
      );
      const position = (await client.query("select * from positions where id = $1 and competition_account_id = $2 for update", [
        journal.source_entity_id,
        accountId
      ])).rows[0];
      if (!position || position.status !== "CLOSED" || BigInt(position.remaining_base_units) !== 0n || BigInt(position.cost_basis_lamports) !== 0n)
        throw invalid();
      const peers = await client.query(
        "select id from positions where competition_account_id = $1 and asset_id = $2",
        [accountId, position.asset_id]
      );
      const writeoffs = await client.query(
        `select id from journal_transactions where competition_account_id = $1
         and source_entity_type = 'SETTLEMENT_WRITEOFF' and source_entity_id = $2`,
        [accountId, journal.source_entity_id]
      );
      const idempotency = (await client.query(
        `select * from idempotency_records where id = $1
          and competition_account_id = $2 and operation_class = 'FORCED_HOURLY_SETTLEMENT_WRITEOFF'`,
        [journal.idempotency_record_id, accountId]
      )).rows[0];
      if (peers.rowCount !== 1 || writeoffs.rowCount !== 1 || idempotency?.status !== "COMPLETED" || idempotency.result_entity_type !== "SETTLEMENT_WRITEOFF" || idempotency.result_entity_id !== journal.source_entity_id)
        throw invalid();
      const fills2 = await client.query(
        `select f.* from fills f join orders o on o.id = f.order_id
          join markets m on m.id = f.market_id
          where o.competition_account_id = $1 and m.base_asset_id = $2 order by f.id`,
        [accountId, position.asset_id]
      );
      let quantity = 0n, cost = 0n, pnl = 0n;
      for (const fill of fills2.rows) {
        quantity += (fill.side === "BUY" ? 1n : -1n) * BigInt(fill.base_quantity);
        cost += fill.side === "BUY" ? BigInt(
          fill.actual_input_lamports ?? (BigInt(fill.quote_lamports) + BigInt(fill.fee_lamports)).toString()
        ) : -BigInt(fill.cost_basis_lamports_removed);
        pnl += BigInt(fill.realized_pnl_lamports);
      }
      const entries = await client.query(
        "select account_code, direction, amount_lamports from ledger_entries where journal_transaction_id = $1",
        [journal.id]
      );
      if (quantity <= 0n || cost <= 0n || BigInt(position.realized_pnl_lamports) !== pnl - cost || entries.rowCount !== 2 || !entries.rows.some(
        (e) => e.account_code === "TRADING_PNL" && e.direction === "DEBIT" && BigInt(e.amount_lamports) === cost
      ) || !entries.rows.some(
        (e) => e.account_code === "POSITION_COST" && e.direction === "CREDIT" && BigInt(e.amount_lamports) === cost
      ))
        throw invalid();
      await client.query(
        `insert into settlement_writeoff_metadata_repairs
         (journal_transaction_id, token_quantity, cost_basis_lamports, evidence) values ($1, $2, $3, $4::jsonb)`,
        [
          journal.id,
          quantity,
          cost,
          JSON.stringify({
            reason: "LEGACY_WRITEOFF_METADATA_RECOVERY_V1",
            positionId: journal.source_entity_id,
            marketId: position.market_id,
            fillIds: fills2.rows.map((f) => f.id),
            method: "Immutable BUY quantity minus SELL quantity; capitalized BUY cost minus removed SELL basis; matching write-off ledger and closed-position P&L."
          })
        ]
      );
    }
  });
}
async function writeOffSettlementRemainder(database, input) {
  if (input.tokenQuantity <= 0n) return;
  const applyWriteoff = async (client) => {
    await client.query("select id from competition_accounts where id = $1 for update", [
      input.competitionAccountId
    ]);
    const round = firstRow(
      await client.query(
        `select r.state from hourly_rounds r join competition_accounts a on a.hourly_round_id = r.id
       where a.id = $1 for share of r`,
        [input.competitionAccountId]
      ),
      "Hourly round"
    );
    if (round.state !== "SETTLING")
      throw new FinancialServiceError("FINALIZATION_CONFLICT", "Write-off requires SETTLING.");
    const requestHash = fingerprint({
      positionId: input.positionId,
      marketId: input.marketId,
      competitionAccountId: input.competitionAccountId,
      authoritativeTimestamp: input.authoritativeTimestamp
    });
    const claimed = await claimIdempotency(client, {
      operationClass: "FORCED_HOURLY_SETTLEMENT_WRITEOFF",
      idempotencyKey: input.idempotencyKey,
      requestHash,
      competitionAccountId: input.competitionAccountId
    });
    if (claimed.replay) return;
    const position = firstRow(
      await client.query(
        `select status, remaining_base_units, cost_basis_lamports from positions where id = $1 and competition_account_id = $2 for update`,
        [input.positionId, input.competitionAccountId]
      ),
      "Position"
    );
    const quantity = BigInt(position.remaining_base_units);
    const cost = BigInt(position.cost_basis_lamports);
    if (position.status !== "OPEN" || quantity === 0n) {
      await completeIdempotency(
        client,
        claimed.record.id,
        "SETTLEMENT_WRITEOFF",
        input.positionId,
        input.competitionAccountId
      );
      return;
    }
    if (quantity !== input.tokenQuantity || cost !== input.costBasis) {
      throw new FinancialServiceError(
        "SETTLEMENT_INCOMPLETE",
        "Position changed after zero-capacity observation; reload before write-off."
      );
    }
    await client.query(
      `update positions set remaining_base_units = 0, cost_basis_lamports = 0,
         realized_pnl_lamports = realized_pnl_lamports - $2, status = 'CLOSED',
         closed_at = $3, updated_at = $3 where id = $1`,
      [input.positionId, cost, input.authoritativeTimestamp]
    );
    await client.query(
      `update competition_accounts set realized_pnl_lamports = realized_pnl_lamports - $2 where id = $1`,
      [input.competitionAccountId, cost]
    );
    await insertJournal(client, {
      id: `journal:forced-writeoff:${input.positionId}`,
      competitionAccountId: input.competitionAccountId,
      operationType: "FORCED_HOURLY_SETTLEMENT_WRITEOFF",
      sourceEntityType: "SETTLEMENT_WRITEOFF",
      sourceEntityId: input.positionId,
      idempotencyRecordId: claimed.record.id,
      metadata: {
        tokenQuantity: quantity.toString(),
        costBasisLamports: cost.toString(),
        marketId: input.marketId,
        reason: input.operatorResolution ? "OPERATOR_APPROVED_DUST_RESOLUTION_V1" : "NO_POSITIVE_AUTHORITATIVE_EXECUTABLE_EXIT",
        ...input.operatorResolution ? { operatorResolution: input.operatorResolution } : {},
        marketStateEvidence: JSON.parse(
          JSON.stringify(
            input.evidence,
            (_, value) => typeof value === "bigint" ? value.toString() : value
          )
        )
      },
      entries: cost === 0n ? [] : [
        { accountCode: "TRADING_PNL", direction: "DEBIT", amountLamports: cost },
        { accountCode: "POSITION_COST", direction: "CREDIT", amountLamports: cost }
      ]
    });
    await completeIdempotency(
      client,
      claimed.record.id,
      "SETTLEMENT_WRITEOFF",
      input.positionId,
      input.competitionAccountId
    );
  };
  if (input.transactionClient) await applyWriteoff(input.transactionClient);
  else await runFinancialTransaction(database, applyWriteoff);
}
async function executePaperSell(database, router, input) {
  return executeAuthoritativePaperSell(database, router, {
    ...input,
    executionContext: "NORMAL_USER"
  });
}
async function executePaperSellAll(database, router, input) {
  const requestHash = fingerprint({
    competitionAccountId: input.competitionAccountId,
    marketId: input.marketId,
    requestedTokenQuantity: "ALL",
    executionContext: "NORMAL_USER"
  });
  const existing = await database.pool.connect();
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
  const row = (await database.pool.query(
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
  return executeAuthoritativePaperSell(database, router, {
    ...input,
    requestedTokenQuantity: BigInt(row.remaining_base_units),
    executionContext: "NORMAL_USER",
    idempotencyIntent: "ALL"
  });
}
async function enterHourlySettlement(database, hourlyRoundId2, authoritativeTimestamp) {
  return runFinancialTransaction(database, async (client) => {
    const round = firstRow(
      await client.query(
        `select state, ends_at_exclusive from hourly_rounds where id = $1 for update`,
        [hourlyRoundId2]
      ),
      "Hourly round"
    );
    if (round.state === "FINALIZED") {
      return { state: round.state, endsAtExclusive: round.ends_at_exclusive };
    }
    if (authoritativeTimestamp < round.ends_at_exclusive) {
      throw new FinancialServiceError(
        "OUTSIDE_ROUND_WINDOW",
        "Hourly settlement cannot begin before the exclusive cutoff."
      );
    }
    if (round.state === "OPEN") {
      await client.query(`update hourly_rounds set state = 'CLOSING' where id = $1`, [
        hourlyRoundId2
      ]);
      round.state = "CLOSING";
    }
    if (round.state === "CLOSING") {
      await client.query(`update hourly_rounds set state = 'SETTLING' where id = $1`, [
        hourlyRoundId2
      ]);
      round.state = "SETTLING";
    }
    if (round.state !== "SETTLING") {
      throw new FinancialServiceError(
        "SETTLEMENT_EXECUTION_FAILED",
        `Round state ${round.state} cannot enter settlement.`
      );
    }
    return { state: round.state, endsAtExclusive: round.ends_at_exclusive };
  });
}
function settlementFailure(error, competitionAccountId, marketId) {
  const retryCodes = /* @__PURE__ */ new Set([
    "RPC_UNAVAILABLE",
    "RPC_TIMEOUT",
    "RPC_ERROR",
    "MARKET_STATE_UNAVAILABLE",
    "MARKET_ACCOUNT_NOT_FOUND",
    "MIGRATION_DESTINATION_UNAVAILABLE",
    "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
    "MARKET_MIGRATED",
    "SETTLEMENT_INCOMPLETE",
    "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
    "ZERO_EXECUTABLE_OUTPUT"
  ]);
  if (error instanceof FinancialServiceError) {
    return {
      competitionAccountId,
      marketId,
      code: error.code,
      message: error.message,
      disposition: retryCodes.has(error.code) ? "RETRY" : "OPERATIONAL_ERROR"
    };
  }
  if (error instanceof ExecutionEngineError) {
    return {
      competitionAccountId,
      marketId,
      code: error.code,
      message: error.message,
      disposition: retryCodes.has(error.code) ? "RETRY" : "OPERATIONAL_ERROR"
    };
  }
  return {
    competitionAccountId,
    marketId,
    code: "SETTLEMENT_EXECUTION_FAILED",
    message: "Forced settlement failed without a safe authoritative result.",
    disposition: "OPERATIONAL_ERROR"
  };
}
async function settleHourlyRound(database, router, input) {
  const lock = await database.pool.connect();
  try {
    await lock.query(
      "select pg_advisory_lock(hashtextextended('hourly-settlement:' || $1::text, 0))",
      [input.hourlyRoundId]
    );
    return await settleHourlyRoundPass(database, router, input);
  } finally {
    try {
      await lock.query(
        "select pg_advisory_unlock(hashtextextended('hourly-settlement:' || $1::text, 0))",
        [input.hourlyRoundId]
      );
    } finally {
      lock.release();
    }
  }
}
async function settleHourlyRoundPass(database, router, input) {
  if (Number.isNaN(input.authoritativeTimestamp.getTime())) {
    throw new FinancialServiceError("INVALID_FINANCIAL_INPUT", "Timestamp is invalid.");
  }
  const entered = await enterHourlySettlement(
    database,
    input.hourlyRoundId,
    input.authoritativeTimestamp
  );
  if (entered.state === "FINALIZED") {
    const existing = await database.pool.query(
      `select id, hourly_round_id, competition_account_id, user_id,
              final_settled_balance_lamports, starting_paper_sol_lamports,
              hourly_pnl_lamports, finalized_at
       from hourly_results where hourly_round_id = $1 order by competition_account_id`,
      [input.hourlyRoundId]
    );
    return {
      hourlyRoundId: input.hourlyRoundId,
      state: "FINALIZED",
      forcedSells: [],
      hourlyResults: existing.rows.map(toHourlyResult),
      failures: []
    };
  }
  try {
    await database.prepareMarketSettlement?.(input.hourlyRoundId, entered.endsAtExclusive);
  } catch (error) {
    return {
      hourlyRoundId: input.hourlyRoundId,
      state: "SETTLING",
      forcedSells: [],
      hourlyResults: [],
      failures: [settlementFailure(error, "", null)]
    };
  }
  const positions2 = (await database.pool.query(
    `select p.id, p.competition_account_id, p.market_id, p.remaining_base_units, p.cost_basis_lamports,
              m.venue, a.mint_address
       from positions p
       join competition_accounts ca on ca.id = p.competition_account_id
       join markets m on m.id = p.market_id
       join assets a on a.id = p.asset_id
       where ca.hourly_round_id = $1 and p.status = 'OPEN'
       order by m.venue, p.market_id, a.mint_address`,
    [input.hourlyRoundId]
  )).rows;
  const forcedSells = [];
  const failures = [];
  for (const position of positions2) {
    try {
      const identity = {
        protocolId: identifier2(position.venue, "ProtocolId"),
        marketId: identifier2(position.market_id, "MarketId"),
        tokenMint: identifier2(position.mint_address, "TokenMint")
      };
      const prior = (await database.pool.query(`select f.id from fills f join orders o on o.id=f.order_id
        join order_market_state_evidence e on e.order_id=o.id
        where e.position_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT' limit 1`, [position.id])).rows;
      const persistedParticipant = database.persistedSettlementAccount?.(position.competition_account_id, identity) ?? !!database.preparePersistedSettlementStep;
      if (prior.length && !persistedParticipant) {
        await recordSettlementReview(database.pool, input.hourlyRoundId, position.id, "PRIOR_FORCED_CAPACITY_ALREADY_CONSUMED");
        throw new FinancialServiceError("SETTLEMENT_REVIEW", "Previously consumed forced liquidity cannot be reloaded.");
      }
      const current2 = (await database.pool.query(
        "select status,remaining_base_units,cost_basis_lamports from positions where id=$1",
        [position.id]
      )).rows[0];
      if (current2.status === "CLOSED") continue;
      const quantity = BigInt(current2.remaining_base_units), basis = BigInt(current2.cost_basis_lamports);
      if (persistedParticipant) {
        if (!database.preparePersistedSettlementStep || !database.commitPersistedSettlementStep) throw new FinancialServiceError("SETTLEMENT_REVIEW", "Incomplete persisted settlement participant.");
        const plan = await withGenericAccount(position.competition_account_id, () => database.preparePersistedSettlementStep({ accountId: position.competition_account_id, roundId: input.hourlyRoundId, positionId: position.id, identity, quantity, basis }));
        if (plan.quantity <= 0n || plan.quantity > quantity || plan.output <= 0n) throw new FinancialServiceError("SETTLEMENT_REVIEW", "No supported positive persisted exit; remainder stays in REVIEW.");
        forcedSells.push(await executeAuthoritativePaperSell(database, router, {
          competitionAccountId: position.competition_account_id,
          marketId: position.market_id,
          requestedTokenQuantity: plan.quantity,
          idempotencyKey: plan.idempotencyKey,
          authoritativeTimestamp: entered.endsAtExclusive,
          executionContext: "FORCED_HOURLY_SETTLEMENT",
          settlementEvidence: plan.evidence,
          settlementNetLimit: plan.output,
          persistedSettlementStep: true
        }));
        continue;
      }
      const capacity = await withGenericAccount(position.competition_account_id, () => canonicalExitPreflight(router, identity, quantity, basis, true));
      if (capacity.maxExecutableQuantityBaseUnits === 0n) {
        await writeOffSettlementRemainder(database, {
          competitionAccountId: position.competition_account_id,
          positionId: position.id,
          marketId: position.market_id,
          tokenQuantity: quantity,
          costBasis: basis,
          evidence: capacity.evidence,
          authoritativeTimestamp: entered.endsAtExclusive,
          idempotencyKey: `hourly-settlement-writeoff:${input.hourlyRoundId}:${position.id}`
        });
      } else forcedSells.push(await executeAuthoritativePaperSell(database, router, {
        competitionAccountId: position.competition_account_id,
        marketId: position.market_id,
        requestedTokenQuantity: capacity.maxExecutableQuantityBaseUnits,
        idempotencyKey: `hourly-settlement-once-v1:${input.hourlyRoundId}:${position.id}`,
        authoritativeTimestamp: entered.endsAtExclusive,
        executionContext: "FORCED_HOURLY_SETTLEMENT",
        settlementEvidence: capacity.evidence,
        settlementNetLimit: capacity.maxExecutableOutputLamports
      }));
    } catch (error) {
      if (error instanceof FinancialServiceError && ["SETTLEMENT_REVIEW", "EVIDENCE_CORRUPTED", "INVALID_EXECUTION_RESULT", "FINALIZATION_CONFLICT"].includes(error.code))
        await recordSettlementReview(database.pool, input.hourlyRoundId, position.id, error.code);
      failures.push(settlementFailure(error, position.competition_account_id, position.market_id));
    }
  }
  const accounts = (await database.pool.query(
    `select id from competition_accounts where hourly_round_id = $1 order by id`,
    [input.hourlyRoundId]
  )).rows;
  const hourlyResults2 = [];
  for (const account of accounts) {
    const unresolved = firstRow(
      await database.pool.query(
        `select count(*)::int as count from positions
         where competition_account_id = $1 and status = 'OPEN'`,
        [account.id]
      ),
      "Open-position aggregate"
    );
    if (unresolved.count !== 0) continue;
    try {
      const existing = await database.pool.query(
        `select id, hourly_round_id, competition_account_id, user_id,
                final_settled_balance_lamports, starting_paper_sol_lamports,
                hourly_pnl_lamports, finalized_at
         from hourly_results where competition_account_id = $1`,
        [account.id]
      );
      let hourlyResult = existing.rows[0] ? toHourlyResult(existing.rows[0]) : void 0;
      if (!hourlyResult) {
        await repairLegacySettlementWriteoffMetadata(database, account.id);
        const reconciliation = await reconcileAccountLedger(database, account.id);
        if (!reconciliation.reconciled || reconciliation.materializedCashLamports < 0n) {
          throw new FinancialServiceError(
            "FINALIZATION_CONFLICT",
            "Account ledger does not reconcile for finalization."
          );
        }
        hourlyResult = await finalizeHourlyResult(database, {
          resultId: `hourly-result:${account.id}`,
          accountId: account.id,
          finalSettledBalanceLamports: reconciliation.materializedCashLamports,
          finalizedAt: entered.endsAtExclusive,
          idempotencyKey: `hourly-result:${input.hourlyRoundId}:${account.id}`
        });
      }
      hourlyResults2.push(hourlyResult);
      const daily = firstRow(
        await database.pool.query(
          `select d.id from daily_competitions d
           join hourly_rounds r on r.id = $1
           where r.starts_at >= d.starts_at and r.starts_at < d.ends_at_exclusive`,
          [input.hourlyRoundId]
        ),
        "Daily competition"
      );
      await contributeHourlyResultToDailyCompetition(database, {
        dailyResultId: `daily-result:${daily.id}:${hourlyResult.userId}`,
        contributionId: `daily-contribution:${hourlyResult.id}`,
        dailyCompetitionId: daily.id,
        hourlyResultId: hourlyResult.id,
        idempotencyKey: `daily-contribution:${hourlyResult.id}`
      });
    } catch (error) {
      failures.push(settlementFailure(error, account.id, null));
    }
  }
  const finalState = await runFinancialTransaction(database, async (client) => {
    const round = firstRow(
      await client.query(
        "select state from hourly_rounds where id = $1 for update",
        [input.hourlyRoundId]
      ),
      "Hourly round"
    );
    if (round.state === "FINALIZED") return "FINALIZED";
    const readiness = firstRow(
      await client.query(
        `select
           (select count(*)::int from competition_accounts where hourly_round_id = $1) accounts,
           (select count(*)::int from hourly_results where hourly_round_id = $1) results,
           (select count(*)::int from positions p join competition_accounts a
              on a.id = p.competition_account_id
            where a.hourly_round_id = $1 and p.status = 'OPEN') open_positions`,
        [input.hourlyRoundId]
      ),
      "Settlement readiness"
    );
    if (round.state === "SETTLING" && readiness.open_positions === 0 && readiness.results === readiness.accounts && failures.length === 0) {
      await client.query(
        `update hourly_rounds set state = 'FINALIZED', finalized_at = $2 where id = $1`,
        [input.hourlyRoundId, input.authoritativeTimestamp]
      );
      return "FINALIZED";
    }
    return "SETTLING";
  });
  return {
    hourlyRoundId: input.hourlyRoundId,
    state: finalState,
    forcedSells,
    hourlyResults: hourlyResults2,
    failures: finalState === "SETTLING" && failures.length === 0 ? [
      {
        competitionAccountId: "",
        marketId: null,
        code: "SETTLEMENT_INCOMPLETE",
        message: "The round remains incomplete and retryable.",
        disposition: "RETRY"
      }
    ] : failures
  };
}
var ONE_TIME_DUST_RESOLUTION = Object.freeze({
  reason: "OPERATOR_APPROVED_DUST_RESOLUTION_V1",
  roundId: "hourly:2026-10-10T23:00:00.000Z",
  marketId: "FHYwo1cVWX2NyixiK22jpM7N1RA1A35qGszMG7v6sYBf",
  mint: "FB5ViYXcLNSEcy8R2Jg1DmJwP36mizZsPKvAprM8pump",
  accountId: "account:hourly:2026-10-10T23:00:00.000Z:user:feb89522289b86e10f3bcaf3a54231c823690d2a5904fc5e80c137c8cbece4f8",
  positionId: "position:account:hourly:2026-10-10T23:00:00.000Z:user:feb89522289b86e10f3bcaf3a54231c823690d2a5904fc5e80c137c8cbece4f8:FHYwo1cVWX2NyixiK22jpM7N1RA1A35qGszMG7v6sYBf"
});

// packages/protocols/isolated/linked-pair/engine.ts
import { createHash as createHash4 } from "node:crypto";
import { PublicKey as PublicKey3 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { unpackAccount as unpackAccount2, getAssociatedTokenAddressSync as getAssociatedTokenAddressSync3 } from "./packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import { ExecutionEngineError as ExecutionEngineError7 } from "./packages/execution/dist/index.js";

// packages/protocols/src/experimental/non-sol-pump-swap.ts
import { createHash as createHash3 } from "node:crypto";
import { PublicKey as PublicKey2 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import {
  unpackMint,
  unpackAccount,
  getExtensionTypes,
  getTransferFeeConfig,
  getTransferHook,
  getDefaultAccountState,
  getPausableConfig,
  getAssociatedTokenAddressSync as getAssociatedTokenAddressSync2
} from "./packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import { ExecutionEngineError as ExecutionEngineError6 } from "./packages/execution/dist/index.js";

// packages/protocols/src/pump-fun.ts
import { safeErrorMessage } from "./packages/core/dist/index.js";

// packages/protocols/src/rpc-read-context.ts
import { ExecutionEngineError as ExecutionEngineError2 } from "./packages/execution/dist/index.js";
import { AsyncLocalStorage } from "node:async_hooks";
var storageKey = /* @__PURE__ */ Symbol.for("paperfund.advisory.read.v1");
var registry = globalThis;
var storage = registry[storageKey] ?? new AsyncLocalStorage();
registry[storageKey] = storage;
var advisoryReadContext = () => storage.getStore();
var ADVISORY_CLOCK_ACCOUNT = "SysvarC1ock11111111111111111111111111111111";
function advisoryClockTime(account, slot) {
  if (!account || account.owner !== "Sysvar1111111111111111111111111111111111111")
    throw new ExecutionEngineError2("INVALID_MARKET_STATE", "SNAPSHOT_CLOCK_UNAVAILABLE");
  const data = Buffer.from(account.data[0], "base64");
  if (data.length < 40 || data.readBigUInt64LE(0) > BigInt(slot))
    throw new ExecutionEngineError2("INVALID_MARKET_STATE", "SNAPSHOT_CLOCK_UNAVAILABLE");
  const seconds = data.readBigInt64LE(32);
  if (seconds <= 0n || seconds > 8640000000000n)
    throw new ExecutionEngineError2("INVALID_MARKET_STATE", "SNAPSHOT_CLOCK_UNAVAILABLE");
  return new Date(Number(seconds) * 1e3).toISOString();
}

// packages/protocols/src/pump-fun.ts
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress
} from "./node_modules/@solana/addresses/dist/index.node.cjs";
import {
  identifier as identifier3,
  paperSolBaseUnits as paperSolBaseUnits2,
  tokenBaseUnits as tokenBaseUnits2
} from "./packages/core/dist/index.js";
import {
  createMarketStateEvidence as createMarketStateEvidence2,
  ExecutionEngineError as ExecutionEngineError3
} from "./packages/execution/dist/index.js";

// packages/protocols/src/sell-capacity.ts
function maximumConstantProductSell(quantity, base, quote, funded, net) {
  let low = 0n;
  let high = quantity;
  const grossFor = (q) => q * quote / (base + q);
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (funded(grossFor(mid))) low = mid;
    else high = mid - 1n;
  }
  while (low > 0n) {
    const gross = grossFor(low);
    if (gross === 0n) return 0n;
    if (net(gross) > 0n) return low;
    low = (gross * base - 1n) / (quote - gross);
  }
  return 0n;
}

// packages/protocols/src/pump-fun.ts
var PUMP_FUN_PROTOCOL_ID = identifier3("PUMP_FUN", "ProtocolId");
var PUMP_FUN_ADAPTER_VERSION = "pump-bonding-curve-v1";
var PUMP_FUN_NORMALIZATION_VERSION = "pump-bonding-curve-state-v1";
var PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
var PUMP_FEE_PROGRAM_ID = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
var WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
var SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
var TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
var ZERO_PUBLIC_KEY = "11111111111111111111111111111111";
var ONE_BILLION_TOKEN_BASE_UNITS = 1000000000000000n;
var BPS_DENOMINATOR = 10000n;
var BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
var GLOBAL_DISCRIMINATOR = Buffer.from([167, 232, 232, 177, 200, 108, 114, 127]);
var FEE_CONFIG_DISCRIMINATOR = Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]);
var addressDecoder = getAddressDecoder();
var addressEncoder = getAddressEncoder();
function requireBytes(data, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > data.length) {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", `${label} account data is truncated.`);
  }
}
function assertDiscriminator(data, expected, label) {
  requireBytes(data, 0, expected.length, label);
  if (!data.subarray(0, expected.length).equals(expected)) {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", `${label} discriminator is invalid.`);
  }
}
function readU64(data, offset, label) {
  requireBytes(data, offset, 8, label);
  return data.readBigUInt64LE(offset);
}
function readU128(data, offset, label) {
  requireBytes(data, offset, 16, label);
  return data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
}
function readPublicKey(data, offset, label) {
  requireBytes(data, offset, 32, label);
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}
function decodePumpBondingCurve(data) {
  if (data.length < 49) {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Bonding curve account is truncated.");
  }
  assertDiscriminator(data, BONDING_CURVE_DISCRIMINATOR, "Bonding curve");
  const optionalPublicKey = (offset) => data.length >= offset + 32 ? readPublicKey(data, offset, "Bonding curve") : ZERO_PUBLIC_KEY;
  const optionalBool = (offset) => data.length > offset ? data[offset] !== 0 : false;
  const optionalU64 = (offset) => data.length >= offset + 8 ? readU64(data, offset, "Bonding curve") : 0n;
  return {
    virtualTokenReserves: readU64(data, 8, "Bonding curve"),
    virtualSolReserves: readU64(data, 16, "Bonding curve"),
    realTokenReserves: readU64(data, 24, "Bonding curve"),
    realSolReserves: readU64(data, 32, "Bonding curve"),
    tokenTotalSupply: readU64(data, 40, "Bonding curve"),
    complete: data[48] !== 0,
    creator: optionalPublicKey(49),
    isMayhemMode: optionalBool(81),
    isCashbackCoin: optionalBool(82),
    quoteMint: optionalPublicKey(83),
    creatorFeeBps: optionalU64(115),
    isHolderReward: optionalBool(124)
  };
}
function decodePumpGlobal(data) {
  if (data.length < 162) {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump global account is truncated.");
  }
  assertDiscriminator(data, GLOBAL_DISCRIMINATOR, "Pump global");
  return {
    feeBasisPoints: readU64(data, 105, "Pump global"),
    creatorFeeBasisPoints: readU64(data, 154, "Pump global"),
    creatorFeeConfigurable: data.length > 1045 ? data[1045] !== 0 : false
  };
}
function decodePumpFeeConfig(data) {
  if (data.length < 69) {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump fee config account is truncated.");
  }
  assertDiscriminator(data, FEE_CONFIG_DISCRIMINATOR, "Pump fee config");
  const count = data.readUInt32LE(65);
  if (count === 0 || count > 50) {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump fee tier count is invalid.");
  }
  const tiers = [];
  let offset = 69;
  for (let index2 = 0; index2 < count; index2 += 1) {
    requireBytes(data, offset, 40, "Pump fee config");
    tiers.push({
      marketCapLamportsThreshold: readU128(data, offset, "Pump fee config"),
      protocolFeeBps: readU64(data, offset + 24, "Pump fee config"),
      creatorFeeBps: readU64(data, offset + 32, "Pump fee config")
    });
    offset += 40;
  }
  for (let index2 = 1; index2 < tiers.length; index2 += 1) {
    if (tiers[index2].marketCapLamportsThreshold < tiers[index2 - 1].marketCapLamportsThreshold) {
      throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump fee tiers are not sorted.");
    }
  }
  return { feeTiers: tiers, accountLength: data.length };
}
async function pumpBondingCurveAddress(tokenMint) {
  try {
    return (await getProgramDerivedAddress({
      programAddress: address(PUMP_PROGRAM_ID),
      seeds: [Buffer.from("bonding-curve"), addressEncoder.encode(address(tokenMint))]
    }))[0];
  } catch {
    throw new ExecutionEngineError3(
      "INVALID_MARKET_STATE",
      "Pump token mint is not a valid public key."
    );
  }
}
async function pumpGlobalAddress() {
  return (await getProgramDerivedAddress({
    programAddress: address(PUMP_PROGRAM_ID),
    seeds: [Buffer.from("global")]
  }))[0];
}
async function pumpFeeConfigAddress() {
  return (await getProgramDerivedAddress({
    programAddress: address(PUMP_FEE_PROGRAM_ID),
    seeds: [Buffer.from("fee_config"), addressEncoder.encode(address(PUMP_PROGRAM_ID))]
  }))[0];
}
function selectFeeTier(tiers, marketCap) {
  let selected = tiers[0];
  for (const tier of tiers) {
    if (marketCap >= tier.marketCapLamportsThreshold) selected = tier;
  }
  return selected;
}
function ceilDiv(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Invalid integer division operands.");
  }
  return (numerator + denominator - 1n) / denominator;
}
function calculateFee(amount, bps) {
  return ceilDiv(amount * bps, BPS_DENOMINATOR);
}
function validatePumpBondingCurve(curve) {
  if (curve.complete || curve.realTokenReserves === 0n) {
    throw new ExecutionEngineError3(
      "MARKET_MIGRATED",
      "Pump bonding curve is complete or migrated."
    );
  }
  if (curve.virtualTokenReserves <= 0n || curve.virtualSolReserves <= 0n || curve.realTokenReserves < 0n || curve.realSolReserves < 0n || curve.tokenTotalSupply <= 0n) {
    throw new ExecutionEngineError3(
      "INVALID_MARKET_STATE",
      "Pump bonding curve reserves are invalid."
    );
  }
  if (curve.quoteMint !== ZERO_PUBLIC_KEY && curve.quoteMint !== WRAPPED_SOL_MINT) {
    throw new ExecutionEngineError3(
      "UNSUPPORTED_PROTOCOL",
      "Pump quote asset requires composed execution through the canonical router."
    );
  }
}
var discardLog = () => void 0;
var SolanaRpcClient = class {
  #url;
  #commitment;
  #timeoutMs;
  #fetch;
  #log;
  #requestId = 0;
  constructor(options) {
    if (!options.url) throw new ExecutionEngineError3("RPC_ERROR", "SOLANA_RPC_URL is required.");
    if ((options.timeoutMs ?? 1e4) <= 0) {
      throw new ExecutionEngineError3("RPC_ERROR", "SOLANA_RPC_TIMEOUT_MS must be positive.");
    }
    this.#url = options.url;
    this.#commitment = options.commitment ?? "confirmed";
    this.#timeoutMs = options.timeoutMs ?? 1e4;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#log = options.log ?? discardLog;
  }
  /** Retry the same read at the same commitment; never change venue on transport failure. */
  async request(init) {
    const request = JSON.parse(String(init.body));
    let reason = "Unknown RPC failure";
    const advisory = advisoryReadContext();
    const attempts = advisory ? 2 : 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      advisory?.signal.throwIfAborted();
      const started = performance.now();
      let retryAfter = 0;
      let networkEnded;
      if (advisory) advisory.metrics.rpcRequests++;
      const rpcRequest = structuredClone(request);
      if (advisory?.minimumSlot !== void 0 && request.method === "getMultipleAccounts")
        rpcRequest.params[1] = {
          ...rpcRequest.params[1],
          minContextSlot: advisory.minimumSlot
        };
      try {
        const response = await this.#fetch(this.#url, {
          ...init,
          body: JSON.stringify(rpcRequest),
          signal: advisory ? AbortSignal.any([
            advisory.signal,
            AbortSignal.timeout(Math.min(1e3, this.#timeoutMs))
          ]) : AbortSignal.timeout(this.#timeoutMs)
        });
        if (advisory && response.status === 429) {
          advisory.metrics.rateLimits++;
          const header = response.headers.get("retry-after");
          retryAfter = header ? /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1e3 : Math.max(0, Date.parse(header) - Date.now()) : 1e3;
        }
        if (!Number.isFinite(retryAfter) || retryAfter < 0) retryAfter = 1e3;
        if (advisory && retryAfter > 0) advisory.metrics.rateLimitedUntil = Date.now() + retryAfter;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.clone().json();
        if (body.error || body.result === void 0)
          throw new Error(`Rejected JSON-RPC response (${body.error?.code ?? "missing-result"})`);
        if (request.method === "getMultipleAccounts") {
          const result = body.result;
          if (!Array.isArray(result?.value) || result.value.length !== request.params[0].length || !Number.isSafeInteger(result.context?.slot) || result.context.slot < 0 || result.value.some(
            (a) => a !== null && (!a || typeof a.owner !== "string" || !Array.isArray(a.data) || typeof a.data[0] !== "string" || a.data[1] !== "base64")
          ))
            throw new Error("Malformed RPC account snapshot");
        }
        if (advisory && request.method === "getMultipleAccounts") {
          const slot = body.result.context.slot;
          if (advisory.minimumSlot !== void 0 && slot < advisory.minimumSlot)
            throw new Error("RPC slot regression");
          advisory.minimumSlot = slot;
        }
        networkEnded = performance.now();
        return response;
      } catch (error) {
        networkEnded = performance.now();
        reason = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "Request timed out" : error instanceof Error ? safeErrorMessage(error, [this.#url]) : "Transport failure";
        try {
          this.#log("RPC_READ_RETRY", {
            method: request.method,
            attempt: attempt + 1,
            commitment: this.#commitment,
            reason,
            finalCode: attempt === attempts - 1 ? "RPC_UNAVAILABLE" : null
          });
        } catch {
        }
        advisory?.signal.throwIfAborted();
        if (attempt < attempts - 1) {
          if (advisory) advisory.metrics.retries++;
          const delay = advisory ? Math.max(retryAfter, 100 * 2 ** attempt) * (1 + Math.random() * 0.25) : 100 * 2 ** attempt;
          await new Promise((resolve, reject5) => {
            const abort = () => {
              clearTimeout(timer);
              reject5(advisory.signal.reason);
            };
            const timer = setTimeout(() => {
              advisory?.signal.removeEventListener("abort", abort);
              resolve();
            }, delay);
            advisory?.signal.addEventListener("abort", abort, { once: true });
          });
        }
      } finally {
        if (advisory) advisory.metrics.rpcMs += (networkEnded ?? performance.now()) - started;
      }
    }
    throw new ExecutionEngineError3(
      "RPC_UNAVAILABLE",
      `Solana RPC unavailable after ${attempts} attempts: ${reason}`
    );
  }
  async getMultipleAccounts(addresses) {
    try {
      const response = await this.request({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.#requestId,
          method: "getMultipleAccounts",
          params: [addresses, { encoding: "base64", commitment: this.#commitment }]
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status.toString()}`);
      const body = await response.json();
      if (body.error || !body.result || !Array.isArray(body.result.value) || body.result.value.length !== addresses.length || !Number.isSafeInteger(body.result.context?.slot) || body.result.context.slot < 0) {
        throw new Error("Malformed or rejected JSON-RPC response");
      }
      return body.result;
    } catch (error) {
      if (error instanceof ExecutionEngineError3) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ExecutionEngineError3("RPC_UNAVAILABLE", "Solana RPC request timed out.");
      }
      throw new ExecutionEngineError3("RPC_UNAVAILABLE", "Solana RPC request failed.");
    }
  }
  /** Mint discovery only. The caller must verify every candidate against the market PDA. */
  async getProgramAccountAddresses(programId, mint, mintOffset, size) {
    try {
      const response = await this.request({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.#requestId,
          method: "getProgramAccounts",
          params: [
            programId,
            {
              encoding: "base64",
              commitment: this.#commitment,
              filters: [{ dataSize: size }, { memcmp: { offset: mintOffset, bytes: mint } }],
              dataSlice: { offset: 0, length: 0 }
            }
          ]
        })
      });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.result))
        throw new Error(
          `getProgramAccounts HTTP ${response.status}, RPC code ${body.error?.code ?? "missing-result"}.`
        );
      if (body.result.length > 16) throw new Error("Discovery exceeds bounded pool count.");
      return body.result.map((a) => a.pubkey);
    } catch (error) {
      throw new ExecutionEngineError3(
        "RPC_UNAVAILABLE",
        `LAUNCHLAB_STATE_UNAVAILABLE: on-chain pool discovery failed (${safeErrorMessage(error, [this.#url], "unknown error")}).`
      );
    }
  }
  async getOwnedTokenMints(owner) {
    try {
      const mints = [];
      for (const programId of [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const response = await this.request({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++this.#requestId,
            method: "getTokenAccountsByOwner",
            params: [
              owner,
              { programId },
              {
                encoding: "base64",
                commitment: this.#commitment,
                dataSlice: { offset: 0, length: 32 }
              }
            ]
          })
        });
        const body = await response.json();
        if (!response.ok || !body.result) throw new Error("Token account discovery failed.");
        mints.push(
          ...body.result.value.map(
            ({ account }) => addressDecoder.decode(Buffer.from(account.data[0], "base64"))
          )
        );
      }
      return [...new Set(mints)];
    } catch {
      throw new ExecutionEngineError3("RPC_UNAVAILABLE", "Solana token-context discovery failed.");
    }
  }
};
function decodeRpcAccount(account, label) {
  if (!Array.isArray(account.data) || account.data[1] !== "base64") {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", `${label} RPC encoding is invalid.`);
  }
  try {
    return Buffer.from(account.data[0], "base64");
  } catch {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", `${label} account data is invalid.`);
  }
}
var PumpFunSolanaMarketStateSource = class {
  constructor(rpc, log = discardLog) {
    this.rpc = rpc;
    this.log = log;
  }
  rpc;
  log;
  async loadMarketState(identity) {
    if (identity.protocolId !== PUMP_FUN_PROTOCOL_ID) {
      throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump protocol identity mismatch.");
    }
    const [bondingCurveAddress, globalAddress, feeConfigAddress] = await Promise.all([
      pumpBondingCurveAddress(identity.tokenMint),
      pumpGlobalAddress(),
      pumpFeeConfigAddress()
    ]);
    if (identity.marketId !== bondingCurveAddress) {
      throw new ExecutionEngineError3(
        "INVALID_MARKET_STATE",
        "Requested market is not the bonding-curve PDA for the requested mint."
      );
    }
    const advisory = advisoryReadContext();
    const addresses = [
      bondingCurveAddress,
      globalAddress,
      feeConfigAddress,
      identity.tokenMint,
      ...advisory ? [ADVISORY_CLOCK_ACCOUNT] : []
    ];
    const response = await this.rpc.getMultipleAccounts(addresses);
    if (response.value.length !== addresses.length) {
      throw new ExecutionEngineError3(
        "RPC_ERROR",
        "Solana RPC returned an inconsistent account set."
      );
    }
    const [curveAccount, globalAccount, feeConfigAccount, mintAccount] = response.value;
    if (!curveAccount) {
      throw new ExecutionEngineError3(
        "MARKET_ACCOUNT_NOT_FOUND",
        "Pump bonding curve was not found."
      );
    }
    if (!globalAccount || !feeConfigAccount || !mintAccount) {
      throw new ExecutionEngineError3(
        "MARKET_STATE_UNAVAILABLE",
        "Required Pump market state is unavailable."
      );
    }
    if (curveAccount.owner !== PUMP_PROGRAM_ID || globalAccount.owner !== PUMP_PROGRAM_ID) {
      throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump account owner is invalid.");
    }
    if (feeConfigAccount.owner !== PUMP_FEE_PROGRAM_ID) {
      throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump fee config owner is invalid.");
    }
    if (mintAccount.owner !== SPL_TOKEN_PROGRAM_ID && mintAccount.owner !== TOKEN_2022_PROGRAM_ID) {
      throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump token mint owner is invalid.");
    }
    const curveBytes = decodeRpcAccount(curveAccount, "Bonding curve");
    const globalBytes = decodeRpcAccount(globalAccount, "Pump global");
    const feeConfigBytes = decodeRpcAccount(feeConfigAccount, "Pump fee config");
    const mintBytes = decodeRpcAccount(mintAccount, "Token mint");
    if (mintBytes.length < 82 || mintBytes[45] === 0) {
      throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump token mint account is invalid.");
    }
    const curve = decodePumpBondingCurve(curveBytes);
    validatePumpBondingCurve(curve);
    const global = decodePumpGlobal(globalBytes);
    const feeConfig = decodePumpFeeConfig(feeConfigBytes);
    const mintSupply = readU64(mintBytes, 36, "Token mint");
    const tokenDecimals = mintBytes[44];
    const feeEvaluationMintSupply = curve.isMayhemMode ? mintSupply : ONE_BILLION_TOKEN_BASE_UNITS;
    const marketCap = curve.virtualSolReserves * feeEvaluationMintSupply / curve.virtualTokenReserves;
    const feeTier = selectFeeTier(feeConfig.feeTiers, marketCap);
    const creatorFeeBps = global.creatorFeeConfigurable && curve.creatorFeeBps > 0n ? curve.creatorFeeBps : feeTier.creatorFeeBps;
    if (feeTier.protocolFeeBps > BPS_DENOMINATOR || creatorFeeBps > BPS_DENOMINATOR) {
      throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump fee basis points are invalid.");
    }
    const normalizedState = {
      model: "PUMP_FUN_BONDING_CURVE",
      ...advisory ? { chainTime: advisoryClockTime(response.value[4], response.context.slot) } : {},
      programId: PUMP_PROGRAM_ID,
      feeProgramId: PUMP_FEE_PROGRAM_ID,
      bondingCurveAddress,
      globalAddress,
      feeConfigAddress,
      tokenMint: identity.tokenMint,
      tokenProgram: mintAccount.owner,
      tokenDecimals: tokenDecimals.toString(),
      quoteAsset: "SOL",
      virtualTokenReserves: curve.virtualTokenReserves.toString(),
      virtualSolReserves: curve.virtualSolReserves.toString(),
      realTokenReserves: curve.realTokenReserves.toString(),
      realSolReserves: curve.realSolReserves.toString(),
      tokenTotalSupply: curve.tokenTotalSupply.toString(),
      mintSupply: mintSupply.toString(),
      feeEvaluationMintSupply: feeEvaluationMintSupply.toString(),
      complete: curve.complete,
      creator: curve.creator,
      isMayhemMode: curve.isMayhemMode,
      isCashbackCoin: curve.isCashbackCoin,
      isHolderReward: curve.isHolderReward,
      configuredCreatorFeeBps: curve.creatorFeeBps.toString(),
      creatorFeeConfigurable: global.creatorFeeConfigurable,
      protocolFeeBps: feeTier.protocolFeeBps.toString(),
      creatorFeeBps: creatorFeeBps.toString(),
      feeTierMarketCapLamportsThreshold: feeTier.marketCapLamportsThreshold.toString(),
      feeConfigAccountLength: feeConfig.accountLength.toString()
    };
    const state = {
      identity,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      chainSlot: BigInt(response.context.slot),
      chainBlockId: null,
      adapterVersion: PUMP_FUN_ADAPTER_VERSION,
      normalizationVersion: PUMP_FUN_NORMALIZATION_VERSION,
      normalizedState,
      rawSource: {
        source: "solana-json-rpc:getMultipleAccounts",
        addresses,
        accountDataBase64: [
          curveAccount.data[0],
          globalAccount.data[0],
          feeConfigAccount.data[0],
          mintAccount.data[0]
        ]
      }
    };
    this.log("pump_market_state_loaded", {
      protocol: PUMP_FUN_PROTOCOL_ID,
      market: identity.marketId,
      mint: identity.tokenMint,
      stateSlot: response.context.slot.toString(),
      adapterVersion: PUMP_FUN_ADAPTER_VERSION
    });
    return state;
  }
};
function asPumpState(state) {
  const value = state.normalizedState;
  const requiredStrings = [
    "bondingCurveAddress",
    "tokenMint",
    "virtualTokenReserves",
    "virtualSolReserves",
    "realTokenReserves",
    "realSolReserves",
    "tokenTotalSupply",
    "mintSupply",
    "protocolFeeBps",
    "creatorFeeBps"
  ];
  if (state.adapterVersion !== PUMP_FUN_ADAPTER_VERSION || state.normalizationVersion !== PUMP_FUN_NORMALIZATION_VERSION || value["model"] !== "PUMP_FUN_BONDING_CURVE" || value["programId"] !== PUMP_PROGRAM_ID || value["quoteAsset"] !== "SOL" || value["complete"] !== false || requiredStrings.some((key2) => typeof value[key2] !== "string")) {
    throw new ExecutionEngineError3(
      "INVALID_MARKET_STATE",
      "Normalized Pump market state is invalid."
    );
  }
  if (value["tokenMint"] !== state.identity.tokenMint || value["bondingCurveAddress"] !== state.identity.marketId) {
    throw new ExecutionEngineError3(
      "INVALID_MARKET_STATE",
      "Normalized Pump market identity is invalid."
    );
  }
  return value;
}
function mathState(state) {
  const normalized = asPumpState(state);
  const result = {
    virtualToken: BigInt(normalized.virtualTokenReserves),
    virtualSol: BigInt(normalized.virtualSolReserves),
    realToken: BigInt(normalized.realTokenReserves),
    realSol: BigInt(normalized.realSolReserves),
    protocolFeeBps: BigInt(normalized.protocolFeeBps),
    creatorFeeBps: BigInt(normalized.creatorFeeBps),
    creatorFeeApplies: normalized.creator !== ZERO_PUBLIC_KEY
  };
  if (result.virtualToken <= 0n || result.virtualSol <= 0n || result.realToken <= 0n) {
    throw new ExecutionEngineError3(
      "INVALID_MARKET_STATE",
      "Normalized Pump reserves are impossible."
    );
  }
  return result;
}
function feesFor(amount, state) {
  const protocol2 = calculateFee(amount, state.protocolFeeBps);
  const creator = state.creatorFeeApplies ? calculateFee(amount, state.creatorFeeBps) : 0n;
  return { protocol: protocol2, creator, total: protocol2 + creator };
}
function feeBreakdown(value) {
  const fees = [];
  if (value.protocol > 0n) {
    fees.push({
      category: "PUMP_FUN_PROTOCOL_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits2(value.protocol) }
    });
  }
  if (value.creator > 0n) {
    fees.push({
      category: "PUMP_FUN_CREATOR_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits2(value.creator) }
    });
  }
  return { fees, totalPaperSolFees: paperSolBaseUnits2(value.total) };
}
function simulatePumpBuyAmount(maximumTotalInput, state) {
  if (maximumTotalInput <= 0n) {
    throw new ExecutionEngineError3("INVALID_EXECUTION_RESULT", "Pump BUY input must be positive.");
  }
  const totalFeeBps = state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n);
  const curveBudget = maximumTotalInput <= 1n ? 0n : (maximumTotalInput - 1n) * BPS_DENOMINATOR / (BPS_DENOMINATOR + totalFeeBps);
  const uncappedOutput = curveBudget * state.virtualToken / (state.virtualSol + curveBudget);
  const tokenOutput = uncappedOutput < state.realToken ? uncappedOutput : state.realToken;
  if (tokenOutput <= 0n || tokenOutput >= state.virtualToken) {
    throw new ExecutionEngineError3(
      "INVALID_EXECUTION_RESULT",
      "Pump BUY produces no valid token output."
    );
  }
  const curveInput = tokenOutput * state.virtualSol / (state.virtualToken - tokenOutput) + 1n;
  const fees = feesFor(curveInput, state);
  const totalInput = curveInput + fees.total;
  if (totalInput > maximumTotalInput) {
    throw new ExecutionEngineError3(
      "INVALID_EXECUTION_RESULT",
      "Pump BUY exceeds requested total input."
    );
  }
  const postVirtualToken = state.virtualToken - tokenOutput;
  const postVirtualSol = state.virtualSol + curveInput;
  const postRealToken = state.realToken - tokenOutput;
  const postRealSol = state.realSol + curveInput;
  if (postVirtualToken <= 0n || postRealToken < 0n) {
    throw new ExecutionEngineError3(
      "INVALID_EXECUTION_RESULT",
      "Pump BUY reserve result is invalid."
    );
  }
  const averageVsSpotBps = totalInput * state.virtualToken * BPS_DENOMINATOR / (tokenOutput * state.virtualSol) - BPS_DENOMINATOR;
  return {
    totalInput,
    curveInput,
    tokenOutput,
    fees,
    details: {
      curveInputLamports: curveInput.toString(),
      requestedMaximumTotalLamports: maximumTotalInput.toString(),
      protocolFeeLamports: fees.protocol.toString(),
      creatorFeeLamports: fees.creator.toString(),
      averageVsPreTradeSpotBps: averageVsSpotBps.toString(),
      postTrade: {
        virtualTokenReserves: postVirtualToken.toString(),
        virtualSolReserves: postVirtualSol.toString(),
        realTokenReserves: postRealToken.toString(),
        realSolReserves: postRealSol.toString()
      }
    }
  };
}
function simulatePumpSellAmount(tokenInput, state) {
  if (tokenInput <= 0n) {
    throw new ExecutionEngineError3("INVALID_EXECUTION_RESULT", "Pump SELL input must be positive.");
  }
  const grossSolOutput = tokenInput * state.virtualSol / (state.virtualToken + tokenInput);
  const fees = feesFor(grossSolOutput, state);
  const netSolOutput = grossSolOutput - fees.total;
  if (grossSolOutput <= 0n || netSolOutput <= 0n || grossSolOutput > state.realSol) {
    throw new ExecutionEngineError3(
      grossSolOutput > state.realSol ? "INSUFFICIENT_EXECUTABLE_LIQUIDITY" : "ZERO_EXECUTABLE_OUTPUT",
      "Pump SELL exceeds real reserves or produces no net SOL."
    );
  }
  const postVirtualToken = state.virtualToken + tokenInput;
  const postVirtualSol = state.virtualSol - grossSolOutput;
  const postRealToken = state.realToken + tokenInput;
  const postRealSol = state.realSol - grossSolOutput;
  if (postVirtualSol <= 0n || postRealSol < 0n) {
    throw new ExecutionEngineError3(
      "INVALID_EXECUTION_RESULT",
      "Pump SELL reserve result is invalid."
    );
  }
  const spotVsAverageBps = BPS_DENOMINATOR - netSolOutput * state.virtualToken * BPS_DENOMINATOR / (tokenInput * state.virtualSol);
  return {
    tokenInput,
    grossSolOutput,
    netSolOutput,
    fees,
    details: {
      grossSolOutputLamports: grossSolOutput.toString(),
      protocolFeeLamports: fees.protocol.toString(),
      creatorFeeLamports: fees.creator.toString(),
      preTradeSpotVsAverageBps: spotVsAverageBps.toString(),
      postTrade: {
        virtualTokenReserves: postVirtualToken.toString(),
        virtualSolReserves: postVirtualSol.toString(),
        realTokenReserves: postRealToken.toString(),
        realSolReserves: postRealSol.toString()
      }
    }
  };
}
function assertIdentity(expected, actual) {
  if (expected.protocolId !== actual.protocolId || expected.marketId !== actual.marketId || expected.tokenMint !== actual.tokenMint) {
    throw new ExecutionEngineError3("INVALID_MARKET_STATE", "Pump market-state identity mismatch.");
  }
}
var PumpFunProtocolAdapter = class {
  constructor(source, log = discardLog) {
    this.source = source;
    this.log = log;
  }
  source;
  log;
  protocolId = PUMP_FUN_PROTOCOL_ID;
  adapterVersion = PUMP_FUN_ADAPTER_VERSION;
  async maxExecutableSellQuantity(request, marketState) {
    assertIdentity(request.identity, marketState.identity);
    const state = mathState(marketState);
    if (state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n) >= BPS_DENOMINATOR)
      return tokenBaseUnits2(0n);
    return tokenBaseUnits2(
      maximumConstantProductSell(
        request.tokenQuantity,
        state.virtualToken,
        state.virtualSol,
        (gross) => gross <= state.realSol && gross < state.virtualSol,
        (gross) => gross - feesFor(gross, state).total
      )
    );
  }
  async loadMarketState(identity) {
    try {
      const state = await this.source.loadMarketState(identity);
      assertIdentity(identity, state.identity);
      asPumpState(state);
      return state;
    } catch (error) {
      this.log("pump_market_state_failed", {
        protocol: this.protocolId,
        market: identity.marketId,
        mint: identity.tokenMint,
        adapterVersion: this.adapterVersion,
        errorCode: error instanceof ExecutionEngineError3 ? error.code : "MARKET_STATE_UNAVAILABLE"
      });
      throw error;
    }
  }
  async simulateBuy(request, marketState) {
    assertIdentity(request.identity, marketState.identity);
    const result = simulatePumpBuyAmount(request.requestedPaperSol, mathState(marketState));
    const execution = this.execution(
      request,
      marketState,
      { asset: "PAPER_SOL", amount: request.requestedPaperSol },
      { asset: "PAPER_SOL", amount: paperSolBaseUnits2(result.totalInput) },
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits2(result.tokenOutput)
      },
      feeBreakdown(result.fees).fees,
      result.details
    );
    this.log("pump_execution_simulated", {
      protocol: this.protocolId,
      market: request.identity.marketId,
      mint: request.identity.tokenMint,
      stateSlot: marketState.chainSlot?.toString() ?? null,
      adapterVersion: this.adapterVersion,
      executionId: request.executionId,
      evidenceFingerprint: execution.quote.marketStateFingerprint
    });
    return execution;
  }
  async simulateSell(request, marketState) {
    assertIdentity(request.identity, marketState.identity);
    const result = simulatePumpSellAmount(request.requestedTokenQuantity, mathState(marketState));
    const execution = this.execution(
      request,
      marketState,
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: request.requestedTokenQuantity
      },
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits2(result.tokenInput)
      },
      { asset: "PAPER_SOL", amount: paperSolBaseUnits2(result.netSolOutput) },
      feeBreakdown(result.fees).fees,
      result.details
    );
    this.log("pump_execution_simulated", {
      protocol: this.protocolId,
      market: request.identity.marketId,
      mint: request.identity.tokenMint,
      stateSlot: marketState.chainSlot?.toString() ?? null,
      adapterVersion: this.adapterVersion,
      executionId: request.executionId,
      evidenceFingerprint: execution.quote.marketStateFingerprint
    });
    return execution;
  }
  async valuePositionForExit(request, marketState) {
    assertIdentity(request.identity, marketState.identity);
    const result = simulatePumpSellAmount(request.tokenQuantity, mathState(marketState));
    const evidence = createMarketStateEvidence2(marketState);
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits2(result.netSolOutput),
      feeBreakdown: feeBreakdown(result.fees),
      marketStateFingerprint: evidence.fingerprint,
      adapterVersion: this.adapterVersion
    };
  }
  execution(request, marketState, requestedInput, actualInput, output, fees, executionDetails) {
    const evidence = createMarketStateEvidence2(marketState);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: marketState.observedAt,
        marketStateFingerprint: evidence.fingerprint,
        normalizationVersion: marketState.normalizationVersion,
        requestedInput,
        simulatedOutput: output,
        fees
      },
      actualInput,
      actualOutput: output,
      executedAt: request.executedAt,
      executionDetails
    };
  }
};

// packages/protocols/src/pump-swap.ts
import {
  address as address2,
  getAddressDecoder as getAddressDecoder2,
  getAddressEncoder as getAddressEncoder2,
  getProgramDerivedAddress as getProgramDerivedAddress2
} from "./node_modules/@solana/addresses/dist/index.node.cjs";
import {
  identifier as identifier4,
  paperSolBaseUnits as paperSolBaseUnits3,
  tokenBaseUnits as tokenBaseUnits3
} from "./packages/core/dist/index.js";
import {
  createMarketStateEvidence as createMarketStateEvidence3,
  ExecutionEngineError as ExecutionEngineError4
} from "./packages/execution/dist/index.js";
var PUMP_SWAP_PROTOCOL_ID = identifier4("PUMP_SWAP", "ProtocolId");
var PUMP_SWAP_ADAPTER_VERSION = "pump-swap-canonical-v1";
var PUMP_SWAP_NORMALIZATION_VERSION = "pump-swap-state-v1";
var PUMP_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
var ZERO_PUBLIC_KEY2 = "11111111111111111111111111111111";
var BPS_DENOMINATOR2 = 10000n;
var MAYHEM_TOKEN_SUPPLY = 1000000000000000n;
var POOL_DISCRIMINATOR = Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]);
var GLOBAL_CONFIG_DISCRIMINATOR = Buffer.from([149, 8, 156, 202, 160, 252, 176, 217]);
var FEE_CONFIG_DISCRIMINATOR2 = Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]);
var addressDecoder2 = getAddressDecoder2();
var addressEncoder2 = getAddressEncoder2();
var discardLog2 = () => void 0;
function requireBytes2(data, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > data.length) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", `${label} account data is truncated.`);
  }
}
function assertDiscriminator2(data, expected, label) {
  requireBytes2(data, 0, 8, label);
  if (!data.subarray(0, 8).equals(expected)) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", `${label} discriminator is invalid.`);
  }
}
function readU642(data, offset, label) {
  requireBytes2(data, offset, 8, label);
  return data.readBigUInt64LE(offset);
}
function readU1282(data, offset, label) {
  return readU642(data, offset, label) + (readU642(data, offset + 8, label) << 64n);
}
function readI128(data, offset, label) {
  const unsigned = readU1282(data, offset, label);
  return unsigned >= 1n << 127n ? unsigned - (1n << 128n) : unsigned;
}
function readPublicKey2(data, offset, label) {
  requireBytes2(data, offset, 32, label);
  return addressDecoder2.decode(data.subarray(offset, offset + 32));
}
function decodeRpcAccount2(account, label) {
  if (!Array.isArray(account.data) || account.data[1] !== "base64") {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", `${label} RPC encoding is invalid.`);
  }
  return Buffer.from(account.data[0], "base64");
}
function decodePumpSwapPool(data) {
  if (data.length < 211) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap pool account is truncated.");
  }
  assertDiscriminator2(data, POOL_DISCRIMINATOR, "PumpSwap pool");
  return {
    poolBump: data[8],
    index: data.readUInt16LE(9),
    creator: readPublicKey2(data, 11, "PumpSwap pool"),
    baseMint: readPublicKey2(data, 43, "PumpSwap pool"),
    quoteMint: readPublicKey2(data, 75, "PumpSwap pool"),
    lpMint: readPublicKey2(data, 107, "PumpSwap pool"),
    baseVault: readPublicKey2(data, 139, "PumpSwap pool"),
    quoteVault: readPublicKey2(data, 171, "PumpSwap pool"),
    lpSupply: readU642(data, 203, "PumpSwap pool"),
    coinCreator: data.length >= 243 ? readPublicKey2(data, 211, "PumpSwap pool") : ZERO_PUBLIC_KEY2,
    isMayhemMode: data.length > 243 ? data[243] !== 0 : false,
    isCashbackCoin: data.length > 244 ? data[244] !== 0 : false,
    virtualQuoteReserves: data.length >= 261 ? readI128(data, 245, "PumpSwap pool") : 0n,
    creatorFeeBps: data.length >= 269 ? readU642(data, 261, "PumpSwap pool") : 0n,
    canEditCreatorFee: data.length > 269 ? data[269] !== 0 : false
  };
}
function decodePumpSwapGlobalConfig(data) {
  if (data.length < 321) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap global config is truncated.");
  }
  assertDiscriminator2(data, GLOBAL_CONFIG_DISCRIMINATOR, "PumpSwap global config");
  return {
    lpFeeBps: readU642(data, 40, "PumpSwap global config"),
    protocolFeeBps: readU642(data, 48, "PumpSwap global config"),
    disableFlags: data[56],
    creatorFeeBps: readU642(data, 313, "PumpSwap global config"),
    creatorFeeConfigurable: data.length > 940 ? data[940] !== 0 : false,
    maxConfigurableCreatorFeeBps: data.length >= 949 ? readU642(data, 941, "PumpSwap global config") : 0n
  };
}
function readFees(data, offset, label) {
  return {
    lpFeeBps: readU642(data, offset, label),
    protocolFeeBps: readU642(data, offset + 8, label),
    creatorFeeBps: readU642(data, offset + 16, label)
  };
}
function decodePumpSwapFeeConfig(data) {
  if (data.length < 69) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap fee config is truncated.");
  }
  assertDiscriminator2(data, FEE_CONFIG_DISCRIMINATOR2, "PumpSwap fee config");
  const count = data.readUInt32LE(65);
  if (count === 0 || count > 50) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap fee tier count is invalid.");
  }
  const feeTiers = [];
  let offset = 69;
  for (let index2 = 0; index2 < count; index2 += 1) {
    requireBytes2(data, offset, 40, "PumpSwap fee config");
    feeTiers.push({
      marketCapLamportsThreshold: readU1282(data, offset, "PumpSwap fee config"),
      fees: readFees(data, offset + 16, "PumpSwap fee config")
    });
    offset += 40;
  }
  for (let index2 = 1; index2 < feeTiers.length; index2 += 1) {
    if (feeTiers[index2].marketCapLamportsThreshold < feeTiers[index2 - 1].marketCapLamportsThreshold) {
      throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap fee tiers are not sorted.");
    }
  }
  return {
    flatFees: readFees(data, 41, "PumpSwap fee config"),
    feeTiers,
    accountLength: data.length
  };
}
async function derive(programId, seeds) {
  try {
    return (await getProgramDerivedAddress2({
      programAddress: address2(programId),
      seeds
    }))[0];
  } catch {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", "A PumpSwap address is invalid.");
  }
}
function pumpPoolAuthorityAddress(tokenMint) {
  return derive(PUMP_PROGRAM_ID, [
    Buffer.from("pool-authority"),
    Buffer.from(addressEncoder2.encode(address2(tokenMint)))
  ]);
}
async function canonicalPumpSwapPoolAddress(tokenMint, quoteMint = WRAPPED_SOL_MINT) {
  const creator = await pumpPoolAuthorityAddress(tokenMint);
  const index2 = Buffer.alloc(2);
  index2.writeUInt16LE(0);
  return derive(PUMP_AMM_PROGRAM_ID, [
    Buffer.from("pool"),
    index2,
    Buffer.from(addressEncoder2.encode(address2(creator))),
    Buffer.from(addressEncoder2.encode(address2(tokenMint))),
    Buffer.from(addressEncoder2.encode(address2(quoteMint)))
  ]);
}
function pumpSwapGlobalConfigAddress() {
  return derive(PUMP_AMM_PROGRAM_ID, [Buffer.from("global_config")]);
}
function pumpSwapFeeConfigAddress() {
  return derive(PUMP_FEE_PROGRAM_ID, [
    Buffer.from("fee_config"),
    Buffer.from(addressEncoder2.encode(address2(PUMP_AMM_PROGRAM_ID)))
  ]);
}
function decodeTokenAccount(data, label) {
  if (data.length < 165 || data[108] === 0) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", `${label} token account is invalid.`);
  }
  return {
    mint: readPublicKey2(data, 0, label),
    authority: readPublicKey2(data, 32, label),
    amount: readU642(data, 64, label)
  };
}
function selectFeeTier2(tiers, marketCap) {
  let selected = tiers[0];
  for (const tier of tiers) if (marketCap >= tier.marketCapLamportsThreshold) selected = tier;
  return selected;
}
var PumpSwapSolanaMarketStateSource = class {
  constructor(rpc, log = discardLog2) {
    this.rpc = rpc;
    this.log = log;
  }
  rpc;
  log;
  links = /* @__PURE__ */ new Map();
  async loadMarketState(identity) {
    if (identity.protocolId !== PUMP_SWAP_PROTOCOL_ID) {
      throw new ExecutionEngineError4(
        "INVALID_MARKET_STATE",
        "PumpSwap protocol identity mismatch."
      );
    }
    const [expectedPool, expectedCreator, globalAddress, feeConfigAddress] = await Promise.all([
      canonicalPumpSwapPoolAddress(identity.tokenMint),
      pumpPoolAuthorityAddress(identity.tokenMint),
      pumpSwapGlobalConfigAddress(),
      pumpSwapFeeConfigAddress()
    ]);
    if (identity.marketId !== expectedPool) {
      throw new ExecutionEngineError4(
        "INVALID_MARKET_STATE",
        "Requested market is not the canonical PumpSwap pool."
      );
    }
    const advisory = advisoryReadContext();
    let discoveredPool = advisory ? this.links.get(expectedPool) : void 0;
    if (!discoveredPool || discoveredPool.until <= Date.now()) {
      const discovery = await this.rpc.getMultipleAccounts([expectedPool]);
      const account = discovery.value[0];
      if (!account || account.owner !== PUMP_AMM_PROGRAM_ID)
        throw new ExecutionEngineError4(
          "MIGRATION_DESTINATION_UNAVAILABLE",
          "Canonical PumpSwap pool was not found."
        );
      const pool2 = decodePumpSwapPool(decodeRpcAccount2(account, "PumpSwap discovery"));
      discoveredPool = {
        until: Date.now() + 6e4,
        baseVault: pool2.baseVault,
        quoteVault: pool2.quoteVault
      };
    }
    const first = await this.rpc.getMultipleAccounts([
      expectedPool,
      globalAddress,
      feeConfigAddress,
      identity.tokenMint,
      discoveredPool.baseVault,
      discoveredPool.quoteVault,
      ...advisory ? [ADVISORY_CLOCK_ACCOUNT] : []
    ]);
    const [
      poolAccount,
      globalAccount,
      feeAccount,
      mintAccount,
      baseVaultAccount,
      quoteVaultAccount
    ] = first.value;
    if (!poolAccount) {
      throw new ExecutionEngineError4(
        "MIGRATION_DESTINATION_UNAVAILABLE",
        "Canonical PumpSwap pool was not found."
      );
    }
    if (!globalAccount || !feeAccount || !mintAccount) {
      throw new ExecutionEngineError4(
        "MARKET_STATE_UNAVAILABLE",
        "Required PumpSwap market state is unavailable."
      );
    }
    if (poolAccount.owner !== PUMP_AMM_PROGRAM_ID || globalAccount.owner !== PUMP_AMM_PROGRAM_ID) {
      throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap account owner is invalid.");
    }
    if (feeAccount.owner !== PUMP_FEE_PROGRAM_ID) {
      throw new ExecutionEngineError4(
        "INVALID_MARKET_STATE",
        "PumpSwap fee config owner is invalid."
      );
    }
    if (mintAccount.owner !== SPL_TOKEN_PROGRAM_ID && mintAccount.owner !== TOKEN_2022_PROGRAM_ID) {
      throw new ExecutionEngineError4(
        "INVALID_MARKET_STATE",
        "PumpSwap base mint owner is invalid."
      );
    }
    const poolBytes = decodeRpcAccount2(poolAccount, "PumpSwap pool");
    const pool = decodePumpSwapPool(poolBytes);
    if (pool.index !== 0 || pool.creator !== expectedCreator || pool.baseMint !== identity.tokenMint || pool.quoteMint !== WRAPPED_SOL_MINT) {
      throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap pool identity is invalid.");
    }
    if (pool.baseVault !== discoveredPool.baseVault || pool.quoteVault !== discoveredPool.quoteVault) {
      this.links.delete(expectedPool);
      throw new ExecutionEngineError4(
        "INVALID_MARKET_STATE",
        "PumpSwap vault linkage changed during discovery."
      );
    }
    const vaults = first;
    if (!baseVaultAccount || !quoteVaultAccount) {
      throw new ExecutionEngineError4(
        "MARKET_STATE_UNAVAILABLE",
        "PumpSwap vault state is unavailable."
      );
    }
    if (baseVaultAccount.owner !== mintAccount.owner || quoteVaultAccount.owner !== SPL_TOKEN_PROGRAM_ID) {
      throw new ExecutionEngineError4(
        "INVALID_MARKET_STATE",
        "PumpSwap vault token program is invalid."
      );
    }
    const baseVault = decodeTokenAccount(
      decodeRpcAccount2(baseVaultAccount, "Base vault"),
      "Base vault"
    );
    const quoteVault = decodeTokenAccount(
      decodeRpcAccount2(quoteVaultAccount, "Quote vault"),
      "Quote vault"
    );
    if (baseVault.mint !== identity.tokenMint || quoteVault.mint !== WRAPPED_SOL_MINT || baseVault.authority !== expectedPool || quoteVault.authority !== expectedPool || baseVault.amount <= 0n || quoteVault.amount <= 0n) {
      throw new ExecutionEngineError4(
        "INVALID_MARKET_STATE",
        "PumpSwap vault identity or reserves are invalid."
      );
    }
    const mintBytes = decodeRpcAccount2(mintAccount, "Base mint");
    if (mintBytes.length < 82 || mintBytes[45] === 0) {
      throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap base mint is invalid.");
    }
    const mintSupply = readU642(mintBytes, 36, "Base mint");
    const global = decodePumpSwapGlobalConfig(
      decodeRpcAccount2(globalAccount, "PumpSwap global config")
    );
    const feeConfig = decodePumpSwapFeeConfig(decodeRpcAccount2(feeAccount, "PumpSwap fee config"));
    const effectiveQuote = quoteVault.amount + pool.virtualQuoteReserves;
    if (effectiveQuote <= 0n || effectiveQuote > 0xffffffffffffffffn) {
      throw new ExecutionEngineError4(
        "INVALID_MARKET_STATE",
        "PumpSwap effective quote reserves are invalid."
      );
    }
    const feeSupply = pool.isMayhemMode ? MAYHEM_TOKEN_SUPPLY : mintSupply;
    const marketCap = effectiveQuote * feeSupply / baseVault.amount;
    const selectedTier = selectFeeTier2(feeConfig.feeTiers, marketCap);
    const creatorFeeBps = global.creatorFeeConfigurable && pool.creatorFeeBps > 0n ? pool.creatorFeeBps : selectedTier.fees.creatorFeeBps;
    const fees = { ...selectedTier.fees, creatorFeeBps };
    if (fees.lpFeeBps + fees.protocolFeeBps + fees.creatorFeeBps >= BPS_DENOMINATOR2 || global.creatorFeeConfigurable && creatorFeeBps > global.maxConfigurableCreatorFeeBps) {
      throw new ExecutionEngineError4(
        "INVALID_MARKET_STATE",
        "PumpSwap fee configuration is invalid."
      );
    }
    const normalizedState = {
      model: "PUMP_SWAP_CANONICAL_POOL",
      ...advisory ? { chainTime: advisoryClockTime(first.value[6], first.context.slot) } : {},
      programId: PUMP_AMM_PROGRAM_ID,
      feeProgramId: PUMP_FEE_PROGRAM_ID,
      poolAddress: expectedPool,
      canonicalCreator: expectedCreator,
      baseMint: identity.tokenMint,
      quoteMint: WRAPPED_SOL_MINT,
      baseVault: pool.baseVault,
      quoteVault: pool.quoteVault,
      baseTokenProgram: mintAccount.owner,
      quoteTokenProgram: quoteVaultAccount.owner,
      tokenDecimals: mintBytes[44].toString(),
      mintSupply: mintSupply.toString(),
      baseReserves: baseVault.amount.toString(),
      rawQuoteReserves: quoteVault.amount.toString(),
      virtualQuoteReserves: pool.virtualQuoteReserves.toString(),
      effectiveQuoteReserves: effectiveQuote.toString(),
      coinCreator: pool.coinCreator,
      isMayhemMode: pool.isMayhemMode,
      isCashbackCoin: pool.isCashbackCoin,
      disableFlags: global.disableFlags.toString(),
      lpFeeBps: fees.lpFeeBps.toString(),
      protocolFeeBps: fees.protocolFeeBps.toString(),
      creatorFeeBps: fees.creatorFeeBps.toString(),
      creatorFeeApplies: pool.coinCreator !== ZERO_PUBLIC_KEY2,
      feeTierMarketCapLamportsThreshold: selectedTier.marketCapLamportsThreshold.toString(),
      feeConfigAccountLength: feeConfig.accountLength.toString(),
      poolAccountLength: poolBytes.length.toString(),
      stateSlots: {
        configuration: first.context.slot.toString(),
        reserves: vaults.context.slot.toString()
      }
    };
    const state = {
      identity,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      chainSlot: BigInt(vaults.context.slot),
      chainBlockId: null,
      adapterVersion: PUMP_SWAP_ADAPTER_VERSION,
      normalizationVersion: PUMP_SWAP_NORMALIZATION_VERSION,
      normalizedState
    };
    if (advisory) {
      if (this.links.size >= 256) this.links.delete(this.links.keys().next().value);
      this.links.set(expectedPool, discoveredPool);
    }
    this.log("pump_swap_market_state_loaded", {
      protocol: PUMP_SWAP_PROTOCOL_ID,
      market: expectedPool,
      mint: identity.tokenMint,
      slot: vaults.context.slot.toString(),
      adapterVersion: PUMP_SWAP_ADAPTER_VERSION
    });
    return state;
  }
};
function asState(state) {
  const value = state.normalizedState;
  if (state.identity.protocolId !== PUMP_SWAP_PROTOCOL_ID || state.adapterVersion !== PUMP_SWAP_ADAPTER_VERSION || state.normalizationVersion !== PUMP_SWAP_NORMALIZATION_VERSION || value.model !== "PUMP_SWAP_CANONICAL_POOL" || value.programId !== PUMP_AMM_PROGRAM_ID || value.poolAddress !== state.identity.marketId || value.baseMint !== state.identity.tokenMint || value.quoteMint !== WRAPPED_SOL_MINT) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap normalized state is invalid.");
  }
  return value;
}
function bigintField(value, label) {
  if (typeof value !== "string" || !/^-?[0-9]+$/.test(value)) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", `PumpSwap ${label} is invalid.`);
  }
  return BigInt(value);
}
function mathState2(state) {
  const value = asState(state);
  const result = {
    base: bigintField(value.baseReserves, "base reserves"),
    rawQuote: bigintField(value.rawQuoteReserves, "quote reserves"),
    effectiveQuote: bigintField(value.effectiveQuoteReserves, "effective quote reserves"),
    virtualQuote: bigintField(value.virtualQuoteReserves, "virtual quote reserves"),
    lpFeeBps: bigintField(value.lpFeeBps, "LP fee"),
    protocolFeeBps: bigintField(value.protocolFeeBps, "protocol fee"),
    creatorFeeBps: bigintField(value.creatorFeeBps, "creator fee"),
    creatorFeeApplies: value.creatorFeeApplies,
    disableFlags: Number(bigintField(value.disableFlags, "disable flags"))
  };
  if (result.base <= 0n || result.rawQuote <= 0n || result.effectiveQuote <= 0n || result.effectiveQuote !== result.rawQuote + result.virtualQuote || result.effectiveQuote > 0xffffffffffffffffn || [result.lpFeeBps, result.protocolFeeBps, result.creatorFeeBps].some((fee3) => fee3 < 0n) || result.lpFeeBps + result.protocolFeeBps + result.creatorFeeBps >= BPS_DENOMINATOR2) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap reserves are invalid.");
  }
  return result;
}
function ceilDiv2(value, divisor) {
  if (value < 0n || divisor <= 0n)
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", "Invalid division.");
  return (value + divisor - 1n) / divisor;
}
function fee(amount, bps) {
  return bps === 0n ? 0n : ceilDiv2(amount * bps, BPS_DENOMINATOR2);
}
function feesFor2(amount, state) {
  const lp = fee(amount, state.lpFeeBps);
  const protocol2 = fee(amount, state.protocolFeeBps);
  const creator = state.creatorFeeApplies ? fee(amount, state.creatorFeeBps) : 0n;
  return { lp, protocol: protocol2, creator, total: lp + protocol2 + creator };
}
function feeBreakdown2(fees) {
  const values = [];
  if (fees.lp > 0n)
    values.push({
      category: "PUMP_SWAP_LP_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits3(fees.lp) }
    });
  if (fees.protocol > 0n)
    values.push({
      category: "PUMP_SWAP_PROTOCOL_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits3(fees.protocol) }
    });
  if (fees.creator > 0n)
    values.push({
      category: "PUMP_SWAP_CREATOR_FEE",
      amount: { asset: "PAPER_SOL", amount: paperSolBaseUnits3(fees.creator) }
    });
  return { fees: values, totalPaperSolFees: paperSolBaseUnits3(fees.total) };
}
function simulatePumpSwapBuyAmount(totalBudget, state) {
  if (totalBudget <= 1n || (state.disableFlags & 8) !== 0) {
    throw new ExecutionEngineError4(
      "INVALID_EXECUTION_RESULT",
      "PumpSwap BUY is disabled or has no usable input."
    );
  }
  const totalFeeBps = state.lpFeeBps + state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n);
  let internalQuote = totalBudget * BPS_DENOMINATOR2 / (BPS_DENOMINATOR2 + totalFeeBps);
  let fees = feesFor2(internalQuote, state);
  if (internalQuote + fees.total > totalBudget)
    internalQuote -= internalQuote + fees.total - totalBudget;
  if (internalQuote <= 1n)
    throw new ExecutionEngineError4("INVALID_EXECUTION_RESULT", "PumpSwap BUY produces no output.");
  const invariantInput = internalQuote - 1n;
  const tokenOutput = state.base * invariantInput / (state.effectiveQuote + invariantInput);
  if (tokenOutput <= 0n || tokenOutput >= state.base)
    throw new ExecutionEngineError4("INVALID_EXECUTION_RESULT", "PumpSwap BUY produces no output.");
  const exactInternalQuote = ceilDiv2(state.effectiveQuote * tokenOutput, state.base - tokenOutput);
  fees = feesFor2(exactInternalQuote, state);
  const totalInput = exactInternalQuote + fees.total;
  if (totalInput > totalBudget)
    throw new ExecutionEngineError4(
      "INVALID_EXECUTION_RESULT",
      "PumpSwap BUY exceeds its input budget."
    );
  return {
    totalInput,
    internalQuote: exactInternalQuote,
    tokenOutput,
    fees,
    details: {
      internalQuoteInputLamports: exactInternalQuote.toString(),
      requestedMaximumTotalLamports: totalBudget.toString(),
      postTrade: {
        baseReserves: (state.base - tokenOutput).toString(),
        rawQuoteReserves: (state.rawQuote + totalInput - fees.protocol - fees.creator).toString(),
        effectiveQuoteReserves: (state.effectiveQuote + totalInput - fees.protocol - fees.creator).toString()
      }
    }
  };
}
function simulatePumpSwapSellAmount(tokenInput, state) {
  if (tokenInput <= 0n || (state.disableFlags & 16) !== 0) {
    throw new ExecutionEngineError4(
      "INVALID_EXECUTION_RESULT",
      "PumpSwap SELL is disabled or invalid."
    );
  }
  const gross = state.effectiveQuote * tokenInput / (state.base + tokenInput);
  const fees = feesFor2(gross, state);
  const net = gross - fees.total;
  if (gross <= 0n || net <= 0n || state.rawQuote < gross - fees.lp) {
    throw new ExecutionEngineError4(
      state.rawQuote < gross - fees.lp ? "INSUFFICIENT_EXECUTABLE_LIQUIDITY" : "ZERO_EXECUTABLE_OUTPUT",
      "PumpSwap SELL exceeds reserves or produces no output."
    );
  }
  return {
    tokenInput,
    grossQuoteOutput: gross,
    netQuoteOutput: net,
    fees,
    details: {
      grossQuoteOutputLamports: gross.toString(),
      postTrade: {
        baseReserves: (state.base + tokenInput).toString(),
        rawQuoteReserves: (state.rawQuote - gross + fees.lp).toString(),
        effectiveQuoteReserves: (state.effectiveQuote - gross + fees.lp).toString()
      }
    }
  };
}
function assertIdentity2(expected, actual) {
  if (expected.protocolId !== actual.protocolId || expected.marketId !== actual.marketId || expected.tokenMint !== actual.tokenMint) {
    throw new ExecutionEngineError4("INVALID_MARKET_STATE", "PumpSwap identity mismatch.");
  }
}
var PumpSwapProtocolAdapter = class {
  constructor(source, log = discardLog2) {
    this.source = source;
    this.log = log;
  }
  source;
  log;
  protocolId = PUMP_SWAP_PROTOCOL_ID;
  adapterVersion = PUMP_SWAP_ADAPTER_VERSION;
  async maxExecutableSellQuantity(request, marketState) {
    assertIdentity2(request.identity, marketState.identity);
    const state = mathState2(marketState);
    if ((state.disableFlags & 16) !== 0)
      throw new ExecutionEngineError4("PROTOCOL_DISABLED", "PumpSwap SELL is disabled.");
    if (state.lpFeeBps + state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n) >= BPS_DENOMINATOR2)
      return tokenBaseUnits3(0n);
    return tokenBaseUnits3(
      maximumConstantProductSell(
        request.tokenQuantity,
        state.base,
        state.effectiveQuote,
        (gross) => state.rawQuote >= gross - feesFor2(gross, state).lp,
        (gross) => gross - feesFor2(gross, state).total
      )
    );
  }
  async loadMarketState(identity) {
    const state = await this.source.loadMarketState(identity);
    assertIdentity2(identity, state.identity);
    asState(state);
    return state;
  }
  async simulateBuy(request, state) {
    assertIdentity2(request.identity, state.identity);
    const result = simulatePumpSwapBuyAmount(request.requestedPaperSol, mathState2(state));
    return this.execution(
      request,
      state,
      { asset: "PAPER_SOL", amount: request.requestedPaperSol },
      { asset: "PAPER_SOL", amount: paperSolBaseUnits3(result.totalInput) },
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits3(result.tokenOutput)
      },
      feeBreakdown2(result.fees).fees,
      result.details
    );
  }
  async simulateSell(request, state) {
    assertIdentity2(request.identity, state.identity);
    const result = simulatePumpSwapSellAmount(request.requestedTokenQuantity, mathState2(state));
    return this.execution(
      request,
      state,
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: request.requestedTokenQuantity
      },
      {
        asset: "TOKEN",
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits3(result.tokenInput)
      },
      { asset: "PAPER_SOL", amount: paperSolBaseUnits3(result.netQuoteOutput) },
      feeBreakdown2(result.fees).fees,
      result.details
    );
  }
  async valuePositionForExit(request, state) {
    assertIdentity2(request.identity, state.identity);
    const result = simulatePumpSwapSellAmount(request.tokenQuantity, mathState2(state));
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits3(result.netQuoteOutput),
      feeBreakdown: feeBreakdown2(result.fees),
      marketStateFingerprint: createMarketStateEvidence3(state).fingerprint,
      adapterVersion: this.adapterVersion
    };
  }
  execution(request, state, requestedInput, actualInput, output, fees, executionDetails) {
    const evidence = createMarketStateEvidence3(state);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: evidence.fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput,
        simulatedOutput: output,
        fees
      },
      actualInput,
      actualOutput: output,
      executedAt: request.executedAt,
      executionDetails
    };
  }
};

// packages/protocols/src/composed-pump-orca.ts
import { WhirlpoolsError, SwapErrorCode } from "./packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/errors/errors.js";
import { PublicKey } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { getAssociatedTokenAddressSync } from "./packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import BN from "./packages/protocols/node_modules/bn.js/lib/bn.js";
import { Percentage } from "./node_modules/@orca-so/common-sdk/dist/index.js";
import { createRequire } from "node:module";
import {
  ParsableWhirlpool,
  ParsableTickArray,
  ParsableOracle,
  ParsableWhirlpoolsConfig,
  PoolUtil,
  PDAUtil,
  SwapUtils,
  swapQuoteWithParams,
  NO_TOKEN_EXTENSION_CONTEXT,
  TickUtil
} from "./packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/index.js";
import { ExecutionEngineError as ExecutionEngineError5 } from "./packages/execution/dist/index.js";
var { PUMP_SDK, computeFeesBps, getBuyTokenAmountFromSolAmount, getBuySolAmountFromTokenAmount } = createRequire(import.meta.url)("@pump-fun/pump-sdk");
var ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
var key = (value) => new PublicKey(value);
var n = (value) => BigInt(value.toString(10));
var info = (a) => ({
  owner: key(a.owner),
  data: Buffer.from(a.base64, "base64"),
  executable: false,
  lamports: 0,
  rentEpoch: 0
});
function fail(message) {
  throw new ExecutionEngineError5("INVALID_MARKET_STATE", message);
}
function orcaLink(pool, account) {
  const data = ParsableWhirlpool.parse(key(pool), info(account));
  if (!data || account.owner !== ORCA_WHIRLPOOL_PROGRAM) fail("Invalid Orca pool.");
  const ticks = [true, false].flatMap(
    (direction) => SwapUtils.getTickArrayPublicKeys(
      data.tickCurrentIndex,
      data.tickSpacing,
      direction,
      key(account.owner),
      key(pool)
    ).map((p) => p.toBase58())
  );
  return {
    pool,
    program: account.owner,
    mintA: data.tokenMintA.toBase58(),
    mintB: data.tokenMintB.toBase58(),
    vaultA: data.tokenVaultA.toBase58(),
    vaultB: data.tokenVaultB.toBase58(),
    config: data.whirlpoolsConfig.toBase58(),
    extraAccounts: [
      .../* @__PURE__ */ new Set([...ticks, PDAUtil.getOracle(key(account.owner), key(pool)).publicKey.toBase58()])
    ]
  };
}
function pumpQuoteMint(account) {
  if (account.owner !== PUMP_PROGRAM_ID) fail("Invalid Pump owner.");
  return PUMP_SDK.decodeBondingCurve(info(account)).quoteMint.toBase58();
}
function pumpLink(pool, account, mint, baseProgram, quoteProgram) {
  const curve = PUMP_SDK.decodeBondingCurve(info(account));
  const program2 = key(PUMP_PROGRAM_ID);
  const expected = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), key(mint).toBuffer()],
    program2
  )[0];
  if (account.owner !== PUMP_PROGRAM_ID || expected.toBase58() !== pool || curve.quoteMint.equals(PublicKey.default))
    fail("Invalid composed Pump curve identity/quote.");
  return {
    pool,
    program: PUMP_PROGRAM_ID,
    mintA: mint,
    mintB: curve.quoteMint.toBase58(),
    vaultA: getAssociatedTokenAddressSync(key(mint), expected, true, key(baseProgram)).toBase58(),
    vaultB: getAssociatedTokenAddressSync(
      curve.quoteMint,
      expected,
      true,
      key(quoteProgram)
    ).toBase58(),
    config: PublicKey.findProgramAddressSync([Buffer.from("global")], program2)[0].toBase58(),
    platform: PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), program2.toBuffer()],
      key(PUMP_FEE_PROGRAM_ID)
    )[0].toBase58()
  };
}
function quoteSupplementalHop(hop, accounts, amount, aToB, time, supply, absentAccounts) {
  const need5 = (address3) => {
    const a = accounts[address3];
    if (!a) fail(`Missing composed account ${address3}.`);
    return a;
  };
  const pool = need5(hop.pool);
  if (hop.program === PUMP_PROGRAM_ID) {
    const c = PUMP_SDK.decodeBondingCurve(info(pool));
    const expected = pumpLink(
      hop.pool,
      pool,
      hop.mintA,
      need5(hop.mintA).owner,
      need5(hop.mintB).owner
    );
    if (Object.keys(expected).some((k) => expected[k] !== hop[k]))
      fail("Pump curve linkage changed.");
    if (c.complete || c.virtualTokenReserves.lten(0) || c.virtualQuoteReserves.lten(0) || c.realTokenReserves.isNeg() || c.realQuoteReserves.isNeg())
      fail("Pump curve state is inactive or inconsistent.");
    const globalAccount = need5(hop.config), feeAccount = need5(hop.platform);
    if (globalAccount.owner !== PUMP_PROGRAM_ID || feeAccount.owner !== PUMP_FEE_PROGRAM_ID)
      fail("Pump config owner mismatch.");
    const global = PUMP_SDK.decodeGlobal(info(globalAccount)), feeConfig = PUMP_SDK.decodeFeeConfig(info(feeAccount));
    const fees = computeFeesBps({
      global,
      feeConfig,
      mintSupply: new BN((c.isMayhemMode ? supply : 1000000000000000n).toString()),
      virtualQuoteReserves: c.virtualQuoteReserves,
      virtualTokenReserves: c.virtualTokenReserves,
      quoteMint: c.quoteMint,
      creatorFeeBps: c.creatorFeeBps
    });
    const protocolBps = n(fees.protocolFeeBps), creatorBps = c.creator.equals(PublicKey.default) ? 0n : n(fees.creatorFeeBps);
    if (protocolBps < 0n || creatorBps < 0n || protocolBps + creatorBps >= 10000n)
      fail("Invalid composed Pump fees.");
    const params = {
      global,
      feeConfig,
      mintSupply: new BN((c.isMayhemMode ? supply : 1000000000000000n).toString()),
      bondingCurve: c,
      quoteMint: c.quoteMint
    };
    let gross, output, consumed = amount;
    if (aToB) {
      gross = amount * n(c.virtualQuoteReserves) / (n(c.virtualTokenReserves) + amount);
      if (gross > n(c.realQuoteReserves))
        throw new ExecutionEngineError5(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "Pump quote liquidity exhausted."
        );
      output = gross;
    } else {
      output = n(getBuyTokenAmountFromSolAmount({ ...params, amount: new BN(amount.toString()) }));
      consumed = n(
        getBuySolAmountFromTokenAmount({ ...params, amount: new BN(output.toString()) })
      );
      gross = output * n(c.virtualQuoteReserves) / (n(c.virtualTokenReserves) - output) + 1n;
      if (output === n(c.realTokenReserves) && consumed < amount)
        throw new ExecutionEngineError5(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "LAUNCHLAB_BUY_CAP: Pump composed input exceeds remaining sale."
        );
    }
    const protocol2 = (gross * protocolBps + 9999n) / 10000n, creator = (gross * creatorBps + 9999n) / 10000n;
    if (aToB) output -= protocol2 + creator;
    return {
      output,
      feeMint: hop.mintB,
      protocol: protocol2,
      creator,
      lp: 0n,
      detail: {
        virtualBase: c.virtualTokenReserves.toString(),
        virtualQuote: c.virtualQuoteReserves.toString(),
        realBase: c.realTokenReserves.toString(),
        realQuote: c.realQuoteReserves.toString(),
        unusedQuoteInput: aToB ? "0" : (amount - consumed).toString()
      }
    };
  }
  const { data, ticks, oracle } = readOrcaSnapshot(hop, accounts, aToB, absentAccounts);
  const q = (() => {
    try {
      return swapQuoteWithParams(
        {
          whirlpoolData: data,
          tokenAmount: new BN(amount.toString()),
          otherAmountThreshold: new BN(0),
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          aToB,
          amountSpecifiedIsInput: true,
          tickArrays: ticks,
          oracleData: oracle,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
          timestampInSeconds: new BN(time.toString())
        },
        Percentage.fromFraction(0, 1)
      );
    } catch (error) {
      if (error instanceof WhirlpoolsError && error.errorCode === SwapErrorCode.TickArraySequenceInvalid)
        throw new ExecutionEngineError5(
          "MARKET_STATE_UNAVAILABLE",
          "Orca captured tick range cannot establish this quote."
        );
      throw error;
    }
  })();
  if (n(q.estimatedAmountIn) !== amount)
    throw new ExecutionEngineError5(
      "MARKET_STATE_UNAVAILABLE",
      "Orca captured tick range cannot establish the full input quote."
    );
  return {
    output: n(q.estimatedAmountOut),
    feeMint: aToB ? hop.mintA : hop.mintB,
    protocol: 0n,
    creator: 0n,
    lp: n(q.estimatedFeeAmount),
    feeCategory: "AMM_TRADE_FEE",
    detail: {
      tradeFeeRate: data.feeRate,
      protocolShareRate: data.protocolFeeRate,
      totalTradeFee: q.estimatedFeeAmount.toString(),
      sqrtPrice: data.sqrtPrice.toString(),
      endSqrtPrice: q.estimatedEndSqrtPrice.toString(),
      tickCurrentIndex: data.tickCurrentIndex,
      endTick: q.estimatedEndTickIndex
    }
  };
}
function readOrcaSnapshot(hop, accounts, aToB, absentAccounts) {
  const need5 = (address3) => {
    const a = accounts[address3];
    if (!a) fail("Missing composed account " + address3);
    return a;
  };
  const pool = need5(hop.pool);
  const data = ParsableWhirlpool.parse(key(hop.pool), info(pool));
  if (!data || pool.owner !== ORCA_WHIRLPOOL_PROGRAM) fail("Orca pool is invalid.");
  const config = need5(data.whirlpoolsConfig.toBase58());
  const feeTierIndex = data.feeTierIndexSeed[0] + data.feeTierIndexSeed[1] * 256;
  if (config.owner !== hop.program || !ParsableWhirlpoolsConfig.parse(data.whirlpoolsConfig, info(config)) || PDAUtil.getWhirlpool(
    key(hop.program),
    data.whirlpoolsConfig,
    data.tokenMintA,
    data.tokenMintB,
    feeTierIndex
  ).publicKey.toBase58() !== hop.pool)
    fail("Orca config/pool PDA mismatch.");
  const ticks = SwapUtils.getTickArrayPublicKeys(
    data.tickCurrentIndex,
    data.tickSpacing,
    aToB,
    key(hop.program),
    key(hop.pool)
  ).map((address3, index2) => {
    const startTickIndex = TickUtil.getStartTickIndex(
      data.tickCurrentIndex + (aToB ? 0 : data.tickSpacing),
      data.tickSpacing,
      aToB ? -index2 : index2
    );
    const raw = accounts[address3.toBase58()];
    if (!raw && absentAccounts.includes(address3.toBase58()))
      return { address: address3, startTickIndex, data: null };
    if (!raw) fail("Required Orca tick snapshot was not captured.");
    if (raw.owner !== hop.program) fail("Orca tick array owner mismatch.");
    const parsed = ParsableTickArray.parse(address3, info(raw));
    if (!parsed || parsed.whirlpool.toBase58() !== hop.pool || PDAUtil.getTickArray(
      key(hop.program),
      key(hop.pool),
      parsed.startTickIndex
    ).publicKey.toBase58() !== address3.toBase58())
      fail("Orca tick array linkage invalid.");
    return { address: address3, startTickIndex, data: parsed };
  });
  const oracleAddress = PDAUtil.getOracle(key(hop.program), key(hop.pool)).publicKey;
  const rawOracle = accounts[oracleAddress.toBase58()];
  if (rawOracle && rawOracle.owner !== hop.program) fail("Orca oracle owner mismatch.");
  const oracle = rawOracle ? ParsableOracle.parse(oracleAddress, info(rawOracle)) : null;
  if (rawOracle && !oracle || PoolUtil.isInitializedWithAdaptiveFee(data) && !oracle)
    fail("Required Orca oracle state is unavailable.");
  return { data, ticks, oracle };
}
function assertOrcaSnapshot(hop, accounts, absentAccounts) {
  readOrcaSnapshot(hop, accounts, true, absentAccounts);
  readOrcaSnapshot(hop, accounts, false, absentAccounts);
}

// packages/protocols/src/experimental/non-sol-pump-swap.ts
var CLOCK = "SysvarC1ock11111111111111111111111111111111";
var U64 = (1n << 64n) - 1n;
var STAGE1_BRIDGES = Object.freeze({
  XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN: "Bh3njVo6i3UjgmaevEQMGoidphcueNjoPqGkYLbthzV5",
  pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn: "BofA2ViUSudPBTUms2KRuG6AHNeMawjNfwqTJDgx5BKW"
});
function fail2(reason) {
  throw new ExecutionEngineError6("INVALID_MARKET_STATE", reason);
}
function liquidity(reason) {
  throw new ExecutionEngineError6("INSUFFICIENT_EXECUTABLE_LIQUIDITY", reason);
}
function dust() {
  throw new ExecutionEngineError6("ZERO_EXECUTABLE_OUTPUT", "STAGE1_DUST");
}
function u64(n3) {
  if (typeof n3 !== "bigint" || n3 < 0n || n3 > U64) fail2("STAGE1_INVALID_U64");
  return n3;
}
var ceil = (n3, d) => (n3 + d - 1n) / d;
function checked(s) {
  for (const n3 of [s.base, s.quote, s.protocolBucket, s.creatorBucket]) u64(n3);
  if (s.virtual < -(1n << 127n) || s.virtual >= 1n << 127n) fail2("STAGE1_INVALID_VIRTUAL");
  if (s.base === 0n || s.quote + s.virtual <= 0n || s.quote + s.virtual > U64 || s.protocolBucket + s.creatorBucket > s.quote)
    fail2("STAGE1_INVALID_RESERVES");
  if ([s.lpBps, s.protocolBps, s.creatorBps, s.buybackBps].some(
    (n3) => typeof n3 !== "bigint" || n3 < 0n || n3 > 10000n
  ) || s.lpBps + s.protocolBps + s.creatorBps >= 10000n)
    fail2("STAGE1_INVALID_FEES");
}
function stage1PoolSwap(s, input, buy) {
  checked(s);
  u64(input);
  if (input === 0n) dust();
  const effective = s.quote + s.virtual;
  const fee3 = (n3, b) => ceil(n3 * b, 10000n);
  const pricingBase = buy ? input * 10000n / (10000n + s.lpBps + s.protocolBps + s.creatorBps) : effective * input / (s.base + input);
  const lp = fee3(pricingBase, s.lpBps), protocol2 = fee3(pricingBase, s.protocolBps), creator = fee3(pricingBase, s.creatorBps);
  const net = buy ? input - lp - protocol2 - creator : pricingBase - lp - protocol2 - creator;
  if (net <= 0n || buy && net <= 1n) dust();
  if (!buy && pricingBase - lp > s.quote - s.protocolBucket - s.creatorBucket)
    liquidity("STAGE1_TARGET_REAL_RESERVES");
  const output = buy ? s.base * (net - 1n) / (effective + net - 1n) : net;
  if (output <= 0n) dust();
  u64(output);
  const buyback = protocol2 * s.buybackBps / 10000n;
  const retained = protocol2 - buyback + creator;
  const post = {
    ...s,
    base: buy ? s.base - output : s.base + input,
    quote: buy ? s.quote + input - buyback : s.quote - output - buyback,
    virtual: s.virtual - retained,
    protocolBucket: s.protocolBucket + protocol2 - buyback,
    creatorBucket: s.creatorBucket + creator
  };
  checked(post);
  return {
    input,
    output,
    grossQuote: buy ? net : pricingBase,
    fees: { lp, protocol: protocol2, creator, buyback },
    post
  };
}
var info2 = (a) => ({
  data: Buffer.from(a.base64, "base64"),
  owner: new PublicKey2(a.owner),
  executable: false,
  lamports: 0,
  rentEpoch: 0
});
function need(s, address3) {
  const a = s.accounts[address3];
  if (!a) fail2("STAGE1_REQUIRED_ACCOUNT_MISSING: " + address3);
  return a;
}
function validatePumpSwapMint(s, address3) {
  const a = need(s, address3);
  if (![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner)) fail2("STAGE1_MINT_OWNER");
  const m = unpackMint(new PublicKey2(address3), info2(a), new PublicKey2(a.owner));
  if (!m.isInitialized || m.decimals > 18 || m.supply === 0n && address3 !== WRAPPED_SOL_MINT)
    fail2("STAGE1_MINT_STATE");
  const known = /* @__PURE__ */ new Set([0, 1, 3, 4, 6, 10, 12, 14, 18, 19, 20, 21, 22, 23, 25, 26, 28]);
  if (getExtensionTypes(m.tlvData).some((t) => !known.has(t)))
    fail2("STAGE1_TOKEN_EXTENSION_UNSUPPORTED");
  const tf = getTransferFeeConfig(m);
  if (tf && (tf.olderTransferFee.transferFeeBasisPoints !== 0 || tf.newerTransferFee.transferFeeBasisPoints !== 0))
    fail2("STAGE1_TRANSFER_FEES_UNSUPPORTED");
  const hook = getTransferHook(m);
  if (hook && !hook.programId.equals(PublicKey2.default) || getDefaultAccountState(m)?.state === 2 || getPausableConfig(m)?.paused)
    fail2("STAGE1_TOKEN_TRANSFER_BLOCKED");
  return m;
}
function vault(s, address3, expectedMint, authority) {
  const a = need(s, address3), program2 = need(s, expectedMint).owner;
  if (a.owner !== program2) fail2("STAGE1_VAULT_PROGRAM");
  const v = unpackAccount(new PublicKey2(address3), info2(a), new PublicKey2(program2));
  if (!v.isInitialized || v.isFrozen || v.mint.toBase58() !== expectedMint || v.owner.toBase58() !== authority)
    fail2("STAGE1_VAULT_IDENTITY");
  return v;
}
var Stage1NonSolPumpSwap = class {
  constructor(options) {
    this.bridgeBinding = options?.bridgeBinding ? Object.freeze({ ...options.bridgeBinding }) : void 0;
    if (options?.purpose !== "READ_ONLY_STAGE1_VALIDATION") fail2("STAGE1_DISABLED");
  }
  bridgeBinding;
  bridgeFor(quote) {
    return this.bridgeBinding ? this.bridgeBinding.quoteMint === quote ? this.bridgeBinding.pool : void 0 : STAGE1_BRIDGES[quote];
  }
  /** Discovery inputs are addresses only. No indexer price, trading method, signing or DB access. */
  async capture(rpc, targetMint) {
    const curve = await pumpBondingCurveAddress(targetMint);
    const first = await rpc.getMultipleAccounts([curve]);
    const a = first.value[0];
    if (!a || a.owner !== PUMP_PROGRAM_ID) fail2("STAGE1_PUMP_ORIGIN_MISSING");
    const c = decodePumpBondingCurve(Buffer.from(a.data[0], "base64"));
    if (!c.complete) fail2("STAGE1_MIGRATION_NOT_COMPLETE");
    const bridge = this.bridgeFor(c.quoteMint);
    if (!bridge) fail2("STAGE1_QUOTE_UNSUPPORTED");
    const target = await canonicalPumpSwapPoolAddress(targetMint, c.quoteMint);
    const discovery = await rpc.getMultipleAccounts([target, bridge]);
    const p = discovery.value[0], b = discovery.value[1];
    if (!p || p.owner !== PUMP_AMM_PROGRAM_ID || !b || b.owner !== ORCA_WHIRLPOOL_PROGRAM)
      fail2("STAGE1_POOLS_MISSING");
    const pool = decodePumpSwapPool(Buffer.from(p.data[0], "base64"));
    const link2 = orcaLink(bridge, { owner: b.owner, base64: b.data[0] });
    const addresses = [
      .../* @__PURE__ */ new Set([
        curve,
        target,
        targetMint,
        c.quoteMint,
        pool.baseVault,
        pool.quoteVault,
        bridge,
        link2.mintA,
        link2.mintB,
        link2.vaultA,
        link2.vaultB,
        link2.config,
        ...link2.extraAccounts ?? [],
        await pumpSwapGlobalConfigAddress(),
        await pumpSwapFeeConfigAddress(),
        CLOCK
      ])
    ];
    if (addresses.length > 100) fail2("STAGE1_BATCH_TOO_LARGE");
    const batch = await rpc.getMultipleAccounts(addresses);
    if (!Number.isSafeInteger(batch.context.slot) || batch.context.slot < 0 || batch.value.length !== addresses.length)
      fail2("STAGE1_BATCH_INCONSISTENT");
    const accounts = {}, absentAccounts = [];
    addresses.forEach((address3, i) => {
      const v = batch.value[i];
      if (v) accounts[address3] = { owner: v.owner, base64: v.data[0] };
      else absentAccounts.push(address3);
    });
    const snapshot2 = {
      version: "NON_SOL_PUMPSWAP_STAGE1_V1",
      mint: targetMint,
      quoteMint: c.quoteMint,
      targetPool: target,
      bridgePool: bridge,
      slot: batch.context.slot,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      accounts,
      absentAccounts
    };
    await this.validate(snapshot2, { nowMs: Date.parse(snapshot2.observedAt), maxAgeMs: 1e4 });
    return snapshot2;
  }
  async validate(s, policy) {
    if (s.version !== "NON_SOL_PUMPSWAP_STAGE1_V1" || !Number.isSafeInteger(s.slot) || s.slot < 0 || this.bridgeFor(s.quoteMint) !== s.bridgePool)
      fail2("STAGE1_SNAPSHOT_IDENTITY");
    const now = policy.nowMs, at = Date.parse(s.observedAt);
    if (!Number.isFinite(now) || !Number.isFinite(at) || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || at > now || now - at > policy.maxAgeMs)
      fail2("STAGE1_STALE_CAPTURE");
    const clock3 = Buffer.from(need(s, CLOCK).base64, "base64");
    if (need(s, CLOCK).owner !== "Sysvar1111111111111111111111111111111111111" || clock3.length !== 40 || clock3.readBigUInt64LE(0) > BigInt(s.slot))
      fail2("STAGE1_CLOCK_INCONSISTENT");
    const time = clock3.readBigInt64LE(32), epoch = clock3.readBigUInt64LE(16);
    if (BigInt(Math.floor(now)) < time * 1000n || BigInt(Math.floor(now)) - time * 1000n > BigInt(Math.ceil(policy.maxAgeMs)))
      fail2("STAGE1_STALE_BANK");
    const curveAddress = await pumpBondingCurveAddress(s.mint), curveAccount = need(s, curveAddress);
    if (curveAccount.owner !== PUMP_PROGRAM_ID) fail2("STAGE1_CURVE_OWNER");
    const curve = decodePumpBondingCurve(Buffer.from(curveAccount.base64, "base64"));
    if (!curve.complete || curve.quoteMint !== s.quoteMint) fail2("STAGE1_MIGRATION_IDENTITY");
    const poolAccount = need(s, s.targetPool), poolBytes = Buffer.from(poolAccount.base64, "base64");
    if (poolAccount.owner !== PUMP_AMM_PROGRAM_ID || ![287, 300, 301].includes(poolBytes.length))
      fail2("STAGE1_POOL_LAYOUT_UNSUPPORTED");
    const p = decodePumpSwapPool(poolBytes);
    if (s.targetPool !== await canonicalPumpSwapPoolAddress(s.mint, s.quoteMint) || p.index !== 0 || p.creator !== await pumpPoolAuthorityAddress(s.mint) || p.baseMint !== s.mint || p.quoteMint !== s.quoteMint)
      fail2("STAGE1_CANONICAL_IDENTITY");
    if ([243, 244, 269, 270].some((i) => poolBytes[i] > 1) || poolBytes.subarray(287).some((b) => b !== 0))
      fail2("STAGE1_POOL_FLAGS_OR_TAIL");
    if (p.isMayhemMode || p.isCashbackCoin || p.canEditCreatorFee || poolBytes[270] > 1)
      fail2("STAGE1_FLAGS_UNSUPPORTED");
    for (const address3 of [s.mint, s.quoteMint, WRAPPED_SOL_MINT]) validatePumpSwapMint(s, address3);
    for (const [address3, m] of [
      [p.baseVault, s.mint],
      [p.quoteVault, s.quoteMint]
    ])
      if (getAssociatedTokenAddressSync2(
        new PublicKey2(m),
        new PublicKey2(s.targetPool),
        true,
        new PublicKey2(need(s, m).owner)
      ).toBase58() !== address3)
        fail2("STAGE1_TARGET_ATA");
    const base = vault(s, p.baseVault, s.mint, s.targetPool), quote = vault(s, p.quoteVault, s.quoteMint, s.targetPool);
    const globalAddress = await pumpSwapGlobalConfigAddress(), feeAddress = await pumpSwapFeeConfigAddress();
    if (need(s, globalAddress).owner !== PUMP_AMM_PROGRAM_ID || need(s, feeAddress).owner !== PUMP_FEE_PROGRAM_ID)
      fail2("STAGE1_CONFIG_OWNER");
    const globalBytes = Buffer.from(need(s, globalAddress).base64, "base64"), g = decodePumpSwapGlobalConfig(globalBytes);
    if (globalBytes.length !== 949 || g.disableFlags !== 0 || [417, 642, 939, 940].some((i) => globalBytes[i] > 1))
      fail2("STAGE1_GLOBAL_STATE_UNSUPPORTED");
    const fBytes = Buffer.from(need(s, feeAddress).base64, "base64"), legacy = decodePumpSwapFeeConfig(fBytes);
    let end = 69 + fBytes.readUInt32LE(65) * 40;
    if (fBytes.length >= 4073) {
      if (end + 4 > fBytes.length) fail2("STAGE1_FEE_LAYOUT");
      end += 4 + fBytes.readUInt32LE(end) * 40;
    }
    let fees = legacy.flatFees;
    if (fBytes.length >= 4097) {
      if (end + 24 > fBytes.length) fail2("STAGE1_FEE_LAYOUT");
      const exotic = {
        lpFeeBps: fBytes.readBigUInt64LE(end),
        protocolFeeBps: fBytes.readBigUInt64LE(end + 8),
        creatorFeeBps: fBytes.readBigUInt64LE(end + 16)
      };
      if (exotic.lpFeeBps + exotic.protocolFeeBps + exotic.creatorFeeBps > 0n) fees = exotic;
    }
    if (![2512, 4073, 4097].includes(fBytes.length)) fail2("STAGE1_FEE_LAYOUT_UNSUPPORTED");
    const creator = g.creatorFeeConfigurable && p.creatorFeeBps > 0n ? p.creatorFeeBps : fees.creatorFeeBps;
    if (g.creatorFeeConfigurable && creator > g.maxConfigurableCreatorFeeBps)
      fail2("STAGE1_CREATOR_FEE_LIMIT");
    const math = {
      base: base.amount,
      quote: quote.amount,
      virtual: p.virtualQuoteReserves,
      protocolBucket: poolBytes.readBigUInt64LE(271),
      creatorBucket: poolBytes.readBigUInt64LE(279),
      lpBps: fees.lpFeeBps,
      protocolBps: fees.protocolFeeBps,
      creatorBps: p.coinCreator === PublicKey2.default.toBase58() ? 0n : creator,
      buybackBps: globalBytes.readBigUInt64LE(899)
    };
    checked(math);
    const bridge = orcaLink(s.bridgePool, need(s, s.bridgePool));
    if (![bridge.mintA, bridge.mintB].includes(s.quoteMint) || ![bridge.mintA, bridge.mintB].includes(WRAPPED_SOL_MINT))
      fail2("STAGE1_BRIDGE_ORIENTATION");
    if ((bridge.extraAccounts ?? []).some((a) => !s.accounts[a] && !s.absentAccounts.includes(a)))
      fail2("STAGE1_TICK_CAPTURE_CHANGED");
    vault(s, bridge.vaultA, bridge.mintA, s.bridgePool);
    vault(s, bridge.vaultB, bridge.mintB, s.bridgePool);
    if (s.absentAccounts.some((a) => s.accounts[a])) fail2("STAGE1_ABSENT_ACCOUNT_CONFLICT");
    return {
      math,
      bridge,
      time,
      epoch,
      holderReward: poolBytes[270] === 1,
      baseDecimals: validatePumpSwapMint(s, s.mint).decimals,
      quoteDecimals: validatePumpSwapMint(s, s.quoteMint).decimals
    };
  }
  async quote(snapshot2, input, buy, policy) {
    const s = structuredClone(snapshot2);
    const v = await this.validate(s, policy);
    u64(input);
    if (input === 0n) dust();
    const bridgeQuote = (amount, fromSol) => {
      const result = quoteSupplementalHop(
        v.bridge,
        s.accounts,
        amount,
        v.bridge.mintA === (fromSol ? WRAPPED_SOL_MINT : s.quoteMint),
        v.time,
        validatePumpSwapMint(s, s.quoteMint).supply,
        s.absentAccounts
      );
      const outVault = vault(
        s,
        fromSol ? v.bridge.mintA === WRAPPED_SOL_MINT ? v.bridge.vaultB : v.bridge.vaultA : v.bridge.mintA === WRAPPED_SOL_MINT ? v.bridge.vaultA : v.bridge.vaultB,
        fromSol ? s.quoteMint : WRAPPED_SOL_MINT,
        s.bridgePool
      );
      if (result.output > outVault.amount) liquidity("STAGE1_BRIDGE_RESERVES");
      if (result.output <= 0n) dust();
      return result;
    };
    const bridge = buy ? bridgeQuote(input, true) : null;
    const target = stage1PoolSwap(v.math, bridge?.output ?? input, buy);
    const reverse = buy ? null : bridgeQuote(target.output, false);
    return {
      version: s.version,
      slot: s.slot,
      mint: s.mint,
      quoteMint: s.quoteMint,
      creatorFeeDestination: v.holderReward ? "HOLDER_REWARD" : "CREATOR",
      input,
      output: reverse?.output ?? target.output,
      buy,
      target,
      bridge: bridge ?? reverse,
      baseDecimals: v.baseDecimals,
      quoteDecimals: v.quoteDecimals,
      fingerprint: createHash3("sha256").update(JSON.stringify(s)).digest("hex")
    };
  }
  async exits(snapshot2, quantity, policy) {
    const s = structuredClone(snapshot2);
    u64(quantity);
    if (quantity === 0n) dust();
    const read = async (q) => {
      try {
        return { quantity: q, quote: await this.quote(s, q, false, policy), reason: null };
      } catch (e) {
        if (!(e instanceof ExecutionEngineError6) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
          throw e;
        return { quantity: q, quote: null, reason: e.code };
      }
    };
    const full = await read(quantity);
    let max = quantity;
    if (!full.quote) {
      let low = 0n, high = quantity;
      while (low < high) {
        const mid = (low + high + 1n) / 2n, r = await read(mid);
        if (r.reason === "INSUFFICIENT_EXECUTABLE_LIQUIDITY") high = mid - 1n;
        else low = mid;
      }
      max = low;
    }
    const capacity = await read(max);
    if (!capacity.quote) max = 0n;
    return {
      full,
      maxQuantity: max,
      maxOutput: capacity.quote?.output ?? 0n,
      percentages: await Promise.all([25n, 50n, 75n].map((p) => read(quantity * p / 100n)))
    };
  }
};

// packages/protocols/isolated/linked-pair/engine.ts
var CLOCK2 = "SysvarC1ock11111111111111111111111111111111";
var U642 = (1n << 64n) - 1n;
function fail3(reason) {
  throw new ExecutionEngineError7("INVALID_MARKET_STATE", reason);
}
function u642(n3) {
  if (typeof n3 !== "bigint" || n3 < 0n || n3 > U642) fail3("STAGE1_INVALID_U64");
  return n3;
}
function dust2() {
  throw new ExecutionEngineError7("ZERO_EXECUTABLE_OUTPUT", "STAGE1_DUST");
}
var info3 = (a) => ({
  data: Buffer.from(a.base64, "base64"),
  owner: new PublicKey3(a.owner),
  executable: false,
  lamports: 0,
  rentEpoch: 0
});
function need2(s, address3) {
  const a = s.accounts[address3];
  if (!a) fail3("STAGE1_REQUIRED_ACCOUNT_MISSING: " + address3);
  return a;
}
function vault2(s, address3, expectedMint, authority) {
  const a = need2(s, address3), program2 = need2(s, expectedMint).owner;
  if (a.owner !== program2) fail3("STAGE1_VAULT_PROGRAM");
  const v = unpackAccount2(new PublicKey3(address3), info3(a), new PublicKey3(program2));
  if (!v.isInitialized || v.isFrozen || v.mint.toBase58() !== expectedMint || v.owner.toBase58() !== authority)
    fail3("STAGE1_VAULT_IDENTITY");
  return v;
}
async function validatePumpPool(s, poolAddress, baseMint, quoteMint) {
  if (quoteMint !== WRAPPED_SOL_MINT) {
    const curveAddress = await pumpBondingCurveAddress(baseMint), curveAccount = need2(s, curveAddress);
    if (curveAccount.owner !== PUMP_PROGRAM_ID) fail3("STAGE1_CURVE_OWNER");
    const curve = decodePumpBondingCurve(Buffer.from(curveAccount.base64, "base64"));
    if (!curve.complete || curve.quoteMint !== quoteMint) fail3("STAGE1_MIGRATION_IDENTITY");
  }
  const poolAccount = need2(s, poolAddress), poolBytes = Buffer.from(poolAccount.base64, "base64");
  if (poolAccount.owner !== PUMP_AMM_PROGRAM_ID || ![287, 300, 301].includes(poolBytes.length))
    fail3("STAGE1_POOL_LAYOUT_UNSUPPORTED");
  const p = decodePumpSwapPool(poolBytes);
  if (poolAddress !== await canonicalPumpSwapPoolAddress(baseMint, quoteMint) || p.index !== 0 || p.creator !== await pumpPoolAuthorityAddress(baseMint) || p.baseMint !== baseMint || p.quoteMint !== quoteMint)
    fail3("STAGE1_CANONICAL_IDENTITY");
  if ([243, 244, 269, 270].some((i) => poolBytes[i] > 1) || poolBytes.subarray(287).some((b) => b !== 0))
    fail3("STAGE1_POOL_FLAGS_OR_TAIL");
  if (p.isMayhemMode || p.isCashbackCoin || p.canEditCreatorFee || poolBytes[270] > 1)
    fail3("STAGE1_FLAGS_UNSUPPORTED");
  for (const address3 of [baseMint, quoteMint, WRAPPED_SOL_MINT]) validatePumpSwapMint(s, address3);
  for (const [address3, m] of [
    [p.baseVault, baseMint],
    [p.quoteVault, quoteMint]
  ])
    if (getAssociatedTokenAddressSync3(
      new PublicKey3(m),
      new PublicKey3(poolAddress),
      true,
      new PublicKey3(need2(s, m).owner)
    ).toBase58() !== address3)
      fail3("STAGE1_TARGET_ATA");
  const base = vault2(s, p.baseVault, baseMint, poolAddress), quote = vault2(s, p.quoteVault, quoteMint, poolAddress);
  const globalAddress = await pumpSwapGlobalConfigAddress(), feeAddress = await pumpSwapFeeConfigAddress();
  if (need2(s, globalAddress).owner !== PUMP_AMM_PROGRAM_ID || need2(s, feeAddress).owner !== PUMP_FEE_PROGRAM_ID)
    fail3("STAGE1_CONFIG_OWNER");
  const globalBytes = Buffer.from(need2(s, globalAddress).base64, "base64"), g = decodePumpSwapGlobalConfig(globalBytes);
  if (globalBytes.length !== 949 || g.disableFlags !== 0 || [417, 642, 939, 940].some((i) => globalBytes[i] > 1))
    fail3("STAGE1_GLOBAL_STATE_UNSUPPORTED");
  const fBytes = Buffer.from(need2(s, feeAddress).base64, "base64"), legacy = decodePumpSwapFeeConfig(fBytes);
  let end = 69 + fBytes.readUInt32LE(65) * 40;
  if (fBytes.length >= 4073) {
    if (end + 4 > fBytes.length) fail3("STAGE1_FEE_LAYOUT");
    end += 4 + fBytes.readUInt32LE(end) * 40;
  }
  let fees = legacy.flatFees;
  if (fBytes.length >= 4097) {
    if (end + 24 > fBytes.length) fail3("STAGE1_FEE_LAYOUT");
    const exotic = {
      lpFeeBps: fBytes.readBigUInt64LE(end),
      protocolFeeBps: fBytes.readBigUInt64LE(end + 8),
      creatorFeeBps: fBytes.readBigUInt64LE(end + 16)
    };
    if (exotic.lpFeeBps + exotic.protocolFeeBps + exotic.creatorFeeBps > 0n) fees = exotic;
  }
  if (![2512, 4073, 4097].includes(fBytes.length)) fail3("STAGE1_FEE_LAYOUT_UNSUPPORTED");
  if (quoteMint === WRAPPED_SOL_MINT) {
    const cap = (quote.amount + p.virtualQuoteReserves) * validatePumpSwapMint(s, baseMint).supply / base.amount;
    fees = legacy.feeTiers[0].fees;
    for (const tier of legacy.feeTiers)
      if (cap >= tier.marketCapLamportsThreshold) fees = tier.fees;
  }
  const creator = g.creatorFeeConfigurable && p.creatorFeeBps > 0n ? p.creatorFeeBps : fees.creatorFeeBps;
  if (g.creatorFeeConfigurable && creator > g.maxConfigurableCreatorFeeBps)
    fail3("STAGE1_CREATOR_FEE_LIMIT");
  const math = {
    base: base.amount,
    quote: quote.amount,
    virtual: p.virtualQuoteReserves,
    protocolBucket: poolBytes.readBigUInt64LE(271),
    creatorBucket: poolBytes.readBigUInt64LE(279),
    lpBps: fees.lpFeeBps,
    protocolBps: fees.protocolFeeBps,
    creatorBps: p.coinCreator === PublicKey3.default.toBase58() ? 0n : creator,
    buybackBps: globalBytes.readBigUInt64LE(899)
  };
  for (const value of [math.base, math.quote, math.protocolBucket, math.creatorBucket]) u642(value);
  if (math.base === 0n || math.quote + math.virtual <= 0n || math.quote + math.virtual > U642 || math.protocolBucket + math.creatorBucket > math.quote || math.virtual < -(1n << 127n) || math.virtual >= 1n << 127n)
    fail3("STAGE1_INVALID_RESERVES");
  if ([math.lpBps, math.protocolBps, math.creatorBps, math.buybackBps].some(
    (n3) => n3 < 0n || n3 > 10000n
  ) || math.lpBps + math.protocolBps + math.creatorBps >= 10000n)
    fail3("STAGE1_INVALID_FEES");
  return {
    math,
    pool: p,
    holderReward: poolBytes[270] === 1,
    baseDecimals: validatePumpSwapMint(s, baseMint).decimals,
    quoteDecimals: validatePumpSwapMint(s, quoteMint).decimals
  };
}
var LinkedEngine = class {
  legacy;
  binding;
  constructor(options) {
    this.legacy = new Stage1NonSolPumpSwap(options);
    this.binding = options?.bridgeBinding ? { ...options.bridgeBinding } : void 0;
  }
  async validate(s, policy) {
    const capturedClock = Buffer.from(s.accounts[CLOCK2]?.base64 ?? "", "base64");
    if (capturedClock.length !== 40 || capturedClock.readBigUInt64LE(0) !== BigInt(s.slot))
      fail3("STAGE1_CLOCK_INCONSISTENT");
    const direct = s.quoteMint === WRAPPED_SOL_MINT && s.targetPool === s.bridgePool;
    const owner = s.accounts[s.bridgePool]?.owner;
    if (owner === ORCA_WHIRLPOOL_PROGRAM) return this.legacy.validate(s, policy);
    if (owner !== PUMP_AMM_PROGRAM_ID) fail3("LINKED_BRIDGE_PROGRAM_UNSUPPORTED");
    if (!this.binding || this.binding.quoteMint !== s.quoteMint || this.binding.pool !== s.bridgePool)
      fail3("LINKED_BRIDGE_BINDING_REQUIRED");
    if (s.version !== "NON_SOL_PUMPSWAP_STAGE1_V1" || !Number.isSafeInteger(s.slot) || s.slot < 0 || s.mint === s.quoteMint || !direct && (s.quoteMint === WRAPPED_SOL_MINT || s.targetPool === s.bridgePool))
      fail3("LINKED_PUMP_ROUTE_IDENTITY");
    const at = Date.parse(s.observedAt);
    if (!Number.isFinite(at) || !Number.isFinite(policy.nowMs) || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || at > policy.nowMs || policy.nowMs - at > policy.maxAgeMs)
      fail3("STAGE1_STALE_CAPTURE");
    const clock3 = Buffer.from(need2(s, CLOCK2).base64, "base64");
    if (need2(s, CLOCK2).owner !== "Sysvar1111111111111111111111111111111111111" || clock3.length !== 40 || clock3.readBigUInt64LE(0) > BigInt(s.slot))
      fail3("STAGE1_CLOCK_INCONSISTENT");
    const time = clock3.readBigInt64LE(32), epoch = clock3.readBigUInt64LE(16);
    if (BigInt(Math.floor(policy.nowMs)) < time * 1000n || BigInt(Math.floor(policy.nowMs)) - time * 1000n > BigInt(Math.ceil(policy.maxAgeMs)))
      fail3("STAGE1_STALE_BANK");
    if (s.absentAccounts.some((a) => s.accounts[a])) fail3("STAGE1_ABSENT_ACCOUNT_CONFLICT");
    const target = await validatePumpPool(s, s.targetPool, s.mint, s.quoteMint), bridgePool = direct ? target : await validatePumpPool(s, s.bridgePool, s.quoteMint, WRAPPED_SOL_MINT);
    const bridge = {
      pool: s.bridgePool,
      program: PUMP_AMM_PROGRAM_ID,
      mintA: direct ? s.mint : s.quoteMint,
      mintB: WRAPPED_SOL_MINT,
      vaultA: bridgePool.pool.baseVault,
      vaultB: bridgePool.pool.quoteVault,
      config: await pumpSwapGlobalConfigAddress()
    };
    return {
      math: target.math,
      bridge,
      time,
      epoch,
      holderReward: target.holderReward,
      baseDecimals: target.baseDecimals,
      quoteDecimals: target.quoteDecimals
    };
  }
  async bridgeQuote(s, input, buy, policy) {
    const v = await this.validate(s, policy);
    if (v.bridge.program !== PUMP_AMM_PROGRAM_ID)
      return quoteSupplementalHop(
        v.bridge,
        s.accounts,
        input,
        v.bridge.mintA === (buy ? WRAPPED_SOL_MINT : s.quoteMint),
        v.time,
        validatePumpSwapMint(s, s.quoteMint).supply,
        s.absentAccounts
      );
    const bridge = await validatePumpPool(s, s.bridgePool, s.quoteMint, WRAPPED_SOL_MINT), q = stage1PoolSwap(bridge.math, input, buy);
    return {
      output: q.output,
      feeMint: WRAPPED_SOL_MINT,
      lp: q.fees.lp,
      protocol: q.fees.protocol,
      creator: q.fees.creator,
      detail: {
        bridgeKind: "PUMP_SWAP",
        nativeInstruction: buy ? "buy_exact_quote_in_v2" : "sell_v2",
        bridgeCreatorFeeDestination: bridge.holderReward ? "HOLDER_REWARD" : "CREATOR",
        input: input.toString(),
        output: q.output.toString(),
        fees: Object.fromEntries(Object.entries(q.fees).map(([k, v2]) => [k, v2.toString()])),
        postTrade: Object.fromEntries(Object.entries(q.post).map(([k, v2]) => [k, v2.toString()]))
      }
    };
  }
  async quote(s, input, buy, policy) {
    if (s.accounts[s.bridgePool]?.owner === ORCA_WHIRLPOOL_PROGRAM)
      return this.legacy.quote(s, input, buy, policy);
    const v = await this.validate(s, policy);
    u642(input);
    if (input === 0n) dust2();
    if (s.quoteMint === WRAPPED_SOL_MINT && s.targetPool === s.bridgePool) {
      const target2 = stage1PoolSwap(v.math, input, buy);
      return {
        version: s.version,
        slot: s.slot,
        mint: s.mint,
        quoteMint: s.quoteMint,
        creatorFeeDestination: v.holderReward ? "HOLDER_REWARD" : "CREATOR",
        input,
        output: target2.output,
        buy,
        target: target2,
        bridge: {
          output: buy ? input : target2.output,
          feeMint: WRAPPED_SOL_MINT,
          lp: 0n,
          protocol: 0n,
          creator: 0n,
          detail: { bridgeKind: "DIRECT" }
        },
        baseDecimals: v.baseDecimals,
        quoteDecimals: v.quoteDecimals,
        fingerprint: createHash4("sha256").update(JSON.stringify(s)).digest("hex")
      };
    }
    const bridge = buy ? await this.bridgeQuote(s, input, true, policy) : null, target = stage1PoolSwap(v.math, bridge?.output ?? input, buy), reverse = buy ? null : await this.bridgeQuote(s, target.output, false, policy);
    return {
      version: s.version,
      slot: s.slot,
      mint: s.mint,
      quoteMint: s.quoteMint,
      creatorFeeDestination: v.holderReward ? "HOLDER_REWARD" : "CREATOR",
      input,
      output: reverse?.output ?? target.output,
      buy,
      target,
      bridge: bridge ?? reverse,
      baseDecimals: v.baseDecimals,
      quoteDecimals: v.quoteDecimals,
      fingerprint: createHash4("sha256").update(JSON.stringify(s)).digest("hex")
    };
  }
  async exits(snapshot2, quantity, policy) {
    const s = structuredClone(snapshot2);
    u642(quantity);
    if (quantity === 0n) dust2();
    const read = async (q) => {
      try {
        return { quantity: q, quote: await this.quote(s, q, false, policy), reason: null };
      } catch (e) {
        if (!(e instanceof ExecutionEngineError7) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
          throw e;
        return { quantity: q, quote: null, reason: e.code };
      }
    };
    const full = await read(quantity);
    let max = quantity;
    if (!full.quote) {
      let low = 0n, high = quantity;
      while (low < high) {
        const mid = (low + high + 1n) / 2n, r = await read(mid);
        if (r.reason === "INSUFFICIENT_EXECUTABLE_LIQUIDITY") high = mid - 1n;
        else low = mid;
      }
      max = low;
    }
    const capacity = await read(max);
    if (!capacity.quote) max = 0n;
    return {
      full,
      maxQuantity: max,
      maxOutput: capacity.quote?.output ?? 0n,
      percentages: await Promise.all([25n, 50n, 75n].map((p) => read(quantity * p / 100n)))
    };
  }
};

// packages/protocols/isolated/linked-pair/native-transition.ts
import BN2 from "./packages/protocols/node_modules/bn.js/lib/bn.js";
import { PublicKey as PublicKey4 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { BorshAccountsCoder } from "./packages/protocols/node_modules/@coral-xyz/anchor/dist/cjs/index.js";
import { convertIdlToCamelCase } from "./packages/protocols/node_modules/@coral-xyz/anchor/dist/cjs/idl.js";
import { WHIRLPOOL_IDL, PriceMath, SwapUtils as SwapUtils2, PoolUtil as PoolUtil2, PDAUtil as PDAUtil2 } from "./packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/index.js";
import { TickArraySequence } from "./packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/quotes/swap/tick-array-sequence.js";
import { FeeRateManager } from "./packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/quotes/swap/fee-rate-manager.js";
import { computeSwapStep } from "./packages/protocols/node_modules/@orca-so/whirlpools-sdk/dist/utils/math/swap-math.js";
import { createHash as createHash5 } from "node:crypto";
var U643 = (1n << 64n) - 1n;
var U128 = (1n << 128n) - 1n;
var codec = new BorshAccountsCoder(convertIdlToCamelCase(WHIRLPOOL_IDL));
var integer = (n3) => BigInt(n3.toString());
var bn = (n3) => new BN2(n3.toString());
var LinkedTransitionError = class extends Error {
  code = "LINKED_STATE_TRANSITION_UNAVAILABLE";
};
var fail4 = (reason) => {
  throw new LinkedTransitionError(reason);
};
var hash = (s) => createHash5("sha256").update(JSON.stringify(s)).digest("hex");
function u643(n3) {
  if (n3 < 0n || n3 > U643) fail4("U64_RANGE");
  return n3;
}
function engine(s) {
  return new LinkedEngine({
    purpose: "READ_ONLY_STAGE1_VALIDATION",
    bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool }
  });
}
function put(s, address3, raw) {
  const a = s.accounts[address3];
  if (!a) return fail4("ACCOUNT_MISSING");
  s.accounts[address3] = { ...a, base64: raw.toString("base64") };
}
function setVault(s, address3, amount) {
  const raw = Buffer.from(s.accounts[address3].base64, "base64");
  raw.writeBigUInt64LE(u643(amount), 64);
  put(s, address3, raw);
}
async function encode(s, address3, name, data) {
  const original2 = Buffer.from(s.accounts[address3].base64, "base64");
  const bytes3 = await codec.encode(name, data);
  if (bytes3.length > original2.length) fail4("ACCOUNT_CODEC_CHANGED");
  bytes3.copy(original2);
  put(s, address3, original2);
}
async function transitionLinkedSnapshot(snapshot2, input, buy, policy) {
  const s = structuredClone(snapshot2), native = engine(s), valid = await native.validate(s, policy);
  const quote = await native.quote(s, input, buy, policy);
  const bridgeInput = buy ? input : quote.target.output;
  const bridgeReceipt = s.targetPool === s.bridgePool ? { totalFee: 0n, protocolFee: 0n } : await advanceBridge(s, valid, bridgeInput, buy, quote.bridge);
  applyTarget(s, quote.target);
  await native.validate(s, policy);
  return {
    next: s,
    quote,
    receipt: {
      model: "LINKED_NATIVE_TRANSITION_CANDIDATE_V1",
      beforeHash: hash(snapshot2),
      afterHash: hash(s),
      input: input.toString(),
      output: quote.output.toString(),
      side: buy ? "BUY" : "SELL",
      ...valid.bridge.program === PUMP_AMM_PROGRAM_ID ? {
        bridgeKind: "PUMP_SWAP",
        bridgeLpFee: quote.bridge.lp.toString(),
        bridgeProtocolFee: quote.bridge.protocol.toString(),
        bridgeCreatorOrHolderFee: quote.bridge.creator.toString(),
        bridgeFeeMint: quote.bridge.feeMint
      } : {
        orcaFee: bridgeReceipt.totalFee.toString(),
        orcaProtocolFee: bridgeReceipt.protocolFee.toString(),
        orcaLpFee: (bridgeReceipt.totalFee - bridgeReceipt.protocolFee).toString()
      },
      sourceSlot: snapshot2.slot
    }
  };
}
async function advanceBridge(s, valid, bridgeInput, buy, expected) {
  if (valid.bridge.program === PUMP_AMM_PROGRAM_ID) {
    const v = await validatePumpPool(s, s.bridgePool, s.quoteMint, WRAPPED_SOL_MINT), q = stage1PoolSwap(v.math, bridgeInput, buy);
    if (q.output !== expected.output || q.fees.lp !== expected.lp || q.fees.protocol !== expected.protocol || q.fees.creator !== expected.creator)
      fail4("NATIVE_PUMP_BRIDGE_DISAGREEMENT");
    applyPool(s, s.bridgePool, q);
    return {
      totalFee: q.fees.lp + q.fees.protocol + q.fees.creator,
      protocolFee: q.fees.protocol,
      creatorFee: q.fees.creator
    };
  }
  const fromSol = buy, aToB = valid.bridge.mintA === (fromSol ? WRAPPED_SOL_MINT : s.quoteMint);
  const { data, ticks, oracle } = readOrcaSnapshot(
    valid.bridge,
    s.accounts,
    aToB,
    s.absentAccounts
  );
  const previousTime = integer(data.rewardLastUpdatedTimestamp);
  if (valid.time < previousTime) fail4("REWARD_TIME_REGRESSION");
  if (!data.liquidity.isZero() && valid.time !== previousTime) {
    for (const reward of data.rewardInfos) {
      if (reward.mint.equals(PublicKey4.default)) continue;
      const product = (valid.time - previousTime) * integer(reward.emissionsPerSecondX64);
      const delta = product > U128 ? 0n : product / integer(data.liquidity);
      reward.growthGlobalX64 = bn(integer(reward.growthGlobalX64) + delta & U128);
    }
  }
  const sequence = new TickArraySequence(
    SwapUtils2.interpolateUninitializedTickArrays(new PublicKey4(s.bridgePool), ticks),
    data.tickSpacing,
    aToB
  );
  if (!sequence.isValidTickArray0(data.tickCurrentIndex)) fail4("TICK_RANGE_UNAVAILABLE");
  const manager = FeeRateManager.new(
    aToB,
    data.tickCurrentIndex,
    bn(valid.time),
    data.feeRate,
    PoolUtil2.isInitializedWithAdaptiveFee(data) && oracle ? {
      adaptiveFeeConstants: oracle.adaptiveFeeConstants,
      adaptiveFeeVariables: oracle.adaptiveFeeVariables
    } : null
  );
  let remaining = bn(bridgeInput), output = 0n, totalFee = 0n, protocolFee = 0n;
  let liquidity2 = data.liquidity.clone();
  let sqrt = data.sqrtPrice.clone(), tick = data.tickCurrentIndex;
  let growth = integer(aToB ? data.feeGrowthGlobalA : data.feeGrowthGlobalB);
  const limit = SwapUtils2.getDefaultSqrtPriceLimit(aToB);
  let steps = 0;
  while (!remaining.isZero() && !sqrt.eq(limit)) {
    if (++steps > 1e4) fail4("SWAP_STEP_BOUND");
    const { nextIndex } = sequence.findNextInitializedTickIndex(tick);
    const nextTickPrice = PriceMath.tickIndexToSqrtPriceX64(nextIndex);
    const target = aToB ? BN2.max(limit, nextTickPrice) : BN2.min(limit, nextTickPrice);
    do {
      manager.updateVolatilityAccumulator();
      const bounded = manager.getBoundedSqrtPriceTarget(target, liquidity2);
      const step = computeSwapStep(
        remaining,
        manager.getTotalFeeRate(),
        liquidity2,
        sqrt,
        bounded.boundedSqrtPriceTarget,
        true,
        aToB
      );
      remaining = remaining.sub(step.amountIn).sub(step.feeAmount);
      if (remaining.isNeg()) fail4("NEGATIVE_INPUT");
      output = u643(output + integer(step.amountOut));
      const fee3 = integer(step.feeAmount), protocol2 = fee3 * BigInt(data.protocolFeeRate) / 10000n;
      totalFee = u643(totalFee + fee3);
      protocolFee = u643(protocolFee + protocol2);
      if (!liquidity2.isZero())
        growth = growth + (fee3 - protocol2 << 64n) / integer(liquidity2) & U128;
      if (step.nextPrice.eq(nextTickPrice)) {
        const crossed = sequence.getTick(nextIndex);
        if (crossed.initialized) {
          crossed.feeGrowthOutsideA = bn(
            (aToB ? growth : integer(data.feeGrowthGlobalA)) - integer(crossed.feeGrowthOutsideA) & U128
          );
          crossed.feeGrowthOutsideB = bn(
            (aToB ? integer(data.feeGrowthGlobalB) : growth) - integer(crossed.feeGrowthOutsideB) & U128
          );
          crossed.rewardGrowthsOutside = crossed.rewardGrowthsOutside.map(
            (outside, i) => data.rewardInfos[i].mint.equals(PublicKey4.default) ? outside : bn(integer(data.rewardInfos[i].growthGlobalX64) - integer(outside) & U128)
          );
          const nextLiquidity = integer(liquidity2) + (aToB ? -integer(crossed.liquidityNet) : integer(crossed.liquidityNet));
          if (nextLiquidity < 0n || nextLiquidity > U128) fail4("LIQUIDITY_CROSS_RANGE");
          liquidity2 = bn(nextLiquidity);
          const array = ticks.find(
            (a) => a.data && nextIndex >= a.data.startTickIndex && nextIndex < a.data.startTickIndex + 88 * data.tickSpacing
          );
          if (!array?.data) fail4("CROSSED_TICK_ACCOUNT_MISSING");
          patchCrossedTick(
            s,
            array.address.toBase58(),
            Math.floor((nextIndex - array.data.startTickIndex) / data.tickSpacing),
            crossed
          );
        }
        tick = aToB ? nextIndex - 1 : nextIndex;
      } else if (!step.nextPrice.eq(sqrt)) tick = PriceMath.sqrtPriceX64ToTickIndex(step.nextPrice);
      const progressed = !step.nextPrice.eq(sqrt) || !step.amountIn.isZero() || !step.feeAmount.isZero();
      sqrt = step.nextPrice;
      if (!bounded.adaptiveFeeUpdateSkipped) manager.advanceTickGroup();
      else manager.advanceTickGroupAfterSkip(sqrt, nextTickPrice, nextIndex);
      if (!progressed && !sqrt.eq(target)) fail4("SWAP_NO_PROGRESS");
      if (++steps > 1e4) fail4("SWAP_STEP_BOUND");
    } while (!remaining.isZero() && !sqrt.eq(target));
  }
  if (!remaining.isZero()) fail4("PARTIAL_ORCA_INPUT");
  if (output !== expected.output || totalFee !== expected.lp || sqrt.toString() !== String(expected.detail.endSqrtPrice) || tick !== expected.detail.endTick)
    fail4("NATIVE_QUOTE_DISAGREEMENT");
  data.sqrtPrice = sqrt;
  data.tickCurrentIndex = tick;
  data.liquidity = liquidity2;
  data.rewardLastUpdatedTimestamp = bn(valid.time);
  if (aToB) {
    data.feeGrowthGlobalA = bn(growth);
    data.protocolFeeOwedA = bn(u643(integer(data.protocolFeeOwedA) + protocolFee));
  } else {
    data.feeGrowthGlobalB = bn(growth);
    data.protocolFeeOwedB = bn(u643(integer(data.protocolFeeOwedB) + protocolFee));
  }
  await encode(s, s.bridgePool, "whirlpool", data);
  const nextAdaptive = manager.getNextAdaptiveFeeInfo();
  if (nextAdaptive && oracle) {
    oracle.adaptiveFeeVariables = nextAdaptive.adaptiveFeeVariables;
    const address3 = PDAUtil2.getOracle(
      new PublicKey4(ORCA_WHIRLPOOL_PROGRAM),
      new PublicKey4(s.bridgePool)
    ).publicKey.toBase58();
    await encode(s, address3, "oracle", oracle);
  }
  const inputVault = aToB ? valid.bridge.vaultA : valid.bridge.vaultB, outputVault = aToB ? valid.bridge.vaultB : valid.bridge.vaultA;
  const amount = (address3) => Buffer.from(s.accounts[address3].base64, "base64").readBigUInt64LE(64);
  setVault(s, inputVault, amount(inputVault) + bridgeInput);
  setVault(s, outputVault, amount(outputVault) - output);
  return { totalFee, protocolFee };
}
function applyTarget(s, quote) {
  applyPool(s, s.targetPool, quote);
}
function applyPool(s, poolAddress, quote) {
  const pool = decodePumpSwapPool(Buffer.from(s.accounts[poolAddress].base64, "base64"));
  const post = quote.post, raw = Buffer.from(s.accounts[poolAddress].base64, "base64");
  setVault(s, pool.baseVault, post.base);
  setVault(s, pool.quoteVault, post.quote);
  const virtual = BigInt.asUintN(128, post.virtual);
  raw.writeBigUInt64LE(virtual & U643, 245);
  raw.writeBigUInt64LE(virtual >> 64n, 253);
  raw.writeBigUInt64LE(u643(post.protocolBucket), 271);
  raw.writeBigUInt64LE(u643(post.creatorBucket), 279);
  put(s, poolAddress, raw);
}
async function transitionLinkedLeg(snapshot2, input, buy, policy, leg) {
  const s = structuredClone(snapshot2), native = engine(s), valid = await native.validate(s, policy);
  let output;
  if (leg === "TARGET") {
    const q = stage1PoolSwap(valid.math, input, buy);
    applyTarget(s, q);
    output = q.output;
  } else {
    const q = await native.bridgeQuote(s, input, buy, policy);
    await advanceBridge(s, valid, input, buy, q);
    output = q.output;
  }
  await native.validate(s, policy);
  return { next: s, output, beforeHash: hash(snapshot2), afterHash: hash(s) };
}
function patchCrossedTick(s, address3, index2, tick) {
  const raw = Buffer.from(s.accounts[address3].base64, "base64"), disc2 = (name) => createHash5("sha256").update("account:" + name).digest().subarray(0, 8);
  if (index2 < 0 || index2 >= 88) fail4("CROSSED_TICK_INDEX");
  let offset;
  if (raw.subarray(0, 8).equals(disc2("TickArray"))) offset = 12 + index2 * 113;
  else if (raw.subarray(0, 8).equals(disc2("DynamicTickArray"))) {
    offset = 60;
    const bitmap = raw.readBigUInt64LE(44) + (raw.readBigUInt64LE(52) << 64n);
    for (let i = 0; i <= index2; i++) {
      const tag = raw[offset];
      if (tag !== 0 && tag !== 1) fail4("DYNAMIC_TICK_TAG");
      if (Boolean(bitmap >> BigInt(i) & 1n) !== Boolean(tag)) fail4("DYNAMIC_TICK_BITMAP");
      if (i < index2) offset += tag === 1 ? 113 : 1;
    }
  } else return fail4("CROSSED_TICK_CODEC_UNSUPPORTED");
  if (raw[offset] !== 1 || offset + 113 > raw.length) fail4("CROSSED_TICK_NOT_INITIALIZED");
  const write = (at, value) => {
    const n3 = integer(value) & U128;
    raw.writeBigUInt64LE(n3 & U643, at);
    raw.writeBigUInt64LE(n3 >> 64n, at + 8);
  };
  write(offset + 33, tick.feeGrowthOutsideA);
  write(offset + 49, tick.feeGrowthOutsideB);
  tick.rewardGrowthsOutside.forEach((v, i) => write(offset + 65 + i * 16, v));
  put(s, address3, raw);
}

// packages/protocols/isolated/linked-pair/shared-bridge.ts
var fail5 = (reason) => {
  throw new LinkedTransitionError(reason);
};
function linkedBindings(s) {
  return s.linkedRoutes ?? [
    { mint: s.mint, quoteMint: s.quoteMint, targetPool: s.targetPool, bridgePool: s.bridgePool }
  ];
}
function linkedRoute(s, mint, bridgePool) {
  const routes = linkedBindings(s), binding = routes.find((r) => r.mint === mint && (!bridgePool || r.bridgePool === bridgePool));
  if (!binding) return fail5("LINKED_MINT_NOT_BOUND");
  if (new Set(routes.map((r) => [r.mint, r.bridgePool].join(":"))).size !== routes.length)
    fail5("LINKED_SHARED_BINDING_CONFLICT");
  return { ...s, ...binding };
}
function carryLinkedRoot(root, next) {
  const original2 = linkedBindings(root), selected = original2.find(
    (r) => r.mint === next.mint && r.targetPool === next.targetPool && r.bridgePool === next.bridgePool && r.quoteMint === next.quoteMint
  );
  if (!selected || selected.targetPool !== next.targetPool || next.bridgePool !== selected.bridgePool || next.quoteMint !== selected.quoteMint)
    fail5("LINKED_SUCCESSOR_ROUTE_CHANGED");
  return {
    ...next,
    mint: root.mint,
    targetPool: root.targetPool,
    quoteMint: root.quoteMint,
    bridgePool: root.bridgePool
  };
}

// packages/protocols/isolated/linked-pair/supported-exit.ts
import { ExecutionEngineError as ExecutionEngineError8 } from "./packages/execution/dist/index.js";
async function supportedLinkedExit(snapshot2, quantity) {
  if (quantity <= 0n) throw Error("LINKED_INVALID_SETTLEMENT_QUANTITY");
  const attempt = async (q) => {
    try {
      const step = await transitionLinkedSnapshot(snapshot2, q, false, {
        nowMs: Date.parse(snapshot2.observedAt),
        maxAgeMs: 1e4
      });
      return { kind: "OK", quantity: q, output: step.quote.output, step };
    } catch (error) {
      if (error instanceof ExecutionEngineError8 && error.code === "ZERO_EXECUTABLE_OUTPUT")
        return { kind: "DUST" };
      if (error instanceof ExecutionEngineError8 && error.code === "INSUFFICIENT_EXECUTABLE_LIQUIDITY")
        return { kind: "BOUND" };
      throw error;
    }
  };
  const full = await attempt(quantity);
  if (full.kind === "OK") return { quantity: full.quantity, output: full.output, limitation: null };
  if (full.kind === "DUST") return { quantity: 0n, output: 0n, limitation: full.kind };
  let low = 1n, high = quantity - 1n, best = { quantity: 0n, output: 0n };
  while (low <= high) {
    const mid = (low + high) / 2n, result = await attempt(mid);
    if (result.kind === "OK") {
      best = { quantity: mid, output: result.output };
      low = mid + 1n;
    } else if (result.kind === "DUST") low = mid + 1n;
    else if (result.kind === "BOUND") high = mid - 1n;
  }
  return { ...best, limitation: "SUPPORTED_NATIVE_PREFIX" };
}

// packages/protocols/isolated/linked-pair/pump-curve.ts
import { PublicKey as PublicKey5 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { getAssociatedTokenAddressSync as getAssociatedTokenAddressSync4, unpackAccount as unpackAccount3 } from "./packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import { ExecutionEngineError as ExecutionEngineError9 } from "./packages/execution/dist/index.js";
var U644 = (1n << 64n) - 1n;
var ZERO = PublicKey5.default.toBase58();
var fail6 = (s) => {
  throw new ExecutionEngineError9("INVALID_MARKET_STATE", s);
};
var fee2 = (n3, b) => (n3 * b + 9999n) / 10000n;
function need3(s, a) {
  const v = s.accounts[a];
  if (!v) fail6("CURVE_DEPENDENCY_MISSING:" + a);
  return v;
}
function token(s, a, m, owner) {
  const v = need3(s, a), program2 = need3(s, m).owner;
  if (v.owner !== program2) fail6("CURVE_TOKEN_PROGRAM");
  const t = unpackAccount3(
    new PublicKey5(a),
    {
      data: Buffer.from(v.base64, "base64"),
      owner: new PublicKey5(v.owner),
      lamports: 0,
      executable: false,
      rentEpoch: 0
    },
    new PublicKey5(program2)
  );
  if (!t.isInitialized || t.isFrozen || t.mint.toBase58() !== m || t.owner.toBase58() !== owner)
    fail6("CURVE_VAULT_IDENTITY");
  return t;
}
async function validatePumpCurve(s, address3, baseMint, quoteMint, allowComplete = false) {
  const captured2 = need3(s, "SysvarC1ock11111111111111111111111111111111"), clock3 = Buffer.from(captured2.base64, "base64");
  if (captured2.owner !== "Sysvar1111111111111111111111111111111111111" || clock3.length !== 40 || !Number.isSafeInteger(s.slot) || clock3.readBigUInt64LE(0) !== BigInt(s.slot))
    fail6("CURVE_CLOCK_INCONSISTENT");
  const account = need3(s, address3), raw = Buffer.from(account.base64, "base64");
  if (account.owner !== PUMP_PROGRAM_ID || raw.length !== 166 || address3 !== await pumpBondingCurveAddress(baseMint))
    fail6("CURVE_IDENTITY_OR_LAYOUT");
  const c = decodePumpBondingCurve(raw);
  if ([48, 81, 82, 123, 124].some((i) => raw[i] > 1) || !allowComplete && c.complete || c.isMayhemMode || c.isCashbackCoin || raw[123] !== 0 || !allowComplete && (raw.readBigUInt64LE(150) !== 0n || raw.readBigUInt64LE(158) !== 0n))
    fail6("CURVE_FLAGS_OR_COMPLETION_UNSUPPORTED");
  if ((c.quoteMint === ZERO ? WRAPPED_SOL_MINT : c.quoteMint) !== quoteMint)
    fail6("CURVE_QUOTE_IDENTITY");
  const native = quoteMint === WRAPPED_SOL_MINT;
  const base = validatePumpSwapMint(s, baseMint), quote = validatePumpSwapMint(s, quoteMint);
  const ata = (mint) => getAssociatedTokenAddressSync4(
    new PublicKey5(mint),
    new PublicKey5(address3),
    true,
    new PublicKey5(need3(s, mint).owner)
  ).toBase58();
  const baseVault = ata(baseMint), quoteVault = ata(quoteMint), bv = token(s, baseVault, baseMint, address3), qv = native ? null : token(s, quoteVault, quoteMint, address3);
  const ga = need3(s, await pumpGlobalAddress()), fa = need3(s, await pumpFeeConfigAddress()), g = Buffer.from(ga.base64, "base64"), f = Buffer.from(fa.base64, "base64");
  if (ga.owner !== PUMP_PROGRAM_ID || fa.owner !== PUMP_FEE_PROGRAM_ID || g.length !== 1088 || f.length !== 4097)
    fail6("CURVE_CONFIG_LAYOUT");
  decodePumpGlobal(g);
  const decoded = decodePumpSwapFeeConfig(f);
  let end = 69 + f.readUInt32LE(65) * 40;
  if (end + 4 > f.length) fail6("CURVE_FEE_LAYOUT");
  const count = f.readUInt32LE(end);
  end += 4;
  if (end + count * 40 + 24 > f.length || f.subarray(end + count * 40 + 24).some((b) => b !== 0))
    fail6("CURVE_FEE_LAYOUT");
  let rates = decoded.flatFees;
  if (native) {
    const cap = 1000000000000000n * c.virtualSolReserves / c.virtualTokenReserves;
    if (!decoded.feeTiers.length) fail6("CURVE_SOL_FEES_MISSING");
    rates = decoded.feeTiers[0].fees;
    for (const t of decoded.feeTiers) if (cap >= t.marketCapLamportsThreshold) rates = t.fees;
  } else if (quoteMint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
    if (!count) fail6("CURVE_STABLE_FEES_MISSING");
    const cap = 1000000000000000n * c.virtualSolReserves / c.virtualTokenReserves;
    for (let i = 0; i < count; i++) {
      const p = end + i * 40, threshold = f.readBigUInt64LE(p) + (f.readBigUInt64LE(p + 8) << 64n);
      if (i === 0 || cap >= threshold)
        rates = {
          lpFeeBps: f.readBigUInt64LE(p + 16),
          protocolFeeBps: f.readBigUInt64LE(p + 24),
          creatorFeeBps: f.readBigUInt64LE(p + 32)
        };
    }
  } else {
    end += count * 40;
    const exotic = {
      lpFeeBps: f.readBigUInt64LE(end),
      protocolFeeBps: f.readBigUInt64LE(end + 8),
      creatorFeeBps: f.readBigUInt64LE(end + 16)
    };
    if (exotic.lpFeeBps + exotic.protocolFeeBps + exotic.creatorFeeBps > 0n) rates = exotic;
  }
  if (g[1045] > 1 || g[1086] > 1 || c.isHolderReward && g[1086] !== 1)
    fail6("CURVE_GLOBAL_FLAGS");
  const creatorBps = c.creator === ZERO ? 0n : g[1045] === 1 && c.creatorFeeBps > 0n ? c.creatorFeeBps : rates.creatorFeeBps;
  const protocolBps = rates.protocolFeeBps, buybackBps = g.readBigUInt64LE(997), creatorBucket = raw.readBigUInt64LE(125), protocolBucket = raw.readBigUInt64LE(133);
  if ([creatorBps, protocolBps, buybackBps].some((x) => x > 10000n) || creatorBps + protocolBps >= 10000n || g[1045] === 1 && creatorBps > g.readBigUInt64LE(1046))
    fail6("CURVE_FEE_RANGE");
  let rent = 0n, nativeBalance;
  if (native) {
    const l = account.lamports, r = need3(s, "SysvarRent111111111111111111111111111111111"), b = Buffer.from(r.base64, "base64");
    if (!l || !/^\d+$/.test(l) || r.owner !== "Sysvar1111111111111111111111111111111111111" || b.length !== 17 || ![1, 2].includes(b.readDoubleLE(8)))
      fail6("CURVE_NATIVE_LAMPORT_STATE_REQUIRED");
    nativeBalance = BigInt(l);
    rent = BigInt(raw.length + 128) * b.readBigUInt64LE(0) * BigInt(b.readDoubleLE(8));
  }
  const quoteBalance = native ? nativeBalance - rent : qv.amount;
  if (c.virtualTokenReserves === 0n || c.virtualSolReserves === 0n || !allowComplete && c.realTokenReserves === 0n || bv.amount < c.realTokenReserves || quoteBalance < c.realSolReserves + creatorBucket + protocolBucket + raw.readBigUInt64LE(158) || c.virtualSolReserves !== c.realSolReserves + raw.readBigUInt64LE(142))
    fail6("CURVE_RESERVES_INCOHERENT");
  return {
    curve: c,
    raw,
    baseVault,
    quoteVault,
    baseBalance: bv.amount,
    quoteBalance,
    native,
    rent,
    nativeBalance,
    migrationFee: g.readBigUInt64LE(146),
    baseDecimals: base.decimals,
    quoteDecimals: quote.decimals,
    creatorBps,
    protocolBps,
    buybackBps,
    creatorBucket,
    protocolBucket
  };
}
async function transitionExternalCurve(snapshot2, spec, policy) {
  const s = structuredClone(snapshot2), raw = Buffer.from(need3(s, spec.pool).base64, "base64"), c = decodePumpBondingCurve(raw);
  const baseMint = spec.baseMint;
  const v = await validatePumpCurve(s, spec.pool, baseMint, spec.quoteMint);
  if (spec.baseVault && spec.baseVault !== v.baseVault || spec.quoteVault && spec.quoteVault !== v.quoteVault)
    fail6("CURVE_INSTRUCTION_VAULT_BINDING");
  if (spec.legacy) {
    const a = spec.payouts, g = Buffer.from(need3(s, await pumpGlobalAddress()).base64, "base64");
    if (!a) fail6("CURVE_V2_PAYOUT_BINDINGS_REQUIRED");
    const key2 = (at2) => new PublicKey5(g.subarray(at2, at2 + 32)).toBase58();
    const protocolWallets = [key2(41), ...Array.from({ length: 7 }, (_, i) => key2(162 + i * 32))], buybackWallets = Array.from({ length: 8 }, (_, i) => key2(741 + i * 32));
    const creatorVault = PublicKey5.findProgramAddressSync(
      [Buffer.from("creator-vault"), new PublicKey5(c.creator).toBuffer()],
      new PublicKey5(PUMP_PROGRAM_ID)
    )[0].toBase58(), sharingConfig = PublicKey5.findProgramAddressSync(
      [Buffer.from("sharing-config"), new PublicKey5(baseMint).toBuffer()],
      new PublicKey5(PUMP_FEE_PROGRAM_ID)
    )[0].toBase58();
    const destination = (owner) => v.native ? owner : getAssociatedTokenAddressSync4(
      new PublicKey5(spec.quoteMint),
      new PublicKey5(owner),
      true,
      new PublicKey5(need3(s, spec.quoteMint).owner)
    ).toBase58();
    if (!protocolWallets.includes(a.protocolWallet) || !buybackWallets.includes(a.buybackWallet) || a.creatorVault !== creatorVault || a.sharingConfig !== sharingConfig || spec.protocolRecipient !== destination(a.protocolWallet) || spec.creatorRecipient !== destination(creatorVault) || spec.buybackRecipient !== destination(a.buybackWallet))
      fail6("CURVE_V2_FEE_DESTINATION_BINDING");
  }
  const at = Date.parse(s.observedAt);
  if (!Number.isFinite(at) || !Number.isFinite(policy.nowMs) || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || policy.nowMs < at || policy.nowMs - at > policy.maxAgeMs)
    fail6("STALE_CURVE_EXTERNAL_STATE");
  if (spec.bound < 0n || spec.bound > U644) fail6("CURVE_BOUND_RANGE");
  if (spec.amount <= 0n || spec.amount > U644) fail6("CURVE_AMOUNT_RANGE");
  const tokenEnd = !spec.feeRole || ["TOKEN_END", "BOTH"].includes(spec.feeRole), currencyEnd = !spec.feeRole || ["CURRENCY_END", "BOTH"].includes(spec.feeRole);
  const cb = tokenEnd ? v.creatorBps : 0n, pb = currencyEnd ? v.protocolBps : 0n;
  let output, input = spec.amount, gross, protocol2 = 0n, creator = 0n, buyback = 0n, curveGross, postBase = 0n, postQuote = 0n;
  const net = (budget) => {
    let n3 = budget * 10000n / (10000n + pb + cb);
    const cost = n3 + fee2(n3, pb) + fee2(n3, cb);
    if (cost > budget) n3 -= cost - budget;
    return n3;
  };
  const charge = (g) => {
    const p = fee2(g, pb), cfee = fee2(g, cb);
    protocol2 += p;
    creator += cfee;
    buyback += p * v.buybackBps / 10000n;
    return p + cfee;
  };
  if (spec.buy) {
    const n3 = spec.exactOutput ? 0n : net(input);
    if (!spec.exactOutput && n3 <= 1n)
      throw new ExecutionEngineError9("ZERO_EXECUTABLE_OUTPUT", "CURVE_DUST");
    output = spec.exactOutput ? spec.amount : (n3 - 1n) * c.virtualTokenReserves / (c.virtualSolReserves + n3 - 1n);
    if (spec.legacy && output > c.realTokenReserves) fail6("CURVE_V2_COMPLETION_OVERFLOW");
    const completing = output >= c.realTokenReserves;
    if (completing) {
      const remaining = c.realTokenReserves;
      curveGross = remaining * c.virtualSolReserves / (c.virtualTokenReserves - remaining) + 1n;
      const curveCost = curveGross + charge(curveGross), poolBase = v.baseBalance - remaining, poolQuote = c.realSolReserves + curveGross - (v.native ? v.migrationFee : 0n);
      if (poolBase <= 0n || poolQuote <= 0n) fail6("CURVE_EMPTY_MIGRATION_POOL");
      if (spec.exactOutput) {
        postBase = output - remaining;
        if (postBase >= poolBase) fail6("CURVE_POST_COMPLETE_LIQUIDITY");
        postQuote = postBase === 0n ? 0n : (poolQuote * postBase + poolBase - postBase - 1n) / (poolBase - postBase);
        input = curveCost + postQuote + charge(postQuote);
      } else {
        const left = input - curveCost;
        if (left < 0n) fail6("CURVE_COMPLETION_BUDGET");
        const leg = net(left);
        postBase = leg > 1n ? (leg - 1n) * poolBase / (poolQuote + leg - 1n) : 0n;
        if (postBase === 0n && spec.completionMode !== "MULTI_HOP") {
          input = curveCost;
          postQuote = 0n;
        } else {
          const legFees = charge(leg);
          postQuote = left - legFees;
        }
        output = remaining + postBase;
      }
      gross = curveGross + postQuote;
    } else if (spec.exactOutput) {
      curveGross = output * c.virtualSolReserves / (c.virtualTokenReserves - output) + 1n;
      gross = curveGross;
      input = gross + charge(gross);
    } else {
      charge(n3);
      gross = input - protocol2 - creator;
      curveGross = gross;
    }
  } else {
    if (spec.exactOutput) fail6("CURVE_SELL_EXACT_OUTPUT_UNSUPPORTED");
    gross = input * c.virtualSolReserves / (c.virtualTokenReserves + input);
    curveGross = gross;
    output = gross - charge(gross);
    if (gross > c.realSolReserves)
      throw new ExecutionEngineError9(
        "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
        "CURVE_REAL_QUOTE_RESERVES"
      );
  }
  if (output <= 0n || gross <= 0n)
    throw new ExecutionEngineError9("ZERO_EXECUTABLE_OUTPUT", "CURVE_DUST");
  if (spec.exactOutput ? input > spec.bound : output < spec.bound)
    fail6("EXTERNAL_SIGNED_MINIMUM_VIOLATED");
  const curveTokens = spec.buy ? output < c.realTokenReserves ? output : c.realTokenReserves : input;
  const vb = spec.buy ? c.virtualTokenReserves - curveTokens : c.virtualTokenReserves + input, vq = spec.buy ? c.virtualSolReserves + curveGross : c.virtualSolReserves - gross;
  const rb = spec.buy ? c.realTokenReserves - curveTokens : c.realTokenReserves + input, rq = spec.buy ? c.realSolReserves + curveGross : c.realSolReserves - gross;
  const bb = spec.buy ? v.baseBalance - output : v.baseBalance + input, qb = spec.legacy ? spec.buy ? v.quoteBalance + gross : v.quoteBalance - gross : spec.buy ? v.quoteBalance + input - buyback : v.quoteBalance - output - buyback;
  const cbucket = v.creatorBucket + (spec.legacy ? 0n : creator), pbucket = v.protocolBucket + (spec.legacy ? 0n : protocol2 - buyback);
  for (const n3 of [input, output, vb, vq, rb, rq, bb, qb, cbucket, pbucket, postBase, postQuote])
    if (n3 < 0n || n3 > U644) fail6("CURVE_SUCCESSOR_RANGE");
  for (const [offset, value] of [
    [8, vb],
    [16, vq],
    [24, rb],
    [32, rq],
    [125, cbucket],
    [133, pbucket],
    [150, postBase],
    [158, postQuote]
  ])
    raw.writeBigUInt64LE(value, offset);
  raw[48] = rb === 0n ? 1 : 0;
  s.accounts[spec.pool] = {
    ...s.accounts[spec.pool],
    base64: raw.toString("base64"),
    ...v.native ? { lamports: (qb + v.rent).toString() } : {}
  };
  for (const [address3, value] of v.native ? [[v.baseVault, bb]] : [
    [v.baseVault, bb],
    [v.quoteVault, qb]
  ]) {
    const b = Buffer.from(s.accounts[address3].base64, "base64");
    b.writeBigUInt64LE(value, 64);
    s.accounts[address3] = { ...s.accounts[address3], base64: b.toString("base64") };
  }
  await validatePumpCurve(s, spec.pool, baseMint, spec.quoteMint, true);
  const transfers = [
    {
      from: spec.buy ? v.baseVault : spec.userBase,
      to: spec.buy ? spec.userBase : v.baseVault,
      amount: spec.buy ? output : input
    }
  ];
  if (v.native && !spec.nativeUser) fail6("CURVE_NATIVE_USER_MISSING");
  const transfer = (from, to, amount, nativeKind) => {
    if (amount > 0n) {
      if (!from || !to) fail6("CURVE_FEE_DESTINATION_MISSING");
      transfers.push({ from, to, amount, ...v.native ? { kind: nativeKind } : {} });
    }
  };
  const user = v.native ? spec.nativeUser : spec.userQuote, venue = v.native ? spec.pool : v.quoteVault, kind = spec.buy ? "NATIVE_SYSTEM" : "NATIVE_DIRECT";
  transfer(
    spec.buy ? user : venue,
    spec.buy ? venue : user,
    spec.buy ? spec.legacy ? gross : input : output,
    kind
  );
  if (spec.legacy) {
    transfer(spec.buy ? user : venue, spec.protocolRecipient, protocol2 - buyback, kind);
    transfer(spec.buy ? user : venue, spec.creatorRecipient, creator, kind);
  }
  transfer(
    spec.legacy && spec.buy ? user : venue,
    spec.buybackRecipient,
    buyback,
    spec.legacy ? kind : "NATIVE_DIRECT"
  );
  return {
    next: s,
    output,
    input,
    transfers: transfers.filter((t) => t.amount > 0n),
    quote: {
      input,
      output,
      grossQuote: gross,
      fees: { lp: 0n, protocol: protocol2, creator, buyback },
      post: {
        base: bb,
        quote: qb,
        virtual: vq - rq,
        protocolBucket: pbucket,
        creatorBucket: cbucket,
        lpBps: 0n,
        protocolBps: pb,
        creatorBps: cb,
        buybackBps: v.buybackBps
      }
    }
  };
}

// packages/protocols/isolated/linked-pair/wrapped-sol-flow.ts
import { PublicKey as PublicKey6 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { createHash as createHash6 } from "node:crypto";
var N = "lamports:";
var SYSTEM = "11111111111111111111111111111111";
function integer2(n3) {
  if (typeof n3 !== "number" || !Number.isSafeInteger(n3) || n3 < 0)
    throw Error("NATIVE_BALANCE_EVIDENCE_UNSAFE");
  return BigInt(n3);
}
var WrappedSolFlow = class {
  constructor(receipt, keys, deltas, protectedAccounts, s, persistedReserves = {}) {
    this.receipt = receipt;
    this.keys = keys;
    this.deltas = deltas;
    this.protectedAccounts = protectedAccounts;
    this.persistedReserves = persistedReserves;
    for (const [a, value] of Object.entries(persistedReserves)) {
      const n3 = BigInt(value);
      if (n3 < 0n || n3 > (1n << 64n) - 1n) throw Error("NATIVE_RESERVE_CORRUPT");
      this.reserves.set(a, n3);
    }
    const meta = receipt.meta;
    this.nativePre = meta.preBalances;
    this.nativePost = meta.postBalances;
    this.fee = meta.fee;
    for (const b of [...meta.preTokenBalances, ...meta.postTokenBalances])
      if (!this.mints.has(keys[b.accountIndex])) this.mints.set(keys[b.accountIndex], b.mint);
    for (const [address3, a] of Object.entries(s.accounts)) {
      const raw = Buffer.from(a.base64, "base64");
      if (a.owner === SPL_TOKEN_PROGRAM_ID && raw.length === 165 && raw.readUInt32LE(109) === 1) {
        this.mints.set(address3, WRAPPED_SOL_MINT);
        this.reserve(address3, raw.readBigUInt64LE(113));
      }
    }
    let rent = null;
    const rentAccount = s.accounts["SysvarRent111111111111111111111111111111111"];
    if (rentAccount) {
      const r = Buffer.from(rentAccount.base64, "base64");
      if (rentAccount.owner !== "Sysvar1111111111111111111111111111111111111" || r.length !== 17 || ![1, 2].includes(r.readDoubleLE(8)))
        throw Error("NATIVE_RENT_STATE_UNSUPPORTED");
      rent = BigInt(165 + 128) * r.readBigUInt64LE(0) * BigInt(r.readDoubleLE(8));
    }
    this.rent = rent;
    for (const b of meta.preTokenBalances) {
      const address3 = keys[b.accountIndex];
      if (b.mint === WRAPPED_SOL_MINT) {
        if (this.nativePre) {
          const reserve = integer2(this.nativePre[b.accountIndex]) - BigInt(b.uiTokenAmount.amount);
          if (reserve < 0n) throw Error("NATIVE_TOKEN_BALANCE_MISMATCH");
          if (!this.reserves.has(address3)) this.reserve(address3, reserve);
        }
        if (!protectedAccounts.has(address3) && deltas[N + address3] === void 0 && BigInt(deltas[address3] ?? "0") !== 0n)
          deltas[N + address3] = deltas[address3];
      }
    }
    for (const key2 of keys) if (BigInt(deltas[N + key2] ?? "0") !== 0n) this.initialTracked.add(key2);
  }
  receipt;
  keys;
  deltas;
  protectedAccounts;
  persistedReserves;
  mints = /* @__PURE__ */ new Map();
  balances = /* @__PURE__ */ new Map();
  reserves = /* @__PURE__ */ new Map();
  touched = /* @__PURE__ */ new Set();
  initialTracked = /* @__PURE__ */ new Set();
  nativePre;
  nativePost;
  fee;
  rent;
  static tracked(keys, deltas) {
    return keys.some((k) => BigInt(deltas[N + k] ?? "0") !== 0n);
  }
  reserve(a, n3) {
    this.reserves.set(a, n3);
    this.persistedReserves[a] = n3.toString();
  }
  delta(a) {
    return this.protectedAccounts.has(a) ? 0n : BigInt(this.deltas[N + a] ?? "0");
  }
  balance(a) {
    if (!this.balances.has(a)) {
      const i = this.keys.indexOf(a);
      if (i < 0 || !this.nativePre || !this.nativePost)
        throw Error("NATIVE_BALANCE_EVIDENCE_MISSING");
      let n3 = integer2(this.nativePre[i]);
      if (i === 0) n3 -= integer2(this.fee);
      if (n3 < 0n) throw Error("NATIVE_FEE_EVIDENCE");
      this.balances.set(a, n3);
    }
    return this.balances.get(a);
  }
  transfer(from, to, amount, shadow) {
    const n3 = this.balance(from);
    if (amount < 0n || shadow < 0n || n3 < amount || !this.protectedAccounts.has(from) && n3 + this.delta(from) < shadow)
      throw Error("MODELED_NATIVE_INVENTORY_EXHAUSTED");
    this.balances.set(from, n3 - amount);
    this.balances.set(to, this.balance(to) + amount);
    if (!this.protectedAccounts.has(from))
      this.deltas[N + from] = (this.delta(from) + amount - shadow).toString();
    if (!this.protectedAccounts.has(to))
      this.deltas[N + to] = (this.delta(to) + shadow - amount).toString();
    this.touched.add(from);
    this.touched.add(to);
  }
  curveTouched = /* @__PURE__ */ new Set();
  curveTransfer(from, to, amount, shadow) {
    this.transfer(from, to, amount, shadow);
    this.curveTouched.add(from);
    this.curveTouched.add(to);
  }
  assertCurveBalance(address3, expected) {
    if (this.balance(address3) !== BigInt(expected)) throw Error("CURVE_NATIVE_CHECKPOINT_MISMATCH");
    this.curveTouched.add(address3);
  }
  tokenTransfer(from, to, amount, shadow) {
    if (this.mints.get(from) !== WRAPPED_SOL_MINT && this.mints.get(to) !== WRAPPED_SOL_MINT)
      return;
    this.mints.set(from, WRAPPED_SOL_MINT);
    this.mints.set(to, WRAPPED_SOL_MINT);
    this.transfer(from, to, amount, shadow);
  }
  /** Returns true when handled; callers retain their fail-closed handling for other mutations. */
  instruction(ix, raw, _depth, _ancestors, actualTokens) {
    const program2 = this.keys[ix.programIdIndex], a = ix.accounts.map((i) => this.keys[i]);
    if (program2 === PUMP_AMM_PROGRAM_ID && raw.subarray(0, 8).equals(
      createHash6("sha256").update("global:close_user_volume_accumulator").digest().subarray(0, 8)
    )) {
      const expected = PublicKey6.findProgramAddressSync(
        [Buffer.from("user_volume_accumulator"), new PublicKey6(a[0]).toBuffer()],
        new PublicKey6(PUMP_AMM_PROGRAM_ID)
      )[0].toBase58();
      if (a[1] !== expected) throw Error("NATIVE_VOLUME_PDA_MISMATCH");
      const refund = this.balance(a[1]);
      this.transfer(a[1], a[0], refund, refund + this.delta(a[1]));
      delete this.deltas[N + a[1]];
      return true;
    }
    if (program2 === SYSTEM) {
      if (raw.length < 4) throw Error("NATIVE_SYSTEM_LAYOUT");
      const tag = raw.readUInt32LE(0);
      let amount;
      if (tag === 2 || tag === 0) {
        if (raw.length < 12) throw Error("NATIVE_SYSTEM_LAYOUT");
        amount = raw.readBigUInt64LE(4);
      } else if (tag === 3) {
        if (raw.length < 44) throw Error("NATIVE_SYSTEM_LAYOUT");
        const length = raw.readBigUInt64LE(36);
        if (length > 32n || raw.length < 52 + Number(length)) throw Error("NATIVE_SYSTEM_LAYOUT");
        amount = raw.readBigUInt64LE(44 + Number(length));
      }
      if (amount !== void 0) {
        this.transfer(a[0], a[1], amount, amount);
        return true;
      }
      if (a.some((x) => this.delta(x) !== 0n))
        throw Error("TRACKED_NATIVE_SYSTEM_MUTATION_UNSUPPORTED");
      return false;
    }
    if (![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program2 ?? "")) return false;
    if ([1, 16, 18].includes(raw[0])) {
      const mint = a[1];
      this.mints.set(a[0], mint);
      if (mint === WRAPPED_SOL_MINT) {
        const balance = this.balance(a[0]);
        const provenReserve = this.rent ?? ([...this.reserves.values()].includes(balance) ? balance : null);
        if (program2 !== SPL_TOKEN_PROGRAM_ID || provenReserve === null)
          throw Error("NATIVE_RENT_EVIDENCE_MISSING");
        if (balance < provenReserve) throw Error("NATIVE_RENT_BALANCE");
        this.reserves.set(a[0], provenReserve);
        actualTokens.set(a[0], balance - provenReserve);
        this.deltas[a[0]] = this.delta(a[0]).toString();
      }
      return true;
    }
    if (raw[0] === 17) {
      if (program2 !== SPL_TOKEN_PROGRAM_ID) throw Error("NATIVE_SYNC_PROGRAM_UNSUPPORTED");
      if (raw.length !== 1 || a.length !== 1) throw Error("NATIVE_SYNC_LAYOUT");
      if (this.mints.get(a[0]) !== WRAPPED_SOL_MINT) throw Error("NATIVE_SYNC_MINT_UNKNOWN");
      const reserve = this.reserves.get(a[0]);
      if (reserve === void 0) throw Error("NATIVE_RESERVE_EVIDENCE_MISSING");
      const amount = this.balance(a[0]) - reserve;
      const previous = actualTokens.get(a[0]);
      if (previous === void 0) throw Error("NATIVE_SYNC_TOKEN_EVIDENCE_MISSING");
      if (amount < previous || amount < 0n) throw Error("NATIVE_SYNC_BALANCE");
      actualTokens.set(a[0], amount);
      this.deltas[a[0]] = this.delta(a[0]).toString();
      return true;
    }
    if (raw[0] === 9) {
      const source = a[0], destination = a[1], wrapped = this.mints.get(source) === WRAPPED_SOL_MINT;
      if (!wrapped && BigInt(this.deltas[source] ?? "0") !== 0n)
        throw Error("MODELED_TOKEN_CLOSE_NOT_EMPTY");
      if (wrapped) {
        if (!this.nativePre || !this.nativePost) throw Error("NATIVE_BALANCE_EVIDENCE_MISSING");
        const refund = this.balance(source), shadow = refund + this.delta(source);
        if (BigInt(this.deltas[source] ?? "0") !== this.delta(source))
          throw Error("NATIVE_CLOSE_UNSYNCED_DIFFERENCE");
        this.transfer(source, destination, refund, shadow);
        delete this.deltas[N + source];
        delete this.deltas[source];
        delete this.persistedReserves[source];
        this.reserves.delete(source);
        actualTokens.delete(source);
        return true;
      }
      if (this.nativePre && this.nativePost) {
        const refund = this.balance(source);
        this.transfer(source, destination, refund, refund + this.delta(source));
        delete this.deltas[N + source];
        actualTokens.delete(source);
        return true;
      }
      return false;
    }
    return false;
  }
  verify(tokens) {
    if (tokens)
      for (const b of this.receipt.meta.postTokenBalances) {
        const a = this.keys[b.accountIndex];
        if (this.mints.get(a) === WRAPPED_SOL_MINT && tokens.has(a) && tokens.get(a) !== BigInt(b.uiTokenAmount.amount))
          throw Error("NATIVE_SYNC_TOKEN_EFFECTS_UNRECONCILED:" + a);
      }
    for (const address3 of /* @__PURE__ */ new Set([
      ...this.initialTracked,
      ...this.touched,
      ...this.curveTouched
    ])) {
      if (!this.curveTouched.has(address3) && !this.initialTracked.has(address3) && this.delta(address3) === 0n)
        continue;
      const i = this.keys.indexOf(address3);
      if (i < 0 || !this.nativePost || this.balance(address3) !== integer2(this.nativePost[i]))
        throw Error(
          "NATIVE_TRANSACTION_EFFECTS_UNRECONCILED:" + address3 + ":" + this.balance(address3) + ":" + this.nativePost?.[i] + ":" + this.receipt.transaction.signatures[0]
        );
    }
  }
};

// packages/protocols/isolated/linked-pair/pump-multihop.ts
import { PublicKey as PublicKey8 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { createHash as createHash7 } from "node:crypto";
import bs58 from "./packages/protocols/node_modules/bs58/index.js";

// packages/protocols/isolated/linked-pair/pump-external.ts
import { PublicKey as PublicKey7 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
var ceil2 = (n3, d) => (n3 + d - 1n) / d;
async function transitionExternalPump(snapshot2, spec, policy) {
  const s = structuredClone(snapshot2), p = decodePumpSwapPool(Buffer.from(s.accounts[spec.pool].base64, "base64"));
  const v = await validatePumpPool(s, spec.pool, p.baseMint, p.quoteMint), m = { ...v.math };
  if (spec.feeRole) {
    const token2 = spec.feeRole === "TOKEN_END" || spec.feeRole === "BOTH", currency = spec.feeRole === "CURRENCY_END" || spec.feeRole === "BOTH";
    if (!token2) {
      m.lpBps = 0n;
      m.creatorBps = 0n;
    }
    if (!currency) m.protocolBps = 0n;
  }
  if (!Number.isFinite(policy.nowMs) || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || !Number.isFinite(Date.parse(s.observedAt)) || policy.nowMs < Date.parse(s.observedAt) || policy.nowMs - Date.parse(s.observedAt) > policy.maxAgeMs)
    throw Error("STALE_PUMP_EXTERNAL_STATE");
  let q;
  if (spec.exactOutput) {
    if (!spec.buy || spec.amount >= m.base || spec.amount <= 0n)
      throw Error("INVALID_PUMP_EXACT_OUTPUT");
    const curve = (m.quote + m.virtual) * spec.amount / (m.base - spec.amount) + 1n;
    const lp = ceil2(curve * m.lpBps, 10000n), protocol2 = ceil2(curve * m.protocolBps, 10000n), creator = ceil2(curve * m.creatorBps, 10000n), buyback = protocol2 * m.buybackBps / 10000n, input = curve + lp + protocol2 + creator, retained = protocol2 - buyback + creator;
    q = {
      input,
      output: spec.amount,
      grossQuote: curve,
      fees: { lp, protocol: protocol2, creator, buyback },
      post: {
        ...m,
        base: m.base - spec.amount,
        quote: m.quote + input - buyback,
        virtual: m.virtual - retained,
        protocolBucket: m.protocolBucket + protocol2 - buyback,
        creatorBucket: m.creatorBucket + creator
      }
    };
  } else q = stage1PoolSwap(m, spec.amount, spec.buy);
  if (q.input < 1n || q.input > (1n << 64n) - 1n) throw Error("PUMP_EXTERNAL_INPUT_RANGE");
  if (spec.exactOutput ? q.input > spec.bound : q.output < spec.bound)
    throw Error("EXTERNAL_SIGNED_MINIMUM_VIOLATED");
  const f = q.fees;
  if (spec.legacy)
    q = {
      ...q,
      post: {
        ...q.post,
        quote: spec.buy ? m.quote + q.input - f.protocol - f.creator : m.quote - q.output - f.protocol - f.creator,
        virtual: m.virtual,
        protocolBucket: m.protocolBucket,
        creatorBucket: m.creatorBucket
      }
    };
  const transfers = [];
  const transfer = (from, to, amount) => {
    if (amount > 0n) {
      if (!from || !to || from === PublicKey7.default.toBase58() || to === PublicKey7.default.toBase58())
        throw Error("PUMP_FEE_RECIPIENT_MISSING");
      transfers.push({ from, to, amount });
    }
  };
  transfer(
    spec.buy ? p.baseVault : spec.userBase,
    spec.buy ? spec.userBase : p.baseVault,
    spec.buy ? q.output : q.input
  );
  transfer(
    spec.buy ? spec.userQuote : p.quoteVault,
    spec.buy ? p.quoteVault : spec.userQuote,
    spec.buy ? q.input - (spec.legacy ? f.protocol + f.creator : f.buyback) : q.output
  );
  if (spec.legacy) {
    transfer(
      spec.buy ? spec.userQuote : p.quoteVault,
      spec.protocolRecipient,
      f.protocol - f.buyback
    );
    transfer(spec.buy ? spec.userQuote : p.quoteVault, spec.creatorRecipient, f.creator);
  }
  transfer(spec.buy ? spec.userQuote : p.quoteVault, spec.buybackRecipient, f.buyback);
  const raw = Buffer.from(s.accounts[spec.pool].base64, "base64"), post = q.post, U645 = (1n << 64n) - 1n;
  for (const n3 of [post.base, post.quote, post.protocolBucket, post.creatorBucket])
    if (n3 < 0n || n3 > U645) throw Error("PUMP_EXTERNAL_RANGE");
  if (post.quote < post.protocolBucket + post.creatorBucket)
    throw Error("PUMP_EXTERNAL_RESERVED_LIQUIDITY");
  for (const [vault3, n3] of [
    [p.baseVault, post.base],
    [p.quoteVault, post.quote]
  ]) {
    const b = Buffer.from(s.accounts[vault3].base64, "base64");
    b.writeBigUInt64LE(n3, 64);
    s.accounts[vault3] = { ...s.accounts[vault3], base64: b.toString("base64") };
  }
  if (post.virtual < -(1n << 127n) || post.virtual >= 1n << 127n)
    throw Error("PUMP_EXTERNAL_VIRTUAL_RANGE");
  const virtual = BigInt.asUintN(128, post.virtual);
  raw.writeBigUInt64LE(virtual & U645, 245);
  raw.writeBigUInt64LE(virtual >> 64n, 253);
  raw.writeBigUInt64LE(post.protocolBucket, 271);
  raw.writeBigUInt64LE(post.creatorBucket, 279);
  s.accounts[spec.pool] = { ...s.accounts[spec.pool], base64: raw.toString("base64") };
  await validatePumpPool(s, spec.pool, p.baseMint, p.quoteMint);
  return { next: s, output: q.output, input: q.input, transfers, quote: q };
}

// packages/protocols/isolated/linked-pair/pump-multihop.ts
var disc = createHash7("sha256").update("global:multi_hop_swap").digest().subarray(0, 8);
var isMultiHop = (ix, keys) => keys[ix.programIdIndex] === PUMP_AMM_PROGRAM_ID && Buffer.from(bs58.decode(ix.data)).subarray(0, 8).equals(disc);
function multiHopDependencies(ix, keys) {
  if (!isMultiHop(ix, keys)) return [];
  const a = ix.accounts.map((i) => keys[i]);
  if (a.length < 21 || (a.length - 16) % 5 !== 0) throw Error("MULTI_HOP_ACCOUNT_LAYOUT");
  return Array.from({ length: (a.length - 16) / 5 }, (_, i) => ({
    base: a[16 + 5 * i],
    quote: a[17 + 5 * i],
    pool: a[18 + 5 * i],
    baseVault: a[19 + 5 * i],
    quoteVault: a[20 + 5 * i]
  }));
}
async function transitionMultiHop(snapshot2, ix, keys, tokenMints) {
  const a = ix.accounts.map((i) => keys[i]), raw = Buffer.from(bs58.decode(ix.data)), hops = multiHopDependencies(ix, keys);
  if (raw.length !== 24 || hops.length < 1 || new Set(hops.map((h) => h.pool)).size !== hops.length)
    throw Error("MULTI_HOP_UNSUPPORTED_LAYOUT");
  if (a[3] !== await pumpSwapGlobalConfigAddress() || a[4] !== await pumpSwapFeeConfigAddress() || a[7] !== SPL_TOKEN_PROGRAM_ID || a[8] !== TOKEN_2022_PROGRAM_ID || a[9] !== "11111111111111111111111111111111" || a[11] !== PUMP_AMM_PROGRAM_ID)
    throw Error("MULTI_HOP_PROGRAM_BINDING");
  const buy = hops.length === 1 ? tokenMints?.get(a[1]) === hops[0].quote : hops[0].base === hops[1].quote;
  if (hops.length === 1 && !tokenMints) throw Error("MULTI_HOP_DIRECTION_EVIDENCE_MISSING");
  if (tokenMints && (tokenMints.get(a[1]) !== (buy ? hops[0].quote : hops[0].base) || tokenMints.get(a[2]) !== (buy ? hops.at(-1).base : hops.at(-1).quote)))
    throw Error("MULTI_HOP_USER_MINT_BINDING");
  if (tokenMints && tokenMints.get(a[6]) !== (buy ? hops[0].quote : hops.at(-1).quote))
    throw Error("MULTI_HOP_FEE_MINT_BINDING");
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i], account = snapshot2.accounts[h.pool];
    if (!account) throw Error("MULTI_HOP_DEPENDENCY_MISSING:" + h.pool);
    const p = account.owner === PUMP_AMM_PROGRAM_ID ? decodePumpSwapPool(Buffer.from(account.base64, "base64")) : account.owner === PUMP_PROGRAM_ID ? {
      baseMint: h.base,
      quoteMint: h.quote,
      ...await validatePumpCurve(snapshot2, h.pool, h.base, h.quote)
    } : (() => {
      throw Error("MULTI_HOP_VENUE_UNSUPPORTED:" + h.pool);
    })();
    if (account.owner === PUMP_PROGRAM_ID && (a[12] !== PUMP_PROGRAM_ID || a[13] !== await pumpGlobalAddress() || a[14] !== await pumpFeeConfigAddress()))
      throw Error("MULTI_HOP_CURVE_PROGRAM_BINDING");
    if (p.baseMint !== h.base || p.quoteMint !== h.quote || p.baseVault !== h.baseVault || p.quoteVault !== h.quoteVault)
      throw Error("MULTI_HOP_BINDING");
    if (i > 0 && (buy ? hops[i - 1].base !== h.quote : hops[i - 1].quote !== h.base))
      throw Error("MULTI_HOP_DISCONTINUOUS");
  }
  let next = structuredClone(snapshot2), input = raw.readBigUInt64LE(8);
  const minimum = raw.readBigUInt64LE(16);
  if (input === 0n || minimum === 0n) throw Error("MULTI_HOP_ZERO_AMOUNT");
  const transfers = [], steps = [];
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i], currency = buy ? i === 0 : i === hops.length - 1, token2 = buy ? i === hops.length - 1 : i === 0, source = i === 0 ? a[1] : buy ? hops[i - 1].baseVault : hops[i - 1].quoteVault, destination = i === hops.length - 1 ? a[2] : buy ? hops[i + 1].quoteVault : hops[i + 1].baseVault, q = await (next.accounts[h.pool].owner === PUMP_PROGRAM_ID ? transitionExternalCurve : transitionExternalPump)(
      next,
      {
        pool: h.pool,
        baseMint: h.base,
        quoteMint: h.quote,
        nativeUser: a[0],
        baseVault: h.baseVault,
        quoteVault: h.quoteVault,
        legacy: false,
        completionMode: "MULTI_HOP",
        exactOutput: false,
        buy,
        amount: input,
        bound: 0n,
        userBase: buy ? destination : source,
        userQuote: buy ? source : destination,
        protocolRecipient: "",
        creatorRecipient: "",
        buybackRecipient: a[6],
        feeRole: currency && token2 ? "BOTH" : currency ? "CURRENCY_END" : token2 ? "TOKEN_END" : "INTERMEDIATE"
      },
      { nowMs: Date.parse(next.observedAt), maxAgeMs: 1e4 }
    );
    const native = next.accounts[h.pool].owner === PUMP_PROGRAM_ID && h.quote === WRAPPED_SOL_MINT;
    if (native && !currency) throw Error("MULTI_HOP_NATIVE_CURVE_DIRECTION");
    transfers.push(
      native && buy ? { from: a[0], to: h.pool, amount: input, kind: "NATIVE_SYSTEM" } : { from: source, to: buy ? h.quoteVault : h.baseVault, amount: input }
    );
    if (q.quote.fees.buyback > 0n)
      transfers.push({
        from: native ? h.pool : h.quoteVault,
        to: a[6],
        amount: q.quote.fees.buyback,
        ...native ? { kind: "NATIVE_DIRECT" } : {}
      });
    steps.push({ pool: h.pool, input, output: q.output, fees: q.quote.fees, post: q.quote.post });
    next = q.next;
    input = q.output;
  }
  const last = hops.at(-1);
  const nativeLast = !buy && snapshot2.accounts[last.pool].owner === PUMP_PROGRAM_ID && last.quote === WRAPPED_SOL_MINT;
  transfers.push(
    nativeLast ? { from: last.pool, to: a[0], amount: input, kind: "NATIVE_DIRECT" } : { from: buy ? last.baseVault : last.quoteVault, to: a[2], amount: input }
  );
  const curveCalls = [];
  for (let i = 0; i < hops.length; i++) {
    if (snapshot2.accounts[hops[i].pool].owner !== PUMP_PROGRAM_ID) continue;
    const start = i;
    while (i + 1 < hops.length && snapshot2.accounts[hops[i + 1].pool].owner === PUMP_PROGRAM_ID)
      i++;
    const fees = hops.slice(start, i + 1).map((_, n3) => {
      const pos = start + n3;
      return (buy ? pos === 0 : pos === hops.length - 1) ? 1 | (hops.length === 1 ? 2 : 0) : (buy ? pos === hops.length - 1 : pos === 0) ? 2 : 0;
    });
    const source = start === 0 ? a[1] : buy ? hops[start - 1].baseVault : hops[start - 1].quoteVault, dest = i === hops.length - 1 ? a[2] : buy ? hops[i + 1].quoteVault : hops[i + 1].baseVault;
    const event = PublicKey8.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      new PublicKey8(PUMP_PROGRAM_ID)
    )[0].toBase58();
    const accounts = [
      a[13],
      a[14],
      a[3],
      a[0],
      start === 0 ? a[0] : hops[start - 1].pool,
      source,
      dest,
      a[6],
      a[7],
      a[8],
      a[9],
      event,
      PUMP_PROGRAM_ID,
      ...hops.slice(start, i + 1).flatMap((h) => [h.base, h.quote, h.pool, h.baseVault, h.quoteVault])
    ];
    curveCalls.push({ accounts, input: steps[start].input, fees });
  }
  if (input < minimum) throw Error("EXTERNAL_SIGNED_MINIMUM_VIOLATED");
  return {
    next,
    output: input,
    transfers: transfers.filter((t) => t.amount > 0n),
    steps,
    curveCalls
  };
}

// packages/protocols/isolated/linked-pair/pump-sweep.ts
import { createHash as createHash8 } from "node:crypto";
import bs582 from "./packages/protocols/node_modules/bs58/index.js";
import { PublicKey as PublicKey9 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { getAssociatedTokenAddressSync as getAssociatedTokenAddressSync5 } from "./packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
var program = new PublicKey9(PUMP_AMM_PROGRAM_ID);
var discriminator = (name) => createHash8("sha256").update("global:" + name).digest().subarray(0, 8);
function pumpSweepBucket(ix, keys) {
  if (keys[ix.programIdIndex] !== PUMP_AMM_PROGRAM_ID) return null;
  const raw = Buffer.from(bs582.decode(ix.data));
  if (raw.subarray(0, 8).equals(discriminator("sweep_protocol_fee"))) return "protocol";
  if (raw.subarray(0, 8).equals(discriminator("sweep_creator_fee"))) return "creator";
  return null;
}
async function transitionPumpSweep(snapshot2, ix, keys) {
  const bucket = pumpSweepBucket(ix, keys), a = ix.accounts.map((i) => keys[i]);
  if (!bucket || Buffer.from(bs582.decode(ix.data)).length !== 8 || a.length !== 12)
    throw Error("PUMP_SWEEP_LAYOUT");
  const account = snapshot2.accounts[a[2]];
  if (account?.owner !== PUMP_AMM_PROGRAM_ID) throw Error("PUMP_SWEEP_POOL_MISSING");
  const raw = Buffer.from(account.base64, "base64"), pool = decodePumpSwapPool(raw);
  const { math } = await validatePumpPool(snapshot2, a[2], pool.baseMint, pool.quoteMint);
  const global = await pumpSwapGlobalConfigAddress(), mint = snapshot2.accounts[pool.quoteMint];
  const event = PublicKey9.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    program
  )[0].toBase58();
  if (a[1] !== global || a[3] !== pool.quoteMint || a[4] !== mint?.owner || a[5] !== pool.quoteVault || a[8] !== PublicKey9.default.toBase58() || a[9] !== "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" || a[10] !== event || a[11] !== PUMP_AMM_PROGRAM_ID)
    throw Error("PUMP_SWEEP_BINDING");
  const globalBytes = Buffer.from(snapshot2.accounts[global].base64, "base64");
  const protocolRecipients = Array.from(
    { length: 8 },
    (_, i) => new PublicKey9(globalBytes.subarray(57 + i * 32, 89 + i * 32)).toBase58()
  );
  const creatorVault = PublicKey9.findProgramAddressSync(
    [Buffer.from("creator_vault"), new PublicKey9(pool.coinCreator).toBuffer()],
    program
  )[0].toBase58();
  if (bucket === "protocol" ? !protocolRecipients.includes(a[6]) : a[6] !== creatorVault)
    throw Error("PUMP_SWEEP_RECIPIENT");
  const recipientAta = getAssociatedTokenAddressSync5(
    new PublicKey9(pool.quoteMint),
    new PublicKey9(a[6]),
    true,
    new PublicKey9(a[4])
  ).toBase58();
  if (a[7] !== recipientAta || a[7] === pool.quoteVault) throw Error("PUMP_SWEEP_RECIPIENT_ATA");
  const amount = bucket === "protocol" ? math.protocolBucket : math.creatorBucket;
  const nextVirtual = math.virtual + amount;
  if (amount < 0n || amount > math.quote || nextVirtual < -(1n << 127n) || nextVirtual >= 1n << 127n)
    throw Error("PUMP_SWEEP_RANGE");
  const next = structuredClone(snapshot2), vault3 = Buffer.from(next.accounts[pool.quoteVault].base64, "base64");
  vault3.writeBigUInt64LE(math.quote - amount, 64);
  const unsigned = BigInt.asUintN(128, nextVirtual);
  raw.writeBigUInt64LE(unsigned & (1n << 64n) - 1n, 245);
  raw.writeBigUInt64LE(unsigned >> 64n, 253);
  raw.writeBigUInt64LE(0n, bucket === "protocol" ? 271 : 279);
  next.accounts[a[2]] = { ...account, base64: raw.toString("base64") };
  next.accounts[pool.quoteVault] = {
    ...next.accounts[pool.quoteVault],
    base64: vault3.toString("base64")
  };
  await validatePumpPool(next, a[2], pool.baseMint, pool.quoteMint);
  return { next, amount, from: pool.quoteVault, to: recipientAta, bucket };
}

// packages/protocols/isolated/linked-pair/token-2022-flow.ts
import { PublicKey as PublicKey10 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import { createHash as createHash9 } from "node:crypto";
import {
  unpackMint as unpackMint2,
  getExtensionTypes as getExtensionTypes2,
  getTransferFeeConfig as getTransferFeeConfig2,
  getEpochFee,
  calculateFee as calculateFee2,
  ExtensionType,
  getTransferHook as getTransferHook2,
  getDefaultAccountState as getDefaultAccountState2,
  TOKEN_2022_PROGRAM_ID as TOKEN_2022_PROGRAM_ID2,
  NATIVE_MINT_2022
} from "./packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import bs583 from "./packages/protocols/node_modules/bs58/index.js";

// packages/protocols/isolated/linked-pair/epoch-flow.ts
import { EpochSchedule } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
var CLOCK_ACCOUNT = "SysvarC1ock11111111111111111111111111111111";
var EPOCH_SCHEDULE_ACCOUNT = "SysvarEpochSchedu1e111111111111111111111111";
var OWNER = "Sysvar1111111111111111111111111111111111111";
var fail7 = (reason) => {
  throw Error("EPOCH_" + reason);
};
function verifiedClock(account, slot) {
  const b = Buffer.from(account?.base64 ?? "", "base64");
  if (account?.owner !== OWNER || b.length !== 40 || !Number.isSafeInteger(slot) || slot < 0 || b.readBigUInt64LE(0) !== BigInt(slot)) fail7("CLOCK_CONTEXT");
  const fields = [b.readBigInt64LE(8), b.readBigUInt64LE(16), b.readBigUInt64LE(24), b.readBigInt64LE(32)];
  if (fields.some((v) => v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER))) fail7("CLOCK_RANGE");
  return { start: Number(fields[0]), epoch: Number(fields[1]), leader: Number(fields[2]), seconds: Number(fields[3]) };
}
function epochProgression(before, after, blocks, witness) {
  const a = verifiedClock(before.accounts[CLOCK_ACCOUNT], before.slot), b = verifiedClock(after.accounts[CLOCK_ACCOUNT], after.slot);
  if (b.seconds < a.seconds || b.epoch < a.epoch) fail7("REGRESSION");
  const changed = a.epoch !== b.epoch || a.start !== b.start || a.leader !== b.leader;
  if (!witness) {
    if (changed) fail7("WITNESS_REQUIRED");
    return (_slot) => a;
  }
  if (witness.schema !== "FINALIZED_EPOCH_SCHEDULE_V1" || witness.contextSlot < after.slot)
    fail7("WITNESS_CONTEXT");
  const w = verifiedClock(witness.clock, witness.contextSlot), raw = Buffer.from(witness.schedule?.base64 ?? "", "base64");
  if (witness.schedule?.owner !== OWNER || raw.length !== 33 || raw[16] > 1) fail7("SCHEDULE_LAYOUT");
  const values = [raw.readBigUInt64LE(0), raw.readBigUInt64LE(8), raw.readBigUInt64LE(17), raw.readBigUInt64LE(25)];
  if (values.some((v) => v > BigInt(Number.MAX_SAFE_INTEGER)) || values[0] === 0n) fail7("SCHEDULE_RANGE");
  const [length, offset, firstEpoch, firstSlot] = values.map(Number), schedule = new EpochSchedule(length, offset, !!raw[16], firstEpoch, firstSlot);
  if (before.slot < firstSlot || offset > length || !raw[16] && (firstEpoch !== 0 || firstSlot !== 0))
    fail7("SCHEDULE_UNSUPPORTED");
  const metadata = (slot) => ({
    epoch: schedule.getEpoch(slot),
    leader: firstEpoch + Math.floor((slot - firstSlot + offset) / length)
  });
  for (const [slot, c] of [[before.slot, a], [after.slot, b], [witness.contextSlot, w]]) {
    const m = metadata(slot);
    if (m.epoch !== c.epoch || m.leader !== c.leader || c.start > c.seconds) fail7("SCHEDULE_CLOCK_MISMATCH");
  }
  if (b.epoch < a.epoch || b.seconds < a.seconds || w.epoch < b.epoch) fail7("REGRESSION");
  const starts = /* @__PURE__ */ new Map([[a.epoch, a.start]]);
  if (b.epoch - a.epoch > blocks.length) fail7("BOUNDARY_EVIDENCE_MISSING");
  let previousSeconds = a.seconds;
  for (const block of blocks) {
    if (!Number.isSafeInteger(block.result.blockTime) || block.result.blockTime < previousSeconds || block.result.blockTime > b.seconds)
      fail7("BLOCK_TIME_INCONSISTENT");
    previousSeconds = block.result.blockTime;
  }
  for (let epoch = a.epoch + 1; epoch <= b.epoch; epoch++) {
    const boundary = blocks.find((block) => block.slot === schedule.getFirstSlotInEpoch(epoch));
    if (!boundary || !Number.isSafeInteger(boundary.result.blockTime)) fail7("BOUNDARY_EVIDENCE_MISSING");
    starts.set(epoch, boundary.result.blockTime);
  }
  if (starts.get(b.epoch) !== b.start || w.epoch === b.epoch && w.start !== b.start) fail7("START_TIMESTAMP_MISMATCH");
  return (slot) => {
    const m = metadata(slot), start = starts.get(m.epoch);
    if (start === void 0 || slot < before.slot || slot > after.slot) return fail7("SLOT_OUTSIDE_PROOF");
    return { ...m, start, seconds: 0 };
  };
}

// packages/protocols/isolated/linked-pair/token-2022-flow.ts
var CLOCK3 = "SysvarC1ock11111111111111111111111111111111";
function feePolicies(e, before, after, blocks, epochWitness) {
  const result = /* @__PURE__ */ new Map();
  if (!e) return result;
  const c = Buffer.from(e.clock?.base64 ?? "", "base64"), old = Buffer.from(before.accounts[CLOCK3].base64, "base64");
  if (e.schema !== "TOKEN_2022_FEE_SCHEDULE_WITNESS_V1" || !Number.isSafeInteger(e.contextSlot) || e.contextSlot < after.slot || e.clock.owner !== "Sysvar1111111111111111111111111111111111111" || c.length !== 40 || c.readBigUInt64LE(0) !== BigInt(e.contextSlot) || old.length !== 40)
    throw Error("TOKEN_2022_WITNESS_CONTEXT");
  const epoch = old.readBigUInt64LE(16), observedEpoch = c.readBigUInt64LE(16);
  if (observedEpoch < epoch) throw Error("TOKEN_2022_WITNESS_EPOCH");
  const endClock = Buffer.from(after.accounts[CLOCK3].base64, "base64");
  if (endClock.length !== 40) throw Error("TOKEN_2022_WITNESS_CONTEXT");
  const endEpoch = endClock.readBigUInt64LE(16);
  if (endEpoch !== epoch) epochProgression(before, after, blocks ?? [], epochWitness);
  if (observedEpoch < endEpoch) throw Error("TOKEN_2022_WITNESS_EPOCH");
  for (const [address3, a] of Object.entries(e.mints)) {
    if (a.owner !== TOKEN_2022_PROGRAM_ID2.toBase58()) throw Error("TOKEN_2022_WITNESS_OWNER");
    const m = unpackMint2(
      new PublicKey10(address3),
      {
        owner: TOKEN_2022_PROGRAM_ID2,
        data: Buffer.from(a.base64, "base64"),
        lamports: 0,
        executable: false,
        rentEpoch: 0
      },
      TOKEN_2022_PROGRAM_ID2
    );
    const extensions = getExtensionTypes2(m.tlvData);
    const transparent = extensions.some((t) => t !== ExtensionType.TransferFeeConfig);
    if (!m.isInitialized || m.decimals > 18 || extensions.some((t) => ![
      ExtensionType.TransferFeeConfig,
      ExtensionType.MintCloseAuthority,
      ExtensionType.PermanentDelegate,
      ExtensionType.DefaultAccountState,
      ExtensionType.ConfidentialTransferMint,
      ExtensionType.TransferHook,
      ExtensionType.MetadataPointer,
      ExtensionType.TokenMetadata
    ].includes(t)))
      throw Error("TOKEN_2022_WITNESS_EXTENSIONS");
    const config = getTransferFeeConfig2(m);
    if (transparent) {
      if (config || !blocks || getTransferHook2(m)?.programId.toBase58() && getTransferHook2(m).programId.toBase58() !== "11111111111111111111111111111111" || getDefaultAccountState2(m) && getDefaultAccountState2(m).state !== 1)
        throw Error("TOKEN_2022_TRANSPARENT_PROOF_REQUIRED");
      proveTransparentMint(address3, m.decimals, blocks);
    }
    if (config) {
      for (const block of blocks ?? []) for (const tx of block.result.transactions) {
        if (tx.meta.err !== null) continue;
        const keys = [...tx.transaction.message.accountKeys, ...tx.meta.loadedAddresses?.writable ?? [], ...tx.meta.loadedAddresses?.readonly ?? []];
        for (const ix of [...tx.transaction.message.instructions, ...tx.meta.innerInstructions.flatMap((g) => g.instructions)]) {
          if (keys[ix.programIdIndex] !== TOKEN_2022_PROGRAM_ID2.toBase58() || !ix.accounts.some((i) => keys[i] === address3)) continue;
          const data = bs583.decode(ix.data);
          if (data[0] === 26 && data[1] === 5) throw Error("TOKEN_2022_POLICY_CHANGED_IN_INTERVAL");
        }
      }
      if (config.olderTransferFee.epoch > epoch || config.newerTransferFee.epoch < config.olderTransferFee.epoch || config.olderTransferFee.epoch > observedEpoch || config.newerTransferFee.epoch > observedEpoch + 2n || [config.olderTransferFee, config.newerTransferFee].some(
        (f) => f.transferFeeBasisPoints > 1e4
      ))
        throw Error("TOKEN_2022_POLICY_HISTORY_UNAVAILABLE");
      result.set(address3, { decimals: m.decimals, fee: (g, atEpoch = epoch) => {
        if (atEpoch < epoch || atEpoch > endEpoch) throw Error("TOKEN_2022_FEE_EPOCH_OUTSIDE_PROOF");
        return calculateFee2(getEpochFee(config, atEpoch), g);
      } });
    } else result.set(address3, { decimals: m.decimals, fee: () => 0n });
  }
  return result;
}
var WITHHELD_PREFIX = "withheld:";
function proveTransparentMint(mint, decimals, blocks) {
  let transfers = 0;
  for (const block of blocks) for (const tx of block.result.transactions) {
    if (tx.meta.err !== null) continue;
    const keys = [
      ...tx.transaction.message.accountKeys,
      ...tx.meta.loadedAddresses?.writable ?? [],
      ...tx.meta.loadedAddresses?.readonly ?? []
    ];
    if (!keys.includes(mint) && !tx.meta.preTokenBalances.some((b) => b.mint === mint) && !tx.meta.postTokenBalances.some((b) => b.mint === mint)) continue;
    const balances = [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances].filter((b) => b.mint === mint);
    const accounts = new Set(balances.map((b) => keys[b.accountIndex]));
    const flat = [];
    for (const [index2, ix] of tx.transaction.message.instructions.entries()) {
      flat.push({ ix, depth: 1 });
      for (const inner of tx.meta.innerInstructions.find((g) => g.index === index2)?.instructions ?? []) {
        if (!Number.isSafeInteger(inner.stackHeight) || inner.stackHeight < 2)
          throw Error("TOKEN_2022_TRANSPARENT_ANCESTRY");
        flat.push({ ix: inner, depth: inner.stackHeight });
      }
    }
    const initializedHere = new Set(flat.filter(({ ix }) => keys[ix.programIdIndex] === TOKEN_2022_PROGRAM_ID2.toBase58() && ix.accounts.length === 2 && keys[ix.accounts[1]] === mint && bs583.decode(ix.data).length === 33 && bs583.decode(ix.data)[0] === 18).map(({ ix }) => keys[ix.accounts[0]]));
    for (const a of initializedHere) accounts.add(a);
    if (!accounts.size && !flat.some(({ ix }) => ix.accounts.some((i) => keys[i] === mint))) continue;
    const actual = /* @__PURE__ */ new Map();
    const pending = /* @__PURE__ */ new Set();
    const created = /* @__PURE__ */ new Set();
    const immutable = /* @__PURE__ */ new Set();
    const closing = /* @__PURE__ */ new Set(), closed = /* @__PURE__ */ new Set();
    const owners = /* @__PURE__ */ new Map(), closeAuthorities = /* @__PURE__ */ new Map();
    for (const a of accounts) {
      const pre = tx.meta.preTokenBalances.filter((b) => keys[b.accountIndex] === a);
      const post = tx.meta.postTokenBalances.filter((b) => keys[b.accountIndex] === a);
      const ephemeral = !pre.length && !post.length && initializedHere.has(a) && tx.meta.preBalances?.[keys.indexOf(a)] === 0 && tx.meta.postBalances?.[keys.indexOf(a)] === 0;
      if (pre.length > 1 || post.length > 1 || !post.length && pre.length !== 1 && !ephemeral || [...pre, ...post].some((b) => b.mint !== mint || b.programId !== TOKEN_2022_PROGRAM_ID2.toBase58() || b.uiTokenAmount.decimals !== decimals))
        throw new Error("TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE", { cause: {
          signature: tx.transaction.signatures[0],
          mint,
          account: a,
          preEntries: pre.length,
          postEntries: post.length
        } });
      if (pre.length) {
        if (pre[0].owner) owners.set(a, pre[0].owner);
        actual.set(a, BigInt(pre[0].uiTokenAmount.amount));
        if (!post.length) {
          const i = keys.indexOf(a);
          if (!pre[0].owner || mint === NATIVE_MINT_2022.toBase58() || !Number.isSafeInteger(tx.meta.preBalances?.[i]) || tx.meta.preBalances[i] <= 0 || tx.meta.postBalances?.[i] !== 0) throw Error("TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE");
          closing.add(a);
        }
      } else {
        const accountIndex = keys.indexOf(a);
        if (tx.meta.preBalances?.[accountIndex] !== 0 || !ephemeral && !post[0].owner || mint === NATIVE_MINT_2022.toBase58())
          throw new Error("TOKEN_2022_TRANSPARENT_CREATION_REQUIRED", { cause: { signature: tx.transaction.signatures[0], mint, account: a, preLamports: tx.meta.preBalances?.[accountIndex] } });
        pending.add(a);
        if (ephemeral) closing.add(a);
      }
    }
    for (const [index2, { ix, depth }] of flat.entries()) {
      const addresses = ix.accounts.map((i) => keys[i]);
      if (addresses.some((a) => closed.has(a))) throw Error("TOKEN_2022_TRANSPARENT_CLOSED_ACCOUNT_REUSED");
      if (keys[ix.programIdIndex] === "11111111111111111111111111111111" && addresses.some((a) => pending.has(a))) {
        const raw2 = Buffer.from(bs583.decode(ix.data)), a = addresses[1];
        let amount2, space, owner;
        if (raw2.length === 52 && raw2.readUInt32LE(0) === 0 && addresses.length === 2) {
          amount2 = raw2.readBigUInt64LE(4);
          space = raw2.readBigUInt64LE(12);
          owner = raw2.subarray(20, 52);
        } else if (raw2.length >= 92 && raw2.readUInt32LE(0) === 3 && addresses.length === 3) {
          const length = raw2.readBigUInt64LE(36);
          if (length <= 32n && raw2.length === 92 + Number(length)) {
            const n3 = Number(length), base = raw2.subarray(4, 36), seed = raw2.subarray(44, 44 + n3);
            owner = raw2.subarray(60 + n3, 92 + n3);
            amount2 = raw2.readBigUInt64LE(44 + n3);
            space = raw2.readBigUInt64LE(52 + n3);
            if (new PublicKey10(base).toBase58() !== addresses[2] || !Buffer.from(seed.toString("utf8"), "utf8").equals(seed) || new PublicKey10(createHash9("sha256").update(Buffer.concat([base, seed, owner])).digest()).toBase58() !== a)
              throw Error("TOKEN_2022_TRANSPARENT_SEEDED_CREATION");
          }
        }
        if (amount2 === void 0 || space === void 0 || !owner || !a || !pending.has(a) || created.has(a) || actual.has(a) || amount2 === 0n || space < 165n || space > 10485760n || new PublicKey10(owner).toBase58() !== TOKEN_2022_PROGRAM_ID2.toBase58() || !Number.isSafeInteger(tx.meta.postBalances?.[keys.indexOf(a)]) || BigInt(tx.meta.postBalances[keys.indexOf(a)]) !== amount2 && !closing.has(a))
          throw Error("TOKEN_2022_TRANSPARENT_CREATION_REQUIRED");
        created.add(a);
        continue;
      }
      if (keys[ix.programIdIndex] !== TOKEN_2022_PROGRAM_ID2.toBase58()) continue;
      if (!addresses.some((a) => a === mint || accounts.has(a))) continue;
      const raw = Buffer.from(bs583.decode(ix.data));
      if (raw[0] === 6 && raw[1] === 3 && addresses.length === 2 && actual.has(addresses[0]) && (raw.length === 3 && raw[2] === 0 || raw.length === 35 && raw[2] === 1) && addresses[1] === (closeAuthorities.get(addresses[0]) ?? owners.get(addresses[0])) && !(flat[index2 + 1] && flat[index2 + 1].depth > depth)) {
        closeAuthorities.set(addresses[0], raw[2] === 0 ? null : new PublicKey10(raw.subarray(3)).toBase58());
        continue;
      }
      if (raw[0] === 9 && raw.length === 1 && addresses.length === 3 && closing.has(addresses[0]) && actual.get(addresses[0]) === 0n && addresses[0] !== addresses[1] && addresses[1] === addresses[2] && addresses[2] === (closeAuthorities.get(addresses[0]) ?? owners.get(addresses[0])) && !(flat[index2 + 1] && flat[index2 + 1].depth > depth)) {
        const pre = tx.meta.preBalances, post = tx.meta.postBalances, fee3 = tx.meta.fee, i = keys.indexOf(addresses[0]), d = keys.indexOf(addresses[1]);
        if (!pre || !post || pre.length !== keys.length || post.length !== keys.length || !Number.isSafeInteger(fee3) || fee3 < 0 || [...pre, ...post].some((n3) => !Number.isSafeInteger(n3) || n3 < 0) || post.reduce((s, n3) => s + BigInt(n3), 0n) - pre.reduce((s, n3) => s + BigInt(n3), 0n) !== -BigInt(fee3) || post[i] !== 0 || d < 0)
          throw Error("TOKEN_2022_TRANSPARENT_CLOSE_LAMPORTS");
        closed.add(addresses[0]);
        continue;
      }
      if (raw[0] === 21 && addresses.length === 1 && addresses[0] === mint) continue;
      if (raw[0] === 22 && raw.length === 1 && addresses.length === 1 && pending.has(addresses[0]) && created.has(addresses[0]) && !actual.has(addresses[0]) && !immutable.has(addresses[0])) {
        immutable.add(addresses[0]);
        continue;
      }
      if (raw[0] === 18 && raw.length === 33 && addresses.length === 2 && addresses[1] === mint && pending.has(addresses[0]) && created.has(addresses[0]) && !actual.has(addresses[0])) {
        actual.set(addresses[0], 0n);
        owners.set(addresses[0], new PublicKey10(raw.subarray(1)).toBase58());
        continue;
      }
      if (raw.length !== 10 || raw[0] !== 12 || addresses[1] !== mint || raw[9] !== decimals)
        throw Error("TOKEN_2022_TRANSPARENT_INSTRUCTION:" + raw[0]);
      if (flat[index2 + 1] && flat[index2 + 1].depth > depth)
        throw Error("TOKEN_2022_TRANSPARENT_HOOK_CPI");
      const [from, , to] = addresses, amount = raw.readBigUInt64LE(1);
      if (!actual.has(from) || !actual.has(to) || actual.get(from) < amount)
        throw Error("TOKEN_2022_TRANSPARENT_TRANSFER_COVERAGE");
      if (from === to) continue;
      actual.set(from, actual.get(from) - amount);
      actual.set(to, actual.get(to) + amount);
      if (amount > 0n) transfers++;
    }
    if ([...pending].some((a) => !actual.has(a)))
      throw Error("TOKEN_2022_TRANSPARENT_CREATION_REQUIRED");
    if ([...closing].some((a) => !closed.has(a))) throw Error("TOKEN_2022_TRANSPARENT_CLOSE_PROOF");
    for (const [a, amount] of actual) {
      if (closed.has(a)) {
        if (amount !== 0n) throw Error("TOKEN_2022_TRANSPARENT_CLOSE_PROOF");
        continue;
      }
      if (owners.has(a) && owners.get(a) !== tx.meta.postTokenBalances.find((b) => keys[b.accountIndex] === a).owner)
        throw Error("TOKEN_2022_TRANSPARENT_OWNER_MISMATCH");
      if (amount !== BigInt(tx.meta.postTokenBalances.find((b) => keys[b.accountIndex] === a).uiTokenAmount.amount))
        throw Error("TOKEN_2022_TRANSPARENT_NET_MISMATCH:" + tx.transaction.signatures[0] + ":" + a);
    }
  }
  if (!transfers) throw Error("TOKEN_2022_TRANSPARENT_TRANSFER_MISSING");
  return { transfers, withheld: "0" };
}
function requiredTokenFeeMints(before, blocks) {
  const pools = /* @__PURE__ */ new Set([
    before.targetPool,
    before.bridgePool,
    ...Object.entries(before.accounts).filter(
      ([, a]) => [
        "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
        "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
      ].includes(a.owner) && [166, 287, 300, 301].includes(Buffer.from(a.base64, "base64").length)
    ).map(([k]) => k)
  ]), mints = /* @__PURE__ */ new Set();
  for (const b of blocks)
    for (const t of b.result.transactions) {
      if (t.meta.err !== null) continue;
      const keys = [
        ...t.transaction.message.accountKeys,
        ...t.meta.loadedAddresses?.writable ?? [],
        ...t.meta.loadedAddresses?.readonly ?? []
      ];
      if (![...t.transaction.message.instructions, ...t.meta.innerInstructions.flatMap((g) => g.instructions)].some((ix) => [ORCA_WHIRLPOOL_PROGRAM, "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"].includes(keys[ix.programIdIndex] ?? "") && ix.accounts.some((i) => pools.has(keys[i])))) continue;
      for (const ix of [
        ...t.transaction.message.instructions,
        ...t.meta.innerInstructions.flatMap((g) => g.instructions)
      ])
        if (keys[ix.programIdIndex] === TOKEN_2022_PROGRAM_ID2.toBase58() && Buffer.from(bs583.decode(ix.data))[0] === 12) {
          const mint = keys[ix.accounts[1]];
          if (!before.accounts[mint]) mints.add(mint);
        }
    }
  return [...mints].sort();
}

// packages/protocols/isolated/linked-pair/footprint.ts
import { createHash as createHash10 } from "node:crypto";
var FootprintReceiptRequired = class extends Error {
  constructor(slot, index2, signature) {
    super(`FOOTPRINT_RECEIPT_REQUIRED:${slot}:${index2}:${signature}`);
    this.slot = slot;
    this.index = index2;
    this.signature = signature;
  }
  slot;
  index;
  signature;
};
var fail8 = (m) => {
  throw Error("FOOTPRINT_" + m);
};
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function receiptEffectsHash(meta) {
  const balances = (v) => v?.map((b) => [b.accountIndex, b.mint, b.owner ?? null, b.programId ?? null, b.uiTokenAmount?.amount, b.uiTokenAmount?.decimals]);
  return createHash10("sha256").update(JSON.stringify([meta.err, meta.fee, meta.preBalances, meta.postBalances, balances(meta.preTokenBalances), balances(meta.postTokenBalances)])).digest("hex");
}
function receiptKeys(t) {
  return [...t.transaction.message.accountKeys, ...t.meta.loadedAddresses?.writable ?? [], ...t.meta.loadedAddresses?.readonly ?? []];
}
function receiptWrites(t) {
  const message = t.transaction.message;
  const h = message.header, n3 = message.accountKeys.length;
  if (!h || ![h.numRequiredSignatures, h.numReadonlySignedAccounts, h.numReadonlyUnsignedAccounts].every(Number.isSafeInteger) || h.numRequiredSignatures < 0 || h.numRequiredSignatures > n3 || h.numReadonlySignedAccounts < 0 || h.numReadonlySignedAccounts > h.numRequiredSignatures || h.numReadonlyUnsignedAccounts < 0 || h.numReadonlyUnsignedAccounts > n3 - h.numRequiredSignatures) fail8("MESSAGE_HEADER");
  const signed = h.numRequiredSignatures, staticWrites = Array.from({ length: n3 }, (_, i) => i).filter((i) => i < signed ? i < signed - h.numReadonlySignedAccounts : i < n3 - h.numReadonlyUnsignedAccounts);
  const keys = receiptKeys(t), loader = keys.includes("BPFLoaderUpgradeab1e11111111111111111111111"), called = new Set(t.transaction.message.instructions.map((ix) => ix.programIdIndex));
  const reserved = /* @__PURE__ */ new Set(["11111111111111111111111111111111", "SysvarC1ock11111111111111111111111111111111", "SysvarRent111111111111111111111111111111111", "SysvarEpochSchedu1e111111111111111111111111"]);
  return [...staticWrites, ...(t.meta.loadedAddresses?.writable ?? []).map((_, i) => n3 + i)].filter((i) => {
    if (!reserved.has(keys[i]) && (!called.has(i) || loader)) return true;
    if (t.meta.preBalances?.[i] === void 0 || t.meta.postBalances?.[i] !== t.meta.preBalances[i]) fail8("DEMOTED_ACCOUNT_EFFECTS");
    return false;
  });
}
function footprintFromFull(slot, result) {
  const keys = [], ids = /* @__PURE__ */ new Map();
  const rows = result.transactions.map((t) => {
    const accounts = receiptKeys(t).map((k) => {
      if (!ids.has(k)) {
        ids.set(k, keys.length);
        keys.push(k);
      }
      return ids.get(k);
    });
    return { signatures: [...t.transaction.signatures], accounts, writable: receiptWrites(t), failed: t.meta.err !== null, version: t.version, effectsHash: receiptEffectsHash(t.meta) };
  });
  return {
    slot,
    parentSlot: result.parentSlot,
    previousBlockhash: result.previousBlockhash,
    blockhash: result.blockhash,
    blockTime: result.blockTime,
    keys,
    rows,
    signatureHeader: { parentSlot: result.parentSlot, previousBlockhash: result.previousBlockhash, blockhash: result.blockhash, blockTime: result.blockTime, signatures: rows.map((r) => r.signatures[0]) },
    selected: []
  };
}
function footprintFromRpc(slot, block, signatureHeader) {
  if (!Array.isArray(block?.transactions) || !Array.isArray(signatureHeader?.signatures)) fail8("RPC_SHAPE");
  const keys = [], ids = /* @__PURE__ */ new Map();
  const rows = block.transactions.map((t) => {
    if (!Array.isArray(t.transaction?.accountKeys) || !Array.isArray(t.transaction?.signatures) || !t.meta || !("err" in t.meta)) fail8("RPC_RECEIPT");
    const writable = [];
    const accounts = t.transaction.accountKeys.map((a, i) => {
      if (typeof a?.pubkey !== "string" || typeof a.writable !== "boolean") fail8("RPC_KEYS");
      if (a.writable) writable.push(i);
      if (!ids.has(a.pubkey)) {
        ids.set(a.pubkey, keys.length);
        keys.push(a.pubkey);
      }
      return ids.get(a.pubkey);
    });
    return { signatures: t.transaction.signatures, accounts, writable, failed: t.meta.err !== null, version: t.version, effectsHash: receiptEffectsHash(t.meta) };
  });
  return {
    slot,
    parentSlot: block.parentSlot,
    previousBlockhash: block.previousBlockhash,
    blockhash: block.blockhash,
    blockTime: block.blockTime,
    keys,
    rows,
    signatureHeader: { parentSlot: signatureHeader.parentSlot, previousBlockhash: signatureHeader.previousBlockhash, blockhash: signatureHeader.blockhash, blockTime: signatureHeader.blockTime, signatures: signatureHeader.signatures },
    selected: []
  };
}
function validateFootprint(f) {
  if (!f || !Number.isSafeInteger(f.slot) || !Number.isSafeInteger(f.parentSlot) || !Number.isSafeInteger(f.blockTime) || f.slot <= f.parentSlot || !f.blockhash || !f.previousBlockhash || !Array.isArray(f.rows) || !Array.isArray(f.keys) || new Set(f.keys).size !== f.keys.length || f.keys.some((k) => typeof k !== "string" || !k)) fail8("BLOCK_SHAPE");
  for (const k of ["parentSlot", "previousBlockhash", "blockhash", "blockTime"]) if (f[k] !== f.signatureHeader?.[k]) fail8("SIGNATURE_HEADER");
  if (!Array.isArray(f.signatureHeader.signatures) || f.rows.length !== f.signatureHeader.signatures.length) fail8("TRANSACTION_COUNT");
  for (const [i, r] of f.rows.entries()) {
    if (!Array.isArray(r.signatures) || !r.signatures.length || r.signatures.some((s) => typeof s !== "string" || !s) || r.signatures[0] !== f.signatureHeader.signatures[i] || ![0, 1, "legacy"].includes(r.version) || typeof r.failed !== "boolean" || !/^[a-f0-9]{64}$/.test(r.effectsHash) || !Array.isArray(r.accounts) || !r.accounts.length || r.accounts.some((n3) => !Number.isSafeInteger(n3) || n3 < 0 || n3 >= f.keys.length) || !Array.isArray(r.writable) || r.writable.some((n3) => !Number.isSafeInteger(n3) || n3 < 0 || n3 >= r.accounts.length) || new Set(r.writable).size !== r.writable.length) fail8("ROW");
  }
  if (new Set(f.signatureHeader.signatures).size !== f.rows.length) fail8("DUPLICATE_SIGNATURE");
  if (!Array.isArray(f.selected) || f.selected.some((n3, i) => !Number.isSafeInteger(n3) || n3 < 0 || n3 >= f.rows.length || i > 0 && n3 <= f.selected[i - 1])) fail8("SELECTED_INDICES");
}
function bindReceipt(f, index2, t) {
  const r = f.rows[index2], reasons = [];
  if (!r) return fail8("RECEIPT_INDEX");
  if (!same(r.signatures, t.transaction.signatures)) reasons.push("signature");
  if (r.version !== t.version) reasons.push("version");
  if (r.failed !== (t.meta.err !== null)) reasons.push("status");
  if (!same(r.accounts.map((i) => f.keys[i]), receiptKeys(t))) reasons.push("keys");
  if (!same(r.writable, receiptWrites(t))) reasons.push("writable");
  if (r.effectsHash !== receiptEffectsHash(t.meta)) reasons.push("effects");
  if (reasons.length) throw new Error("FOOTPRINT_RECEIPT_BINDING", { cause: { slot: f.slot, index: index2, signature: r.signatures[0], reasons, reportedWrites: r.writable, messageWrites: receiptWrites(t) } });
}
var IMMUTABLE_SYSVARS = /* @__PURE__ */ new Set(["SysvarC1ock11111111111111111111111111111111", "SysvarRent111111111111111111111111111111111", "SysvarEpochSchedu1e111111111111111111111111"]);
function footprintRoots(branch, policies = []) {
  return new Set([...Object.keys(branch.real.accounts), ...Object.keys(branch.simulated.accounts), ...branch.real.absentAccounts, ...policies].filter((a) => !IMMUTABLE_SYSVARS.has(a)));
}
function needsReceipt(f, r, roots, deltas, nativeReserves = {}) {
  if (r.failed) return false;
  const keys = r.accounts.map((i) => f.keys[i]);
  if (r.writable.some((i) => roots.has(keys[i]))) return true;
  return keys.some((a) => BigInt(deltas[a] ?? "0") !== 0n || BigInt(deltas["lamports:" + a] ?? "0") !== 0n || BigInt(deltas["withheld:" + a] ?? "0") !== 0n || a in nativeReserves);
}
function prepareFootprintReplay(branch, e, policyMints) {
  if (e.schema === "LINKED_RETAINED_RPC_INTERVAL_V1") {
    if (e.coverage) fail8("UNVERSIONED_PROJECTION");
    return null;
  }
  const c = e.coverage;
  if (e.schema !== "LINKED_RETAINED_RPC_INTERVAL_V2" || c?.schema !== "FINALIZED_DEPENDENCY_FOOTPRINT_V1" || c.blocks.length !== e.blocks.length) fail8("COVERAGE_REQUIRED");
  const roots = footprintRoots(branch, policyMints), seen = /* @__PURE__ */ new Set();
  return c.blocks.map((f, bi) => {
    validateFootprint(f);
    const b = e.blocks[bi];
    if (f.slot !== b.slot || f.selected.length !== b.result.transactions.length) fail8("SELECTED_COUNT");
    for (const k of ["parentSlot", "previousBlockhash", "blockhash", "blockTime"]) if (f[k] !== b.result[k]) fail8("BLOCK_BINDING");
    const bodies = /* @__PURE__ */ new Map();
    f.selected.forEach((i, j) => {
      const t = b.result.transactions[j];
      bindReceipt(f, i, t);
      bodies.set(i, t);
    });
    return f.rows.map((r, index2) => {
      const signature = r.signatures[0];
      if (seen.has(signature)) fail8("DUPLICATE_SIGNATURE");
      seen.add(signature);
      return { receipt: bodies.get(index2), signature, failed: r.failed, assertOmission(deltas, reserves) {
        if (needsReceipt(f, r, roots, deltas, reserves)) throw new FootprintReceiptRequired(f.slot, index2, signature);
      } };
    });
  });
}

// packages/protocols/isolated/linked-pair/external-flow.ts
import { createHash as createHash11 } from "node:crypto";
import bs584 from "./packages/protocols/node_modules/bs58/index.js";
var CLOCK4 = "SysvarC1ock11111111111111111111111111111111";
var registry2 = globalThis;
var immutableKey = /* @__PURE__ */ Symbol.for("paperfund.immutable.provider.intervals.v1");
var immutableHashes = registry2[immutableKey] ?? /* @__PURE__ */ new WeakMap();
registry2[immutableKey] = immutableHashes;
var jsonKey = /* @__PURE__ */ Symbol.for("paperfund.immutable.provider.intervals.json.v1");
var immutableJSON = registry2[jsonKey] ?? /* @__PURE__ */ new WeakMap();
registry2[jsonKey] = immutableJSON;
var frozenKey = /* @__PURE__ */ Symbol.for("paperfund.immutable.provider.deep-frozen.v1");
var deepFrozen = registry2[frozenKey] ?? /* @__PURE__ */ new WeakSet();
registry2[frozenKey] = deepFrozen;
function freezeProviderDocument(v) {
  if (!v || typeof v !== "object" || deepFrozen.has(v)) return;
  for (const child of Object.values(v)) freezeProviderDocument(child);
  Object.freeze(v);
  deepFrozen.add(v);
}
function retainProviderInterval(e) {
  if (immutableHashes.has(e)) return e;
  let json3, hash2;
  if (e.blocks.length > 128) {
    const h = createHash11("sha256");
    h.update("{");
    let first = true;
    const keys = Object.keys(Object.fromEntries(Object.entries(e).sort(([a], [b]) => a.localeCompare(b))));
    for (const key2 of keys) {
      const value = e[key2];
      if (value === void 0) continue;
      if (!first) h.update(",");
      first = false;
      h.update(JSON.stringify(key2) + ":");
      if (key2 === "blocks") {
        h.update("[");
        e.blocks.forEach((b, i) => {
          if (i) h.update(",");
          h.update(canonicalJSON(b));
        });
        h.update("]");
      } else h.update(canonicalJSON(value));
    }
    h.update("}");
    hash2 = h.digest("hex");
  } else {
    json3 = canonicalJSON(e);
    hash2 = createHash11("sha256").update(json3).digest("hex");
  }
  freezeProviderDocument(e);
  immutableHashes.set(e, hash2);
  if (json3 !== void 0) immutableJSON.set(e, json3);
  return e;
}
function serializeProviderInterval(e) {
  retainProviderInterval(e);
  let json3 = immutableJSON.get(e);
  if (json3 === void 0) {
    json3 = canonicalJSON(e);
    if (createHash11("sha256").update(json3).digest("hex") !== digest(e)) fail9("IMMUTABLE_ENCODING_CONFLICT");
    immutableJSON.set(e, json3);
  }
  return json3;
}
function copyProviderInterval(e) {
  return immutableHashes.has(e) ? e : structuredClone(e);
}
function digest(v) {
  if (v && typeof v === "object") {
    const retained = immutableHashes.get(v);
    if (retained) return retained;
  }
  return createHash11("sha256").update(canonicalJSON(v)).digest("hex");
}
var canonicalOrders = /* @__PURE__ */ new Map();
function canonicalJSON(v) {
  const object = (x) => {
    const keys = Object.keys(x), shape = JSON.stringify(keys);
    let ordered = canonicalOrders.get(shape);
    if (!ordered) {
      ordered = keys.sort((a, b) => a.localeCompare(b));
      canonicalOrders.set(shape, ordered);
      if (canonicalOrders.size > 256) canonicalOrders.delete(canonicalOrders.keys().next().value);
    }
    const result = /* @__PURE__ */ Object.create(null);
    for (const key2 of ordered) result[key2] = sort(x[key2]);
    return result;
  };
  const sort = (x) => typeof x === "bigint" ? x.toString() : Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? object(x) : x;
  return JSON.stringify(sort(v));
}
var fail9 = (reason) => {
  throw new LinkedTransitionError(reason);
};
function newLinkedBranch(accountId, roundId, anchor) {
  if (!accountId || !roundId) fail9("MISSING_SCOPE");
  return {
    version: "LINKED_BRANCH_V1",
    accountId,
    roundId,
    real: structuredClone(anchor),
    simulated: structuredClone(anchor),
    inventoryDeltas: {},
    intervals: []
  };
}
function setTime(s, slot, seconds, epoch) {
  if (!Number.isSafeInteger(slot) || !Number.isSafeInteger(seconds) || seconds < 0)
    fail9("INVALID_CHAIN_TIME");
  const raw = Buffer.from(s.accounts[CLOCK4].base64, "base64");
  raw.writeBigUInt64LE(BigInt(slot), 0);
  raw.writeBigInt64LE(BigInt(epoch.start), 8);
  raw.writeBigUInt64LE(BigInt(epoch.epoch), 16);
  raw.writeBigUInt64LE(BigInt(epoch.leader), 24);
  raw.writeBigInt64LE(BigInt(seconds), 32);
  return {
    ...structuredClone(s),
    slot,
    observedAt: new Date(seconds * 1e3).toISOString(),
    accounts: {
      ...structuredClone(s.accounts),
      [CLOCK4]: { ...s.accounts[CLOCK4], base64: raw.toString("base64") }
    }
  };
}
function assertSameRoute(a, b) {
  for (const snapshot2 of [a, b]) {
    const clock3 = Buffer.from(snapshot2.accounts[CLOCK4]?.base64 ?? "", "base64");
    if (clock3.length !== 40 || clock3.readBigUInt64LE(0) !== BigInt(snapshot2.slot))
      fail9("STAGE1_CLOCK_INCONSISTENT");
  }
  if (digest(linkedBindings(a)) !== digest(linkedBindings(b))) fail9("LINKED_GROUP_ROUTES_CHANGED");
  for (const k of ["mint", "quoteMint", "targetPool", "bridgePool"])
    if (a[k] !== b[k]) fail9("ROUTE_CHANGED");
  if (digest(a.absentAccounts) !== digest(b.absentAccounts) || digest(Object.keys(a.accounts).sort()) !== digest(Object.keys(b.accounts).sort()))
    fail9("TICK_DEPENDENCIES_CHANGED");
}
var bytes = (text2) => Buffer.from(bs584.decode(text2));
function sameDisc(raw, name) {
  return raw.subarray(0, 8).equals(
    createHash11("sha256").update("global:" + name).digest().subarray(0, 8)
  );
}
function decodeSwap(s, ix, keys) {
  const p = keys[ix.programIdIndex], a = ix.accounts.map((i) => keys[i]), raw = bytes(ix.data);
  if (p === ORCA_WHIRLPOOL_PROGRAM && a[4] !== s.bridgePool) {
    const binding = linkedBindings(s).find(
      (r) => r.bridgePool === a[4] && r.targetPool !== r.bridgePool
    );
    if (binding) s = { ...s, ...binding };
  }
  if (p === ORCA_WHIRLPOOL_PROGRAM && a[4] === s.bridgePool) {
    if (!sameDisc(raw, "swap_v2") || raw.length < 43 || raw[40] !== 1 || raw[41] > 1 || raw[42] !== 0)
      fail9("UNSUPPORTED_ORCA_INSTRUCTION");
    const bridge = orcaLink(s.bridgePool, s.accounts[s.bridgePool]);
    if (a[5] !== bridge.mintA || a[6] !== bridge.mintB || a[8] !== bridge.vaultA || a[10] !== bridge.vaultB)
      fail9("ORCA_INSTRUCTION_BINDING");
    const aToB = raw[41] === 1;
    return {
      pump: null,
      routeMint: s.mint,
      routeBridgePool: s.bridgePool,
      leg: "BRIDGE",
      buy: (aToB ? bridge.mintA : bridge.mintB) === WRAPPED_SOL_MINT,
      input: raw.readBigUInt64LE(8),
      minimum: raw.readBigUInt64LE(16),
      source: aToB ? a[7] : a[9],
      destination: aToB ? a[9] : a[7],
      inputVault: aToB ? bridge.vaultA : bridge.vaultB,
      outputVault: aToB ? bridge.vaultB : bridge.vaultA,
      sqrtLimit: raw.readBigUInt64LE(24) + (raw.readBigUInt64LE(32) << 64n),
      aToB
    };
  }
  const curveV3 = p === PUMP_PROGRAM_ID && ["buy_v3", "buy_exact_quote_in_v3", "sell_v3"].some((n3) => sameDisc(raw, n3)), curveV2 = p === PUMP_PROGRAM_ID && ["buy_v2", "buy_exact_quote_in_v2", "sell_v2"].some((n3) => sameDisc(raw, n3));
  const curveIndex = curveV2 ? 10 : 5;
  if ((curveV3 || curveV2) && a[curveIndex] && s.accounts[a[curveIndex]]?.owner === PUMP_PROGRAM_ID) {
    const buy = !sameDisc(raw, curveV2 ? "sell_v2" : "sell_v3"), shift = curveV2 && !buy ? -1 : 0, config = curveV2 ? 22 + shift : 12, system = curveV2 ? 24 + shift : 14, end = curveV2 ? 26 + shift : 16;
    if (raw.length < 24 || raw.length > 25 || raw.length === 25 && raw[24] !== 0 || a.length !== end + 1 || a[0] !== "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf" || a[config] !== "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt" || a[end] !== PUMP_PROGRAM_ID || a[system] !== "11111111111111111111111111111111" || a[3] !== s.accounts[a[1]]?.owner || a[4] !== s.accounts[a[2]]?.owner || curveV2 && a[23 + shift] !== "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ")
      fail9("CURVE_INSTRUCTION_BINDING");
    const native = a[2] === WRAPPED_SOL_MINT;
    return {
      curve: {
        pool: a[curveIndex],
        baseMint: a[1],
        quoteMint: a[2],
        legacy: curveV2,
        exactOutput: sameDisc(raw, curveV2 ? "buy_v2" : "buy_v3"),
        buy,
        amount: raw.readBigUInt64LE(8),
        bound: raw.readBigUInt64LE(16),
        userBase: a[curveV2 ? 14 : 9],
        userQuote: a[curveV2 ? 15 : 10],
        baseVault: a[curveV2 ? 11 : 6],
        quoteVault: a[curveV2 ? 12 : 7],
        nativeUser: a[curveV2 ? 13 : 8],
        protocolRecipient: curveV2 ? a[native ? 6 : 7] : "",
        creatorRecipient: curveV2 ? a[native ? 16 : 17] : "",
        buybackRecipient: a[curveV2 ? native ? 8 : 9 : 13],
        ...curveV2 ? {
          payouts: {
            protocolWallet: a[6],
            creatorVault: a[16],
            buybackWallet: a[8],
            sharingConfig: a[18]
          }
        } : {}
      },
      pump: null,
      routeMint: s.mint
    };
  }
  if (p === PUMP_PROGRAM_ID && a.some(
    (address3) => s.accounts[address3]?.owner === PUMP_PROGRAM_ID && Buffer.from(s.accounts[address3].base64, "base64").length === 166
  ))
    fail9("UNSUPPORTED_CURVE_MUTATION");
  const route = linkedBindings(s).find((r) => r.targetPool === a[0]);
  const pumpBridge = p === PUMP_AMM_PROGRAM_ID && a[0] === s.bridgePool && s.accounts[s.bridgePool]?.owner === PUMP_AMM_PROGRAM_ID;
  const auxiliary = p === PUMP_AMM_PROGRAM_ID && !!s.accounts[a[0]] && s.accounts[a[0]].owner === PUMP_AMM_PROGRAM_ID;
  if (p === PUMP_AMM_PROGRAM_ID && (route || pumpBridge || auxiliary)) {
    if (route) s = linkedRoute(s, route.mint);
    const buy = ["buy_exact_quote_in", "buy_exact_quote_in_v2", "buy", "buy_v2"].some(
      (n3) => sameDisc(raw, n3)
    ), legacy = !["buy_exact_quote_in_v2", "buy_v2", "sell_v2"].some((n3) => sameDisc(raw, n3)), exactOutput = ["buy", "buy_v2"].some((n3) => sameDisc(raw, n3));
    if (!buy && !["sell", "sell_v2"].some((n3) => sameDisc(raw, n3)) || raw.length < 24)
      fail9("UNSUPPORTED_PUMPSWAP_INSTRUCTION");
    const pool = decodePumpSwapPool(Buffer.from(s.accounts[a[0]].base64, "base64"));
    if (a[3] !== pool.baseMint || a[4] !== pool.quoteMint || a[7] !== pool.baseVault || a[8] !== pool.quoteVault)
      fail9("TARGET_INSTRUCTION_BINDING");
    return {
      pump: pumpBridge || auxiliary || !legacy ? {
        pool: a[0],
        legacy,
        exactOutput,
        buy,
        amount: raw.readBigUInt64LE(8),
        bound: raw.readBigUInt64LE(16),
        userBase: a[5],
        userQuote: a[6],
        protocolRecipient: legacy ? a[10] : "",
        creatorRecipient: legacy ? a[17] : "",
        buybackRecipient: legacy ? a.at(-1) : a[14]
      } : null,
      routeMint: s.mint,
      leg: pumpBridge ? "BRIDGE" : "TARGET",
      buy,
      input: raw.readBigUInt64LE(8),
      minimum: raw.readBigUInt64LE(16),
      source: buy ? a[6] : a[5],
      destination: buy ? a[5] : a[6],
      inputVault: buy ? pool.quoteVault : pool.baseVault,
      outputVault: buy ? pool.baseVault : pool.quoteVault,
      sqrtLimit: 0n,
      aToB: false
    };
  }
  if ((p === ORCA_WHIRLPOOL_PROGRAM || p === PUMP_AMM_PROGRAM_ID) && a.some((x) => linkedBindings(s).some((r) => x === r.targetPool) || x === s.bridgePool))
    fail9("UNSUPPORTED_POOL_MUTATION");
  return null;
}
async function reconcileLinkedInterval(branch, evidence, nowMs, maxAgeMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
    fail9("INVALID_FRESHNESS_POLICY");
  if (!["LINKED_RETAINED_RPC_INTERVAL_V1", "LINKED_RETAINED_RPC_INTERVAL_V2"].includes(evidence.schema) || evidence.commitment !== "finalized")
    fail9("FINALIZED_EVIDENCE_REQUIRED");
  const hash2 = digest(evidence);
  if (branch.intervals.includes(hash2)) {
    if (digest(branch.real) !== digest(evidence.after)) fail9("OLD_INTERVAL_REPLAY");
    return {
      branch: structuredClone(branch),
      events: 0,
      failedTransactions: 0,
      hash: hash2,
      replay: true
    };
  }
  if (digest(branch.real) !== digest(evidence.before)) fail9("EXTERNAL_ANCHOR_MISMATCH");
  assertSameRoute(evidence.before, evidence.after);
  const epochAt = epochProgression(evidence.before, evidence.after, evidence.blocks, evidence.epochWitness);
  const age = nowMs - Date.parse(evidence.after.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs || evidence.after.slot <= evidence.before.slot)
    fail9("STALE_EXTERNAL_CHECKPOINT");
  if (evidence.blocks.length !== evidence.slots.length) fail9("INCOMPLETE_BLOCKS");
  let parent = evidence.before.slot, previousHash = evidence.anchor.blockhash;
  if (!previousHash) fail9("ANCHOR_BLOCK_MISSING");
  let real = structuredClone(branch.real), sim = structuredClone(branch.simulated), events = 0, failedTransactions = 0;
  const tokenFees = feePolicies(evidence.token2022, evidence.before, evidence.after, evidence.blocks, evidence.epochWitness);
  const footprintPlan = prepareFootprintReplay(branch, evidence, [...tokenFees.keys()]);
  const token2022Transfers = [];
  const nativeReserves = { ...branch.nativeReserves };
  const deltas = { ...branch.inventoryDeltas }, seen = /* @__PURE__ */ new Set();
  const protectedAccounts = new Set(Object.keys(real.accounts).filter((a) => a !== CLOCK4));
  const poolAccounts = new Set(
    Object.entries(real.accounts).filter(
      ([, a]) => a.owner === PUMP_AMM_PROGRAM_ID && [287, 300, 301].includes(Buffer.from(a.base64, "base64").length) || a.owner === PUMP_PROGRAM_ID && Buffer.from(a.base64, "base64").length === 166
    ).map(([k]) => k)
  );
  poolAccounts.add(real.bridgePool);
  linkedBindings(real).forEach((r) => {
    poolAccounts.add(r.targetPool);
    poolAccounts.add(r.bridgePool);
  });
  for (const [bi, { slot, result: b }] of evidence.blocks.entries()) {
    if (slot !== evidence.slots[bi] || slot <= parent || b.parentSlot !== parent || b.previousBlockhash !== previousHash || !b.blockhash)
      fail9("BLOCK_FRONTIER_GAP");
    parent = slot;
    previousHash = b.blockhash;
    const epoch = epochAt(slot);
    real = setTime(real, slot, b.blockTime, epoch);
    sim = setTime(sim, slot, b.blockTime, epoch);
    const rows = footprintPlan?.[bi] ?? b.transactions.map((receipt) => ({ receipt }));
    for (const row of rows) {
      if (!row.receipt) {
        const omitted = row;
        omitted.assertOmission(deltas, nativeReserves);
        if (seen.has(omitted.signature)) fail9("DUPLICATE_TRANSACTION");
        seen.add(omitted.signature);
        if (omitted.failed) failedTransactions++;
        continue;
      }
      const t = row.receipt;
      const signature = t.transaction.signatures[0];
      if (!signature || seen.has(signature)) return fail9("DUPLICATE_TRANSACTION");
      seen.add(signature);
      if (!t.meta) fail9("RECEIPT_METADATA_MISSING");
      if (t.meta.err !== null) {
        failedTransactions++;
        continue;
      }
      const keys = [
        ...t.transaction.message.accountKeys,
        ...t.meta.loadedAddresses?.writable ?? [],
        ...t.meta.loadedAddresses?.readonly ?? []
      ];
      const allInstructions = [
        ...t.transaction.message.instructions,
        ...t.meta.innerInstructions.flatMap((g) => g.instructions)
      ];
      const touchesPool = allInstructions.some(
        (ix) => [ORCA_WHIRLPOOL_PROGRAM, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID].includes(
          keys[ix.programIdIndex] ?? ""
        ) && ix.accounts.some((i) => poolAccounts.has(keys[i]))
      );
      const touchesMintBurn = allInstructions.some((ix) => [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(keys[ix.programIdIndex] ?? "") && [8, 15].includes(bytes(ix.data)[0]) && protectedAccounts.has(keys[ix.accounts[1]] ?? ""));
      const tracked = WrappedSolFlow.tracked(keys, deltas) || keys.some((a) => BigInt(deltas[WITHHELD_PREFIX + a] ?? "0") !== 0n) || t.meta.preTokenBalances.some((x) => BigInt(deltas[keys[x.accountIndex]] ?? "0") !== 0n);
      if (!touchesPool && !tracked && !touchesMintBurn) {
        for (const x of t.meta.preTokenBalances) {
          const a = keys[x.accountIndex];
          if (protectedAccounts.has(a ?? "")) {
            const post = t.meta.postTokenBalances.find((v) => v.accountIndex === x.accountIndex);
            if (!post || post.uiTokenAmount.amount !== x.uiTokenAmount.amount)
              fail9("UNSUPPORTED_DEPENDENCY_CHANGE");
          }
        }
        continue;
      }
      const actual = new Map(
        t.meta.preTokenBalances.map((x) => [keys[x.accountIndex], BigInt(x.uiTokenAmount.amount)])
      );
      const native = new WrappedSolFlow(t, keys, deltas, protectedAccounts, real, nativeReserves);
      const adjustments = /* @__PURE__ */ new Map();
      const burnedAccounts = /* @__PURE__ */ new Set();
      let pending = null;
      const directNative = () => {
        if (pending?.transfers?.some((t2) => t2.kind === "NATIVE_SYSTEM" && !t2.seen)) return;
        for (const t2 of pending?.transfers ?? [])
          if (t2.kind === "NATIVE_DIRECT" && !t2.seen) {
            native.curveTransfer(t2.from, t2.to, t2.real, t2.shadow);
            t2.seen = true;
          }
      };
      const assertCurveNative = (before, next) => {
        for (const [address3, a] of Object.entries(before.accounts)) {
          if (a.owner === PUMP_PROGRAM_ID && a.lamports !== void 0 && a.lamports !== next.accounts[address3]?.lamports)
            native.assertCurveBalance(address3, a.lamports);
        }
      };
      const finalize = () => {
        directNative();
        if (pending?.curveCalls?.some((c) => !c.seen)) fail9("CURVE_CPI_EVIDENCE_MISSING");
        if (pending && (!pending.inputSeen || !pending.outputSeen))
          fail9("SWAP_TRANSFER_EVIDENCE_MISSING");
        if (pending?.transfers?.some((t2) => !t2.seen && t2.real > 0n))
          fail9("PUMP_TRANSFER_EVIDENCE_MISSING");
        pending = null;
      };
      const applyTransfer = (from, to, amount, shadowAmount, net = amount, shadowNet = shadowAmount) => {
        const realBalance = actual.get(from);
        if (realBalance === void 0 || realBalance < amount)
          return fail9("TRANSFER_INPUT_EVIDENCE_MISSING");
        if (!protectedAccounts.has(from) && realBalance + BigInt(deltas[from] ?? "0") < shadowAmount)
          fail9("MODELED_EXTERNAL_INVENTORY_EXHAUSTED");
        actual.set(from, realBalance - amount);
        actual.set(to, (actual.get(to) ?? 0n) + net);
        if (!protectedAccounts.has(from))
          deltas[from] = (BigInt(deltas[from] ?? "0") + amount - shadowAmount).toString();
        if (!protectedAccounts.has(to))
          deltas[to] = (BigInt(deltas[to] ?? "0") + shadowNet - net).toString();
        const feeDelta = shadowAmount - shadowNet - (amount - net);
        if (feeDelta !== 0n)
          deltas[WITHHELD_PREFIX + to] = (BigInt(deltas[WITHHELD_PREFIX + to] ?? "0") + feeDelta).toString();
        native.tokenTransfer(from, to, amount, shadowAmount);
        adjustments.set(from, (adjustments.get(from) ?? 0n) - amount);
        adjustments.set(to, (adjustments.get(to) ?? 0n) + net);
      };
      const flattened = [];
      for (const [oi, ix] of t.transaction.message.instructions.entries()) {
        flattened.push({ ix, depth: 1 });
        for (const inner of t.meta.innerInstructions.find((g) => g.index === oi)?.instructions ?? []) {
          if (!Number.isSafeInteger(inner.stackHeight) || inner.stackHeight < 2)
            fail9("CPI_ANCESTRY_MISSING");
          flattened.push({ ix: inner, depth: inner.stackHeight });
        }
      }
      const ancestry = [];
      for (const [instructionIndex, { ix, depth }] of flattened.entries()) {
        ancestry.length = depth - 1;
        const ancestors = ancestry.slice();
        ancestry[depth - 1] = keys[ix.programIdIndex];
        if (pending && depth <= pending.depth) finalize();
        if (pumpSweepBucket(ix, keys) && poolAccounts.has(keys[ix.accounts[2]])) {
          if (pending) fail9("NESTED_NATIVE_SWEEP_UNSUPPORTED");
          const r = await transitionPumpSweep(real, ix, keys), v = await transitionPumpSweep(sim, ix, keys);
          if (r.amount === 0n && v.amount !== 0n) fail9("PUMP_SWEEP_ZERO_REAL_WITH_PAPER_FEES");
          pending = {
            depth,
            swap: null,
            realOut: 0n,
            simOut: 0n,
            inputSeen: true,
            outputSeen: true,
            transfers: [{ from: r.from, to: r.to, real: r.amount, shadow: v.amount, seen: false }]
          };
          real = r.next;
          sim = v.next;
          events++;
          continue;
        }
        if (isMultiHop(ix, keys) && ix.accounts.some((i) => poolAccounts.has(keys[i]))) {
          if (pending) fail9("NESTED_NATIVE_SWAP_UNSUPPORTED");
          const r = await transitionMultiHop(real, ix, keys, native.mints), v = await transitionMultiHop(sim, ix, keys, native.mints);
          pending = {
            depth,
            swap: null,
            realOut: r.output,
            simOut: v.output,
            inputSeen: true,
            outputSeen: true,
            curveCalls: r.curveCalls.map((c) => ({ ...c, seen: false })),
            transfers: r.transfers.map((t2, i) => {
              const shadow = v.transfers[i];
              if (!shadow || shadow.from !== t2.from || shadow.to !== t2.to)
                fail9("PUMP_TRANSFER_TOPOLOGY_CHANGED");
              return {
                ...t2,
                real: t2.amount,
                shadow: shadow.amount,
                seen: false
              };
            })
          };
          if (r.transfers.length !== v.transfers.length) fail9("PUMP_TRANSFER_TOPOLOGY_CHANGED");
          assertCurveNative(real, r.next);
          real = r.next;
          sim = v.next;
          directNative();
          events += r.steps.length;
          continue;
        }
        if (keys[ix.programIdIndex] === PUMP_PROGRAM_ID && sameDisc(bytes(ix.data), "multi_hop_curve_swap")) {
          const raw2 = bytes(ix.data), accounts2 = ix.accounts.map((i) => keys[i]), call = pending?.curveCalls?.find(
            (c) => !c.seen && digest(c.accounts) === digest(accounts2)
          );
          if (!pending || depth !== pending.depth + 1 || ancestors[pending.depth - 1] !== PUMP_AMM_PROGRAM_ID || !call || raw2.length !== 20 + call.fees.length || raw2.readUInt32LE(16) !== call.fees.length || raw2.readBigUInt64LE(8) !== call.input || !raw2.subarray(20).equals(Buffer.from(call.fees)))
            fail9("CURVE_CPI_BINDING");
          call.seen = true;
          continue;
        }
        const swap = decodeSwap(real, ix, keys);
        if (swap) {
          if (pending) fail9("NESTED_NATIVE_SWAP_UNSUPPORTED");
          if (swap.curve) {
            if (depth !== 1) fail9("CURVE_AGGREGATOR_ENVELOPE_UNSUPPORTED");
            const r2 = await transitionExternalCurve(real, swap.curve, {
              nowMs: Date.parse(real.observedAt),
              maxAgeMs: 1e4
            }), v2 = await transitionExternalCurve(sim, swap.curve, {
              nowMs: Date.parse(sim.observedAt),
              maxAgeMs: 1e4
            });
            pending = {
              depth,
              swap: null,
              realOut: r2.output,
              simOut: v2.output,
              inputSeen: true,
              outputSeen: true,
              transfers: r2.transfers.map((t2, i) => {
                const shadow = v2.transfers[i];
                if (!shadow || shadow.from !== t2.from || shadow.to !== t2.to)
                  fail9("CURVE_TRANSFER_TOPOLOGY_CHANGED");
                return { ...t2, real: t2.amount, shadow: shadow.amount, seen: false };
              })
            };
            if (r2.transfers.length !== v2.transfers.length) fail9("CURVE_TRANSFER_TOPOLOGY_CHANGED");
            assertCurveNative(real, r2.next);
            real = r2.next;
            sim = v2.next;
            directNative();
            events++;
            continue;
          }
          if (swap.pump) {
            const policy = { nowMs: Date.parse(real.observedAt), maxAgeMs: 1e4 };
            const r2 = await transitionExternalPump(
              linkedRoute(
                real,
                swap.routeMint,
                "routeBridgePool" in swap ? swap.routeBridgePool : void 0
              ),
              swap.pump,
              policy
            ), v2 = await transitionExternalPump(
              linkedRoute(
                sim,
                swap.routeMint,
                "routeBridgePool" in swap ? swap.routeBridgePool : void 0
              ),
              swap.pump,
              policy
            );
            pending = {
              depth,
              swap,
              realOut: r2.output,
              simOut: v2.output,
              inputSeen: true,
              outputSeen: true,
              transfers: r2.transfers.map((t2, i) => {
                const shadow = v2.transfers[i];
                if (!shadow || shadow.from !== t2.from || shadow.to !== t2.to)
                  fail9("PUMP_TRANSFER_TOPOLOGY_CHANGED");
                return {
                  from: t2.from,
                  to: t2.to,
                  real: t2.amount,
                  shadow: shadow.amount,
                  seen: false
                };
              })
            };
            if (v2.transfers.length !== r2.transfers.length) fail9("PUMP_TRANSFER_TOPOLOGY_CHANGED");
            real = carryLinkedRoot(real, r2.next);
            sim = carryLinkedRoot(sim, v2.next);
            events++;
            continue;
          }
          const r = await transitionLinkedLeg(
            linkedRoute(
              real,
              swap.routeMint,
              "routeBridgePool" in swap ? swap.routeBridgePool : void 0
            ),
            swap.input,
            swap.buy,
            { nowMs: Date.parse(real.observedAt), maxAgeMs: 1e4 },
            swap.leg
          );
          const v = await transitionLinkedLeg(
            linkedRoute(
              sim,
              swap.routeMint,
              "routeBridgePool" in swap ? swap.routeBridgePool : void 0
            ),
            swap.input,
            swap.buy,
            { nowMs: Date.parse(sim.observedAt), maxAgeMs: 1e4 },
            swap.leg
          );
          if (r.output < swap.minimum || v.output < swap.minimum)
            fail9("EXTERNAL_SIGNED_MINIMUM_VIOLATED");
          if (swap.leg === "BRIDGE" && swap.sqrtLimit !== 0n) {
            const raw2 = Buffer.from(
              v.next.accounts["routeBridgePool" in swap ? swap.routeBridgePool : sim.bridgePool].base64,
              "base64"
            ), sqrt = raw2.readBigUInt64LE(65) + (raw2.readBigUInt64LE(73) << 64n);
            if (swap.aToB ? sqrt < swap.sqrtLimit : sqrt > swap.sqrtLimit)
              fail9("EXTERNAL_PRICE_LIMIT_VIOLATED");
          }
          pending = {
            depth,
            swap,
            realOut: r.output,
            simOut: v.output,
            inputSeen: false,
            outputSeen: false
          };
          real = carryLinkedRoot(real, r.next);
          sim = carryLinkedRoot(sim, v.next);
          events++;
          continue;
        }
        const program2 = keys[ix.programIdIndex], accounts = ix.accounts.map((i) => keys[i]), raw = bytes(ix.data);
        if ([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program2 ?? "") && [8, 15].includes(raw[0]) && protectedAccounts.has(accounts[1])) {
          const [source, mint] = accounts, amount = raw.length >= 9 ? raw.readBigUInt64LE(1) : -1n;
          const a = real.accounts[mint], data = Buffer.from(a.base64, "base64");
          const pre = t.meta.preTokenBalances.find((v) => keys[v.accountIndex] === source), post = t.meta.postTokenBalances.find((v) => keys[v.accountIndex] === source);
          const closesLater = flattened.slice(instructionIndex + 1).some(({ ix: later }) => keys[later.programIdIndex] === program2 && keys[later.accounts[0]] === source && bytes(later.data).length === 1 && bytes(later.data)[0] === 9);
          if (pending || raw.length !== (raw[0] === 15 ? 10 : 9) || a.owner !== program2 || data.length < 82 || data[45] !== 1 || mint === WRAPPED_SOL_MINT || protectedAccounts.has(source) || !pre || !post && !closesLater || pre.mint !== mint || post && post.mint !== mint || pre.programId !== program2 || post && post.programId !== program2 || raw[0] === 15 && raw[9] !== data[44] || actual.get(source) === void 0 || actual.get(source) < amount || actual.get(source) + BigInt(deltas[source] ?? "0") < amount)
            fail9("TOKEN_BURN_EVIDENCE_UNSUPPORTED");
          for (const state of [real, sim]) {
            const rawMint = Buffer.from(state.accounts[mint].base64, "base64"), supply = rawMint.readBigUInt64LE(36);
            if (amount < 0n || supply < amount) fail9("TOKEN_BURN_SUPPLY_UNDERFLOW");
            rawMint.writeBigUInt64LE(supply - amount, 36);
            state.accounts[mint] = { ...state.accounts[mint], base64: rawMint.toString("base64") };
          }
          actual.set(source, actual.get(source) - amount);
          adjustments.set(source, (adjustments.get(source) ?? 0n) - amount);
          burnedAccounts.add(source);
          events++;
          continue;
        }
        if ([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program2 ?? "") && raw[0] === 9 && burnedAccounts.has(accounts[0]) && (actual.get(accounts[0]) !== 0n || BigInt(deltas[accounts[0]] ?? "0") !== 0n || BigInt(deltas[WITHHELD_PREFIX + accounts[0]] ?? "0") !== 0n))
          fail9("TOKEN_BURN_CLOSE_NOT_EMPTY");
        if (program2 === "11111111111111111111111111111111" && raw.length === 12 && raw.readUInt32LE(0) === 2 && pending?.transfers) {
          const expected = pending.transfers.find(
            (t2) => !t2.seen && t2.kind === "NATIVE_SYSTEM" && t2.from === accounts[0] && t2.to === accounts[1]
          );
          if (expected) {
            if (expected.real !== raw.readBigUInt64LE(4)) fail9("CURVE_NATIVE_TRANSFER_MISMATCH");
            native.curveTransfer(expected.from, expected.to, expected.real, expected.shadow);
            expected.seen = true;
            directNative();
            continue;
          }
        }
        if (program2 === TOKEN_2022_PROGRAM_ID && raw[0] !== 3 && raw[0] !== 12 && accounts.some((a) => BigInt(deltas[WITHHELD_PREFIX + a] ?? "0") !== 0n))
          fail9("TRACKED_WITHHELD_MUTATION_UNSUPPORTED");
        const synchronizes = [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program2 ?? "") && raw[0] === 17;
        const tokensBeforeSync = synchronizes ? actual.get(accounts[0]) : void 0;
        const nativeHandled = native.instruction(ix, raw, depth, ancestors, actual);
        if (nativeHandled && synchronizes) {
          const tokensAfterSync = actual.get(accounts[0]);
          if (tokensBeforeSync === void 0 || tokensAfterSync === void 0)
            fail9("NATIVE_SYNC_TOKEN_EVIDENCE_MISSING");
          adjustments.set(accounts[0], (adjustments.get(accounts[0]) ?? 0n) + tokensAfterSync - tokensBeforeSync);
        }
        if ([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program2 ?? "") && (raw[0] === 3 || raw[0] === 12)) {
          if (raw.length !== (raw[0] === 12 ? 10 : 9)) fail9("TOKEN_TRANSFER_LAYOUT");
          const from = accounts[0], to = accounts[raw[0] === 12 ? 2 : 1], amount = raw.readBigUInt64LE(1);
          let shadow = amount;
          if (pending?.transfers) {
            const expected = pending.transfers.find(
              (t2) => !t2.seen && t2.from === from && t2.to === to
            );
            if (!expected || expected.real !== amount)
              fail9(
                "PUMP_TRANSFER_MISMATCH:" + signature + ":" + from + ":" + to + ":" + amount + ":" + expected?.real
              );
            expected.seen = true;
            shadow = expected.shadow;
          } else if (pending && from === pending.swap.source && to === pending.swap.inputVault) {
            if (amount !== pending.swap.input || pending.inputSeen) fail9("SWAP_INPUT_MISMATCH");
            pending.inputSeen = true;
          } else if (pending && from === pending.swap.outputVault && to === pending.swap.destination) {
            if (amount !== pending.realOut || pending.outputSeen) fail9("SWAP_OUTPUT_MISMATCH");
            shadow = pending.simOut;
            pending.outputSeen = true;
          } else if (protectedAccounts.has(from) || protectedAccounts.has(to))
            fail9("UNEXPLAINED_VAULT_TRANSFER");
          let net = amount, shadowNet = shadow;
          if (program2 === TOKEN_2022_PROGRAM_ID && raw[0] === 3 && tokenFees.has(native.mints.get(from) ?? ""))
            fail9("TOKEN_2022_UNCHECKED_TRANSFER_UNSUPPORTED");
          if (program2 === TOKEN_2022_PROGRAM_ID && raw[0] === 12) {
            const mint = accounts[1], policy = tokenFees.get(mint);
            if (evidence.token2022 && !real.accounts[mint] && !policy)
              fail9("TOKEN_2022_FEE_POLICY_MISSING:" + mint);
            if (policy) {
              if (raw.length !== 10 || raw[9] !== policy.decimals || [from, to].some((a) => native.mints.has(a) && native.mints.get(a) !== mint))
                fail9("TOKEN_2022_TRANSFER_BINDING");
              net = amount - policy.fee(amount, BigInt(epoch.epoch));
              shadowNet = shadow - policy.fee(shadow, BigInt(epoch.epoch));
              if ((net !== amount || shadowNet !== shadow) && (protectedAccounts.has(from) || protectedAccounts.has(to)))
                fail9("POOL_TRANSFER_FEES_UNSUPPORTED");
              token2022Transfers.push({
                signature,
                from,
                to,
                mint,
                gross: amount.toString(),
                net: net.toString(),
                withheld: (amount - net).toString(),
                shadowGross: shadow.toString(),
                shadowNet: shadowNet.toString()
              });
            }
          }
          if (pending || BigInt(deltas[from] ?? "0") !== 0n || BigInt(deltas[to] ?? "0") !== 0n) {
            applyTransfer(from, to, amount, shadow, net, shadowNet);
          } else if (actual.has(from)) {
            if (actual.get(from) < amount) fail9("TRANSFER_INPUT_EVIDENCE_MISSING");
            native.tokenTransfer(from, to, amount, amount);
            actual.set(from, actual.get(from) - amount);
            actual.set(to, (actual.get(to) ?? 0n) + net);
            adjustments.set(from, (adjustments.get(from) ?? 0n) - amount);
            adjustments.set(to, (adjustments.get(to) ?? 0n) + net);
          }
        } else if (!nativeHandled && [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program2 ?? "") && accounts.some(
          (a) => BigInt(deltas[a] ?? "0") !== 0n || BigInt(deltas[WITHHELD_PREFIX + a] ?? "0") !== 0n
        ))
          fail9("TRACKED_INVENTORY_MUTATION_UNSUPPORTED");
      }
      finalize();
      native.verify(actual);
      for (const [address3, delta] of adjustments) {
        const pre = t.meta.preTokenBalances.find((x) => keys[x.accountIndex] === address3), post = t.meta.postTokenBalances.find((x) => keys[x.accountIndex] === address3);
        if (pre && post && BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount) !== delta)
          fail9("TRANSACTION_TOKEN_EFFECTS_UNRECONCILED:" + signature + ":" + address3);
      }
    }
  }
  if (parent !== evidence.after.slot) fail9("END_FRONTIER_MISSING");
  for (const a of protectedAccounts)
    if (digest(real.accounts[a]) !== digest(evidence.after.accounts[a]))
      fail9("REAL_CHECKPOINT_MISMATCH:" + a);
  real = structuredClone(evidence.after);
  sim = {
    ...sim,
    slot: real.slot,
    observedAt: real.observedAt,
    accounts: { ...sim.accounts, [CLOCK4]: structuredClone(real.accounts[CLOCK4]) }
  };
  return {
    branch: {
      ...structuredClone(branch),
      real,
      simulated: sim,
      inventoryDeltas: Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== "0")),
      ...Object.keys(nativeReserves).length ? { nativeReserves } : {},
      intervals: [...branch.intervals, hash2]
    },
    events,
    failedTransactions,
    token2022Transfers,
    hash: hash2,
    replay: false
  };
}

// packages/db/isolated/linked-pair/cutoff.ts
var reject = (m) => {
  throw new LinkedTransitionError(m);
};
async function reconcileCutoff(branch, frontier, cutoff) {
  const ms = Date.parse(cutoff), last = frontier.last, next = frontier.next;
  if (frontier.schema !== "LINKED_UTC_FRONTIER_V1" || frontier.commitment !== "finalized" || !Number.isFinite(ms) || ms % 36e5 !== 0)
    reject("LINKED_INVALID_UTC_FRONTIER");
  if (!Number.isSafeInteger(last.slot) || !Number.isSafeInteger(next.slot) || !Number.isSafeInteger(last.blockTime) || !Number.isSafeInteger(next.blockTime) || !last.blockhash || !next.blockhash || next.slot <= last.slot || next.parentSlot !== last.slot || next.previousBlockhash !== last.blockhash || last.blockTime * 1e3 >= ms || next.blockTime * 1e3 < ms)
    reject("LINKED_CUTOFF_BOUNDARY_UNPROVEN");
  const after = frontier.interval?.after ?? branch.real;
  if (after.slot !== last.slot) reject("LINKED_CUTOFF_SLOT_MISMATCH");
  const clock3 = Buffer.from(
    after.accounts["SysvarC1ock11111111111111111111111111111111"]?.base64 ?? "",
    "base64"
  );
  if (clock3.length !== 40 || clock3.readBigInt64LE(32) !== BigInt(last.blockTime) || clock3.readBigUInt64LE(0) !== BigInt(after.slot) || ms - last.blockTime * 1e3 > 1e4)
    reject("LINKED_CUTOFF_BANK_UNAVAILABLE");
  if (frontier.interval) {
    const end = frontier.interval.blocks.at(-1);
    if (!end || end.result.blockhash !== last.blockhash || end.result.blockTime !== last.blockTime || frontier.interval.blocks.some((x) => x.result.blockTime * 1e3 >= ms))
      reject("LINKED_POST_CUTOFF_FLOW");
  }
  const result = frontier.interval ? (await reconcileLinkedInterval(
    branch,
    frontier.interval,
    Date.parse(after.observedAt),
    1e4
  )).branch : structuredClone(branch);
  if (digest(result.real) !== digest(after)) reject("LINKED_CUTOFF_ANCHOR_CHANGED");
  return result;
}

// packages/db/isolated/linked-pair/flow-progress.ts
import { gzipSync, gunzipSync as gunzipSync2 } from "node:zlib";
import { performance as performance2 } from "node:perf_hooks";

// packages/db/isolated/linked-pair/proof-recovery.ts
import { gunzipSync } from "node:zlib";
var fail10 = (s) => {
  throw Error("LINKED_RECOVERY_" + s);
};
async function financialHash(c, account) {
  const data = {};
  data.account = (await c.query("select to_jsonb(a) document from competition_accounts a where id=$1", [account])).rows[0]?.document;
  if (!data.account) fail10("ACCOUNT_MISSING");
  for (const table of ["orders", "positions", "journal_transactions", "ledger_entries"])
    data[table] = (await c.query(
      `select to_jsonb(t) document from ${table} t where competition_account_id=$1 order by id`,
      [account]
    )).rows.map((r) => r.document);
  data.fills = (await c.query(
    "select to_jsonb(f) document from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 order by f.id",
    [account]
  )).rows.map((r) => r.document);
  data.receipts = (await c.query(
    "select to_jsonb(r) document from linked_candidate.receipts r where account_id=$1 order by revision",
    [account]
  )).rows.map((r) => r.document);
  return digest(data);
}
async function original(c, account) {
  return (await c.query("select * from linked_candidate.route_quarantine where account_id=$1", [account])).rows[0];
}
async function latest(c, account) {
  return (await c.query(
    "select i.*,r.proof_hash from linked_recovery_candidate.incidents i left join linked_recovery_candidate.resolutions r using(account_id,generation) where i.account_id=$1 order by i.generation desc limit 1",
    [account]
  )).rows[0];
}
function unchangedIncident(interval, incidentHash) {
  if (digest(interval) === incidentHash) return;
  const old = structuredClone(interval);
  delete old.token2022;
  if (!interval.token2022 || digest(old) !== incidentHash) fail10("INCIDENT_EVIDENCE_CHANGED");
}
async function prepareRecovery(store, interval) {
  if (!store.durableFlow) fail10("DURABLE_FLOW_REQUIRED");
  const recovered = await store.recover(false), head = await store.load();
  if (digest(recovered) !== head.state_hash) fail10("PREDECESSOR_CHANGED");
  const c = await store.db.pool.connect();
  try {
    await c.query("begin isolation level repeatable read read only");
    const q = await original(c, store.accountId);
    if (!q || digest(q.document) !== q.interval_hash) fail10("INCIDENT_MISSING_OR_CORRUPT");
    const incident = store.proofRecovery ? await latest(c, store.accountId) ?? { ...q, generation: "0" } : { ...q, generation: "0" };
    if (incident.proof_hash) fail10("NO_UNRESOLVED_INCIDENT");
    if (digest(incident.document) !== incident.interval_hash) fail10("INCIDENT_CORRUPT");
    unchangedIncident(interval, incident.interval_hash);
    if (digest(head.document.real) !== digest(interval.before)) fail10("PREDECESSOR_CHANGED");
    const result = await reconcileLinkedInterval(
      head.document,
      interval,
      Date.parse(interval.after.observedAt),
      1e4
    );
    const proof = {
      schema: "LINKED_PROOF_RECOVERY_V1",
      accountId: store.accountId,
      roundId: store.roundId,
      generation: String(incident.generation),
      incidentHash: incident.interval_hash,
      reason: incident.reason,
      revision: head.revision,
      sequence: head.flow_sequence ?? "0",
      beforeHash: head.state_hash,
      evidenceHash: digest(interval),
      afterHash: digest(result.branch),
      financialHash: await financialHash(c, store.accountId)
    };
    const check2 = (await c.query(
      "select b.revision,coalesce(h.state_hash,b.state_hash) state_hash,coalesce(h.sequence,0)::text flow_sequence from linked_candidate.branches b left join linked_flow_candidate.heads h on h.account_id=b.account_id and h.fill_revision=b.revision where b.account_id=$1",
      [store.accountId]
    )).rows[0];
    if (check2?.state_hash !== head.state_hash || check2.revision !== head.revision || check2.flow_sequence !== (head.flow_sequence ?? "0"))
      fail10("PREDECESSOR_CHANGED");
    await c.query("commit");
    return {
      proof,
      proofHash: digest(proof),
      branch: result.branch,
      events: result.events,
      failedTransactions: result.failedTransactions
    };
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
function validateApproval(a, store) {
  const { proof: p, approval: q, nowMs: now } = a;
  if (!store.proofRecovery || !store.durableFlow) fail10("NOT_ENABLED");
  if (p.schema !== "LINKED_PROOF_RECOVERY_V1" || q.schema !== "LINKED_RECOVERY_APPROVAL_V1" || q.mode !== "RECOVERY_ONLY_BUY_DISABLED" || q.proofHash !== digest(p) || p.accountId !== store.accountId || q.accountId !== store.accountId || p.roundId !== store.roundId || q.roundId !== store.roundId || !q.operator.trim() || !q.reference.trim())
    fail10("APPROVAL_SCOPE");
  const from = Date.parse(q.issuedAt), until = Date.parse(q.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(from) || !Number.isFinite(until) || from > now || until <= now || until - from > 20 * 6e4)
    fail10("APPROVAL_TIME");
}
async function recordIncident(c, account, interval, reason) {
  const q = await original(c, account);
  if (!q || digest(q.document) !== q.interval_hash) fail10("INCIDENT_CORRUPT");
  await c.query(
    "insert into linked_recovery_candidate.incidents values($1,0,$2,$3,$4::jsonb) on conflict do nothing",
    [account, q.interval_hash, q.reason, JSON.stringify(q.document)]
  );
  const last = await latest(c, account), hash2 = digest(interval);
  if (!last) fail10("INCIDENT_MISSING");
  if (!last.proof_hash && last.interval_hash === hash2 && last.reason === reason) return;
  await c.query("insert into linked_recovery_candidate.incidents values($1,$2,$3,$4,$5::jsonb)", [
    account,
    (BigInt(last.generation) + 1n).toString(),
    hash2,
    reason,
    JSON.stringify(interval)
  ]);
}
async function checkActivation(c, store, a, head, interval) {
  validateApproval(a, store);
  const p = a.proof;
  if (p.beforeHash !== head.state_hash || p.revision !== head.revision || p.sequence !== (head.flow_sequence ?? "0") || p.evidenceHash !== digest(interval) || p.financialHash !== await financialHash(c, store.accountId))
    fail10("PREDECESSOR_OR_FINANCIAL_CHANGED");
  const q = await original(c, store.accountId);
  if (!q || digest(q.document) !== q.interval_hash) fail10("INCIDENT_MISSING");
  await c.query(
    "insert into linked_recovery_candidate.incidents values($1,0,$2,$3,$4::jsonb) on conflict do nothing",
    [store.accountId, q.interval_hash, q.reason, JSON.stringify(q.document)]
  );
  const incidents = (await c.query(
    "select i.* from linked_recovery_candidate.incidents i left join linked_recovery_candidate.resolutions r using(account_id,generation) where i.account_id=$1 and r.account_id is null order by generation",
    [store.accountId]
  )).rows;
  if (incidents.length !== 1 || String(incidents[0].generation) !== p.generation || incidents[0].interval_hash !== p.incidentHash || incidents[0].reason !== p.reason || digest(incidents[0].document) !== p.incidentHash)
    fail10("INCIDENT_CHANGED_OR_MULTIPLE_HOLDS");
  unchangedIncident(interval, p.incidentHash);
}
async function recordResolution(c, store, a, head, branch, sequence) {
  if (digest(branch) !== a.proof.afterHash || await financialHash(c, store.accountId) !== a.proof.financialHash)
    fail10("SUCCESSOR_OR_FINANCIAL_CHANGED");
  await c.query(
    "insert into linked_recovery_candidate.resolutions values($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [
      store.accountId,
      a.proof.generation,
      digest(a.proof),
      digest(a.approval),
      head.revision,
      sequence,
      JSON.stringify({ proof: a.proof, approval: a.approval, predecessor: head.document })
    ]
  );
}
var verified = /* @__PURE__ */ new Set();
async function assertRecovered(c, store) {
  const q = (await c.query(
    "select interval_hash,reason from linked_candidate.route_quarantine where account_id=$1",
    [store.accountId]
  )).rows[0];
  if (!q) return;
  const rows = (await c.query(
    "select i.account_id,i.generation,i.interval_hash,i.reason,r.proof_hash,r.approval_hash,r.fill_revision,r.sequence from linked_recovery_candidate.incidents i left join linked_recovery_candidate.resolutions r using(account_id,generation) where i.account_id=$1 order by i.generation",
    [store.accountId]
  )).rows;
  if (!rows.length || rows[0].generation !== "0" || rows[0].interval_hash !== q.interval_hash || rows[0].reason !== q.reason)
    fail10("ORIGINAL_HOLD_NOT_PROVEN");
  let generation = 0n;
  for (const row of rows) {
    if (BigInt(row.generation) !== generation++) fail10("INCIDENT_SEQUENCE_GAP");
    if (!row.proof_hash) fail10("UNRESOLVED_INCIDENT:" + row.reason);
    const step = (await c.query(
      "select * from linked_flow_candidate.steps where account_id=$1 and fill_revision=$2 and sequence=$3",
      [store.accountId, row.fill_revision, row.sequence]
    )).rows[0];
    if (!step) fail10("RESOLUTION_STEP_MISSING");
    const key2 = digest({ round: store.roundId, row, step });
    if (verified.has(key2)) continue;
    const full = (await c.query(
      "select i.document incident,r.document resolution from linked_recovery_candidate.incidents i join linked_recovery_candidate.resolutions r using(account_id,generation) where i.account_id=$1 and i.generation=$2",
      [store.accountId, row.generation]
    )).rows[0];
    if (!full) fail10("RESOLUTION_MISSING");
    const {
      proof: p,
      approval: a,
      predecessor
    } = full.resolution;
    if (digest(p) !== row.proof_hash || digest(a) !== row.approval_hash || p.accountId !== store.accountId || p.roundId !== store.roundId || p.incidentHash !== row.interval_hash || p.reason !== row.reason || p.generation !== String(row.generation) || digest(full.incident) !== p.incidentHash || digest(predecessor) !== p.beforeHash || a.proofHash !== row.proof_hash)
      fail10("RESOLUTION_CORRUPT");
    validateApproval({ proof: p, approval: a, nowMs: Date.parse(a.issuedAt) }, store);
    if (!step || step.before_hash !== p.beforeHash || step.after_hash !== p.afterHash || step.evidence_hash !== p.evidenceHash || String(step.fill_revision) !== p.revision || BigInt(step.sequence) !== BigInt(p.sequence) + 1n)
      fail10("RESOLUTION_STEP_MISSING");
    const payload = (await c.query("select payload from linked_flow_candidate.evidence where hash=$1", [
      p.evidenceHash
    ])).rows[0]?.payload;
    if (!payload) fail10("RESOLUTION_EVIDENCE_MISSING");
    const interval = JSON.parse(gunzipSync(payload).toString());
    if (digest(interval) !== p.evidenceHash) fail10("RESOLUTION_EVIDENCE_CORRUPT");
    unchangedIncident(interval, p.incidentHash);
    const replay = await reconcileLinkedInterval(
      predecessor,
      interval,
      Date.parse(interval.after.observedAt),
      1e4
    );
    if (digest(replay.branch) !== p.afterHash) fail10("RESOLUTION_REPLAY_CHANGED");
    verified.add(key2);
    if (verified.size > 256) verified.delete(verified.values().next().value);
  }
}

// packages/db/isolated/linked-pair/flow-progress.ts
var fail11 = (s) => {
  throw Error("LINKED_FLOW_" + s);
};
var timing = (name, start, detail) => {
  performance2.measure(name, { start, detail });
  performance2.clearMeasures(name);
};
var verifiedSteps = /* @__PURE__ */ new Map();
async function flowHead(c, account, base) {
  const h = (await c.query(
    "select * from linked_flow_candidate.heads where account_id=$1 and fill_revision=$2",
    [account, base.revision]
  )).rows[0];
  if (!h) return { ...base, base_state_hash: base.state_hash, flow_sequence: "0" };
  if (h.base_hash !== base.state_hash || digest(h.document) !== h.state_hash) fail11("HEAD_CORRUPT");
  const rows = (await c.query(
    "select sequence,base_hash,before_hash,after_hash from linked_flow_candidate.steps where account_id=$1 and fill_revision=$2 order by sequence",
    [account, base.revision]
  )).rows;
  let n3 = 0n, hash2 = base.state_hash;
  for (const r of rows) {
    if (BigInt(r.sequence) !== ++n3 || r.base_hash !== base.state_hash || r.before_hash !== hash2)
      fail11("CHAIN_CORRUPT");
    hash2 = r.after_hash;
  }
  if (n3 !== BigInt(h.sequence) || hash2 !== h.state_hash) fail11("HEAD_PROOF_MISSING");
  return {
    ...base,
    base_state_hash: base.state_hash,
    flow_sequence: h.sequence,
    document: h.document,
    state_hash: h.state_hash
  };
}
async function replayFlows(c, account, revision, branch, sequence) {
  const rows = (await c.query(
    "select s.* from linked_flow_candidate.steps s where s.account_id=$1 and s.fill_revision=$2 and s.sequence<=$3 order by s.sequence",
    [account, revision, sequence]
  )).rows;
  let n3 = 0n;
  const baseHash = digest(branch);
  for (const r of rows) {
    if (BigInt(r.sequence) !== ++n3 || r.base_hash !== baseHash || r.before_hash !== digest(branch))
      fail11("REPLAY_CHAIN");
    const key2 = digest({
      before: r.before_hash,
      after: r.after_hash,
      evidence: r.evidence_hash,
      at: +new Date(r.replay_at)
    }), cached = verifiedSteps.get(key2);
    if (cached) {
      branch = structuredClone(cached);
      continue;
    }
    const payload = (await c.query("select payload from linked_flow_candidate.evidence where hash=$1", [
      r.evidence_hash
    ])).rows[0]?.payload;
    if (!payload) fail11("EVIDENCE_MISSING");
    const e = retainProviderInterval(
      JSON.parse(gunzipSync2(payload).toString())
    );
    if (digest(e) !== r.evidence_hash || +new Date(r.replay_at) !== Date.parse(e.after.observedAt))
      fail11("EVIDENCE_CORRUPT");
    branch = (await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 1e4)).branch;
    if (digest(branch) !== r.after_hash) fail11("REPLAY_SUCCESSOR");
    verifiedSteps.set(key2, structuredClone(branch));
    if (verifiedSteps.size > 512) verifiedSteps.delete(verifiedSteps.keys().next().value);
  }
  if (n3 !== BigInt(sequence)) fail11("REPLAY_MISSING");
  return branch;
}
async function advanceFlow(store, supplied, recovery) {
  if (recovery) validateApproval(recovery, store);
  else await store.assertAvailable();
  const interval = retainProviderInterval(supplied), expected = await store.load(), hash2 = digest(interval);
  if (digest(expected.document.real) === digest(interval.after))
    return { advanced: false, sequence: expected.flow_sequence ?? "0" };
  if (digest(expected.document.real) !== digest(interval.before)) fail11("PREDECESSOR_CHANGED_RETRY");
  let branch;
  const reconciling = performance2.now();
  try {
    branch = (await reconcileLinkedInterval(
      expected.document,
      interval,
      Date.parse(interval.after.observedAt),
      1e4
    )).branch;
  } catch (e) {
    if (e instanceof FootprintReceiptRequired) throw e;
    await store.quarantine(interval, e);
    throw e;
  }
  timing("linked.flow.reconcile", reconciling, { from: interval.before.slot, to: interval.after.slot });
  const encoding = performance2.now();
  const afterHash = digest(branch), payload = gzipSync(Buffer.from(serializeProviderInterval(interval)), { level: 1 });
  timing("linked.flow.encode", encoding, { bytes: payload.length });
  const writing = performance2.now();
  const c = await store.db.pool.connect();
  try {
    await c.query("begin");
    if (recovery)
      await c.query("select id from competition_accounts where id=$1 for update", [
        store.accountId
      ]);
    await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      "linked-account:" + store.accountId
    ]);
    const status = (await c.query(
      "select quarantined from linked_candidate.route_status where account_id=$1 for update",
      [store.accountId]
    )).rows[0];
    if (!status) fail11("QUARANTINED");
    if (status.quarantined && !recovery) {
      if (!store.proofRecovery) fail11("QUARANTINED");
      await store.assertAvailable(c);
    }
    const head = await store.load(c);
    if (head.revision !== expected.revision || head.state_hash !== expected.state_hash || head.flow_sequence !== expected.flow_sequence)
      fail11("PREDECESSOR_CHANGED_RETRY");
    if (recovery) await checkActivation(c, store, recovery, head, interval);
    const round = (await c.query("select state,ends_at_exclusive from hourly_rounds where id=$1 for share", [
      store.roundId
    ])).rows[0];
    if (!round || !["OPEN", "CLOSING", "SETTLING"].includes(round.state) || Date.parse(interval.after.observedAt) >= +round.ends_at_exclusive || await store.cutoff(c))
      fail11("CUTOFF_SEALED_OR_PAST");
    const inserted = await c.query(
      "insert into linked_flow_candidate.evidence values($1,$2) on conflict do nothing",
      [hash2, payload]
    );
    if (!inserted.rowCount) {
      const saved = (await c.query("select payload from linked_flow_candidate.evidence where hash=$1", [hash2])).rows[0];
      if (!saved || digest(retainProviderInterval(JSON.parse(gunzipSync2(saved.payload).toString()))) !== hash2)
        fail11("EVIDENCE_CONFLICT");
    }
    const sequence = (BigInt(head.flow_sequence ?? "0") + 1n).toString(), base = head.base_state_hash ?? head.state_hash;
    await c.query("insert into linked_flow_candidate.steps values($1,$2,$3,$4,$5,$6,$7,$8)", [
      store.accountId,
      head.revision,
      sequence,
      base,
      head.state_hash,
      afterHash,
      hash2,
      new Date(interval.after.observedAt)
    ]);
    if (sequence === "1")
      await c.query("insert into linked_flow_candidate.heads values($1,$2,$3,$4,$5,$6::jsonb)", [
        store.accountId,
        head.revision,
        base,
        sequence,
        afterHash,
        JSON.stringify(branch)
      ]);
    else {
      const updated = await c.query(
        "update linked_flow_candidate.heads set sequence=$3,state_hash=$4,document=$5::jsonb where account_id=$1 and fill_revision=$2 and sequence=$6 and state_hash=$7",
        [
          store.accountId,
          head.revision,
          sequence,
          afterHash,
          JSON.stringify(branch),
          head.flow_sequence,
          head.state_hash
        ]
      );
      if (updated.rowCount !== 1) fail11("HEAD_CHANGED_RETRY");
    }
    if (recovery) await recordResolution(c, store, recovery, head, branch, sequence);
    await c.query("commit");
    timing("linked.flow.commit", writing, { from: interval.before.slot, to: interval.after.slot, sequence });
    return { advanced: true, sequence, slot: branch.real.slot };
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

// packages/db/isolated/linked-pair/store.ts
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { identifier as identifier8 } from "./packages/core/dist/index.js";
import {
  ExecutionEngineError as ExecutionEngineError13,
  createMarketStateEvidence as createMarketStateEvidence6
} from "./packages/execution/dist/index.js";

// packages/protocols/isolated/linked-pair/adapter.ts
import {
  identifier as identifier6,
  paperSolBaseUnits as paperSolBaseUnits5,
  tokenBaseUnits as tokenBaseUnits5
} from "./packages/core/dist/index.js";
import {
  createMarketStateEvidence as createMarketStateEvidence5,
  executionRouteRecord as executionRouteRecord2,
  ExecutionEngineError as ExecutionEngineError11
} from "./packages/execution/dist/index.js";

// packages/protocols/src/non-sol-pump-swap.ts
import {
  APPROVED_NON_SOL_PUMPSWAP_ROUTES,
  validateNonSolPumpSwapRoutes
} from "./packages/config/dist/index.js";
import {
  identifier as identifier5,
  paperSolBaseUnits as paperSolBaseUnits4,
  tokenBaseUnits as tokenBaseUnits4,
  utcInstant as utcInstant2
} from "./packages/core/dist/index.js";
import {
  ExecutionEngineError as ExecutionEngineError10,
  createMarketStateEvidence as createMarketStateEvidence4,
  executionRouteRecord
} from "./packages/execution/dist/index.js";
var NON_SOL_PUMP_SWAP_PROTOCOL_ID = identifier5(
  "NON_SOL_PUMP_SWAP",
  "ProtocolId"
);
var NON_SOL_PUMP_SWAP_VERSION = "non-sol-pump-swap-canonical-v1";
function nonSolPumpSwapIdentity(mint, quote) {
  return {
    protocolId: NON_SOL_PUMP_SWAP_PROTOCOL_ID,
    marketId: identifier5("non-sol-pump-swap:" + mint + ":" + quote, "MarketId"),
    tokenMint: identifier5(mint, "TokenMint")
  };
}
function reject2(reason) {
  throw new ExecutionEngineError10("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
}
var json = (value) => JSON.parse(
  JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v)
);
function assertNonSolRouteBinding(s) {
  const row = APPROVED_NON_SOL_PUMPSWAP_ROUTES.find((r) => r.mint === s.mint);
  if (!row || s.targetPool !== row.targetPool || s.quoteMint !== row.quoteMint || s.bridgePool !== row.bridgePool)
    reject2("NON_SOL_ALLOWLIST_ROUTE_MISMATCH");
  const target = s.accounts[s.targetPool], bridge = s.accounts[s.bridgePool];
  if (target?.owner !== row.targetProgram || bridge?.owner !== row.bridgeProgram || s.accounts[s.mint]?.owner !== row.baseTokenProgram || s.accounts[s.quoteMint]?.owner !== row.quoteTokenProgram || s.accounts[WRAPPED_SOL_MINT]?.owner !== SPL_TOKEN_PROGRAM_ID)
    reject2("NON_SOL_ALLOWLIST_PROGRAM_MISMATCH");
  const p = decodePumpSwapPool(Buffer.from(target.base64, "base64")), link2 = orcaLink(s.bridgePool, bridge);
  if (p.baseVault !== row.targetBaseVault || p.quoteVault !== row.targetQuoteVault || (link2.mintA === WRAPPED_SOL_MINT ? link2.vaultA : link2.vaultB) !== row.bridgeSolVault || (link2.mintA === s.quoteMint ? link2.vaultA : link2.vaultB) !== row.bridgeQuoteVault)
    reject2("NON_SOL_ALLOWLIST_VAULT_MISMATCH");
}
var NonSolPumpSwapSource = class {
  constructor(rpc, routes = []) {
    this.rpc = rpc;
    this.routes = routes.length ? validateNonSolPumpSwapRoutes(routes) : Object.freeze([]);
  }
  rpc;
  engine = new Stage1NonSolPumpSwap({ purpose: "READ_ONLY_STAGE1_VALIDATION" });
  routes;
  async resolve(mint, quote) {
    const allowed = this.routes.find((r2) => r2.mint === mint && r2.quoteMint === quote);
    if (!allowed) reject2("NON_SOL_NOT_ALLOWLISTED");
    const bridge = STAGE1_BRIDGES[quote];
    if (!bridge) reject2("NON_SOL_QUOTE_NOT_VALIDATED");
    const target = await canonicalPumpSwapPoolAddress(mint, quote), r = await this.rpc.getMultipleAccounts([target, bridge]);
    if (r.value.length !== 2) reject2("NON_SOL_DISCOVERY_CARDINALITY");
    const p = r.value[0], b = r.value[1];
    if (!p || p.owner !== PUMP_AMM_PROGRAM_ID || !b || b.owner !== ORCA_WHIRLPOOL_PROGRAM)
      reject2("NON_SOL_BOUND_POOLS_UNAVAILABLE");
    const pool = decodePumpSwapPool(Buffer.from(p.data[0], "base64"));
    if (pool.index !== 0 || pool.creator !== await pumpPoolAuthorityAddress(mint) || pool.baseMint !== mint || pool.quoteMint !== quote)
      reject2("NON_SOL_CANONICAL_LINKAGE");
    const link2 = orcaLink(bridge, { owner: b.owner, base64: b.data[0] });
    if (![link2.mintA, link2.mintB].includes(quote) || ![link2.mintA, link2.mintB].includes(WRAPPED_SOL_MINT))
      reject2("NON_SOL_BRIDGE_LINKAGE");
    return nonSolPumpSwapIdentity(mint, quote);
  }
  async loadMarketState(identity) {
    if (!this.routes.some(
      (r) => nonSolPumpSwapIdentity(r.mint, r.quoteMint).marketId === identity.marketId && r.mint === identity.tokenMint
    ))
      reject2("NON_SOL_NOT_ALLOWLISTED");
    return this.state(identity, await this.engine.capture(this.rpc, identity.tokenMint));
  }
  async state(identity, snapshot2) {
    const s = structuredClone(snapshot2), expected = nonSolPumpSwapIdentity(s.mint, s.quoteMint);
    if (identity.protocolId !== expected.protocolId || identity.marketId !== expected.marketId || identity.tokenMint !== expected.tokenMint)
      reject2("NON_SOL_EXECUTION_IDENTITY");
    assertNonSolRouteBinding(s);
    return pumpSwapStateFromSnapshot(identity, s, this.engine);
  }
};
async function pumpSwapStateFromSnapshot(identity, s, engine3, adapterVersion = NON_SOL_PUMP_SWAP_VERSION, normalizationVersion = "non-sol-pump-swap-accounts-v1") {
  const v = await engine3.validate(s, { nowMs: Date.parse(s.observedAt), maxAgeMs: 1e4 });
  const p = decodePumpSwapPool(Buffer.from(s.accounts[s.targetPool].base64, "base64")), clock3 = s.accounts["SysvarC1ock11111111111111111111111111111111"];
  const hops = [
    {
      pool: s.targetPool,
      programId: PUMP_AMM_PROGRAM_ID,
      mintA: s.mint,
      mintB: s.quoteMint,
      baseVault: p.baseVault,
      quoteVault: p.quoteVault
    },
    {
      pool: s.bridgePool,
      programId: ORCA_WHIRLPOOL_PROGRAM,
      mintA: v.bridge.mintA,
      mintB: v.bridge.mintB,
      baseVault: v.bridge.vaultA,
      quoteVault: v.bridge.vaultB
    }
  ];
  return {
    identity,
    adapterVersion,
    normalizationVersion,
    observedAt: utcInstant2(s.observedAt),
    chainSlot: BigInt(s.slot),
    chainBlockId: null,
    normalizedState: {
      model: "NON_SOL_PUMP_SWAP_ROUTE",
      tokenDecimals: v.baseDecimals.toString(),
      accounts: s.accounts,
      stage1Snapshot: json(s),
      hops,
      chainTime: advisoryClockTime({ owner: clock3.owner, data: [clock3.base64, "base64"] }, s.slot)
    }
  };
}
var NonSolPumpSwapAdapter = class {
  constructor(source, policy = {
    protocolId: NON_SOL_PUMP_SWAP_PROTOCOL_ID,
    adapterVersion: NON_SOL_PUMP_SWAP_VERSION,
    normalizationVersion: "non-sol-pump-swap-accounts-v1",
    identity: nonSolPumpSwapIdentity,
    assertBinding: assertNonSolRouteBinding,
    buysEnabled: true
  }) {
    this.source = source;
    this.policy = policy;
    this.protocolId = policy.protocolId;
    this.adapterVersion = policy.adapterVersion;
  }
  source;
  policy;
  protocolId;
  adapterVersion;
  loadMarketState(identity) {
    return this.source.loadMarketState(identity);
  }
  async quote(identity, state, input, buy) {
    const s = state.normalizedState["stage1Snapshot"];
    if (!s || !Number.isSafeInteger(s.slot) || s.slot < 0 || !s.accounts || state.adapterVersion !== this.adapterVersion || state.normalizationVersion !== this.policy.normalizationVersion || state.normalizedState["model"] !== "NON_SOL_PUMP_SWAP_ROUTE" || state.chainSlot !== BigInt(s.slot) || state.observedAt !== s.observedAt || identity.protocolId !== this.protocolId || identity.marketId !== this.policy.identity(s.mint, s.quoteMint, s.bridgePool).marketId || identity.tokenMint !== s.mint || state.identity.protocolId !== identity.protocolId || state.identity.marketId !== identity.marketId || state.identity.tokenMint !== identity.tokenMint)
      reject2("NON_SOL_STATE_IDENTITY");
    this.policy.assertBinding(s);
    if (buy && !this.policy.buysEnabled && state.normalizedState["genericBuyAdmissionAllowed"] !== true)
      reject2("GENERIC_BUY_DISABLED_EXIT_ONLY");
    const q = await this.source.engine.quote(s, input, buy, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 1e4
    });
    if (state.normalizedState["tokenDecimals"] !== q.baseDecimals.toString())
      reject2("NON_SOL_STATE_DECIMALS");
    return q;
  }
  fees(q) {
    const asset2 = (mint, n3) => mint === WRAPPED_SOL_MINT ? { asset: "PAPER_SOL", amount: paperSolBaseUnits4(n3) } : { asset: "TOKEN", tokenMint: identifier5(mint, "TokenMint"), amount: tokenBaseUnits4(n3) };
    return [
      { category: "AMM_TRADE_FEE", amount: asset2(q.bridge.feeMint, q.bridge.lp) },
      ...["lp", "protocol", "creator"].map((k) => ({
        category: k === "creator" && q.creatorFeeDestination === "HOLDER_REWARD" ? "PUMP_SWAP_HOLDER_REWARD_FEE" : "PUMP_SWAP_" + k.toUpperCase() + "_FEE",
        amount: asset2(q.quoteMint, q.target.fees[k])
      }))
    ].filter((f) => f.amount.amount > 0n);
  }
  hops(q, state) {
    const s = state.normalizedState["stage1Snapshot"];
    const target = {
      pool: s.targetPool,
      programId: PUMP_AMM_PROGRAM_ID,
      inputMint: q.buy ? s.quoteMint : s.mint,
      outputMint: q.buy ? s.mint : s.quoteMint,
      input: q.target.input.toString(),
      output: q.target.output.toString(),
      fees: json(q.target.fees),
      postTrade: json(q.target.post)
    };
    const bridge = {
      pool: s.bridgePool,
      programId: ORCA_WHIRLPOOL_PROGRAM,
      inputMint: q.buy ? WRAPPED_SOL_MINT : s.quoteMint,
      outputMint: q.buy ? s.quoteMint : WRAPPED_SOL_MINT,
      input: (q.buy ? q.input : q.target.output).toString(),
      output: q.bridge.output.toString(),
      ...q.bridge.detail
    };
    return q.buy ? [bridge, target] : [target, bridge];
  }
  async execute(request, state, buy) {
    const input = buy ? request.requestedPaperSol : request.requestedTokenQuantity;
    const q = await this.quote(request.identity, state, input, buy), fees = this.fees(q);
    const from = buy ? { asset: "PAPER_SOL", amount: paperSolBaseUnits4(q.input) } : { asset: "TOKEN", tokenMint: request.identity.tokenMint, amount: tokenBaseUnits4(q.input) };
    const to = buy ? { asset: "TOKEN", tokenMint: request.identity.tokenMint, amount: tokenBaseUnits4(q.output) } : { asset: "PAPER_SOL", amount: paperSolBaseUnits4(q.output) };
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: createMarketStateEvidence4(state).fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput: from,
        simulatedOutput: to,
        fees
      },
      actualInput: from,
      actualOutput: to,
      executedAt: request.executedAt,
      executionDetails: { hops: this.hops(q, state) }
    };
  }
  simulateBuy(r, s) {
    return this.execute(r, s, true);
  }
  simulateSell(r, s) {
    return this.execute(r, s, false);
  }
  async valuePositionForExit(r, s) {
    const q = await this.quote(r.identity, s, r.tokenQuantity, false), fees = this.fees(q);
    return {
      identity: r.identity,
      tokenQuantity: r.tokenQuantity,
      paperSolValue: paperSolBaseUnits4(q.output),
      adapterVersion: this.adapterVersion,
      marketStateFingerprint: createMarketStateEvidence4(s).fingerprint,
      route: executionRouteRecord(s, false, this.hops(q, s)),
      feeBreakdown: {
        fees,
        totalPaperSolFees: paperSolBaseUnits4(
          fees.reduce((n3, f) => n3 + (f.amount.asset === "PAPER_SOL" ? f.amount.amount : 0n), 0n)
        )
      }
    };
  }
  async maxExecutableSellQuantity(r, s) {
    try {
      await this.quote(r.identity, s, r.tokenQuantity, false);
    } catch (e) {
      if (!(e instanceof ExecutionEngineError10) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
        throw e;
    }
    const snapshot2 = s.normalizedState["stage1Snapshot"];
    const exit = await this.source.engine.exits(snapshot2, r.tokenQuantity, {
      nowMs: Date.parse(snapshot2.observedAt),
      maxAgeMs: 1e4
    });
    return tokenBaseUnits4(exit.maxQuantity);
  }
};

// packages/protocols/isolated/linked-pair/adapter.ts
var reject3 = (reason) => {
  throw new ExecutionEngineError11("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
};
var json2 = (v) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));
async function linkedState(identity, s, engine3, version, normalization) {
  const state = await pumpSwapStateFromSnapshot(identity, s, engine3, version, normalization);
  const hops = state.normalizedState["hops"];
  return {
    ...state,
    normalizedState: {
      ...state.normalizedState,
      hops: (s.targetPool === s.bridgePool ? hops.slice(0, 1) : hops).map(
        (h, i) => i === 1 ? { ...h, programId: s.accounts[s.bridgePool].owner } : h
      )
    }
  };
}
var LinkedPoolAdapter = class {
  constructor(source, policy) {
    this.source = source;
    this.policy = policy;
    this.protocolId = policy.protocolId;
    this.adapterVersion = policy.adapterVersion;
  }
  source;
  policy;
  protocolId;
  adapterVersion;
  loadMarketState(identity) {
    return this.source.loadMarketState(identity);
  }
  async quote(identity, state, input, buy) {
    const s = state.normalizedState["stage1Snapshot"];
    if (!s || !Number.isSafeInteger(s.slot) || s.slot < 0 || !s.accounts || state.adapterVersion !== this.adapterVersion || state.normalizationVersion !== this.policy.normalizationVersion || state.normalizedState["model"] !== "NON_SOL_PUMP_SWAP_ROUTE" || state.chainSlot !== BigInt(s.slot) || state.observedAt !== s.observedAt || identity.protocolId !== this.protocolId || identity.marketId !== this.policy.identity(s.mint, s.quoteMint, s.bridgePool).marketId || identity.tokenMint !== s.mint || state.identity.protocolId !== identity.protocolId || state.identity.marketId !== identity.marketId || state.identity.tokenMint !== identity.tokenMint)
      reject3("NON_SOL_STATE_IDENTITY");
    this.policy.assertBinding(s);
    if (buy && !this.policy.buysEnabled && state.normalizedState["genericBuyAdmissionAllowed"] !== true)
      reject3("GENERIC_BUY_DISABLED_EXIT_ONLY");
    const q = await this.source.engine.quote(s, input, buy, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 1e4
    });
    if (state.normalizedState["tokenDecimals"] !== q.baseDecimals.toString())
      reject3("NON_SOL_STATE_DECIMALS");
    return q;
  }
  fees(q) {
    const asset2 = (mint, n3) => mint === WRAPPED_SOL_MINT ? { asset: "PAPER_SOL", amount: paperSolBaseUnits5(n3) } : { asset: "TOKEN", tokenMint: identifier6(mint, "TokenMint"), amount: tokenBaseUnits5(n3) };
    return [
      ...q.bridge.detail["bridgeKind"] === "PUMP_SWAP" ? ["lp", "protocol", "creator"].map((k) => ({
        category: k === "creator" && q.bridge.detail["bridgeCreatorFeeDestination"] === "HOLDER_REWARD" ? "PUMP_SWAP_HOLDER_REWARD_FEE" : "PUMP_SWAP_" + k.toUpperCase() + "_FEE",
        amount: asset2(q.bridge.feeMint, q.bridge[k])
      })) : [{ category: "AMM_TRADE_FEE", amount: asset2(q.bridge.feeMint, q.bridge.lp) }],
      ...["lp", "protocol", "creator"].map((k) => ({
        category: k === "creator" && q.creatorFeeDestination === "HOLDER_REWARD" ? "PUMP_SWAP_HOLDER_REWARD_FEE" : "PUMP_SWAP_" + k.toUpperCase() + "_FEE",
        amount: asset2(q.quoteMint, q.target.fees[k])
      }))
    ].filter((f) => f.amount.amount > 0n);
  }
  hops(q, state) {
    const s = state.normalizedState["stage1Snapshot"];
    const target = {
      pool: s.targetPool,
      programId: PUMP_AMM_PROGRAM_ID,
      inputMint: q.buy ? s.quoteMint : s.mint,
      outputMint: q.buy ? s.mint : s.quoteMint,
      input: q.target.input.toString(),
      output: q.target.output.toString(),
      fees: json2(q.target.fees),
      postTrade: json2(q.target.post)
    };
    if (s.targetPool === s.bridgePool) return [target];
    const bridge = {
      pool: s.bridgePool,
      programId: s.accounts[s.bridgePool].owner,
      inputMint: q.buy ? WRAPPED_SOL_MINT : s.quoteMint,
      outputMint: q.buy ? s.quoteMint : WRAPPED_SOL_MINT,
      input: (q.buy ? q.input : q.target.output).toString(),
      output: q.bridge.output.toString(),
      ...q.bridge.detail
    };
    return q.buy ? [bridge, target] : [target, bridge];
  }
  async execute(request, state, buy) {
    const input = buy ? request.requestedPaperSol : request.requestedTokenQuantity;
    const q = await this.quote(request.identity, state, input, buy), fees = this.fees(q);
    const from = buy ? { asset: "PAPER_SOL", amount: paperSolBaseUnits5(q.input) } : { asset: "TOKEN", tokenMint: request.identity.tokenMint, amount: tokenBaseUnits5(q.input) };
    const to = buy ? { asset: "TOKEN", tokenMint: request.identity.tokenMint, amount: tokenBaseUnits5(q.output) } : { asset: "PAPER_SOL", amount: paperSolBaseUnits5(q.output) };
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: createMarketStateEvidence5(state).fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput: from,
        simulatedOutput: to,
        fees
      },
      actualInput: from,
      actualOutput: to,
      executedAt: request.executedAt,
      executionDetails: { hops: this.hops(q, state) }
    };
  }
  simulateBuy(r, s) {
    return this.execute(r, s, true);
  }
  simulateSell(r, s) {
    return this.execute(r, s, false);
  }
  async valuePositionForExit(r, s) {
    const q = await this.quote(r.identity, s, r.tokenQuantity, false), fees = this.fees(q);
    return {
      identity: r.identity,
      tokenQuantity: r.tokenQuantity,
      paperSolValue: paperSolBaseUnits5(q.output),
      adapterVersion: this.adapterVersion,
      marketStateFingerprint: createMarketStateEvidence5(s).fingerprint,
      route: executionRouteRecord2(s, false, this.hops(q, s)),
      feeBreakdown: {
        fees,
        totalPaperSolFees: paperSolBaseUnits5(
          fees.reduce((n3, f) => n3 + (f.amount.asset === "PAPER_SOL" ? f.amount.amount : 0n), 0n)
        )
      }
    };
  }
  async maxExecutableSellQuantity(r, s) {
    try {
      await this.quote(r.identity, s, r.tokenQuantity, false);
    } catch (e) {
      if (!(e instanceof ExecutionEngineError11) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
        throw e;
    }
    const snapshot2 = s.normalizedState["stage1Snapshot"];
    const exit = await this.source.engine.exits(snapshot2, r.tokenQuantity, {
      nowMs: Date.parse(snapshot2.observedAt),
      maxAgeMs: 1e4
    });
    return tokenBaseUnits5(exit.maxQuantity);
  }
};

// packages/protocols/src/generic-pump-swap.ts
import { NATIVE_MINT_2022 as NATIVE_MINT_20222 } from "./packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import { identifier as identifier7 } from "./packages/core/dist/index.js";
import { ExecutionEngineError as ExecutionEngineError12 } from "./packages/execution/dist/index.js";
import { PublicKey as PublicKey11 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
var GENERIC_PUMP_SWAP_PROTOCOL_ID = identifier7(
  "GENERIC_PUMP_SWAP",
  "ProtocolId"
);
var GENERIC_PUMP_SWAP_VERSION = "generic-pump-swap-orca-v1";
var NORMALIZATION = "generic-pump-swap-accounts-v1";
var CLOCK5 = "SysvarC1ock11111111111111111111111111111111";
var references = [1000000000n, 100000000n, 10000000n, 1000000n];
function unavailable(reason) {
  throw new ExecutionEngineError12("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
}
function genericPumpSwapIdentity(mint, quote, bridge) {
  return {
    protocolId: GENERIC_PUMP_SWAP_PROTOCOL_ID,
    tokenMint: identifier7(mint, "TokenMint"),
    marketId: identifier7("generic-pump-swap:" + mint + ":" + quote + ":" + bridge, "MarketId")
  };
}
var OrcaBridgeCandidates = class {
  cache = /* @__PURE__ */ new Map();
  async pools(quote) {
    const cached = this.cache.get(quote);
    if (cached && cached.until > Date.now()) return [...cached.pools];
    const response = await fetch("https://api.dexscreener.com/token-pairs/v1/solana/" + quote, {
      signal: AbortSignal.any([
        advisoryReadContext()?.signal ?? AbortSignal.timeout(8e3),
        AbortSignal.timeout(3e3)
      ])
    });
    if (!response.ok) unavailable("GENERIC_DISCOVERY_HTTP_" + response.status);
    const pairs = await response.json();
    if (!Array.isArray(pairs)) unavailable("GENERIC_DISCOVERY_INVALID");
    const pools = [
      ...new Set(
        pairs.filter(
          (p) => p && [p.baseToken?.address, p.quoteToken?.address].includes(quote) && [p.baseToken?.address, p.quoteToken?.address].includes(WRAPPED_SOL_MINT)
        ).map((p) => p.pairAddress).filter((p) => {
          if (typeof p !== "string") return false;
          try {
            return new PublicKey11(p).toBase58() === p;
          } catch {
            return false;
          }
        })
      )
    ].sort().slice(0, 16);
    if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value);
    if (pools.length) this.cache.set(quote, { until: Date.now() + 6e4, pools });
    return pools;
  }
};
function assertGenericQuoteMechanics(quote) {
  if (quote === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
    unavailable("GENERIC_STABLE_FEE_SCHEDULE_UNSUPPORTED");
  if (quote === NATIVE_MINT_20222.toBase58())
    unavailable("GENERIC_TOKEN2022_NATIVE_FEE_SCHEDULE_UNSUPPORTED");
}
function compareGenericBridges(a, b) {
  if (BigInt(a.reference) !== BigInt(b.reference))
    return BigInt(a.reference) > BigInt(b.reference) ? -1 : 1;
  if (BigInt(a.recoveryPpb) !== BigInt(b.recoveryPpb))
    return BigInt(a.recoveryPpb) > BigInt(b.recoveryPpb) ? -1 : 1;
  return a.pool < b.pool ? -1 : a.pool > b.pool ? 1 : 0;
}
function boundEngine(s) {
  assertGenericQuoteMechanics(s.quoteMint);
  return new Stage1NonSolPumpSwap({
    purpose: "READ_ONLY_STAGE1_VALIDATION",
    bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool }
  });
}
var GenericPumpSwapSource = class {
  constructor(rpc, candidates = new OrcaBridgeCandidates()) {
    this.rpc = rpc;
    this.candidates = candidates;
  }
  rpc;
  candidates;
  topology = /* @__PURE__ */ new Map();
  pinned = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  diagnostics = /* @__PURE__ */ new Map();
  engine = {
    validate: (s, p) => boundEngine(s).validate(s, p),
    quote: (s, input, buy, p) => boundEngine(s).quote(s, input, buy, p),
    exits: (s, q, p) => boundEngine(s).exits(s, q, p)
  };
  key(mint, quote) {
    return mint + ":" + quote;
  }
  async resolve(mint, quote) {
    assertGenericQuoteMechanics(quote);
    if ([WRAPPED_SOL_MINT, PublicKey11.default.toBase58()].includes(quote))
      unavailable("GENERIC_NATIVE_ROUTE_USE_EXISTING_ADAPTER");
    const k = this.key(mint, quote), cached = this.topology.get(k);
    if (cached && cached.until > Date.now())
      return genericPumpSwapIdentity(mint, quote, cached.bridge.pool);
    let promise = this.pending.get(k);
    if (!promise) {
      promise = this.discover(mint, quote).finally(() => {
        if (this.pending.get(k) === promise) this.pending.delete(k);
      });
      this.pending.set(k, promise);
    }
    const t = await promise;
    return genericPumpSwapIdentity(mint, quote, t.bridge.pool);
  }
  /** Only a trusted owner/settlement proof supplies this address. Old reserves are never reused. */
  async resolvePinned(mint, quote, bridgePool) {
    assertGenericQuoteMechanics(quote);
    const identity = genericPumpSwapIdentity(mint, quote, bridgePool), saved = this.pinned.get(identity.marketId);
    if (saved && saved.until > Date.now()) return identity;
    const curve = await pumpBondingCurveAddress(mint), target = await canonicalPumpSwapPoolAddress(mint, quote), r = await this.rpc.getMultipleAccounts([curve, target, bridgePool]);
    const c = r.value[0], p = r.value[1], b = r.value[2];
    if (!c || c.owner !== PUMP_PROGRAM_ID || !p || p.owner !== PUMP_AMM_PROGRAM_ID || !b || b.owner !== ORCA_WHIRLPOOL_PROGRAM)
      unavailable("GENERIC_EXIT_PIN_UNAVAILABLE");
    const curveState = decodePumpBondingCurve(Buffer.from(c.data[0], "base64")), pool = decodePumpSwapPool(Buffer.from(p.data[0], "base64")), bridge = orcaLink(bridgePool, { owner: b.owner, base64: b.data[0] });
    if (!curveState.complete || curveState.quoteMint !== quote || pool.baseMint !== mint || pool.quoteMint !== quote || pool.creator !== await pumpPoolAuthorityAddress(mint) || pool.index !== 0 || ![bridge.mintA, bridge.mintB].includes(quote) || ![bridge.mintA, bridge.mintB].includes(WRAPPED_SOL_MINT))
      unavailable("GENERIC_EXIT_PIN_LINKAGE");
    const addresses = [
      .../* @__PURE__ */ new Set([
        curve,
        target,
        mint,
        quote,
        WRAPPED_SOL_MINT,
        pool.baseVault,
        pool.quoteVault,
        bridgePool,
        bridge.vaultA,
        bridge.vaultB,
        bridge.config,
        ...bridge.extraAccounts ?? [],
        await pumpSwapGlobalConfigAddress(),
        await pumpSwapFeeConfigAddress(),
        CLOCK5
      ])
    ];
    const t = {
      mint,
      quote,
      target,
      bridge,
      addresses,
      until: Date.now() + 6e4,
      reference: "0",
      recoveryPpb: "0",
      pinned: true
    };
    if (this.pinned.size >= 256) this.pinned.delete(this.pinned.keys().next().value);
    this.pinned.set(identity.marketId, structuredClone(t));
    return identity;
  }
  async eligibility(mint, quote) {
    try {
      const identity = await this.resolve(mint, quote);
      return {
        supported: true,
        identity,
        diagnostics: this.diagnostics.get(this.key(mint, quote)) ?? []
      };
    } catch (e) {
      return {
        supported: false,
        reason: e instanceof ExecutionEngineError12 ? e.code : "MARKET_STATE_UNAVAILABLE",
        diagnostics: e instanceof Error ? e.message : "GENERIC_STATE_UNAVAILABLE",
        candidates: this.diagnostics.get(this.key(mint, quote)) ?? []
      };
    }
  }
  async discover(mint, quote) {
    const target = await canonicalPumpSwapPoolAddress(mint, quote), curve = await pumpBondingCurveAddress(mint);
    const targetRead = await this.rpc.getMultipleAccounts([
      curve,
      target,
      mint,
      quote,
      WRAPPED_SOL_MINT
    ]);
    const ca = targetRead.value[0], pa = targetRead.value[1];
    if (!ca || ca.owner !== PUMP_PROGRAM_ID || !pa || pa.owner !== PUMP_AMM_PROGRAM_ID)
      unavailable("GENERIC_CANONICAL_POOL_UNAVAILABLE");
    const c = decodePumpBondingCurve(Buffer.from(ca.data[0], "base64")), p = decodePumpSwapPool(Buffer.from(pa.data[0], "base64"));
    if (!c.complete || c.quoteMint !== quote || p.baseMint !== mint || p.quoteMint !== quote || p.index !== 0 || p.creator !== await pumpPoolAuthorityAddress(mint))
      unavailable("GENERIC_CANONICAL_LINKAGE");
    const tokenAccounts = {};
    [mint, quote, WRAPPED_SOL_MINT].forEach((a, i) => {
      const v = targetRead.value[i + 2];
      if (v) tokenAccounts[a] = { owner: v.owner, base64: v.data[0] };
    });
    const tokenSnapshot = {
      version: "NON_SOL_PUMPSWAP_STAGE1_V1",
      mint,
      quoteMint: quote,
      targetPool: target,
      bridgePool: "",
      slot: targetRead.context.slot,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      accounts: tokenAccounts,
      absentAccounts: []
    };
    for (const a of [mint, quote, WRAPPED_SOL_MINT]) validatePumpSwapMint(tokenSnapshot, a);
    const hints = [...new Set(await this.candidates.pools(quote))].sort().slice(0, 16);
    if (!hints.length) unavailable("GENERIC_SOL_BRIDGE_NOT_FOUND");
    const read = await this.rpc.getMultipleAccounts(hints), rejected = [], links = [];
    for (const [i, pool] of hints.entries()) {
      const a = read.value[i];
      if (!a || a.owner !== ORCA_WHIRLPOOL_PROGRAM) {
        rejected.push({ pool, reason: "GENERIC_BRIDGE_PROGRAM_UNSUPPORTED" });
        continue;
      }
      try {
        const link2 = orcaLink(pool, { owner: a.owner, base64: a.data[0] });
        if (![link2.mintA, link2.mintB].includes(quote) || ![link2.mintA, link2.mintB].includes(WRAPPED_SOL_MINT))
          unavailable("GENERIC_BRIDGE_ORIENTATION");
        links.push(link2);
      } catch (e) {
        rejected.push({ pool, reason: e instanceof Error ? e.message : "GENERIC_BRIDGE_INVALID" });
      }
    }
    const attempts = links.slice(0, 4), choices = [];
    const prepared = [];
    for (const bridge of attempts) {
      const addresses = [
        .../* @__PURE__ */ new Set([
          curve,
          target,
          mint,
          quote,
          WRAPPED_SOL_MINT,
          p.baseVault,
          p.quoteVault,
          bridge.pool,
          bridge.vaultA,
          bridge.vaultB,
          bridge.config,
          ...bridge.extraAccounts ?? [],
          await pumpSwapGlobalConfigAddress(),
          await pumpSwapFeeConfigAddress(),
          CLOCK5
        ])
      ];
      if (addresses.length > 100) unavailable("GENERIC_ATOMIC_BATCH_LIMIT");
      const candidate = {
        mint,
        quote,
        target,
        bridge,
        addresses,
        until: 0,
        reference: "0",
        recoveryPpb: "0"
      };
      prepared.push(candidate);
    }
    const snapshots = prepared.length ? await this.captureMany(prepared) : [];
    for (const [index2, candidate] of prepared.entries()) {
      const bridge = candidate.bridge;
      try {
        const snapshot2 = snapshots[index2];
        await this.engine.validate(snapshot2, {
          nowMs: Date.parse(snapshot2.observedAt),
          maxAgeMs: 1e4
        });
        for (const reference of references) {
          try {
            const policy = { nowMs: Date.parse(snapshot2.observedAt), maxAgeMs: 1e4 }, buy = await this.engine.quote(snapshot2, reference, true, policy), sell = await this.engine.quote(snapshot2, buy.output, false, policy);
            choices.push({
              ...candidate,
              reference: reference.toString(),
              recoveryPpb: (sell.output * 1000000000n / reference).toString()
            });
            break;
          } catch (e) {
            if (!(e instanceof ExecutionEngineError12) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
              throw e;
          }
        }
        if (!choices.some((t) => t.bridge.pool === bridge.pool))
          rejected.push({ pool: bridge.pool, reason: "GENERIC_REFERENCE_LIQUIDITY_UNAVAILABLE" });
      } catch (e) {
        if (e instanceof ExecutionEngineError12 && e.code === "RPC_UNAVAILABLE") throw e;
        rejected.push({
          pool: bridge.pool,
          reason: e instanceof Error ? e.message : "GENERIC_CAPTURE_INVALID"
        });
      }
    }
    if (this.diagnostics.size >= 256)
      this.diagnostics.delete(this.diagnostics.keys().next().value);
    this.diagnostics.set(this.key(mint, quote), rejected);
    choices.sort(
      (a, b) => compareGenericBridges(
        { reference: a.reference, recoveryPpb: a.recoveryPpb, pool: a.bridge.pool },
        { reference: b.reference, recoveryPpb: b.recoveryPpb, pool: b.bridge.pool }
      )
    );
    const selected = choices[0];
    if (!selected)
      unavailable(
        rejected.length ? "GENERIC_NO_VALIDATED_BRIDGE: " + rejected.map((r) => r.pool + "=" + r.reason).join("; ") : "GENERIC_SOL_BRIDGE_NOT_FOUND"
      );
    selected.until = Date.now() + 6e4;
    if (this.topology.size >= 256) this.topology.delete(this.topology.keys().next().value);
    this.topology.set(this.key(mint, quote), structuredClone(selected));
    return selected;
  }
  async captureMany(topologies) {
    const addresses = [...new Set(topologies.flatMap((t) => t.addresses))];
    if (addresses.length > 100) unavailable("GENERIC_ATOMIC_BATCH_LIMIT");
    const r = await this.rpc.getMultipleAccounts(addresses);
    if (r.value.length !== addresses.length || !Number.isSafeInteger(r.context.slot) || r.context.slot < 0)
      unavailable("GENERIC_CAPTURE_CARDINALITY_SLOT");
    const all = new Map(addresses.map((a, i) => [a, r.value[i]])), observedAt = (/* @__PURE__ */ new Date()).toISOString();
    return topologies.map((t) => {
      const accounts = {}, absentAccounts = [];
      t.addresses.forEach((a) => {
        const v = all.get(a);
        if (v) accounts[a] = { owner: v.owner, base64: v.data[0] };
        else absentAccounts.push(a);
      });
      return {
        version: "NON_SOL_PUMPSWAP_STAGE1_V1",
        mint: t.mint,
        quoteMint: t.quote,
        targetPool: t.target,
        bridgePool: t.bridge.pool,
        slot: r.context.slot,
        observedAt,
        accounts,
        absentAccounts
      };
    });
  }
  async capture(t) {
    const s = (await this.captureMany([t]))[0];
    await this.engine.validate(s, { nowMs: Date.parse(s.observedAt), maxAgeMs: 1e4 });
    return s;
  }
  async loadMarketState(identity) {
    const parts = identity.marketId.split(":");
    if (identity.protocolId !== GENERIC_PUMP_SWAP_PROTOCOL_ID || parts.length !== 4 || parts[1] !== identity.tokenMint)
      unavailable("GENERIC_EXECUTION_IDENTITY");
    const quote = parts[2], bridge = parts[3], key2 = this.key(identity.tokenMint, quote);
    let t = this.pinned.get(identity.marketId) ?? this.topology.get(key2);
    if (!t || t.until <= Date.now()) {
      if (t?.pinned) await this.resolvePinned(identity.tokenMint, quote, bridge);
      else await this.resolve(identity.tokenMint, quote);
      t = this.pinned.get(identity.marketId) ?? this.topology.get(key2);
    }
    if (!t || t.bridge.pool !== bridge) unavailable("GENERIC_PINNED_ROUTE_CHANGED");
    try {
      const snapshot2 = await this.capture(t), policy = { nowMs: Date.parse(snapshot2.observedAt), maxAgeMs: 1e4 };
      const link2 = orcaLink(snapshot2.bridgePool, snapshot2.accounts[snapshot2.bridgePool]);
      assertOrcaSnapshot(link2, snapshot2.accounts, snapshot2.absentAccounts);
      for (const reference of t.pinned ? [] : references) {
        try {
          const buy = await this.engine.quote(snapshot2, reference, true, policy);
          await this.engine.quote(snapshot2, buy.output, false, policy);
          break;
        } catch (e) {
          if (!(e instanceof ExecutionEngineError12) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code))
            throw e;
        }
      }
      const state = await pumpSwapStateFromSnapshot(
        identity,
        snapshot2,
        this.engine,
        GENERIC_PUMP_SWAP_VERSION,
        NORMALIZATION
      );
      return {
        ...state,
        normalizedState: {
          ...state.normalizedState,
          routePolicy: "GENERIC_FIXED_ORCA_V1",
          referenceInput: t.reference,
          referenceRecoveryPpb: t.recoveryPpb
        }
      };
    } catch (e) {
      this.topology.delete(key2);
      this.pinned.delete(identity.marketId);
      throw e;
    }
  }
};
function assertGenericBinding(s) {
  assertGenericQuoteMechanics(s.quoteMint);
  const target = s.accounts[s.targetPool], bridge = s.accounts[s.bridgePool];
  if (!target || target.owner !== PUMP_AMM_PROGRAM_ID || !bridge || bridge.owner !== ORCA_WHIRLPOOL_PROGRAM)
    unavailable("GENERIC_SNAPSHOT_PROGRAM");
  const p = decodePumpSwapPool(Buffer.from(target.base64, "base64")), b = orcaLink(s.bridgePool, bridge);
  if (p.baseMint !== s.mint || p.quoteMint !== s.quoteMint || ![b.mintA, b.mintB].includes(s.quoteMint) || ![b.mintA, b.mintB].includes(WRAPPED_SOL_MINT))
    unavailable("GENERIC_SNAPSHOT_BINDING");
}
var GenericPumpSwapAdapter = class extends NonSolPumpSwapAdapter {
  constructor(source, buysEnabled = true, permissionProvider) {
    super(source, {
      protocolId: GENERIC_PUMP_SWAP_PROTOCOL_ID,
      adapterVersion: GENERIC_PUMP_SWAP_VERSION,
      normalizationVersion: NORMALIZATION,
      identity: genericPumpSwapIdentity,
      assertBinding: assertGenericBinding,
      buysEnabled: typeof buysEnabled === "boolean" ? buysEnabled : false
    });
    this.buysEnabled = buysEnabled;
    this.permissionProvider = permissionProvider;
  }
  buysEnabled;
  permissionProvider;
  live = /* @__PURE__ */ new WeakMap();
  async loadMarketState(identity) {
    const state = await this.source.loadMarketState(identity);
    const current2 = {
      ...state,
      normalizedState: {
        ...state.normalizedState,
        genericBuyAdmissionAllowed: typeof this.buysEnabled === "function" ? this.buysEnabled() : this.buysEnabled
      }
    };
    const permission = this.permissionProvider?.();
    if (permission) this.live.set(current2, permission);
    return current2;
  }
  async simulateBuy(r, s) {
    await this.live.get(s)?.authorizeLive?.("BUY");
    return super.simulateBuy(r, s);
  }
  async simulateSell(r, s) {
    await this.live.get(s)?.authorizeLive?.("SELL");
    return super.simulateSell(r, s);
  }
};

// packages/db/isolated/linked-pair/store.ts
var VERSION = "linked-native-atomic-v1";
var NORMALIZATION2 = "linked-native-atomic-state-v1";
function reject4(message) {
  throw new ExecutionEngineError13("MARKET_STATE_UNAVAILABLE", message);
}
var executionHash = (e) => digest({ ...e, executionDetails: { hops: e.executionDetails?.["hops"] ?? null } });
function routeForIdentity(snapshot2, identity) {
  const binding = linkedBindings(snapshot2).find(
    (r) => digest(genericPumpSwapIdentity(r.mint, r.quoteMint, r.bridgePool)) === digest(identity)
  );
  if (!binding) reject4("LINKED_ROUTE_NOT_ADMITTED");
  return linkedRoute(snapshot2, binding.mint, binding.bridgePool);
}
function identityForMint(snapshot2, mint) {
  const route = linkedRoute(snapshot2, mint);
  return genericPumpSwapIdentity(route.mint, route.quoteMint, route.bridgePool);
}
var LinkedStateStore = class {
  constructor(db, accountId, roundId, durableFlow = false, proofRecovery = false) {
    this.db = db;
    this.accountId = accountId;
    this.roundId = roundId;
    this.durableFlow = durableFlow;
    this.proofRecovery = proofRecovery;
  }
  db;
  accountId;
  roundId;
  durableFlow;
  proofRecovery;
  prepareRecovery(interval) {
    return prepareRecovery(this, interval);
  }
  async activateRecovery(interval, proof, approval, nowMs) {
    if (!this.proofRecovery) reject4("LINKED_RECOVERY_NOT_ENABLED");
    const prior = (await this.db.pool.query(
      "select proof_hash,approval_hash,sequence from linked_recovery_candidate.resolutions where account_id=$1 and generation=$2",
      [this.accountId, proof.generation]
    )).rows[0];
    if (prior) {
      if (prior.proof_hash !== digest(proof) || prior.approval_hash !== digest(approval))
        reject4("LINKED_RECOVERY_CONFLICT");
      await this.assertAvailable();
      return { advanced: false, sequence: String(prior.sequence) };
    }
    const activation = { proof, approval, nowMs };
    validateApproval(activation, this);
    const prepared = await this.prepareRecovery(interval);
    if (prepared.proofHash !== digest(proof)) reject4("LINKED_RECOVERY_PROOF_CHANGED");
    return advanceFlow(this, interval, activation);
  }
  advanceFlow(interval) {
    if (!this.durableFlow) reject4("LINKED_FLOW_NOT_ENABLED");
    return advanceFlow(this, interval);
  }
  async assertAvailable(client) {
    const row = (await (client ?? this.db.pool).query(
      "select s.quarantined,q.reason from linked_candidate.route_status s left join linked_candidate.route_quarantine q using(account_id) where s.account_id=$1",
      [this.accountId]
    )).rows[0];
    if (!row || row.quarantined && !row.reason) reject4("LINKED_QUARANTINE_SCOPE_MISSING");
    if (row.reason) {
      if (!this.proofRecovery) reject4("LINKED_ROUTE_QUARANTINED:" + row.reason);
      const c = client ?? await this.db.pool.connect();
      try {
        await assertRecovered(c, this);
      } finally {
        if (!client) c.release();
      }
    }
  }
  async quarantine(interval, error) {
    const reason = error instanceof Error ? error.message : "UNRECONCILABLE_FLOW";
    const client = await this.db.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        "linked-account:" + this.accountId
      ]);
      const updated = await client.query(
        "update linked_candidate.route_status set quarantined=true where account_id=$1",
        [this.accountId]
      );
      if (updated.rowCount !== 1) reject4("LINKED_QUARANTINE_SCOPE_MISSING");
      await client.query(
        "insert into linked_candidate.route_quarantine(account_id,interval_hash,reason,document) values($1,$2,$3,$4::jsonb) on conflict do nothing",
        [this.accountId, digest(interval), reason, JSON.stringify(interval)]
      );
      if (this.proofRecovery) await recordIncident(client, this.accountId, interval, reason);
      await client.query("commit");
    } catch (error2) {
      await client.query("rollback");
      throw error2;
    } finally {
      client.release();
    }
  }
  async cutoff(client) {
    const row = (await (client ?? this.db.pool).query(
      "select hash,document from linked_candidate.cutoff_seals where account_id=$1",
      [this.accountId]
    )).rows[0];
    if (!row) return null;
    if (row.document.accountId !== this.accountId || row.document.roundId !== this.roundId || digest(row.document) !== row.hash)
      reject4("LINKED_CUTOFF_SEAL_CORRUPT");
    return row;
  }
  async sealCutoff(frontier, cutoff) {
    frontier = structuredClone(frontier);
    const c = await this.db.pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        "linked-account:" + this.accountId
      ]);
      const r = (await c.query(
        "select state,ends_at_exclusive from hourly_rounds where id=$1 for share",
        [this.roundId]
      )).rows[0];
      if (!r || r.state !== "SETTLING" || r.ends_at_exclusive.getTime() !== cutoff.getTime())
        reject4("LINKED_CUTOFF_ROUND_MISMATCH");
      const old = await this.cutoff(c);
      if (old) {
        if (old.document.cutoff !== cutoff.toISOString()) reject4("LINKED_CUTOFF_RESEAL");
        await c.query("commit");
        return old;
      }
      const head = await this.load(c), branch = await reconcileCutoff(head.document, frontier, cutoff.toISOString());
      const document = {
        version: "LINKED_CUTOFF_SEAL_V1",
        accountId: this.accountId,
        roundId: this.roundId,
        cutoff: cutoff.toISOString(),
        revision: head.revision,
        beforeHash: head.state_hash,
        branch,
        frontier
      };
      const hash2 = digest(document);
      await c.query("insert into linked_candidate.cutoff_seals values($1,$2,$3,$4::jsonb)", [
        this.accountId,
        this.roundId,
        hash2,
        JSON.stringify(document)
      ]);
      await c.query("commit");
      return { hash: hash2, document };
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  async sealedBranch(head, seal) {
    if (head.revision === seal.document.revision) {
      if (head.state_hash !== seal.document.beforeHash) reject4("LINKED_CUTOFF_PREDECESSOR_CHANGED");
      return structuredClone(seal.document.branch);
    }
    if (BigInt(head.revision) < BigInt(seal.document.revision))
      reject4("LINKED_CUTOFF_REVISION_REGRESSED");
    const rows = (await this.db.pool.query(
      "select document from linked_candidate.receipts where account_id=$1 and revision>$2 order by revision",
      [this.accountId, seal.document.revision]
    )).rows;
    if (BigInt(rows.length) !== BigInt(head.revision) - BigInt(seal.document.revision) || rows.some((r) => r.document.cutoffSealHash !== seal.hash) || digest(head.document.real) !== digest(seal.document.branch.real))
      reject4("LINKED_CUTOFF_CONTINUITY_UNPROVEN");
    return head.document;
  }
  async initialize(snapshot2) {
    for (const binding of linkedBindings(snapshot2)) {
      const route = linkedRoute(snapshot2, binding.mint, binding.bridgePool);
      await new LinkedEngine({
        purpose: "READ_ONLY_STAGE1_VALIDATION",
        bridgeBinding: { quoteMint: route.quoteMint, pool: route.bridgePool }
      }).validate(route, { nowMs: Date.parse(route.observedAt), maxAgeMs: 1e4 });
    }
    const c = await this.db.pool.connect();
    try {
      await c.query("begin");
      const a = (await c.query("select hourly_round_id from competition_accounts where id=$1 for update", [
        this.accountId
      ])).rows[0];
      if (a?.hourly_round_id !== this.roundId) reject4("LINKED_ACCOUNT_ROUND_MISMATCH");
      if ((await c.query(
        "select 1 from fills f join orders o on o.id=f.order_id where o.competition_account_id=$1 limit 1",
        [this.accountId]
      )).rows.length)
        reject4("LINKED_FRESH_ACCOUNT_REQUIRED");
      const branch = newLinkedBranch(this.accountId, this.roundId, snapshot2), h = digest(branch);
      const old = (await c.query("select * from linked_candidate.branches where account_id=$1", [
        this.accountId
      ])).rows[0];
      if (old && old.initial_hash !== h) reject4("LINKED_INITIALIZATION_CONFLICT");
      await c.query(
        "insert into linked_candidate.branches values($1,$2,0,$3::jsonb,$4,$3::jsonb,$4) on conflict do nothing",
        [this.accountId, this.roundId, JSON.stringify(branch), h]
      );
      await c.query(
        "insert into linked_candidate.route_status(account_id) values($1) on conflict do nothing",
        [this.accountId]
      );
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  async load(client) {
    const c = client ?? await this.db.pool.connect();
    try {
      const row = (await c.query(
        "select * from linked_candidate.branches where account_id=$1" + (client ? " for update" : ""),
        [this.accountId]
      )).rows[0];
      if (!row) reject4("LINKED_STATE_MISSING_NO_RESET");
      if (row.round_id !== this.roundId || row.document.accountId !== this.accountId || row.document.roundId !== this.roundId || row.document.version !== "LINKED_BRANCH_V1" || digest(row.document) !== row.state_hash || digest(row.initial_document) !== row.initial_hash)
        reject4("LINKED_STATE_CORRUPT");
      const receipts = (await c.query(
        "select revision,before_hash,after_hash from linked_candidate.receipts where account_id=$1 order by revision",
        [this.accountId]
      )).rows;
      let h = row.initial_hash, n3 = 0n;
      for (const r of receipts) {
        if (BigInt(r.revision) !== ++n3 || r.before_hash !== h)
          reject4("LINKED_RECEIPT_CHAIN_CORRUPT");
        h = r.after_hash;
      }
      if (n3 !== BigInt(row.revision) || h !== row.state_hash)
        reject4("LINKED_HEAD_RECEIPT_MISMATCH");
      return this.durableFlow ? flowHead(c, this.accountId, structuredClone(row)) : structuredClone(row);
    } finally {
      if (!client) c.release();
    }
  }
  /** Independent replay from retained initial state/evidence/fills; missing/corrupt history cannot reset it. */
  async recover(verifyRecoveryEligibility = true) {
    const c = await this.db.pool.connect();
    try {
      await c.query("begin isolation level repeatable read read only");
      const head = await this.loadReadOnly(c);
      let branch = head.initial_document;
      const seal = await this.cutoff(c);
      let sealValidated = false;
      const events = (await c.query(
        "select revision,document,interval_hash,after_hash from linked_candidate.receipts where account_id=$1 order by revision",
        [this.accountId]
      )).rows;
      for (const r of events) {
        if (this.durableFlow) {
          branch = await replayFlows(
            c,
            this.accountId,
            (BigInt(r.revision) - 1n).toString(),
            branch,
            r.document.flowSequence ?? "0"
          );
          if (r.document.flowStateHash && digest(branch) !== r.document.flowStateHash)
            reject4("LINKED_FLOW_FILL_PREDECESSOR");
        }
        if (seal && !sealValidated && BigInt(r.revision) === BigInt(seal.document.revision) + 1n) {
          if (digest(branch) !== seal.document.beforeHash)
            reject4("LINKED_CUTOFF_RESTART_PREDECESSOR");
          const reconciled = await reconcileCutoff(
            branch,
            seal.document.frontier,
            seal.document.cutoff
          );
          if (digest(reconciled) !== digest(seal.document.branch))
            reject4("LINKED_CUTOFF_RESTART_BRANCH");
          sealValidated = true;
        }
        if (r.interval_hash) {
          const raw = (await c.query(
            "select document from linked_candidate.provider_evidence where hash=$1",
            [r.interval_hash]
          )).rows[0]?.document;
          if (!raw || digest(raw) !== r.interval_hash) reject4("LINKED_PROVIDER_EVIDENCE_CORRUPT");
          branch = (await reconcileLinkedInterval(
            branch,
            raw,
            r.document.replayAt ?? Date.parse(r.document.at),
            1e4
          )).branch;
        }
        const step = await transitionLinkedSnapshot(
          linkedRoute(
            branch.simulated,
            r.document.routeMint ?? branch.simulated.mint,
            r.document.routeBridgePool
          ),
          BigInt(r.document.input),
          r.document.side === "BUY",
          { nowMs: r.document.replayAt ?? Date.parse(r.document.at), maxAgeMs: 1e4 }
        );
        if (step.quote.output.toString() !== r.document.output)
          reject4("LINKED_OUTPUT_REPLAY_MISMATCH");
        branch = { ...branch, simulated: carryLinkedRoot(branch.simulated, step.next) };
        if (digest(branch) !== r.after_hash) reject4("LINKED_SUCCESSOR_REPLAY_MISMATCH");
      }
      const effective = this.durableFlow ? await flowHead(c, this.accountId, head) : head;
      if (this.durableFlow)
        branch = await replayFlows(
          c,
          this.accountId,
          head.revision,
          branch,
          effective.flow_sequence ?? "0"
        );
      if (seal && !sealValidated) {
        if (head.revision !== seal.document.revision || digest(branch) !== seal.document.beforeHash)
          reject4("LINKED_CUTOFF_RESTART_PREDECESSOR");
        const reconciled = await reconcileCutoff(
          branch,
          seal.document.frontier,
          seal.document.cutoff
        );
        if (digest(reconciled) !== digest(seal.document.branch))
          reject4("LINKED_CUTOFF_RESTART_BRANCH");
      }
      if (digest(branch) !== effective.state_hash) reject4("LINKED_RESTART_HEAD_MISMATCH");
      if (this.proofRecovery && verifyRecoveryEligibility) await assertRecovered(c, this);
      await c.query("commit");
      return branch;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  async loadReadOnly(c) {
    const row = (await c.query("select * from linked_candidate.branches where account_id=$1", [
      this.accountId
    ])).rows[0];
    if (!row || row.round_id !== this.roundId || digest(row.document) !== row.state_hash || digest(row.initial_document) !== row.initial_hash)
      reject4("LINKED_STATE_CORRUPT");
    return row;
  }
  async commit(client, input, pending, nowMs) {
    if (input.accountId !== this.accountId || input.roundId !== this.roundId)
      reject4("LINKED_SCOPE_OR_CUTOFF_UNSUPPORTED");
    const status = (await client.query(
      "select quarantined from linked_candidate.route_status where account_id=$1 for update",
      [this.accountId]
    )).rows[0];
    if (!status) reject4("LINKED_ROUTE_QUARANTINED");
    if (status.quarantined) {
      if (!this.proofRecovery) reject4("LINKED_ROUTE_QUARANTINED");
      await this.assertAvailable(client);
    }
    const seal = await this.cutoff(client);
    if (input.executionContext === "FORCED_HOURLY_SETTLEMENT") {
      if (!seal || pending.cutoff?.hash !== seal.hash || pending.side !== "SELL" || input.execution.executedAt !== seal.document.cutoff)
        reject4("LINKED_FORCED_SEAL_REQUIRED");
    } else if (seal || pending.cutoff) reject4("LINKED_CUTOFF_NORMAL_FILL_FORBIDDEN");
    const age = (pending.cutoff ? Date.parse(pending.branch.real.observedAt) : nowMs) - Date.parse(pending.branch.real.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > 1e4) reject4("LINKED_COMMIT_CHECKPOINT_STALE");
    if (executionHash(input.execution) !== pending.executionHash)
      reject4("LINKED_EXECUTION_CHANGED");
    const head = await this.load(client);
    if (head.revision !== pending.head.revision || head.state_hash !== pending.head.state_hash)
      reject4("LINKED_PREDECESSOR_CHANGED_RETRY");
    const fill = (await client.query(
      "select f.execution_id,f.side,f.base_quantity::text,f.actual_input_lamports::text,f.actual_output_lamports::text,o.competition_account_id from fills f join orders o on o.id=f.order_id where f.id=$1",
      [input.fillId]
    )).rows[0];
    if (!fill || fill.execution_id !== input.execution.id || fill.competition_account_id !== this.accountId || fill.side !== pending.side || (pending.side === "BUY" ? fill.actual_input_lamports !== pending.input || fill.base_quantity !== pending.output : fill.base_quantity !== pending.input || fill.actual_output_lamports !== pending.output))
      reject4("LINKED_FILL_BINDING_MISMATCH");
    await pending.permission.authorizeLive?.(pending.side);
    const nextHash = digest(pending.next), rev = BigInt(head.revision) + 1n, intervalHash = pending.interval ? digest(pending.interval) : null;
    if (pending.interval) {
      await client.query(
        "insert into linked_candidate.provider_evidence values($1,$2::jsonb) on conflict do nothing",
        [intervalHash, JSON.stringify(pending.interval)]
      );
      const stored = (await client.query(
        "select document from linked_candidate.provider_evidence where hash=$1",
        [intervalHash]
      )).rows[0];
      if (!stored || digest(stored.document) !== intervalHash)
        reject4("LINKED_PROVIDER_HASH_CONFLICT");
    }
    const receipt = {
      ...this.durableFlow ? { flowSequence: head.flow_sequence ?? "0", flowStateHash: head.state_hash } : {},
      input: pending.input,
      output: pending.output,
      side: pending.side,
      at: pending.at,
      routeMint: pending.routeMint,
      ...pending.routeBridgePool ? { routeBridgePool: pending.routeBridgePool } : {},
      executionHash: pending.executionHash,
      branch: pending.branch,
      ...pending.cutoff ? {
        cutoffSealHash: pending.cutoff.hash,
        replayAt: Date.parse(pending.branch.simulated.observedAt)
      } : {}
    };
    await client.query(
      "insert into linked_candidate.receipts values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [
        this.accountId,
        rev.toString(),
        input.fillId,
        input.execution.id,
        head.base_state_hash ?? head.state_hash,
        nextHash,
        intervalHash,
        JSON.stringify(receipt)
      ]
    );
    await client.query(
      "update linked_candidate.branches set revision=$2,document=$3::jsonb,state_hash=$4 where account_id=$1",
      [this.accountId, rev.toString(), JSON.stringify(pending.next), nextHash]
    );
  }
};
function linkedCandidateRuntime(base, store, options) {
  if (base.preparePersistedSettlementStep || base.commitPersistedSettlementStep)
    reject4("LINKED_EXISTING_SETTLEMENT_PARTICIPANT");
  const cursors = /* @__PURE__ */ new WeakMap(), pending = /* @__PURE__ */ new Map();
  const native = (s) => new LinkedEngine({
    purpose: "READ_ONLY_STAGE1_VALIDATION",
    bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool }
  });
  const source = {
    engine: {
      quote: (s, q, b, p) => native(s).quote(s, q, b, p),
      exits: (s, q, p) => native(s).exits(s, q, p)
    },
    async loadMarketState(identity) {
      await store.assertAvailable();
      const head = await store.load(), seal = await store.cutoff(), rawInterval = seal ? head.revision === seal.document.revision ? seal.document.frontier.interval : null : await options.interval(head.document.real), interval = rawInterval ? copyProviderInterval(rawInterval) : null, permission = await options.permission(identity);
      if (!permission.discover && !permission.exitBinding) reject4("LINKED_AUTHORIZATION_REQUIRED");
      if (typeof permission.authorizeLive !== "function")
        reject4("LINKED_LIVE_AUTHORIZATION_REQUIRED");
      if (permission.exitBinding && (permission.exitBinding.targetPool !== routeForIdentity(head.document.real, identity).targetPool || permission.exitBinding.quoteMint !== routeForIdentity(head.document.real, identity).quoteMint || permission.exitBinding.bridgePool !== routeForIdentity(head.document.real, identity).bridgePool))
        reject4("LINKED_EXIT_BINDING_CHANGED");
      const branch = seal ? await store.sealedBranch(head, seal) : interval ? (await (async () => {
        try {
          return await reconcileLinkedInterval(
            head.document,
            interval,
            options.now(),
            1e4
          );
        } catch (error) {
          await store.quarantine(interval, error);
          throw error;
        }
      })()).branch : head.document;
      const s = routeForIdentity(branch.simulated, identity), expected = genericPumpSwapIdentity(s.mint, s.quoteMint, s.bridgePool);
      if (digest(identity) !== digest(expected)) reject4("LINKED_ROUTE_IDENTITY_CHANGED");
      if (!seal && (options.now() - Date.parse(branch.real.observedAt) > 1e4 || options.now() < Date.parse(branch.real.observedAt)))
        reject4("LINKED_FRESHNESS_UNAVAILABLE");
      await native(s).validate(s, {
        nowMs: seal ? Date.parse(s.observedAt) : options.now(),
        maxAgeMs: 1e4
      });
      const state = await linkedState(identity, s, native(s), VERSION, NORMALIZATION2);
      const result = {
        ...state,
        normalizedState: {
          ...state.normalizedState,
          genericBuyAdmissionAllowed: !seal && permission.buy,
          linkedAccountId: store.accountId,
          linkedRoundId: store.roundId,
          linkedRevision: head.revision,
          linkedBranchHash: head.state_hash,
          ...seal ? { linkedCutoffSealHash: seal.hash } : {}
        }
      };
      cursors.set(result, {
        head,
        branch,
        interval,
        permission,
        ...seal ? { cutoff: { hash: seal.hash, cutoff: seal.document.cutoff } } : {}
      });
      return result;
    }
  };
  class Adapter extends LinkedPoolAdapter {
    constructor() {
      super(source, {
        protocolId: identifier8("GENERIC_PUMP_SWAP", "ProtocolId"),
        adapterVersion: VERSION,
        normalizationVersion: NORMALIZATION2,
        identity: genericPumpSwapIdentity,
        assertBinding: () => void 0,
        buysEnabled: false
      });
    }
    async track(r, s, buy, result) {
      const cursor = cursors.get(s);
      if (!cursor) return result;
      await cursor.permission.authorizeLive?.(buy ? "BUY" : "SELL");
      const amount = buy ? r.requestedPaperSol : r.requestedTokenQuantity;
      const step = await transitionLinkedSnapshot(
        routeForIdentity(cursor.branch.simulated, r.identity),
        amount,
        buy,
        {
          nowMs: cursor.cutoff ? Date.parse(cursor.branch.simulated.observedAt) : options.now(),
          maxAgeMs: 1e4
        }
      );
      if (step.quote.output !== result.actualOutput.amount || step.quote.input !== result.actualInput.amount)
        reject4("LINKED_NATIVE_FILL_MISMATCH");
      for (const [key2, p] of pending) if (p.expires < Date.now()) pending.delete(key2);
      if (pending.size >= 128) reject4("LINKED_PENDING_CAPACITY");
      const token2 = randomUUID();
      pending.set(token2, {
        expires: Date.now() + 3e4,
        ...cursor,
        next: { ...cursor.branch, simulated: carryLinkedRoot(cursor.branch.simulated, step.next) },
        executionHash: executionHash(result),
        input: amount.toString(),
        output: step.quote.output.toString(),
        side: buy ? "BUY" : "SELL",
        at: r.executedAt,
        routeMint: r.identity.tokenMint,
        routeBridgePool: routeForIdentity(cursor.branch.simulated, r.identity).bridgePool
      });
      return {
        ...result,
        executionDetails: { ...result.executionDetails, linkedCommitToken: token2 }
      };
    }
    async valuePositionForExit(r, s) {
      await transitionLinkedSnapshot(
        s.normalizedState["stage1Snapshot"],
        r.tokenQuantity,
        false,
        { nowMs: Date.parse(s.observedAt), maxAgeMs: 1e4 }
      );
      return super.valuePositionForExit(r, s);
    }
    async simulateBuy(r, s) {
      return this.track(r, s, true, await super.simulateBuy(r, s));
    }
    async simulateSell(r, s) {
      return this.track(r, s, false, await super.simulateSell(r, s));
    }
  }
  const plans = /* @__PURE__ */ new Map();
  async function planSettlementStep(input, amount = input.quantity) {
    if (input.accountId !== store.accountId || input.roundId !== store.roundId || amount <= 0n || amount > input.quantity)
      reject4("LINKED_SETTLEMENT_SCOPE");
    const seal = await store.cutoff();
    if (!seal) reject4("LINKED_FORCED_SEAL_REQUIRED");
    const position = (await store.db.pool.query(
      "select p.remaining_base_units,p.cost_basis_lamports,p.status,p.market_id,a.mint_address from positions p join assets a on a.id=p.asset_id where p.id=$1 and p.competition_account_id=$2",
      [input.positionId, store.accountId]
    )).rows[0];
    if (!position || position.status !== "OPEN" || BigInt(position.remaining_base_units) !== input.quantity || BigInt(position.cost_basis_lamports) !== input.basis || position.market_id !== input.identity.marketId || position.mint_address !== input.identity.tokenMint)
      reject4("LINKED_SETTLEMENT_POSITION_CHANGED");
    if ((await store.db.pool.query(
      "select 1 from legacy_source_reviews where hourly_round_id=$1 limit 1",
      [store.roundId]
    )).rows.length)
      reject4("LINKED_EXISTING_REVIEW_REQUIRES_OPERATOR");
    const unproven = await store.db.pool.query(
      "select 1 from fills f join orders o on o.id=f.order_id join order_market_state_evidence e on e.order_id=o.id and e.purpose='SELL_EXECUTION' left join linked_candidate.settlement_steps s on s.fill_id=f.id where e.position_id=$1 and o.execution_context='FORCED_HOURLY_SETTLEMENT' and s.fill_id is null limit 1",
      [input.positionId]
    );
    if (unproven.rows.length) reject4("LINKED_UNPROVEN_PRIOR_FORCED_FILL");
    const selectedIdentity = options.selectRoute ? await options.selectRoute(
      input.identity.tokenMint,
      (await store.sealedBranch(await store.load(), seal)).simulated
    ) : identityForMint(seal.document.branch.real, input.identity.tokenMint);
    const root = routeForIdentity(seal.document.branch.real, selectedIdentity), state = await source.loadMarketState(
      genericPumpSwapIdentity(root.mint, root.quoteMint, root.bridgePool)
    ), cursor = cursors.get(state);
    if (!cursor.cutoff) reject4("LINKED_FORCED_SEAL_REQUIRED");
    const quote = await supportedLinkedExit(
      routeForIdentity(cursor.branch.simulated, state.identity),
      amount
    ), evidence = createMarketStateEvidence6(state);
    const idempotencyKey2 = "linked-forced-v1:" + digest({
      account: store.accountId,
      round: store.roundId,
      position: input.positionId,
      seal: seal.hash,
      revision: cursor.head.revision,
      beforeHash: cursor.head.state_hash,
      quantityBefore: input.quantity,
      quantity: quote.quantity
    });
    const plan = { quantity: quote.quantity, output: quote.output, evidence, idempotencyKey: idempotencyKey2 };
    for (const [key2, p] of plans) if (p.expires < Date.now()) plans.delete(key2);
    if (quote.quantity > 0n) {
      if (plans.size >= 128 && !plans.has(idempotencyKey2)) reject4("LINKED_PENDING_CAPACITY");
      plans.set(idempotencyKey2, {
        request: structuredClone(input),
        plan,
        expires: Date.now() + 3e4
      });
    }
    return plan;
  }
  const database = {
    ...base,
    async valueMarketPortfolio(positions2) {
      const values = [];
      let shadow = null, revision = null, anchor = null;
      for (const position of [...positions2].sort(
        (a, b) => a.positionId.localeCompare(b.positionId)
      )) {
        const chosen = options.selectRoute ? await options.selectRoute(
          position.identity.tokenMint,
          (await store.load()).document.simulated
        ) : identityForMint((await store.load()).document.simulated, position.identity.tokenMint);
        const loaded = await source.loadMarketState(chosen), cursor = cursors.get(loaded);
        if (revision !== null && (revision !== cursor.head.revision || anchor !== digest(cursor.branch)))
          reject4("LINKED_PORTFOLIO_REVISION_CHANGED");
        revision = cursor.head.revision;
        anchor = digest(cursor.branch);
        shadow ??= structuredClone(cursor.branch.simulated);
        const selected = routeForIdentity(shadow, chosen), quote = await supportedLinkedExit(selected, position.quantity);
        const state = await linkedState(
          chosen,
          selected,
          native(selected),
          VERSION,
          NORMALIZATION2
        );
        const evidence = createMarketStateEvidence6({
          ...state,
          normalizedState: {
            ...state.normalizedState,
            linkedRevision: revision,
            linkedBranchHash: cursor.head.state_hash,
            linkedPortfolioPredecessor: digest(shadow)
          }
        });
        values.push({ positionId: position.positionId, value: quote.output, evidence });
        if (quote.quantity > 0n) {
          const step = await transitionLinkedSnapshot(selected, quote.quantity, false, {
            nowMs: Date.parse(selected.observedAt),
            maxAgeMs: 1e4
          });
          if (step.quote.output !== quote.output) reject4("LINKED_PORTFOLIO_QUOTE_DISAGREEMENT");
          shadow = carryLinkedRoot(shadow, step.next);
        }
      }
      return positions2.map((p) => values.find((v) => v.positionId === p.positionId));
    },
    preparePersistedSettlementStep: (input) => planSettlementStep(input),
    async commitPersistedSettlementStep(client, input) {
      const held = plans.get(input.idempotencyKey);
      if (!held || held.expires < Date.now()) reject4("LINKED_SETTLEMENT_PLAN_MISSING");
      const { request, plan } = held;
      if (input.accountId !== store.accountId || input.roundId !== store.roundId || input.positionId !== request.positionId || input.quantityBefore !== request.quantity || input.basisBefore !== request.basis || input.execution.actualInput.amount !== plan.quantity || input.execution.actualOutput.amount !== plan.output || input.evidence.fingerprint !== plan.evidence.fingerprint)
        reject4("LINKED_SETTLEMENT_PLAN_CHANGED");
      const revision = (BigInt(String(plan.evidence.normalizedState["linkedRevision"])) + 1n).toString(), head = await store.load(client);
      const receipt = (await client.query(
        "select fill_id,after_hash from linked_candidate.receipts where account_id=$1 and revision=$2",
        [store.accountId, revision]
      )).rows[0];
      if (head.revision !== revision || receipt?.fill_id !== input.fillId || receipt.after_hash !== head.state_hash)
        reject4("LINKED_FORCED_RECEIPT_REQUIRED");
      const fill = (await client.query(
        "select fee_lamports,market_state_evidence_id from fills where id=$1",
        [input.fillId]
      )).rows[0];
      if (!fill) reject4("LINKED_FILL_BINDING_MISMATCH");
      await client.query(
        "insert into linked_candidate.settlement_steps values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          input.fillId,
          store.accountId,
          input.positionId,
          revision,
          String(plan.evidence.normalizedState["linkedCutoffSealHash"]),
          input.quantityBefore.toString(),
          input.basisBefore.toString(),
          plan.quantity.toString(),
          plan.output.toString(),
          fill.fee_lamports,
          fill.market_state_evidence_id,
          input.idempotencyKey
        ]
      );
      plans.delete(input.idempotencyKey);
    },
    async prepareMarketSettlement(roundId, cutoff) {
      await base.prepareMarketSettlement?.(roundId, cutoff);
      if (roundId !== store.roundId) reject4("LINKED_CUTOFF_ROUND_SCOPE");
      if (await store.cutoff()) return;
      if (!(await store.db.pool.query(
        "select 1 from positions where competition_account_id=$1 and status='OPEN' limit 1",
        [store.accountId]
      )).rows.length)
        return;
      if (!options.cutoffFrontier) reject4("LINKED_CUTOFF_FRONTIER_REQUIRED");
      const head = await store.load();
      await store.assertAvailable();
      const frontier = structuredClone(await options.cutoffFrontier(head.document.real, cutoff));
      try {
        await store.sealCutoff(frontier, cutoff);
      } catch (error) {
        if (frontier.interval) await store.quarantine(frontier.interval, error);
        throw error;
      }
    },
    async bindMarketSettlementEvidence(accountId, evidence) {
      await base.bindMarketSettlementEvidence?.(accountId, evidence);
      if (accountId !== store.accountId) reject4("LINKED_ACCOUNT_SCOPE_MISMATCH");
      const state = await source.loadMarketState(evidence.identity), cursor = cursors.get(state);
      if (!cursor.cutoff || createMarketStateEvidence6(state).fingerprint !== createMarketStateEvidence6(evidence).fingerprint || createMarketStateEvidence6(evidence).fingerprint !== evidence.fingerprint)
        reject4("LINKED_STALE_CUTOFF_EVIDENCE");
      cursors.set(evidence, cursor);
    },
    async lockMarketExecution(c, accountId) {
      if (accountId !== store.accountId) reject4("LINKED_ACCOUNT_SCOPE_MISMATCH");
      await base.lockMarketExecution?.(c, accountId);
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        "linked-account:" + accountId
      ]);
    },
    async commitMarketExecution(c, input) {
      await base.commitMarketExecution?.(c, input);
      const p = pending.get(String(input.execution.executionDetails?.["linkedCommitToken"]));
      if (!p || p.expires < Date.now()) reject4("LINKED_PENDING_EXECUTION_MISSING");
      try {
        await store.commit(c, input, p, options.now());
      } finally {
        pending.delete(String(input.execution.executionDetails?.["linkedCommitToken"]));
      }
    }
  };
  return { database, adapter: new Adapter(), planSettlementStep };
}

// packages/protocols/src/generic-access-context.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
var DENY_GENERIC = Object.freeze({ discover: false, buy: false });
var actorKey = /* @__PURE__ */ Symbol.for("paperfund.generic.actor.v1");
var operationKey = /* @__PURE__ */ Symbol.for("paperfund.generic.operation.v1");
var globals = globalThis;
var actors = globals[actorKey] ?? new AsyncLocalStorage2();
var operations = globals[operationKey] ?? new AsyncLocalStorage2();
globals[actorKey] = actors;
globals[operationKey] = operations;
var genericActor = () => actors.getStore();
var withGenericActor = (actor, work) => actors.run(Object.freeze({ ...actor }), work);
var withGenericAccount2 = (accountId, work) => withGenericActor({ ...genericActor() ?? { intent: "READ" }, accountId }, work);
var withGenericOperation = (settlement, work) => operations.run({ settlement, permission: DENY_GENERIC }, work);
var genericOperation = () => operations.getStore();
function recordGenericPermission(permission) {
  const op = operations.getStore();
  if (!op) throw Error("GENERIC_OPERATION_SCOPE_MISSING");
  op.permission = Object.freeze({ ...permission });
}

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

// apps/api/src/competition.ts
import { withGenericSystemRead } from "./packages/protocols/dist/index.js";
import { withAdvisoryRead as withAdvisoryRead2 } from "./packages/protocols/dist/index.js";
import { createHash as createHash17 } from "node:crypto";

// apps/api/src/advisory-valuations.ts
import {
  ExecutionEngineError as ExecutionEngineError14
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
    const key2 = JSON.stringify(identity) + (actor?.isolateCaptures ? JSON.stringify([actor.userId ?? "system", actor.accountId ?? null]) : "");
    const saved = this.recent.get(key2);
    if (saved && saved.until > this.now())
      return {
        ...saved,
        route: { ...saved.route, state: structuredClone(saved.route.state) },
        shared: true
      };
    this.recent.delete(key2);
    if (this.retryAfterMs > 0) throw new Error("ADVISORY_RATE_LIMITED");
    let entry = this.pending.get(key2);
    const shared = !!entry;
    if (!entry) {
      if (this.active >= this.limits.maxConcurrent || priority === "background" && this.background >= Math.min(this.limits.backgroundConcurrent, this.limits.maxConcurrent - 1))
        throw new ExecutionEngineError14("MARKET_STATE_UNAVAILABLE", "ADVISORY_BUSY");
      this.active++;
      if (priority === "background") this.background++;
      const controller = new AbortController();
      const deadline = setTimeout(
        () => controller.abort(new Error("ADVISORY_DEADLINE_EXCEEDED")),
        2200
      );
      const metrics = emptyMetrics();
      const previousSlot = this.slots.get(key2);
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
        this.slots.set(key2, Number(slot));
        const result = { route, metrics, routeMs: performance.now() - started };
        if (this.recent.size >= 256) this.recent.delete(this.recent.keys().next().value);
        this.recent.set(key2, { ...result, until: this.now() + 250 });
        return result;
      }).finally(() => {
        this.cooldownUntil = Math.max(this.cooldownUntil, metrics.rateLimitedUntil ?? 0);
        clearTimeout(deadline);
        if (this.pending.get(key2) === current2) this.pending.delete(key2);
        this.active--;
        if (priority === "background") this.background--;
      });
      void current2.value.catch(() => {
      });
      this.pending.set(key2, current2);
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
      if (entry.refs === 0 && this.pending.get(key2) === entry)
        entry.controller.abort(new Error("ADVISORY_NO_CONSUMERS"));
    }
  }
  wait(value, signal) {
    if (!signal) return value;
    return new Promise((resolve, reject5) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject5(signal.reason);
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      void value.then(resolve, reject5).finally(() => signal.removeEventListener("abort", abort));
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
import { randomUUID as randomUUID3 } from "node:crypto";
import {
  basisPoints as basisPoints2,
  calculateEffectiveMaxBuy,
  calculateMaxBuyByRatio,
  calculatePortfolioEquity,
  identifier as identifier11,
  paperSolBaseUnits as paperSolBaseUnits6,
  paperSolFromSolString
} from "./packages/core/dist/index.js";

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
  integer as integer3,
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
    maxUniqueTokens: integer3("max_unique_tokens").notNull(),
    maxBuyRatioBps: integer3("max_buy_ratio_bps").notNull(),
    rewardFinalizationGracePeriodSeconds: integer3(
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
    decimals: integer3("decimals").notNull(),
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
    completedHourlyRoundCount: integer3("completed_hourly_round_count").notNull().default(0),
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
    participantCount: integer3("participant_count").notNull(),
    nominalWinnerCount: integer3("nominal_winner_count").notNull(),
    actualWinnerCount: integer3("actual_winner_count").notNull(),
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
    ordinal: integer3("ordinal").notNull(),
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
    competitiveRank: integer3("competitive_rank").notNull(),
    tieGroupSize: integer3("tie_group_size").notNull(),
    ordinalStart: integer3("ordinal_start").notNull(),
    ordinalEnd: integer3("ordinal_end").notNull(),
    fundedOrdinalCount: integer3("funded_ordinal_count").notNull(),
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
    batchIndex: integer3("batch_index").notNull(),
    intentVersion: text("intent_version").notNull(),
    intentHash: text("intent_hash").notNull().unique(),
    state: text("state").notNull(),
    recipientCount: integer3("recipient_count").notNull(),
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
    ordinal: integer3("ordinal").notNull(),
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
    attemptNumber: integer3("attempt_number").notNull(),
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

// packages/db/src/competition-service.ts
var DEFAULT_MAX_UNIQUE_TOKENS = 5;
var DEFAULT_MAX_BUY_RATIO_BPS = 2e3;
var DEFAULT_REWARD_GRACE_SECONDS = 60;
var CURRENT_RULES_VERSION = "phase-4a-v1";
function canonicalHourlyWindow(now) {
  const startsAt = new Date(now);
  startsAt.setUTCMinutes(0, 0, 0);
  return { startsAt, endsAtExclusive: new Date(startsAt.getTime() + 36e5) };
}
function canonicalDailyWindow(now) {
  const startsAt = new Date(now);
  startsAt.setUTCHours(0, 0, 0, 0);
  return {
    utcDate: startsAt.toISOString().slice(0, 10),
    startsAt,
    endsAtExclusive: new Date(startsAt.getTime() + 864e5)
  };
}
function hourlyRoundId(startsAt) {
  return `hourly:${startsAt.toISOString()}`;
}
async function ensureHourlyRound(database, startsAt, rewardGraceSeconds = DEFAULT_REWARD_GRACE_SECONDS) {
  const endsAtExclusive = new Date(startsAt.getTime() + 36e5);
  const id = hourlyRoundId(startsAt);
  await database.pool.query(
    `insert into hourly_rounds
      (id, starts_at, ends_at_exclusive, state, starting_paper_sol_lamports,
       max_unique_tokens, max_buy_ratio_bps, reward_finalization_grace_period_seconds, rules_version)
     values ($1, $2, $3, 'SCHEDULED', $4, $5, $6, $7, $8)
     on conflict (starts_at) do nothing`,
    [
      id,
      startsAt,
      endsAtExclusive,
      DEFAULT_STARTING_PAPER_SOL_LAMPORTS,
      DEFAULT_MAX_UNIQUE_TOKENS,
      DEFAULT_MAX_BUY_RATIO_BPS,
      rewardGraceSeconds,
      CURRENT_RULES_VERSION
    ]
  );
  const result = await database.pool.query(
    "select id from hourly_rounds where starts_at = $1",
    [startsAt]
  );
  return result.rows[0].id;
}
async function ensureDailyCompetition(database, now) {
  const window = canonicalDailyWindow(now);
  const id = `daily:${window.utcDate}`;
  await database.pool.query(
    `insert into daily_competitions (id, utc_date, starts_at, ends_at_exclusive, state)
     values ($1, $2, $3, $4, 'OPEN') on conflict (utc_date) do nothing`,
    [id, window.utcDate, window.startsAt, window.endsAtExclusive]
  );
  const result = await database.pool.query(
    "select id from daily_competitions where utc_date = $1",
    [window.utcDate]
  );
  return result.rows[0].id;
}
async function ensureCurrentAndNextRounds(database, now, rewardGraceSeconds = DEFAULT_REWARD_GRACE_SECONDS) {
  const { startsAt, endsAtExclusive } = canonicalHourlyWindow(now);
  await ensureDailyCompetition(database, now);
  const [currentRoundId, nextRoundId] = await Promise.all([
    ensureHourlyRound(database, startsAt, rewardGraceSeconds),
    ensureHourlyRound(database, endsAtExclusive, rewardGraceSeconds)
  ]);
  return { currentRoundId, nextRoundId };
}
async function openDueRounds(database, now) {
  const result = await database.pool.query(
    `update hourly_rounds set state = 'OPEN'
     where state = 'SCHEDULED' and starts_at <= $1 returning id`,
    [now]
  );
  return result.rows.map(({ id }) => id);
}
async function getCurrentRound(database, now) {
  const result = await database.pool.query(
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
async function enterCurrentRound(database, input) {
  const round = await getCurrentRound(database, input.now);
  if (!round || round.state !== "OPEN") {
    throw new FinancialServiceError("ROUND_NOT_OPEN", "The current hourly round is not open.");
  }
  return initializeCompetitionAccount(database, {
    accountId: `account:${round.id}:${input.userId}`,
    userId: input.userId,
    hourlyRoundId: round.id,
    idempotencyKey: `round-entry:${round.id}:${input.userId}`,
    requireOpenAt: input.now
  });
}
async function getCurrentDailyCompetition(database, now) {
  const result = await database.pool.query(
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
async function runHourlyLifecycleTick(database, router, now, rewardGraceSeconds = DEFAULT_REWARD_GRACE_SECONDS) {
  const events = [];
  const window = canonicalHourlyWindow(now);
  const existing = await database.pool.query(
    "select starts_at from hourly_rounds where starts_at in ($1, $2)",
    [window.startsAt, window.endsAtExclusive]
  );
  const existingTimes = new Set(existing.rows.map(({ starts_at }) => starts_at.toISOString()));
  const ensured = await ensureCurrentAndNextRounds(database, now, rewardGraceSeconds);
  if (!existingTimes.has(window.startsAt.toISOString()))
    events.push({ type: "ROUND_CREATED", roundId: ensured.currentRoundId });
  if (!existingTimes.has(window.endsAtExclusive.toISOString()))
    events.push({ type: "ROUND_CREATED", roundId: ensured.nextRoundId });
  for (const roundId of await openDueRounds(database, now)) {
    events.push({ type: "ROUND_OPENED", roundId });
  }
  const ended = await database.pool.query(
    `select id, starts_at from hourly_rounds
     where ends_at_exclusive <= $1 and state in ('OPEN', 'CLOSING', 'SETTLING')
     order by starts_at`,
    [now]
  );
  for (const { id, starts_at } of ended.rows) {
    await ensureDailyCompetition(database, starts_at);
    const result = await settleHourlyRound(database, router, {
      hourlyRoundId: id,
      authoritativeTimestamp: now
    });
    events.push({
      type: result.state === "FINALIZED" ? "ROUND_FINALIZED" : "ROUND_SETTLING",
      roundId: id,
      failures: result.failures.length
    });
    for (const disposition of ["RETRY", "OPERATIONAL_ERROR"]) {
      const details = result.failures.filter((f) => f.disposition === disposition);
      if (details.length > 0)
        events.push({
          type: disposition === "RETRY" ? "SETTLEMENT_RETRY" : "SETTLEMENT_OPERATIONAL_ERROR",
          roundId: id,
          failures: details.length,
          failureDetails: details
        });
    }
  }
  await database.pool.query(
    `update daily_competitions set state = 'FINALIZING'
     where ends_at_exclusive <= $1 and state in ('OPEN', 'CLOSING')`,
    [now]
  );
  const finalizedDays = await database.pool.query(
    `update daily_competitions d set state = 'FINALIZED', finalized_at = $1
     where d.state = 'FINALIZING'
       and not exists (select 1 from legacy_source_reviews h join hourly_rounds r on r.id=h.hourly_round_id where r.starts_at>=d.starts_at and r.starts_at<d.ends_at_exclusive)
       and (select count(*) from hourly_rounds r
            where r.starts_at >= d.starts_at and r.starts_at < d.ends_at_exclusive) = 24
       and not exists (
         select 1 from hourly_rounds r
         where r.starts_at >= d.starts_at and r.starts_at < d.ends_at_exclusive
           and r.state <> 'FINALIZED'
       )
     returning d.id`,
    [now]
  );
  for (const { id } of finalizedDays.rows) events.push({ type: "DAILY_FINALIZED", roundId: id });
  return events;
}

// packages/db/src/creator-fee-ingestion.ts
import { safeErrorMessage as safeErrorMessage3 } from "./packages/core/dist/index.js";
import { createHash as createHash13 } from "node:crypto";
import { PUMP_AMM_PROGRAM_ID as PUMP_AMM_PROGRAM_ID2, PUMP_PROGRAM_ID as PUMP_PROGRAM_ID2, WRAPPED_SOL_MINT as WRAPPED_SOL_MINT2 } from "./packages/protocols/dist/index.js";
import bs585 from "./node_modules/bs58/src/cjs/index.cjs";
import { PublicKey as PublicKey12 } from "./node_modules/@solana/web3.js/lib/index.cjs.js";

// packages/db/src/reward-service.ts
import { createHash as createHash12 } from "node:crypto";
import {
  competitionConfig as competitionConfig2,
  identifier as identifier9,
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
function runtimeCompetitionConfig(config) {
  return validateCompetitionConfig({
    ...competitionConfig2,
    version: config.configurationVersion,
    rewardBuffer: {
      ...competitionConfig2.rewardBuffer,
      baselineWindowCompletedHours: config.baselineWindow,
      lambdaBps: config.lambdaBps
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
async function getHourlyRewardPool(database, roundId, config = defaultRewardAccountingConfig) {
  const client = await database.pool.connect();
  try {
    const row = await loadPool(client, roundId);
    return row ? exactPool(row) : getProvisionalHourlyRewardPool(database, roundId, config);
  } finally {
    client.release();
  }
}
async function getProvisionalHourlyRewardPool(database, roundId, rewardConfig = defaultRewardAccountingConfig) {
  const row = (await database.pool.query(
    `select r.id,r.starts_at,r.ends_at_exclusive,
              coalesce(sum(e.creator_fee_lamports) filter (
                where e.verification_status = 'VERIFIED' and e.accounting_status = 'ATTRIBUTED'
              ),0)::text verified_fees
       from hourly_rounds r left join creator_fee_events e on e.hourly_round_id = r.id
       where r.id = $1 group by r.id`,
    [roundId]
  )).rows[0];
  if (!row) return null;
  const config = runtimeCompetitionConfig(rewardConfig);
  const split = processHourlyRewardEconomics({
    creatorFeeLamports: BigInt(row.verified_fees),
    mode: rewardConfig.allocationMode,
    currentBufferLamports: 0n,
    previousCompletedNaturalHourlyRewards: [],
    config
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
async function getCurrentHourlyRewardPool(database, now, config = defaultRewardAccountingConfig) {
  const round = (await database.pool.query(
    "select id from hourly_rounds where starts_at <= $1 and ends_at_exclusive > $1 limit 1",
    [now]
  )).rows[0];
  return round ? getHourlyRewardPool(database, round.id, config) : null;
}
async function getCurrentDailyRewardPool(database, now, rewardConfig = defaultRewardAccountingConfig) {
  const daily = (await database.pool.query(
    "select id,starts_at,ends_at_exclusive from daily_competitions where starts_at <= $1 and ends_at_exclusive > $1 limit 1",
    [now]
  )).rows[0];
  if (!daily) return null;
  const frozen = (await database.pool.query(
    `select coalesce(sum(c.amount_lamports),0)::text accumulated
       from daily_reward_contributions c join daily_reward_pools p on p.id = c.daily_reward_pool_id
       where p.daily_competition_id = $1`,
    [daily.id]
  )).rows[0];
  const provisional = (await database.pool.query(
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
async function reconcileHourlyRewardPool(database, roundId) {
  const pool = await getHourlyRewardPool(database, roundId);
  if (!pool || !("id" in pool)) return pool;
  const events = (await database.pool.query(
    `select id,transaction_signature,event_index,slot,event_time,creator_fee_lamports,
              source_program,token_project_identity,observed_at,accounting_status
       from creator_fee_events where hourly_round_id = $1 and accounting_status = 'COUNTED'
       order by event_time,transaction_signature,event_index`,
    [roundId]
  )).rows;
  const movements = (await database.pool.query(
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
import { AsyncLocalStorage as AsyncLocalStorage3 } from "node:async_hooks";
import {
  competitionConfig as competitionConfig3,
  processHourlyRewardEconomics as processHourlyRewardEconomics2
} from "./packages/core/dist/index.js";

// packages/db/src/payout-approval.ts
import { createHash as createHash14 } from "node:crypto";
import { PublicKey as PublicKey13 } from "./node_modules/@solana/web3.js/lib/index.cjs.js";
import { buildPayoutBatches } from "./packages/core/dist/index.js";

// packages/db/src/payout-treasury.ts
var scope = new AsyncLocalStorage3();

// packages/db/src/payout-security.ts
import { AsyncLocalStorage as AsyncLocalStorage4 } from "node:async_hooks";
import { createPublicKey, verify } from "node:crypto";
var current = new AsyncLocalStorage4();

// packages/db/src/payout-execution.ts
import { buildPayoutBatches as buildPayoutBatches2, PAYOUT_INTENT_VERSION } from "./packages/core/dist/index.js";
import {
  Connection,
  PublicKey as PublicKey14,
  SystemInstruction,
  SystemProgram,
  Transaction
} from "./node_modules/@solana/web3.js/lib/index.cjs.js";
import bs586 from "./node_modules/bs58/src/cjs/index.cjs";

// packages/db/src/generic-capability.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { ExecutionEngineError as ExecutionEngineError15 } from "./packages/execution/dist/index.js";
import { genericActor as genericActor3 } from "./packages/protocols/dist/index.js";
var KEY = "generic_pumpswap_operator_control_v1";
var ID = /^user:[a-f0-9]{64}$/;
function deny(reason) {
  throw new ExecutionEngineError15("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
}
function genericCapabilityOptions(config) {
  const c = config;
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
      version: randomUUID2(),
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
    const actor = genericActor3(), system = this.options.systemSettlement === true && forSettlement || actor?.systemRead === true;
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

// apps/api/src/competition.ts
import {
  ExecutionEngineError as ExecutionEngineError16,
  executionRouteRecord as executionRouteRecord3
} from "./packages/execution/dist/index.js";
import {
  PUMP_FUN_PROTOCOL_ID as PUMP_FUN_PROTOCOL_ID2,
  WRAPPED_SOL_MINT as WRAPPED_SOL_MINT3,
  pumpBondingCurveAddress as pumpBondingCurveAddress2,
  chartMintSupply
} from "./packages/protocols/dist/index.js";

// apps/api/src/live-leaderboard.ts
import { genericActor as genericActor4, withGenericAccount as withGenericAccount3 } from "./packages/protocols/dist/index.js";
import { identifier as identifier10 } from "./packages/core/dist/index.js";
async function buildLiveStandings(database, router, roundId) {
  const accounts = (await database.pool.query(
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
      const actor = genericActor4();
      const key2 = JSON.stringify(identity) + (actor?.isolateCaptures ? "::" + actor.accountId : "");
      if (!routes.has(key2)) routes.set(key2, router.loadPositionRoute(identity));
      return routes.get(key2);
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
            const value = await withGenericAccount3(
              account.account_id ?? "",
              () => exitPreflight(
                readRouter,
                {
                  protocolId: identifier10(position.venue, "ProtocolId"),
                  marketId: identifier10(position.market, "MarketId"),
                  tokenMint: identifier10(position.mint, "TokenMint")
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
import { createHash as createHash15 } from "node:crypto";
var CAPTURED_FX_VERSION = "CAPTURED_EXECUTION_FX_V1";
var COINBASE_FX_SOURCE = "COINBASE_SOL_USD_LAST_TRADE";
var unavailable2 = (reason) => ({ status: "UNAVAILABLE", reason });
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
      return unavailable2("CAPTURED_FX_EXECUTION_WINDOW_EXPIRED");
    if (!this.latest || this.latest.expires < this.now())
      this.latest = { expires: this.now() + 250, value: this.read(target) };
    const result = await this.latest.value;
    if (result.status !== "AVAILABLE") return result;
    if (Math.abs(Date.parse(result.fxAt) - target) > 5e3) return unavailable2("STALE_CAPTURED_FX");
    return { ...result, requestedAt: new Date(Math.floor(target / 1e3) * 1e3).toISOString() };
  }
  async read(target) {
    let failure = "CAPTURED_FX_PROVIDER_UNAVAILABLE";
    for (let attempt = 0; attempt < 2; attempt++) {
      this.requests = this.requests.filter((t) => this.now() - t < 1e3);
      if (this.requests.length >= 5) return unavailable2("CAPTURED_FX_RATE_LIMITED");
      this.requests.push(this.now());
      try {
        const response = await this.fetcher(
          attempt === 0 ? "https://api.exchange.coinbase.com/products/SOL-USD/ticker" : "https://api.exchange.coinbase.com/products/SOL-USD/trades?limit=100",
          { signal: AbortSignal.timeout(700) }
        );
        if (!response.ok) {
          if (response.status !== 429 && response.status < 500)
            return unavailable2("CAPTURED_FX_PROVIDER_REJECTED");
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
              responseHash: createHash15("sha256").update(JSON.stringify(item)).digest("hex")
            };
          }
        }
      } catch {
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return unavailable2(failure);
  }
};

// apps/api/src/chart-fx.ts
import { createHash as createHash16 } from "node:crypto";
var SOL_USD_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
var CHART_FX_VERSION = "HISTORICAL_FX_AT_EXECUTION_V1";
var unavailable3 = (reason) => ({ status: "UNAVAILABLE", reason });
var PythHistoricalFxProvider = class {
  constructor(key2 = () => process.env["PYTH_API_KEY"], fetcher = fetch, now = Date.now) {
    this.key = key2;
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
      return Promise.resolve(unavailable3("INVALID_FILL_TIMESTAMP"));
    if (!this.key()) return Promise.resolve(unavailable3("HISTORICAL_FX_PROVIDER_NOT_CONFIGURED"));
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
      if (this.requests.length >= 10) return unavailable3("HISTORICAL_FX_RATE_LIMITED");
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
            return unavailable3("HISTORICAL_FX_PROVIDER_UNAUTHORIZED");
          if (response.status === 404) return unavailable3("HISTORICAL_FX_UNAVAILABLE");
          if (response.status !== 429 && response.status < 500)
            return unavailable3("HISTORICAL_FX_PROVIDER_REJECTED");
          if (attempt === 2) return unavailable3("HISTORICAL_FX_PROVIDER_UNAVAILABLE");
        } else {
          const raw = await response.json();
          const quote = raw.parsed?.find((p) => p.id === SOL_USD_FEED)?.price;
          if (!quote || !/^\d+$/.test(quote.price) || BigInt(quote.price) <= 0n || !/^\d+$/.test(quote.conf) || BigInt(quote.conf) >= BigInt(quote.price) || !Number.isInteger(quote.expo) || Math.abs(quote.expo) > 18 || !Number.isSafeInteger(quote.publish_time) || quote.publish_time < seconds || quote.publish_time - seconds > 5)
            return unavailable3("INVALID_HISTORICAL_FX");
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
            responseHash: createHash16("sha256").update(JSON.stringify(raw)).digest("hex")
          };
        }
      } catch {
        if (attempt === 2) return unavailable3("HISTORICAL_FX_PROVIDER_UNAVAILABLE");
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
    return unavailable3("HISTORICAL_FX_UNAVAILABLE");
  }
};
var provider = new PythHistoricalFxProvider();
async function historicalFillFx(database, fillId, time, source) {
  try {
    const saved = (await database.pool.query(
      "select evidence from chart_fill_fx_evidence where fill_id = $1 and version = any($2::text[]) order by version limit 1",
      [fillId, [CAPTURED_FX_VERSION, CHART_FX_VERSION]]
    )).rows[0];
    if (saved) return saved.evidence;
    if (!source) {
      const failure = (await database.pool.query(
        "select reason from chart_fill_fx_capture_failures where fill_id=$1 and version=$2",
        [fillId, CAPTURED_FX_VERSION]
      )).rows[0];
      return unavailable3(failure?.reason ?? "HISTORICAL_FX_NOT_CAPTURED");
    }
    const result = await source.lookup(time);
    if (result.status !== "AVAILABLE") return result;
    await database.pool.query(
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
    return (await database.pool.query(
      "select evidence from chart_fill_fx_evidence where fill_id = $1 and version = $2",
      [fillId, result.version]
    )).rows[0]?.evidence ?? unavailable3("HISTORICAL_FX_PERSISTENCE_UNAVAILABLE");
  } catch {
    return unavailable3("HISTORICAL_FX_PERSISTENCE_UNAVAILABLE");
  }
}
async function saveCapturedFillFx(database, fillId, time, observation) {
  try {
    const result = await observation;
    let valid = result;
    if (result.status === "AVAILABLE" && (result.version !== CAPTURED_FX_VERSION || Math.abs(Date.parse(result.fxAt) - time.getTime()) > 5e3 || Date.parse(result.requestedAt) !== Math.floor(time.getTime() / 1e3) * 1e3))
      valid = unavailable3("CAPTURED_FX_NOT_AT_FILL_TIME");
    if (valid.status === "UNAVAILABLE") {
      await database.pool.query(
        "insert into chart_fill_fx_capture_failures(fill_id,version,status,reason) values($1,$2,$3,$4) on conflict do nothing",
        [fillId, CAPTURED_FX_VERSION, valid.status, valid.reason]
      );
      return historicalFillFx(database, fillId, time);
    }
    return await historicalFillFx(database, fillId, time, { lookup: async () => valid });
  } catch {
    return unavailable3("CAPTURED_FX_PERSISTENCE_UNAVAILABLE");
  }
}

// apps/api/src/competition.ts
function unavailableValuation(error, valuedAt) {
  const code = error instanceof ExecutionEngineError16 ? error.code : "MARKET_STATE_UNAVAILABLE";
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
  constructor(database, router, now = () => /* @__PURE__ */ new Date(), rewardConfig = defaultRewardAccountingConfig, chartFx = new CoinbaseExecutionFxProvider(), advisoryLimits = { maxConcurrent: 4, backgroundConcurrent: 2 }, genericArmed = false) {
    this.database = database;
    this.router = router;
    this.now = now;
    this.rewardConfig = rewardConfig;
    this.chartFx = chartFx;
    this.advisoryLimits = advisoryLimits;
    this.genericArmed = genericArmed;
    this.advisory = new AdvisoryValuations(router, () => this.now().getTime(), advisoryLimits);
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
    const key2 = round.id;
    if (!this.liveCache || this.liveCache.key !== key2 || this.liveCache.expires <= Date.now()) {
      const pending = withGenericSystemRead(
        () => buildLiveStandings(this.database, this.advisory.router(), key2),
        this.genericArmed
      );
      const cache = { key: key2, expires: Number.POSITIVE_INFINITY, pending };
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
      [key2]
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
                protocolId: identifier11(position.venue, "ProtocolId"),
                marketId: identifier11(position.market_id, "MarketId"),
                tokenMint: identifier11(position.mint_address, "TokenMint")
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
      throw new ExecutionEngineError16("MARKET_STATE_UNAVAILABLE", "ADVISORY_SQL_BUSY");
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
        new Promise((_, reject5) => {
          timeout = setTimeout(
            () => reject5(new ExecutionEngineError16("MARKET_STATE_UNAVAILABLE", "ADVISORY_SQL_TIMEOUT")),
            600
          );
        })
      ]);
      return result.rows[0];
    } catch (error) {
      if (error instanceof ExecutionEngineError16) throw error;
      throw new ExecutionEngineError16("MARKET_STATE_UNAVAILABLE", "ADVISORY_SQL_UNAVAILABLE");
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
      const revision = (r) => createHash17("sha256").update(
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
            protocolId: identifier11(row.venue, "ProtocolId"),
            marketId: identifier11(row.market_id, "MarketId"),
            tokenMint: identifier11(mint, "TokenMint")
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
        const reason = signal?.aborted ? "ADVISORY_CANCELED" : error instanceof Error && /^(ADVISORY_|SNAPSHOT_)/.test(error.message) ? safeApiErrorMessage(error) : error instanceof ExecutionEngineError16 ? error.code : "VALUATION_UNAVAILABLE";
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
    const positionValues = conservativelyValued ? conservativeValues.map((value) => paperSolBaseUnits6(value)) : null;
    const cash = paperSolBaseUnits6(BigInt(account.paper_sol_balance_lamports));
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
        reason: error instanceof ExecutionEngineError16 ? error.code : "MARKET_STATE_UNAVAILABLE"
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
      protocolId: PUMP_FUN_PROTOCOL_ID2,
      marketId: identifier11(await pumpBondingCurveAddress2(mint), "MarketId"),
      tokenMint: identifier11(mint, "TokenMint")
    };
    const marketId = identity.marketId;
    let route;
    let state;
    try {
      const resolved = await this.router.loadPositionRoute(identity);
      route = resolved.route;
      state = resolved.state;
    } catch (error) {
      if (error instanceof ExecutionEngineError16) throw error;
      throw new ExecutionEngineError16("MARKET_STATE_UNAVAILABLE", "Market state is unavailable.");
    }
    const decimalsValue = state.normalizedState["tokenDecimals"];
    const decimals = typeof decimalsValue === "string" ? Number(decimalsValue) : NaN;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new ExecutionEngineError16("INVALID_MARKET_STATE", "Token decimals are invalid.");
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
      [WRAPPED_SOL_MINT3]
    );
    const quoteAssetId = (await this.database.pool.query(
      "select id from assets where mint_address = $1",
      [WRAPPED_SOL_MINT3]
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
      throw new ExecutionEngineError16("MARKET_STATE_UNAVAILABLE", "CHART_METADATA_BUSY");
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
      throw new ExecutionEngineError16("MARKET_STATE_UNAVAILABLE", "ADVISORY_METADATA_BUSY");
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
              status: market.migrated ? "MIGRATED_POOL" : market.identity.protocolId === PUMP_FUN_PROTOCOL_ID2 ? "ACTIVE_BONDING_CURVE" : "RESOLVED_ROUTE",
              route: state.normalizedState["hops"] ?? null,
              routeIdentity: executionRouteRecord3(state, true),
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
            if (error instanceof ExecutionEngineError16 && [
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
    const originMarketId = account.positions.find((p) => p.mint_address === input.mint)?.market_id ?? await pumpBondingCurveAddress2(input.mint);
    const registered = (await this.database.pool.query(
      "select id, venue from markets where id = $1",
      [originMarketId]
    )).rows[0];
    const market = registered ? {
      identity: {
        protocolId: identifier11(registered.venue ?? PUMP_FUN_PROTOCOL_ID2, "ProtocolId"),
        marketId: identifier11(originMarketId, "MarketId"),
        tokenMint: identifier11(input.mint, "TokenMint")
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

// apps/api/isolated/verified-routes/runtime.ts
import { paperSolBaseUnits as paperSolBaseUnits7, identifier as identifier12 } from "./packages/core/dist/index.js";
import { ExecutionRouter, ExecutionEngineError as ExecutionEngineError17 } from "./packages/execution/dist/index.js";
async function createLinkedRouteRuntime(store, options) {
  const select = async (mint, root) => {
    await store.assertAvailable();
    const candidates = linkedBindings(root).filter((r) => r.mint === mint).sort((a, b) => a.bridgePool.localeCompare(b.bridgePool));
    let best;
    const failures = [];
    const valid = [];
    for (const binding of candidates) {
      const snapshot2 = linkedRoute(root, mint, binding.bridgePool);
      const identity = genericPumpSwapIdentity(binding.mint, binding.quoteMint, binding.bridgePool);
      try {
        const q = await transitionLinkedSnapshot(snapshot2, 10000000n, true, {
          nowMs: Date.parse(snapshot2.observedAt),
          maxAgeMs: 1e4
        });
        const reverse = await transitionLinkedSnapshot(q.next, q.quote.output, false, {
          nowMs: Date.parse(snapshot2.observedAt),
          maxAgeMs: 1e4
        });
        if (reverse.quote.output > 0n) {
          valid.push(identity);
          if (!best || reverse.quote.output > best.output)
            best = { identity, output: reverse.quote.output };
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "UNSUPPORTED");
      }
    }
    if (!best)
      throw new ExecutionEngineError17(
        "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
        "VERIFIED_EXECUTABLE_ROUTE_REQUIRED:" + failures.join(",")
      );
    if (options.selectRoute) {
      const preferred = await options.selectRoute(mint, root);
      if (!valid.some(
        (v) => v.marketId === preferred.marketId && v.protocolId === preferred.protocolId && v.tokenMint === preferred.tokenMint
      ))
        throw new ExecutionEngineError17(
          "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
          "VERIFIED_SELECTION_NOT_EXECUTABLE"
        );
      return preferred;
    }
    return best.identity;
  };
  const runtime = linkedCandidateRuntime(store.db, store, { ...options, selectRoute: select });
  const router = new ExecutionRouter([runtime.adapter]);
  const resolve = async (mint) => {
    await store.assertAvailable();
    const head = await store.load();
    const seal = await store.cutoff();
    let branch = seal ? await store.sealedBranch(head, seal) : head.document;
    if (!seal) {
      const supplied = await options.interval(head.document.real);
      const interval = supplied ? copyProviderInterval(supplied) : null;
      if (interval) {
        try {
          branch = (await reconcileLinkedInterval(head.document, interval, options.now(), 1e4)).branch;
        } catch (error) {
          await store.quarantine(interval, error);
          throw error;
        }
      }
    }
    if (!seal && (options.now() < Date.parse(branch.real.observedAt) || options.now() - Date.parse(branch.real.observedAt) > 1e4))
      throw new ExecutionEngineError17("MARKET_STATE_UNAVAILABLE", "LINKED_FRESHNESS_UNAVAILABLE");
    return select(mint, branch.simulated);
  };
  router.mintResolver = resolve;
  router.canonicalResolver = async (originIdentity) => ({
    originIdentity,
    executionIdentity: await resolve(originIdentity.tokenMint),
    migrated: false
  });
  class Competition extends CompetitionService {
    async getPositions(userId, signal) {
      const result = await super.getPositions(userId, signal);
      if (!result) return result;
      const account = await this.getCurrentAccount(userId);
      if (!account || account.id !== store.accountId) throw Error("VERIFIED_ACCOUNT_SCOPE");
      const values = await runtime.database.valueMarketPortfolio(
        account.positions.map((p) => ({
          positionId: p.id,
          identity: {
            protocolId: identifier12(p.venue, "ProtocolId"),
            marketId: identifier12(p.market_id, "MarketId"),
            tokenMint: identifier12(p.mint_address, "TokenMint")
          },
          quantity: BigInt(p.remaining_base_units)
        }))
      );
      const positions2 = await Promise.all(
        result.positions.map(async (position) => {
          const value = values.find((v) => v.positionId === position.id);
          if (!value) throw Error("VERIFIED_PORTFOLIO_POSITION_MISMATCH");
          const snapshot2 = value.evidence.normalizedState["stage1Snapshot"];
          const quote = await supportedLinkedExit(snapshot2, BigInt(position.remaining_base_units));
          if (quote.output !== value.value) throw Error("VERIFIED_PORTFOLIO_VALUE_CHANGED");
          const valuation = quote.quantity === BigInt(position.remaining_base_units) ? {
            status: "AVAILABLE",
            executablePaperSolLamports: value.value,
            unrealizedPnlLamports: value.value - BigInt(position.cost_basis_lamports),
            currentProtocol: value.evidence.identity.protocolId,
            evidenceFingerprint: value.evidence.fingerprint,
            observedAt: value.evidence.observedAt,
            chainSlot: value.evidence.chainSlot,
            valuedAt: this.now()
          } : {
            status: "UNAVAILABLE",
            reason: "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
            valuedAt: this.now()
          };
          return {
            ...position,
            valuation,
            ...position.sellPreflight ? {
              sellPreflight: {
                ...position.sellPreflight,
                maxExecutableQuantityBaseUnits: quote.quantity,
                maxExecutableOutputLamports: value.value
              }
            } : {}
          };
        })
      );
      const available = positions2.every((p) => p.valuation.status === "AVAILABLE");
      const total = values.reduce((n3, p) => n3 + p.value, 0n), cash = BigInt(account.paper_sol_balance_lamports);
      return {
        ...result,
        positions: positions2,
        valuationStatus: available ? "AVAILABLE" : "UNAVAILABLE",
        equityValuationStatus: available ? "FULL" : "PARTIAL_LIQUIDITY",
        executablePositionsLamports: total,
        portfolioEquityLamports: cash + total,
        livePnlLamports: cash + total - BigInt(account.starting_paper_sol_lamports)
      };
    }
    async buyPreflight(userId, mint, signal) {
      const result = await super.buyPreflight(userId, mint, signal);
      const portfolio = await this.getPositions(userId, signal);
      if (!portfolio || portfolio.portfolioEquityLamports === null) return result;
      const ratio = portfolio.portfolioEquityLamports * BigInt(result.maxBuyRatioBps) / 10000n;
      return {
        ...result,
        valuationStatus: portfolio.valuationStatus,
        equityValuationStatus: portfolio.equityValuationStatus,
        executablePositionsLamports: portfolio.executablePositionsLamports,
        portfolioEquityLamports: paperSolBaseUnits7(portfolio.portfolioEquityLamports),
        maxBuyByRatioLamports: paperSolBaseUnits7(ratio),
        maxBuyLamports: paperSolBaseUnits7(
          ratio < result.cashLamports ? ratio : result.cashLamports
        )
      };
    }
  }
  const competition = new Competition(
    runtime.database,
    router,
    () => new Date(options.now()),
    void 0,
    { lookup: async () => ({ status: "UNAVAILABLE", reason: "ISOLATED_DISPLAY_FX_DISABLED" }) }
  );
  return { ...runtime, router, competition, deploymentEnabled: false };
}

// apps/api/isolated/verified-routes/production-composition.ts
var fail12 = (m) => {
  throw new ExecutionEngineError18("MARKET_STATE_UNAVAILABLE", "SCOPED_LINKED_" + m);
};
async function composeScopedProduction(options) {
  const base = options.database, baseline = options.baselineRouter, now = options.now ?? Date.now;
  const scopes = /* @__PURE__ */ new Map();
  for (const supplied of options.scopes) {
    const scope2 = Object.freeze({ ...supplied, mints: Object.freeze([...supplied.mints]) });
    if (!scope2.approvalReference || !["EXIT_ONLY", "ENTRY"].includes(scope2.mode) || scopes.has(scope2.accountId) || !scope2.mints.length || new Set(scope2.mints).size !== scope2.mints.length)
      fail12("CONFIGURATION");
    const owner = (await base.pool.query(
      "select user_id,hourly_round_id from competition_accounts where id=$1",
      [scope2.accountId]
    )).rows[0];
    if (owner?.user_id !== scope2.userId || owner.hourly_round_id !== scope2.roundId)
      fail12("ACCOUNT_OWNER");
    const store = new LinkedStateStore(
      base,
      scope2.accountId,
      scope2.roundId,
      scope2.durableFlow === true,
      scope2.proofRecovery === true
    ), head = await store.load();
    const mints = new Set(linkedBindings(head.document.real).map((r) => r.mint));
    if (mints.size !== scope2.mints.length || scope2.mints.some((m) => !mints.has(m)))
      fail12("DISCOVERY_SCOPE");
    await store.recover();
    const runtime = await createLinkedRouteRuntime(store, {
      now,
      interval: async (anchor) => {
        if (!scope2.durableFlow) return scope2.connector.interval(anchor);
        const age = now() - Date.parse(anchor.observedAt);
        if (!Number.isFinite(age) || age < 0 || age > 1e4) fail12("FLOW_CATCHING_UP");
        return null;
      },
      cutoffFrontier: (anchor, cutoff) => scope2.connector.cutoffFrontier(anchor, cutoff),
      permission: async (identity) => {
        if (scope2.paused) fail12("OPERATOR_REVIEW_HOLD");
        const binding = linkedBindings((await store.load()).document.real).find(
          (r) => r.mint === identity.tokenMint && identity.marketId.endsWith(r.bridgePool)
        );
        if (!binding) fail12("UNADMITTED_BINDING");
        const sealed = !!await store.cutoff();
        return withGenericAccount2(scope2.accountId, async () => {
          const permission = await options.resolvePermission(
            binding.mint,
            binding.quoteMint,
            sealed
          );
          if (permission.exitBinding && (permission.exitBinding.targetPool !== binding.targetPool || permission.exitBinding.quoteMint !== binding.quoteMint))
            fail12("EXIT_ORIGIN_CHANGED");
          return {
            ...permission,
            buy: scope2.mode === "ENTRY" && permission.buy,
            ...permission.exitBinding ? { exitBinding: { ...permission.exitBinding, bridgePool: binding.bridgePool } } : {},
            authorizeLive: async (kind) => {
              if (kind === "BUY" && scope2.mode !== "ENTRY") fail12("ENTRY_DISABLED");
              if (!permission.authorizeLive) fail12("LIVE_AUTHORIZATION_REQUIRED");
              await permission.authorizeLive(kind);
            }
          };
        });
      }
    });
    const reserved = new Set(
      Object.entries(head.document.real.accounts).filter(([, a]) => {
        const len = Buffer.from(a.base64, "base64").length;
        return [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner) && len >= 165 || [287, 300, 301, 166, 653, 9988].includes(len) && ![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner);
      }).map(([address3]) => address3)
    );
    scopes.set(scope2.accountId, { scope: scope2, store, runtime, reserved });
  }
  const forAccount = (id) => scopes.get(id);
  async function active() {
    const actor = genericActor();
    if (actor?.accountId) return forAccount(actor.accountId);
    if (!actor?.userId) return void 0;
    const row = (await base.pool.query(
      "select ca.id from competition_accounts ca join hourly_rounds r on r.id=ca.hourly_round_id where ca.user_id=$1 and r.starts_at<=$2 and r.ends_at_exclusive>$2",
      [actor.userId, new Date(now())]
    )).rows[0];
    return row ? forAccount(row.id) : void 0;
  }
  const owns = (b, mint) => !!b?.scope.mints.includes(mint);
  function assertIndependent(b, state) {
    if (!b) return;
    const seen = /* @__PURE__ */ new Set();
    const visit = (v) => {
      if (typeof v === "string") seen.add(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          seen.add(k);
          visit(x);
        }
    };
    visit(state.normalizedState);
    visit(state.rawSource);
    if ([...b.reserved].some((a) => seen.has(a))) fail12("UNTRACKED_SHARED_LIQUIDITY");
    if (!["PUMP_FUN_BONDING_CURVE", "PUMP_SWAP_CANONICAL_POOL", "SOLANA_COMPOSED_ROUTE"].includes(
      String(state.normalizedState["model"])
    ))
      fail12("ORDINARY_DEPENDENCY_EVIDENCE_REQUIRED");
  }
  const first = [...scopes.values()][0];
  const versionAdapter = first ? new Proxy(first.runtime.adapter, {
    get(target, key2) {
      const value = Reflect.get(target, key2);
      if (typeof value !== "function") return value;
      return (...args) => {
        const state = args.at(-1), id = state?.normalizedState?.["linkedAccountId"];
        const bound = typeof id === "string" ? forAccount(id) : void 0;
        if (id === void 0) return value.apply(target, args);
        if (!bound || state?.normalizedState["linkedRoundId"] !== bound.scope.roundId)
          fail12("PINNED_ADAPTER_SCOPE");
        const fn = Reflect.get(bound.runtime.adapter, key2);
        return fn.apply(bound.runtime.adapter, args);
      };
    }
  }) : void 0;
  class Router extends ExecutionRouter2 {
    async resolvePositionRoute(identity, settlement = false) {
      const b = await active();
      if (owns(b, identity.tokenMint) && !settlement)
        baseline.resolve(b.runtime.adapter.protocolId);
      return owns(b, identity.tokenMint) ? b.runtime.router.resolvePositionRoute(identity, settlement) : baseline.resolvePositionRoute(identity, settlement);
    }
    async loadPositionRoute(identity, settlement = false) {
      const b = await active();
      if (owns(b, identity.tokenMint)) {
        if (!settlement) baseline.resolve(b.runtime.adapter.protocolId);
        return b.runtime.router.loadPositionRoute(identity, settlement);
      }
      const loaded = await baseline.loadPositionRoute(identity, settlement);
      assertIndependent(b, loaded.state);
      return loaded;
    }
    resolve(id) {
      return baseline.resolve(id);
    }
    resolveForSettlement(id) {
      return baseline.resolveForSettlement(id);
    }
    resolveVersion(id, version) {
      return first && id === first.runtime.adapter.protocolId && version === first.runtime.adapter.adapterVersion ? versionAdapter : baseline.resolveVersion(id, version);
    }
    setEnabled(id, enabled) {
      baseline.setEnabled(id, enabled);
    }
    isEnabled(id) {
      return baseline.isEnabled(id);
    }
  }
  const router = new Router();
  if (baseline.diagnostic) router.diagnostic = baseline.diagnostic;
  router.mintResolver = async (mint) => {
    const b = await active();
    if (owns(b, mint)) baseline.resolve(b.runtime.adapter.protocolId);
    return owns(b, mint) ? b.runtime.router.mintResolver(mint) : baseline.mintResolver ? baseline.mintResolver(mint) : fail12("BASELINE_DISCOVERY_REQUIRED");
  };
  router.canonicalResolver = async (identity) => (await router.resolvePositionRoute(identity)).route;
  if (baseline.contextResolver) router.contextResolver = baseline.contextResolver;
  if (baseline.chartMetadataResolver) router.chartMetadataResolver = baseline.chartMetadataResolver;
  const database = {
    ...base,
    persistedSettlementAccount: (id, identity) => owns(forAccount(id), identity.tokenMint) || (base.persistedSettlementAccount?.(id, identity) ?? !!base.preparePersistedSettlementStep),
    lockMarketExecution: async (c, id) => {
      const b = forAccount(id);
      if (b) await b.runtime.database.lockMarketExecution(c, id);
      else await base.lockMarketExecution?.(c, id);
    },
    commitMarketExecution: async (c, input) => {
      const b = forAccount(input.accountId), linked = input.execution.quote.adapterVersion === first?.runtime.adapter.adapterVersion;
      if (linked) {
        if (!b) fail12("FILL_OUTSIDE_SCOPE");
        await b.runtime.database.commitMarketExecution(c, input);
      } else {
        if (b) {
          const s = (await storeState(b)).real;
          if (linkedBindings(s).some(
            (r) => r.mint === (input.execution.actualInput.asset === "TOKEN" ? input.execution.actualInput.tokenMint : input.execution.actualOutput.asset === "TOKEN" ? input.execution.actualOutput.tokenMint : "")
          ))
            fail12("LINKED_FILL_BYPASS");
        }
        await base.commitMarketExecution?.(c, input);
      }
    },
    valueMarketPortfolio: async (positions2) => {
      const b = await active();
      if (!b && base.valueMarketPortfolio) return base.valueMarketPortfolio(positions2);
      const tracked = positions2.filter((p) => owns(b, p.identity.tokenMint));
      const native = b ? await b.runtime.database.valueMarketPortfolio(tracked) : [];
      const results = [...native];
      for (const p of positions2.filter((p2) => !owns(b, p2.identity.tokenMint))) {
        const q = await canonicalExitPreflight3(router, p.identity, p.quantity, 0n);
        results.push({
          positionId: p.positionId,
          value: q.maxExecutableOutputLamports,
          evidence: q.evidence
        });
      }
      return positions2.map((p) => results.find((v) => v.positionId === p.positionId));
    },
    prepareMarketSettlement: async (round, cutoff) => {
      await base.prepareMarketSettlement?.(round, cutoff);
      for (const b of scopes.values())
        if (b.scope.roundId === round) {
          const open = await base.pool.query(
            "select 1 from positions p join assets a on a.id=p.asset_id where p.competition_account_id=$1 and p.status='OPEN' and a.mint_address=any($2::text[]) limit 1",
            [b.scope.accountId, b.scope.mints]
          );
          if (open.rowCount)
            await withGenericAccount2(
              b.scope.accountId,
              () => b.runtime.database.prepareMarketSettlement(round, cutoff)
            );
        }
    },
    preparePersistedSettlementStep: async (input) => {
      const b = forAccount(input.accountId);
      return b ? b.runtime.database.preparePersistedSettlementStep(input) : base.preparePersistedSettlementStep ? base.preparePersistedSettlementStep(input) : fail12("UNSCOPED_PERSISTED_PLAN");
    },
    commitPersistedSettlementStep: async (c, input) => {
      const b = forAccount(input.accountId);
      if (b) await b.runtime.database.commitPersistedSettlementStep(c, input);
      else if (base.commitPersistedSettlementStep)
        await base.commitPersistedSettlementStep(c, input);
      else fail12("UNSCOPED_PERSISTED_COMMIT");
    },
    bindMarketSettlementEvidence: async (id, evidence) => {
      const b = forAccount(id);
      if (b && evidence.adapterVersion === b.runtime.adapter.adapterVersion)
        await b.runtime.database.bindMarketSettlementEvidence(id, evidence);
      else await base.bindMarketSettlementEvidence?.(id, evidence);
    }
  };
  async function storeState(b) {
    return (await b.store.load()).document;
  }
  class Competition extends CompetitionService {
    async getPositions(user, signal) {
      const b = await active();
      if (!b) return super.getPositions(user, signal);
      const result = await super.getPositions(user, signal);
      if (!result) return result;
      const account = await this.getCurrentAccount(user);
      if (account?.id !== b.scope.accountId) fail12("PORTFOLIO_ACCOUNT");
      const values = await database.valueMarketPortfolio(
        account.positions.map((p) => ({
          positionId: p.id,
          identity: {
            protocolId: identifier13(p.venue, "ProtocolId"),
            marketId: identifier13(p.market_id, "MarketId"),
            tokenMint: identifier13(p.mint_address, "TokenMint")
          },
          quantity: BigInt(p.remaining_base_units)
        }))
      );
      const positions2 = await Promise.all(
        result.positions.map(async (p) => {
          const v = values.find((v2) => v2.positionId === p.id);
          if (!v) fail12("PORTFOLIO_INCOMPLETE");
          const s = v.evidence.normalizedState["stage1Snapshot"];
          if (!s) return p;
          const q = await supportedLinkedExit(s, BigInt(p.remaining_base_units));
          if (q.output !== v.value) fail12("PORTFOLIO_CHANGED");
          const valuation = q.quantity === BigInt(p.remaining_base_units) ? {
            status: "AVAILABLE",
            executablePaperSolLamports: v.value,
            unrealizedPnlLamports: v.value - BigInt(p.cost_basis_lamports),
            currentProtocol: v.evidence.identity.protocolId,
            evidenceFingerprint: v.evidence.fingerprint,
            observedAt: v.evidence.observedAt,
            chainSlot: v.evidence.chainSlot,
            valuedAt: this.now()
          } : {
            status: "UNAVAILABLE",
            reason: "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
            valuedAt: this.now()
          };
          return {
            ...p,
            valuation,
            ...p.sellPreflight ? {
              sellPreflight: {
                ...p.sellPreflight,
                maxExecutableQuantityBaseUnits: q.quantity,
                maxExecutableOutputLamports: q.output
              }
            } : {}
          };
        })
      );
      const total = values.reduce((n3, v) => n3 + v.value, 0n), equity = BigInt(account.paper_sol_balance_lamports) + total, available = positions2.every((p) => p.valuation.status === "AVAILABLE");
      return {
        ...result,
        positions: positions2,
        valuationStatus: available ? "AVAILABLE" : "UNAVAILABLE",
        equityValuationStatus: available ? "FULL" : "PARTIAL_LIQUIDITY",
        executablePositionsLamports: total,
        portfolioEquityLamports: equity,
        livePnlLamports: equity - BigInt(account.starting_paper_sol_lamports)
      };
    }
    async buyPreflight(user, mint, signal) {
      const result = await super.buyPreflight(user, mint, signal);
      if (!await active()) return result;
      const p = await this.getPositions(user, signal);
      if (!p || p.portfolioEquityLamports === null) return result;
      const ratio = p.portfolioEquityLamports * BigInt(result.maxBuyRatioBps) / 10000n;
      return {
        ...result,
        valuationStatus: p.valuationStatus,
        equityValuationStatus: p.equityValuationStatus,
        executablePositionsLamports: p.executablePositionsLamports,
        portfolioEquityLamports: paperSolBaseUnits8(p.portfolioEquityLamports),
        maxBuyByRatioLamports: paperSolBaseUnits8(ratio),
        maxBuyLamports: paperSolBaseUnits8(
          ratio < result.cashLamports ? ratio : result.cashLamports
        )
      };
    }
  }
  const extra = options.competitionOptions;
  const service = new Competition(
    database,
    router,
    () => new Date(now()),
    extra?.rewardConfig,
    extra?.chartFx,
    extra?.advisoryLimits,
    extra?.genericArmed
  );
  const userMethods = /* @__PURE__ */ new Set([
    "getCurrentAccount",
    "getPositions",
    "viewedPosition",
    "buyPreflight",
    "buy",
    "sell"
  ]);
  const competition = new Proxy(service, {
    get(target, key2) {
      const v = Reflect.get(target, key2);
      if (typeof v !== "function") return v;
      return (...args) => userMethods.has(String(key2)) && !genericActor()?.userId ? withGenericActor(
        {
          userId: String(args[0]),
          intent: key2 === "buy" ? "BUY" : key2 === "sell" ? "SELL" : "READ"
        },
        () => v.apply(target, args)
      ) : v.apply(target, args);
    }
  });
  return {
    database,
    router,
    competition,
    scopes,
    settle: (roundId) => settleHourlyRound(database, router, {
      hourlyRoundId: roundId,
      authoritativeTimestamp: new Date(now())
    }),
    deploymentEnabled: false
  };
}

// apps/api/isolated/verified-routes/finalized-connector.ts
import { mkdir, readFile as readFile2, writeFile, link, unlink, readdir } from "node:fs/promises";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { join } from "node:path";
import { randomUUID as randomUUID4, createHash as createHash18 } from "node:crypto";
import { performance as performance3 } from "node:perf_hooks";
var compress = promisify(gzip);
var inflate = promisify(gunzip);
var CLOCK6 = "SysvarC1ock11111111111111111111111111111111";
var timing2 = (name, start, detail) => {
  performance3.measure(name, { start, detail });
  performance3.clearMeasures(name);
};
var fail13 = (m) => {
  throw Error("LINKED_CONNECTOR_" + m);
};
var FinalizedRpc = class {
  constructor(url, timeoutMs = 15e3) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
  url;
  timeoutMs;
  async call(method, params) {
    if (!["getMultipleAccounts", "getSlot", "getBlocks", "getBlock", "getTransaction", "getTransactionsForAddress"].includes(method))
      fail13("READ_ONLY_METHOD");
    const started = performance3.now();
    const r = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    timing2("linked.rpc.headers", started, { method });
    const decoding = performance3.now();
    if (!r.ok) fail13("HTTP_" + r.status);
    const text2 = await r.text();
    timing2("linked.rpc.bodyRead", decoding, { method, bytes: Buffer.byteLength(text2) });
    const parsing = performance3.now();
    const v = JSON.parse(text2);
    timing2("linked.rpc.jsonParse", parsing, { method });
    timing2("linked.rpc.bodyDecode", decoding, { method });
    if (v.error || v.result === void 0) fail13("RPC_" + (v.error?.code ?? "MISSING_RESULT"));
    return v.result;
  }
};
function clock(s) {
  const a = s.accounts[CLOCK6], b = Buffer.from(a?.base64 ?? "", "base64");
  if (a?.owner !== "Sysvar1111111111111111111111111111111111111" || b.length !== 40 || !Number.isSafeInteger(s.slot) || b.readBigUInt64LE(0) !== BigInt(s.slot))
    fail13("CLOCK_CONTEXT");
  const seconds = Number(b.readBigInt64LE(32));
  if (!Number.isSafeInteger(seconds) || seconds < 0) fail13("CLOCK_TIME");
  return seconds;
}
var bankKey = (s) => digest({
  routes: linkedBindings(s),
  accounts: Object.keys(s.accounts).sort(),
  absent: s.absentAccounts
});
var bankValue = (s) => digest({ ...s, observedAt: "" });
var FinalizedBankArchive = class {
  constructor(directory, compressIntervals = false) {
    this.directory = directory;
    this.compressIntervals = compressIntervals;
  }
  directory;
  compressIntervals;
  async get(key2) {
    if (!/^[a-z0-9-]+$/.test(key2)) fail13("ARCHIVE_KEY");
    try {
      const reading = performance3.now();
      let raw;
      try {
        raw = await readFile2(join(this.directory, key2 + ".json"), "utf8");
      } catch (e) {
        if (e.code !== "ENOENT" || !this.compressIntervals) throw e;
        raw = (await inflate(await readFile2(join(this.directory, key2 + ".json.gz")))).toString();
      }
      timing2("linked.archive.readInflate", reading, { kind: key2.split("-")[0] });
      const decoding = performance3.now();
      const v = JSON.parse(raw);
      if (v.serialization !== void 0) {
        if (v.serialization !== "JSON_BYTES_SHA256_V1" || !key2.startsWith("block-") || typeof v.json !== "string" || createHash18("sha256").update(v.json).digest("hex") !== v.hash)
          fail13("ARCHIVE_HASH");
        const block = JSON.parse(v.json);
        timing2("linked.archive.decode", decoding, { key: key2 });
        return block;
      }
      if (key2.startsWith("interval-")) retainProviderInterval(v.document);
      if (digest(v.document) !== v.hash) fail13("ARCHIVE_HASH");
      return v.document;
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async put(key2, document) {
    const encoding = performance3.now();
    await mkdir(this.directory, { recursive: true });
    if (!/^[a-z0-9-]+$/.test(key2)) fail13("ARCHIVE_KEY");
    const canonicalizing = performance3.now();
    if (key2.startsWith("interval-")) retainProviderInterval(document);
    timing2("linked.archive.canonicalize", canonicalizing, { kind: key2.split("-")[0] });
    const blockBytes = this.compressIntervals && key2.startsWith("block-");
    const compressed = this.compressIntervals && (key2.startsWith("interval-") || blockBytes), suffix = compressed ? ".json.gz" : ".json";
    const temp = join(this.directory, "pending-" + randomUUID4() + suffix), target = join(this.directory, key2 + suffix);
    const serializing = performance3.now();
    const json3 = blockBytes ? JSON.stringify(document) : void 0;
    const raw = blockBytes ? JSON.stringify({
      serialization: "JSON_BYTES_SHA256_V1",
      hash: createHash18("sha256").update(json3).digest("hex"),
      json: json3
    }) : key2.startsWith("interval-") ? '{"hash":"' + digest(document) + '","document":' + serializeProviderInterval(document) + "}" : JSON.stringify({ hash: digest(document), document });
    timing2("linked.archive.serialize", serializing, { kind: key2.split("-")[0], bytes: Buffer.byteLength(raw) });
    const compressing = performance3.now();
    const encoded = compressed ? await compress(Buffer.from(raw), { level: 1 }) : raw;
    timing2("linked.archive.compress", compressing, { kind: key2.split("-")[0] });
    timing2("linked.archive.encode", encoding, { kind: key2.split("-")[0], bytes: Buffer.byteLength(encoded) });
    const writing = performance3.now();
    await writeFile(temp, encoded, {
      flag: "wx"
    });
    try {
      await link(temp, target);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (digest(await this.get(key2)) !== digest(document)) fail13("ARCHIVE_CONFLICT");
    } finally {
      await unlink(temp);
      timing2("linked.archive.write", writing, { kind: key2.split("-")[0] });
    }
  }
  async bank(s) {
    clock(s);
    const key2 = "bank-" + bankKey(s) + "-" + s.slot, old = await this.get(key2);
    if (old) {
      if (bankValue(old) !== bankValue(s)) fail13("BANK_CONFLICT");
      return old;
    }
    await this.put(key2, s);
    return s;
  }
  async bankAt(anchor, slot) {
    return this.get("bank-" + bankKey(anchor) + "-" + slot);
  }
  /** Retained atomic banks only. Never synthesize an intermediate provider state. */
  async nextBank(anchor, maxSpan = 8) {
    const prefix = "bank-" + bankKey(anchor) + "-";
    const slots = (await readdir(this.directory)).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).map((f) => Number(f.slice(prefix.length, -5))).filter((s) => Number.isSafeInteger(s) && s > anchor.slot).sort((a, b) => a - b);
    const slot = slots.filter((s) => s <= anchor.slot + maxSpan).at(-1) ?? slots[0];
    return slot === void 0 ? null : this.bankAt(anchor, slot);
  }
};
var FinalizedFlowConnector = class {
  constructor(rpc, archive, now = Date.now, limits = {}) {
    this.rpc = rpc;
    this.archive = archive;
    this.now = now;
    this.maxSlots = limits.maxSlots ?? 256;
    this.maxTransactions = limits.maxTransactions ?? 2e4;
    this.blockConcurrency = limits.blockConcurrency ?? 4;
    if (!Number.isSafeInteger(this.maxSlots) || this.maxSlots < 1 || this.maxSlots > 2048 || !Number.isSafeInteger(this.maxTransactions) || this.maxTransactions < 1 || !Number.isSafeInteger(this.blockConcurrency) || this.blockConcurrency < 1 || this.blockConcurrency > 8)
      fail13("BOUNDS");
  }
  rpc;
  archive;
  now;
  maxSlots;
  maxTransactions;
  // Advisory reads and execution can request the same immutable finalized evidence.
  // Share acquisition only; each consumer receives its own copy for replay.
  pendingBlocks = /* @__PURE__ */ new Map();
  fullReads = 0;
  waitingReads = [];
  verifiedBlocks = /* @__PURE__ */ new Map();
  // A finalized receipt cannot gain a missing historical token-balance entry on
  // retry. Keep this current-verifier rejection fail-closed until process restart;
  // do not repeatedly inflate hundreds of already verified block bodies.
  rejectedIntervals = /* @__PURE__ */ new Map();
  blockConcurrency;
  pendingIntervals = /* @__PURE__ */ new Map();
  advisoryIntervals = /* @__PURE__ */ new WeakMap();
  async block(slot, full = true) {
    const key2 = (full ? "block-" : "header-") + slot;
    const cached = this.verifiedBlocks.get(key2);
    if (cached) return cached;
    let pending = this.pendingBlocks.get(key2);
    if (!pending) {
      pending = this.acquireBlock(slot, full);
      this.pendingBlocks.set(key2, pending);
    }
    try {
      const block = await pending;
      if (!this.archive.compressIntervals) return structuredClone(block);
      freezeProviderDocument(block);
      this.verifiedBlocks.set(key2, block);
      if (this.verifiedBlocks.size > 64) this.verifiedBlocks.delete(this.verifiedBlocks.keys().next().value);
      return block;
    } finally {
      if (this.pendingBlocks.get(key2) === pending) this.pendingBlocks.delete(key2);
    }
  }
  async acquireBlock(slot, full) {
    const key2 = (full ? "block-" : "header-") + slot, old = await this.archive.get(key2);
    if (old) return old;
    if (this.fullReads >= this.blockConcurrency)
      await new Promise((resolve) => this.waitingReads.push(resolve));
    else this.fullReads++;
    let b;
    try {
      b = await this.rpc.call("getBlock", [
        slot,
        {
          commitment: "finalized",
          encoding: "json",
          transactionDetails: full ? "full" : "none",
          rewards: false,
          maxSupportedTransactionVersion: 1
        }
      ]);
    } finally {
      const next = this.waitingReads.shift();
      if (next) next();
      else this.fullReads--;
    }
    if (!b || !b.blockhash || !b.previousBlockhash || !Number.isSafeInteger(b.parentSlot) || !Number.isSafeInteger(b.blockTime) || full && !Array.isArray(b.transactions))
      fail13("BLOCK_UNAVAILABLE");
    if (!b) return fail13("BLOCK_UNAVAILABLE");
    const header = await this.archive.get("header-" + slot);
    if (header && (header.blockhash !== b.blockhash || header.parentSlot !== b.parentSlot || header.blockTime !== b.blockTime || header.previousBlockhash !== b.previousBlockhash))
      fail13("BLOCK_FORK");
    await this.archive.put(key2, b);
    return b;
  }
  /** Acquire complete bodies ahead of ordered commits. This never publishes an interval or advances state. */
  async prefetch(anchor, after) {
    if (bankKey(anchor) !== bankKey(after) || after.slot < anchor.slot) fail13("PREFETCH_TOPOLOGY");
    const end = Math.min(after.slot, anchor.slot + Math.min(this.maxSlots, 128));
    if (end === anchor.slot) return;
    const slots = await this.rpc.call("getBlocks", [anchor.slot + 1, end, { commitment: "finalized" }]);
    if (!Array.isArray(slots) || slots.some((s, i) => !Number.isSafeInteger(s) || s <= anchor.slot || s > end || i > 0 && s <= slots[i - 1]))
      fail13("PREFETCH_SLOTS");
    let index2 = 0, failed;
    await Promise.all(Array.from({ length: Math.min(this.blockConcurrency, slots.length) }, async () => {
      while (index2 < slots.length && !failed) {
        const slot = slots[index2++];
        try {
          await this.block(slot);
        } catch (e) {
          failed = e;
        }
      }
    }));
    if (failed) throw failed;
  }
  /** One atomic <=100-account bank, up to three whole-read attempts; never merge mismatched contexts. */
  async observe(anchor) {
    return this.capture(anchor);
  }
  /** Archive a finalized pre-cutoff bank even when finality arrives after the wall-clock boundary.
   * This never makes it eligible for a normal fill; sealing still requires the exact two-block frontier. */
  async captureCutoffBank(anchor, cutoff) {
    const ms = cutoff.getTime();
    if (!Number.isFinite(ms) || ms % 36e5 !== 0 || this.now() < ms) fail13("UTC_CUTOFF");
    return this.capture(anchor, cutoff);
  }
  async capture(anchor, cutoff) {
    const captureStarted = performance3.now();
    clock(anchor);
    const addresses = [
      .../* @__PURE__ */ new Set([...Object.keys(anchor.accounts), ...anchor.absentAccounts])
    ].sort();
    if (addresses.length > 100) fail13("ATOMIC_DEPENDENCY_LIMIT");
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await this.rpc.call(
        "getMultipleAccounts",
        [addresses, { commitment: "finalized", encoding: "base64", minContextSlot: anchor.slot }]
      );
      if (!raw || !Number.isSafeInteger(raw.context?.slot) || raw.context.slot < anchor.slot || raw.value?.length !== addresses.length)
        fail13("BANK_SHAPE");
      const accounts = {};
      for (const [i, address3] of addresses.entries()) {
        const a = raw.value[i];
        if (anchor.absentAccounts.includes(address3)) {
          if (a !== null) fail13("UNRESOLVED_DEPENDENCY_APPEARED");
          continue;
        }
        if (!a || a.data?.[1] !== "base64" || typeof a.owner !== "string")
          fail13("DEPENDENCY_MISSING");
        const was = anchor.accounts[address3];
        if (was.lamports !== void 0 && (!Number.isSafeInteger(a.lamports) || a.lamports < 0))
          fail13("UNSAFE_NATIVE_BALANCE");
        accounts[address3] = {
          owner: a.owner,
          base64: a.data[0],
          ...was.lamports !== void 0 ? { lamports: String(a.lamports) } : {}
        };
      }
      const s = { ...structuredClone(anchor), slot: raw.context.slot, accounts };
      try {
        s.observedAt = new Date(clock(s) * 1e3).toISOString();
      } catch (e) {
        if (attempt < 2 && String(e).includes("CLOCK_CONTEXT")) continue;
        throw e;
      }
      const reference = cutoff?.getTime() ?? this.now();
      if (reference < Date.parse(s.observedAt) || reference - Date.parse(s.observedAt) > 1e4 || cutoff && reference === Date.parse(s.observedAt))
        fail13("STALE_BANK");
      const bank = await this.archive.bank(s);
      const b = await this.block(s.slot, false);
      if (b.blockTime !== clock(s)) fail13("BANK_BLOCK_TIME");
      timing2("linked.capture.dependencies", captureStarted, { slot: s.slot, accounts: addresses.length });
      return bank;
    }
    return fail13("COHERENT_BANK_UNAVAILABLE");
  }
  async interval(anchor, end) {
    const read = advisoryReadContext();
    if (!read || end) return this.readInterval(anchor, end);
    read.signal.throwIfAborted();
    let intervals = this.advisoryIntervals.get(read);
    if (!intervals) {
      intervals = /* @__PURE__ */ new Map();
      this.advisoryIntervals.set(read, intervals);
    }
    const key2 = digest(anchor);
    let acquired = intervals.get(key2);
    if (!acquired) {
      acquired = this.readInterval(anchor);
      intervals.set(key2, acquired);
    }
    const interval = await acquired;
    read.signal.throwIfAborted();
    return this.archive.compressIntervals ? interval : structuredClone(interval);
  }
  async readInterval(anchor, end) {
    clock(anchor);
    const after = end ?? await this.observe(anchor);
    clock(after);
    if (bankKey(anchor) !== bankKey(after)) fail13("TOPOLOGY_CHANGED");
    if (after.slot === anchor.slot) {
      if (bankValue(after) !== bankValue(anchor)) fail13("SAME_SLOT_CHANGED");
      return null;
    }
    if (after.slot < anchor.slot || after.slot - anchor.slot > this.maxSlots)
      fail13("INTERVAL_BOUND");
    const epochChanged = !Buffer.from(anchor.accounts[CLOCK6].base64, "base64").subarray(8, 32).equals(Buffer.from(after.accounts[CLOCK6].base64, "base64").subarray(8, 32));
    const packetKey = (epochChanged ? "interval-epoch-v1-" : "interval-fee-v1-") + digest(anchor) + "-" + digest(after);
    let pending = this.pendingIntervals.get(packetKey);
    if (!pending) {
      pending = this.acquireInterval(anchor, after, packetKey);
      this.pendingIntervals.set(packetKey, pending);
    }
    try {
      const interval = await pending;
      return this.archive.compressIntervals ? interval : structuredClone(interval);
    } finally {
      if (this.pendingIntervals.get(packetKey) === pending) this.pendingIntervals.delete(packetKey);
    }
  }
  async acquireInterval(anchor, after, packetKey) {
    const rejected = this.rejectedIntervals.get(packetKey);
    if (rejected) {
      timing2("linked.acquire.rejectedReuse", performance3.now(), { from: anchor.slot, to: after.slot });
      throw rejected;
    }
    const retained = await this.archive.get(packetKey);
    if (retained) return retained;
    const slots = await this.rpc.call("getBlocks", [
      anchor.slot + 1,
      after.slot,
      { commitment: "finalized" }
    ]);
    if (!Array.isArray(slots) || slots.length > this.maxSlots || slots.at(-1) !== after.slot || slots.some(
      (s, i) => !Number.isSafeInteger(s) || s <= anchor.slot || s > after.slot || i > 0 && s <= slots[i - 1]
    ))
      fail13("INCOMPLETE_SLOTS");
    const anchorBlock = await this.block(anchor.slot, false), blocks = [];
    let previous = anchorBlock, parent = anchor.slot, count = 0;
    const acquiring = performance3.now();
    const batch = new Array(slots.length);
    let next = 0, acquisitionFailed = false;
    await Promise.all(Array.from({ length: Math.min(this.blockConcurrency, slots.length) }, async () => {
      while (next < slots.length && !acquisitionFailed) {
        const index2 = next++;
        try {
          batch[index2] = { status: "fulfilled", value: await this.block(slots[index2]) };
        } catch (reason) {
          batch[index2] = { status: "rejected", reason };
          acquisitionFailed = true;
        }
      }
    }));
    timing2("linked.acquire.blocks", acquiring, { slots: slots.length, concurrency: this.blockConcurrency });
    for (const [index2, result] of batch.entries()) {
      if (result.status === "rejected") throw result.reason;
      const slot = slots[index2], b = result.value;
      if (b.parentSlot !== parent || b.previousBlockhash !== previous.blockhash || b.blockTime < previous.blockTime)
        fail13("BLOCK_FRONTIER_GAP");
      count += b.transactions.length;
      if (count > this.maxTransactions) fail13("TRANSACTION_BOUND");
      blocks.push({ slot, result: b });
      previous = b;
      parent = slot;
    }
    if (previous.blockTime !== clock(after)) fail13("END_BANK_TIME");
    let epochWitness;
    const priorClock = Buffer.from(anchor.accounts[CLOCK_ACCOUNT].base64, "base64"), endClock = Buffer.from(after.accounts[CLOCK_ACCOUNT].base64, "base64");
    if (!priorClock.subarray(8, 32).equals(endClock.subarray(8, 32))) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await this.rpc.call("getMultipleAccounts", [
          [CLOCK_ACCOUNT, EPOCH_SCHEDULE_ACCOUNT],
          { commitment: "finalized", encoding: "base64", minContextSlot: after.slot }
        ]);
        if (!r || r.value?.length !== 2 || r.value.some((a) => !a || a.data?.[1] !== "base64")) fail13("EPOCH_WITNESS_SHAPE");
        const witness = {
          schema: "FINALIZED_EPOCH_SCHEDULE_V1",
          contextSlot: r.context?.slot,
          clock: { owner: r.value[0].owner, base64: r.value[0].data[0] },
          schedule: { owner: r.value[1].owner, base64: r.value[1].data[0] }
        };
        try {
          epochProgression(anchor, after, blocks, witness);
          epochWitness = witness;
          break;
        } catch (e) {
          if (attempt < 2 && String(e).includes("EPOCH_CLOCK_CONTEXT")) continue;
          throw e;
        }
      }
      if (!epochWitness) fail13("EPOCH_WITNESS_MISSING");
    }
    const policiesStarted = performance3.now();
    const mints = requiredTokenFeeMints(anchor, blocks);
    let token2022;
    if (mints.length) {
      if (mints.length > 99) fail13("TOKEN_FEE_ATOMIC_LIMIT");
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await this.rpc.call("getMultipleAccounts", [
          [...mints, CLOCK6],
          { commitment: "finalized", encoding: "base64", minContextSlot: after.slot }
        ]);
        if (!response || !Number.isSafeInteger(response.context?.slot) || response.context.slot < after.slot || response.value?.length !== mints.length + 1 || response.value.some((a) => !a || a.data[1] !== "base64"))
          fail13("TOKEN_FEE_WITNESS_SHAPE");
        const ca = response.value.at(-1);
        if (!ca) fail13("TOKEN_FEE_CLOCK_MISSING");
        const raw = Buffer.from(ca.data[0], "base64");
        if (raw.length !== 40 || raw.readBigUInt64LE(0) !== BigInt(response.context.slot)) {
          if (attempt < 2) continue;
          fail13("TOKEN_FEE_CLOCK_CONTEXT");
        }
        token2022 = {
          schema: "TOKEN_2022_FEE_SCHEDULE_WITNESS_V1",
          contextSlot: response.context.slot,
          clock: { owner: ca.owner, base64: ca.data[0] },
          mints: Object.fromEntries(
            mints.map((m, i) => [
              m,
              { owner: response.value[i].owner, base64: response.value[i].data[0] }
            ])
          )
        };
        try {
          feePolicies(token2022, anchor, after, blocks, epochWitness);
        } catch (error) {
          if (error instanceof Error && error.message === "TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE") {
            this.rejectedIntervals.set(packetKey, error);
            if (this.rejectedIntervals.size > 32) this.rejectedIntervals.delete(this.rejectedIntervals.keys().next().value);
          }
          throw error;
        }
        break;
      }
      if (!token2022) fail13("TOKEN_FEE_WITNESS_MISSING");
    }
    timing2("linked.acquire.feePolicies", policiesStarted, { mints: mints.length });
    const interval = {
      schema: "LINKED_RETAINED_RPC_INTERVAL_V1",
      commitment: "finalized",
      acquiredAt: new Date(this.now()).toISOString(),
      ...token2022 ? { token2022 } : {},
      ...epochWitness ? { epochWitness } : {},
      before: structuredClone(anchor),
      after: structuredClone(after),
      slots,
      anchor: { blockhash: anchorBlock.blockhash },
      blocks
    };
    await this.archive.put(packetKey, interval);
    return interval;
  }
  async cutoffFrontier(anchor, cutoff) {
    const ms = cutoff.getTime();
    if (!Number.isFinite(ms) || ms % 36e5 !== 0 || this.now() < ms) fail13("UTC_CUTOFF");
    const tip = await this.rpc.call("getSlot", [{ commitment: "finalized" }]);
    if (!Number.isSafeInteger(tip) || tip < anchor.slot || tip - anchor.slot > this.maxSlots)
      fail13("CUTOFF_BOUND");
    const slots = await this.rpc.call("getBlocks", [
      anchor.slot,
      tip,
      { commitment: "finalized" }
    ]);
    if (!Array.isArray(slots) || slots[0] !== anchor.slot || slots.length > this.maxSlots + 1)
      fail13("CUTOFF_SLOTS");
    let last = await this.block(anchor.slot, false), lastSlot = anchor.slot;
    if (last.blockTime * 1e3 >= ms) fail13("ANCHOR_AFTER_CUTOFF");
    for (const slot of slots.slice(1)) {
      const next = await this.block(slot, false);
      if (slot <= lastSlot || next.parentSlot !== lastSlot || next.previousBlockhash !== last.blockhash || next.blockTime < last.blockTime)
        fail13("CUTOFF_FRONTIER_GAP");
      if (next.blockTime * 1e3 >= ms) {
        const bank = lastSlot === anchor.slot ? anchor : await this.archive.bankAt(anchor, lastSlot);
        if (!bank) return fail13("EXACT_CUTOFF_BANK_NOT_RETAINED");
        if (clock(bank) !== last.blockTime || ms - last.blockTime * 1e3 > 1e4)
          fail13("CUTOFF_BANK_TIME");
        return {
          schema: "LINKED_UTC_FRONTIER_V1",
          commitment: "finalized",
          last: { slot: lastSlot, blockhash: last.blockhash, blockTime: last.blockTime },
          next: {
            slot,
            parentSlot: next.parentSlot,
            previousBlockhash: next.previousBlockhash,
            blockhash: next.blockhash,
            blockTime: next.blockTime
          },
          interval: await this.interval(anchor, bank)
        };
      }
      last = next;
      lastSlot = slot;
    }
    return fail13("CUTOFF_NOT_FINALIZED");
  }
};

// packages/protocols/src/production.ts
import { validateNonSolPumpSwapRoutes as validateNonSolPumpSwapRoutes2 } from "./packages/config/dist/index.js";
import { ExecutionRouter as ExecutionRouter3, ExecutionEngineError as ExecutionEngineError20 } from "./packages/execution/dist/index.js";

// packages/protocols/src/solana-routes.ts
import { createHash as createHash19 } from "node:crypto";
import BN3 from "./packages/protocols/node_modules/bn.js/lib/bn.js";
import { PublicKey as PublicKey15 } from "./packages/protocols/node_modules/@solana/web3.js/lib/index.cjs.js";
import {
  unpackMint as unpackMint3,
  unpackAccount as unpackAccount4,
  getExtensionTypes as getExtensionTypes3,
  getTransferFeeConfig as getTransferFeeConfig3,
  calculateEpochFee,
  getTransferHook as getTransferHook3,
  getDefaultAccountState as getDefaultAccountState3,
  getPausableConfig as getPausableConfig2
} from "./packages/protocols/node_modules/@solana/spl-token/lib/cjs/index.js";
import {
  CpmmPoolInfoLayout,
  CpmmConfigInfoLayout,
  CurveCalculator,
  LaunchpadPool,
  LaunchpadConfig,
  Curve,
  LaunchConstantProductCurve,
  LinearPriceCurve,
  PlatformConfig,
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId
} from "./node_modules/@raydium-io/raydium-sdk-v2/lib/index.js";
import {
  cpAmmCoder,
  getFeeMode,
  getSwapResultFromExactInput,
  isSwapEnabled,
  derivePoolAuthority,
  InsufficientLiquidityError
} from "./node_modules/@meteora-ag/cp-amm-sdk/dist/index.js";
import {
  identifier as identifier14,
  paperSolBaseUnits as paperSolBaseUnits9,
  tokenBaseUnits as tokenBaseUnits6,
  utcInstant as utcInstant3
} from "./packages/core/dist/index.js";
import {
  createMarketStateEvidence as createMarketStateEvidence7,
  executionRouteRecord as executionRouteRecord4,
  ExecutionEngineError as ExecutionEngineError19
} from "./packages/execution/dist/index.js";
var SOLANA_ROUTE_PROTOCOL_ID = identifier14("SOLANA_ROUTE", "ProtocolId");
var RAYDIUM_CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
var METEORA_DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
var RAYDIUM_LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
var CLOCK7 = "SysvarC1ock11111111111111111111111111111111";
var VERSION2 = "solana-composed-route-v1";
function fail14(message) {
  throw new ExecutionEngineError19("POSITION_EXECUTION_ROUTE_UNAVAILABLE", message);
}
function bytes2(account) {
  return Buffer.from(account.base64, "base64");
}
function camelFields(value) {
  if (Array.isArray(value)) return value.map(camelFields);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([key2, item]) => [
        key2.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase()),
        camelFields(item)
      ])
    );
  return value;
}
function dammPool(data) {
  return camelFields(cpAmmCoder.accounts.decode("Pool", data));
}
function discriminator2(data, name) {
  if (!data.subarray(0, 8).equals(createHash19("sha256").update(`account:${name}`).digest().subarray(0, 8)))
    fail14(`Invalid ${name} discriminator.`);
}
function decodePoolLink(pool, account) {
  if (account.owner === ORCA_WHIRLPOOL_PROGRAM) return orcaLink(pool, account);
  const data = bytes2(account);
  if (account.owner === RAYDIUM_CPMM_PROGRAM) {
    discriminator2(data, "PoolState");
    if (data.length !== CpmmPoolInfoLayout.span)
      fail14("Raydium CPMM account version/size is unknown.");
    const p = CpmmPoolInfoLayout.decode(data);
    return {
      pool,
      program: account.owner,
      mintA: p.mintA.toBase58(),
      mintB: p.mintB.toBase58(),
      vaultA: p.vaultA.toBase58(),
      vaultB: p.vaultB.toBase58(),
      config: p.configId.toBase58()
    };
  }
  if (account.owner === RAYDIUM_LAUNCHLAB_PROGRAM) {
    discriminator2(data, "PoolState");
    if (data.length !== LaunchpadPool.span)
      fail14("Raydium LaunchLab account version/size is unknown.");
    const p = LaunchpadPool.decode(data);
    return {
      pool,
      program: account.owner,
      mintA: p.mintA.toBase58(),
      mintB: p.mintB.toBase58(),
      vaultA: p.vaultA.toBase58(),
      vaultB: p.vaultB.toBase58(),
      config: p.configId.toBase58(),
      platform: p.platformId.toBase58()
    };
  }
  if (account.owner === METEORA_DAMM_V2_PROGRAM) {
    const p = dammPool(data);
    return {
      pool,
      program: account.owner,
      mintA: p.tokenAMint.toBase58(),
      mintB: p.tokenBMint.toBase58(),
      vaultA: p.tokenAVault.toBase58(),
      vaultB: p.tokenBVault.toBase58(),
      config: null
    };
  }
  return fail14(`No verified decoder for market ${pool}, owner ${account.owner}.`);
}
function accountInfo(a) {
  return {
    data: bytes2(a),
    owner: new PublicKey15(a.owner),
    executable: false,
    lamports: 0,
    rentEpoch: 0
  };
}
function mintInfo(address3, a) {
  if (![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner))
    fail14(`Mint ${address3} has invalid owner.`);
  const mint = unpackMint3(new PublicKey15(address3), accountInfo(a), new PublicKey15(a.owner));
  if (!mint.isInitialized) fail14(`Mint ${address3} is uninitialized.`);
  const safe = /* @__PURE__ */ new Set([0, 1, 3, 4, 6, 10, 12, 14, 18, 19, 20, 21, 22, 23, 25, 26, 28]);
  const unknown = getExtensionTypes3(mint.tlvData).filter((type) => !safe.has(type));
  if (unknown.length)
    fail14(`Mint ${address3} requires transfer-extension simulation (${unknown.join(",")}).`);
  const hook = getTransferHook3(mint);
  if (hook && !hook.programId.equals(PublicKey15.default))
    fail14(`Mint ${address3} has an active transfer hook ${hook.programId.toBase58()}.`);
  if (getDefaultAccountState3(mint)?.state === 2 || getPausableConfig2(mint)?.paused)
    fail14(`Mint ${address3} is frozen by default or paused.`);
  return mint;
}
function captured(account) {
  return { owner: account.owner, base64: account.data[0] };
}
function snapshot(state) {
  if (state.adapterVersion !== VERSION2 || state.normalizedState["model"] !== "SOLANA_COMPOSED_ROUTE")
    fail14("Route evidence version mismatch.");
  return state.normalizedState;
}
function need4(s, address3) {
  const a = s.accounts[address3];
  if (!a) fail14(`Missing recorded account ${address3}.`);
  return a;
}
var n2 = (value) => BigInt(value.toString(10));
function asset(mint, amount) {
  return mint === WRAPPED_SOL_MINT ? { asset: "PAPER_SOL", amount: paperSolBaseUnits9(amount) } : { asset: "TOKEN", tokenMint: identifier14(mint, "TokenMint"), amount: tokenBaseUnits6(amount) };
}
function quoteRoute(state, input, buy, startMint, endMint) {
  if (input <= 0n || input > 0xffffffffffffffffn)
    throw new ExecutionEngineError19("ZERO_EXECUTABLE_OUTPUT", "Swap input must be a positive u64.");
  const s = snapshot(state);
  if (s.tokenDecimals !== mintInfo(state.identity.tokenMint, need4(s, state.identity.tokenMint)).decimals.toString())
    fail14("Recorded token decimals differ from authoritative mint.");
  const clock3 = bytes2(need4(s, CLOCK7));
  if (clock3.length < 40 || state.chainSlot === null || clock3.readBigUInt64LE(0) > state.chainSlot)
    fail14("Route Clock/slot snapshot is malformed or incoherent.");
  const epoch = clock3.readBigUInt64LE(16), slot = clock3.readBigUInt64LE(0), time = clock3.readBigInt64LE(32);
  let mint = startMint ?? (buy ? WRAPPED_SOL_MINT : state.identity.tokenMint);
  let amount = input;
  let consumedInput = input;
  const fees = [];
  const details = [];
  const hops = buy ? [...s.hops].reverse() : s.hops;
  for (const hop of hops) {
    if (mint !== hop.mintA && mint !== hop.mintB)
      fail14("Route does not connect the requested mint.");
    const poolAccount = need4(s, hop.pool);
    const link2 = hop.program === PUMP_PROGRAM_ID ? pumpLink(
      hop.pool,
      poolAccount,
      hop.mintA,
      need4(s, hop.mintA).owner,
      need4(s, hop.mintB).owner
    ) : decodePoolLink(hop.pool, poolAccount);
    if (Object.keys(link2).some(
      (key2) => key2 !== "extraAccounts" && !(key2 === "platform" && hop.platform === void 0) && link2[key2] !== hop[key2]
    ))
      fail14("Recorded market linkage changed.");
    const aToB = mint === hop.mintA;
    const outMint = aToB ? hop.mintB : hop.mintA;
    const inputMint = mintInfo(mint, need4(s, mint)), outputMint = mintInfo(outMint, need4(s, outMint));
    const transfer = (address3, value, info4) => {
      const config = getTransferFeeConfig3(info4);
      const fee3 = config ? calculateEpochFee(config, epoch, value) : 0n;
      if (fee3 > 0n) fees.push({ category: "TOKEN_TRANSFER_FEE", amount: asset(address3, fee3) });
      return value - fee3;
    };
    const afterTransfer = transfer(mint, amount, inputMint);
    const vault3 = (address3, expectedMint) => {
      const raw = need4(s, address3);
      const expectedProgram = need4(s, expectedMint).owner;
      if (raw.owner !== expectedProgram) fail14("Vault token program differs from mint.");
      const v = unpackAccount4(new PublicKey15(address3), accountInfo(raw), new PublicKey15(raw.owner));
      if (v.mint.toBase58() !== expectedMint || !v.isInitialized || v.isFrozen)
        fail14("Vault mint/state is invalid.");
      return v;
    };
    const va = vault3(hop.vaultA, hop.mintA), vb = vault3(hop.vaultB, hop.mintB);
    const addFee = (category, feeMint, value) => {
      if (value > 0n) fees.push({ category, amount: asset(feeMint, value) });
    };
    let output;
    if ([PUMP_PROGRAM_ID, ORCA_WHIRLPOOL_PROGRAM].includes(hop.program)) {
      const authority = hop.pool;
      if (va.owner.toBase58() !== authority || vb.owner.toBase58() !== authority)
        fail14("Composed vault authority mismatch.");
      const q = quoteSupplementalHop(
        hop,
        s.accounts,
        afterTransfer,
        aToB,
        time,
        mintInfo(hop.mintA, need4(s, hop.mintA)).supply,
        state.normalizedState["absentAccounts"] ?? []
      );
      output = q.output;
      addFee("PROTOCOL_FEE", q.feeMint, q.protocol);
      addFee("CREATOR_FEE", q.feeMint, q.creator);
      addFee("feeCategory" in q ? q.feeCategory : "LP_FEE", q.feeMint, q.lp);
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        outputBeforeTransfer: output.toString(),
        ...q.detail
      });
    } else if (hop.program === RAYDIUM_CPMM_PROGRAM) {
      const p = CpmmPoolInfoLayout.decode(bytes2(poolAccount));
      const config = need4(s, hop.config);
      if (config.owner !== RAYDIUM_CPMM_PROGRAM) fail14("CPMM config owner mismatch.");
      discriminator2(bytes2(config), "AmmConfig");
      const c = CpmmConfigInfoLayout.decode(bytes2(config));
      const authority = PublicKey15.findProgramAddressSync(
        [Buffer.from("vault_and_lp_mint_auth_seed")],
        new PublicKey15(hop.program)
      )[0].toBase58();
      if (va.owner.toBase58() !== authority || vb.owner.toBase58() !== authority)
        fail14("CPMM vault authority mismatch.");
      if (p.mintProgramA.toBase58() !== need4(s, hop.mintA).owner || p.mintProgramB.toBase58() !== need4(s, hop.mintB).owner || p.mintDecimalA !== mintInfo(hop.mintA, need4(s, hop.mintA)).decimals || p.mintDecimalB !== mintInfo(hop.mintB, need4(s, hop.mintB)).decimals)
        fail14("CPMM mint program/decimals mismatch.");
      if ((p.status & 4) !== 0 || time <= n2(p.openTime))
        fail14("CPMM swaps disabled or pool not open.");
      const ra = va.amount - n2(p.protocolFeesMintA) - n2(p.fundFeesMintA) - n2(p.creatorFeesMintA);
      const rb = vb.amount - n2(p.protocolFeesMintB) - n2(p.fundFeesMintB) - n2(p.creatorFeesMintB);
      if (ra < 0n || rb < 0n)
        fail14("CPMM recorded fees exceed vault balances; reserves are inconsistent.");
      if (ra <= 0n || rb <= 0n)
        throw new ExecutionEngineError19(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "CPMM has no available reserves."
        );
      if (![0, 1, 2].includes(p.feeOn)) fail14("CPMM creator fee mode invalid.");
      const creatorOnInput = p.feeOn === 0 || (aToB ? p.feeOn === 1 : p.feeOn === 2);
      const creatorRate = p.enableCreatorFee ? c.creatorFeeRate : new BN3(0);
      if (n2(c.tradeFeeRate) + n2(creatorRate) >= 1000000n) fail14("CPMM fee rate invalid.");
      const q = CurveCalculator.swapBaseInput(
        new BN3(afterTransfer.toString()),
        new BN3((aToB ? ra : rb).toString()),
        new BN3((aToB ? rb : ra).toString()),
        c.tradeFeeRate,
        creatorRate,
        c.protocolFeeRate,
        c.fundFeeRate,
        creatorOnInput
      );
      output = n2(q.outputAmount);
      addFee("LP_FEE", mint, n2(q.tradeFee) - n2(q.protocolFee) - n2(q.fundFee));
      addFee("PROTOCOL_FEE", mint, n2(q.protocolFee));
      addFee("FUND_FEE", mint, n2(q.fundFee));
      addFee("CREATOR_FEE", creatorOnInput ? mint : outMint, n2(q.creatorFee));
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        reserveA: ra.toString(),
        reserveB: rb.toString(),
        outputBeforeTransfer: output.toString()
      });
    } else if (hop.program === RAYDIUM_LAUNCHLAB_PROGRAM && hop.platform === void 0) {
      const p = LaunchpadPool.decode(bytes2(poolAccount));
      const configAccount = need4(s, hop.config);
      if (configAccount.owner !== RAYDIUM_LAUNCHLAB_PROGRAM)
        fail14("LaunchLab config owner mismatch.");
      const config = LaunchpadConfig.decode(bytes2(configAccount));
      if (config.mintB.toBase58() !== hop.mintB || p.status !== 0 || ![0, 1].includes(config.curveType))
        fail14("Legacy LaunchLab state invalid.");
      const fee3 = (afterTransfer * n2(config.tradeFeeRate) + 999999n) / 1000000n;
      if (afterTransfer <= fee3)
        throw new ExecutionEngineError19("ZERO_EXECUTABLE_OUTPUT", "LaunchLab fee consumes input.");
      const curve = config.curveType === 0 ? LaunchConstantProductCurve : LinearPriceCurve;
      output = n2(
        aToB ? curve.sellExactIn({ poolInfo: p, amount: new BN3((afterTransfer - fee3).toString()) }) : curve.buyExactIn({ poolInfo: p, amount: new BN3((afterTransfer - fee3).toString()) })
      );
      addFee("PROTOCOL_FEE", mint, fee3);
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        virtualA: p.virtualA.toString(),
        virtualB: p.virtualB.toString(),
        realA: p.realA.toString(),
        realB: p.realB.toString(),
        curveType: config.curveType,
        tradeFeeRate: config.tradeFeeRate.toString(),
        outputBeforeTransfer: output.toString()
      });
    } else if (hop.program === RAYDIUM_LAUNCHLAB_PROGRAM) {
      const p = LaunchpadPool.decode(bytes2(poolAccount));
      const configAccount = need4(s, hop.config);
      if (configAccount.owner !== RAYDIUM_LAUNCHLAB_PROGRAM)
        fail14("LaunchLab config owner mismatch.");
      if (p.configId.toBase58() !== hop.config) fail14("LaunchLab config linkage changed.");
      if (bytes2(configAccount).length !== LaunchpadConfig.span)
        fail14("LAUNCHLAB_STATE_UNAVAILABLE: config size mismatch.");
      const config = LaunchpadConfig.decode(bytes2(configAccount));
      discriminator2(bytes2(configAccount), "GlobalConfig");
      const platformAccount = need4(s, p.platformId.toBase58());
      if (platformAccount.owner !== RAYDIUM_LAUNCHLAB_PROGRAM || bytes2(platformAccount).length !== PlatformConfig.span)
        fail14("LAUNCHLAB_STATE_UNAVAILABLE: platform config owner/size mismatch.");
      discriminator2(bytes2(platformAccount), "PlatformConfig");
      const platform = PlatformConfig.decode(bytes2(platformAccount));
      if (p.mintA.toBase58() !== hop.mintA || p.mintB.toBase58() !== hop.mintB || config.mintB.toBase58() !== hop.mintB || p.status !== 0)
        fail14(`LAUNCHLAB_STATE_UNAVAILABLE: pool identity/status ${p.status} is invalid.`);
      const expectedAuthority = getPdaLaunchpadAuth(
        new PublicKey15(hop.program)
      ).publicKey.toBase58();
      if (va.owner.toBase58() !== expectedAuthority || vb.owner.toBase58() !== expectedAuthority)
        fail14("LaunchLab vault authority mismatch.");
      const program2 = new PublicKey15(hop.program);
      if (getPdaLaunchpadPoolId(program2, p.mintA, p.mintB).publicKey.toBase58() !== hop.pool || getPdaLaunchpadVaultId(program2, new PublicKey15(hop.pool), p.mintA).publicKey.toBase58() !== hop.vaultA || getPdaLaunchpadVaultId(program2, new PublicKey15(hop.pool), p.mintB).publicKey.toBase58() !== hop.vaultB)
        fail14("LAUNCHLAB_STATE_UNAVAILABLE: pool/vault PDA mismatch.");
      if (inputMint.decimals !== (aToB ? p.mintDecimalsA : p.mintDecimalsB) || outputMint.decimals !== (aToB ? p.mintDecimalsB : p.mintDecimalsA) || need4(s, hop.mintA).owner !== ((p.mintProgramFlag & 1) === 0 ? SPL_TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID) || need4(s, hop.mintB).owner !== ((p.mintProgramFlag & 2) === 0 ? SPL_TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID) || ![0, 1, 2, 3].includes(p.mintProgramFlag))
        fail14("LAUNCHLAB_STATE_UNAVAILABLE: mint program/decimals mismatch.");
      if (![0, 1, 2].includes(config.curveType))
        fail14("LAUNCHLAB_QUOTE_FAILED: unsupported curve type.");
      if (n2(config.tradeFeeRate) + n2(platform.feeRate) + n2(platform.creatorFeeRate) >= 1000000n)
        fail14("LAUNCHLAB_QUOTE_FAILED: invalid total fee rate.");
      if (n2(p.realA) > n2(p.totalSellA) || config.curveType === 0 && n2(p.realA) >= n2(p.virtualA))
        fail14("LAUNCHLAB_STATE_UNAVAILABLE: inconsistent curve reserves.");
      if (aToB && afterTransfer > n2(p.realA))
        throw new ExecutionEngineError19(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "LAUNCHLAB_QUOTE_FAILED: SELL exceeds sold base quantity."
        );
      const params = {
        poolInfo: p,
        protocolFeeRate: config.tradeFeeRate,
        platformFeeRate: platform.feeRate,
        creatorFeeRate: platform.creatorFeeRate,
        shareFeeRate: new BN3(0),
        curveType: config.curveType,
        transferFeeConfigA: void 0,
        slot: 0
      };
      const q = aToB ? Curve.sellExactIn({ ...params, amountA: new BN3(afterTransfer.toString()) }) : Curve.buyExactIn({ ...params, amountB: new BN3(afterTransfer.toString()) });
      output = aToB ? n2(q.amountB) : n2(q.amountA.amount);
      const totalFee = n2(q.splitFee.protocolFee) + n2(q.splitFee.platformFee) + n2(q.splitFee.creatorFee);
      if (aToB && (afterTransfer > n2(p.realA) || output + totalFee > n2(p.realB)))
        throw new ExecutionEngineError19(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "LAUNCHLAB_QUOTE_FAILED: SELL exceeds real curve liquidity."
        );
      if (!aToB && n2(q.amountB) < afterTransfer) {
        if (hops.length !== 1)
          throw new ExecutionEngineError19(
            "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
            "LAUNCHLAB_BUY_CAP: composed input exceeds remaining sale."
          );
        consumedInput = n2(q.amountB);
      }
      addFee("PROTOCOL_FEE", hop.mintB, n2(q.splitFee.protocolFee));
      addFee("PLATFORM_FEE", hop.mintB, n2(q.splitFee.platformFee));
      addFee("CREATOR_FEE", hop.mintB, n2(q.splitFee.creatorFee));
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        virtualA: p.virtualA.toString(),
        virtualB: p.virtualB.toString(),
        realA: p.realA.toString(),
        realB: p.realB.toString(),
        curveType: config.curveType,
        tradeFeeRate: config.tradeFeeRate.toString(),
        platformFeeRate: platform.feeRate.toString(),
        creatorFeeRate: platform.creatorFeeRate.toString(),
        stage: "LAUNCHLAB_ACTIVE",
        outputBeforeTransfer: output.toString()
      });
    } else {
      const p = dammPool(bytes2(poolAccount));
      const point = p.activationType === 0 ? slot : time;
      if (!isSwapEnabled(p, new BN3(point.toString())))
        fail14("DAMM v2 swaps disabled or activation pending.");
      const mode = getFeeMode(p.collectFeeMode, aToB ? 0 : 1, false);
      if (va.owner.toBase58() !== derivePoolAuthority().toBase58() || vb.owner.toBase58() !== derivePoolAuthority().toBase58())
        fail14("DAMM v2 vault authority mismatch.");
      let q;
      try {
        q = getSwapResultFromExactInput(
          p,
          new BN3(afterTransfer.toString()),
          mode,
          aToB ? 0 : 1,
          new BN3(point.toString())
        );
      } catch (error) {
        if (error instanceof InsufficientLiquidityError)
          throw new ExecutionEngineError19(
            "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
            "DAMM v2 price range exhausted."
          );
        throw error;
      }
      if (!q.amountLeft.isZero())
        throw new ExecutionEngineError19(
          "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
          "DAMM v2 price range cannot execute all input."
        );
      output = n2(q.outputAmount);
      const feeMint = mode.feesOnInput ? mint : outMint;
      addFee("LP_CLAIM_FEE", feeMint, n2(q.claimingFee));
      addFee("LP_COMPOUND_FEE", feeMint, n2(q.compoundingFee));
      addFee("PROTOCOL_FEE", feeMint, n2(q.protocolFee));
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        outputBeforeTransfer: output.toString(),
        sqrtPrice: p.sqrtPrice.toString(10),
        liquidity: p.liquidity.toString(10),
        reserveA: p.tokenAAmount.toString(10),
        reserveB: p.tokenBAmount.toString(10),
        nextSqrtPrice: q.nextSqrtPrice.toString(10)
      });
    }
    if (output < 0n) fail14("Protocol returned a negative route output.");
    if (output > (aToB ? vb : va).amount)
      throw new ExecutionEngineError19(
        "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
        "Output exceeds actual vault liquidity."
      );
    amount = transfer(outMint, output, outputMint);
    const detail = details.at(-1);
    details[details.length - 1] = {
      ...detail,
      inputMint: mint,
      outputMint: outMint,
      inputDecimals: inputMint.decimals,
      outputDecimals: outputMint.decimals,
      inputAfterTransfer: afterTransfer.toString(),
      inputTransferFee: (BigInt(detail["input"]) - afterTransfer).toString(),
      outputTransferFee: (output - amount).toString(),
      direction: aToB ? "A_TO_B" : "B_TO_A",
      outputAfterTransfer: amount.toString(),
      stateSlot: state.chainSlot?.toString() ?? null
    };
    mint = outMint;
    if (amount <= 0n)
      throw new ExecutionEngineError19(
        "ZERO_EXECUTABLE_OUTPUT",
        "Route output rounds to zero after fees."
      );
  }
  if (mint !== (endMint ?? (buy ? state.identity.tokenMint : WRAPPED_SOL_MINT)))
    fail14("Route output mint mismatch.");
  return { output: amount, consumedInput, fees, details };
}
function quoteSelectedRoute(state, input, buy) {
  const capped = (error) => error instanceof ExecutionEngineError19 && error.message.startsWith("LAUNCHLAB_BUY_CAP:");
  try {
    return quoteRoute(state, input, buy);
  } catch (error) {
    if (!(error instanceof ExecutionEngineError19) && snapshot(state).hops.some((h) => h.program === RAYDIUM_LAUNCHLAB_PROGRAM))
      fail14(
        `LAUNCHLAB_QUOTE_FAILED: ${error instanceof Error ? error.message : "SDK curve failure."}`
      );
    if (!buy || !capped(error)) throw error;
  }
  let low = 0n, high = input;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    try {
      quoteRoute(state, mid, true);
      low = mid;
    } catch (error) {
      if (capped(error)) high = mid - 1n;
      else if (error instanceof ExecutionEngineError19 && error.code === "ZERO_EXECUTABLE_OUTPUT")
        low = mid;
      else throw error;
    }
  }
  const q = quoteRoute(state, low, true);
  return { ...q, consumedInput: low };
}
function quoteRecordedRoute(state, input, buy) {
  if (state.normalizedState["routePolicy"] === "FIXED_TOPOLOGY_V1")
    return quoteSelectedRoute(state, input, buy);
  const routes = state.normalizedState["candidateRoutes"];
  if (!routes?.length) return quoteSelectedRoute(state, input, buy);
  let best;
  const failures = [];
  for (const hops of routes) {
    try {
      const quote = quoteSelectedRoute(
        { ...state, normalizedState: { ...state.normalizedState, hops } },
        input,
        buy
      );
      if (!best || quote.output > best.output) best = quote;
    } catch (error2) {
      failures.push(error2);
    }
  }
  if (best) return best;
  const error = failures.find(
    (e) => !(e instanceof ExecutionEngineError19) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(e.code)
  ) ?? failures[0];
  throw error ?? new ExecutionEngineError19("MARKET_STATE_UNAVAILABLE", "No validated route quote is available.");
}
var PublicMarketCandidates = class {
  cache = /* @__PURE__ */ new Map();
  async json(url) {
    const r = await fetch(url, {
      signal: advisoryReadContext()?.signal ?? AbortSignal.timeout(12e3)
    });
    if (!r.ok) fail14(`Market discovery HTTP ${r.status}.`);
    return r.json();
  }
  async pools(mint) {
    const cached = this.cache.get(mint);
    if (cached && cached.until > Date.now()) return cached.pools;
    const data = await this.json(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
    if (!Array.isArray(data)) fail14("Invalid discovery response.");
    const pools = [...new Set(data.map((p) => p.pairAddress))].filter((p) => typeof p === "string").sort().slice(0, 30);
    try {
      const quote = await this.json(
        `https://lite-api.jup.ag/ultra/v1/order?inputMint=${mint}&outputMint=${WRAPPED_SOL_MINT}&amount=1000000`
      );
      for (const step of quote.routePlan ?? []) {
        const info4 = step.swapInfo;
        if (!info4?.ammKey) continue;
        pools.push(info4.ammKey);
      }
    } catch {
    }
    const uniquePools = [...new Set(pools)].sort().slice(0, 40);
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value);
    if (uniquePools.length) this.cache.set(mint, { until: Date.now() + 1e4, pools: uniquePools });
    return uniquePools;
  }
  async context(address3) {
    const data = await this.json(
      `https://api.dexscreener.com/latest/dex/pairs/solana/${address3}`
    );
    const dex = [
      ...new Set((data.pairs ?? []).flatMap((p) => [p.baseToken.address, p.quoteToken.address]))
    ];
    return dex;
  }
};
var SolanaRouteSource = class {
  constructor(rpc, candidates = new PublicMarketCandidates(), log = () => void 0) {
    this.rpc = rpc;
    this.candidates = candidates;
    this.log = log;
  }
  rpc;
  candidates;
  log;
  topology = /* @__PURE__ */ new Map();
  report(event, metadata) {
    try {
      this.log(event, metadata);
    } catch {
    }
  }
  async requireSupportedPumpMigration(mint, curve) {
    if (!curve.complete || [PublicKey15.default.toBase58(), WRAPPED_SOL_MINT].includes(curve.quoteMint))
      return;
    const pool = await canonicalPumpSwapPoolAddress(mint, curve.quoteMint);
    const response = await this.rpc.getMultipleAccounts([pool]);
    const account = response.value[0];
    if (!account) fail14(`Migrated non-SOL PumpSwap state is unavailable: ${pool}.`);
    if (account.owner !== PUMP_AMM_PROGRAM_ID) fail14("Migrated PumpSwap pool owner mismatch.");
    const decoded = decodePumpSwapPool(Buffer.from(account.data[0], "base64"));
    if (decoded.baseMint !== mint || decoded.quoteMint !== curve.quoteMint)
      fail14("Migrated PumpSwap mint linkage mismatch.");
    this.report("UNSUPPORTED_CANONICAL_MIGRATION", {
      mint,
      quoteMint: curve.quoteMint,
      pool,
      slot: response.context.slot
    });
    fail14(
      `Canonical non-SOL PumpSwap execution is not supported yet (${pool}, quote ${curve.quoteMint}).`
    );
  }
  async launchPools(mint) {
    const canonical = getPdaLaunchpadPoolId(
      new PublicKey15(RAYDIUM_LAUNCHLAB_PROGRAM),
      new PublicKey15(mint),
      new PublicKey15(WRAPPED_SOL_MINT)
    ).publicKey.toBase58();
    const direct = await this.rpc.getMultipleAccounts([canonical]);
    let addresses = [canonical];
    if (!direct.value[0] && this.rpc.getProgramAccountAddresses) {
      try {
        addresses = await this.rpc.getProgramAccountAddresses(
          RAYDIUM_LAUNCHLAB_PROGRAM,
          mint,
          LaunchpadPool.offsetOf("mintA"),
          LaunchpadPool.span
        );
      } catch (error) {
        this.report("LAUNCHLAB_DISCOVERY_RPC_FAILED", {
          mint,
          stage: "getProgramAccounts",
          message: error instanceof Error ? error.message : String(error)
        });
        const hints = (await this.candidates.pools(mint)).slice(0, 16);
        const hinted = await this.rpc.getMultipleAccounts(hints);
        addresses = hints.filter((_, i) => hinted.value[i]?.owner === RAYDIUM_LAUNCHLAB_PROGRAM);
        if (!addresses.length) throw error;
        this.report("LAUNCHLAB_DISCOVERY_VERIFIED_HINTS", { mint, pools: addresses });
      }
    }
    if (!addresses.length) return [];
    const response = addresses[0] === canonical ? direct : await this.rpc.getMultipleAccounts(addresses);
    const links = [];
    for (const [i, address3] of addresses.entries()) {
      const account = response.value[i];
      if (!account) continue;
      if (account.owner !== RAYDIUM_LAUNCHLAB_PROGRAM)
        fail14("LAUNCHLAB_STATE_UNAVAILABLE: pool owner mismatch.");
      const link2 = decodePoolLink(address3, captured(account));
      if (link2.mintA !== mint) fail14("LAUNCHLAB_STATE_UNAVAILABLE: base mint mismatch.");
      if (getPdaLaunchpadPoolId(
        new PublicKey15(link2.program),
        new PublicKey15(link2.mintA),
        new PublicKey15(link2.mintB)
      ).publicKey.toBase58() !== address3)
        fail14("LAUNCHLAB_STATE_UNAVAILABLE: discovered pool PDA mismatch.");
      links.push(link2);
    }
    return links;
  }
  async capture(identity, paths) {
    const addresses = [
      .../* @__PURE__ */ new Set([
        CLOCK7,
        ...paths.flatMap(
          (hops) => hops.flatMap((h) => [
            h.pool,
            h.mintA,
            h.mintB,
            h.vaultA,
            h.vaultB,
            ...h.config ? [h.config] : [],
            ...h.platform ? [h.platform] : [],
            ...h.extraAccounts ?? []
          ])
        )
      ])
    ];
    if (addresses.length > 100) fail14("Route snapshot exceeds the atomic RPC account limit.");
    const response = await this.rpc.getMultipleAccounts(addresses);
    if (!Number.isSafeInteger(response.context.slot) || response.context.slot < 0 || response.value.length !== addresses.length)
      fail14("Route RPC account cardinality/slot is malformed.");
    const accounts = {};
    for (const [i, address3] of addresses.entries()) {
      const a = response.value[i];
      if (a) accounts[address3] = captured(a);
    }
    const token2 = mintInfo(
      identity.tokenMint,
      need4({ accounts }, identity.tokenMint)
    );
    return paths.map((hops) => ({
      identity,
      observedAt: utcInstant3(/* @__PURE__ */ new Date()),
      chainSlot: BigInt(response.context.slot),
      chainBlockId: null,
      adapterVersion: VERSION2,
      normalizationVersion: "solana-route-accounts-launchlab-v2",
      normalizedState: {
        model: "SOLANA_COMPOSED_ROUTE",
        ...advisoryReadContext() ? {
          chainTime: advisoryClockTime(
            response.value[addresses.indexOf(CLOCK7)],
            response.context.slot
          )
        } : {},
        tokenDecimals: token2.decimals.toString(),
        mintSupply: token2.supply.toString(),
        hops,
        candidateRoutes: paths,
        accounts,
        absentAccounts: addresses.filter((_, i) => response.value[i] === null)
      }
    }));
  }
  async validateSnapshot(candidate) {
    const state = {
      ...candidate,
      normalizedState: {
        ...candidate.normalizedState,
        routePolicy: "FIXED_TOPOLOGY_V1",
        candidateRoutes: [candidate.normalizedState["hops"]]
      }
    };
    const s = snapshot(state);
    need4(s, CLOCK7);
    for (const hop of s.hops) {
      for (const address3 of [
        hop.pool,
        hop.mintA,
        hop.mintB,
        hop.vaultA,
        hop.vaultB,
        ...hop.config ? [hop.config] : [],
        ...hop.platform ? [hop.platform] : []
      ])
        need4(s, address3);
      mintInfo(hop.mintA, need4(s, hop.mintA));
      mintInfo(hop.mintB, need4(s, hop.mintB));
      const isolated = { ...state, normalizedState: { ...state.normalizedState, hops: [hop] } };
      for (const [inputMint, outputMint] of [
        [hop.mintA, hop.mintB],
        [hop.mintB, hop.mintA]
      ]) {
        try {
          quoteRoute(isolated, 1000000n, false, inputMint, outputMint);
        } catch (error) {
          if (!(error instanceof ExecutionEngineError19) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(error.code))
            throw error;
        }
      }
    }
    for (const buy of [true, false]) {
      try {
        quoteSelectedRoute(state, 1000000n, buy);
      } catch (error) {
        if (!(error instanceof ExecutionEngineError19) || !["ZERO_EXECUTABLE_OUTPUT", "INSUFFICIENT_EXECUTABLE_LIQUIDITY"].includes(error.code))
          throw error;
      }
    }
    this.report("ROUTE_SNAPSHOT_READY", {
      mint: state.identity.tokenMint,
      route: executionRouteRecord4(state, false),
      hops: s.hops,
      slot: state.chainSlot?.toString() ?? null
    });
    return state;
  }
  async chartMetadata(address3) {
    const context = await this.rpc.getMultipleAccounts([address3]);
    const owner = context.value[0]?.owner;
    const mint = owner && [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(owner) ? address3 : await this.resolveContext(address3);
    const response = await this.rpc.getMultipleAccounts([mint]);
    const account = response.value[0];
    if (!account || ![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(account.owner))
      throw new Error("CHART_TOKEN_METADATA_MISSING");
    const info4 = unpackMint3(new PublicKey15(mint), accountInfo(captured(account)), new PublicKey15(account.owner));
    if (!info4.isInitialized) throw new Error("CHART_TOKEN_METADATA_MISSING");
    if (!Number.isInteger(info4.decimals) || info4.decimals < 0 || info4.decimals > 18)
      throw new Error("INVALID_TOKEN_DECIMALS");
    if (info4.supply <= 0n) throw new Error("AUTHORITATIVE_SUPPLY_UNAVAILABLE");
    return {
      requestedContext: address3,
      mint,
      tokenProgram: account.owner,
      tokenDecimals: info4.decimals,
      tokenSupplyBaseUnits: info4.supply.toString(),
      chainSlot: response.context.slot.toString()
    };
  }
  async resolveContext(address3) {
    const response = await this.rpc.getMultipleAccounts([address3]);
    const a = response.value[0];
    if (!a) fail14("Terminal context account was not found on Solana.");
    if ([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner)) {
      mintInfo(address3, captured(a));
      return address3;
    }
    if ([RAYDIUM_CPMM_PROGRAM, RAYDIUM_LAUNCHLAB_PROGRAM, METEORA_DAMM_V2_PROGRAM].includes(a.owner)) {
      const link2 = decodePoolLink(address3, captured(a));
      return link2.mintA === WRAPPED_SOL_MINT ? link2.mintB : link2.mintA;
    }
    if (a.owner === "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA")
      return decodePumpSwapPool(Buffer.from(a.data[0], "base64")).baseMint;
    const hints = a.owner === PUMP_PROGRAM_ID ? await this.rpc.getOwnedTokenMints(address3) : await this.candidates.context(address3);
    for (const mint of hints) {
      if (mint === WRAPPED_SOL_MINT) continue;
      if (a.owner === PUMP_PROGRAM_ID && await pumpBondingCurveAddress(mint) === address3)
        return mint;
      if (a.owner === "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA" && decodePumpSwapPool(Buffer.from(a.data[0], "base64")).baseMint === mint)
        return mint;
      if ([RAYDIUM_CPMM_PROGRAM, RAYDIUM_LAUNCHLAB_PROGRAM, METEORA_DAMM_V2_PROGRAM].includes(a.owner)) {
        const p = decodePoolLink(address3, captured(a));
        if (p.mintA === mint || p.mintB === mint) return mint;
      }
    }
    return fail14("Terminal market could not be bound to a verified token mint.");
  }
  async loadMarketState(identity) {
    if (identity.protocolId !== SOLANA_ROUTE_PROTOCOL_ID || identity.marketId !== `solana-route:${identity.tokenMint}`)
      fail14("Route identity mismatch.");
    const cached = this.topology.get(identity.tokenMint);
    if (cached && cached.until > Date.now()) {
      try {
        const [state] = await this.capture(identity, [structuredClone(cached.hops)]);
        return await this.validateSnapshot(state);
      } catch (error) {
        this.topology.delete(identity.tokenMint);
        this.report("ROUTE_CACHE_INVALIDATED", {
          mint: identity.tokenMint,
          reason: error instanceof ExecutionEngineError19 ? error.code : "INVALID_MARKET_STATE"
        });
        throw error;
      }
    }
    const diagnostics = [];
    const curveAddress = await pumpBondingCurveAddress(identity.tokenMint);
    const curveResponse = await this.rpc.getMultipleAccounts([curveAddress]);
    const curveAccount = curveResponse.value[0];
    let pump;
    if (curveAccount?.owner === PUMP_PROGRAM_ID) {
      const curve = decodePumpBondingCurve(Buffer.from(curveAccount.data[0], "base64"));
      await this.requireSupportedPumpMigration(identity.tokenMint, curve);
      if (!curve.complete && ![PublicKey15.default.toBase58(), WRAPPED_SOL_MINT].includes(curve.quoteMint)) {
        const mints = await this.rpc.getMultipleAccounts([identity.tokenMint, curve.quoteMint]);
        if (!mints.value[0] || !mints.value[1]) fail14("Pump route mint state is unavailable.");
        pump = pumpLink(
          curveAddress,
          captured(curveAccount),
          identity.tokenMint,
          mints.value[0].owner,
          mints.value[1].owner
        );
      }
    }
    const launches = pump ? [] : await this.launchPools(identity.tokenMint).catch((error) => {
      this.report("LAUNCHLAB_STATE_UNAVAILABLE", {
        mint: identity.tokenMint,
        message: error instanceof Error ? error.message : "Launch-state discovery failed."
      });
      if (error instanceof ExecutionEngineError19)
        throw new ExecutionEngineError19(
          error.code,
          `LAUNCHLAB_STATE_UNAVAILABLE: ${error.message}`
        );
      return fail14("LAUNCHLAB_STATE_UNAVAILABLE: launch-state discovery failed.");
    });
    let launchStage = null;
    const active = pump ? [pump] : [];
    for (const link2 of launches) {
      const response = await this.rpc.getMultipleAccounts([link2.pool]);
      const account = response.value[0];
      if (!account) fail14("LAUNCHLAB_STATE_UNAVAILABLE: pool disappeared.");
      const p = LaunchpadPool.decode(bytes2(captured(account)));
      const stage = ["LAUNCHLAB_ACTIVE", "LAUNCHLAB_MIGRATING", "LAUNCHLAB_MIGRATED"][p.status] ?? "LAUNCHLAB_STATE_UNAVAILABLE";
      this.report(stage, { mint: identity.tokenMint, pool: link2.pool, status: p.status });
      if (p.status === 0) active.push(link2);
      else if (p.status === 1)
        fail14("LAUNCHLAB_MIGRATING: funding ended; awaiting on-chain migration.");
      else if (p.status === 2) launchStage = "LAUNCHLAB_MIGRATED";
      else fail14(`LAUNCHLAB_STATE_UNAVAILABLE: unknown status ${p.status}.`);
    }
    const find = async (mint, seen, depth) => {
      if (mint === WRAPPED_SOL_MINT) return [[]];
      if (depth === 0) return [];
      const addresses = [...await this.candidates.pools(mint)];
      const curve = await pumpBondingCurveAddress(mint);
      if (!addresses.includes(curve)) addresses.push(curve);
      if (!addresses.length) return [];
      const response = await this.rpc.getMultipleAccounts(addresses);
      const links = [];
      for (const [i, address3] of addresses.entries()) {
        const a = response.value[i];
        if (!a) continue;
        try {
          let p;
          if (a.owner === PUMP_PROGRAM_ID) {
            const raw = captured(a);
            const quoteMint = pumpQuoteMint(raw);
            const mints = await this.rpc.getMultipleAccounts([mint, quoteMint]);
            if (!mints.value[0] || !mints.value[1]) fail14("Pump route mint state is unavailable.");
            p = pumpLink(address3, raw, mint, mints.value[0].owner, mints.value[1].owner);
          } else p = decodePoolLink(address3, captured(a));
          if (p.program === RAYDIUM_LAUNCHLAB_PROGRAM && LaunchpadPool.decode(bytes2(captured(a))).status !== 0)
            continue;
          if (p.mintA === mint || p.mintB === mint) links.push(p);
        } catch (error) {
          if (error instanceof ExecutionEngineError19 && error.code === "RPC_UNAVAILABLE")
            throw error;
          diagnostics.push(error instanceof Error ? error.message : "Invalid pool.");
        }
      }
      links.sort(
        (a, b) => Number(!(a.mintA === WRAPPED_SOL_MINT || a.mintB === WRAPPED_SOL_MINT)) - Number(!(b.mintA === WRAPPED_SOL_MINT || b.mintB === WRAPPED_SOL_MINT)) || a.pool.localeCompare(b.pool)
      );
      const direct = links.filter(
        (p) => p.mintA === WRAPPED_SOL_MINT || p.mintB === WRAPPED_SOL_MINT
      );
      const paths2 = direct.slice(0, 6).map((p) => [p]);
      for (const link2 of links.filter((p) => !direct.includes(p))) {
        const other = link2.mintA === mint ? link2.mintB : link2.mintA;
        if (seen.has(other)) continue;
        const tails = await find(other, /* @__PURE__ */ new Set([...seen, other]), depth - 1);
        for (const tail of tails) paths2.push([link2, ...tail]);
        if (paths2.length >= 8) break;
      }
      return paths2;
    };
    const paths = [];
    if (active.length) {
      for (const link2 of active) {
        const tails = link2.mintB === WRAPPED_SOL_MINT ? [[]] : await find(link2.mintB, /* @__PURE__ */ new Set([identity.tokenMint, link2.mintB]), 2);
        for (const tail of tails) paths.push([link2, ...tail]);
      }
    } else {
      paths.push(...await find(identity.tokenMint, /* @__PURE__ */ new Set([identity.tokenMint]), 3));
    }
    paths.sort(
      (a, b) => a.length - b.length || a.map((h) => h.pool).join("/").localeCompare(b.map((h) => h.pool).join("/"))
    );
    if (!paths.length)
      return fail14(
        `${launchStage ? "MIGRATED_ROUTE_UNAVAILABLE: " : ""}No authoritative SOL route resolved. ${diagnostics.slice(-8).join(" ")}`
      );
    const states = await this.capture(identity, paths.slice(0, 4));
    let best;
    let bestScore = -2n;
    for (const candidate of states) {
      const state = candidate;
      try {
        const validated = await this.validateSnapshot(state);
        let score = -1n;
        try {
          const buy = quoteSelectedRoute(validated, 1000000000n, true);
          const reverse = quoteSelectedRoute(validated, buy.output, false);
          score = reverse.output * 1000000000n / buy.consumedInput;
        } catch (error) {
          if (!(error instanceof ExecutionEngineError19) || ![
            "ZERO_EXECUTABLE_OUTPUT",
            "INSUFFICIENT_EXECUTABLE_LIQUIDITY",
            "MARKET_STATE_UNAVAILABLE"
          ].includes(error.code))
            throw error;
          this.report("ROUTE_REFERENCE_CAPACITY_UNAVAILABLE", {
            mint: identity.tokenMint,
            hops: validated.normalizedState["hops"],
            code: error.code,
            message: error.message
          });
        }
        if (score > bestScore) {
          best = validated;
          bestScore = score;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid route snapshot";
        diagnostics.push(message);
        this.report("ROUTE_REJECTED", {
          mint: identity.tokenMint,
          hops: state.normalizedState["hops"] ?? null,
          slot: state.chainSlot?.toString() ?? null,
          message,
          code: error instanceof ExecutionEngineError19 ? error.code : "INVALID_MARKET_STATE"
        });
      }
    }
    if (best) {
      if (this.topology.size >= 256) this.topology.delete(this.topology.keys().next().value);
      this.topology.set(identity.tokenMint, {
        until: Date.now() + 1e4,
        hops: structuredClone(best.normalizedState["hops"])
      });
      this.report("ROUTE_SELECTED", {
        mint: identity.tokenMint,
        route: executionRouteRecord4(best, false),
        referenceInput: "1000000000",
        referenceRecoveryRatioPpb: bestScore < 0n ? null : bestScore.toString()
      });
      return best;
    }
    return fail14(`No authoritative SOL route resolved. ${diagnostics.slice(-8).join(" ")}`);
  }
};
var SolanaRouteAdapter = class {
  constructor(source) {
    this.source = source;
  }
  source;
  protocolId = SOLANA_ROUTE_PROTOCOL_ID;
  adapterVersion = VERSION2;
  loadMarketState(identity) {
    return this.source.loadMarketState(identity);
  }
  quote(identity, state, amount, buy) {
    if (identity.protocolId !== state.identity.protocolId || identity.marketId !== state.identity.marketId || identity.tokenMint !== state.identity.tokenMint)
      fail14("Quote mint/market does not match evidence.");
    return quoteRecordedRoute(state, amount, buy);
  }
  async simulateBuy(request, state) {
    return this.execute(request, state, request.requestedPaperSol, true);
  }
  async simulateSell(request, state) {
    return this.execute(request, state, request.requestedTokenQuantity, false);
  }
  execute(request, state, amount, buy) {
    const q = this.quote(request.identity, state, amount, buy);
    const input = asset(buy ? WRAPPED_SOL_MINT : request.identity.tokenMint, q.consumedInput), output = asset(buy ? request.identity.tokenMint : WRAPPED_SOL_MINT, q.output);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: createMarketStateEvidence7(state).fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput: asset(buy ? WRAPPED_SOL_MINT : request.identity.tokenMint, amount),
        simulatedOutput: output,
        fees: q.fees
      },
      actualInput: input,
      actualOutput: output,
      executedAt: request.executedAt,
      executionDetails: { hops: q.details }
    };
  }
  async valuePositionForExit(request, state) {
    const q = this.quote(request.identity, state, request.tokenQuantity, false);
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits9(q.output),
      route: executionRouteRecord4(state, false, q.details),
      feeBreakdown: {
        fees: q.fees,
        totalPaperSolFees: paperSolBaseUnits9(
          q.fees.reduce(
            (sum, f) => sum + (f.amount.asset === "PAPER_SOL" ? f.amount.amount : 0n),
            0n
          )
        )
      },
      marketStateFingerprint: createMarketStateEvidence7(state).fingerprint,
      adapterVersion: this.adapterVersion
    };
  }
  async maxExecutableSellQuantity(request, state) {
    const s = snapshot(state);
    if (!s.hops.some((h) => [RAYDIUM_LAUNCHLAB_PROGRAM, PUMP_PROGRAM_ID].includes(h.program)))
      throw new ExecutionEngineError19(
        "MARKET_STATE_UNAVAILABLE",
        "Exact composed-route exit capacity is unavailable."
      );
    let low = 0n, high = request.tokenQuantity;
    while (low < high) {
      const mid = (low + high + 1n) / 2n;
      try {
        this.quote(request.identity, state, mid, false);
        low = mid;
      } catch (error) {
        if (!(error instanceof ExecutionEngineError19)) throw error;
        if (error.code === "ZERO_EXECUTABLE_OUTPUT") low = mid;
        else if (error.code === "INSUFFICIENT_EXECUTABLE_LIQUIDITY") high = mid - 1n;
        else throw error;
      }
    }
    if (low > 0n) {
      try {
        this.quote(request.identity, state, low, false);
        return tokenBaseUnits6(low);
      } catch (error) {
        if (!(error instanceof ExecutionEngineError19) || error.code !== "ZERO_EXECUTABLE_OUTPUT")
          throw error;
      }
    }
    return tokenBaseUnits6(0n);
  }
};
function installSolanaMintResolver(router, source, capability) {
  router.chartMetadataResolver = (address3) => source.chartMetadata(address3);
  router.contextResolver = (address3) => source.resolveContext(address3);
  const generic = (mint) => ({
    protocolId: SOLANA_ROUTE_PROTOCOL_ID,
    marketId: identifier14(`solana-route:${mint}`, "MarketId"),
    tokenMint: identifier14(mint, "TokenMint")
  });
  router.mintResolver = async (mint) => {
    const route = await router.canonicalResolver(generic(mint));
    return [PUMP_FUN_PROTOCOL_ID, PUMP_SWAP_PROTOCOL_ID].includes(
      route.executionIdentity.protocolId
    ) ? {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: identifier14(await pumpBondingCurveAddress(mint), "MarketId"),
      tokenMint: identifier14(mint, "TokenMint")
    } : generic(mint);
  };
  router.canonicalResolver = async (identity) => {
    const mint = identity.tokenMint;
    const curveAddress = await pumpBondingCurveAddress(mint);
    const response = await source.rpc.getMultipleAccounts([curveAddress]);
    const account = response.value[0];
    let executionIdentity = generic(mint);
    if (account) {
      if (account.owner !== PUMP_PROGRAM_ID) fail14("Canonical Pump curve owner mismatch.");
      const curve = decodePumpBondingCurve(Buffer.from(account.data[0], "base64"));
      const nativeQuote = [PublicKey15.default.toBase58(), WRAPPED_SOL_MINT].includes(
        curve.quoteMint
      );
      if (!nativeQuote && curve.complete && capability) {
        executionIdentity = await capability.resolveNonSolPumpSwap(mint, curve.quoteMint);
      } else {
        await source.requireSupportedPumpMigration(mint, curve);
      }
      if (nativeQuote) {
        const active = !curve.complete && curve.realTokenReserves > 0n;
        executionIdentity = {
          protocolId: active ? PUMP_FUN_PROTOCOL_ID : PUMP_SWAP_PROTOCOL_ID,
          marketId: identifier14(
            active ? curveAddress : await canonicalPumpSwapPoolAddress(mint),
            "MarketId"
          ),
          tokenMint: mint
        };
      }
    }
    source.report("ROUTE_DISCOVERED", {
      mint,
      origin: identity.marketId,
      protocol: executionIdentity.protocolId,
      market: executionIdentity.marketId,
      discoverySlot: response.context.slot
    });
    return {
      originIdentity: identity,
      executionIdentity,
      migrated: executionIdentity.marketId !== identity.marketId
    };
  };
}

// packages/protocols/src/production.ts
function createProductionExecutionRouter(options) {
  const rpc = new SolanaRpcClient({
    url: options.rpcUrl,
    timeoutMs: options.rpcTimeoutMs,
    commitment: options.commitment,
    ...options.log ? { log: options.log } : {}
  });
  const log = options.log ?? (() => void 0);
  const routes = new SolanaRouteSource(rpc, void 0, log);
  const allowed = options.nonSolPumpSwapEnabled === true ? validateNonSolPumpSwapRoutes2(options.nonSolPumpSwapRoutes) : options.nonSolPumpSwapRoutes ?? [];
  const nonSol = new NonSolPumpSwapSource(rpc, allowed);
  const generic = new GenericPumpSwapSource(rpc);
  const router = new ExecutionRouter3([
    new PumpFunProtocolAdapter(new PumpFunSolanaMarketStateSource(rpc, log), log),
    new PumpSwapProtocolAdapter(new PumpSwapSolanaMarketStateSource(rpc, log), log),
    new SolanaRouteAdapter(routes),
    new NonSolPumpSwapAdapter(nonSol),
    new GenericPumpSwapAdapter(
      generic,
      () => options.genericPumpSwapBuysEnabled === true && genericOperation()?.permission.buy === true,
      () => genericOperation()?.permission
    )
  ]);
  if (options.log) router.diagnostic = options.log;
  router.setEnabled(NON_SOL_PUMP_SWAP_PROTOCOL_ID, options.nonSolPumpSwapEnabled === true);
  router.setEnabled(GENERIC_PUMP_SWAP_PROTOCOL_ID, options.genericPumpSwapEnabled === true);
  installSolanaMintResolver(
    router,
    routes,
    options.nonSolPumpSwapEnabled === true || options.genericPumpSwapEnabled === true ? {
      resolveNonSolPumpSwap: async (mint, quote) => {
        if (options.nonSolPumpSwapEnabled === true && allowed.some((r) => r.mint === mint && r.quoteMint === quote))
          return nonSol.resolve(mint, quote);
        if (options.genericPumpSwapEnabled !== true) return nonSol.resolve(mint, quote);
        const permission = await options.genericAccessResolver?.(
          mint,
          quote,
          genericOperation()?.settlement === true
        ) ?? DENY_GENERIC;
        recordGenericPermission(permission);
        if (permission.exitBinding) {
          if (permission.exitBinding.quoteMint !== quote || permission.exitBinding.targetPool !== await canonicalPumpSwapPoolAddress(mint, quote))
            throw new ExecutionEngineError20(
              "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
              "GENERIC_EXIT_QUOTE_CHANGED"
            );
          return generic.resolvePinned(mint, quote, permission.exitBinding.bridgePool);
        }
        if (!permission.discover)
          throw new ExecutionEngineError20(
            "POSITION_EXECUTION_ROUTE_UNAVAILABLE",
            "GENERIC_OPERATOR_ENTITLEMENT_REQUIRED"
          );
        return generic.resolve(mint, quote);
      }
    } : void 0
  );
  const load = router.loadPositionRoute.bind(router), mintResolver = router.mintResolver;
  router.loadPositionRoute = (identity, settlement = false) => withGenericOperation(settlement, () => load(identity, settlement));
  router.mintResolver = (mint) => withGenericOperation(false, () => mintResolver(mint));
  const resolve = router.canonicalResolver;
  router.canonicalResolver = async (identity) => {
    const context = advisoryReadContext(), start = performance.now();
    try {
      return await resolve(identity);
    } finally {
      if (context)
        context.metrics.routeDiscoveryMs = (context.metrics.routeDiscoveryMs ?? 0) + performance.now() - start;
    }
  };
  return router;
}

// apps/api/src/app.ts
import { withGenericActor as withGenericActor2 } from "./packages/protocols/dist/index.js";
import { randomUUID as randomUUID6 } from "node:crypto";
import fastify from "./node_modules/fastify/fastify.js";
import { ExecutionEngineError as ExecutionEngineError21 } from "./packages/execution/dist/index.js";

// apps/api/src/auth.ts
import { createHash as createHash20, createPublicKey as createPublicKey2, randomBytes, randomUUID as randomUUID5, verify as verify2 } from "node:crypto";
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
  const bytes3 = [];
  while (number > 0n) {
    bytes3.push(Number(number % 256n));
    number /= 256n;
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes3.push(0);
  }
  return Buffer.from(bytes3.reverse());
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
  constructor(database, redis, challengeTtlSeconds, sessionTtlSeconds, now = () => /* @__PURE__ */ new Date()) {
    this.database = database;
    this.redis = redis;
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
    const challengeId = randomUUID5();
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
    const id = `user:${createHash20("sha256").update(input.walletAddress).digest("hex")}`;
    await this.database.pool.query(
      `insert into users (id, wallet_address) values ($1, $2)
       on conflict (wallet_address) do nothing`,
      [id, input.walletAddress]
    );
    const user = (await this.database.pool.query(
      "select id, wallet_address from users where wallet_address = $1",
      [input.walletAddress]
    )).rows[0];
    const token2 = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + this.sessionTtlSeconds * 1e3);
    const session = {
      id: user.id,
      walletAddress: user.wallet_address,
      expiresAt: expiresAt.toISOString()
    };
    await this.redis.setExpiring(
      `auth:session:${token2}`,
      JSON.stringify(session),
      this.sessionTtlSeconds
    );
    return { token: token2, user: { id: session.id, walletAddress: session.walletAddress }, expiresAt };
  }
  async authenticate(token2) {
    if (!token2) return null;
    const raw = await this.redis.get(`auth:session:${token2}`);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return this.now() < new Date(session.expiresAt) ? { id: session.id, walletAddress: session.walletAddress } : null;
  }
  async logout(token2) {
    if (token2) await this.redis.delete(`auth:session:${token2}`);
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
    return Object.fromEntries(Object.entries(value).map(([key2, item]) => [key2, exactJson(item)]));
  }
  return value;
}
function cookieValue(request, name) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [key2, ...value] = cookie.trim().split("=");
    if (key2 === name) {
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
function stringField(body, key2, maxLength) {
  if (!body || typeof body !== "object")
    throw new ApiError("INVALID_REQUEST", "Request body must be an object.");
  const value = body[key2];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new ApiError("INVALID_REQUEST", `${key2} is invalid.`, 400, { field: key2 });
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
  const app = fastify({
    logger: dependencies.logger === false ? false : safeApiLoggerOptions(dependencies.config.LOG_LEVEL),
    // Only the local Cloudflare Tunnel may supply the forwarding chain.
    trustProxy: ["127.0.0.1", "::1"],
    genReqId: () => randomUUID6()
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
  app.addHook("onRequest", async (request, reply) => {
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
  app.setErrorHandler((error, request, reply) => {
    const domainError = error instanceof ApiError || error instanceof FinancialServiceError || error instanceof PayoutPlanError || error instanceof RewardAccountingError || error instanceof ExecutionEngineError21;
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
  app.get("/health", async () => ({ status: "ok", application: "paperfund-api" }));
  app.get("/ready", async (_request, reply) => {
    const [databaseReady, redisReady] = await Promise.all([
      dependencies.database.healthCheck(),
      dependencies.redis.healthCheck()
    ]);
    const services = {
      database: databaseReady ? "ok" : "unavailable",
      redis: redisReady ? "ok" : "unavailable"
    };
    const ready = databaseReady && redisReady;
    if (!ready) app.log.warn({ services }, "Infrastructure readiness check failed");
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ok" : "unavailable", services });
  });
  if (!dependencies.auth || !dependencies.competition) return app;
  const auth = dependencies.auth;
  const competition = dependencies.competition;
  async function user(request) {
    const authenticated = await auth.authenticate(sessionToken(request));
    if (!authenticated) throw new ApiError("UNAUTHENTICATED", "Authentication is required.", 401);
    requireBetaInvite(authenticated.walletAddress);
    return authenticated;
  }
  const scoped = (owner, intent, work) => withGenericActor2(
    {
      userId: owner.id,
      intent,
      isolateCaptures: dependencies.genericCapability?.options.armed === true
    },
    work
  );
  app.get("/api/v1/capabilities/generic-pumpswap", async (request, reply) => {
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
  app.post("/api/v1/capabilities/generic-pumpswap/control", async (request, reply) => {
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
      if (error instanceof ExecutionEngineError21)
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
  app.post("/api/v1/auth/challenge", { preHandler: rateLimit("auth") }, async (request, reply) => {
    const walletAddress = stringField(request.body, "walletAddress", 64);
    if (!isSolanaPublicKey(walletAddress))
      throw new ApiError("INVALID_REQUEST", "walletAddress is not a Solana public key.");
    requireBetaInvite(walletAddress);
    return reply.send(exactJson(await auth.createChallenge(walletAddress)));
  });
  app.post("/api/v1/auth/verify", { preHandler: rateLimit("auth") }, async (request, reply) => {
    try {
      const transport = request.body && typeof request.body === "object" ? request.body["transport"] : void 0;
      if (transport !== void 0 && transport !== "extension") {
        throw new ApiError("INVALID_REQUEST", "transport is invalid.");
      }
      requireBetaInvite(stringField(request.body, "walletAddress", 64));
      const result = await auth.verifyChallenge({
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
  app.post("/api/v1/auth/logout", async (request, reply) => {
    await auth.logout(sessionToken(request));
    reply.header("set-cookie", "paperfund_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
    return reply.code(204).send();
  });
  app.get("/api/v1/auth/me", async (request) => ({ user: await user(request) }));
  app.get("/api/v1/rounds/current", async () => {
    const now = /* @__PURE__ */ new Date();
    return exactJson({ round: await competition.getCurrentRound(), serverTime: now });
  });
  app.post(
    "/api/v1/rounds/current/enter",
    async (request) => exactJson(await competition.enterRound((await user(request)).id))
  );
  app.get("/api/v1/rounds/current/account", async (request) => {
    const account = await competition.getCurrentAccount((await user(request)).id);
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
  app.post("/api/v1/trades/buy", { preHandler: rateLimit("trade") }, async (request) => {
    const authenticated = await user(request);
    const mint = stringField(request.body, "mint", 64);
    if (!isSolanaPublicKey(mint)) throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    const result = await scoped(
      authenticated,
      "BUY",
      () => competition.buy(authenticated.id, {
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
  app.get("/api/v1/trades/buy-preflight", async (request, reply) => {
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
          () => competition.buyPreflight(
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
  app.post("/api/v1/trades/sell", { preHandler: rateLimit("trade") }, async (request) => {
    const authenticated = await user(request);
    const mint = stringField(request.body, "mint", 64);
    if (!isSolanaPublicKey(mint)) throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    const quantity = stringField(request.body, "quantity", 80);
    if (quantity !== "ALL" && !/^[1-9][0-9]*$/.test(quantity))
      throw new ApiError("INVALID_REQUEST", "quantity must be positive base units or ALL.");
    const result = await scoped(
      authenticated,
      "SELL",
      () => competition.sell(authenticated.id, {
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
  app.get("/api/v1/trades", async (request) => {
    const mint = request.query.mint;
    if (mint !== void 0 && (typeof mint !== "string" || !isSolanaPublicKey(mint)))
      throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    return exactJson(
      await competition.trades((await user(request)).id, pagination(request.query), mint)
    );
  });
  app.get("/api/v1/positions/viewed", async (request, reply) => {
    const mint = request.query.mint;
    if (typeof mint !== "string" || !isSolanaPublicKey(mint))
      throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3e3)]);
    const disconnected = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.on("close", disconnected);
    const wait = (task) => new Promise((resolve, reject5) => {
      const abort = () => reject5(
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
          reject5(error);
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
          scoped(owner, "READ", () => competition.viewedPosition(owner.id, mint, signal))
        ),
        requestId: request.id
      });
    } finally {
      reply.raw.removeListener("close", disconnected);
    }
  });
  app.get("/api/v1/positions", async (request, reply) => {
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
        () => competition.getPositions(
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
  app.get(
    "/api/v1/results/hourly",
    async (request) => exactJson(await competition.hourlyResults((await user(request)).id, pagination(request.query)))
  );
  app.get(
    "/api/v1/leaderboards/daily",
    async () => exactJson(await competition.dailyLeaderboard())
  );
  app.get("/api/v1/leaderboards/hourly/live", async (request) => {
    const roundId = request.query.roundId;
    if (roundId !== void 0 && (typeof roundId !== "string" || roundId.length > 128))
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(
      await competition.liveHourlyLeaderboard(typeof roundId === "string" ? roundId : void 0)
    );
  });
  app.get("/api/v1/leaderboards/hourly", async (request) => {
    const roundId = request.query.roundId;
    if (roundId !== void 0 && (typeof roundId !== "string" || roundId.length > 128))
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(
      await competition.hourlyLeaderboard(typeof roundId === "string" ? roundId : void 0)
    );
  });
  app.get(
    "/api/v1/competitions/daily/current",
    async () => exactJson({ competition: await competition.currentDailyCompetition(), serverTime: /* @__PURE__ */ new Date() })
  );
  app.get(
    "/api/v1/rewards/hourly/current",
    async () => exactJson(await competition.currentHourlyRewardPool())
  );
  app.get("/api/v1/rewards/hourly/:roundId", async (request) => {
    const roundId = request.params.roundId;
    if (roundId.length === 0 || roundId.length > 128)
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(await competition.hourlyRewardPool(roundId));
  });
  app.get("/api/v1/rewards/hourly/:roundId/reconciliation", async (request) => {
    const roundId = request.params.roundId;
    if (roundId.length === 0 || roundId.length > 128)
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(await competition.rewardReconciliation(roundId));
  });
  app.get(
    "/api/v1/rewards/daily/current",
    async () => exactJson(await competition.currentDailyRewardPool())
  );
  app.get("/api/v1/rewards/hourly/:roundId/winners", async (request) => {
    const roundId = request.params.roundId;
    if (roundId.length === 0 || roundId.length > 128)
      throw new ApiError("INVALID_REQUEST", "roundId is invalid.");
    return exactJson(await competition.hourlyPayoutWinners(roundId));
  });
  app.get("/api/v1/rewards/daily/:idOrDate/winners", async (request) => {
    const idOrDate = request.params.idOrDate;
    if (idOrDate.length === 0 || idOrDate.length > 128)
      throw new ApiError("INVALID_REQUEST", "Daily competition identifier is invalid.");
    return exactJson(await competition.dailyPayoutWinners(idOrDate));
  });
  app.get("/api/v1/payout-plans/:planId", async (request) => {
    const planId = request.params.planId;
    if (planId.length === 0 || planId.length > 512)
      throw new ApiError("INVALID_REQUEST", "Payout plan identifier is invalid.");
    return exactJson(await competition.payoutPlan(planId));
  });
  app.get(
    "/api/v1/rewards/me",
    async (request) => exactJson(await competition.userRewardAllocations((await user(request)).id))
  );
  app.get("/api/v1/chart-metadata/:context", async (request) => {
    await user(request);
    const context = request.params.context;
    if (!isSolanaPublicKey(context)) throw new ApiError("INVALID_REQUEST", "context is invalid.");
    try {
      return exactJson(await competition.chartMetadata(context));
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
  app.get("/api/v1/markets/:mint", async (request, reply) => {
    const mint = request.params.mint;
    if (!isSolanaPublicKey(mint)) throw new ApiError("INVALID_REQUEST", "mint is invalid.");
    const controller = new AbortController();
    const close = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.on("close", close);
    let result;
    try {
      const owner = await auth.authenticate(sessionToken(request));
      result = owner ? await scoped(owner, "READ", () => competition.marketSupport(mint, controller.signal)) : await competition.marketSupport(mint, controller.signal);
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
  return app;
}

// apps/api/isolated/verified-routes/operational/bootstrap.ts
import { ExecutionEngineError as ExecutionEngineError22 } from "./packages/execution/dist/index.js";

// apps/api/isolated/verified-routes/operational/qualification.ts
import { readFile as readFile3 } from "node:fs/promises";
async function qualifySuccessor(database, role, file = new URL("./worker-qualification.json", import.meta.url)) {
  const q = JSON.parse(await readFile3(file, "utf8"));
  if (q.schema !== "PAPERFUND_MIXED_WORKER_QUALIFICATION_V1" || q.predecessorSHA256 !== "d833b4b6db9bbde9b4b5ddedd3d61bc4422494bb5cedc1ba2a8d8ffa449c0df8") throw Error("MIXED_QUALIFICATION_PREDECESSOR");
  const c = await database.pool.connect();
  let checked2 = 0;
  try {
    await c.query("begin isolation level repeatable read read only");
    const member = role === "api" ? "paperfund_beta_api" : "paperfund_beta_worker";
    const r = (await c.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,pg_has_role(current_user,$1,'member') member,pg_has_role(current_user,'paperfund_beta_api','member') api_member,pg_has_role(current_user,'paperfund_beta_worker','member') worker_member from pg_roles where rolname=current_user", [member])).rows[0];
    if (!r.member || (role === "api" ? r.worker_member : r.api_member) || ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls"].some((k) => r[k])) throw Error("MIXED_RUNTIME_ROLE");
    for (const [kind, sql3] of Object.entries(q.queries)) {
      const actual = new Map((await c.query(sql3)).rows.map((r2) => [r2.key, r2.value.replaceAll("\r\n", "\n")]));
      if (kind.startsWith("linked_") && actual.size !== q.expected[kind].length) throw Error("MIXED_UNREVIEWED_SCHEMA_OBJECT:" + kind);
      for (const row of q.expected[kind]) {
        if (actual.get(row.key) !== row.value) throw Error("MIXED_SCHEMA_MISMATCH:" + kind + ":" + row.key);
        checked2++;
      }
    }
    for (const t of ["branches", "provider_evidence", "receipts", "cutoff_seals", "settlement_steps", "route_quarantine", "route_status"]) {
      const row = (await c.query("select (has_table_privilege(current_user,$1,'SELECT') and has_table_privilege(current_user,$1,'INSERT')) allowed,has_table_privilege(current_user,$1,'DELETE,TRUNCATE') forbidden", ["linked_candidate." + t])).rows[0];
      if (!row.allowed || row.forbidden) throw Error("MIXED_RUNTIME_GRANTS:" + t);
    }
    for (const [table, columns] of [["branches", ["revision", "document", "state_hash"]], ["route_status", ["quarantined"]]]) {
      for (const col of columns) if (!(await c.query("select has_column_privilege(current_user,$1,$2,'UPDATE') allowed", ["linked_candidate." + table, col])).rows[0].allowed) throw Error("MIXED_UPDATE_GRANTS");
    }
    const schema = (await c.query("select has_schema_privilege(current_user,'linked_candidate','USAGE') allowed,has_schema_privilege(current_user,'linked_candidate','CREATE') forbidden")).rows[0];
    if (!schema.allowed || schema.forbidden) throw Error("MIXED_SCHEMA_ROLE_PRIVILEGE");
    const updates = (await c.query("select t.relname,a.attname from pg_class t join pg_namespace n on n.oid=t.relnamespace join pg_attribute a on a.attrelid=t.oid where n.nspname='linked_candidate' and t.relkind='r' and a.attnum>0 and not a.attisdropped and has_column_privilege(current_user,t.oid,a.attnum,'UPDATE')")).rows;
    for (const u of updates) if (!(u.relname === "branches" && ["revision", "document", "state_hash"].includes(u.attname)) && !(u.relname === "route_status" && u.attname === "quarantined")) throw Error("MIXED_UNREVIEWED_COLUMN_UPDATE");
    const disabled = (await c.query("select t.tgname from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname in ('public','linked_candidate') and not t.tgisinternal and t.tgenabled<>'O' limit 1")).rows;
    if (disabled.length) throw Error("MIXED_DISABLED_INTEGRITY_TRIGGER");
    for (const t of ["payout_plans", "payout_batches", "payout_batch_allocations", "payout_signed_transactions", "payout_plan_approvals", "payout_stop_state"]) if ((await c.query("select has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE') writable", [t])).rows[0].writable) throw Error("MIXED_PAYOUT_PRIVILEGE");
    if (!(await c.query("select has_function_privilege(current_user,'linked_candidate.assert_forced_fill(text)','EXECUTE') allowed")).rows[0].allowed) throw Error("MIXED_PROOF_FUNCTION_GRANT");
    await c.query("rollback");
    return { qualified: true, checked: checked2, role, payouts: false };
  } finally {
    await c.query("rollback").catch(() => {
    });
    c.release();
  }
}

// apps/api/isolated/verified-routes/footprint-acquisition.ts
import { performance as performance4 } from "node:perf_hooks";
var fail15 = (m) => {
  throw Error("FOOTPRINT_ACQUISITION_" + m);
};
var topology = (s) => digest({ mint: s.mint, quote: s.quoteMint, pool: s.targetPool, bridge: s.bridgePool, accounts: Object.keys(s.accounts).sort(), absent: s.absentAccounts });
var impact = (b) => digest({ real: b.real, simulated: b.simulated, deltas: b.inventoryDeltas, reserves: b.nativeReserves });
async function parallel(values, count, work) {
  const result = new Array(values.length);
  let next = 0, error;
  await Promise.all(Array.from({ length: Math.min(count, values.length) }, async () => {
    while (next < values.length && !error) {
      const i = next++;
      try {
        result[i] = await work(values[i]);
      } catch (e) {
        error = e;
      }
    }
  }));
  if (error) throw error;
  return result;
}
async function assembleFootprintInterval(branch, base, manifests, readReceipt, witnesses, concurrency = 8) {
  const coverage = structuredClone(manifests);
  coverage.forEach((f) => {
    validateFootprint(f);
    f.selected = [];
  });
  const bodies = /* @__PURE__ */ new Map(), roots = footprintRoots(branch), key2 = (slot, index2) => slot + ":" + index2;
  const acquire = async (f, i) => {
    const k = key2(f.slot, i);
    if (!bodies.has(k)) {
      const t = await readReceipt(f, i);
      bindReceipt(f, i, t);
      bodies.set(k, t);
    }
  };
  await parallel(coverage.flatMap((f) => f.rows.flatMap((r, i) => needsReceipt(f, r, roots, branch.inventoryDeltas, branch.nativeReserves) ? [{ f, i }] : [])), concurrency, ({ f, i }) => acquire(f, i));
  for (let attempt = 0; attempt <= 512; attempt++) {
    const p = { ...base, schema: "LINKED_RETAINED_RPC_INTERVAL_V2", coverage: { schema: "FINALIZED_DEPENDENCY_FOOTPRINT_V1", blocks: coverage }, blocks: coverage.map((f) => {
      f.selected = f.rows.flatMap((_, i) => bodies.has(key2(f.slot, i)) ? [i] : []);
      return { slot: f.slot, result: { parentSlot: f.parentSlot, previousBlockhash: f.previousBlockhash, blockhash: f.blockhash, blockTime: f.blockTime, transactions: f.selected.map((i) => bodies.get(key2(f.slot, i))) } };
    }) };
    const w = await witnesses(p);
    delete p.token2022;
    delete p.epochWitness;
    Object.assign(p, w);
    const policyRoots = footprintRoots(branch, [...requiredTokenFeeMints(p.before, p.blocks), ...Object.keys(w.token2022?.mints ?? {})]);
    const policyMissing = coverage.flatMap((f) => f.rows.flatMap((r, i) => !bodies.has(key2(f.slot, i)) && needsReceipt(f, r, policyRoots, branch.inventoryDeltas, branch.nativeReserves) ? [{ f, i }] : []));
    if (policyMissing.length) {
      await parallel(policyMissing, concurrency, ({ f, i }) => acquire(f, i));
      continue;
    }
    try {
      const at = performance4.now();
      await reconcileLinkedInterval(branch, p, Date.parse(p.after.observedAt), 1e4);
      performance4.measure("linked.footprint.reconcile", { start: at, detail: { attempt, receipts: bodies.size } });
      performance4.clearMeasures("linked.footprint.reconcile");
      return p;
    } catch (e) {
      if (!(e instanceof FootprintReceiptRequired)) throw e;
      const f = coverage.find((f2) => f2.slot === e.slot);
      if (!f || bodies.has(key2(e.slot, e.index))) throw e;
      await acquire(f, e.index);
    }
  }
  return fail15("DEPENDENCY_CLOSURE_BOUND");
}
async function projectRetainedInterval(branch, full) {
  if (full.schema !== "LINKED_RETAINED_RPC_INTERVAL_V1") fail15("FULL_EVIDENCE_REQUIRED");
  return assembleFootprintInterval(branch, full, full.blocks.map((b) => footprintFromFull(b.slot, b.result)), async (f, i) => full.blocks.find((b) => b.slot === f.slot).result.transactions[i], async (p) => {
    const needed = requiredTokenFeeMints(p.before, p.blocks), token2022 = full.token2022 ? { ...full.token2022, mints: Object.fromEntries(needed.map((m) => [m, full.token2022.mints[m]])) } : void 0;
    return { ...token2022 && needed.length ? { token2022 } : {}, ...full.epochWitness ? { epochWitness: full.epochWitness } : {} };
  });
}
var FootprintFlowConnector = class extends FinalizedFlowConnector {
  constructor(rpc, archive, now = Date.now, footprintOptions = {}) {
    super(rpc, archive, now, { ...footprintOptions.maxSlots !== void 0 ? { maxSlots: footprintOptions.maxSlots } : {}, ...footprintOptions.maxTransactions !== void 0 ? { maxTransactions: footprintOptions.maxTransactions } : {}, blockConcurrency: footprintOptions.concurrency ?? 8 });
    this.footprintOptions = footprintOptions;
  }
  footprintOptions;
  pending = /* @__PURE__ */ new Map();
  indexedReceipts = /* @__PURE__ */ new Map();
  async interval(anchor, end) {
    if (!this.footprintOptions.loadBranch) fail15("PERSISTED_BRANCH_LOADER_REQUIRED");
    return this.intervalForBranch(await this.footprintOptions.loadBranch(anchor), end);
  }
  async intervalForBranch(branch, end) {
    const anchor = branch.real, after = end ?? await this.observe(anchor);
    if (topology(anchor) !== topology(after)) fail15("DEPENDENCY_TOPOLOGY_CHANGED");
    if (after.slot === anchor.slot) {
      if (digest({ ...after, observedAt: "" }) !== digest({ ...anchor, observedAt: "" })) fail15("SAME_SLOT_CHANGED");
      return null;
    }
    if (after.slot < anchor.slot || after.slot - anchor.slot > this.maxSlots) fail15("SLOT_BOUND");
    const id = "interval-footprint-v1-" + impact(branch) + "-" + digest(after);
    let pending = this.pending.get(id);
    if (!pending) {
      pending = this.acquire(branch, after, id);
      this.pending.set(id, pending);
    }
    try {
      return await pending;
    } finally {
      if (this.pending.get(id) === pending) this.pending.delete(id);
    }
  }
  /** Independent durable acquisition coverage. Never asserts market eligibility or changes a liquidity head. */
  async captureCoverage(before, after) {
    if (topology(before) !== topology(after) || after.slot <= before.slot || after.slot - before.slot > this.maxSlots) fail15("COVERAGE_BOUND");
    const anchor = await this.header(before.slot), result = await this.captureSlotCoverage({ slot: before.slot, blockhash: anchor.blockhash, blockTime: verifiedClock(before.accounts[CLOCK_ACCOUNT], before.slot).seconds }, after.slot);
    if (result.manifests.at(-1).blockTime !== verifiedClock(after.accounts[CLOCK_ACCOUNT], after.slot).seconds) fail15("BANK_TIME");
    return result;
  }
  /** Complete transaction coverage is not a market snapshot or a reconciled-liquidity checkpoint. */
  async captureSlotCoverage(before, to) {
    if (!Number.isSafeInteger(to) || !Number.isSafeInteger(before.slot) || to <= before.slot || to - before.slot > this.maxSlots) fail15("COVERAGE_BOUND");
    const slots = await this.rpc.call("getBlocks", [before.slot + 1, to, { commitment: "finalized" }]);
    if (!Array.isArray(slots) || slots.length > this.maxSlots || slots.at(-1) !== to || slots.some((s, i) => !Number.isSafeInteger(s) || s <= before.slot || s > to || i > 0 && s <= slots[i - 1])) fail15("INCOMPLETE_SLOTS");
    const anchor = await this.header(before.slot);
    if (anchor.blockhash !== before.blockhash || anchor.blockTime !== before.blockTime) fail15("ANCHOR_HEADER");
    const manifests = await parallel(slots, this.blockConcurrency, (s) => this.manifest(s));
    let parent = before.slot, hash2 = anchor.blockhash, time = before.blockTime, total = 0;
    for (const f of manifests) {
      validateFootprint(f);
      if (f.parentSlot !== parent || f.previousBlockhash !== hash2 || f.blockTime < time) fail15("FRONTIER_GAP");
      parent = f.slot;
      hash2 = f.blockhash;
      time = f.blockTime;
      total += f.rows.length;
    }
    if (total > this.maxTransactions) fail15("TRANSACTION_BOUND");
    const complete = { schema: "FINALIZED_FOOTPRINT_RANGE_V1", from: before.slot, to, anchor: anchor.blockhash, slots, manifests: manifests.map((f) => ({ slot: f.slot, hash: digest(f) })) };
    await this.archive.put("coverage-range-" + digest({ from: before.slot, to, anchor: anchor.blockhash }), complete);
    return { slots, anchor, manifests, total };
  }
  async acquire(branch, after, id) {
    const before = branch.real, cached = await this.archive.get(id);
    if (cached) {
      await reconcileLinkedInterval(branch, cached, Date.parse(after.observedAt), 1e4);
      await this.archive.put("coverage-complete-" + digest(id), { schema: "FINALIZED_COVERAGE_COMPLETE_V1", from: before.slot, to: after.slot, branchHash: impact(branch), intervalHash: digest(cached), intervalKey: id });
      return cached;
    }
    const started = performance4.now();
    let retainedCoverage = [];
    try {
      const { slots, anchor, manifests, total } = await this.captureCoverage(before, after);
      retainedCoverage = manifests;
      if (this.footprintOptions.addressIndex) await this.prefetchAddressIndex(branch, after, manifests);
      const base = { schema: "LINKED_RETAINED_RPC_INTERVAL_V1", commitment: "finalized", acquiredAt: new Date(this.now()).toISOString(), before, after, slots, anchor: { blockhash: anchor.blockhash }, blocks: [] };
      let witness = {};
      const packet = await assembleFootprintInterval(branch, base, manifests, (f, i) => this.receipt(f, i), async (p) => {
        const required = requiredTokenFeeMints(before, p.blocks), existing = new Set(Object.keys(witness.token2022?.mints ?? {}));
        if (!witness.epochWitness || required.some((m) => !existing.has(m))) witness = await this.witnesses(p, required);
        return witness;
      }, this.blockConcurrency);
      await this.archive.put(id, packet);
      await this.archive.put("coverage-complete-" + digest(id), { schema: "FINALIZED_COVERAGE_COMPLETE_V1", from: before.slot, to: after.slot, branchHash: impact(branch), intervalHash: digest(packet), intervalKey: id });
      performance4.measure("linked.footprint.acquire", { start: started, detail: { from: before.slot, to: after.slot, totalTransactions: total, fullReceipts: packet.blocks.reduce((n3, b) => n3 + b.result.transactions.length, 0) } });
      performance4.clearMeasures("linked.footprint.acquire");
      return packet;
    } catch (error) {
      const missing = /^MULTI_HOP_DEPENDENCY_MISSING:([1-9A-HJ-NP-Za-km-z]+)$/.exec(error.message);
      if (missing) {
        const pool = missing[1], receipts = retainedCoverage.flatMap((f) => f.rows.flatMap((r, index2) => !r.failed && r.accounts.some((k) => f.keys[k] === pool) ? [{ slot: f.slot, index: index2, signature: r.signatures[0] }] : []));
        await this.archive.put("backfill-required-" + digest({ id, pool }), { schema: "FINALIZED_DEPENDENCY_BACKFILL_REQUIRED_V1", pool, from: before.slot, to: after.slot, beforeBankHash: digest(before), afterBankHash: digest(after), branchHash: impact(branch), receipts, required: "Verified pre-interval pool/dependency state and complete ordered changes through the end bank", complete: false, checkpointEligible: false });
      }
      await this.archive.put("coverage-gap-" + digest({ id, reason: String(error.message) }), { schema: "FINALIZED_COVERAGE_GAP_V1", from: before.slot, to: after.slot, branchHash: impact(branch), reason: error.message, ...error.cause ? { detail: error.cause } : {}, complete: false });
      if (this.footprintOptions.fallbackFull) {
        const full = await super.interval(before, after);
        if (full) await reconcileLinkedInterval(branch, full, Date.parse(after.observedAt), 1e4);
        return full;
      }
      throw error;
    }
  }
  async header(slot) {
    const key2 = "coverage-header-" + slot, old = await this.archive.get(key2);
    if (old) return old;
    const h = await this.rpc.call("getBlock", [slot, { commitment: "finalized", transactionDetails: "signatures", rewards: false, maxSupportedTransactionVersion: 1 }]);
    if (!h || !Array.isArray(h.signatures) || !h.blockhash || !Number.isSafeInteger(h.blockTime)) fail15("HEADER_UNAVAILABLE");
    await this.archive.put(key2, h);
    return h;
  }
  async manifest(slot) {
    const key2 = "footprint-effects-v1-" + slot, old = await this.archive.get(key2);
    if (old) {
      validateFootprint(old);
      return old;
    }
    const [block, header] = await Promise.all([this.rpc.call("getBlock", [slot, { commitment: "finalized", encoding: "json", transactionDetails: "accounts", rewards: false, maxSupportedTransactionVersion: 1 }]), this.header(slot)]);
    const f = footprintFromRpc(slot, block, header);
    validateFootprint(f);
    await this.archive.put(key2, f);
    return f;
  }
  async receipt(f, index2) {
    const signature = f.rows[index2].signatures[0], key2 = "receipt-" + digest({ slot: f.slot, index: index2, signature }), indexed = this.indexedReceipts.get(key2);
    if (indexed) {
      bindReceipt(f, index2, indexed);
      return indexed;
    }
    const old = await this.archive.get(key2);
    if (old) {
      bindReceipt(f, index2, old);
      return old;
    }
    const t = await this.rpc.call("getTransaction", [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 1 }]);
    if (!t || t.slot !== f.slot || t.transactionIndex !== void 0 && t.transactionIndex !== index2 || t.blockTime !== f.blockTime) fail15("RECEIPT_CONTEXT");
    const body = { transaction: t.transaction, meta: t.meta, version: t.version };
    bindReceipt(f, index2, body);
    await this.archive.put(key2, body);
    return body;
  }
  async prefetchAddressIndex(branch, after, manifests) {
    const before = branch.real, roots = footprintRoots(branch);
    const pools = [.../* @__PURE__ */ new Set([...linkedBindings(before).flatMap((r) => [r.targetPool, r.bridgePool]), ...Object.entries(before.accounts).filter(([, a]) => [
      "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
      "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
    ].includes(a.owner) && [166, 287, 300, 301].includes(Buffer.from(a.base64, "base64").length)).map(([a]) => a)])];
    const lookup = new Map(manifests.flatMap((f) => f.rows.map((r, i) => [r.signatures[0], { f, i }])));
    await parallel(pools, Math.min(4, this.blockConcurrency), async (address3) => {
      let cursor;
      const cursors = /* @__PURE__ */ new Set();
      for (let page = 0; page < 8; page++) {
        const pageKey = "address-page-" + digest({ address: address3, from: before.slot, to: after.slot, cursor: cursor ?? null, status: "succeeded" });
        let response = await this.archive.get(pageKey);
        if (!response) {
          try {
            response = await this.rpc.call("getTransactionsForAddress", [address3, { transactionDetails: "full", commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 1, sortOrder: "asc", limit: 1e3, ...cursor ? { paginationToken: cursor } : {}, filters: { slot: { gt: before.slot, lte: after.slot }, status: "succeeded", tokenAccounts: "none" } }]);
          } catch {
            return;
          }
          if (!Array.isArray(response?.data)) return;
          await this.archive.put(pageKey, response);
        }
        if (!Array.isArray(response?.data)) return;
        for (const t of response.data) {
          const match = lookup.get(t.transaction?.signatures?.[0]);
          if (!match || t.slot !== match.f.slot) continue;
          if (t.transactionIndex !== void 0 && t.transactionIndex !== match.i) fail15("ADDRESS_INDEX_CONTEXT");
          if (!needsReceipt(match.f, match.f.rows[match.i], roots, branch.inventoryDeltas, branch.nativeReserves)) continue;
          const body = { transaction: t.transaction, meta: t.meta, version: t.version };
          bindReceipt(match.f, match.i, body);
          this.indexedReceipts.set("receipt-" + digest({ slot: match.f.slot, index: match.i, signature: body.transaction.signatures[0] }), body);
          if (this.indexedReceipts.size > 5e3) this.indexedReceipts.delete(this.indexedReceipts.keys().next().value);
        }
        if (!response.data.length || !response.paginationToken) return;
        if (cursors.has(response.paginationToken)) return;
        cursors.add(response.paginationToken);
        cursor = response.paginationToken;
      }
    });
  }
  async witnesses(p, mints) {
    if (mints.length > 98) fail15("WITNESS_DEPENDENCY_BOUND");
    for (let attempt = 0; attempt < 3; attempt++) {
      const addresses = [...mints, CLOCK_ACCOUNT, EPOCH_SCHEDULE_ACCOUNT], r = await this.rpc.call("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64", minContextSlot: p.after.slot }]);
      if (!Number.isSafeInteger(r?.context?.slot) || r.context.slot < p.after.slot || r.value?.length !== addresses.length || r.value.some((a) => !a || a.data?.[1] !== "base64")) fail15("WITNESS_SHAPE");
      const account = (i) => ({ owner: r.value[i].owner, base64: r.value[i].data[0] });
      const epochWitness = { schema: "FINALIZED_EPOCH_SCHEDULE_V1", contextSlot: r.context.slot, clock: account(mints.length), schedule: account(mints.length + 1) };
      try {
        epochProgression(p.before, p.after, p.blocks, epochWitness);
      } catch (e) {
        if (attempt < 2 && String(e).includes("EPOCH_CLOCK_CONTEXT")) continue;
        throw e;
      }
      const token2022 = mints.length ? { schema: "TOKEN_2022_FEE_SCHEDULE_WITNESS_V1", contextSlot: r.context.slot, clock: epochWitness.clock, mints: Object.fromEntries(mints.map((m, i) => [m, account(i)])) } : void 0;
      feePolicies(token2022, p.before, p.after, p.blocks, epochWitness);
      return { epochWitness, ...token2022 ? { token2022 } : {} };
    }
    return fail15("COHERENT_WITNESS_UNAVAILABLE");
  }
};

// apps/api/isolated/verified-routes/operational/bootstrap.ts
import { readFile as readFile4, mkdir as mkdir2, rename, writeFile as writeFile2 } from "node:fs/promises";
import { isAbsolute, join as join2 } from "node:path";
import { createHash as createHash21 } from "node:crypto";
var assert = (v, reason) => {
  if (!v) throw Error("MIXED_BOOTSTRAP_" + reason);
};
function validateScope(d, now = Date.now()) {
  assert(
    d?.schema === "PAPERFUND_MIXED_EXIT_ONLY_V1" && !!d.approvalReference,
    "APPROVAL_REQUIRED"
  );
  assert(Number.isFinite(Date.parse(d.notBefore)) && now >= Date.parse(d.notBefore), "NOT_BEFORE");
  assert(Number.isFinite(Date.parse(d.initializeBefore)), "INITIALIZATION_DEADLINE");
  for (const p of [d.repositoryRoot, d.heartbeatFile, d.controlDirectory])
    assert(typeof p === "string" && isAbsolute(p), "ABSOLUTE_PATH");
  assert(Array.isArray(d.scopes) && d.scopes.length > 0 && d.scopes.length <= 8, "SCOPES");
  const ids = /* @__PURE__ */ new Set();
  for (const s of d.scopes) {
    assert(s.accountId && s.userId && s.roundId && !ids.has(s.accountId), "IDENTITY");
    ids.add(s.accountId);
    assert(
      Array.isArray(s.mints) && s.mints.length > 0 && new Set(s.mints).size === s.mints.length,
      "MINTS"
    );
    assert(
      isAbsolute(s.archiveDirectory) && isAbsolute(s.initialBankFile) && /^[a-f0-9]{64}$/.test(s.initialBankSHA256),
      "EVIDENCE_PATH"
    );
    assert(
      typeof s.initialize === "boolean" && Number.isSafeInteger(s.pollMs) && s.pollMs >= 250 && s.pollMs <= 5e3,
      "OBSERVATION_SCHEDULE"
    );
    assert(
      Number.isSafeInteger(s.maxSlots) && s.maxSlots >= 1 && s.maxSlots <= 2048 && Number.isSafeInteger(s.maxTransactions) && s.maxTransactions >= 1 && s.maxTransactions <= 2e5,
      "INTERVAL_BUDGET"
    );
    assert(
      Number.isSafeInteger(s.maxRpcCalls) && s.maxRpcCalls > 0 && s.maxRpcCalls <= 2e4 && Number.isFinite(Date.parse(s.captureUntil)),
      "RPC_BUDGET"
    );
  }
  assert(
    !("authorizePaperBuy" in d) && !("mode" in d) && d.scopes.every((s) => !("mode" in s)),
    "ENTRY_SWITCH_REFUSED"
  );
  return d;
}
function budgetedRpc(rpc, limit, until, now = Date.now) {
  let used = 0;
  return {
    async call(method, params) {
      assert(
        ["getMultipleAccounts", "getSlot", "getBlocks", "getBlock", "getTransaction", "getTransactionsForAddress"].includes(method),
        "READ_ONLY_RPC"
      );
      assert(now() <= until && ++used <= limit, "RPC_BUDGET_EXHAUSTED");
      return rpc.call(method, params);
    }
  };
}
function scopedExitPermission(database, capability, scopes, systemSettlement, now = Date.now) {
  return async (mint, quote, forSettlement) => {
    const actor = genericActor(), scope2 = scopes.find((s) => s.accountId === actor?.accountId && s.mints.includes(mint));
    if (!scope2) return capability.resolve(mint, quote, forSettlement);
    const system = systemSettlement && forSettlement;
    if (!system && actor?.userId !== scope2.userId)
      return capability.resolve(mint, quote, forSettlement);
    const deny2 = (reason) => {
      throw new ExecutionEngineError22("POSITION_EXECUTION_ROUTE_UNAVAILABLE", reason);
    };
    async function owned() {
      const row = (await database.pool.query(
        `select e.normalized_state->'stage1Snapshot'->>'quoteMint' quote,
    e.normalized_state->'stage1Snapshot'->>'targetPool' target,e.normalized_state->'stage1Snapshot'->>'bridgePool' bridge
    from positions p join competition_accounts a on a.id=p.competition_account_id
    join hourly_rounds h on h.id=a.hourly_round_id join assets t on t.id=p.asset_id
    join lateral(select f.* from fills f join orders o on o.id=f.order_id join markets m on m.id=f.market_id
     where o.competition_account_id=a.id and m.base_asset_id=p.asset_id and f.side='BUY' and f.base_quantity>0 and o.status='COMPLETED'
     order by f.executed_at desc,f.id desc limit 1) f on true
    join market_state_evidence e on e.id=f.market_state_evidence_id and e.protocol_id=f.protocol_id and e.market_id=f.market_id
    join linked_candidate.receipts r on r.fill_id=f.id and r.execution_id=f.execution_id and r.account_id=a.id
    join linked_candidate.branches b on b.account_id=a.id and b.round_id=a.hourly_round_id
    where a.id=$1 and a.user_id=$2 and a.hourly_round_id=$3 and t.mint_address=$4 and p.status='OPEN' and p.remaining_base_units>0
     and a.final_settled_balance_lamports is null and f.protocol_id='GENERIC_PUMP_SWAP'
     and e.adapter_version='linked-native-atomic-v1' and e.normalization_version='linked-native-atomic-state-v1'
     and e.normalized_state->'stage1Snapshot'->>'mint'=$4 and b.revision>=r.revision
     and (($5::boolean and h.state='SETTLING' and h.ends_at_exclusive<=$6)
       or (not $5::boolean and h.state='OPEN' and h.starts_at<=$6 and h.ends_at_exclusive>$6))`,
        [scope2.accountId, scope2.userId, scope2.roundId, mint, system, new Date(now())]
      )).rows[0];
      return row?.quote && row?.target && row?.bridge ? {
        quoteMint: row.quote,
        targetPool: row.target,
        bridgePool: row.bridge
      } : null;
    }
    const binding = await owned();
    if (!binding) return capability.resolve(mint, quote, forSettlement);
    if (binding.quoteMint !== quote) deny2("GENERIC_EXIT_QUOTE_CHANGED");
    if ((await capability.status(scope2.userId)).mode === "HARD_STOP") deny2("GENERIC_HARD_STOP");
    return {
      discover: false,
      buy: false,
      exitBinding: binding,
      authorizeLive: async (kind) => {
        if (kind === "BUY") deny2("GENERIC_OPERATOR_ENTRY_DISABLED");
        if (!system && genericActor()?.intent !== "SELL") deny2("GENERIC_READ_SCOPE_CANNOT_EXECUTE");
        if ((await capability.status(scope2.userId)).mode === "HARD_STOP") deny2("GENERIC_HARD_STOP");
        const current2 = await owned();
        if (!current2 || JSON.stringify(current2) !== JSON.stringify(binding))
          deny2("GENERIC_OWNED_EXIT_EVIDENCE_REQUIRED");
      }
    };
  };
}
async function prepareOperational(config, document, role, testing = {}) {
  const now = testing.now ?? Date.now;
  if (testing.footprintAcquisition && !testing.durableFlow) throw Error("FOOTPRINT_DURABLE_FLOW_REQUIRED");
  validateScope(document, now());
  assert(
    config.PRIVATE_BETA_NON_PAYING && config.BETA_INVITE_ONLY && !config.PAYOUT_EXECUTION_ENABLED && config.PAYOUT_SIGNER_TYPE === "DISABLED",
    "FINANCIAL_CONFIGURATION"
  );
  assert(
    !config.CREATOR_FEE_INGESTION_ENABLED && config.CREATOR_FEE_SHADOW_MODE,
    "FEE_OBSERVER_ONLY"
  );
  const base = testing.database ?? createDatabase(config.DATABASE_URL);
  const database = { ...base, authorizePaperBuy: async () => false };
  await qualifySuccessor(database, role, testing.qualificationFile);
  const capability = new GenericCapability(
    database,
    { ...genericCapabilityOptions(config), entries: false, systemSettlement: role === "worker" },
    now
  );
  const baselineRouter = testing.baselineRouter ?? createProductionExecutionRouter({
    genericPumpSwapEnabled: config.GENERIC_PUMPSWAP_ENABLED,
    genericPumpSwapBuysEnabled: false,
    genericAccessResolver: (mint, quote, settlement) => capability.resolve(mint, quote, settlement),
    nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
    nonSolPumpSwapRoutes: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES,
    rpcUrl: config.SOLANA_RPC_URL,
    rpcTimeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
    commitment: config.SOLANA_COMMITMENT
  });
  const observed = [];
  const scopes = [];
  for (const s of document.scopes) {
    const account = (await database.pool.query(
      "select a.user_id,a.hourly_round_id,h.state,h.starts_at,h.ends_at_exclusive from competition_accounts a join hourly_rounds h on h.id=a.hourly_round_id where a.id=$1",
      [s.accountId]
    )).rows[0];
    assert(account?.user_id === s.userId && account.hourly_round_id === s.roundId, "ACCOUNT_OWNER");
    const store = new LinkedStateStore(
      database,
      s.accountId,
      s.roundId,
      testing.durableFlow === true,
      testing.proofRecovery === true
    ), archive = new FinalizedBankArchive(s.archiveDirectory, testing.durableFlow === true), connectorRpc = budgetedRpc(
      testing.rpc ?? new FinalizedRpc(config.SOLANA_RPC_URL, config.SOLANA_RPC_TIMEOUT_MS),
      s.maxRpcCalls,
      Date.parse(s.captureUntil),
      now
    ), connector = testing.footprintAcquisition ? new FootprintFlowConnector(connectorRpc, archive, now, {
      maxSlots: s.maxSlots,
      maxTransactions: s.maxTransactions,
      concurrency: 8,
      loadBranch: async (anchor) => {
        const head = await store.load();
        if (digest(head.document.real) !== digest(anchor)) throw Error("FOOTPRINT_PREDECESSOR_CHANGED_RETRY");
        return head.document;
      }
    }) : new FinalizedFlowConnector(connectorRpc, archive, now, { maxSlots: s.maxSlots, maxTransactions: s.maxTransactions, blockConcurrency: testing.durableFlow ? 8 : 4 });
    const exists = (await database.pool.query("select 1 from linked_candidate.branches where account_id=$1", [
      s.accountId
    ])).rowCount;
    if (!exists) {
      assert(
        role === "worker" && s.initialize && now() <= Date.parse(document.initializeBefore),
        "MISSING_BRANCH_NO_RESET"
      );
      assert(
        account.state === "OPEN" && +account.starts_at <= now() && +account.ends_at_exclusive > now(),
        "FRESH_OPEN_ROUND_REQUIRED"
      );
      const raw = await readFile4(s.initialBankFile);
      assert(
        createHash21("sha256").update(raw).digest("hex") === s.initialBankSHA256,
        "INITIAL_BANK_HASH"
      );
      const seed = JSON.parse(raw.toString());
      assert(
        now() >= Date.parse(seed.observedAt) && now() - Date.parse(seed.observedAt) <= 1e4,
        "STALE_INITIAL_SEED"
      );
      const bank = await connector.observe(seed);
      assert(
        now() >= Date.parse(bank.observedAt) && now() - Date.parse(bank.observedAt) <= 1e4,
        "STALE_INITIAL_BANK"
      );
      assert(
        linkedBindings(bank).length > 0 && new Set(linkedBindings(bank).map((b) => b.mint)).size === s.mints.length && linkedBindings(bank).every((b) => s.mints.includes(b.mint)),
        "INITIAL_ROUTE_SCOPE"
      );
      await store.initialize(bank);
    }
    await store.recover();
    observed.push({ scope: s, store, connector, cutoff: new Date(account.ends_at_exclusive) });
    scopes.push({
      accountId: s.accountId,
      userId: s.userId,
      roundId: s.roundId,
      mints: s.mints,
      approvalReference: document.approvalReference,
      mode: "EXIT_ONLY",
      connector,
      durableFlow: testing.durableFlow === true,
      proofRecovery: testing.proofRecovery === true
    });
  }
  const composed = await composeScopedProduction({
    database,
    baselineRouter,
    scopes,
    now,
    resolvePermission: scopedExitPermission(
      database,
      capability,
      document.scopes,
      role === "worker",
      now
    ),
    competitionOptions: {
      rewardConfig: {
        allocationMode: config.REWARD_ALLOCATION_MODE,
        baselineWindow: config.REWARD_BASELINE_WINDOW,
        lambdaBps: BigInt(config.REWARD_LAMBDA_BPS),
        configurationVersion: "phase-5a-v1"
      },
      advisoryLimits: {
        maxConcurrent: config.ADVISORY_MAX_CONCURRENT,
        backgroundConcurrent: config.ADVISORY_BACKGROUND_CONCURRENT
      },
      genericArmed: config.GENERIC_PUMPSWAP_ENABLED
    }
  });
  let stopping = false, running, timer;
  let progressing, prefetching, progressTimer;
  const observation = {
    lastSuccessAt: null,
    lastError: null,
    progressError: null,
    progress: null
  };
  async function observeOnce() {
    for (const o of observed) {
      try {
        if (now() > Date.parse(o.scope.captureUntil)) continue;
        const anchor = (await o.store.load()).document.real;
        if (now() >= +o.cutoff) await o.connector.captureCutoffBank(anchor, o.cutoff);
        else {
          const after = await o.connector.observe(anchor);
          if (testing.durableFlow && testing.prefetchFlow && !prefetching) {
            prefetching = o.connector.prefetch(anchor, after).catch((e) => {
              observation.lastError = e instanceof Error ? e.message : "PREFETCH_REJECTED";
            }).finally(() => {
              prefetching = void 0;
            });
          }
        }
        observation.lastSuccessAt = new Date(now()).toISOString();
        observation.lastError = null;
      } catch (e) {
        observation.lastError = e instanceof Error ? e.message : "OBSERVATION_REJECTED";
      }
    }
  }
  async function progressOnce() {
    for (const o of observed) {
      try {
        if (now() > Date.parse(o.scope.captureUntil)) continue;
        const head = await o.store.load(), after = await o.connector.archive.nextBank(head.document.real, Math.min(64, o.connector.maxSlots));
        if (!after || Date.parse(after.observedAt) >= +o.cutoff || await o.store.cutoff())
          continue;
        const started = performance.now(), interval = await o.connector.interval(head.document.real, after), acquired = performance.now();
        if (interval) await o.store.advanceFlow(interval);
        observation.progress = {
          from: head.document.real.slot,
          to: after.slot,
          acquisitionMs: acquired - started,
          checkpointMs: performance.now() - acquired,
          finishedAt: new Date(now()).toISOString()
        };
        observation.progressError = null;
      } catch (e) {
        observation.progressError = e instanceof Error ? e.message : "FLOW_PROGRESS_REJECTED";
      }
    }
  }
  function startObservation() {
    assert(role === "worker", "SINGLE_OBSERVER_WORKER_ONLY");
    const poll = testing.durableFlow ? 500 : Math.min(...observed.map((o) => o.scope.pollMs));
    const tick = () => {
      running = observeOnce().finally(() => {
        if (!stopping) timer = setTimeout(tick, poll);
      });
    };
    tick();
    if (testing.durableFlow) {
      const progress = () => {
        progressing = progressOnce().finally(() => {
          if (!stopping) progressTimer = setTimeout(progress, 100);
        });
      };
      progress();
    }
  }
  async function stopObservation() {
    stopping = true;
    if (timer) clearTimeout(timer);
    if (progressTimer) clearTimeout(progressTimer);
    await running;
    await progressing;
    await prefetching;
  }
  return {
    ...composed,
    capability,
    observation,
    observeOnce,
    progressOnce,
    startObservation,
    stopObservation
  };
}

// apps/api/isolated/current-quotes/router.ts
import { identifier as identifier15 } from "./packages/core/dist/index.js";
import { ExecutionRouter as ExecutionRouter4, ExecutionEngineError as ExecutionEngineError23 } from "./packages/execution/dist/index.js";
var CURRENT_QUOTE_VERSION = "paper-current-executable-v1";
var CURRENT_QUOTE_NORMALIZATION = "paper-current-accounts-v1";
var protocol = identifier15("GENERIC_PUMP_SWAP", "ProtocolId");
var currentQuoteIdentity = (mint) => ({ protocolId: protocol, marketId: identifier15("paper-current-quote:" + mint, "MarketId"), tokenMint: identifier15(mint, "TokenMint") });
var fail16 = (reason) => {
  throw new ExecutionEngineError23("MARKET_STATE_UNAVAILABLE", "CURRENT_QUOTE_" + reason);
};
var engine2 = (s) => new LinkedEngine({ purpose: "READ_ONLY_STAGE1_VALIDATION", bridgeBinding: { quoteMint: s.quoteMint, pool: s.bridgePool } });
function currentQuoteRouter(o) {
  if (!o.enabled) return { router: o.baseline, source: null, adapter: null };
  const now = o.now ?? Date.now, maxDeviation = o.maxDeviationBps ?? 1000n;
  if (maxDeviation <= 0n || maxDeviation > 1000n || !o.mints.length) fail16("POLICY");
  const owns = (id) => id.protocolId === protocol && o.mints.includes(id.tokenMint), snapshots = /* @__PURE__ */ new WeakMap();
  const native = {
    async quote(s, input, buy, policy) {
      const q = await engine2(s).quote(s, input, buy, { ...policy, nowMs: now(), maxAgeMs: 1e4 });
      if (buy) {
        const reverse = await engine2(s).quote(s, q.output, false, { nowMs: now(), maxAgeMs: 1e4 });
        if (reverse.output > input) fail16("INSTANT_ROUND_TRIP_PROFIT");
        return q;
      }
      const peak = BigInt(s.paperQuotePeakQuantity ?? "0");
      if (peak < input && peak !== 0n) fail16("POSITION_CHANGED_RETRY");
      if (peak <= input) return q;
      const full = await engine2(s).quote(s, peak, false, { nowMs: now(), maxAgeMs: 1e4 }), scale = (n3) => n3 * input / peak;
      return { ...full, input, output: scale(full.output), target: { ...full.target, input: scale(full.target.input), output: scale(full.target.output), fees: Object.fromEntries(Object.entries(full.target.fees).map(([k, v]) => [k, scale(v)])) }, bridge: { ...full.bridge, output: scale(full.bridge.output), lp: scale(full.bridge.lp), protocol: scale(full.bridge.protocol), creator: scale(full.bridge.creator) } };
    },
    async exits(s, quantity) {
      return engine2(s).exits(s, quantity, { nowMs: now(), maxAgeMs: 1e4 });
    }
  };
  const source = { engine: native, async loadMarketState(id) {
    if (!owns(id) || id.marketId !== currentQuoteIdentity(id.tokenMint).marketId) fail16("IDENTITY");
    const permission = await o.permission(id.tokenMint);
    if (!permission.discover) fail16("DISCOVERY_DISABLED");
    const candidates = await o.snapshots(id.tokenMint);
    if (candidates.length > 16) fail16("CANDIDATE_BOUND");
    const outcomes = await Promise.all(candidates.map(async (s) => {
      try {
        if (s.mint !== id.tokenMint) fail16("MINT_BINDING");
        const q = await native.quote(s, 10000000n, true, { nowMs: now(), maxAgeMs: 1e4 });
        const state2 = await linkedState(id, s, engine2(s), CURRENT_QUOTE_VERSION, CURRENT_QUOTE_NORMALIZATION);
        return { state: state2, s, output: q.output };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "UNAVAILABLE" };
      }
    }));
    const valid = outcomes.filter((r) => "state" in r).sort((a, b) => a.output === b.output ? a.s.bridgePool.localeCompare(b.s.bridgePool) : a.output > b.output ? -1 : 1);
    const best = valid[0] ?? fail16("NO_EXECUTABLE_ROUTE:" + outcomes.map((r) => "error" in r ? r.error : "").join(","));
    const prior = await o.priorReference?.(id.tokenMint);
    if (prior) {
      const previous = BigInt(prior.output);
      if (best.s.slot < prior.slot || previous <= 0n || (best.output > previous ? best.output - previous : previous - best.output) * 10000n > previous * maxDeviation) fail16("PRICE_DEVIATION_REVIEW");
    }
    const peak = await o.peakQuantity?.(id.tokenMint) ?? 0n;
    const state = { ...best.state, normalizedState: { ...best.state.normalizedState, stage1Snapshot: { ...best.state.normalizedState["stage1Snapshot"], paperQuotePeakQuantity: peak.toString() }, currentQuotePolicy: CURRENT_QUOTE_VERSION, referenceBuyOutput: best.output.toString(), genericBuyAdmissionAllowed: permission.buy, executionModel: "FRESH_NATIVE_QUOTES_NO_HISTORICAL_REPLAY", partialExitPolicy: "FRESH_PEAK_PROPORTIONAL", quoteProvenance: { kind: "NATIVE_EXECUTABLE_CURRENT_BANK", commitment: "finalized", historicalReplayRequired: false } } };
    snapshots.set(state, best.s);
    return state;
  } };
  const adapter = new LinkedPoolAdapter(source, { protocolId: protocol, adapterVersion: CURRENT_QUOTE_VERSION, normalizationVersion: CURRENT_QUOTE_NORMALIZATION, identity: (mint) => currentQuoteIdentity(mint), assertBinding: (s) => {
    if (!o.mints.includes(s.mint)) fail16("MINT_SCOPE");
  }, buysEnabled: false });
  const current2 = new ExecutionRouter4([adapter]);
  class Router extends ExecutionRouter4 {
    resolve(id) {
      return id === protocol ? current2.resolve(id) : o.baseline.resolve(id);
    }
    resolveForSettlement(id) {
      return id === protocol ? current2.resolveForSettlement(id) : o.baseline.resolveForSettlement(id);
    }
    resolveVersion(id, version) {
      return id === protocol && version === CURRENT_QUOTE_VERSION ? current2.resolveVersion(id, version) : o.baseline.resolveVersion(id, version);
    }
    isEnabled(id) {
      return id === protocol || o.baseline.isEnabled(id);
    }
    async resolvePositionRoute(id, settlement = false) {
      if (!owns(id)) return o.baseline.resolvePositionRoute(id, settlement);
      if (settlement) fail16("CUTOFF_EVIDENCE_REQUIRED");
      return { route: { originIdentity: id, executionIdentity: currentQuoteIdentity(id.tokenMint), migrated: id.marketId !== currentQuoteIdentity(id.tokenMint).marketId }, adapter: current2.resolve(protocol) };
    }
    async loadPositionRoute(id, settlement = false) {
      if (!owns(id)) return o.baseline.loadPositionRoute(id, settlement);
      const resolved = await this.resolvePositionRoute(id, settlement), state = await resolved.adapter.loadMarketState(resolved.route.executionIdentity);
      return { ...resolved, state };
    }
  }
  const router = new Router();
  router.mintResolver = async (mint) => o.mints.includes(mint) ? currentQuoteIdentity(mint) : o.baseline.mintResolver ? o.baseline.mintResolver(mint) : fail16("DISCOVERY_UNAVAILABLE");
  router.canonicalResolver = async (id) => (await router.loadPositionRoute(id)).route;
  if (o.baseline.contextResolver) router.contextResolver = o.baseline.contextResolver;
  if (o.baseline.chartMetadataResolver) router.chartMetadataResolver = o.baseline.chartMetadataResolver;
  return { router, source, adapter, async prospective(mint) {
    const state = await source.loadMarketState(currentQuoteIdentity(mint)), s = snapshots.get(state);
    const buy = await engine2(s).quote(s, 10000000n, true, { nowMs: now(), maxAgeMs: 1e4 }), partial = await engine2(s).quote(s, buy.output / 4n, false, { nowMs: now(), maxAgeMs: 1e4 }), full = await engine2(s).quote(s, buy.output - buy.output / 4n, false, { nowMs: now(), maxAgeMs: 1e4 });
    const all = await engine2(s).quote(s, buy.output, false, { nowMs: now(), maxAgeMs: 1e4 });
    return { state, buy, partial: { ...partial, output: all.output * (buy.output / 4n) / buy.output }, fullResidual: { ...full, output: all.output * (buy.output - buy.output / 4n) / buy.output }, buyAuthorized: false };
  } };
}

// apps/api/isolated/current-quotes/capture.ts
var clock2 = "SysvarC1ock11111111111111111111111111111111";
async function captureCurrentPumpRoute(rpc, archive, binding, now = Date.now) {
  const header = await rpc.call("getMultipleAccounts", [[binding.targetPool, binding.bridgePool], { commitment: "finalized", encoding: "base64" }]);
  if (!Number.isSafeInteger(header?.context?.slot) || header.value?.some((a) => a?.owner !== PUMP_AMM_PROGRAM_ID) || header.value?.length !== 2) throw Error("CURRENT_PUMP_BRIDGE_UNAVAILABLE");
  const descriptors = header.value.map((a) => decodePumpSwapPool(Buffer.from(a.data[0], "base64")));
  const addresses = [.../* @__PURE__ */ new Set([binding.targetPool, binding.bridgePool, binding.mint, binding.quoteMint, WRAPPED_SOL_MINT, ...descriptors.flatMap((p) => [p.baseVault, p.quoteVault]), ...binding.quoteMint !== WRAPPED_SOL_MINT ? [await pumpBondingCurveAddress(binding.mint)] : [], await pumpSwapGlobalConfigAddress(), await pumpSwapFeeConfigAddress(), clock2])].sort();
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await rpc.call("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64", minContextSlot: header.context.slot }]);
    if (!Number.isSafeInteger(r?.context?.slot) || r.context.slot < header.context.slot || r.value?.length !== addresses.length || r.value.some((a) => !a || a.data?.[1] !== "base64")) throw Error("CURRENT_ROUTE_INCOMPLETE");
    const c = r.value[addresses.indexOf(clock2)], raw = Buffer.from(c.data[0], "base64");
    if (c.owner !== "Sysvar1111111111111111111111111111111111111" || raw.length !== 40 || raw.readBigUInt64LE(0) !== BigInt(r.context.slot)) {
      if (attempt < 2) continue;
      throw Error("CURRENT_CLOCK_CONTEXT");
    }
    const at = Number(raw.readBigInt64LE(32)) * 1e3;
    if (at > now() || now() - at > 1e4) throw Error("CURRENT_ROUTE_STALE");
    const s = { version: "NON_SOL_PUMPSWAP_STAGE1_V1", ...binding, slot: r.context.slot, observedAt: new Date(at).toISOString(), accounts: Object.fromEntries(addresses.map((a, i) => [a, { owner: r.value[i].owner, base64: r.value[i].data[0] }])), absentAccounts: [] };
    await archive.bank(s);
    return s;
  }
  throw Error("CURRENT_CLOCK_CONTEXT");
}
export {
  AuthService,
  CURRENT_QUOTE_VERSION,
  CompetitionService,
  FinalizedBankArchive,
  FinalizedFlowConnector,
  FinalizedRpc,
  FootprintFlowConnector,
  GenericCapability,
  LinkedStateStore,
  buildApp,
  captureCurrentPumpRoute,
  composeScopedProduction,
  createDatabase,
  createProductionExecutionRouter,
  currentQuoteRouter,
  genericCapabilityOptions,
  prepareOperational,
  projectRetainedInterval,
  runHourlyLifecycleTick,
  scopedExitPermission
};
