import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { config } from 'dotenv';
import { capturePumpDependencies } from './pump-dependencies.js';
import {
  newLinkedBranch,
  reconcileLinkedInterval,
  type ProviderInterval,
} from './external-flow.js';
import { transitionLinkedSnapshot } from './native-transition.js';
config({ quiet: true });
const dir = 'docs/linked-pair-20261021/mixed-route-bounded';
mkdirSync(dir, { recursive: true });
const original = JSON.parse(
    gunzipSync(
      readFileSync('docs/linked-pair-20261021/pump-bridge/provider-459703404-459703413.json.gz'),
    ).toString(),
  ) as ProviderInterval,
  rows = JSON.parse(readFileSync('docs/linked-pair-20261021/external-flow-completion/retained-hop-dependencies.json', 'utf8')) as string[][],
  deps = rows.map((r) => ({
    base: r[0]!,
    quote: r[1]!,
    pool: r[2]!,
    baseVault: r[3]!,
    quoteVault: r[4]!,
  }));
// One collection, one 20-second window, no retries or dependency rediscovery.
const started = Date.now();
let calls = 0;
async function rpc(method: string, params: unknown[]) {
  if (Date.now() - started > 180000 || ++calls > 100) throw Error('BOUNDED_CAPTURE_RPC_LIMIT');
  const r = await fetch(process.env.SOLANA_RPC_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: calls, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const j = (await r.json()) as { error?: { code: number }; result: unknown };
  if (j.error) throw Error('RPC_' + j.error.code);
  return j.result;
}
const read = async (addresses: string[]) =>
  ({
    ...((await rpc('getMultipleAccounts', [
      addresses,
      { encoding: 'base64', commitment: 'finalized' },
    ])) as object),
    commitment: 'finalized' as const,
  }) as Awaited<ReturnType<Parameters<typeof capturePumpDependencies>[0]>>;
const mints = [original.before.mint, '7DzCqeVESZG7atpZHCfCb7VxPfnkhPE3uMW8cNLpump'].filter(
  (m, i, a) => a.indexOf(m) === i,
);
if (mints.length !== 2) mints.push('F4KqwtJXgAAVPeyJBPZiNe7Ki1RLQDXNfEcUApdrpump');
let before = await capturePumpDependencies(
  read,
  mints,
  original.before.quoteMint,
  original.before.bridgePool,
  deps,
);
writeFileSync(dir + '/before.json.gz', gzipSync(JSON.stringify(before)));
console.log(JSON.stringify({phase:'before',slot:before.snapshot.slot,accounts:before.addresses.length,calls}));
for (let attempt = 0; attempt < 1; attempt++) {
  await new Promise((r) => setTimeout(r, 20000));
  const raw = await read(before.addresses),
    after = {
      snapshot: {
        ...before.snapshot,
        slot: raw.context.slot,
        observedAt: new Date().toISOString(),
        accounts: Object.fromEntries(
          before.addresses.map((a, i) => {
            const r = raw.value[i];
            if (!r) throw Error('MISSING_DEPENDENCY');
            return [a, { owner: r.owner, base64: r.data[0] }];
          }),
        ),
      },
      addresses: before.addresses,
      raw,
    };
  writeFileSync(dir + '/after.json.gz', gzipSync(JSON.stringify(after)));
  console.log(JSON.stringify({phase:'after',slot:after.snapshot.slot,calls}));
  if (after.snapshot.slot === before.snapshot.slot) throw Error('NO_FINALIZED_ADVANCE');
  const slots = (await rpc('getBlocks', [
      before.snapshot.slot + 1,
      after.snapshot.slot,
      { commitment: 'finalized' },
    ])) as number[],
    blocks = [];
  for (const slot of slots) {
    const result = (await rpc('getBlock', [
      slot,
      {
        commitment: 'finalized',
        encoding: 'json',
        transactionDetails: 'full',
        rewards: false,
        maxSupportedTransactionVersion: 1,
      },
    ])) as ProviderInterval['blocks'][number]['result'];
    blocks.push({ slot, result });
  }
  const anchor = (await rpc('getBlock', [
    before.snapshot.slot,
    {
      commitment: 'finalized',
      transactionDetails: 'none',
      rewards: false,
      maxSupportedTransactionVersion: 1,
    },
  ])) as { blockhash: string };
  const e = {
    schema: 'LINKED_RETAINED_RPC_INTERVAL_V1',
    commitment: 'finalized',
    provider: 'configured-rpc-no-url-retained',
    acquiredAt: new Date().toISOString(),
    before: before.snapshot,
    after: after.snapshot,
    slots,
    anchor: { blockhash: anchor.blockhash },
    blocks,
    atomicCaptures: [before, after],
  } as ProviderInterval;
  const name = dir + '/provider-' + before.snapshot.slot + '-' + after.snapshot.slot + '.json.gz';
  writeFileSync(name, gzipSync(JSON.stringify(e)));
  for (const impact of [false, true]) {
    const branch = newLinkedBranch('evidence', 'round', e.before);
    if (impact)
      branch.simulated = (
        await transitionLinkedSnapshot(branch.simulated, 10000000n, true, {
          nowMs: Date.parse(e.before.observedAt),
          maxAgeMs: 10000,
        })
      ).next;
    try {
      const r = await reconcileLinkedInterval(branch, e, Date.parse(e.after.observedAt), 10000);
      console.log(
        JSON.stringify({
          name,
          impact,
          result: 'PASS',
          events: r.events,
          failed: r.failedTransactions,
          accounts: before.addresses.length,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          name,
          impact,
          result: 'BLOCKED',
          reason: (error as Error).message,
          accounts: before.addresses.length,
        }),
      );
    }
  }
  before = after;
}
console.log(JSON.stringify({ calls }));
