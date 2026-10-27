import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import {
  competitionConfig,
  processHourlyRewardEconomics,
  type CompletedNaturalHourlyReward,
} from '@paperfund/core';
import type { DatabaseService } from './database.js';
import { approvalSnapshotHash, captureApprovalSnapshot } from './payout-approval.js';
import { getPayoutPlanAudit, PayoutPlanError } from './payout-service.js';

// Protected bootstrap dependencies, never supplied by an execution request or environment amount.
// No live adapter, receipt, custody configuration or monetary policy is installed here.
export interface TreasuryReceipt {
  readonly identity: string; // finalized transfer identity, including instruction index
  readonly kind: 'CREATOR_FEE' | 'NETWORK_FEES';
  readonly creatorFeeEventId: string | null;
  // Optional explicit partition for consolidated deposits or partial receipts. Legacy single-event
  // shape remains supported. Each physical transfer identity is still counted exactly once.
  readonly allocations?: readonly {
    readonly creatorFeeEventId: string;
    readonly lamports: bigint;
  }[];
  readonly lamports: bigint;
  readonly finalizedSlot: bigint;
  readonly evidenceHash: string;
}
export interface TreasuryObservation {
  readonly planId: string;
  readonly planSnapshotHash: string;
  readonly network: string;
  readonly treasury: string;
  readonly observedAt: number;
  readonly finalizedSlot: bigint;
  readonly balance: bigint;
  readonly receipts: readonly TreasuryReceipt[];
  readonly creatorClaims?: readonly CreatorDistributionClaim[];
  readonly platformSettlements?: readonly PlatformSettlement[];
  readonly settlementState: 'ACCEPTED' | 'REVIEW';
  readonly settlementEvidenceHash: string;
  // Stable, independently verified completeness proof for finalized source fees/cutoff and
  // their canonical accounting. A database FINALIZED/COUNTED flag alone is not this proof.
  readonly fundingState: 'COMPLETE' | 'REVIEW';
  readonly fundingEvidenceHash: string;
}
export interface CreatorDistributionClaim {
  readonly identity: string;
  readonly grossLamports: bigint;
  readonly allocations: readonly {
    readonly creatorFeeEventId: string;
    readonly lamports: bigint;
  }[];
  readonly finalizedSlot: bigint;
  readonly evidenceHash: string;
}
export interface PlatformSettlement {
  readonly identity: string;
  readonly claimIdentity: string;
  readonly kind: 'TRANSFER' | 'COST';
  readonly destination: string;
  readonly lamports: bigint;
  readonly allocations: readonly {
    readonly creatorFeeEventId: string;
    readonly lamports: bigint;
  }[];
  readonly finalizedSlot: bigint;
  readonly evidenceHash: string;
}
export interface TreasuryPolicy {
  readonly reserveLamports?: bigint;
  readonly recipient: bigint;
  readonly plan: bigint;
  readonly outstanding: bigint;
  readonly daily: bigint;
  readonly pilot: bigint;
  readonly maxFeePerTransaction: bigint;
  readonly maxEvidenceAgeMs: number;
}
interface TreasuryRuntime {
  readonly network: string;
  readonly treasury: string;
  readonly policy: TreasuryPolicy;
  readonly clock: () => number;
  // Must independently verify finalized received cash, complete custody history and settlement
  // acceptance, pinned to this deployment. Creator-vault accrual is NOT a treasury receipt.
  readonly observe: (planId: string, planSnapshotHash: string) => Promise<TreasuryObservation>;
}
const runtimes = new WeakMap<DatabaseService, TreasuryRuntime>();
const scope = new AsyncLocalStorage<{
  runtime: TreasuryRuntime;
  database: DatabaseService;
  planId: string;
}>();
function fail(code: string): never {
  throw new PayoutPlanError(
    code,
    'Treasury evidence requires HOLD or independent review; no reward was changed.',
  );
}
export function installPayoutTreasury(database: DatabaseService, runtime: TreasuryRuntime) {
  if (runtimes.has(database)) fail('PAYOUT_TREASURY_ALREADY_INSTALLED');
  if (
    runtime.policy.reserveLamports !== undefined &&
    (typeof runtime.policy.reserveLamports !== 'bigint' || runtime.policy.reserveLamports < 0n)
  )
    fail('PAYOUT_TREASURY_POLICY_INVALID');
  for (const value of [
    runtime.policy.recipient,
    runtime.policy.plan,
    runtime.policy.outstanding,
    runtime.policy.daily,
    runtime.policy.pilot,
    runtime.policy.maxFeePerTransaction,
  ])
    if (typeof value !== 'bigint' || value <= 0n) fail('PAYOUT_TREASURY_POLICY_INVALID');
  if (
    !Number.isSafeInteger(runtime.policy.maxEvidenceAgeMs) ||
    runtime.policy.maxEvidenceAgeMs <= 0
  )
    fail('PAYOUT_TREASURY_POLICY_INVALID');
  runtimes.set(
    database,
    Object.freeze({ ...runtime, policy: Object.freeze({ ...runtime.policy }) }),
  );
}

// Global economic serialization is intentionally conservative: approval, payment and reconciliation
// share one session lock across hourly/daily plans, curve versions and treasury configuration.
// STOP uses its independent control connection and never needs this lock.
export async function withPayoutTreasury<T>(
  database: DatabaseService,
  planId: string,
  run: (database: DatabaseService) => Promise<T>,
): Promise<T> {
  const runtime = runtimes.get(database);
  if (!runtime) fail('PAYOUT_TREASURY_NOT_CONFIGURED');
  const client = await database.pool.connect();
  let locked = false;
  let broken = false;
  const onError = () => {
    broken = true;
  };
  client.on('error', onError);
  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtextextended('paperfund-treasury-all-obligations-v1',0)) locked",
    );
    if (!result.rows[0]?.locked) fail('PAYOUT_TREASURY_BUSY');
    locked = true;
    const lease = {
      query: client.query.bind(client),
      on: client.on.bind(client),
      off: client.off.bind(client),
      release(error?: boolean | Error) {
        if (error) broken = true;
      },
    } as unknown as PoolClient;
    const scoped = {
      ...database,
      pool: {
        query: client.query.bind(client),
        async connect() {
          return lease;
        },
      } as unknown as DatabaseService['pool'],
    };
    return await scope.run({ runtime, database: scoped, planId }, () => run(scoped));
  } catch (error) {
    broken = true;
    throw error;
  } finally {
    if (locked)
      try {
        await client.query('rollback');
        await client.query(
          "select pg_advisory_unlock(hashtextextended('paperfund-treasury-all-obligations-v1',0))",
        );
      } catch {
        broken = true;
      }
    client.release(broken);
    client.off('error', onError);
  }
}
function context() {
  const c = scope.getStore();
  if (!c) fail('PAYOUT_TREASURY_SCOPE_REQUIRED');
  return c;
}
type Row = Record<string, unknown>;
function text(row: Row, key: string): string {
  const v = row[key];
  if (typeof v !== 'string') fail('PAYOUT_FUNDING_EVIDENCE_INVALID');
  return v;
}
function money(row: Row, key: string): bigint {
  const v = row[key];
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  const s = text(row, key);
  if (!/^-?\d+$/.test(s)) fail('PAYOUT_FUNDING_EVIDENCE_INVALID');
  return BigInt(s);
}
function date(row: Row, key: string): Date {
  const v = row[key];
  if (!(v instanceof Date) || !Number.isFinite(v.getTime()))
    fail('PAYOUT_FUNDING_EVIDENCE_INVALID');
  return v;
}
function hash(value: unknown) {
  return approvalSnapshotHash(value);
}
async function rows(table: string) {
  return (
    await context().database.pool.query<Row>(
      'select *' +
        (table === 'payout_treasury_days' ? ',utc_day::text utc_day' : '') +
        ' from ' +
        table,
    )
  ).rows;
}
function checkObservation(o: TreasuryObservation, approvalHash: string) {
  const { runtime } = context();
  const now = runtime.clock();
  if (
    o.planId !== context().planId ||
    o.planSnapshotHash !== approvalHash ||
    o.fundingState !== 'COMPLETE' ||
    !/^[a-f0-9]{64}$/.test(o.fundingEvidenceHash) ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(o.observedAt) ||
    o.observedAt > now ||
    now - o.observedAt > runtime.policy.maxEvidenceAgeMs ||
    o.network !== runtime.network ||
    o.treasury !== runtime.treasury ||
    typeof o.balance !== 'bigint' ||
    o.balance < 0n ||
    typeof o.finalizedSlot !== 'bigint' ||
    o.finalizedSlot < 0n ||
    o.settlementState !== 'ACCEPTED' ||
    !/^[a-f0-9]{64}$/.test(o.settlementEvidenceHash)
  )
    fail('PAYOUT_TREASURY_EVIDENCE_UNAVAILABLE');
}

async function funding(approvalHash: string) {
  const { database, runtime, planId } = context();
  const o = await runtime.observe(planId, approvalHash);
  checkObservation(o, approvalHash);
  const checkpoints = await rows('creator_fee_ingestion_checkpoints');
  if (
    !checkpoints.length ||
    checkpoints.some(
      (c) =>
        c['network'] !== runtime.network ||
        c['last_error_category'] !== null ||
        !(c['last_success_at'] instanceof Date) ||
        runtime.clock() - c['last_success_at'].getTime() > runtime.policy.maxEvidenceAgeMs ||
        c['last_success_at'].getTime() > runtime.clock() ||
        c['last_finalized_slot'] === null,
    )
  )
    fail('PAYOUT_FUNDING_PROVIDER_UNHEALTHY');
  for (const table of ['creator_fee_reconciliation_findings', 'late_fee_reconciliations'])
    if ((await rows(table)).some((r) => r['status'] !== 'RESOLVED'))
      fail('PAYOUT_FUNDING_RECONCILIATION_OPEN');
  const observations = await rows('creator_fee_observations');
  if (observations.some((r) => r['confirmation_status'] !== 'FINALIZED'))
    fail('PAYOUT_FUNDING_OBSERVATION_UNFINALIZED');
  const events = await rows('creator_fee_events');
  if (
    events.some(
      (e) => e['verification_status'] !== 'VERIFIED' || e['accounting_status'] !== 'COUNTED',
    )
  )
    fail('PAYOUT_FUNDING_EVENT_UNSUPPORTED');
  const creatorClaims = o.creatorClaims ?? [],
    platformSettlements = o.platformSettlements ?? [];
  const split = creatorClaims.length > 0 || platformSettlements.length > 0;
  if (
    split &&
    (runtime.policy.reserveLamports === undefined || runtime.policy.reserveLamports <= 0n)
  )
    fail('PAYOUT_TREASURY_RESERVE_POLICY_REQUIRED');
  const distributionDocuments = [
    ...creatorClaims.map((document) => ({ identity: document.identity, kind: 'CLAIM', document })),
    ...platformSettlements.map((document) => ({
      identity: document.identity,
      kind: 'PLATFORM',
      document,
    })),
  ];
  const distributionTable = (
    await database.pool.query(
      "select to_regclass('public.payout_creator_distribution_evidence') present",
    )
  ).rows[0]?.present;
  if (split && !distributionTable) fail('PAYOUT_PLATFORM_SCHEMA_REQUIRED');
  const storedDistributions = distributionTable
    ? await rows('payout_creator_distribution_evidence')
    : [];
  for (const s of storedDistributions) {
    const d = distributionDocuments.find((d) => d.identity === s['identity']);
    if (
      !d ||
      s['kind'] !== d.kind ||
      s['network'] !== runtime.network ||
      s['treasury'] !== runtime.treasury ||
      hash(s['document']) !== hash(d.document)
    )
      fail('PAYOUT_PLATFORM_EVIDENCE_CHANGED');
  }
  const claimCredits = new Map<string, bigint>(),
    distributionIdentities = new Set<string>(),
    platformByHour = new Map<string, bigint>();
  for (const c of creatorClaims) {
    if (
      !c.identity ||
      distributionIdentities.has(c.identity) ||
      typeof c.grossLamports !== 'bigint' ||
      c.grossLamports <= 0n ||
      c.finalizedSlot > o.finalizedSlot ||
      !/^[a-f0-9]{64}$/.test(c.evidenceHash) ||
      !c.allocations.length ||
      new Set(c.allocations.map((a) => a.creatorFeeEventId)).size !== c.allocations.length ||
      c.allocations.reduce((n, a) => n + a.lamports, 0n) !== c.grossLamports
    )
      fail('PAYOUT_CREATOR_CLAIM_INVALID');
    distributionIdentities.add(c.identity);
    for (const a of c.allocations) {
      const event = events.find((e) => e['id'] === a.creatorFeeEventId);
      if (!event || c.finalizedSlot < money(event, 'slot'))
        fail('PAYOUT_CREATOR_CLAIM_EVENT_MISMATCH');
      if (a.lamports <= 0n || claimCredits.has(a.creatorFeeEventId))
        fail('PAYOUT_CREATOR_CLAIM_DUPLICATE');
      claimCredits.set(a.creatorFeeEventId, a.lamports);
    }
  }
  for (const p of platformSettlements) {
    const c = creatorClaims.find((c) => c.identity === p.claimIdentity);
    if (
      !c ||
      !p.identity ||
      distributionIdentities.has(p.identity) ||
      !['TRANSFER', 'COST'].includes(p.kind) ||
      !p.destination ||
      typeof p.lamports !== 'bigint' ||
      p.lamports <= 0n ||
      p.finalizedSlot < c.finalizedSlot ||
      p.finalizedSlot > o.finalizedSlot ||
      !/^[a-f0-9]{64}$/.test(p.evidenceHash) ||
      !p.allocations.length ||
      new Set(p.allocations.map((a) => a.creatorFeeEventId)).size !== p.allocations.length ||
      p.allocations.reduce((n, a) => n + a.lamports, 0n) !== p.lamports
    )
      fail('PAYOUT_PLATFORM_SETTLEMENT_INVALID');
    distributionIdentities.add(p.identity);
    for (const a of p.allocations) {
      const e = events.find((e) => e['id'] === a.creatorFeeEventId);
      if (
        !e ||
        a.lamports <= 0n ||
        !c.allocations.some((v) => v.creatorFeeEventId === a.creatorFeeEventId) ||
        p.finalizedSlot < money(e, 'slot')
      )
        fail('PAYOUT_PLATFORM_ALLOCATION_INVALID');
      const id = text(e, 'hourly_round_id');
      platformByHour.set(id, (platformByHour.get(id) ?? 0n) + a.lamports);
    }
  }
  const receipts = o.receipts
    .map((r) => ({
      ...r,
      allocations: [
        ...(r.allocations ??
          (r.creatorFeeEventId
            ? [{ creatorFeeEventId: r.creatorFeeEventId, lamports: r.lamports }]
            : [])),
      ].sort((a, b) =>
        a.creatorFeeEventId < b.creatorFeeEventId
          ? -1
          : a.creatorFeeEventId > b.creatorFeeEventId
            ? 1
            : 0,
      ),
    }))
    .sort((a, b) => (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
  const identities = new Set<string>();
  const feeCredits = new Map<string, bigint>();
  let cash = 0n;
  let feeCapital = 0n;
  // Platform evidence is external to the player treasury: it satisfies gross ownership,
  // but never increases player cash or network-fee capital.
  const credits = [
    ...receipts,
    ...platformSettlements.map((p) => ({
      ...p,
      kind: 'EXTERNAL_PLATFORM',
      creatorFeeEventId: p.allocations[0]!.creatorFeeEventId,
    })),
  ];
  for (const r of credits) {
    if (
      !r.identity ||
      identities.has(r.identity) ||
      !/^[a-f0-9]{64}$/.test(r.evidenceHash) ||
      typeof r.lamports !== 'bigint' ||
      r.lamports <= 0n ||
      typeof r.finalizedSlot !== 'bigint' ||
      r.finalizedSlot < 0n ||
      r.finalizedSlot > o.finalizedSlot
    )
      fail('PAYOUT_TREASURY_RECEIPT_INVALID');
    identities.add(r.identity);
    if (r.kind !== 'EXTERNAL_PLATFORM') cash += r.lamports;
    if (r.kind === 'CREATOR_FEE' || r.kind === 'EXTERNAL_PLATFORM') {
      const parts = new Set<string>();
      let partitioned = 0n;
      if (
        !r.allocations.length ||
        !r.allocations.some((a) => a.creatorFeeEventId === r.creatorFeeEventId)
      )
        fail('PAYOUT_TREASURY_RECEIPT_INVALID');
      for (const allocation of r.allocations) {
        if (
          parts.has(allocation.creatorFeeEventId) ||
          typeof allocation.lamports !== 'bigint' ||
          allocation.lamports <= 0n
        )
          fail('PAYOUT_TREASURY_RECEIPT_INVALID');
        parts.add(allocation.creatorFeeEventId);
        partitioned += allocation.lamports;
        const e = events.find((e) => e['id'] === allocation.creatorFeeEventId);
        const observed = observations.find(
          (v) => v['canonical_creator_fee_event_id'] === allocation.creatorFeeEventId,
        );
        if (
          !e ||
          !observed ||
          (feeCredits.get(allocation.creatorFeeEventId) ?? 0n) + allocation.lamports >
            money(e, 'creator_fee_lamports') ||
          observed['transaction_signature'] !== e['transaction_signature'] ||
          observed['event_index'] !== e['event_index'] ||
          observed['source_program'] !== e['source_program'] ||
          date(observed, 'block_time').getTime() !== date(e, 'event_time').getTime() ||
          !(observed['finalized_at'] instanceof Date) ||
          r.finalizedSlot < money(e, 'slot') ||
          money(observed, 'creator_fee_lamports') !== money(e, 'creator_fee_lamports') ||
          money(observed, 'slot') !== money(e, 'slot') ||
          money(e, 'slot') > o.finalizedSlot ||
          !checkpoints.some(
            (c) =>
              c['creator_wallet'] === observed['creator_wallet'] &&
              c['token_mint'] === observed['token_mint'] &&
              money(c, 'last_finalized_slot') >= money(e, 'slot'),
          )
        )
          fail('PAYOUT_TREASURY_RECEIPT_UNSUPPORTED');
        feeCredits.set(
          allocation.creatorFeeEventId,
          (feeCredits.get(allocation.creatorFeeEventId) ?? 0n) + allocation.lamports,
        );
      }
      if (partitioned !== r.lamports) fail('PAYOUT_TREASURY_RECEIPT_INVALID');
    } else if (
      r.kind === 'NETWORK_FEES' &&
      r.creatorFeeEventId === null &&
      r.allocations.length === 0
    )
      feeCapital += r.lamports;
    else fail('PAYOUT_TREASURY_RECEIPT_INVALID');
  }
  if (events.some((e) => feeCredits.get(text(e, 'id')) !== money(e, 'creator_fee_lamports')))
    fail('PAYOUT_CREATOR_REVENUE_NOT_RECEIVED');
  if (
    split &&
    (events.some((e) => claimCredits.get(text(e, 'id')) !== money(e, 'creator_fee_lamports')) ||
      claimCredits.size !== events.length)
  )
    fail('PAYOUT_CREATOR_CLAIM_COVERAGE_REQUIRED');
  const stored = await rows('payout_treasury_receipts');
  for (const s of stored) {
    const r = receipts.find((r) => r.identity === s['identity']);
    if (
      !r ||
      s['network'] !== runtime.network ||
      s['treasury'] !== runtime.treasury ||
      s['kind'] !== r.kind ||
      s['creator_fee_event_id'] !== r.creatorFeeEventId ||
      hash(s['allocations']) !== hash(r.allocations) ||
      money(s, 'lamports') !== r.lamports ||
      money(s, 'finalized_slot') !== r.finalizedSlot ||
      s['evidence_hash'] !== r.evidenceHash
    )
      fail('PAYOUT_TREASURY_RECEIPT_CHANGED');
  }
  const pools = await rows('hourly_reward_pools');
  const rounds = await rows('hourly_rounds');
  const days = await rows('daily_reward_pools');
  const competitions = await rows('daily_competitions');
  const contributions = await rows('daily_reward_contributions');
  const accounts = await rows('competition_accounts');
  const positions = await rows('positions');
  const movements = await rows('reward_buffer_movements');
  const carries = (await rows('no_participant_reward_outcomes')).sort(
    (a, b) => date(a, 'recorded_at').getTime() - date(b, 'recorded_at').getTime(),
  );
  const hourlyResults = await rows('hourly_results');
  const dailyResults = await rows('daily_results');
  let carryIndex = 0;
  let carriedHourly = 0n;
  let carriedDaily = 0n;
  let expectedMovements = 0;
  let buffer = 0n;
  let hourly = 0n;
  let daily = 0n;
  let platform = 0n;
  function applyCarry(c: Row) {
    const isHour = c['competition_type'] === 'HOURLY';
    const source = isHour ? c['hourly_round_id'] : c['daily_competition_id'];
    const pool = (isHour ? pools : days).find(
      (p) => p[isHour ? 'hourly_round_id' : 'daily_competition_id'] === source,
    );
    if (
      !pool ||
      (isHour ? hourlyResults : dailyResults).some(
        (r) => r[isHour ? 'hourly_round_id' : 'daily_competition_id'] === source,
      ) ||
      money(c, 'carried_lamports') !==
        money(pool, isHour ? 'final_hourly_prize_lamports' : 'accumulated_lamports') ||
      date(c, 'recorded_at') < date(pool, isHour ? 'frozen_at' : 'finalized_at')
    )
      fail('PAYOUT_BUFFER_REVIEW_REQUIRED');
    const amount = money(c, 'carried_lamports');
    if (amount > 0n) {
      const m = movements.find((m) => m['id'] === c['reward_buffer_movement_id']);
      if (
        !m ||
        m['reason'] !== 'ZERO_PARTICIPANT_CARRY_FORWARD' ||
        m[isHour ? 'hourly_reward_pool_id' : 'daily_reward_pool_id'] !== pool['id'] ||
        money(m, 'amount_lamports') !== amount ||
        money(m, 'starting_balance_lamports') !== buffer ||
        money(m, 'ending_balance_lamports') !== buffer + amount
      )
        fail('PAYOUT_BUFFER_REVIEW_REQUIRED');
      expectedMovements++;
    }
    buffer += amount;
    if (isHour) carriedHourly += amount;
    else carriedDaily += amount;
  }
  const history: CompletedNaturalHourlyReward[] = [];
  pools.sort(
    (a, b) =>
      date(
        rounds.find((r) => r['id'] === a['hourly_round_id'])!,
        'starts_at',
      ).getTime() -
      date(
        rounds.find((r) => r['id'] === b['hourly_round_id'])!,
        'starts_at',
      ).getTime(),
  );
  for (const p of pools) {
    while (
      carryIndex < carries.length &&
      date(carries[carryIndex]!, 'recorded_at') < date(p, 'frozen_at')
    )
      applyCarry(carries[carryIndex++]!);
    const r = rounds.find((r) => r['id'] === p['hourly_round_id']);
    if (
      !r ||
      r['state'] !== 'FINALIZED' ||
      date(p, 'frozen_at').getTime() > runtime.clock() ||
      date(r, 'finalized_at').getTime() > runtime.clock() ||
      !['FROZEN', 'FINAL'].includes(text(p, 'status')) ||
      date(p, 'frozen_at').getTime() <
        date(r, 'ends_at_exclusive').getTime() +
          Number(r['reward_finalization_grace_period_seconds']) * 1000 ||
      accounts.some(
        (a) =>
          a['hourly_round_id'] === r['id'] &&
          (a['finalized_at'] === null || a['final_settled_balance_lamports'] === null),
      ) ||
      positions.some(
        (pos) =>
          accounts.some(
            (a) => a['id'] === pos['competition_account_id'] && a['hourly_round_id'] === r['id'],
          ) &&
          (money(pos, 'remaining_base_units') !== 0n || pos['status'] !== 'CLOSED'),
      )
    )
      fail('PAYOUT_SETTLEMENT_REVIEW_REQUIRED');
    const total = events
      .filter((e) => e['hourly_round_id'] === r['id'])
      .reduce((n, e) => n + money(e, 'creator_fee_lamports'), 0n);
    if (
      total !== money(p, 'creator_fee_lamports') ||
      buffer !== money(p, 'starting_buffer_lamports')
    )
      fail('PAYOUT_REWARD_FREEZE_INVALID');
    // Reuse the existing integer economics, including baseline history, dynamic support and dust.
    const config = {
      ...competitionConfig,
      rewardBuffer: {
        ...competitionConfig.rewardBuffer,
        baselineWindowCompletedHours: Number(p['baseline_window']),
        lambdaBps: money(p, 'lambda_bps') as typeof competitionConfig.rewardBuffer.lambdaBps,
      },
    };
    // pg returns integer columns as numbers; bigint monetary columns remain decimal strings.
    const result = processHourlyRewardEconomics({
      creatorFeeLamports: total,
      mode: text(p, 'allocation_mode'),
      currentBufferLamports: buffer,
      previousCompletedNaturalHourlyRewards: [...history].slice(-Number(p['baseline_window'])),
      config,
    });
    if (!result.ok) fail('PAYOUT_REWARD_FREEZE_INVALID');
    const e = result.economics;
    const expectedIds =
      e.baseline.ok && e.baseline.status === 'ACTIVE' ? e.baseline.includedHourlyRoundIds : [];
    if (
      hash(p['baseline_input_round_ids']) !== hash(expectedIds) ||
      (e.baseline.ok && e.baseline.status === 'ACTIVE'
        ? money(p, 'baseline_lamports') !== e.baseline.baselineLamports
        : p['baseline_lamports'] !== null)
    )
      fail('PAYOUT_REWARD_FREEZE_INVALID');
    for (const [key, value] of Object.entries({
      natural_hourly_lamports: e.naturalHourlyLamports,
      explicit_buffer_contribution_lamports: e.explicitBufferLamports,
      daily_allocation_lamports: e.dailyContributionLamports,
      platform_allocation_lamports: e.platformContributionLamports,
      dynamic_target_lamports: e.dynamicTargetLamports,
      dynamic_buffer_deposit_lamports: e.dynamicDepositLamports,
      dynamic_buffer_support_lamports: e.dynamicWithdrawalLamports,
      final_hourly_prize_lamports: e.actualHourlyPrizeLamports,
      ending_buffer_lamports: e.endingBufferLamports,
    }))
      if (money(p, key) !== value) fail('PAYOUT_REWARD_FREEZE_INVALID');
    const rates =
      p['allocation_mode'] === 'NORMAL'
        ? competitionConfig.creatorFees.normal
        : competitionConfig.creatorFees.bufferAccumulation;
    if (
      Number(p['hourly_rate_bps']) !== Number(rates.hourlyBps) ||
      Number(p['daily_rate_bps']) !== Number(rates.dailyBps) ||
      Number(p['buffer_rate_bps']) !== Number(rates.bufferContributionBps) ||
      Number(p['platform_rate_bps']) !== Number(rates.platformBps)
    )
      fail('PAYOUT_REWARD_FREEZE_INVALID');
    let moving = buffer;
    for (const [reason, amount] of [
      ['EXPLICIT_ACCUMULATION', e.explicitBufferLamports],
      ['DYNAMIC_EXCESS_DEPOSIT', e.dynamicDepositLamports],
      ['WEAK_HOUR_SUPPORT', -e.dynamicWithdrawalLamports],
    ] as const) {
      if (amount === 0n) continue;
      const m = movements.find(
        (m) => m['hourly_reward_pool_id'] === p['id'] && m['reason'] === reason,
      );
      if (
        !m ||
        money(m, 'amount_lamports') !== amount ||
        money(m, 'starting_balance_lamports') !== moving ||
        money(m, 'ending_balance_lamports') !== moving + amount
      )
        fail('PAYOUT_BUFFER_REVIEW_REQUIRED');
      moving += amount;
      expectedMovements++;
    }
    const c = contributions.filter((c) => c['hourly_reward_pool_id'] === p['id']);
    if (c.length !== 1 || money(c[0]!, 'amount_lamports') !== e.dailyContributionLamports)
      fail('PAYOUT_DAILY_FUNDING_INVALID');
    const d = days.find((d) => d['id'] === c[0]!['daily_reward_pool_id']);
    const competition = competitions.find((v) => v['id'] === d?.['daily_competition_id']);
    if (
      !competition ||
      date(r, 'starts_at') < date(competition, 'starts_at') ||
      date(r, 'starts_at') >= date(competition, 'ends_at_exclusive')
    )
      fail('PAYOUT_DAILY_FUNDING_INVALID');
    buffer = e.endingBufferLamports;
    hourly += e.actualHourlyPrizeLamports;
    platform += e.platformContributionLamports;
    if (split && (platformByHour.get(text(r, 'id')) ?? 0n) !== e.platformContributionLamports)
      fail('PAYOUT_PLATFORM_ALLOCATION_MISMATCH');
    history.push({
      hourlyRoundId: text(r, 'id') as CompletedNaturalHourlyReward['hourlyRoundId'],
      startsAt: date(r, 'starts_at').toISOString() as CompletedNaturalHourlyReward['startsAt'],
      endsAtExclusive: date(
        r,
        'ends_at_exclusive',
      ).toISOString() as CompletedNaturalHourlyReward['endsAtExclusive'],
      naturalHourlyLamports: e.naturalHourlyLamports,
    });
  }
  if (events.some((e) => !pools.some((p) => p['hourly_round_id'] === e['hourly_round_id'])))
    fail('PAYOUT_REWARD_FREEZE_INVALID');
  for (const d of days) {
    if (d['status'] !== 'OPEN' && date(d, 'finalized_at').getTime() > runtime.clock())
      fail('PAYOUT_DAILY_FUNDING_INVALID');
    const expected = contributions
      .filter((c) => c['daily_reward_pool_id'] === d['id'])
      .reduce((n, c) => n + money(c, 'amount_lamports'), 0n);
    if (money(d, 'accumulated_lamports') !== expected) fail('PAYOUT_DAILY_FUNDING_INVALID');
    daily += expected;
  }
  while (carryIndex < carries.length) applyCarry(carries[carryIndex++]!);
  hourly -= carriedHourly;
  daily -= carriedDaily;
  if (movements.length !== expectedMovements) fail('PAYOUT_BUFFER_REVIEW_REQUIRED');
  const buffers = await rows('reward_buffer_state');
  // Carry is an ownership movement, never new money or a second reward liability.
  if (buffers.reduce((n, b) => n + money(b, 'balance_lamports'), 0n) !== buffer)
    fail('PAYOUT_BUFFER_REVIEW_REQUIRED');
  const revenue = events.reduce((n, e) => n + money(e, 'creator_fee_lamports'), 0n);
  if (hourly + daily + buffer + platform !== revenue) fail('PAYOUT_TREASURY_OWNERSHIP_MISMATCH');
  const settled = await rows('payout_treasury_settlements');
  if (settled.some((s) => money(s, 'finalized_slot') > o.finalizedSlot))
    fail('PAYOUT_TREASURY_EVIDENCE_UNAVAILABLE');
  const paid = settled.reduce((n, s) => n + money(s, 'principal'), 0n);
  const fees = settled.reduce((n, s) => n + money(s, 'fee'), 0n);
  if (fees > feeCapital || cash - paid - fees !== o.balance)
    fail('PAYOUT_TREASURY_BALANCE_MISMATCH');
  const old = await database.pool.query(
    `select e.id from payout_executions e left join payout_treasury_reservations r on r.plan_id=e.payout_plan_id where r.plan_id is null limit 1`,
  );
  if (old.rowCount) fail('PAYOUT_TREASURY_HISTORY_REVIEW_REQUIRED');
  return {
    o,
    receipts,
    feeCapital,
    fees,
    paid,
    hourly,
    daily,
    buffer,
    platform,
    revenue,
    received: cash,
    liabilities: revenue - paid - platformSettlements.reduce((n, p) => n + p.lamports, 0n),
    distributionDocuments,
    settled,
  };
}

export async function reservePayoutTreasury(
  database: DatabaseService,
  planId: string,
  approvalHash: string,
) {
  return checkPayoutTreasury(database, planId, approvalHash, true);
}
/** Non-authorizing preapproval solvency review; acquires no reservation and ignores no holds. */
export async function previewPayoutTreasury(database: DatabaseService, planId: string) {
  return withPayoutTreasury(database, planId, async (scoped) => {
    const audit = await getPayoutPlanAudit(scoped, planId);
    if (!audit) fail('PAYOUT_PLAN_NOT_FOUND');
    const snapshot = await captureApprovalSnapshot(scoped, audit);
    const result = await checkPayoutTreasury(scoped, planId, hash(snapshot), false);
    return {
      snapshotHash: hash(snapshot),
      principal: result.principal,
      feeBudget: result.feeBudget,
      outstanding: result.outstanding,
      playerTreasuryBalance: result.o.balance,
      unpaidLiabilities: result.liabilities,
      platformSettled: result.o.platformSettlements?.reduce((n, p) => n + p.lamports, 0n) ?? 0n,
      financialAuthority: 'NONE' as const,
      reserveLamports: context().runtime.policy.reserveLamports ?? 0n,
    };
  });
}

async function checkPayoutTreasury(
  database: DatabaseService,
  planId: string,
  approvalHash: string,
  persist: boolean,
) {
  const { runtime } = context();
  const audit = await getPayoutPlanAudit(database, planId);
  if (!audit) fail('PAYOUT_PLAN_NOT_FOUND');
  const snapshot = await captureApprovalSnapshot(database, audit);
  if (hash(snapshot) !== approvalHash) fail('PAYOUT_TREASURY_APPROVAL_MISMATCH');
  const f = await funding(approvalHash);
  const freshAudit = await getPayoutPlanAudit(database, planId);
  if (!freshAudit || hash(await captureApprovalSnapshot(database, freshAudit)) !== approvalHash)
    fail('PAYOUT_TREASURY_APPROVAL_MISMATCH');
  const positive = snapshot.allocations.filter((a) => BigInt(a.lamports) > 0n);
  const principal = positive.reduce((n, a) => n + BigInt(a.lamports), 0n);
  const budget = BigInt(positive.length) * runtime.policy.maxFeePerTransaction;
  const sourceKey = audit.competitionType + ':' + (audit.hourlyRoundId ?? audit.dailyCompetitionId);
  const prior = (
    await database.pool.query<Row>('select * from payout_treasury_reservations where plan_id=$1', [
      planId,
    ])
  ).rows[0];
  const receiptIds = new Set<string>();
  const dailyFeeIds = new Set(snapshot.dailyFees.map((v) => String((JSON.parse(v) as Row)['id'])));
  const eventIds = (await rows('creator_fee_events'))
    .filter((e) =>
      audit.competitionType === 'HOURLY'
        ? e['hourly_round_id'] === audit.hourlyRoundId
        : dailyFeeIds.has(text(e, 'id')),
    )
    .map((e) => text(e, 'id'));
  for (const r of f.receipts)
    if (r.allocations.some((a) => eventIds.includes(a.creatorFeeEventId)))
      receiptIds.add(r.identity);
  const fundingHash = hash({
    receipts: f.receipts.filter((r) => receiptIds.has(r.identity)),
    settlement: f.o.settlementEvidenceHash,
    funding: f.o.fundingEvidenceHash,
    ...(f.distributionDocuments.length
      ? {
          distributions: f.distributionDocuments.filter((d) =>
            d.document.allocations.some((a) => eventIds.includes(a.creatorFeeEventId)),
          ),
        }
      : {}),
  });
  if (prior) {
    if (
      prior['approval_hash'] !== approvalHash ||
      prior['funding_hash'] !== fundingHash ||
      prior['source_key'] !== sourceKey ||
      money(prior, 'principal') !== principal ||
      money(prior, 'fee_budget') !== budget ||
      hash(prior['recipients']) !== hash(positive) ||
      prior['network'] !== runtime.network ||
      prior['treasury'] !== runtime.treasury
    )
      fail('PAYOUT_TREASURY_APPROVAL_MISMATCH');
  } else {
    if (
      (
        await database.pool.query('select 1 from payout_plan_approvals where payout_plan_id=$1', [
          planId,
        ])
      ).rowCount
    )
      fail('PAYOUT_TREASURY_REAPPROVAL_REQUIRED');
    if (
      (
        await database.pool.query(
          'select 1 from payout_treasury_reservations where source_key=$1',
          [sourceKey],
        )
      ).rowCount
    )
      fail('PAYOUT_SOURCE_ALREADY_RESERVED');
  }
  const reservations = await rows('payout_treasury_reservations');
  const all = prior
    ? reservations
    : [
        ...reservations,
        {
          plan_id: planId,
          principal: principal.toString(),
          fee_budget: budget.toString(),
          recipients: positive,
        },
      ];
  const exposure = all.reduce((n, r) => n + money(r, 'principal') + money(r, 'fee_budget'), 0n);
  if (
    principal > runtime.policy.plan ||
    exposure > runtime.policy.pilot ||
    f.received > runtime.policy.pilot
  )
    fail('PAYOUT_EXPOSURE_LIMIT_HOLD');
  for (const a of positive) {
    let wallet = 0n;
    let user = 0n;
    for (const r of all)
      for (const other of r['recipients'] as typeof positive) {
        if (other.destination === a.destination) wallet += BigInt(other.lamports);
        if (other.userId === a.userId) user += BigInt(other.lamports);
      }
    if (wallet > runtime.policy.recipient || user > runtime.policy.recipient)
      fail('PAYOUT_RECIPIENT_LIMIT_HOLD');
  }
  const feeHeld = all.reduce(
    (n, r) =>
      n +
      (f.settled
        .filter((s) => s['plan_id'] === r['plan_id'])
        .reduce((v, s) => v + money(s, 'principal'), 0n) === money(r, 'principal')
        ? 0n
        : money(r, 'fee_budget') -
          f.settled
            .filter((s) => s['plan_id'] === r['plan_id'])
            .reduce((v, s) => v + money(s, 'fee'), 0n)),
    0n,
  );
  // Outstanding rewards include unapproved frozen pools and buffer ownership, not just plans.
  const outstanding = f.hourly + f.daily + f.buffer - f.paid + feeHeld;
  if (outstanding > runtime.policy.outstanding) fail('PAYOUT_EXPOSURE_LIMIT_HOLD');
  const reserve = runtime.policy.reserveLamports ?? 0n;
  if (feeHeld + reserve > f.feeCapital - f.fees || f.o.balance < f.liabilities + feeHeld + reserve)
    fail('PAYOUT_TREASURY_INSUFFICIENT');
  const day = new Date(runtime.clock()).toISOString().slice(0, 10);
  const charges = await rows('payout_treasury_days');
  const dayTotal = charges
    .filter((c) => text(c, 'utc_day') === day)
    .reduce((n, c) => n + money(c, 'exposure'), 0n);
  const already = charges.some((c) => c['plan_id'] === planId && text(c, 'utc_day') === day);
  if (dayTotal + (already ? 0n : principal + budget) > runtime.policy.daily)
    fail('PAYOUT_DAILY_LIMIT_HOLD');
  if (persist && !prior) {
    for (const d of f.distributionDocuments)
      await database.pool.query(
        'insert into payout_creator_distribution_evidence(identity,kind,network,treasury,document) values($1,$2,$3,$4,$5::jsonb) on conflict(identity) do nothing',
        [
          d.identity,
          d.kind,
          runtime.network,
          runtime.treasury,
          JSON.stringify(d.document, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
        ],
      );
    for (const r of f.receipts)
      await database.pool.query(
        `insert into payout_treasury_receipts(identity,kind,creator_fee_event_id,network,treasury,lamports,finalized_slot,evidence_hash,allocations)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(identity) do nothing`,
        [
          r.identity,
          r.kind,
          r.creatorFeeEventId,
          runtime.network,
          runtime.treasury,
          r.lamports.toString(),
          r.finalizedSlot.toString(),
          r.evidenceHash,
          JSON.stringify(r.allocations, (_k, v: unknown) =>
            typeof v === 'bigint' ? v.toString() : v,
          ),
        ],
      );
    await database.pool.query(
      `insert into payout_treasury_reservations(plan_id,source_key,approval_hash,funding_hash,principal,fee_budget,recipients,network,treasury,reserved_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        planId,
        sourceKey,
        approvalHash,
        fundingHash,
        principal.toString(),
        budget.toString(),
        JSON.stringify(positive),
        runtime.network,
        runtime.treasury,
        new Date(runtime.clock()),
      ],
    );
  }
  if (persist && !already)
    await database.pool.query(
      'insert into payout_treasury_days(plan_id,utc_day,exposure) values($1,$2,$3)',
      [planId, day, (principal + budget).toString()],
    );
  return { ...f, principal, feeBudget: budget, outstanding, exposure };
}

export async function assertPayoutTreasuryEffect() {
  return checkCurrentTreasury(true);
}

// Identical hypothetical solvency/cap checks; never acquires a durable capacity claim.
export async function validatePayoutTreasuryReadOnly() {
  return checkCurrentTreasury(false);
}

async function checkCurrentTreasury(persist: boolean) {
  const { database, planId } = context();
  const row = (
    await database.pool.query<{ approval_hash: string }>(
      'select approval_hash from payout_treasury_reservations where plan_id=$1',
      [planId],
    )
  ).rows[0];
  if (!row) fail('PAYOUT_TREASURY_REAPPROVAL_REQUIRED');
  return checkPayoutTreasury(database, planId, row.approval_hash, persist);
}
export function assertTreasuryEnvironment(network: string, treasury: string) {
  const { runtime } = context();
  if (network !== runtime.network || treasury !== runtime.treasury)
    fail('PAYOUT_TREASURY_ENVIRONMENT_MISMATCH');
}
export async function assertTreasuryPreparedFees(fee: bigint) {
  const { runtime } = context();
  if (typeof fee !== 'bigint' || fee < 0n || fee > runtime.policy.maxFeePerTransaction)
    fail('PAYOUT_NETWORK_FEE_LIMIT_HOLD');
}
export async function recordTreasurySettlement(
  database: DatabaseService,
  batchId: string,
  signature: string,
  principal: bigint,
  fee: bigint | undefined,
  slot: bigint,
) {
  const c = scope.getStore();
  if (!c) fail('PAYOUT_TREASURY_SCOPE_REQUIRED');
  const row = (
    await database.pool.query<Row>(
      `select e.payout_plan_id,b.total_lamports,b.fee_lamports,b.transaction_signature from payout_batches b join payout_executions e on e.id=b.payout_execution_id where b.id=$1`,
      [batchId],
    )
  ).rows[0];
  if (
    !row ||
    row['payout_plan_id'] !== c.planId ||
    signature !== row['transaction_signature'] ||
    typeof fee !== 'bigint' ||
    fee < 0n ||
    (principal !== 0n && principal !== money(row, 'total_lamports'))
  )
    fail('PAYOUT_TREASURY_SETTLEMENT_REVIEW_REQUIRED');
  const prior = (
    await database.pool.query<Row>('select * from payout_treasury_settlements where batch_id=$1', [
      batchId,
    ])
  ).rows[0];
  if (prior) {
    if (
      prior['signature'] !== signature ||
      money(prior, 'principal') !== principal ||
      money(prior, 'fee') !== fee ||
      money(prior, 'finalized_slot') !== slot
    )
      fail('PAYOUT_TREASURY_SETTLEMENT_REVIEW_REQUIRED');
    return;
  }
  const reservation = (
    await database.pool.query<Row>(
      'select fee_budget,recipients from payout_treasury_reservations where plan_id=$1',
      [c.planId],
    )
  ).rows[0];
  const count =
    reservation && Array.isArray(reservation['recipients']) ? reservation['recipients'].length : 0;
  const used = (
    await database.pool.query<{ fees: string }>(
      'select coalesce(sum(fee),0)::text fees from payout_treasury_settlements where plan_id=$1',
      [c.planId],
    )
  ).rows[0]!;
  // Book actual finalized fees, never the estimate. The immutable approved reserve is the ceiling.
  if (
    !reservation ||
    !count ||
    fee > money(reservation, 'fee_budget') / BigInt(count) ||
    BigInt(used.fees) + fee > money(reservation, 'fee_budget')
  )
    fail('PAYOUT_TREASURY_SETTLEMENT_REVIEW_REQUIRED');
  await database.pool.query(
    'insert into payout_treasury_settlements(batch_id,plan_id,signature,principal,fee,finalized_slot) values($1,$2,$3,$4,$5,$6)',
    [batchId, c.planId, signature, principal.toString(), fee.toString(), slot.toString()],
  );
}
