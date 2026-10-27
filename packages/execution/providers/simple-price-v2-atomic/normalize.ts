/** Preserved directional normalizer with explicit provider policy; no pricing formula changes. */
import type { NonSolObservation } from '../simple-price-v2/non-sol.js';
import { Stage1NonSolPumpSwap } from '../../../protocols/src/experimental/non-sol-pump-swap.js';
import { orcaDirectionalReference } from '../../../protocols/isolated/simple-price-v2/orca-directional.js';
import { WRAPPED_SOL_MINT } from '@paperfund/protocols';
import {
  CandidateError,
  fingerprint,
  snapshotHash,
  discrepancy,
  observationProgression,
} from '../../candidates/simple-price-v2-directional/model.js';
import type {
  Evidence,
  ReferenceQuote,
  Policy,
  Rational,
} from '../../candidates/simple-price-v2-directional/model.js';
import { costHash } from '../../candidates/simple-price-v2-directional/costs.js';
import type { DirectionalSchedule } from '../../candidates/simple-price-v2-directional/costs.js';
const product = (a: Rational, b: Rational): Rational => ({ n: a.n * b.n, d: a.d * b.d });
export function verifyPair(
  observations: readonly NonSolObservation[],
  mint: string,
  policy: Policy,
  now = Date.now(),
  previous?: readonly NonSolObservation[],
) {
  if (observations.length !== 2) throw new CandidateError('PRICE_QUORUM_UNAVAILABLE');
  const a = observations[0]!,
    b = observations[1]!;
  for (const o of observations) {
    if (
      o.native.identity.mint !== mint ||
      o.native.identity.market !== a.native.identity.market ||
      o.native.identity.quote !== a.native.identity.quote ||
      o.conversion.identity.mint !== o.native.identity.quote ||
      o.conversion.identity.quote !== WRAPPED_SOL_MINT ||
      o.conversion.identity.market !== 'conversion:' + o.native.identity.quote ||
      o.baseDecimals !== a.baseDecimals ||
      o.quoteDecimals !== a.quoteDecimals ||
      fingerprint(o.primaryFeeBps) !== fingerprint(a.primaryFeeBps) ||
      o.conversionFeePpm !== a.conversionFeePpm ||
      o.adaptiveFee !== a.adaptiveFee
    )
      throw new CandidateError('CONFLICTING_SOURCE_EVIDENCE');
    for (const x of [o.native, o.conversion]) {
      if (
        policy.trustedSources[x.source] !== x.upstream ||
        x.slot === null ||
        x.slot < 0n ||
        !x.tradeable ||
        !Number.isSafeInteger(x.observedAtMs) ||
        x.observedAtMs > now + policy.maxFutureMs ||
        now - x.observedAtMs > policy.maxAgeMs
      )
        throw new CandidateError('STALE_OR_UNTRUSTED_CONVERSION');
    }
  }
  if (a.native.upstream === b.native.upstream) throw new CandidateError('PRICE_QUORUM_UNAVAILABLE');
  const times = observations.flatMap((o) => [o.native.observedAtMs, o.conversion.observedAtMs]);
  if (Math.max(...times) - Math.min(...times) > policy.maxSkewMs)
    throw new CandidateError('INCOHERENT_SNAPSHOT');
  discrepancy(a.native.price, b.native.price, policy.maxDiscrepancyBps);
  discrepancy(a.conversion.price, b.conversion.price, policy.maxDiscrepancyBps);
  if (previous) {
    observationProgression(
      observations.map((o) => o.native),
      previous.map((o) => o.native),
    );
    observationProgression(
      observations.map((o) => o.conversion),
      previous.map((o) => o.conversion),
    );
  }
  return product(a.native.price, a.conversion.price); // Lamports/base unit already; no second decimal scaling.
}
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
export async function normalizeDirectional(
  observations: readonly NonSolObservation[],
  policy: Policy,
  nowMs = Date.now(),
  referenceBudgets: readonly bigint[] = budgets,
) {
  const spot = verifyPair(observations, observations[0]!.native.identity.mint, policy, nowMs);
  const engine = new Stage1NonSolPumpSwap({ purpose: 'READ_ONLY_STAGE1_VALIDATION' }),
    rows: { observation: NonSolObservation; refs: NativeReference[] }[] = [];
  for (const o of observations) {
    const s = o.sourceState,
      v = await engine.validate(s, { nowMs, maxAgeMs: policy.maxAgeMs });
    if (v.holderReward) throw new CandidateError('UNVERIFIED_HOLDER_REWARD_FEES');
    const refs: NativeReference[] = [];
    for (const budget of referenceBudgets) {
      const buy = await engine.quote(s, budget, true, {
        nowMs,
        maxAgeMs: policy.maxAgeMs,
      });
      const sell = await engine.quote(s, buy.output, false, {
        nowMs,
        maxAgeMs: policy.maxAgeMs,
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
    upstream: observations[0]!.native.upstream,
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
