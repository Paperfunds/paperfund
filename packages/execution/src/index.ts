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

export interface ExecutionRoute {
  readonly originIdentity: MarketIdentity;
  readonly executionIdentity: MarketIdentity;
  readonly migrated: boolean;
}

/** Resolves an economic position's current authoritative execution venue. */
export interface ExecutionRouteResolver {
  readonly originProtocolId: ProtocolId;
  resolveExecutionRoute(identity: MarketIdentity): Promise<ExecutionRoute>;
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
      | 'MIGRATION_DESTINATION_UNAVAILABLE'
      | 'UNSUPPORTED_MIGRATED_PROTOCOL'
      | 'POSITION_EXECUTION_ROUTE_UNAVAILABLE'
      | 'RPC_TIMEOUT'
      | 'RPC_ERROR'
      | 'INVALID_EXECUTION_RESULT'
      | 'PROTOCOL_DISABLED'
      | 'ADAPTER_VERSION_UNAVAILABLE'
      | 'EVIDENCE_CORRUPTED',
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
  readonly #enabled = new Map<ProtocolId, boolean>();
  readonly #routeResolvers = new Map<ProtocolId, ExecutionRouteResolver>();

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
    this.#enabled.set(adapter.protocolId, true);
  }

  registerRouteResolver(resolver: ExecutionRouteResolver): void {
    if (this.#routeResolvers.has(resolver.originProtocolId)) {
      throw new ExecutionEngineError(
        'DUPLICATE_PROTOCOL',
        `Protocol ${resolver.originProtocolId} already has an execution-route resolver.`,
      );
    }
    this.#routeResolvers.set(resolver.originProtocolId, resolver);
  }

  /** Resolve the current venue without changing the position's economic identity. */
  async resolvePositionRoute(
    identity: MarketIdentity,
    forSettlement = false,
  ): Promise<{ readonly route: ExecutionRoute; readonly adapter: ProtocolAdapter }> {
    const resolver = this.#routeResolvers.get(identity.protocolId);
    let route: ExecutionRoute;
    try {
      route = resolver
        ? await resolver.resolveExecutionRoute(identity)
        : { originIdentity: identity, executionIdentity: identity, migrated: false };
    } catch (error) {
      if (error instanceof ExecutionEngineError) throw error;
      throw new ExecutionEngineError(
        'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
        'The current execution venue for this position could not be resolved.',
      );
    }
    if (
      route.originIdentity.protocolId !== identity.protocolId ||
      route.originIdentity.marketId !== identity.marketId ||
      route.originIdentity.tokenMint !== identity.tokenMint ||
      route.executionIdentity.tokenMint !== identity.tokenMint
    ) {
      throw new ExecutionEngineError(
        'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
        'The resolved execution route does not preserve the position token identity.',
      );
    }
    const adapter = forSettlement
      ? this.resolveForSettlement(route.executionIdentity.protocolId)
      : this.resolve(route.executionIdentity.protocolId);
    return { route, adapter };
  }

  resolve(protocolId: ProtocolId): ProtocolAdapter {
    const adapter = this.#adapters.get(protocolId);
    if (!adapter) {
      throw new ExecutionEngineError(
        'UNSUPPORTED_PROTOCOL',
        `No execution adapter is registered for protocol ${protocolId}.`,
      );
    }
    if (this.#enabled.get(protocolId) === false) {
      throw new ExecutionEngineError(
        'PROTOCOL_DISABLED',
        `Protocol ${protocolId} is disabled for new user trading.`,
      );
    }
    return adapter;
  }

  /** Operational switch for new user exposure. Forced liquidation remains available. */
  setEnabled(protocolId: ProtocolId, enabled: boolean): void {
    if (!this.#adapters.has(protocolId)) {
      throw new ExecutionEngineError(
        'UNSUPPORTED_PROTOCOL',
        `No execution adapter is registered for protocol ${protocolId}.`,
      );
    }
    this.#enabled.set(protocolId, enabled);
  }

  isEnabled(protocolId: ProtocolId): boolean {
    return this.#enabled.get(protocolId) === true;
  }

  /** Risk-reducing settlement may use installed code even when new trading is disabled. */
  resolveForSettlement(protocolId: ProtocolId): ProtocolAdapter {
    const adapter = this.#adapters.get(protocolId);
    if (!adapter) {
      throw new ExecutionEngineError(
        'UNSUPPORTED_PROTOCOL',
        `No execution adapter is registered for protocol ${protocolId}.`,
      );
    }
    return adapter;
  }

  resolveVersion(protocolId: ProtocolId, adapterVersion: string): ProtocolAdapter {
    const adapter = this.#adapters.get(protocolId);
    if (!adapter || adapter.adapterVersion !== adapterVersion) {
      throw new ExecutionEngineError(
        'ADAPTER_VERSION_UNAVAILABLE',
        `Adapter ${protocolId}@${adapterVersion} is unavailable.`,
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
    const { route, adapter } = await router.resolvePositionRoute(position.identity);
    const state = await adapter.loadMarketState(route.executionIdentity);
    const evidence = createMarketStateEvidence(state);
    if (
      evidence.identity.protocolId !== route.executionIdentity.protocolId ||
      evidence.identity.marketId !== route.executionIdentity.marketId ||
      evidence.identity.tokenMint !== position.identity.tokenMint ||
      evidence.adapterVersion !== adapter.adapterVersion
    ) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'Loaded market state does not match the requested position identity or adapter.',
      );
    }
    const value = await adapter.valuePositionForExit(
      { identity: route.executionIdentity, tokenQuantity: position.tokenQuantity },
      state,
    );
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
