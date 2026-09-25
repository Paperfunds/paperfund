import { ExecutionRouter, type JsonObject } from '@paperfund/execution';

import {
  PumpFunProtocolAdapter,
  PumpFunSolanaMarketStateSource,
  SolanaRpcClient,
  type PumpFunLogSink,
} from './pump-fun.js';
import {
  PumpMigrationResolver,
  PumpSwapProtocolAdapter,
  PumpSwapSolanaMarketStateSource,
} from './pump-swap.js';

export interface ProductionExecutionOptions {
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
  });
  const log: PumpFunLogSink = options.log ?? (() => undefined);
  const router = new ExecutionRouter([
    new PumpFunProtocolAdapter(new PumpFunSolanaMarketStateSource(rpc, log), log),
    new PumpSwapProtocolAdapter(new PumpSwapSolanaMarketStateSource(rpc, log), log),
  ]);
  router.registerRouteResolver(new PumpMigrationResolver(rpc));
  return router;
}
