/** Isolated adapter, preserving original quote/fill/valuation contracts and native asset fees. */
import {
  identifier,
  paperSolBaseUnits,
  tokenBaseUnits,
  type ExecutionFee,
  type AssetAmount,
  type ProtocolId,
  type TokenBaseUnits,
} from '@paperfund/core';
import {
  createMarketStateEvidence,
  executionRouteRecord,
  ExecutionEngineError,
  type ProtocolAdapter,
  type MarketIdentity,
  type MarketState,
  type JsonObject,
  type BuySimulationRequest,
  type SellSimulationRequest,
  type PositionExitValuationRequest,
  type SimulatedExecution,
  type ExecutablePositionValue,
} from '@paperfund/execution';
import { PUMP_AMM_PROGRAM_ID } from '../../src/pump-swap.js';
import type { LinkedEngine } from './engine.js';
import type { Stage1Snapshot } from '../../src/experimental/non-sol-pump-swap.js';
import { WRAPPED_SOL_MINT } from '../../src/pump-fun.js';
import { pumpSwapStateFromSnapshot as originalState } from '../../src/non-sol-pump-swap.js';
const reject = (reason: string): never => {
  throw new ExecutionEngineError('POSITION_EXECUTION_ROUTE_UNAVAILABLE', reason);
};
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))) as JsonObject;
export async function linkedState(
  identity: MarketIdentity,
  s: Stage1Snapshot,
  engine: LinkedEngine,
  version: string,
  normalization: string,
) {
  const state = await originalState(identity, s, engine, version, normalization);
  const hops = state.normalizedState['hops'] as JsonObject[];
  return {
    ...state,
    normalizedState: {
      ...state.normalizedState,
      hops: (s.targetPool === s.bridgePool ? hops.slice(0, 1) : hops).map((h, i) =>
        i === 1 ? { ...h, programId: s.accounts[s.bridgePool]!.owner } : h,
      ),
    },
  };
}
export interface PumpSwapAdapterPolicy {
  protocolId: ProtocolId;
  adapterVersion: string;
  normalizationVersion: string;
  identity(mint: string, quote: string, bridge: string): MarketIdentity;
  assertBinding(snapshot: Stage1Snapshot): void;
  buysEnabled: boolean;
}
export class LinkedPoolAdapter implements ProtocolAdapter {
  readonly protocolId: ProtocolId;
  readonly adapterVersion: string;
  constructor(
    readonly source: {
      loadMarketState(identity: MarketIdentity): Promise<MarketState>;
      engine: Pick<LinkedEngine, 'quote' | 'exits'>;
    },
    private readonly policy: PumpSwapAdapterPolicy,
  ) {
    this.protocolId = policy.protocolId;
    this.adapterVersion = policy.adapterVersion;
  }
  loadMarketState(identity: MarketIdentity) {
    return this.source.loadMarketState(identity);
  }
  private async quote(identity: MarketIdentity, state: MarketState, input: bigint, buy: boolean) {
    const s = state.normalizedState['stage1Snapshot'] as unknown as Stage1Snapshot;
    if (
      !s ||
      !Number.isSafeInteger(s.slot) ||
      s.slot < 0 ||
      !s.accounts ||
      state.adapterVersion !== this.adapterVersion ||
      state.normalizationVersion !== this.policy.normalizationVersion ||
      state.normalizedState['model'] !== 'NON_SOL_PUMP_SWAP_ROUTE' ||
      state.chainSlot !== BigInt(s.slot) ||
      state.observedAt !== s.observedAt ||
      identity.protocolId !== this.protocolId ||
      identity.marketId !== this.policy.identity(s.mint, s.quoteMint, s.bridgePool).marketId ||
      identity.tokenMint !== s.mint ||
      state.identity.protocolId !== identity.protocolId ||
      state.identity.marketId !== identity.marketId ||
      state.identity.tokenMint !== identity.tokenMint
    )
      reject('NON_SOL_STATE_IDENTITY');
    this.policy.assertBinding(s);
    if (
      buy &&
      !this.policy.buysEnabled &&
      state.normalizedState['genericBuyAdmissionAllowed'] !== true
    )
      reject('GENERIC_BUY_DISABLED_EXIT_ONLY');
    const q = await this.source.engine.quote(s, input, buy, {
      nowMs: Date.parse(s.observedAt),
      maxAgeMs: 10000,
    });
    if (state.normalizedState['tokenDecimals'] !== q.baseDecimals.toString())
      reject('NON_SOL_STATE_DECIMALS');
    return q;
  }
  private fees(q: Awaited<ReturnType<LinkedEngine['quote']>>): ExecutionFee[] {
    const asset = (mint: string, n: bigint): AssetAmount =>
      mint === WRAPPED_SOL_MINT
        ? { asset: 'PAPER_SOL', amount: paperSolBaseUnits(n) }
        : { asset: 'TOKEN', tokenMint: identifier(mint, 'TokenMint'), amount: tokenBaseUnits(n) };
    return [
      ...(q.bridge.detail['bridgeKind'] === 'PUMP_SWAP'
        ? (['lp', 'protocol', 'creator'] as const).map((k) => ({
            category:
              k === 'creator' && q.bridge.detail['bridgeCreatorFeeDestination'] === 'HOLDER_REWARD'
                ? 'PUMP_SWAP_HOLDER_REWARD_FEE'
                : 'PUMP_SWAP_' + k.toUpperCase() + '_FEE',
            amount: asset(q.bridge.feeMint, q.bridge[k]),
          }))
        : [{ category: 'AMM_TRADE_FEE', amount: asset(q.bridge.feeMint, q.bridge.lp) }]),
      ...(['lp', 'protocol', 'creator'] as const).map((k) => ({
        category:
          k === 'creator' && q.creatorFeeDestination === 'HOLDER_REWARD'
            ? 'PUMP_SWAP_HOLDER_REWARD_FEE'
            : 'PUMP_SWAP_' + k.toUpperCase() + '_FEE',
        amount: asset(q.quoteMint, q.target.fees[k]),
      })),
    ].filter((f) => f.amount.amount > 0n);
  }
  private hops(q: Awaited<ReturnType<LinkedEngine['quote']>>, state: MarketState) {
    const s = state.normalizedState['stage1Snapshot'] as unknown as Stage1Snapshot;
    const target = {
      pool: s.targetPool,
      programId: PUMP_AMM_PROGRAM_ID,
      inputMint: q.buy ? s.quoteMint : s.mint,
      outputMint: q.buy ? s.mint : s.quoteMint,
      input: q.target.input.toString(),
      output: q.target.output.toString(),
      fees: json(q.target.fees),
      postTrade: json(q.target.post),
    };
    if (s.targetPool === s.bridgePool) return [target];
    const bridge = {
      pool: s.bridgePool,
      programId: s.accounts[s.bridgePool]!.owner,
      inputMint: q.buy ? WRAPPED_SOL_MINT : s.quoteMint,
      outputMint: q.buy ? s.quoteMint : WRAPPED_SOL_MINT,
      input: (q.buy ? q.input : q.target.output).toString(),
      output: q.bridge.output.toString(),
      ...q.bridge.detail,
    };
    return q.buy ? [bridge, target] : [target, bridge];
  }
  private async execute(
    request: BuySimulationRequest | SellSimulationRequest,
    state: MarketState,
    buy: boolean,
  ): Promise<SimulatedExecution> {
    const input = buy
      ? (request as BuySimulationRequest).requestedPaperSol
      : (request as SellSimulationRequest).requestedTokenQuantity;
    const q = await this.quote(request.identity, state, input, buy),
      fees = this.fees(q);
    const from: AssetAmount = buy
      ? { asset: 'PAPER_SOL', amount: paperSolBaseUnits(q.input) }
      : { asset: 'TOKEN', tokenMint: request.identity.tokenMint, amount: tokenBaseUnits(q.input) };
    const to: AssetAmount = buy
      ? { asset: 'TOKEN', tokenMint: request.identity.tokenMint, amount: tokenBaseUnits(q.output) }
      : { asset: 'PAPER_SOL', amount: paperSolBaseUnits(q.output) };
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput: from,
        simulatedOutput: to,
        fees,
      },
      actualInput: from,
      actualOutput: to,
      executedAt: request.executedAt,
      executionDetails: { hops: this.hops(q, state) },
    };
  }
  simulateBuy(r: BuySimulationRequest, s: MarketState) {
    return this.execute(r, s, true);
  }
  simulateSell(r: SellSimulationRequest, s: MarketState) {
    return this.execute(r, s, false);
  }
  async valuePositionForExit(
    r: PositionExitValuationRequest,
    s: MarketState,
  ): Promise<ExecutablePositionValue> {
    const q = await this.quote(r.identity, s, r.tokenQuantity, false),
      fees = this.fees(q);
    return {
      identity: r.identity,
      tokenQuantity: r.tokenQuantity,
      paperSolValue: paperSolBaseUnits(q.output),
      adapterVersion: this.adapterVersion,
      marketStateFingerprint: createMarketStateEvidence(s).fingerprint,
      route: executionRouteRecord(s, false, this.hops(q, s)),
      feeBreakdown: {
        fees,
        totalPaperSolFees: paperSolBaseUnits(
          fees.reduce((n, f) => n + (f.amount.asset === 'PAPER_SOL' ? f.amount.amount : 0n), 0n),
        ),
      },
    };
  }
  async maxExecutableSellQuantity(
    r: PositionExitValuationRequest,
    s: MarketState,
  ): Promise<TokenBaseUnits> {
    // Verify canonical identity first even when the full quote is liquidity limited.
    try {
      await this.quote(r.identity, s, r.tokenQuantity, false);
    } catch (e) {
      if (
        !(e instanceof ExecutionEngineError) ||
        !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(e.code)
      )
        throw e;
    }
    const snapshot = s.normalizedState['stage1Snapshot'] as unknown as Stage1Snapshot;
    const exit = await this.source.engine.exits(snapshot, r.tokenQuantity, {
      nowMs: Date.parse(snapshot.observedAt),
      maxAgeMs: 10000,
    });
    return tokenBaseUnits(exit.maxQuantity);
  }
}
