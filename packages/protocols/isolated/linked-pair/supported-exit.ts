/** Largest supported native exact-input prefix. Unsupported state is never priced as zero. */
import { ExecutionEngineError } from '@paperfund/execution';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import { transitionLinkedSnapshot } from './native-transition.js';
export async function supportedLinkedExit(snapshot: Stage1Snapshot, quantity: bigint) {
  if (quantity <= 0n) throw Error('LINKED_INVALID_SETTLEMENT_QUANTITY');
  const attempt = async (q: bigint) => {
    try {
      const step = await transitionLinkedSnapshot(snapshot, q, false, {
        nowMs: Date.parse(snapshot.observedAt),
        maxAgeMs: 10000,
      });
      return { kind: 'OK' as const, quantity: q, output: step.quote.output, step };
    } catch (error) {
      if (error instanceof ExecutionEngineError && error.code === 'ZERO_EXECUTABLE_OUTPUT')
        return { kind: 'DUST' as const };
      if (
        error instanceof ExecutionEngineError &&
        error.code === 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'
      )
        return { kind: 'BOUND' as const };
      throw error;
    }
  };
  const full = await attempt(quantity);
  if (full.kind === 'OK') return { quantity: full.quantity, output: full.output, limitation: null };
  if (full.kind === 'DUST') return { quantity: 0n, output: 0n, limitation: full.kind };
  let low = 1n,
    high = quantity - 1n,
    best = { quantity: 0n, output: 0n };
  while (low <= high) {
    const mid = (low + high) / 2n,
      result = await attempt(mid);
    if (result.kind === 'OK') {
      best = { quantity: mid, output: result.output };
      low = mid + 1n;
    } else if (result.kind === 'DUST') low = mid + 1n;
    else if (result.kind === 'BOUND') high = mid - 1n;
  }
  return { ...best, limitation: 'SUPPORTED_NATIVE_PREFIX' };
}
