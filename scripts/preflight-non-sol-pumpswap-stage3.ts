/** Read-only activation preflight. Writes public evidence/config artifacts, never runtime flags or trades. */
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { parseEnvironment, APPROVED_NON_SOL_PUMPSWAP_ROUTES } from '@paperfund/config';
import { createDatabase } from '@paperfund/db';
import { createProductionExecutionRouter } from '../packages/protocols/src/production.js';
import { canonicalExitPreflight } from '@paperfund/execution';
import { identifier, paperSolBaseUnits, utcInstant } from '@paperfund/core';
config({ quiet: true });
const e = parseEnvironment(process.env);
const db = createDatabase(e.DATABASE_URL),
  routes = APPROVED_NON_SOL_PUMPSWAP_ROUTES;
const result: {
  at: string;
  environment: unknown;
  positions: unknown;
  targets: unknown[];
  pass: boolean;
} = {
  at: new Date().toISOString(),
  environment: {
    mode: e.NODE_ENV,
    capabilityEnabled: e.NON_SOL_PUMPSWAP_ENABLED,
    commitment: e.SOLANA_COMMITMENT,
    providerHost: new URL(e.SOLANA_RPC_URL).hostname,
    payoutsEnabled: e.PAYOUT_EXECUTION_ENABLED,
  },
  positions: null,
  targets: [],
  pass: true,
};
try {
  result.positions = (
    await db.pool.query(
      'select a.mint_address,count(*)::text open_positions from positions p join assets a on a.id=p.asset_id where p.status=$2 and a.mint_address=any($1::text[]) group by a.mint_address',
      [routes.map((r) => r.mint), 'OPEN'],
    )
  ).rows;
} finally {
  await db.close();
}
const router = createProductionExecutionRouter({
  rpcUrl: e.SOLANA_RPC_URL,
  rpcTimeoutMs: e.SOLANA_RPC_TIMEOUT_MS,
  commitment: e.SOLANA_COMMITMENT,
  nonSolPumpSwapEnabled: true,
  nonSolPumpSwapRoutes: routes,
});
for (const binding of routes) {
  const start = performance.now();
  try {
    const origin = await router.mintResolver!(binding.mint),
      { route, adapter, state } = await router.loadPositionRoute(origin);
    const buy = await adapter.simulateBuy(
      {
        identity: route.executionIdentity,
        orderId: identifier('readonly-stage3', 'OrderId'),
        executionId: identifier('readonly-stage3', 'ExecutionId'),
        executedAt: utcInstant(new Date()),
        requestedPaperSol: paperSolBaseUnits(100000000n),
      },
      state,
    );
    const exit = await canonicalExitPreflight(router, origin, buy.actualOutput.amount, 100000000n);
    const observed = state.normalizedState['stage1Snapshot'];
    result.targets.push({
      binding,
      status: 'PASS',
      buy: buy.actualOutput.amount.toString(),
      exit: {
        status: exit.status,
        full: exit.full.outputLamports?.toString(),
        max: exit.maxExecutableQuantityBaseUnits.toString(),
        percentages: Object.fromEntries(
          Object.entries(exit.percentages).map(([k, v]) => [
            k,
            { executable: v.executable, output: v.outputLamports?.toString(), reason: v.reason },
          ]),
        ),
      },
      snapshot: observed,
      slot: state.chainSlot?.toString(),
      elapsedMs: Math.round(performance.now() - start),
    });
    if (!exit.full.executable || Object.values(exit.percentages).some((x) => !x.executable))
      result.pass = false;
  } catch (error) {
    result.pass = false;
    result.targets.push({
      binding,
      status: 'BLOCKED',
      reason: error instanceof Error ? error.message : 'UNKNOWN',
      elapsedMs: Math.round(performance.now() - start),
    });
  }
}
mkdirSync('docs/evidence', { recursive: true });
writeFileSync(
  'docs/evidence/non-sol-pumpswap-stage3-preflight.json',
  JSON.stringify(result, null, 2),
);
writeFileSync(
  'docs/evidence/non-sol-pumpswap-stage3-allowlist.json',
  JSON.stringify(routes, null, 2),
);
console.log(
  JSON.stringify(
    {
      ...result,
      targets: result.targets.map((x) => {
        const y = { ...(x as Record<string, unknown>) };
        delete y['snapshot'];
        return y;
      }),
    },
    null,
    2,
  ),
);
if (!result.pass) process.exitCode = 1;
