import {
  identifier,
  paperSolBaseUnits,
  tokenBaseUnits,
  utcInstant,
  type ProtocolId,
} from '@paperfund/core';
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  canonicalExitPreflight,
  createMarketStateEvidence,
  ExecutionEngineError,
  ExecutionRouter,
  marketStateFingerprint,
  valuePortfolioPositions,
  type MarketIdentity,
  type MarketState,
  type ProtocolAdapter,
} from '../src/index.js';

function identity(protocol = 'fixture'): MarketIdentity {
  return {
    protocolId: identifier(protocol, 'ProtocolId'),
    marketId: identifier('market-a', 'MarketId'),
    tokenMint: identifier('mint-a', 'TokenMint'),
  };
}

function state(): MarketState {
  return {
    identity: identity(),
    observedAt: utcInstant('2027-01-01T00:00:01.000Z'),
    chainSlot: 12n,
    chainBlockId: 'block-12',
    adapterVersion: 'fixture-v1',
    normalizationVersion: 'state-v1',
    normalizedState: { z: 'last', nested: { b: '2', a: '1' }, a: 'first' },
  };
}

function adapter(protocolId: ProtocolId): ProtocolAdapter {
  return {
    protocolId,
    adapterVersion: 'fixture-v1',
    async loadMarketState() {
      return state();
    },
    async simulateBuy() {
      throw new Error('not used');
    },
    async simulateSell() {
      throw new Error('not used');
    },
    async valuePositionForExit(request, marketState) {
      return {
        identity: request.identity,
        tokenQuantity: request.tokenQuantity,
        paperSolValue: paperSolBaseUnits(request.tokenQuantity * 6n),
        feeBreakdown: { fees: [], totalPaperSolFees: paperSolBaseUnits(0n) },
        marketStateFingerprint: marketStateFingerprint(marketState),
        adapterVersion: 'fixture-v1',
      };
    },
  };
}

describe('execution engine contracts', () => {
  it('canonicalizes recursively without depending on object insertion order', () => {
    expect(canonicalJson({ b: { y: '2', x: '1' }, a: '0' })).toBe(
      canonicalJson({ a: '0', b: { x: '1', y: '2' } }),
    );
    expect(marketStateFingerprint(state())).toBe(createMarketStateEvidence(state()).fingerprint);
  });

  it('rejects duplicate and unknown protocol registrations without fallback', () => {
    const target = adapter(identity().protocolId);
    const router = new ExecutionRouter([target]);
    expect(router.resolve(target.protocolId).protocolId).toBe(target.protocolId);
    expect(() => router.register(target)).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_PROTOCOL' }),
    );
    expect(() => router.resolve(identifier('unknown', 'ProtocolId'))).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_PROTOCOL' }),
    );
  });

  it('composes exact executable exit values for every position', async () => {
    const target = adapter(identity().protocolId);
    const result = await valuePortfolioPositions(new ExecutionRouter([target]), [
      { identity: identity(), tokenQuantity: tokenBaseUnits(2n) },
      { identity: identity(), tokenQuantity: tokenBaseUnits(3n) },
    ]);
    expect(result.totalPaperSolValue).toBe(30n);
    expect(result.positions).toHaveLength(2);
  });

  it('rejects the portfolio when an adapter cannot load required state', async () => {
    const broken = adapter(identity().protocolId);
    broken.loadMarketState = async () => {
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'missing');
    };
    await expect(
      valuePortfolioPositions(new ExecutionRouter([broken]), [
        { identity: identity(), tokenQuantity: tokenBaseUnits(1n) },
      ]),
    ).rejects.toMatchObject({ code: 'MARKET_STATE_UNAVAILABLE' });
  });

  it.each([undefined, null, NaN, 0, '0'])(
    'rejects malformed exit output %s instead of zero equity',
    async (output) => {
      const target = adapter(identity().protocolId);
      const original = target.valuePositionForExit;
      target.valuePositionForExit = async (request, snapshot) => ({
        ...(await original(request, snapshot)),
        paperSolValue: output as never,
      });
      await expect(
        canonicalExitPreflight(new ExecutionRouter([target]), identity(), 10n, 100n),
      ).rejects.toMatchObject({ code: 'INVALID_EXECUTION_RESULT' });
    },
  );

  it('uses one snapshot for full, maximum and percentage exits after a liquidity failure', async () => {
    const target = adapter(identity().protocolId);
    let loads = 0;
    target.loadMarketState = async () => {
      loads++;
      return state();
    };
    const original = target.valuePositionForExit;
    target.valuePositionForExit = async (request, snapshot) => {
      if (request.tokenQuantity > 5n)
        throw new ExecutionEngineError('INSUFFICIENT_EXECUTABLE_LIQUIDITY', 'capacity');
      return original(request, snapshot);
    };
    target.maxExecutableSellQuantity = async (_, snapshot) => {
      expect(snapshot.chainSlot).toBe(12n);
      return tokenBaseUnits(5n);
    };
    const result = await canonicalExitPreflight(
      new ExecutionRouter([target]),
      identity(),
      10n,
      100n,
    );
    expect(loads).toBe(1);
    expect(result.maxExecutableOutputLamports).toBe(30n);
    expect(result.executablePortionCostBasisLamports).toBe(50n);
    expect(result.percentages['50'].outputLamports).toBe(30n);
  });

  it('records BUY and reverse valuation with route identities and reports valid extreme loss without rejecting BUY', async () => {
    const target = adapter(identity().protocolId);
    target.simulateBuy = async (request, snapshot) => {
      const output = {
        asset: 'TOKEN' as const,
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits(2n),
      };
      return {
        id: request.executionId,
        orderId: request.orderId,
        executedAt: request.executedAt,
        actualInput: { asset: 'PAPER_SOL' as const, amount: request.requestedPaperSol },
        actualOutput: output,
        quote: {
          orderId: request.orderId,
          marketId: request.identity.marketId,
          protocolId: request.identity.protocolId,
          adapterVersion: target.adapterVersion,
          marketStateRecordedAt: snapshot.observedAt,
          marketStateFingerprint: marketStateFingerprint(snapshot),
          normalizationVersion: snapshot.normalizationVersion,
          requestedInput: { asset: 'PAPER_SOL' as const, amount: request.requestedPaperSol },
          simulatedOutput: output,
          fees: [],
        },
      };
    };
    target.maxExecutableSellQuantity = async () => tokenBaseUnits(0n);
    const router = new ExecutionRouter([target]);
    const events: string[] = [];
    router.diagnostic = (event) => {
      events.push(event);
    };
    const loaded = await router.loadPositionRoute(identity());
    const result = await loaded.adapter.simulateBuy(
      {
        identity: identity(),
        requestedPaperSol: paperSolBaseUnits(100n),
        orderId: identifier('order', 'OrderId'),
        executionId: identifier('fill', 'ExecutionId'),
        executedAt: state().observedAt,
      },
      loaded.state,
    );
    expect(result.actualInput.amount).toBe(100n);
    expect(result.executionDetails?.['canonicalRoute']).toMatchObject({
      chainSlot: '12',
      input: '100',
      output: '2',
      routeHash: expect.any(String),
    });
    expect(result.executionDetails?.['immediateReverse']).toMatchObject({
      status: 'AVAILABLE',
      executableValue: '12',
      executableQuantity: '2',
    });
    expect(events).toContain('EXECUTION_VALUATION_ANOMALY');
    router.diagnostic = () => {
      throw new Error('operator sink failed');
    };
    await expect(canonicalExitPreflight(router, identity(), 2n, 100n)).resolves.toMatchObject({
      maxExecutableOutputLamports: 12n,
    });
    target.valuePositionForExit = async () => {
      throw new ExecutionEngineError(
        'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
        'finite reserves exhausted',
      );
    };
    const diagnostics: unknown[] = [];
    router.diagnostic = (_, data) => {
      diagnostics.push(data);
    };
    await expect(
      loaded.adapter.simulateBuy(
        {
          identity: identity(),
          requestedPaperSol: paperSolBaseUnits(100n),
          orderId: identifier('order', 'OrderId'),
          executionId: identifier('fill', 'ExecutionId'),
          executedAt: state().observedAt,
        },
        loaded.state,
      ),
    ).resolves.toMatchObject({ actualInput: { amount: 100n } });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        cause: 'AUTHORITATIVE_NO_EXECUTABLE_LIQUIDITY',
        executableValue: '0',
      }),
    );
    target.valuePositionForExit = async () => {
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'missing reserve snapshot');
    };
    await expect(
      loaded.adapter.simulateBuy(
        {
          identity: identity(),
          requestedPaperSol: paperSolBaseUnits(100n),
          orderId: identifier('order', 'OrderId'),
          executionId: identifier('fill', 'ExecutionId'),
          executedAt: state().observedAt,
        },
        loaded.state,
      ),
    ).rejects.toMatchObject({ code: 'MARKET_STATE_UNAVAILABLE' });
  });
});
