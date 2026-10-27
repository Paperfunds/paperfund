import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createProductionExecutionRouter } from '../packages/protocols/src/production.js';
const router = createProductionExecutionRouter({
  rpcUrl: process.env['SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com',
  rpcTimeoutMs: 15000,
  commitment: 'confirmed',
});
const mint = process.argv[2]!;
const identity = await router.mintResolver!(mint);
const { route, adapter } = await router.resolvePositionRoute(identity);
const state = await adapter.loadMarketState(route.executionIdentity);
writeFileSync(
  process.argv[3]!,
  JSON.stringify(state, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
);
console.log(
  JSON.stringify({ mint, slot: state.chainSlot?.toString(), hops: state.normalizedState['hops'] }),
);
