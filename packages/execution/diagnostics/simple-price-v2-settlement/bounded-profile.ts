import { normalizeDirectional } from '../../providers/simple-price-v2-atomic/normalize.js';
import type { NonSolObservation } from '../../providers/simple-price-v2/non-sol.js';
import type { Policy } from '../../candidates/simple-price-v2-directional/model.js';
import { validateEvidence, calibrate } from '../../candidates/simple-price-v2-directional/model.js';
/** Explicit private prefix profile, not an automatic fallback after a fee rejection.
 * Native fee extrema must be constant on every quoted path and across both operators.
 * All existing validation/residual/bounds apply. This is never installed in the live provider.
 */
export async function verifiedSmallProfile(
  observations: readonly NonSolObservation[],
  policy: Policy,
  nowMs: number,
) {
  const referenceBudgets = [100000000n, 10000000n] as const;
  const normalized = await normalizeDirectional(observations, policy, nowMs, referenceBudgets);
  const price = validateEvidence(normalized.evidence, normalized.evidence.identity, nowMs, policy);
  const curve = calibrate(normalized.evidence, price, nowMs, policy);
  return {
    profile: 'PRIVATE_EXPLICIT_0_01_TO_0_1_SOL_NOT_ACTIVATED',
    referenceBudgets,
    normalized,
    curve,
  };
}
