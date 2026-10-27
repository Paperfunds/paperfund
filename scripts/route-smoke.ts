import 'dotenv/config';
import { createProductionExecutionRouter } from '../packages/protocols/src/production.js';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
const router = createProductionExecutionRouter({
  rpcUrl: process.env['SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com',
  rpcTimeoutMs: 15000,
  commitment: 'confirmed',
});
for (const context of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  try {
    const mint = await router.contextResolver!(context);
    const identity = await router.mintResolver!(mint);
    const { route, adapter, state } = await router.loadPositionRoute(identity);
    if (process.argv.includes('--capture')) {
      console.log(
        'CAPTURE:' + JSON.stringify(state, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
      );
      continue;
    }
    const request = {
      identity: route.executionIdentity,
      orderId: identifier('read-only-smoke', 'OrderId'),
      executionId: identifier('read-only-smoke', 'ExecutionId'),
      executedAt: utcInstant(new Date()),
    };
    const buy = await adapter.simulateBuy(
      { ...request, requestedPaperSol: paperSolBaseUnits(BigInt(process.argv.find(a => a.startsWith('--lamports='))?.split('=')[1] ?? '1000000')) },
      state,
    );
    const sell = await adapter.simulateSell(
      { ...request, requestedTokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
      state,
    );
    console.log(
      JSON.stringify(
        {
          context,
          mint,
          protocol: adapter.protocolId,
          market: route.executionIdentity.marketId,
          slot: state.chainSlot,
          hops: state.normalizedState['hops'],
          buyOutput: buy.actualOutput.amount,
          sellOutput: sell.actualOutput.amount,
        },
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      ),
    );
  } catch (e) {
    console.log(JSON.stringify({ context, error: e instanceof Error ? e.message : String(e) }));
  }
}
