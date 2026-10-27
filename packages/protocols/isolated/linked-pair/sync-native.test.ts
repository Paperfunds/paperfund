import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import bs58 from 'bs58';
import { digest, newLinkedBranch, reconcileLinkedInterval, type ProviderInterval } from './external-flow.js';
import { transitionLinkedSnapshot } from './native-transition.js';
const e=JSON.parse(gunzipSync(readFileSync(new URL('../../../../docs/linked-pair-20261024/local-extension-test/provider-461289562-461289569-sync-native.json.gz',import.meta.url))).toString()) as ProviderInterval;
const WSOL='4AMGF2hf5t3nEKfQSPsLvhcpS4HrQUV2opRwEmhavx1d';
const tx=(p:ProviderInterval)=>p.blocks.flatMap(b=>b.result.transactions).find(t=>t.transaction.signatures[0]!.startsWith('2utbnue8'))!;
const run=(p=e,b=newLinkedBranch('sync-native','sync-native',p.before))=>reconcileLinkedInterval(b,p,Date.parse(p.after.observedAt),10000);
function indices(p:ProviderInterval){const t=tx(p),keys=[...t.transaction.message.accountKeys,...t.meta.loadedAddresses!.writable,...t.meta.loadedAddresses!.readonly],g=t.meta.innerInstructions.find(g=>g.instructions.some(i=>keys[i.programIdIndex]==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'&&bs58.decode(i.data)[0]===17))!;return {t,keys,g,index:g.instructions.findIndex(i=>keys[i.programIdIndex]==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'&&bs58.decode(i.data)[0]===17)}}
it('replays all genuine funding/sync/spend transactions with exact token/native conservation and duplicate recovery',async()=>{
 expect(digest(e)).toBe('9569f815da88c3edb74cc7cdd377293fd280cb6e0a518703f36f6391419d7c44');
 expect(e.blocks.reduce((n,b)=>n+b.result.transactions.length,0)).toBe(2670);
 const {t,keys}=indices(e),i=keys.indexOf(WSOL),pre=t.meta.preTokenBalances.find(b=>b.accountIndex===i)!,post=t.meta.postTokenBalances.find(b=>b.accountIndex===i)!;
 expect(BigInt(t.meta.preBalances![i]!)-BigInt(pre.uiTokenAmount.amount)).toBe(1488440n);
 expect(pre.uiTokenAmount.amount).toBe('123327221');expect(post.uiTokenAmount.amount).toBe(pre.uiTokenAmount.amount);
 expect(t.meta.postBalances![i]).toBe(t.meta.preBalances![i]);
 const r=await run();expect(r.events).toBe(1);expect(r.failedTransactions).toBe(972);
 expect(r.branch.real).toEqual(e.after);expect(r.branch.simulated.accounts).toEqual(e.after.accounts);
 const restored=JSON.parse(JSON.stringify(r.branch)),again=await run(e,restored);
 expect(again.replay).toBe(true);expect(digest(again.branch)).toBe(digest(restored));
});
it('a controlled repeated sync after the genuine funding recognizes no second credit',async()=>{
 const p=structuredClone(e),{g,index}=indices(p);g.instructions.splice(index+1,0,structuredClone(g.instructions[index]!));
 const r=await run(p);expect(r.branch.real).toEqual(e.after);expect(r.branch.simulated.accounts).toEqual(e.after.accounts);
});
it('controlled split funding with two chronological syncs credits only the sum actually funded',async()=>{
 const p=structuredClone(e),{g,index}=indices(p),fund=g.instructions[index-1]!,sync=g.instructions[index]!,raw=Buffer.from(bs58.decode(fund.data));
 expect(raw.readBigUInt64LE(4)).toBe(12121796n);raw.writeBigUInt64LE(6060898n,4);
 const half={...fund,data:bs58.encode(raw)};g.instructions.splice(index-1,2,half,structuredClone(sync),structuredClone(half),structuredClone(sync));
 const r=await run(p);expect(r.branch.real).toEqual(e.after);expect(r.branch.simulated.accounts).toEqual(e.after.accounts);
});
it('preserves controlled pre-existing PAPER/native inventory differences across sync and restart',async()=>{
 const b=newLinkedBranch('paper-impact','paper-impact',e.before);b.inventoryDeltas[WSOL]='19';b.inventoryDeltas['lamports:'+WSOL]='19';const old=digest(b);
 const r=await run(e,b);expect(digest(b)).toBe(old);expect(r.branch.inventoryDeltas[WSOL]).toBe('19');expect(r.branch.inventoryDeltas['lamports:'+WSOL]).toBe('19');
 expect(digest((await run(e,JSON.parse(JSON.stringify(r.branch)))).branch)).toBe(digest(r.branch));
});
it('rejects an unproven funding amount, malformed sync and wrong Token Program without mutating the checkpoint',async()=>{
 const p=structuredClone(e),{g,index}=indices(p),raw=Buffer.from(bs58.decode(g.instructions[index-1]!.data));raw.writeBigUInt64LE(12121797n,4);g.instructions[index-1]!.data=bs58.encode(raw);
 const b=newLinkedBranch('bad-funding','bad-funding',p.before),old=digest(b);await expect(run(p,b)).rejects.toThrow();expect(digest(b)).toBe(old);
 const malformed=structuredClone(e),m=indices(malformed);m.g.instructions[m.index]!.data=bs58.encode(Buffer.from([17,0]));await expect(run(malformed)).rejects.toThrow('NATIVE_SYNC_LAYOUT');
 const wrong=structuredClone(e),w=indices(wrong);w.g.instructions[w.index]!.programIdIndex=w.keys.indexOf('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');await expect(run(wrong)).rejects.toThrow('NATIVE_SYNC_PROGRAM_UNSUPPORTED');
});
it('keeps the existing inventory safety hold when controlled prior PAPER impact cannot fund the external onward amount',async()=>{
 const b=newLinkedBranch('prior-pool-impact','prior-pool-impact',e.before);
 b.simulated=(await transitionLinkedSnapshot(b.simulated,10000000n,true,{nowMs:Date.parse(e.before.observedAt),maxAgeMs:10000})).next;
 const old=digest(b);await expect(run(e,b)).rejects.toThrow('MODELED_EXTERNAL_INVENTORY_EXHAUSTED');expect(digest(b)).toBe(old);
});
