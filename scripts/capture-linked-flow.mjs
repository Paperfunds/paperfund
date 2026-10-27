import { gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { SolanaRpcClient } from '../packages/protocols/dist/pump-fun.js';
import { GenericPumpSwapSource } from '../packages/protocols/dist/generic-pump-swap.js';
const config = JSON.parse(
  await readFile(process.env.LOCALAPPDATA + '/PaperfundOperator/api.json', 'utf8'),
);
const seed = JSON.parse(await readFile('docs/linked-pair-20261021/market-quotes.json', 'utf8'))
  .markets[0].state.normalizedState.stage1Snapshot;
const rpc = new SolanaRpcClient({
    url: config.SOLANA_RPC_URL,
    timeoutMs: 15000,
    commitment: 'finalized',
  }),
  source = new GenericPumpSwapSource(rpc);
async function request(method, params) {
  const r = await fetch(config.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(25000),
  });
  const d = await r.json();
  if (d.error) throw Error('RPC_' + d.error.code);
  return d.result;
}
const identity = await source.resolvePinned(seed.mint, seed.quoteMint, seed.bridgePool);
const before = (await source.loadMarketState(identity)).normalizedState.stage1Snapshot;
await new Promise((r) => setTimeout(r, 1400));
const after = (await source.loadMarketState(identity)).normalizedState.stage1Snapshot;
const slots = await request('getBlocks', [
  before.slot + 1,
  after.slot,
  { commitment: 'finalized' },
]);
const blocks = [];
for (const slot of slots) {
  const result = await request('getBlock', [
    slot,
    {
      commitment: 'finalized',
      encoding: 'json',
      transactionDetails: 'full',
      rewards: false,
      maxSupportedTransactionVersion: 1,
    },
  ]);
  blocks.push({ slot, result });
}
const anchor = await request('getBlock', [
  before.slot,
  {
    commitment: 'finalized',
    transactionDetails: 'none',
    rewards: false,
    maxSupportedTransactionVersion: 1,
  },
]);
const evidence = {
  anchor: { blockhash: anchor.blockhash },
  schema: 'LINKED_RETAINED_RPC_INTERVAL_V1',
  provider: 'configured-rpc-no-url-retained',
  acquiredAt: new Date().toISOString(),
  commitment: 'finalized',
  before,
  after,
  slots,
  blocks,
};
const name =
  'docs/linked-pair-20261021/flow/provider-' + before.slot + '-' + after.slot + '.json.gz';
await writeFile(name, gzipSync(Buffer.from(JSON.stringify(evidence))));
const watched = new Set([seed.targetPool, seed.bridgePool]);
let relevant = [];
for (const b of blocks)
  for (const [index, t] of b.result.transactions.entries()) {
    const keys = [
      ...t.transaction.message.accountKeys,
      ...(t.meta?.loadedAddresses?.writable ?? []),
      ...(t.meta?.loadedAddresses?.readonly ?? []),
    ];
    if (keys.some((k) => watched.has(k)))
      relevant.push({
        slot: b.slot,
        index,
        signature: t.transaction.signatures[0],
        err: t.meta?.err,
        programs: t.transaction.message.instructions.map((i) => keys[i.programIdIndex]),
      });
  }
console.log(
  JSON.stringify({ name, before: before.slot, after: after.slot, blocks: blocks.length, relevant }),
);
