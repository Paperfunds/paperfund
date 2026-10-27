import { readFileSync } from 'node:fs';
import { quoteRecordedRoute } from '../packages/protocols/src/solana-routes.js';
import { executionRouteRecord, type MarketState } from '@paperfund/execution';
import { cpAmmCoder } from '@meteora-ag/cp-amm-sdk';

const rows = JSON.parse(
  readFileSync('packages/protocols/test/fixtures/operator-extreme-route.json', 'utf8'),
);
const results: unknown[] = [];
for (const row of rows) {
  const state = {
    identity: { protocolId: row.protocol_id, marketId: row.market_id, tokenMint: row.mint_address },
    adapterVersion: row.adapter_version,
    normalizationVersion: row.normalization_version,
    normalizedState: row.normalized_state,
    observedAt: row.observed_at,
    chainSlot: BigInt(row.chain_slot),
    chainBlockId: row.chain_block_id,
  } as MarketState;
  const buy = quoteRecordedRoute(
    state,
    BigInt(rows.find((r: { side: string }) => r.side === 'BUY').actual_input_lamports),
    true,
  );
  const reverse = quoteRecordedRoute(state, buy.output, false);
  const damm = row.normalized_state.hops[0];
  const decoded = cpAmmCoder.accounts.decode(
    'Pool',
    Buffer.from(row.normalized_state.accounts[damm.pool].base64, 'base64'),
  );
  results.push({
    side: row.side,
    slot: state.chainSlot,
    policy: row.normalized_state.routePolicy,
    decimals: row.decimals,
    sqrtPrice: (decoded.sqrtPrice ?? decoded.sqrt_price).toString(10),
    liquidity: decoded.liquidity.toString(10),
    buy,
    reverse,
    buyRoute: executionRouteRecord(state, true, buy.details),
    sellRoute: executionRouteRecord(state, false, reverse.details),
  });
}
console.log(
  JSON.stringify(results, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
);
