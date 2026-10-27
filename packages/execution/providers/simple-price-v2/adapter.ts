import type {
  MarketIdentity,
  MarketState,
  BuySimulationRequest,
  SellSimulationRequest,
  PositionExitValuationRequest,
} from '@paperfund/execution';
import type { DatabaseService } from '../../../db/src/database.js';
import { IsolatedV2Adapter, unpack } from '../../integration/simple-price-v2/adapter.js';
import { IsolatedHighWater } from '../../candidates/simple-price-v2/high-water.js';
import { REAL_POLICY, RealMarketProvider, normalizeNative } from './provider.js';
import { fingerprint } from '../../candidates/simple-price-v2/model.js';
import type { Evidence, Policy } from '../../candidates/simple-price-v2/model.js';
import type { Capture } from './provider.js';
export function assertRealState(state: MarketState): void {
  const n = state.normalizedState;
  if (
    n['priceProvenance'] !== 'REAL_READ_ONLY_MAINNET' ||
    n['fixtureLabel'] !== 'DISPOSABLE_ACCOUNT_REAL_READ_ONLY_EVIDENCE' ||
    fingerprint(unpack<Policy>(n['policy'])) !== fingerprint(REAL_POLICY)
  )
    throw new Error('REAL_PRICE_PROVENANCE_REQUIRED');
  const e = unpack<Evidence>(n['candidate']);
  if (state.identity.tokenMint !== e.identity.mint || state.identity.marketId !== e.identity.market)
    throw new Error('REAL_PROVIDER_IDENTITY_REQUIRED');
  const states = unpack<MarketState[]>(JSON.parse(String(n['nativeSnapshotReceipts'])));
  if (fingerprint(normalizeNative(states, e.calibration.quotes)) !== fingerprint(e))
    throw new Error('REAL_CAPTURE_BINDING_MISMATCH');
  const receipts = JSON.parse(String(n['realSourceReceipts'])) as {
    endpoint?: string;
    request?: { method?: string };
    body?: { result?: unknown };
  }[];
  if (
    !Array.isArray(receipts) ||
    !e.observations.every((o) =>
      receipts.some(
        (r) =>
          r.endpoint === o.upstream &&
          r.request?.method === 'getMultipleAccounts' &&
          r.body?.result,
      ),
    )
  )
    throw new Error('REAL_RECEIPTS_REQUIRED');
}
/** Uses the existing disposable accounting guard; its legacy protocol ID is not an evidence provenance label. */
export class RealIsolatedAdapter extends IsolatedV2Adapter {
  private serial: Promise<unknown> = Promise.resolve();
  private readonly last: { capture?: Capture };
  readonly provider: RealMarketProvider;
  constructor(db: DatabaseService, token: string, directory: string) {
    const provider = new RealMarketProvider();
    const last: { capture?: Capture } = {};
    super(
      db,
      token,
      REAL_POLICY,
      async (identity) => {
        const capture = await provider.capture(identity.tokenMint);
        if (
          capture.provenance !== 'REAL_READ_ONLY_MAINNET' ||
          capture.evidence.identity.market !== identity.marketId
        )
          throw new Error('REAL_PROVIDER_IDENTITY_REQUIRED');
        last.capture = capture;
        return capture.evidence;
      },
      new IsolatedHighWater(directory, REAL_POLICY),
      () => new Date(),
    );
    this.last = last;
    this.provider = provider;
  }
  override loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    const next = this.serial
      .catch(() => undefined)
      .then(async () => {
        const state = await super.loadMarketState(identity),
          capture = this.last.capture;
        if (!capture) throw new Error('REAL_PROVENANCE_REQUIRED');
        return {
          ...state,
          normalizedState: {
            ...state.normalizedState,
            // fixtureOnly is retained solely as the original adapter's disposable account guard.
            fixtureLabel: 'DISPOSABLE_ACCOUNT_REAL_READ_ONLY_EVIDENCE',
            priceProvenance: capture.provenance,
            tokenDecimals: capture.tokenDecimals,
            receivedAtMs: capture.receivedAtMs,
            realSourceReceipts: JSON.stringify(capture.receipts),
            nativeSnapshotReceipts: JSON.stringify(capture.states, (_, v: unknown) =>
              typeof v === 'bigint' ? { $bigint: v.toString() } : v,
            ),
          },
        };
      });
    this.serial = next;
    return next;
  }
  override async simulateBuy(request: BuySimulationRequest, state: MarketState) {
    assertRealState(state);
    return super.simulateBuy(request, state);
  }
  override async simulateSell(request: SellSimulationRequest, state: MarketState) {
    assertRealState(state);
    return super.simulateSell(request, state);
  }
  override async valuePositionForExit(request: PositionExitValuationRequest, state: MarketState) {
    assertRealState(state);
    return super.valuePositionForExit(request, state);
  }
}
