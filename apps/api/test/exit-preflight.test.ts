import { expect, it, vi } from 'vitest';
import { tokenBaseUnits, identifier, utcInstant } from '@paperfund/core';
import { ExecutionRouter, type MarketState } from '@paperfund/execution';
import { PumpFunProtocolAdapter } from '@paperfund/protocols';
import { recordedPumpState } from '../../../packages/protocols/test/fixtures/pump-real-chain.js';
import { exitPreflight } from '../src/exit-preflight.js';

function fixture(realSol: string) {
  const template = recordedPumpState('developed');
  const state: MarketState = {
    ...template,
    normalizedState: { ...template.normalizedState, realSolReserves: realSol },
  };
  const adapter = new PumpFunProtocolAdapter({
    async loadMarketState() {
      return state;
    },
  });
  return { state, adapter, router: new ExecutionRouter([adapter]) };
}

it('quotes partial exits independently, proves the exact maximum, and accounts only for its cost basis', async () => {
  const { state, adapter, router } = fixture('1000000');
  const quantity = 10_000_000_000_000n;
  const result = await exitPreflight(router, state.identity, quantity, 1_004_000_000n);
  expect(result.status).toBe('LIQUIDITY_LIMITED');
  expect(result.full.executable).toBe(false);
  const max = result.maxExecutableQuantityBaseUnits;
  expect(max).toBeGreaterThan(0n);
  expect(max).toBeLessThan(quantity / 4n);
  expect(result.percentages['25'].executable).toBe(false);
  const request = { identity: state.identity, tokenQuantity: tokenBaseUnits(max) };
  await expect(adapter.valuePositionForExit(request, state)).resolves.toMatchObject({
    paperSolValue: result.maxExecutableOutputLamports,
  });
  await expect(
    adapter.valuePositionForExit({ ...request, tokenQuantity: tokenBaseUnits(max + 1n) }, state),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY' });
  const actual = await adapter.simulateSell(
    {
      identity: state.identity,
      requestedTokenQuantity: tokenBaseUnits(max),
      orderId: identifier('partial', 'OrderId'),
      executionId: identifier('partial', 'ExecutionId'),
      executedAt: utcInstant(state.observedAt),
    },
    state,
  );
  expect(actual.actualOutput.amount).toBe(result.maxExecutableOutputLamports);
  expect(result.executablePortionCostBasisLamports).toBe((1_004_000_000n * max) / quantity);
  expect(result.executablePortionPnlLamports).toBe(
    result.maxExecutableOutputLamports - result.executablePortionCostBasisLamports,
  );
  const smaller = await exitPreflight(router, state.identity, max * 2n, 100n);
  expect(smaller.full.executable).toBe(false);
  expect(smaller.percentages['25'].executable).toBe(true);
  expect(smaller.percentages['50'].executable).toBe(true);
});

it('distinguishes no positive liquidity from an infrastructure failure', async () => {
  const { state, adapter, router } = fixture('0');
  const result = await exitPreflight(router, state.identity, 10_000_000_000_000n, 1_004_000_000n);
  expect(result).toMatchObject({
    status: 'NO_EXECUTABLE_LIQUIDITY',
    maxExecutableQuantityBaseUnits: 0n,
    maxExecutableOutputLamports: 0n,
    executablePortionPnlLamports: null,
  });
  adapter.loadMarketState = async () => {
    throw new Error('RPC unavailable');
  };
  await expect(exitPreflight(router, state.identity, 100n, 100n)).rejects.toThrow(
    expect.objectContaining({ code: 'MARKET_STATE_UNAVAILABLE' }),
  );
});

it('returns zero capacity immediately when fees consume all gross output', async () => {
  const { state, adapter } = fixture('100000000000');
  const feeState = {
    ...state,
    normalizedState: { ...state.normalizedState, protocolFeeBps: '10000', creatorFeeBps: '0' },
  };
  expect(
    await adapter.maxExecutableSellQuantity(
      { identity: state.identity, tokenQuantity: tokenBaseUnits(10n ** 20n) },
      feeState,
    ),
  ).toBe(0n);
});

it.each([undefined, null, Number.NaN, 0])(
  'rejects missing or malformed adapter output %s instead of returning zero equity',
  async (bad) => {
    const { state, adapter, router } = fixture('100000000000');
    const original = adapter.valuePositionForExit.bind(adapter);
    vi.spyOn(adapter, 'valuePositionForExit').mockImplementation(
      async (...args) => ({ ...(await original(...args)), paperSolValue: bad }) as never,
    );
    await expect(exitPreflight(router, state.identity, 10000000n, 100n)).rejects.toMatchObject({
      code: 'INVALID_EXECUTION_RESULT',
    });
  },
);
