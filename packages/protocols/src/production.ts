import {
  DENY_GENERIC,
  genericOperation,
  recordGenericPermission,
  withGenericOperation,
  type GenericPermission,
} from './generic-access-context.js';
import {
  GenericPumpSwapSource,
  GenericPumpSwapAdapter,
  GENERIC_PUMP_SWAP_PROTOCOL_ID,
} from './generic-pump-swap.js';
import { validateNonSolPumpSwapRoutes, type NonSolPumpSwapRouteBinding } from '@paperfund/config';
import {
  NonSolPumpSwapAdapter,
  NonSolPumpSwapSource,
  NON_SOL_PUMP_SWAP_PROTOCOL_ID,
} from './non-sol-pump-swap.js';
import { canonicalPumpSwapPoolAddress } from './pump-swap.js';
import { advisoryReadContext } from './rpc-read-context.js';
import { ExecutionRouter, ExecutionEngineError, type JsonObject } from '@paperfund/execution';

import {
  PumpFunProtocolAdapter,
  PumpFunSolanaMarketStateSource,
  SolanaRpcClient,
  type PumpFunLogSink,
} from './pump-fun.js';
import { PumpSwapProtocolAdapter, PumpSwapSolanaMarketStateSource } from './pump-swap.js';
import {
  SolanaRouteAdapter,
  SolanaRouteSource,
  installSolanaMintResolver,
} from './solana-routes.js';

export interface ProductionExecutionOptions {
  /** Server-only capability; absent/false retains the original non-SOL guard. */
  readonly nonSolPumpSwapEnabled?: boolean;
  readonly genericPumpSwapEnabled?: boolean;
  /** Exit-only mode when omitted/false. No client-controlled switch. */
  readonly genericPumpSwapBuysEnabled?: boolean;
  /** Authenticated request/system-exit authorization; absent provider denies generic discovery. */
  readonly genericAccessResolver?: (
    mint: string,
    quote: string,
    forSettlement: boolean,
  ) => Promise<GenericPermission>;
  readonly nonSolPumpSwapRoutes?: readonly NonSolPumpSwapRouteBinding[];
  readonly rpcUrl: string;
  readonly rpcTimeoutMs: number;
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly log?: (event: string, metadata: JsonObject) => void;
}

export function createProductionExecutionRouter(
  options: ProductionExecutionOptions,
): ExecutionRouter {
  const rpc = new SolanaRpcClient({
    url: options.rpcUrl,
    timeoutMs: options.rpcTimeoutMs,
    commitment: options.commitment,
    ...(options.log ? { log: options.log } : {}),
  });
  const log: PumpFunLogSink = options.log ?? (() => undefined);
  const routes = new SolanaRouteSource(rpc, undefined, log);
  const allowed =
    options.nonSolPumpSwapEnabled === true
      ? validateNonSolPumpSwapRoutes(options.nonSolPumpSwapRoutes)
      : (options.nonSolPumpSwapRoutes ?? []);
  const nonSol = new NonSolPumpSwapSource(rpc, allowed);
  const generic = new GenericPumpSwapSource(rpc);
  const router = new ExecutionRouter([
    new PumpFunProtocolAdapter(new PumpFunSolanaMarketStateSource(rpc, log), log),
    new PumpSwapProtocolAdapter(new PumpSwapSolanaMarketStateSource(rpc, log), log),
    new SolanaRouteAdapter(routes),
    new NonSolPumpSwapAdapter(nonSol),
    new GenericPumpSwapAdapter(
      generic,
      () =>
        options.genericPumpSwapBuysEnabled === true && genericOperation()?.permission.buy === true,
      () => genericOperation()?.permission,
    ),
  ]);
  if (options.log) router.diagnostic = options.log;
  router.setEnabled(NON_SOL_PUMP_SWAP_PROTOCOL_ID, options.nonSolPumpSwapEnabled === true);
  router.setEnabled(GENERIC_PUMP_SWAP_PROTOCOL_ID, options.genericPumpSwapEnabled === true);
  installSolanaMintResolver(
    router,
    routes,
    options.nonSolPumpSwapEnabled === true || options.genericPumpSwapEnabled === true
      ? {
          resolveNonSolPumpSwap: async (mint, quote) => {
            if (
              options.nonSolPumpSwapEnabled === true &&
              allowed.some((r) => r.mint === mint && r.quoteMint === quote)
            )
              return nonSol.resolve(mint, quote);
            if (options.genericPumpSwapEnabled !== true) return nonSol.resolve(mint, quote);
            const permission =
              (await options.genericAccessResolver?.(
                mint,
                quote,
                genericOperation()?.settlement === true,
              )) ?? DENY_GENERIC;
            recordGenericPermission(permission);
            if (permission.exitBinding) {
              if (
                permission.exitBinding.quoteMint !== quote ||
                permission.exitBinding.targetPool !==
                  (await canonicalPumpSwapPoolAddress(mint, quote))
              )
                throw new ExecutionEngineError(
                  'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
                  'GENERIC_EXIT_QUOTE_CHANGED',
                );
              return generic.resolvePinned(mint, quote, permission.exitBinding.bridgePool);
            }
            if (!permission.discover)
              throw new ExecutionEngineError(
                'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
                'GENERIC_OPERATOR_ENTITLEMENT_REQUIRED',
              );
            return generic.resolve(mint, quote);
          },
        }
      : undefined,
  );
  const load = router.loadPositionRoute.bind(router),
    mintResolver = router.mintResolver!;
  router.loadPositionRoute = (identity, settlement = false) =>
    withGenericOperation(settlement, () => load(identity, settlement));
  router.mintResolver = (mint) => withGenericOperation(false, () => mintResolver(mint));
  const resolve = router.canonicalResolver!;
  router.canonicalResolver = async (identity) => {
    const context = advisoryReadContext(),
      start = performance.now();
    try {
      return await resolve(identity);
    } finally {
      if (context)
        context.metrics.routeDiscoveryMs =
          (context.metrics.routeDiscoveryMs ?? 0) + performance.now() - start;
    }
  };
  return router;
}
