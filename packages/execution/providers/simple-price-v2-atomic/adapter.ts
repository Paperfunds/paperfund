/** Disposable-only bridge; reuses the preserved directional execution and financial contracts. */
import { ExecutionEngineError } from '@paperfund/execution';
import type {
  MarketIdentity,
  MarketState,
  BuySimulationRequest,
  SellSimulationRequest,
  PositionExitValuationRequest,
} from '@paperfund/execution';
import type { DatabaseService } from '../../../db/src/database.js';
import {
  IsolatedV2Adapter,
  pack,
  unpack,
} from '../../integration/simple-price-v2-directional/adapter.js';
import { IsolatedHighWater } from '../../candidates/simple-price-v2-directional/high-water.js';
import { CandidateError, fingerprint } from '../../candidates/simple-price-v2-directional/model.js';
import type { Evidence, Policy } from '../../candidates/simple-price-v2-directional/model.js';
import { normalizeNative } from '../simple-price-v2/provider.js';
import type { Capture } from '../simple-price-v2/provider.js';
import { AtomicMarketProvider, ATOMIC_POLICY } from './provider.js';
import type { AtomicCapture, Receipt } from './provider.js';
import { normalizeDirectional } from './normalize.js';
type BoundCapture = { kind: 'NON_SOL'; value: AtomicCapture } | { kind: 'SOL'; value: Capture };
function fail(reason: string): never {
  throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', reason);
}
/** Verify a full single-response account set for each source; never assemble partial bank reads. */
export function assertAtomicReceipts(c: AtomicCapture): void {
  for (const o of c.observations) {
    const s = o.sourceState,
      expected = [...Object.keys(s.accounts), ...s.absentAccounts];
    if (
      [
        s.targetPool,
        s.bridgePool,
        s.mint,
        s.quoteMint,
        'SysvarC1ock11111111111111111111111111111111',
      ].some((k) => !s.accounts[k])
    )
      fail('COMPLETE_ATOMIC_RECEIPT_REQUIRED');
    const valid = c.receipts.some((r) => {
      if (
        r.upstream !== o.native.upstream ||
        r.status !== 200 ||
        r.request.method !== 'getMultipleAccounts'
      )
        return false;
      const keys = r.request.params[0] as string[],
        result = r.body.result as
          | {
              context?: { slot: number };
              value?: ({ owner: string; data: [string, string] } | null)[];
            }
          | undefined;
      if (
        !Array.isArray(keys) ||
        !Array.isArray(result?.value) ||
        result.context?.slot !== s.slot ||
        result.value.length !== keys.length ||
        expected.some((k) => !keys.includes(k))
      )
        return false;
      return expected.every((k) => {
        const raw = result.value![keys.indexOf(k)],
          stored = s.accounts[k];
        return stored
          ? !!raw && raw.owner === stored.owner && raw.data[0] === stored.base64
          : raw === null;
      });
    });
    if (!valid) fail('COMPLETE_ATOMIC_RECEIPT_REQUIRED');
    if (
      !c.genesis.some(
        (r: Receipt) =>
          r.upstream === o.native.upstream &&
          r.status === 200 &&
          r.request.method === 'getGenesisHash' &&
          r.body.result === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
      )
    )
      fail('MAINNET_PROVENANCE_REQUIRED');
  }
}
export async function assertRealState(state: MarketState): Promise<void> {
  const n = state.normalizedState;
  if (
    n['priceProvenance'] !== 'REAL_READ_ONLY_ATOMIC_CANDIDATE' ||
    n['fixtureLabel'] !== 'DISPOSABLE_ACCOUNT_REAL_READ_ONLY_EVIDENCE' ||
    fingerprint(unpack<Policy>(n['policy'])) !== fingerprint(ATOMIC_POLICY)
  )
    fail('REAL_PRICE_PROVENANCE_REQUIRED');
  const e = unpack<Evidence>(n['candidate']),
    bound = unpack<BoundCapture>(n['atomicCapture']);
  if (e.identity.mint !== state.identity.tokenMint || e.identity.market !== state.identity.marketId)
    fail('REAL_PROVIDER_IDENTITY_REQUIRED');
  if (bound.kind === 'NON_SOL') {
    assertAtomicReceipts(bound.value);
    const rebuilt = await normalizeDirectional(
      bound.value.observations,
      ATOMIC_POLICY,
      bound.value.receivedAtMs,
      bound.value.referenceBudgets,
    );
    if (fingerprint(rebuilt.evidence) !== fingerprint(e)) fail('REAL_CAPTURE_BINDING_MISMATCH');
  } else if (bound.kind === 'SOL') {
    if (fingerprint(normalizeNative(bound.value.states, e.calibration.quotes)) !== fingerprint(e))
      fail('REAL_CAPTURE_BINDING_MISMATCH');
  } else fail('REAL_CAPTURE_KIND_REQUIRED');
}
export class AtomicIsolatedAdapter extends IsolatedV2Adapter {
  readonly provider: AtomicMarketProvider;
  private readonly last: { capture?: BoundCapture };
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    db: DatabaseService,
    token: string,
    directory: string,
    kind: (mint: string) => 'SOL' | 'NON_SOL',
  ) {
    const provider = new AtomicMarketProvider(),
      last: { capture?: BoundCapture } = {};
    super(
      db,
      token,
      ATOMIC_POLICY,
      async (identity) => {
        try {
          const bound: BoundCapture =
            kind(identity.tokenMint) === 'SOL'
              ? { kind: 'SOL', value: await provider.captureSol(identity.tokenMint) }
              : { kind: 'NON_SOL', value: await provider.captureNonSol(identity.tokenMint) };
          if (bound.value.evidence.identity.market !== identity.marketId)
            fail('REAL_PROVIDER_IDENTITY_REQUIRED');
          if (bound.kind === 'NON_SOL') assertAtomicReceipts(bound.value);
          last.capture = bound;
          return bound.value.evidence;
        } catch (error) {
          if (error instanceof CandidateError) throw error;
          fail('ATOMIC_MARKET_UNAVAILABLE');
        }
      },
      new IsolatedHighWater(directory, ATOMIC_POLICY),
      () => new Date(),
    );
    this.provider = provider;
    this.last = last;
  }
  override loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    const task = this.serial
      .catch(() => undefined)
      .then(async () => {
        const state = await super.loadMarketState(identity),
          bound = this.last.capture;
        if (!bound) fail('REAL_CAPTURE_REQUIRED');
        return {
          ...state,
          normalizedState: {
            ...state.normalizedState,
            fixtureLabel: 'DISPOSABLE_ACCOUNT_REAL_READ_ONLY_EVIDENCE',
            priceProvenance: 'REAL_READ_ONLY_ATOMIC_CANDIDATE',
            tokenDecimals: String(bound.value.tokenDecimals),
            atomicCapture: pack(bound),
          },
        };
      });
    this.serial = task;
    return task;
  }
  override async simulateBuy(r: BuySimulationRequest, s: MarketState) {
    await assertRealState(s);
    return super.simulateBuy(r, s);
  }
  override async simulateSell(r: SellSimulationRequest, s: MarketState) {
    await assertRealState(s);
    return super.simulateSell(r, s);
  }
  override async valuePositionForExit(r: PositionExitValuationRequest, s: MarketState) {
    await assertRealState(s);
    return super.valuePositionForExit(r, s);
  }
}
