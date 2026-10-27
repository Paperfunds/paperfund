/** Isolated router-only validation; no account, SQL, trade endpoint or transaction submission. */
import { config } from 'dotenv';
import { APPROVED_NON_SOL_PUMPSWAP_ROUTES, parseEnvironment } from '@paperfund/config';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { createProductionExecutionRouter } from '../packages/protocols/src/production.js';
if (!process.argv.includes('--live-read-only'))
  throw Error('Use --live-read-only explicitly; fixed-state validation is in the Stage 2 test.');
config({ quiet: true });
const e = parseEnvironment(process.env);
if (e.NON_SOL_PUMPSWAP_ENABLED)
  throw Error('This Stage 2 probe requires the running environment gate to remain OFF');
const options = {
  rpcUrl: e.SOLANA_RPC_URL,
  rpcTimeoutMs: e.SOLANA_RPC_TIMEOUT_MS,
  commitment: e.SOLANA_COMMITMENT,
};
const off = createProductionExecutionRouter(options),
  on = createProductionExecutionRouter({
    ...options,
    nonSolPumpSwapEnabled: true,
    nonSolPumpSwapRoutes: APPROVED_NON_SOL_PUMPSWAP_ROUTES,
  });
for (const mint of [
  '5pHhLJn3nXKLXyHMpoMP8YLrt1Brt3z84NWspPkKWaep',
  '7UhL5K7t1UDPLdhoj2Sz59kyn79Qvxkvk75ukfxDTUSD',
  '9wcpJweVnKaGWhBd9xYT4ZXrjsyed53iipNiPQi6pump',
]) {
  try {
    await off.mintResolver!(mint);
    throw Error('Unexpected OFF support');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'POSITION_EXECUTION_ROUTE_UNAVAILABLE'
    )
      throw error;
    console.log(JSON.stringify({ mint, off: error.code }));
  }
  try {
    const origin = await on.mintResolver!(mint),
      { route, adapter, state } = await on.loadPositionRoute(origin);
    const req = {
      identity: route.executionIdentity,
      orderId: identifier('read-only-order', 'OrderId'),
      executionId: identifier('read-only-fill', 'ExecutionId'),
      executedAt: utcInstant(new Date()),
    };
    const buy = await adapter.simulateBuy(
        { ...req, requestedPaperSol: paperSolBaseUnits(1000000000n) },
        state,
      ),
      sell = await adapter.simulateSell(
        { ...req, requestedTokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
        state,
      );
    const snap = state.normalizedState['stage1Snapshot'];
    console.log(
      JSON.stringify({
        mint,
        isolatedOn: 'AVAILABLE',
        identity: route.executionIdentity,
        pool: (snap as Record<string, unknown>)['targetPool'],
        bridge: (snap as Record<string, unknown>)['bridgePool'],
        slot: state.chainSlot?.toString(),
        buy: buy.actualOutput.amount.toString(),
        sell: sell.actualOutput.amount.toString(),
        feeAssets: sell.quote.fees.map((f) => f.amount.asset),
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        mint,
        isolatedOn: 'BLOCKED',
        reason: error instanceof Error ? error.message : 'UNKNOWN',
      }),
    );
  }
}
