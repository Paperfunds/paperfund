import {
  identifier,
  paperSolBaseUnits,
  tokenBaseUnits,
  type AssetAmount,
  type ExecutionFee,
  type PaperSolBaseUnits,
  type ProtocolId,
  type TokenBaseUnits,
} from '@paperfund/core';
import {
  createMarketStateEvidence,
  ExecutionEngineError,
  type BuySimulationRequest,
  type ExecutablePositionValue,
  type ExecutionFeeBreakdown,
  type JsonObject,
  type MarketIdentity,
  type MarketState,
  type PositionExitValuationRequest,
  type ProtocolAdapter,
  type SellSimulationRequest,
  type SimulatedExecution,
} from '@paperfund/execution';

export * from './pump-fun.js';

export const REFERENCE_PROTOCOL_ID: ProtocolId = identifier('REFERENCE_TEST_ONLY', 'ProtocolId');
export const REFERENCE_ADAPTER_VERSION = 'reference-constant-price-v1';

export interface ReferenceMarketFixture {
  readonly identity: MarketIdentity;
  readonly observedAt: string;
  readonly chainSlot?: bigint | null;
  readonly chainBlockId?: string | null;
  readonly quoteLamportsPerTokenBaseUnit: bigint;
  readonly buyFeeBps: bigint;
  readonly sellFeeBps: bigint;
  readonly markValueLamportsPerTokenBaseUnit?: bigint;
}

interface ReferenceNormalizedState extends JsonObject {
  readonly model: 'CONSTANT_PRICE';
  readonly quoteLamportsPerTokenBaseUnit: string;
  readonly buyFeeBps: string;
  readonly sellFeeBps: string;
  readonly markValueLamportsPerTokenBaseUnit: string;
}

function asReferenceState(state: MarketState): ReferenceNormalizedState {
  const normalized = state.normalizedState;
  if (
    state.adapterVersion !== REFERENCE_ADAPTER_VERSION ||
    normalized['model'] !== 'CONSTANT_PRICE' ||
    typeof normalized['quoteLamportsPerTokenBaseUnit'] !== 'string' ||
    typeof normalized['buyFeeBps'] !== 'string' ||
    typeof normalized['sellFeeBps'] !== 'string' ||
    typeof normalized['markValueLamportsPerTokenBaseUnit'] !== 'string'
  ) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Reference market state is invalid.');
  }
  return normalized as ReferenceNormalizedState;
}

function assertIdentity(expected: MarketIdentity, actual: MarketIdentity): void {
  if (
    expected.protocolId !== actual.protocolId ||
    expected.marketId !== actual.marketId ||
    expected.tokenMint !== actual.tokenMint
  ) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Market-state identity mismatch.');
  }
}

function calculateFee(amount: bigint, basisPoints: bigint): bigint {
  return (amount * basisPoints) / 10_000n;
}

function feeDetails(amount: bigint): ExecutionFeeBreakdown {
  const amountValue = paperSolBaseUnits(amount);
  const fees: readonly ExecutionFee[] =
    amount === 0n
      ? []
      : [
          {
            category: 'REFERENCE_PROTOCOL_FEE',
            amount: { asset: 'PAPER_SOL', amount: amountValue },
          },
        ];
  return { fees, totalPaperSolFees: amountValue };
}

function cloneState(state: MarketState): MarketState {
  return {
    ...state,
    identity: { ...state.identity },
    normalizedState: { ...state.normalizedState },
    ...(state.rawSource ? { rawSource: { ...state.rawSource } } : {}),
  };
}

/** REFERENCE / TEST ONLY. NOT A PRODUCTION PROTOCOL OR PRICING SOURCE. */
export class ReferenceProtocolAdapter implements ProtocolAdapter {
  readonly protocolId: ProtocolId = REFERENCE_PROTOCOL_ID;
  readonly adapterVersion = REFERENCE_ADAPTER_VERSION;
  readonly #states = new Map<string, MarketState>();

  constructor(fixtures: readonly ReferenceMarketFixture[]) {
    for (const fixture of fixtures) {
      if (fixture.identity.protocolId !== this.protocolId) {
        throw new ExecutionEngineError(
          'INVALID_MARKET_STATE',
          'Reference fixtures must use the explicit reference protocol ID.',
        );
      }
      if (
        fixture.quoteLamportsPerTokenBaseUnit <= 0n ||
        fixture.buyFeeBps < 0n ||
        fixture.buyFeeBps > 10_000n ||
        fixture.sellFeeBps < 0n ||
        fixture.sellFeeBps > 10_000n
      ) {
        throw new ExecutionEngineError(
          'INVALID_MARKET_STATE',
          'Reference fixture math is invalid.',
        );
      }
      this.#states.set(fixture.identity.marketId, {
        identity: fixture.identity,
        observedAt: fixture.observedAt as MarketState['observedAt'],
        chainSlot: fixture.chainSlot ?? null,
        chainBlockId: fixture.chainBlockId ?? null,
        adapterVersion: this.adapterVersion,
        normalizationVersion: 'reference-state-v1',
        normalizedState: {
          model: 'CONSTANT_PRICE',
          quoteLamportsPerTokenBaseUnit: fixture.quoteLamportsPerTokenBaseUnit.toString(),
          buyFeeBps: fixture.buyFeeBps.toString(),
          sellFeeBps: fixture.sellFeeBps.toString(),
          markValueLamportsPerTokenBaseUnit: (
            fixture.markValueLamportsPerTokenBaseUnit ?? fixture.quoteLamportsPerTokenBaseUnit
          ).toString(),
        },
      });
    }
  }

  async loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    if (identity.protocolId !== this.protocolId) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'Reference protocol identity mismatch.',
      );
    }
    const state = this.#states.get(identity.marketId);
    if (!state) {
      throw new ExecutionEngineError(
        'MARKET_STATE_UNAVAILABLE',
        `No reference fixture exists for market ${identity.marketId}.`,
      );
    }
    assertIdentity(identity, state.identity);
    return cloneState(state);
  }

  async simulateBuy(
    request: BuySimulationRequest,
    marketState: MarketState,
  ): Promise<SimulatedExecution> {
    assertIdentity(request.identity, marketState.identity);
    const state = asReferenceState(marketState);
    const input = request.requestedPaperSol;
    const feeAmount = calculateFee(input, BigInt(state.buyFeeBps));
    const output = tokenBaseUnits(
      (input - feeAmount) / BigInt(state.quoteLamportsPerTokenBaseUnit),
    );
    return this.execution(
      request,
      marketState,
      { asset: 'PAPER_SOL', amount: input },
      { asset: 'TOKEN', tokenMint: request.identity.tokenMint, amount: output },
      feeDetails(feeAmount).fees,
    );
  }

  async simulateSell(
    request: SellSimulationRequest,
    marketState: MarketState,
  ): Promise<SimulatedExecution> {
    assertIdentity(request.identity, marketState.identity);
    const state = asReferenceState(marketState);
    const gross = request.requestedTokenQuantity * BigInt(state.quoteLamportsPerTokenBaseUnit);
    const feeAmount = calculateFee(gross, BigInt(state.sellFeeBps));
    return this.execution(
      request,
      marketState,
      {
        asset: 'TOKEN',
        tokenMint: request.identity.tokenMint,
        amount: request.requestedTokenQuantity,
      },
      { asset: 'PAPER_SOL', amount: paperSolBaseUnits(gross - feeAmount) },
      feeDetails(feeAmount).fees,
    );
  }

  async valuePositionForExit(
    request: PositionExitValuationRequest,
    marketState: MarketState,
  ): Promise<ExecutablePositionValue> {
    assertIdentity(request.identity, marketState.identity);
    const state = asReferenceState(marketState);
    const gross = request.tokenQuantity * BigInt(state.quoteLamportsPerTokenBaseUnit);
    const feeAmount = calculateFee(gross, BigInt(state.sellFeeBps));
    const evidence = createMarketStateEvidence(marketState);
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits(gross - feeAmount),
      feeBreakdown: feeDetails(feeAmount),
      marketStateFingerprint: evidence.fingerprint,
      adapterVersion: this.adapterVersion,
    };
  }

  private execution(
    request: BuySimulationRequest | SellSimulationRequest,
    marketState: MarketState,
    input: AssetAmount,
    output: AssetAmount,
    fees: readonly ExecutionFee[],
  ): SimulatedExecution {
    const evidence = createMarketStateEvidence(marketState);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: marketState.observedAt,
        marketStateFingerprint: evidence.fingerprint,
        normalizationVersion: marketState.normalizationVersion,
        requestedInput: input,
        simulatedOutput: output,
        fees,
      },
      actualInput: input,
      actualOutput: output,
      executedAt: request.executedAt,
    };
  }
}

export function paperSolFeeTotal(fees: readonly ExecutionFee[]): PaperSolBaseUnits {
  return paperSolBaseUnits(
    fees.reduce(
      (total, item) => (item.amount.asset === 'PAPER_SOL' ? total + item.amount.amount : total),
      0n,
    ),
  );
}

export function tokenAmount(value: bigint): TokenBaseUnits {
  return tokenBaseUnits(value);
}
export * from './pump-swap.js';
