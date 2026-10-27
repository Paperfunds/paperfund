import { identifier, tokenBaseUnits, utcInstant } from '@paperfund/core';
import {
  createMarketStateEvidence,
  ExecutionEngineError,
  type MarketStateEvidence,
  type ProtocolAdapter,
  type JsonObject,
} from './index.js';
export interface CutoffLiquidationStep {
  quantity: string;
  basisBefore: string;
  output: string;
  fees: string;
  writeoff: boolean;
  evidence: MarketStateEvidence;
}
const liquidity = new Set(['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY']);
/** Pure, bounded liquidation of a pinned bank. Never fetches another bank to refill capacity. */
export async function planCutoffLiquidation(
  adapter: ProtocolAdapter,
  initial: MarketStateEvidence,
  quantity: bigint,
  basis: bigint,
  cutoff: Date,
) {
  if (
    quantity <= 0n ||
    basis < 0n ||
    createMarketStateEvidence(initial).fingerprint !== initial.fingerprint ||
    adapter.adapterVersion !== initial.adapterVersion
  )
    throw Error('CUTOFF_PLAN_INPUT');
  const steps: CutoffLiquidationStep[] = [];
  let remaining = quantity,
    cost = basis,
    evidence = structuredClone(initial);
  while (remaining > 0n) {
    if (steps.length >= 64) throw Error('CUTOFF_PARTIAL_STEP_BOUND');
    let sold = remaining;
    try {
      const v = await adapter.valuePositionForExit(
        { identity: evidence.identity, tokenQuantity: tokenBaseUnits(remaining) },
        evidence,
      );
      if (v.paperSolValue <= 0n)
        throw new ExecutionEngineError('ZERO_EXECUTABLE_OUTPUT', 'No positive output.');
    } catch (e) {
      if (
        !(e instanceof Error) ||
        !('code' in e) ||
        !liquidity.has(String(e.code)) ||
        !adapter.maxExecutableSellQuantity
      )
        throw e;
      sold = await adapter.maxExecutableSellQuantity(
        { identity: evidence.identity, tokenQuantity: tokenBaseUnits(remaining) },
        evidence,
      );
    }
    if (sold < 0n || sold > remaining) throw Error('CUTOFF_CAPACITY_INVALID');
    if (sold === 0n) {
      steps.push({
        quantity: remaining.toString(),
        basisBefore: cost.toString(),
        output: '0',
        fees: '0',
        writeoff: true,
        evidence,
      });
      break;
    }
    const execution = await adapter.simulateSell(
      {
        identity: evidence.identity,
        requestedTokenQuantity: tokenBaseUnits(sold),
        orderId: identifier('cutoff-plan', 'OrderId'),
        executionId: identifier('cutoff-plan', 'ExecutionId'),
        executedAt: utcInstant(cutoff),
      },
      evidence,
    );
    if (
      execution.actualInput.amount !== sold ||
      execution.actualInput.asset !== 'TOKEN' ||
      execution.actualOutput.asset !== 'PAPER_SOL' ||
      execution.actualOutput.amount <= 0n ||
      execution.quote.marketStateFingerprint !== evidence.fingerprint
    )
      throw Error('CUTOFF_EXECUTION_INVALID');
    const fees = execution.quote.fees.reduce(
      (n, f) => n + (f.amount.asset === 'PAPER_SOL' ? f.amount.amount : 0n),
      0n,
    );
    steps.push({
      quantity: sold.toString(),
      basisBefore: cost.toString(),
      output: execution.actualOutput.amount.toString(),
      fees: fees.toString(),
      writeoff: false,
      evidence,
    });
    cost -= sold === remaining ? cost : (cost * sold) / remaining;
    remaining -= sold;
    if (remaining === 0n) break;
    // Only these existing native adapters expose a validated complete reserve successor.
    // Other partial routes retain REVIEW; a fresh bank is never a substitute.
    const rawPost = execution.executionDetails?.['postTrade'];
    if (!rawPost || Array.isArray(rawPost) || typeof rawPost !== 'object')
      throw Error('CUTOFF_PARTIAL_SUCCESSOR_UNAVAILABLE');
    const post = rawPost as JsonObject;
    const fields =
      adapter.adapterVersion === 'pump-bonding-curve-v1'
        ? ['virtualTokenReserves', 'virtualSolReserves', 'realTokenReserves', 'realSolReserves']
        : adapter.adapterVersion === 'pump-swap-canonical-v1'
          ? ['baseReserves', 'rawQuoteReserves', 'effectiveQuoteReserves']
          : [];
    if (
      !fields.length ||
      fields.some((k) => typeof post[k] !== 'string' || !/^\d+$/.test(post[k] as string))
    )
      throw Error('CUTOFF_PARTIAL_SUCCESSOR_UNAVAILABLE');
    evidence = createMarketStateEvidence({
      ...evidence,
      normalizedState: {
        ...evidence.normalizedState,
        ...Object.fromEntries(fields.map((k) => [k, post[k]!])),
        cutoffSuccessorOf: evidence.fingerprint,
      },
      rawSource: {
        source: 'DETERMINISTIC_CUTOFF_SUCCESSOR',
        previousFingerprint: evidence.fingerprint,
      },
    });
  }
  return steps;
}
