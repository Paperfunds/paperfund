import { readFileSync, writeFileSync } from 'node:fs';
import { quote } from '../../candidates/simple-price-v1/model.js';
import type { Evidence, Policy } from '../../candidates/simple-price-v1/model.js';

interface RecordingSample {
  amount: string;
  state: { normalizedState: Record<string, unknown> } | null;
  reviewEvidence?: Evidence;
  buyQuote?: {
    quote: {
      outAmount: string;
      contextSlot: number;
      routePlan: { swapInfo: { ammKey: string } }[];
    };
  };
  sellQuote?: {
    quote: {
      outAmount: string;
      contextSlot: number;
      routePlan: { swapInfo: { ammKey: string } }[];
    };
  };
  referenceQuote?: {
    quote: { outAmount: string; inAmount: string; routePlan: { swapInfo: { ammKey: string } }[] };
  };
  currentBuy?: { actualOutput: { amount: string }; quote: { fees: unknown } };
  currentSell?: { actualOutput: { amount: string }; quote: { fees: unknown } };
  candidateStatus: string;
  nativeError?: string;
}
const recordings = JSON.parse(
  readFileSync('artifacts/simple-price-v1-acceptance/market-results.json', 'utf8'),
) as {
  policy: Policy;
  records: {
    label: string;
    identity?: { marketId: string };
    samples?: RecordingSample[];
    status?: string;
  }[];
};
function restore<T>(value: T): T {
  const keys = new Set([
    'n',
    'd',
    'bps',
    'slot',
    'depthLamports',
    'baseSpreadBps',
    'maxDiscrepancyBps',
    'maxMovementBps',
  ]);
  return JSON.parse(JSON.stringify(value), (k, v: unknown) =>
    keys.has(k) && typeof v === 'string' && /^[0-9]+$/.test(v) ? BigInt(v) : v,
  ) as T;
}
const results: unknown[] = [];
const policy = restore(recordings.policy);
const priorReview = JSON.parse(
  readFileSync(
    'packages/execution/candidates/simple-price-v1/fixtures/2026-10-13-pumpswap-quotes.json',
    'utf8',
  ),
) as {
  records: {
    pool: { pool: string };
    calibration: {
      quality: { depthLamports: string; baseSpreadBps: string; observedAtMs: number };
    };
  }[];
};
for (const record of recordings.records)
  for (const sample of record.samples ?? []) {
    if (
      !sample.reviewEvidence ||
      !sample.referenceQuote ||
      !sample.buyQuote ||
      !sample.sellQuote ||
      !sample.state
    ) {
      results.push({
        label: record.label,
        amount: sample.amount,
        status: sample.candidateStatus,
        nativeError: sample.nativeError,
        candidateOutput: null,
      });
      continue;
    }
    const e = restore(sample.reviewEvidence);
    // The audit runner must use Pump's creator key predicate, not the different PumpSwap state field.
    if (record.label.startsWith('recently-profiled')) {
      const s = sample.state.normalizedState;
      Object.assign(e, {
        fees: [
          { category: 'PROTOCOL', bps: BigInt(String(s['protocolFeeBps'])) },
          {
            category: 'CREATOR',
            bps:
              s['creator'] !== '11111111111111111111111111111111'
                ? BigInt(String(s['creatorFeeBps']))
                : 0n,
          },
        ],
      });
      const total = e.fees.reduce((sum, fee) => sum + fee.bps, 0n);
      Object.assign(e.observations[1]!, {
        price: {
          n: (BigInt(sample.referenceQuote.quote.inAmount) * 10_000n) / (10_000n + total),
          d: BigInt(sample.referenceQuote.quote.outAmount),
        },
      });
    }
    if (
      [sample.buyQuote, sample.sellQuote, sample.referenceQuote].some(
        (q) =>
          q.quote.routePlan.length !== 1 ||
          q.quote.routePlan[0]!.swapInfo.ammKey !== record.identity!.marketId,
      )
    )
      throw new Error('Recorded projection contains a different economic route.');
    const buy = quote('BUY', BigInt(sample.amount), e, e.identity, e.feeObservedAtMs, policy);
    const sell = quote(
      'SELL',
      BigInt(sample.buyQuote.quote.outAmount),
      e,
      e.identity,
      e.feeObservedAtMs,
      policy,
    );
    const prior = priorReview.records.find((r) => r.pool.pool === record.identity?.marketId);
    let frozenPriorComparison: unknown = null;
    if (prior) {
      const frozen = structuredClone(e);
      Object.assign(frozen.quality, {
        depthLamports: BigInt(prior.calibration.quality.depthLamports),
        baseSpreadBps: BigInt(prior.calibration.quality.baseSpreadBps),
        reference: 'FROZEN_PRIOR_REVIEW_PARAMETER_NOT_A_FRESH_QUALITY_OBSERVATION',
      });
      const frozenBuy = quote(
        'BUY',
        BigInt(sample.amount),
        frozen,
        frozen.identity,
        frozen.feeObservedAtMs,
        policy,
      );
      const frozenSell = quote(
        'SELL',
        BigInt(sample.buyQuote.quote.outAmount),
        frozen,
        frozen.identity,
        frozen.feeObservedAtMs,
        policy,
      );
      frozenPriorComparison = {
        qualityOriginallyObservedAtMs: prior.calibration.quality.observedAtMs,
        depthLamports: frozen.quality.depthLamports,
        baseSpreadBps: frozen.quality.baseSpreadBps,
        status: 'OFFLINE_SENSITIVITY_ONLY_OLD_QUALITY_IS_NOT_FRESH_EXECUTION_EVIDENCE',
        buyOutput: frozenBuy.output,
        sellOutput: frozenSell.output,
        buyRelativePpm:
          ((frozenBuy.output - BigInt(sample.buyQuote.quote.outAmount)) * 1_000_000n) /
          BigInt(sample.buyQuote.quote.outAmount),
        sellRelativePpm:
          ((frozenSell.output - BigInt(sample.sellQuote.quote.outAmount)) * 1_000_000n) /
          BigInt(sample.sellQuote.quote.outAmount),
      };
    }
    const discrepancy = (modeled: bigint, reference: string) => ({
      delta: modeled - BigInt(reference),
      relativePpm: ((modeled - BigInt(reference)) * 1_000_000n) / BigInt(reference),
    });
    results.push({
      label: record.label,
      amount: sample.amount,
      status: sample.candidateStatus,
      labelWarning: 'CORRECTED_OFFLINE_FIXED_POLICY_PROJECTION_NOT_AUTHORIZED_EXECUTION_EVIDENCE',
      marketFees: e.fees,
      nativeBuyFees: sample.currentBuy?.quote.fees,
      nativeSellFees: sample.currentSell?.quote.fees,
      modeledBuy: buy,
      modeledSell: sell,
      externalBuy: sample.buyQuote.quote.outAmount,
      externalSell: sample.sellQuote.quote.outAmount,
      buyDiscrepancy: discrepancy(buy.output, sample.buyQuote.quote.outAmount),
      sellDiscrepancy: discrepancy(sell.output, sample.sellQuote.quote.outAmount),
      frozenPriorComparison,
    });
  }
writeFileSync(
  'artifacts/simple-price-v1-acceptance/comparison-summary.json',
  JSON.stringify(
    {
      disclaimer:
        'Original raw market records remain unchanged. Fee predicate corrected in the new review runner only; candidate implementation is unchanged.',
      results,
    },
    (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
);
for (const result of results)
  console.log(
    JSON.stringify(result, (k, v: unknown) =>
      k === 'modeledBuy' || k === 'modeledSell'
        ? undefined
        : typeof v === 'bigint'
          ? v.toString()
          : v,
    ),
  );
