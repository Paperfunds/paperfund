// Retained mainnet block bodies; provider delays/failures below are controlled.
// No database, network, order submission or authorization writes.
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { withAdvisoryRead } from '../../../../packages/protocols/src/rpc-read-context.js';
import {
  FinalizedBankArchive,
  FinalizedFlowConnector,
  type ReadOnlyRpc,
} from './finalized-connector.js';
import {
  digest,
  newLinkedBranch,
  reconcileLinkedInterval,
  serializeProviderInterval,
  retainProviderInterval,
  type ProviderInterval,
} from '../../../../packages/protocols/isolated/linked-pair/external-flow.js';
// Complete real Solana block bodies include unrelated transactions and are large.
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const evidence: ProviderInterval = JSON.parse(
  gunzipSync(
    readFileSync(
      'docs/linked-pair-20261021/external-flow-completion/provider-459758217-459758224.json.gz',
    ),
  ).toString(),
);
const directories: string[] = [];
it('canonical encoding reuse preserves historical bytes and hashes, including numeric and Unicode key ordering',()=>{
  const oldSort=(x:unknown):unknown=>typeof x==='bigint'?x.toString():Array.isArray(x)?x.map(oldSort):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,oldSort(v)])):x;
  const vectors=[evidence,Object.fromEntries([['10',1],['2',2],['01',3],['__proto__',4],['é',5],['e\u0301',6],['missing',undefined],['large',13n],['array',[undefined,NaN,Infinity]]])];
  for(const v of vectors)expect(digest(v)).toBe(createHash('sha256').update(JSON.stringify(oldSort(v))).digest('hex'));
  const packet=structuredClone(evidence),json=serializeProviderInterval(packet);
  expect(json).toBe(JSON.stringify(oldSort(evidence)));
  expect(JSON.parse(json)).toEqual(evidence);
  expect(serializeProviderInterval(packet)).toBe(json);
  for(let i=0;i<300;i++)expect(digest({['shape'+i]:i})).toBe(createHash('sha256').update(JSON.stringify(oldSort({['shape'+i]:i}))).digest('hex'));
  expect(digest(evidence)).toBe(createHash('sha256').update(JSON.stringify(oldSort(evidence))).digest('hex'));
  const large=structuredClone(evidence);large.blocks=Array.from({length:129},(_,i)=>({slot:i,result:{parentSlot:i-1,previousBlockhash:'p',blockhash:'b',blockTime:i,transactions:[]}}));
  const expected=createHash('sha256').update(JSON.stringify(oldSort(large))).digest('hex');
  expect(digest(retainProviderInterval(large))).toBe(expected);
});
it('reuses a deterministic finalized receipt rejection without reacquiring evidence, and reevaluates after restart',async()=>{
 const p=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261024/local-extension-test/provider-461289799-461289806-initialize-account3.json.gz')).toString()) as ProviderInterval;
 const t=p.blocks.flatMap(b=>b.result.transactions).find(t=>t.transaction.signatures[0]!.startsWith('34dUTJ'))!;
 t.meta.postTokenBalances=t.meta.postTokenBalances.filter(b=>b.accountIndex!==13);
 const dir=await mkdtemp(join(tmpdir(),'pf-connector-test-'));directories.push(dir);let calls=0;
 const rpc:ReadOnlyRpc={async call<T>(method,args){calls++;
   if(method==='getBlocks')return p.slots as T;
   if(method==='getBlock'){const n=Number(args[0]);return (n===p.before.slot?{blockhash:p.anchor.blockhash,previousBlockhash:'parent',parentSlot:n-1,blockTime:Date.parse(p.before.observedAt)/1000}:p.blocks.find(b=>b.slot===n)!.result) as T;}
   if(method==='getMultipleAccounts')return {context:{slot:p.token2022!.contextSlot},value:(args[0] as string[]).map(a=>{const v=a==='SysvarC1ock11111111111111111111111111111111'?p.token2022!.clock:p.token2022!.mints[a]!;return{owner:v.owner,data:[v.base64,'base64']}})} as T;
   throw Error('UNEXPECTED_RPC');
 }};
 const archive=new FinalizedBankArchive(dir,true),c=new FinalizedFlowConnector(rpc,archive,Date.now,{blockConcurrency:8});
 await expect(c.interval(p.before,p.after)).rejects.toThrow('TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE');const count=calls;
 await expect(c.interval(p.before,p.after)).rejects.toThrow('TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE');expect(calls).toBe(count);
 expect((await readdir(dir)).some(f=>f.startsWith('interval-'))).toBe(false);
 await expect(new FinalizedFlowConnector(rpc,archive).interval(p.before,p.after)).rejects.toThrow('TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE');expect(calls).toBeGreaterThan(count);
});
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    if (!dir.startsWith(join(tmpdir(), 'pf-connector-test-'))) throw Error('TEST_DIRECTORY');
    await rm(dir, { recursive: true, force: true });
  }
});
async function fixture(compressed = false, blockConcurrency = 4) {
  const dir = await mkdtemp(join(tmpdir(), 'pf-connector-test-'));
  directories.push(dir);
  let active = 0,
    maximum = 0,
    failedSlot: number | undefined;
  const calls: { method: string; slot: number }[] = [];
  const rpc: ReadOnlyRpc = {
    async call<T>(method: string, params: unknown[]) {
      const slot = Number(params[0]);
      calls.push({ method, slot });
      if (method === 'getMultipleAccounts')
        return {
          context: { slot: evidence.after.slot },
          value: (params[0] as string[]).map((address) => {
            const a = evidence.after.accounts[address] as
              { owner: string; base64: string; lamports?: string } | undefined;
            return a
              ? { owner: a.owner, lamports: Number(a.lamports ?? 0), data: [a.base64, 'base64'] }
              : null;
          }),
        } as T;
      if (method === 'getBlocks') return structuredClone(evidence.slots) as T;
      if (method !== 'getBlock') throw Error('UNEXPECTED_RPC');
      active++;
      maximum = Math.max(active, maximum);
      try {
        // Reverse completion order inside a batch, independent of chain order.
        await new Promise((resolve) => setTimeout(resolve, 2 + (slot % 4) * 3));
        if (failedSlot === slot) throw Error('CONTROLLED_PROVIDER_BLOCK_UNAVAILABLE');
        const b =
          slot === evidence.before.slot
            ? {
                blockhash: evidence.anchor.blockhash,
                previousBlockhash: 'anchor-parent',
                parentSlot: slot - 1,
                blockTime: Number(
                  Buffer.from(
                    evidence.before.accounts.SysvarC1ock11111111111111111111111111111111!.base64,
                    'base64',
                  ).readBigInt64LE(32),
                ),
                transactions: [],
              }
            : evidence.blocks.find((b) => b.slot === slot)?.result;
        if (!b) throw Error('UNKNOWN_BLOCK');
        return structuredClone(b) as T;
      } finally {
        active--;
      }
    },
  };
  const archive = new FinalizedBankArchive(dir, compressed);
  const now = () => Date.parse(evidence.after.observedAt);
  const connector = new FinalizedFlowConnector(rpc, archive, now, { blockConcurrency });
  return {
    dir,
    rpc,
    archive,
    connector,
    now,
    calls,
    maximum: () => maximum,
    fail: (slot?: number) => {
      failedSlot = slot;
    },
  };
}
it('bounded sliding acquisition preserves every block and reuses only immutable verified documents', async () => {
  const f = await fixture(true, 8);
  const packet = await f.connector.interval(evidence.before, evidence.after);
  expect(packet!.blocks).toEqual(evidence.blocks);
  expect(packet!.slots).toEqual(evidence.slots);
  expect(f.maximum()).toBeGreaterThan(4);
  expect(f.maximum()).toBeLessThanOrEqual(8);
  expect(Object.isFrozen(packet!.blocks[0]!.result.transactions)).toBe(true);
  expect(() => { packet!.blocks[0]!.result.transactions.length = 0; }).toThrow();
  await f.connector.observe(evidence.before);
  await f.connector.observe(evidence.before);
  expect(f.calls.filter(c=>c.method==='getBlock'&&c.slot===evidence.after.slot)).toHaveLength(2); // full plus header once
  for (const n of [0, 9, 1.5]) expect(() => new FinalizedFlowConnector(f.rpc,f.archive,f.now,{blockConcurrency:n})).toThrow('BOUNDS');
  const replay = await reconcileLinkedInterval(newLinkedBranch('sliding','sliding',evidence.before),packet!,f.now(),10000);
  expect(replay.branch.real).toEqual(evidence.after);
});
it('prefetch and interval share a bounded acquisition budget and durable complete bodies after restart',async()=>{
  const f=await fixture(true,4);
  const [_,packet]=await Promise.all([f.connector.prefetch(evidence.before,evidence.after),f.connector.interval(evidence.before,evidence.after)]);
  expect(packet!.blocks).toEqual(evidence.blocks);expect(f.maximum()).toBeLessThanOrEqual(4);
  for(const slot of evidence.slots)expect(f.calls.filter(c=>c.method==='getBlock'&&c.slot===slot)).toHaveLength(1);
  const restarted=new FinalizedFlowConnector({call:async()=>{throw Error('UNEXPECTED_NETWORK')}},f.archive,f.now);
  expect((await restarted.interval(evidence.before,evidence.after))!.blocks).toEqual(evidence.blocks);
});
it('failed speculative acquisition cannot publish an interval or skip the failed block',async()=>{
  const f=await fixture(true,4);f.fail(evidence.slots[2]);
  await expect(f.connector.prefetch(evidence.before,evidence.after)).rejects.toThrow('CONTROLLED_PROVIDER');
  expect((await readdir(f.dir)).some(p=>p.startsWith('interval-'))).toBe(false);
  await expect(f.connector.interval(evidence.before,evidence.after)).rejects.toThrow('CONTROLLED_PROVIDER');
  f.fail();expect((await f.connector.interval(evidence.before,evidence.after))!.slots).toEqual(evidence.slots);
});
it('coalesces simultaneous retained interval reads, bounds acquisition and preserves complete ordered evidence', async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([
    f.connector.interval(evidence.before, evidence.after),
    f.connector.interval(evidence.before, evidence.after),
  ]);
  expect(a!.slots).toEqual(evidence.slots);
  expect(a!.blocks).toEqual(evidence.blocks);
  expect(a!.anchor).toEqual(evidence.anchor);
  expect(digest(a)).toBe(digest(b));
  expect(f.maximum()).toBeGreaterThan(1);
  expect(f.maximum()).toBeLessThanOrEqual(4);
  expect(f.calls.filter((c) => c.method === 'getBlocks')).toHaveLength(1);
  for (const slot of evidence.slots)
    expect(f.calls.filter((c) => c.method === 'getBlock' && c.slot === slot)).toHaveLength(1);
  a!.blocks.length = 0;
  expect(b!.blocks).toHaveLength(evidence.blocks.length);
  const restart = new FinalizedFlowConnector(
    {
      call: async () => {
        throw Error('NO_NETWORK');
      },
    },
    f.archive,
    f.now,
  );
  const retained = await restart.interval(evidence.before, evidence.after);
  expect(retained!.blocks).toEqual(evidence.blocks);
});
it('captures coherent Token-2022 fee witnesses separately from historical banks and reuses the complete packet after restart', async () => {
  const e = JSON.parse(
    gunzipSync(
      readFileSync(
        'docs/linked-pair-20261024/local-extension-test/provider-461064713-461064721-token2022.json.gz',
      ),
    ).toString(),
  ) as ProviderInterval;
  const dir = await mkdtemp(join(tmpdir(), 'pf-connector-test-'));
  directories.push(dir);
  const archive = new FinalizedBankArchive(dir, true);
  let reads = 0,
    bad = true;
  const rpc: ReadOnlyRpc = {
    async call<T>(method, params) {
      if (method === 'getBlocks') return structuredClone(e.slots) as T;
      if (method === 'getBlock')
        return structuredClone(
          Number(params[0]) === e.before.slot
            ? {
                blockhash: e.anchor.blockhash,
                parentSlot: e.before.slot - 1,
                previousBlockhash: 'anchor',
                blockTime: Number(
                  Buffer.from(
                    e.before.accounts.SysvarC1ock11111111111111111111111111111111!.base64,
                    'base64',
                  ).readBigInt64LE(32),
                ),
                transactions: [],
              }
            : e.blocks.find((b) => b.slot === Number(params[0]))!.result,
        ) as T;
      if (method === 'getMultipleAccounts') {
        reads++;
        const witness = e.token2022!;
        return {
          context: { slot: witness.contextSlot + (bad ? 1 : 0) },
          value: (params[0] as string[]).map((a) => {
            const v =
              a === 'SysvarC1ock11111111111111111111111111111111'
                ? witness.clock
                : witness.mints[a]!;
            return { owner: v.owner, data: [v.base64, 'base64'] };
          }),
        } as T;
      }
      throw Error('UNEXPECTED_RPC');
    },
  };
  const connector = new FinalizedFlowConnector(rpc, archive, () => Date.parse(e.acquiredAt));
  await expect(connector.interval(e.before, e.after)).rejects.toThrow('TOKEN_FEE_CLOCK_CONTEXT');
  expect(reads).toBe(3);
  expect((await readdir(dir)).filter((x) => x.startsWith('interval-'))).toHaveLength(0);
  bad = false;
  const captured = (await connector.interval(e.before, e.after))!;
  expect(captured.token2022).toEqual(e.token2022);
  expect(captured.before).toEqual(e.before);
  expect(captured.after).toEqual(e.after);
  expect(
    (
      await reconcileLinkedInterval(
        newLinkedBranch('witness', 'witness', e.before),
        captured,
        Date.parse(e.after.observedAt),
        10000,
      )
    ).events,
  ).toBe(1);
  const restart = new FinalizedFlowConnector(
    {
      async call() {
        throw Error('NO_NETWORK');
      },
    },
    archive,
    () => Date.parse(e.acquiredAt),
  );
  expect(digest(await restart.interval(e.before, e.after))).toBe(digest(captured));
});
it('publishes no partial interval on missing blocks and recovers without duplicate evidence after retry', async () => {
  const f = await fixture(),
    slot = evidence.slots[1]!;
  f.fail(slot);
  const first = await Promise.allSettled([
    f.connector.interval(evidence.before, evidence.after),
    f.connector.interval(evidence.before, evidence.after),
  ]);
  expect(first.every((r) => r.status === 'rejected')).toBe(true);
  expect((await readdir(f.dir)).filter((n) => n.startsWith('interval-'))).toHaveLength(0);
  f.fail();
  const complete = await f.connector.interval(evidence.before, evidence.after);
  expect(complete!.blocks).toEqual(evidence.blocks);
  expect((await readdir(f.dir)).filter((n) => n.startsWith('interval-'))).toHaveLength(1);
  expect(
    f.calls.filter((c) => c.method === 'getBlock' && c.slot === evidence.slots[0]),
  ).toHaveLength(1);
});
it('retains strict Clock/context and interval bounds before acquisition', async () => {
  const f = await fixture(),
    bad = structuredClone(evidence.after);
  bad.slot++;
  await expect(f.connector.interval(evidence.before, bad)).rejects.toThrow('CLOCK_CONTEXT');
  const bounded = new FinalizedFlowConnector(f.rpc, f.archive, f.now, { maxSlots: 1 });
  await expect(bounded.interval(evidence.before, evidence.after)).rejects.toThrow('INTERVAL_BOUND');
  expect(f.calls).toHaveLength(0);
});
it('compressed complete blocks and immutable intervals survive restart; corrupt or partial writes never pass integrity', async () => {
  const f = await fixture(),
    archive = new FinalizedBankArchive(f.dir, true),
    connector = new FinalizedFlowConnector(f.rpc, archive, f.now);
  const acquired = await connector.interval(evidence.before, evidence.after);
  expect(digest(acquired)).toBeDefined();
  expect(Object.isFrozen(acquired!.blocks[0]!.result.transactions)).toBe(true);
  expect(() => {
    acquired!.blocks.length = 0;
  }).toThrow();
  const calls = f.calls.length,
    restart = new FinalizedFlowConnector(f.rpc, new FinalizedBankArchive(f.dir, true), f.now);
  expect(digest(await restart.interval(evidence.before, evidence.after))).toBe(digest(acquired));
  expect(f.calls.length).toBe(calls);
  const name = (await readdir(f.dir)).find(
    (n) => n.startsWith('block-') && n.endsWith('.json.gz'),
  )!;
  const envelope = JSON.parse(gunzipSync(await readFile(join(f.dir, name))).toString());
  envelope.json += ' ';
  await writeFile(join(f.dir, name), gzipSync(JSON.stringify(envelope)));
  await expect(archive.get(name.slice(0, -8))).rejects.toThrow('ARCHIVE_HASH');
  await writeFile(join(f.dir, 'pending-controlled.json.gz'), 'partial');
  await expect(archive.get('block-missing')).resolves.toBeNull();
  await archive.bank(evidence.before);
  await archive.bank(evidence.after);
  expect((await archive.nextBank(evidence.before))!.slot).toBe(evidence.after.slot);
});
it('replays the complete retained mainnet interval without changing native liquidity results', async () => {
  const f = await fixture();
  const acquired = await f.connector.interval(evidence.before, evidence.after);
  const branch = newLinkedBranch('retained-replay-only', 'retained-round', evidence.before);
  const expected = await reconcileLinkedInterval(branch, evidence, f.now(), 10000);
  const actual = await reconcileLinkedInterval(branch, acquired!, f.now(), 10000);
  expect(actual.events).toBe(expected.events);
  expect(actual.failedTransactions).toBe(expected.failedTransactions);
  expect(digest(actual.branch.simulated)).toBe(digest(expected.branch.simulated));
  expect(digest(actual.branch.real)).toBe(digest(evidence.after));
});
it('discovery and canonical loading reuse one complete bank only within the same advisory read', async () => {
  const f = await fixture();
  const context = () => ({
    signal: new AbortController().signal,
    metrics: { rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 },
  });
  await withAdvisoryRead(context(), async () => {
    const first = await f.connector.interval(evidence.before);
    const second = await f.connector.interval(evidence.before);
    expect(digest(first)).toBe(digest(second));
    first!.blocks.length = 0;
    expect(second!.blocks.length).toBe(evidence.blocks.length);
  });
  expect(f.calls.filter((c) => c.method === 'getMultipleAccounts')).toHaveLength(1);
  await withAdvisoryRead(context(), () => f.connector.interval(evidence.before));
  expect(f.calls.filter((c) => c.method === 'getMultipleAccounts')).toHaveLength(2);
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(
    withAdvisoryRead({ ...context(), signal: cancelled.signal }, () =>
      f.connector.interval(evidence.before),
    ),
  ).rejects.toThrow();
  expect(f.calls.filter((c) => c.method === 'getMultipleAccounts')).toHaveLength(2);
});
