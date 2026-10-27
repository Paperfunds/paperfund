/** A strict public projection of existing read-only evidence. No operator endpoint or credentials are exposed. */
import { publicPaymentState } from './public-payment-state.mjs';
import { readFile } from 'node:fs/promises';
const data = new URL('../artifacts/operator/', import.meta.url);
async function evidence(name) {
  try {
    return JSON.parse(await readFile(new URL(name, data), 'utf8'));
  } catch {
    return null;
  }
}
const amount = (value) =>
  typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? value : null;
const signature = (value) =>
  typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value) ? value : null;
const date = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
export function creatorObservations(events) {
  if (!Array.isArray(events)) return { total: null, rows: [] };
  const unique = new Map();
  let valid = true;
  for (const row of events) {
    const sig = signature(row.transactionSignature),
      lamports = amount(row.creatorFeeLamports);
    const eventTime = date(row.eventTime);
    if (
      !sig ||
      lamports === null ||
      !Number.isSafeInteger(row.eventIndex) ||
      row.eventIndex < 0 ||
      !eventTime
    ) {
      valid = false;
      continue;
    }
    const key = `${sig}:${row.eventIndex}`;
    const prior = unique.get(key);
    if (prior && (prior.lamports !== lamports || prior.eventTime !== eventTime)) valid = false;
    else
      unique.set(key, {
        signature: sig,
        eventIndex: row.eventIndex,
        eventTime,
        lamports,
        status: 'OBSERVED_REVIEW',
      });
  }
  return {
    total: valid
      ? [...unique.values()].reduce((sum, row) => sum + BigInt(row.lamports), 0n).toString()
      : null,
    rows: [...unique.values()].slice(0, 50),
  };
}
export async function publicRewardEvidence() {
  const [funding, provider, accounting, payment] = await Promise.all([
    evidence('winner-funding-latest.json'),
    evidence('reward-provider-latest.json'),
    evidence('reward-accounting-latest.json'),
    publicPaymentState(),
  ]);
  const observations = creatorObservations(funding?.events);
  return {
    readAt: new Date().toISOString(),
    // This website cannot release STOP. Evidence age is exposed; missing state fails closed.
    payoutsActive: false,
    stop: payment.stop,
    paymentStateObservedAt: payment.paymentStateObservedAt,
    accountingObservedAt: date(accounting?.observedAt),
    providerObservedAt: date(provider?.observedAt),
    fundingObservedAt: date(funding?.at),
    observedCreatorFeesLamports: observations.total,
    receivedCreatorFeesLamports: amount(provider?.verifiedReceivedCreatorFeeLamports),
    qualifiedLamports: amount(payment.qualifiedLamports),
    reservedLamports: amount(payment.reservedLamports),
    qualification: 'REVIEW',
    claimReceipt: signature(funding?.claimReceipt?.signature)
      ? {
          signature: signature(funding.claimReceipt.signature),
          grossLamports: amount(funding.claimReceipt.grossLamports),
          commitment: funding.claimReceipt.commitment === 'finalized' ? 'finalized' : 'unavailable',
          status: 'REVIEW_NOT_PAYOUT_CAPITAL',
        }
      : null,
    observations: observations.rows,
    payoutHistoryStatus:
      payment.payoutHistory === null
        ? 'VERIFIED_RECEIPTS_UNAVAILABLE'
        : payment.payoutHistory.length === 0
          ? 'NO_RECORDED_PAYOUTS'
          : 'VERIFIED_PAYMENTS',
    payoutHistory: (payment.payoutHistory ?? [])
      .filter((row) => signature(row.signature))
      .map((row) => ({
        signature: signature(row.signature),
        lamports: amount(row.lamports),
        verifiedAt: date(row.verifiedAt),
        status: 'VERIFIED',
      })),
  };
}
