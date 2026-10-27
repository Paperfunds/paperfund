import { canonicalExitPreflight } from '@paperfund/execution';

/** API DTOs expose snapshot identifiers; full captured accounts remain internal evidence. */
export async function exitPreflight(...args: Parameters<typeof canonicalExitPreflight>) {
  const { evidence, ...result } = await canonicalExitPreflight(...args);
  void evidence;
  return result;
}
