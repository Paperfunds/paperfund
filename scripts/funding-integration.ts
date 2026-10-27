import type { DatabaseService } from '../packages/db/src/database.js';
import { runCreatorFeeIngestionTick } from '../packages/db/src/creator-fee-ingestion.js';
import {
  installPayoutTreasury,
  type TreasuryObservation,
  type TreasuryPolicy,
} from '../packages/db/src/payout-treasury.js';
import { type FundingArchive, digest } from './funding-archive.js';

function isolated(database: DatabaseService) {
  const url = new URL(database.pool.options.connectionString ?? '');
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '55462' ||
    !/^\/legacy_beta_[0-9]+_[a-f0-9]{32}$/.test(url.pathname)
  )
    throw Error('DISPOSABLE_FUNDING_DATABASE_REQUIRED');
}

/** Replays the accepted ingestion path, retaining the real source hash. Never polls or writes mainnet. */
export async function importCapturedCreatorFees(
  database: DatabaseService,
  archive: FundingArchive,
  now: Date,
  shadowMode = true,
) {
  isolated(database);
  return runCreatorFeeIngestionTick(database, archive.source(), now, { shadowMode });
}

export function fundingProjection(archive: FundingArchive) {
  const earned = archive.verifiedEvents.reduce((n, e) => n + e.creatorFeeLamports, 0n);
  return Object.freeze({
    network: 'mainnet-beta' as const,
    mint: archive.identity.tokenMint,
    verifiedFeeRecipient: archive.identity.creatorWallet,
    creatorVault: archive.creatorVault,
    earnedLamports: earned,
    accruedVaultExcessLamports: archive.claimableLamports,
    historicalClaims: archive.successfulClaims.length,
    receivedCreatorFeeLamports: 0n,
    designatedTreasury: null,
    treasuryReceipts: Object.freeze([]),
    reservableMainnetPrincipalLamports: 0n,
    fundingState: 'REVIEW' as const,
    settlementState: 'REVIEW' as const,
    reasons: Object.freeze([
      'TREASURY_NOT_DESIGNATED',
      'CREATOR_FEES_NOT_RECEIVED_IN_TREASURY',
      'PROVIDER_FINANCIAL_QUALIFICATION_OPEN',
      'UTC_SETTLEMENT_QUALIFICATION_OPEN',
    ]),
    capturedAt: archive.observedAt.toISOString(),
    sourceEvidenceHash: archive.sourceHash,
    officialIdlPinsHash: archive.officialHash,
    historyCoverage: archive.rpcReportedHistoryExhausted
      ? 'RPC_REPORTED_EXHAUSTED_NOT_INDEPENDENTLY_QUALIFIED'
      : 'INCOMPLETE',
  });
}

/** Installs the actual captured REVIEW into the accepted treasury engine in a disposable DB only.
 * Explicit test limits are mandatory and confer no mainnet spending authorization.
 * Accrued vault fees, ordinary wallet transfers and balances are never manufactured into receipts.
 */
export function connectCapturedFundingReview(
  database: DatabaseService,
  archive: FundingArchive,
  policy: TreasuryPolicy,
  clock: () => number,
) {
  isolated(database);
  const p = fundingProjection(archive),
    treasury = 'UNASSIGNED';
  const observe = async (
    planId: string,
    planSnapshotHash: string,
  ): Promise<TreasuryObservation> => ({
    planId,
    planSnapshotHash,
    network: 'mainnet-beta',
    treasury,
    observedAt: +archive.observedAt,
    finalizedSlot: BigInt(archive.snapshotSlot),
    balance: 0n,
    receipts: [],
    settlementState: 'REVIEW',
    settlementEvidenceHash: digest('UNQUALIFIED_RETAINED_ENGINE:' + archive.sourceHash),
    fundingState: 'REVIEW',
    fundingEvidenceHash: digest(
      JSON.stringify(p, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    ),
  });
  installPayoutTreasury(database, { network: 'mainnet-beta', treasury, policy, clock, observe });
  return { projection: p, observe };
}
