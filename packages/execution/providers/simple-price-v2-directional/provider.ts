/** New opt-in candidate. Existing SOL and non-SOL providers remain untouched. */
import { NonSolProvider, verifyNonSolQuorum, decodeNonSol } from '../simple-price-v2/non-sol.js';
import type { NonSolObservation } from '../simple-price-v2/non-sol.js';
import { REAL_POLICY, RealMarketProvider, ENDPOINTS } from '../simple-price-v2/provider.js';
import { Stage1NonSolPumpSwap } from '../../../protocols/src/experimental/non-sol-pump-swap.js';
import { orcaDirectionalReference } from '../../../protocols/isolated/simple-price-v2/orca-directional.js';
import { WRAPPED_SOL_MINT, SolanaRpcClient } from '@paperfund/protocols';
import {
  CandidateError,
  fingerprint,
  snapshotHash,
  validateEvidence,
  calibrate,
  quote,
} from '../../candidates/simple-price-v2-directional/model.js';
import type {
  Evidence,
  ReferenceQuote,
} from '../../candidates/simple-price-v2-directional/model.js';
import { costHash } from '../../candidates/simple-price-v2-directional/costs.js';
import type { DirectionalSchedule } from '../../candidates/simple-price-v2-directional/costs.js';
const budgets = [100000000n, 10000000n, 2000000000n];
type NativeQuote = Awaited<ReturnType<Stage1NonSolPumpSwap['quote']>>;
interface NativeReference {
  side: 'BUY' | 'SELL';
  input: bigint;
  output: bigint;
  target: Omit<NativeQuote['target'], 'post'>;
  bridge: NativeQuote['bridge'];
  sdk: ReturnType<typeof orcaDirectionalReference>;
}
export async function normalizeDirectional(observations: readonly NonSolObservation[]) {
  const spot = verifyNonSolQuorum(observations, observations[0]!.native.identity.mint);
  const engine = new Stage1NonSolPumpSwap({ purpose: 'READ_ONLY_STAGE1_VALIDATION' }),
    rows: { observation: NonSolObservation; refs: NativeReference[] }[] = [];
  for (const o of observations) {
    const s = o.sourceState,
      v = await engine.validate(s, { nowMs: Date.now(), maxAgeMs: REAL_POLICY.maxAgeMs });
    if (v.holderReward) throw new CandidateError('UNVERIFIED_HOLDER_REWARD_FEES');
    const refs: NativeReference[] = [];
    for (const budget of budgets) {
      const buy = await engine.quote(s, budget, true, {
        nowMs: Date.now(),
        maxAgeMs: REAL_POLICY.maxAgeMs,
      });
      const sell = await engine.quote(s, buy.output, false, {
        nowMs: Date.now(),
        maxAgeMs: REAL_POLICY.maxAgeMs,
      });
      for (const [side, native] of [
        ['BUY', buy],
        ['SELL', sell],
      ] as const) {
        const bridgeInput = side === 'BUY' ? budget : native.target.output;
        const sdk = orcaDirectionalReference(
          v.bridge,
          s.accounts,
          s.absentAccounts,
          bridgeInput,
          v.bridge.mintA === (side === 'BUY' ? WRAPPED_SOL_MINT : s.quoteMint),
          v.time,
        );
        if (sdk.output !== native.bridge.output || sdk.fee !== native.bridge.lp)
          throw new CandidateError('CONTRADICTORY_SDK_COST_EVIDENCE');
        const { post: ignored, ...target } = native.target;
        void ignored;
        refs.push({
          side,
          input: native.input,
          output: native.output,
          target,
          bridge: native.bridge,
          sdk,
        });
      }
    }
    rows.push({ observation: o, refs });
  }
  const schedule = (side: 'BUY' | 'SELL'): DirectionalSchedule => {
    const first = rows[0]!,
      p = first.observation.primaryFeeBps;
    const proofs = rows.map(({ observation: o, refs }) => {
      const qs = refs.filter((r) => r.side === side),
        min = qs.reduce((a, q) => (a < q.sdk.rateMin ? a : q.sdk.rateMin), 1000000n),
        max = qs.reduce((a, q) => (a > q.sdk.rateMax ? a : q.sdk.rateMax), 0n);
      return {
        source: o.native.source,
        upstream: o.native.upstream,
        reference: o.native.reference,
        slot: o.native.slot!,
        observedAtMs: o.native.observedAtMs,
        minInput: 1n,
        maxInput: qs.reduce((a, q) => (a > q.sdk.input ? a : q.sdk.input), 0n),
        rateMin: { n: min, d: 1000000n },
        rateMax: { n: max, d: 1000000n },
      };
    });
    return {
      primary: [
        { category: 'PRIMARY_LP', bps: p.lp },
        { category: 'PRIMARY_PROTOCOL', bps: p.protocol },
        { category: 'PRIMARY_CREATOR', bps: p.creator },
      ],
      bridgeInputRate: proofs[0]!.rateMin,
      adaptive: first.observation.adaptiveFee,
      proofs,
    };
  };
  const a = observations[0]!,
    base = {
      identity: a.native.identity,
      observations: observations.map((o) => o.native),
      conversion: {
        price: a.conversion.price,
        observations: observations.map((o) => o.conversion),
      },
      fees: [],
      feeReference: fingerprint(rows.map((r) => r.refs)),
      feeObservedAtMs: a.native.observedAtMs,
      directionalCosts: {
        convention: 'PUMPSWAP_QUOTE_CEIL_ORCA_INPUT_CEIL' as const,
        route: [a.sourceState.targetPool, a.sourceState.bridgePool] as const,
        BUY: schedule('BUY'),
        SELL: schedule('SELL'),
      },
    };
  const quotes: ReferenceQuote[] = rows[0]!.refs.map((r) => ({
    source: 'native',
    upstream: ENDPOINTS[0],
    reference: fingerprint(r),
    identity: base.identity,
    side: r.side,
    input: r.input,
    output: r.output,
    observedAtMs: a.native.observedAtMs,
    slot: a.native.slot!,
    feesHash: costHash(base),
    convention: 'EXACT_INPUT_ALL_IN_VERIFIED',
  }));
  const evidence: Evidence = {
    ...base,
    calibration: {
      snapshotHash: snapshotHash(base),
      spotConvention: 'FEE_EXCLUSIVE_SPOT',
      feeConvention: 'DIRECTIONAL_QUOTE_CEIL_INPUT_BRIDGE_V1',
      widthConvention: 'NO_FIXED_WIDTH_VERIFIED',
      quotes,
    },
  };
  return { evidence, spot, references: rows };
}
export class DirectionalMarketProvider {
  readonly sol = new RealMarketProvider();
  readonly nonSol = new NonSolProvider();
  readonly reviews = new Map<string, unknown>();
  async captureSol(mint: string) {
    return this.sol.capture(mint);
  }
  async captureNonSol(mint: string) {
    try {
      await this.nonSol.inspect(mint);
    } catch {
      /* Prior diagnostic provider deliberately rejects costs. */
    }
    const raw = this.nonSol.reviews.get(mint) as
      | {
          observations?: NonSolObservation[];
          receipts?: { request: { method: string; params?: unknown[] } }[];
        }
      | undefined;
    if (!raw?.observations || raw.observations.length !== 2)
      throw new CandidateError('NATIVE_FX_QUORUM_UNAVAILABLE');
    let normalized: Awaited<ReturnType<typeof normalizeDirectional>> | undefined;
    let preview: Record<string, unknown>;
    try {
      normalized = await normalizeDirectional(raw.observations);
      const e = normalized.evidence,
        at = Date.now(),
        price = validateEvidence(e, e.identity, at, REAL_POLICY);
      const curve = calibrate(e, price, at, REAL_POLICY),
        buy = quote('BUY', 100000000n, e, e.identity, at, REAL_POLICY),
        sell = quote('SELL', buy.output, e, e.identity, at, REAL_POLICY);
      preview = { curve, buy, sell, previewAtMs: at, atomic: false };
    } catch (error) {
      this.reviews.set(mint, { raw, normalized, error: String(error) });
      throw error;
    }
    const atomicReceipts: unknown[] = [];
    let atomicFailure: unknown;
    // One bounded attempt at the original full atomic request per operator. Never promote split diagnostics.
    const atomicResults = await Promise.allSettled(
      ENDPOINTS.map(async (endpoint, index) => {
        const rpc = new SolanaRpcClient({
          url: endpoint,
          commitment: 'confirmed',
          timeoutMs: 5000,
          fetchImplementation: async (url, init) => {
            const request = JSON.parse(String(init?.body)) as { method: string };
            if (!['getMultipleAccounts', 'getAccountInfo'].includes(request.method))
              throw new CandidateError('READ_ONLY_RPC_REQUIRED');
            const response = await fetch(url, init),
              body: unknown = await response.clone().json();
            atomicReceipts.push({
              upstream: endpoint,
              request,
              body,
              status: response.status,
              receivedAtMs: Date.now(),
            });
            return response;
          },
        });
        const state = await new Stage1NonSolPumpSwap({
          purpose: 'READ_ONLY_STAGE1_VALIDATION',
        }).capture(rpc, mint);
        return decodeNonSol(state, index as 0 | 1);
      }),
    );
    const atomic = atomicResults.every((r) => r.status === 'fulfilled');
    const observations = atomic
      ? atomicResults.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      : raw.observations;
    if (!atomic)
      atomicFailure = atomicResults.flatMap((r) =>
        r.status === 'rejected' ? [String(r.reason)] : [],
      );
    try {
      if (!atomic) throw new CandidateError('NON_ATOMIC_NATIVE_CAPTURE');
      normalized = await normalizeDirectional(observations);
      const e = normalized.evidence,
        now = Date.now(),
        p = validateEvidence(e, e.identity, now, REAL_POLICY);
      const curve = calibrate(e, p, now, REAL_POLICY),
        buy = quote('BUY', 100000000n, e, e.identity, now, REAL_POLICY),
        sell = quote('SELL', buy.output, e, e.identity, now, REAL_POLICY);
      preview = { curve, buy, sell, atomic };
      this.reviews.set(mint, { raw, normalized, ...preview, atomicReceipts, atomicFailure });
      if (!atomic) throw new CandidateError('NON_ATOMIC_NATIVE_CAPTURE');
      return { evidence: e, normalized, curve, buy, sell };
    } catch (error) {
      this.reviews.set(mint, {
        raw,
        normalized,
        ...preview,
        atomicReceipts,
        atomicFailure,
        error: String(error),
      });
      throw error;
    }
  }
}
