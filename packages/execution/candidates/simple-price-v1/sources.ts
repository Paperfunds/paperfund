import { CandidateError, validateEvidence } from './model.js';
import type { Evidence, Identity, Observation, Policy } from './model.js';

export interface RegisteredPriceSource {
  readonly id: string;
  readonly upstream: string;
  /** Server-owned verified provider adapter; must validate market/token semantics and actual event time. */
  capture(
    identity: Identity,
    signal: AbortSignal,
  ): Promise<Omit<Observation, 'source' | 'upstream'>>;
}
export interface RegisteredCostSource {
  /** Must validate fee-exclusive price semantics, fees, tradeability and quote-derived quality. */
  capture(
    identity: Identity,
    signal: AbortSignal,
  ): Promise<Pick<Evidence, 'fees' | 'feeReference' | 'feeObservedAtMs' | 'quality'>>;
}

/** No default providers: client prices, Dexscreener hints and chart FX providers cannot enter this boundary. */
export async function captureVerifiedEvidence(
  identity: Identity,
  providers: readonly RegisteredPriceSource[],
  costs: RegisteredCostSource,
  policy: Policy,
  now: () => number,
  timeoutMs: number,
): Promise<Evidence> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new CandidateError('INVALID_CAPTURE_TIMEOUT');
  if (
    providers.length < 2 ||
    providers.length > 8 ||
    new Set(providers.map((p) => p.id)).size !== providers.length ||
    providers.some((p) => policy.trustedSources[p.id] !== p.upstream)
  )
    throw new CandidateError('UNTRUSTED_PROVIDER_REGISTRY');
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new CandidateError('PRICE_SOURCE_TIMEOUT'));
    }, timeoutMs);
  });
  const capture = async (i: Identity) =>
    Promise.all(
      providers.map(async (p) => ({
        ...(await p.capture(structuredClone(i), controller.signal)),
        source: p.id,
        upstream: p.upstream,
      })),
    );
  const work = async (): Promise<Evidence> => {
    const [observations, costEvidence, fx] = await Promise.all([
      capture(identity),
      costs.capture(structuredClone(identity), controller.signal),
      identity.quote === policy.solQuote
        ? Promise.resolve(null)
        : capture({
            mint: identity.quote,
            quote: policy.solQuote,
            market: `conversion:${identity.quote}`,
          }),
    ]);
    const e: Evidence = {
      identity: structuredClone(identity),
      observations,
      ...costEvidence,
      conversion: fx ? { price: fx[0]!.price, observations: fx } : null,
    };
    validateEvidence(e, identity, now(), policy);
    return structuredClone(e);
  };
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}
