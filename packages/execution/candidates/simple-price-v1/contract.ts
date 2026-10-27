import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import type { ExecutionId, OrderId, ProtocolId } from '@paperfund/core';
import type { JsonObject, SimulatedExecution } from '@paperfund/execution';
import { MODEL_VERSION, replayFill } from './model.js';
import type { Fill } from './model.js';

/** Normalized quote/fill interface compatibility only; no router registration or persistence calls. */
export function asExecution(
  fill: Fill,
  orderId: OrderId,
  executionId: ExecutionId,
  protocolId: ProtocolId,
): SimulatedExecution {
  replayFill(fill);
  const tokenMint = identifier(fill.identity.mint, 'TokenMint');
  const input =
    fill.side === 'BUY'
      ? { asset: 'PAPER_SOL' as const, amount: paperSolBaseUnits(fill.input) }
      : { asset: 'TOKEN' as const, tokenMint, amount: tokenBaseUnits(fill.input) };
  const output =
    fill.side === 'SELL'
      ? { asset: 'PAPER_SOL' as const, amount: paperSolBaseUnits(fill.output) }
      : { asset: 'TOKEN' as const, tokenMint, amount: tokenBaseUnits(fill.output) };
  const requestedInput =
    fill.side === 'BUY'
      ? { asset: 'PAPER_SOL' as const, amount: paperSolBaseUnits(fill.requestedInput) }
      : { asset: 'TOKEN' as const, tokenMint, amount: tokenBaseUnits(fill.requestedInput) };
  const fees = fill.fees.map((f) => ({
    category: f.category,
    amount: { asset: 'PAPER_SOL' as const, amount: paperSolBaseUnits(f.amount) },
  }));
  const details = JSON.parse(
    JSON.stringify(fill, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as JsonObject;
  return {
    id: executionId,
    orderId,
    actualInput: input,
    actualOutput: output,
    executedAt: utcInstant(fill.executedAtMs),
    quote: {
      orderId,
      marketId: identifier(fill.identity.market, 'MarketId'),
      protocolId,
      adapterVersion: MODEL_VERSION,
      normalizationVersion: 'verified-rational-price-v1',
      marketStateRecordedAt: utcInstant(fill.evidence.observations[0]!.observedAtMs),
      marketStateFingerprint: fill.evidenceHash,
      requestedInput,
      simulatedOutput: output,
      fees,
    },
    executionDetails: {
      candidate: details,
      simulationLabel: 'Modeled slippage; real execution is not guaranteed.',
    },
  };
}
