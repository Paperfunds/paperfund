import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { createMarketStateEvidence, type MarketIdentity } from '@paperfund/execution';
import { describe, expect, it } from 'vitest';

import {
  REFERENCE_ADAPTER_VERSION,
  REFERENCE_PROTOCOL_ID,
  ReferenceProtocolAdapter,
} from '../src/index.js';

const identity: MarketIdentity = {
  protocolId: REFERENCE_PROTOCOL_ID,
  marketId: identifier('reference-market', 'MarketId'),
  tokenMint: identifier('reference-mint', 'TokenMint'),
};

function adapter() {
  return new ReferenceProtocolAdapter([
    {
      identity,
      observedAt: '2027-01-01T00:00:01.000Z',
      quoteLamportsPerTokenBaseUnit: 19_800_000n,
      buyFeeBps: 100n,
      sellFeeBps: 100n,
      markValueLamportsPerTokenBaseUnit: 80_000_000n,
    },
  ]);
}

describe('reference protocol adapter', () => {
  it('spends total requested input once and returns deterministic net output', async () => {
    const target = adapter();
    const state = await target.loadMarketState(identity);
    const request = {
      orderId: identifier('order-1', 'OrderId'),
      executionId: identifier('execution-1', 'ExecutionId'),
      identity,
      requestedPaperSol: paperSolBaseUnits(2_000_000_000n),
      executedAt: utcInstant('2027-01-01T00:00:02.000Z'),
    };
    const first = await target.simulateBuy(request, state);
    const replay = await target.simulateBuy(request, state);
    expect(first).toEqual(replay);
    expect(first.actualInput.amount).toBe(2_000_000_000n);
    expect(first.actualOutput.amount).toBe(100n);
    expect(first.quote.fees[0]?.amount.amount).toBe(20_000_000n);
    expect(first.quote.adapterVersion).toBe(REFERENCE_ADAPTER_VERSION);
    expect(first.quote.marketStateFingerprint).toBe(createMarketStateEvidence(state).fingerprint);
  });

  it('uses executable full-exit value rather than fixture mark/display value', async () => {
    const target = adapter();
    const state = await target.loadMarketState(identity);
    const value = await target.valuePositionForExit(
      { identity, tokenQuantity: tokenBaseUnits(100n) },
      state,
    );
    expect(value.paperSolValue).toBe(1_960_200_000n);
    expect(state.normalizedState['markValueLamportsPerTokenBaseUnit']).toBe('80000000');
  });

  it('replays sell simulation exactly from the same normalized state', async () => {
    const target = adapter();
    const state = await target.loadMarketState(identity);
    const request = {
      orderId: identifier('sell-order', 'OrderId'),
      executionId: identifier('sell-execution', 'ExecutionId'),
      identity,
      requestedTokenQuantity: tokenBaseUnits(100n),
      executedAt: utcInstant('2027-01-01T00:00:03.000Z'),
    };
    expect(await target.simulateSell(request, state)).toEqual(
      await target.simulateSell(request, state),
    );
  });
});
