/** Read-only finalized atomic evidence capture. Never sends transactions. */
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { SolanaRpcClient } from '../../src/pump-fun.js';
import { GenericPumpSwapSource } from '../../src/generic-pump-swap.js';
import { mergeLinkedSnapshots } from './shared-bridge.js';
import {
  Stage1NonSolPumpSwap,
  type Stage1Snapshot,
} from '../../src/experimental/non-sol-pump-swap.js';
const config = JSON.parse(
  await readFile(process.env.LOCALAPPDATA + '/PaperfundOperator/api.json', 'utf8'),
);
async function request(method: string, params: unknown) {
  const r = await fetch(config.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  if (d.error) throw Error('RPC_' + d.error.code);
  return d.result;
}
const quote = 'CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump',
  bridge = process.argv[2] ?? '5yhTzDJCnqyWQyqktpkxBHoKHqWPDMLhEpqm1pE78EJv',
  mints = [
    'F4KqwtJXgAAVPeyJBPZiNe7Ki1RLQDXNfEcUApdrpump',
    '7DzCqeVESZG7atpZHCfCb7VxPfnkhPE3uMW8cNLpump',
  ];
const source = new GenericPumpSwapSource(
  new SolanaRpcClient({ url: config.SOLANA_RPC_URL, timeoutMs: 20000, commitment: 'finalized' }),
);
const templates: Stage1Snapshot[] = [];
for (const mint of mints) {
  const id = await source.resolvePinned(mint, quote, bridge);
  const state = await source.loadMarketState(id);
  templates.push(state.normalizedState.stage1Snapshot as unknown as Stage1Snapshot);
}
const addresses = [
  ...new Set(templates.flatMap((s) => [...Object.keys(s.accounts), ...s.absentAccounts])),
].sort();
if (addresses.length > 100) throw Error('ACCOUNT_BATCH_BOUND');
const captures: unknown[] = [];
async function capture() {
  const response = await request('getMultipleAccounts', [
    addresses,
    { encoding: 'base64', commitment: 'finalized' },
  ]);
  const observedAt = new Date().toISOString();
  const snapshots = templates.map((t) => {
    const s = structuredClone(t);
    s.slot = response.context.slot;
    s.observedAt = observedAt;
    s.accounts = {};
    s.absentAccounts = [];
    addresses.forEach((address, i) => {
      const a = response.value[i];
      if (a) s.accounts[address] = { owner: a.owner, base64: a.data[0] };
      else s.absentAccounts.push(address);
    });
    return s;
  });
  for (const s of snapshots)
    await new Stage1NonSolPumpSwap({
      purpose: 'READ_ONLY_STAGE1_VALIDATION',
      bridgeBinding: { quoteMint: quote, pool: bridge },
    }).validate(s, { nowMs: Date.parse(observedAt), maxAgeMs: 10000 });
  captures.push({ addresses, response, observedAt });
  return mergeLinkedSnapshots(snapshots);
}
const before = await capture();
await new Promise((r) => setTimeout(r, 1400));
const after = await capture();
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
  schema: 'LINKED_RETAINED_RPC_INTERVAL_V1',
  provider: 'configured-rpc-no-url-retained',
  commitment: 'finalized',
  acquiredAt: new Date().toISOString(),
  anchor: { blockhash: anchor.blockhash },
  before,
  after,
  slots,
  blocks,
  atomicCaptures: captures,
};
const path =
  'docs/linked-pair-20261021/flow/shared-provider-' + before.slot + '-' + after.slot + '.json.gz';
await writeFile(path, gzipSync(Buffer.from(JSON.stringify(evidence))));
console.log(
  JSON.stringify({
    path,
    before: before.slot,
    after: after.slot,
    accounts: addresses.length,
    blocks: blocks.length,
    mints,
  }),
);
