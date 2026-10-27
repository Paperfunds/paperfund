import { APPROVED_NON_SOL_PUMPSWAP_ROUTES } from '@paperfund/config';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { ExecutionEngineError, type MarketState } from '@paperfund/execution';
import { createProductionExecutionRouter } from '../../src/production.js';
import { recordedPumpState } from './pump-real-chain.js';
import { RECORDED_PUMP_SWAP_FIXTURES } from './pump-swap-real-chain.js';
import {
  PUMP_SWAP_PROTOCOL_ID,
  PUMP_SWAP_ADAPTER_VERSION,
  PUMP_SWAP_NORMALIZATION_VERSION,
  PUMP_AMM_PROGRAM_ID,
} from '../../src/pump-swap.js';
import { WRAPPED_SOL_MINT } from '../../src/pump-fun.js';
import { recordedRoute } from './routes.js';
import { recordedLaunchlab, operatorLaunchlab, normalLaunchlab } from './launchlab.js';
function nativeSwap(): MarketState {
  const f = RECORDED_PUMP_SWAP_FIXTURES.normal;
  return {
    identity: {
      protocolId: PUMP_SWAP_PROTOCOL_ID,
      marketId: identifier(f.pool, 'MarketId'),
      tokenMint: identifier(f.mint, 'TokenMint'),
    },
    adapterVersion: PUMP_SWAP_ADAPTER_VERSION,
    normalizationVersion: PUMP_SWAP_NORMALIZATION_VERSION,
    chainSlot: f.slot,
    chainBlockId: null,
    observedAt: utcInstant(f.capturedAt),
    normalizedState: {
      model: 'PUMP_SWAP_CANONICAL_POOL',
      programId: PUMP_AMM_PROGRAM_ID,
      poolAddress: f.pool,
      baseMint: f.mint,
      quoteMint: WRAPPED_SOL_MINT,
      baseReserves: f.baseReserves.toString(),
      rawQuoteReserves: f.rawQuoteReserves.toString(),
      virtualQuoteReserves: f.virtualQuoteReserves.toString(),
      effectiveQuoteReserves: (f.rawQuoteReserves + f.virtualQuoteReserves).toString(),
      lpFeeBps: f.feeBps.lp.toString(),
      protocolFeeBps: f.feeBps.protocol.toString(),
      creatorFeeBps: f.feeBps.creator.toString(),
      creatorFeeApplies: true,
      disableFlags: '0',
    },
  };
}
export async function workingVectors(enabled = false, genericEnabled = false) {
  const cases = {
    pump: recordedPumpState('early'),
    nativePumpSwap: nativeSwap(),
    cpmm: recordedRoute(0),
    dammV2: recordedRoute(1),
    launchlab: recordedLaunchlab(),
    stonk: operatorLaunchlab(),
    normalLaunchlab: normalLaunchlab(),
  };
  const router = createProductionExecutionRouter({
    nonSolPumpSwapEnabled: enabled,
    genericPumpSwapEnabled: genericEnabled,
    genericPumpSwapBuysEnabled: genericEnabled,
    nonSolPumpSwapRoutes: APPROVED_NON_SOL_PUMPSWAP_ROUTES,
    rpcUrl: 'https://example.invalid',
    rpcTimeoutMs: 1000,
    commitment: 'confirmed',
  });
  const results: Record<string, unknown> = {};
  const safe = async (fn: () => Promise<unknown>) => {
    try {
      return { value: await fn() };
    } catch (e) {
      return {
        rejection: e instanceof ExecutionEngineError ? e.code : 'UNKNOWN',
        message: e instanceof Error ? e.message : 'unknown',
      };
    }
  };
  for (const [name, state] of Object.entries(cases)) {
    const adapter = router.resolveVersion(state.identity.protocolId, state.adapterVersion);
    const req = {
      identity: state.identity,
      orderId: identifier('parity-order', 'OrderId'),
      executionId: identifier('parity-fill', 'ExecutionId'),
      executedAt: utcInstant('2026-10-10T00:00:00Z'),
    };
    const samples = [];
    for (const input of [1000000n, 100000000n, 1000000000n, 10000000000n]) {
      let quantity = 1n;
      const buy = await safe(async () => {
        const b = await adapter.simulateBuy(
          { ...req, requestedPaperSol: paperSolBaseUnits(input) },
          state,
        );
        quantity = b.actualOutput.amount;
        return b;
      });
      const exits = await Promise.all(
        [25n, 50n, 75n, 100n].map((percent) =>
          safe(() =>
            adapter.valuePositionForExit(
              {
                identity: state.identity,
                tokenQuantity: tokenBaseUnits((quantity * percent) / 100n),
              },
              state,
            ),
          ),
        ),
      );
      const max = await safe(async () =>
        adapter.maxExecutableSellQuantity
          ? adapter.maxExecutableSellQuantity(
              { identity: state.identity, tokenQuantity: tokenBaseUnits(quantity) },
              state,
            )
          : 'NO_CAPACITY_METHOD',
      );
      samples.push({
        input,
        buy,
        exits,
        max,
        invalid: await safe(() =>
          adapter.simulateSell({ ...req, requestedTokenQuantity: tokenBaseUnits(0n) }, state),
        ),
      });
    }
    results[name] = { identity: state.identity, samples };
  }
  return JSON.parse(
    JSON.stringify(results, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as unknown;
}
