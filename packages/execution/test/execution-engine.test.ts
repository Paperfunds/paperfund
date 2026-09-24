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
    expect(router.resolve(target.protocolId)).toBe(target);
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
});
