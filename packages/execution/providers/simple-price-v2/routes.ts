/** Existing routing infrastructure diagnostics only; no candidate admission or capability enablement. */
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import {
  createProductionExecutionRouter,
  SOLANA_ROUTE_PROTOCOL_ID,
  withAdvisoryRead,
} from '@paperfund/protocols';
import { ENDPOINTS } from './provider.js';
export async function inspectExistingRoute(mint: string) {
  const events: unknown[] = [];
  // This constructs a read-only local object. It neither imports application config nor modifies a running router.
  const router = createProductionExecutionRouter({
    rpcUrl: ENDPOINTS[1],
    rpcTimeoutMs: 5000,
    commitment: 'confirmed',
    log: (event, metadata) => events.push({ event, metadata }),
  });
  try {
    const loaded = await withAdvisoryRead(
      {
        signal: AbortSignal.timeout(15000),
        metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 },
      },
      () =>
        router.loadPositionRoute({
          protocolId: SOLANA_ROUTE_PROTOCOL_ID,
          marketId: identifier('solana-route:' + mint, 'MarketId'),
          tokenMint: identifier(mint, 'TokenMint'),
        }),
    );
    const at = Date.parse(
      String(loaded.state.normalizedState['chainTime'] ?? loaded.state.observedAt),
    );
    const request = {
      identity: loaded.route.executionIdentity,
      orderId: identifier('diagnostic', 'OrderId'),
      executionId: identifier('diagnostic', 'ExecutionId'),
      executedAt: utcInstant(at),
    };
    const buy = await loaded.adapter.simulateBuy(
      { ...request, requestedPaperSol: paperSolBaseUnits(1000000000n) },
      loaded.state,
    );
    if (buy.actualOutput.asset !== 'TOKEN') throw new Error('NATIVE_OUTPUT_UNAVAILABLE');
    const sell = await loaded.adapter.simulateSell(
      { ...request, requestedTokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
      loaded.state,
    );
    return {
      state: loaded.state,
      buy,
      sell,
      events,
      candidateAdmission: false,
      missing:
        'No verified v2 fee-exclusive spot + directional fee normalization + two-provider FX contract for this route',
    };
  } catch (error) {
    return {
      blocked:
        error instanceof Error
          ? ('code' in error ? String(error.code) + ':' : '') + error.message
          : String(error),
      events,
      candidateAdmission: false,
    };
  }
}
