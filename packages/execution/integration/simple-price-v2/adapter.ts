import { identifier, paperSolBaseUnits, utcInstant } from '@paperfund/core';
import { ExecutionEngineError, marketStateFingerprint } from '@paperfund/execution';
import type {
  ProtocolAdapter,
  MarketState,
  MarketIdentity,
  BuySimulationRequest,
  SellSimulationRequest,
  PositionExitValuationRequest,
  JsonObject,
  SimulatedExecution,
} from '@paperfund/execution';
import { genericActor } from '@paperfund/protocols';
import type { DatabaseService } from '../../../db/src/database.js';
import {
  quote,
  MODEL_VERSION,
  CandidateError,
  fingerprint,
} from '../../candidates/simple-price-v2/model.js';
import type { Evidence, Policy } from '../../candidates/simple-price-v2/model.js';
import { asExecution } from '../../candidates/simple-price-v2/contract.js';
import type { IsolatedHighWater } from '../../candidates/simple-price-v2/high-water.js';
export const PROTOCOL = identifier('PRIVATE_SIMPLE_PRICE_V2_FIXTURE', 'ProtocolId');
export const NORMALIZATION = 'bounded-quote-price-proportional-net-v2';
export const pack = (value: unknown): JsonObject =>
  JSON.parse(
    JSON.stringify(value, (_, v: unknown) =>
      typeof v === 'bigint' ? { $bigint: v.toString() } : v,
    ),
  ) as JsonObject;
export const unpack = <T>(value: unknown): T =>
  JSON.parse(JSON.stringify(value), (_, v: unknown) =>
    v && typeof v === 'object' && Object.keys(v).length === 1 && '$bigint' in v
      ? BigInt((v as { $bigint: string }).$bigint)
      : v,
  ) as T;
export type FixtureProvider = (identity: MarketIdentity) => Promise<Evidence>;
function translated(error: unknown): never {
  if (error instanceof CandidateError)
    // Precision failures remain unavailable; never classify them as zero capacity/write-off authority.
    throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', error.code);
  throw error;
}
/** Fixture-only adapter; constructor requires the fresh disposable DB guard. Never installed live. */
export class IsolatedV2Adapter implements ProtocolAdapter {
  readonly protocolId = PROTOCOL;
  readonly adapterVersion = MODEL_VERSION;
  private queue: Promise<unknown> = Promise.resolve();
  private reversePeaks = new WeakMap<MarketState, { peak: bigint; at: number }>();
  constructor(
    private db: DatabaseService,
    private token: string,
    private policy: Policy,
    private source: FixtureProvider,
    private highWater: IsolatedHighWater,
    private now: () => Date,
  ) {}
  async loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    const guard = (
      await this.db.pool.query<{ token: string }>('select token from private_v2.isolation_guard')
    ).rows[0];
    if (guard?.token !== this.token)
      throw new Error('FIXTURE_ADAPTER_REQUIRES_DISPOSABLE_DATABASE');
    const accountId = genericActor()?.accountId;
    let quantity = 0n,
      peak = 0n;
    if (accountId) {
      const binding = (
        await this.db.pool.query<{ model_version: string; policy_hash: string }>(
          'select rm.* from competition_accounts ca join private_v2.round_models rm on rm.round_id=ca.hourly_round_id where ca.id=$1',
          [accountId],
        )
      ).rows[0];
      if (
        binding?.model_version !== MODEL_VERSION ||
        binding.policy_hash !== fingerprint(this.policy)
      )
        throw new ExecutionEngineError(
          'MARKET_STATE_UNAVAILABLE',
          'PRIVATE_MODEL_VERSION_MISMATCH',
        );
      const position = (
        await this.db.pool.query<{ quantity: string; peak: string }>(
          "select p.remaining_base_units::text quantity,pk.peak_quantity::text peak from positions p join private_v2.position_peaks pk on pk.position_id=p.id where p.competition_account_id=$1 and p.market_id=$2 and p.status='OPEN'",
          [accountId, identity.marketId],
        )
      ).rows[0];
      if (position) {
        quantity = BigInt(position.quantity);
        peak = BigInt(position.peak);
      }
    }
    let e: Evidence;
    try {
      e = structuredClone(await this.source(identity));
      const next = this.queue
        .catch(() => undefined)
        .then(() => this.highWater.accept(e, this.now().getTime()));
      this.queue = next;
      await next;
    } catch (error) {
      translated(error);
    }
    return {
      identity,
      adapterVersion: MODEL_VERSION,
      normalizationVersion: NORMALIZATION,
      observedAt: utcInstant(e!.observations[0]!.observedAtMs),
      chainSlot: e!.observations[0]!.slot,
      chainBlockId: null,
      normalizedState: {
        fixtureOnly: true,
        fixtureLabel: 'NOT_LIVE_EXECUTABLE_EVIDENCE',
        tokenDecimals: '6',
        chainTime: new Date(e!.observations[0]!.observedAtMs).toISOString(),
        accountId: accountId ?? null,
        positionQuantity: quantity.toString(),
        peakQuantity: peak.toString(),
        candidate: pack(e!),
        policy: pack(this.policy),
      },
    };
  }
  private data(state: MarketState) {
    if (state.normalizedState['fixtureOnly'] !== true || state.adapterVersion !== MODEL_VERSION)
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'FIXTURE_ONLY_STATE_REQUIRED');
    return {
      e: unpack<Evidence>(state.normalizedState['candidate']),
      p: unpack<Policy>(state.normalizedState['policy']),
      quantity: BigInt(String(state.normalizedState['positionQuantity'])),
      peak: BigInt(String(state.normalizedState['peakQuantity'])),
    };
  }
  private normalize(
    fill: ReturnType<typeof quote>,
    state: MarketState,
    request: BuySimulationRequest | SellSimulationRequest,
  ): SimulatedExecution {
    const execution = asExecution(fill, request.orderId, request.executionId, PROTOCOL);
    return {
      ...execution,
      quote: {
        ...execution.quote,
        marketStateFingerprint: marketStateFingerprint(state),
        normalizationVersion: state.normalizationVersion,
        marketStateRecordedAt: state.observedAt,
      },
      executionDetails: { ...execution.executionDetails, candidateReplayEnvelope: pack(fill) },
    };
  }
  async simulateBuy(
    request: BuySimulationRequest,
    state: MarketState,
  ): Promise<SimulatedExecution> {
    try {
      const { e, p, quantity, peak } = this.data(state),
        at = new Date(request.executedAt).getTime();
      const fill = quote('BUY', request.requestedPaperSol, e, e.identity, at, p);
      const nextQuantity = quantity + fill.output,
        nextPeak = peak > nextQuantity ? peak : nextQuantity;
      quote('SELL', nextQuantity, e, e.identity, at, p, undefined, nextPeak);
      // Request-snapshot reverse audit only; not market mutation or simulated liquidity.
      this.reversePeaks.set(state, { peak: nextPeak, at });
      return this.normalize(fill, state, request);
    } catch (error) {
      translated(error);
    }
  }
  async simulateSell(
    request: SellSimulationRequest,
    state: MarketState,
  ): Promise<SimulatedExecution> {
    try {
      const { e, p, peak } = this.data(state);
      if (peak < request.requestedTokenQuantity) throw new Error('PRIVATE_PEAK_SCOPE_REQUIRED');
      const fill = quote(
        'SELL',
        request.requestedTokenQuantity,
        e,
        e.identity,
        new Date(request.executedAt).getTime(),
        p,
        undefined,
        peak,
      );
      return this.normalize(fill, state, request);
    } catch (error) {
      translated(error);
    }
  }
  async valuePositionForExit(request: PositionExitValuationRequest, state: MarketState) {
    try {
      const { e, p, peak } = this.data(state),
        auditPeak = this.reversePeaks.get(state);
      const effective =
        auditPeak?.peak ?? (peak > request.tokenQuantity ? peak : request.tokenQuantity);
      const fill = quote(
        'SELL',
        request.tokenQuantity,
        e,
        e.identity,
        auditPeak?.at ?? this.now().getTime(),
        p,
        undefined,
        effective,
      );
      const fees = fill.fees.map((f) => ({
        category: f.category,
        amount: { asset: 'PAPER_SOL' as const, amount: paperSolBaseUnits(f.amount) },
      }));
      return {
        identity: request.identity,
        tokenQuantity: request.tokenQuantity,
        paperSolValue: paperSolBaseUnits(fill.output),
        feeBreakdown: { fees, totalPaperSolFees: paperSolBaseUnits(fill.costs.fixedFeeLamports) },
        marketStateFingerprint: marketStateFingerprint(state),
        adapterVersion: MODEL_VERSION,
      };
    } catch (error) {
      translated(error);
    }
  }
}
