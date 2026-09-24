import { createHash } from 'node:crypto';

import type {
  AssetAmount,
  ExecutionFee,
  ExecutionId,
  ExecutionQuote as CoreExecutionQuote,
  MarketId,
  OrderId,
  PaperSolBaseUnits,
  ProtocolId,
  SimulatedExecution as CoreSimulatedExecution,
  TokenBaseUnits,
  TokenMint,
  UtcInstant,
} from '@paperfund/core';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface MarketIdentity {
  readonly protocolId: ProtocolId;
  readonly marketId: MarketId;
  readonly tokenMint: TokenMint;
}

export interface MarketState {
  readonly identity: MarketIdentity;
  readonly observedAt: UtcInstant;
  readonly chainSlot: bigint | null;
  readonly chainBlockId: string | null;
  readonly adapterVersion: string;
  readonly normalizationVersion: string;
  readonly normalizedState: JsonObject;
  readonly rawSource?: JsonObject;
}

export interface MarketStateEvidence extends MarketState {
  readonly fingerprint: string;
}

/** A controlled, independently testable source of authoritative market state. */
export interface MarketStateSource {
  loadMarketState(identity: MarketIdentity): Promise<MarketState>;
}

export interface BuySimulationRequest {
  readonly orderId: OrderId;
  readonly executionId: ExecutionId;
  readonly identity: MarketIdentity;
  /** Total Paper SOL intended to leave the account, including execution fees. */
  readonly requestedPaperSol: PaperSolBaseUnits;
  readonly executedAt: UtcInstant;
}

export interface SellSimulationRequest {
  readonly orderId: OrderId;
  readonly executionId: ExecutionId;
  readonly identity: MarketIdentity;
  readonly requestedTokenQuantity: TokenBaseUnits;
  readonly executedAt: UtcInstant;
}

export interface PositionExitValuationRequest {
  readonly identity: MarketIdentity;
  readonly tokenQuantity: TokenBaseUnits;
}

export interface ExecutionFeeBreakdown {
  readonly fees: readonly ExecutionFee[];
  readonly totalPaperSolFees: PaperSolBaseUnits;
}

/** Phase 1's quote contract, refined so authoritative quotes are evidence-bound. */
export interface ExecutionQuote extends CoreExecutionQuote {
  readonly marketStateFingerprint: string;
  readonly normalizationVersion: string;
}

/** Phase 1's simulated execution contract, refined with the evidence-bound quote. */
export interface SimulatedExecution extends Omit<CoreSimulatedExecution, 'quote'> {
  readonly quote: ExecutionQuote;
  /** Deterministic protocol audit data such as fee inputs and post-trade reserves. */
  readonly executionDetails?: JsonObject;
}

export interface ExecutablePositionValue {
  readonly identity: MarketIdentity;
  readonly tokenQuantity: TokenBaseUnits;
  readonly paperSolValue: PaperSolBaseUnits;
  readonly feeBreakdown: ExecutionFeeBreakdown;
  readonly marketStateFingerprint: string;
  readonly adapterVersion: string;
}

export interface ProtocolAdapter {
  readonly protocolId: ProtocolId;
  readonly adapterVersion: string;
  loadMarketState(identity: MarketIdentity): Promise<MarketState>;
  simulateBuy(request: BuySimulationRequest, marketState: MarketState): Promise<SimulatedExecution>;
  simulateSell(
    request: SellSimulationRequest,
    marketState: MarketState,
  ): Promise<SimulatedExecution>;
  valuePositionForExit(
    request: PositionExitValuationRequest,
    marketState: MarketState,
  ): Promise<ExecutablePositionValue>;
}

export class ExecutionEngineError extends Error {
  constructor(
    readonly code:
      | 'UNSUPPORTED_PROTOCOL'
      | 'DUPLICATE_PROTOCOL'
      | 'MARKET_STATE_UNAVAILABLE'
      | 'MARKET_ACCOUNT_NOT_FOUND'
      | 'INVALID_MARKET_STATE'
      | 'MARKET_MIGRATED'
      | 'RPC_TIMEOUT'
      | 'RPC_ERROR'
      | 'INVALID_EXECUTION_RESULT',
    message: string,
  ) {
    super(message);
    this.name = 'ExecutionEngineError';
  }
}

function canonicalize(value: JsonValue | bigint): JsonValue {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/** Stable UTF-8 JSON: recursively sorted object keys, preserved array order, tagged bigint values. */
export function canonicalJson(value: JsonValue | bigint): string {
  return JSON.stringify(canonicalize(value));
}

export function marketStateFingerprint(state: MarketState): string {
  const envelope: JsonObject = {
    adapterVersion: state.adapterVersion,
    chainBlockId: state.chainBlockId,
    chainSlot: state.chainSlot === null ? null : state.chainSlot.toString(),
    identity: {
      marketId: state.identity.marketId,
      protocolId: state.identity.protocolId,
      tokenMint: state.identity.tokenMint,
    },
    normalizationVersion: state.normalizationVersion,
    normalizedState: state.normalizedState,
    observedAt: state.observedAt,
  };
  return createHash('sha256').update(canonicalJson(envelope)).digest('hex');
}

export function createMarketStateEvidence(state: MarketState): MarketStateEvidence {
  return { ...state, fingerprint: marketStateFingerprint(state) };
}

export class ExecutionRouter {
  readonly #adapters = new Map<ProtocolId, ProtocolAdapter>();

  constructor(adapters: readonly ProtocolAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: ProtocolAdapter): void {
    if (this.#adapters.has(adapter.protocolId)) {
      throw new ExecutionEngineError(
        'DUPLICATE_PROTOCOL',
        `Protocol ${adapter.protocolId} already has a registered adapter.`,
      );
    }
    this.#adapters.set(adapter.protocolId, adapter);
  }

  resolve(protocolId: ProtocolId): ProtocolAdapter {
    const adapter = this.#adapters.get(protocolId);
    if (!adapter) {
      throw new ExecutionEngineError(
        'UNSUPPORTED_PROTOCOL',
        `No execution adapter is registered for protocol ${protocolId}.`,
      );
    }
    return adapter;
  }
}

export interface PortfolioPositionForValuation {
  readonly identity: MarketIdentity;
  readonly tokenQuantity: TokenBaseUnits;
}

export interface PortfolioExecutableValuation {
  readonly totalPaperSolValue: PaperSolBaseUnits;
  readonly positions: readonly {
    readonly position: PortfolioPositionForValuation;
    readonly value: ExecutablePositionValue;
    readonly evidence: MarketStateEvidence;
  }[];
}

/** Values every position independently; any missing/failed valuation rejects the whole operation. */
export async function valuePortfolioPositions(
  router: ExecutionRouter,
  positions: readonly PortfolioPositionForValuation[],
): Promise<PortfolioExecutableValuation> {
  const valued: PortfolioExecutableValuation['positions'][number][] = [];
  let total = 0n;
  for (const position of positions) {
    const adapter = router.resolve(position.identity.protocolId);
    const state = await adapter.loadMarketState(position.identity);
    const evidence = createMarketStateEvidence(state);
    if (
      evidence.identity.protocolId !== position.identity.protocolId ||
      evidence.identity.marketId !== position.identity.marketId ||
      evidence.identity.tokenMint !== position.identity.tokenMint ||
      evidence.adapterVersion !== adapter.adapterVersion
    ) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'Loaded market state does not match the requested position identity or adapter.',
      );
    }
    const value = await adapter.valuePositionForExit(position, state);
    if (
      value.marketStateFingerprint !== evidence.fingerprint ||
      value.adapterVersion !== adapter.adapterVersion ||
      value.paperSolValue < 0n
    ) {
      throw new ExecutionEngineError(
        'INVALID_EXECUTION_RESULT',
        'Position valuation is not bound to the supplied market state.',
      );
    }
    total += value.paperSolValue;
    valued.push({ position, value, evidence });
  }
  return { totalPaperSolValue: total as PaperSolBaseUnits, positions: valued };
}

export type { AssetAmount, ExecutionFee };
