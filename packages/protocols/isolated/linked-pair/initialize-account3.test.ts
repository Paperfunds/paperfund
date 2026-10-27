import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import bs58 from 'bs58';
import { digest, newLinkedBranch, reconcileLinkedInterval, type ProviderInterval } from './external-flow.js';
import { proveTransparentMint } from './token-2022-flow.js';
const e=JSON.parse(gunzipSync(readFileSync(new URL('../../../../docs/linked-pair-20261024/local-extension-test/provider-461289799-461289806-initialize-account3.json.gz',import.meta.url))).toString()) as ProviderInterval;
const mint='GDGHvRdJwnzjeVY4LaWytpiFfSK8oymxpN8HUJuoueSf', account='DTAusSzCJqShtTDZM2nb3GCeGw2TYfh5uvP9GEsEARBy';
function transaction(p:ProviderInterval){const t=p.blocks.flatMap(b=>b.result.transactions).find(t=>t.transaction.signatures[0]!.startsWith('34dUTJ'))!,keys=[...t.transaction.message.accountKeys,...t.meta.loadedAddresses!.writable,...t.meta.loadedAddresses!.readonly];return {t,keys,g:t.meta.innerInstructions[0]!,i:keys.indexOf(account)}}
const run=(p=e,b=newLinkedBranch('init3','init3',p.before))=>reconcileLinkedInterval(b,p,Date.parse(p.after.observedAt),10000);
it('replays every genuine block with proven new-account zero, exact final balances and restart/duplicate consistency',async()=>{
 expect(digest(e)).toBe('308d0770c250f8299265625cfe92a376ad98b29c7f3c5d0c5db47ce9b3c54f33');
 expect(e.blocks.reduce((n,b)=>n+b.result.transactions.length,0)).toBe(2716);
 const {t,i}=transaction(e);expect(t.meta.preBalances![i]).toBe(0);expect(t.meta.preTokenBalances.some(b=>b.accountIndex===i)).toBe(false);
 expect(t.meta.postTokenBalances.find(b=>b.accountIndex===i)!.uiTokenAmount.amount).toBe('21449720');
 expect(proveTransparentMint(mint,6,e.blocks).withheld).toBe('0');
 const r=await run();expect(r.events).toBe(2);expect(r.failedTransactions).toBe(757);expect(r.branch.real).toEqual(e.after);expect(r.branch.simulated.accounts).toEqual(e.after.accounts);
 const restored=JSON.parse(JSON.stringify(r.branch));expect((await run(e,restored)).replay).toBe(true);expect(digest((await run(e,restored)).branch)).toBe(digest(restored));
});
it.each(['creation','initialization','prior-lamports','program-owner','token-owner','mint','ordering','post-balance','duplicate-init','missing-native-evidence'] as const)('rejects controlled invalid %s proof without mutating caller state',async variant=>{
 const p=structuredClone(e),{t,g,i}=transaction(p),create=g.instructions.findIndex(x=>Buffer.from(bs58.decode(x.data)).length===52),init=g.instructions.findIndex(x=>bs58.decode(x.data)[0]===18),transfer=g.instructions.findIndex(x=>bs58.decode(x.data)[0]===12);
 if(variant==='creation')g.instructions.splice(create,1);
 if(variant==='initialization')g.instructions.splice(init,1);
 if(variant==='prior-lamports')t.meta.preBalances![i]=1;
 if(variant==='program-owner'){const r=Buffer.from(bs58.decode(g.instructions[create]!.data));r.fill(0,20);g.instructions[create]!.data=bs58.encode(r)}
 if(variant==='token-owner'){const r=Buffer.from(bs58.decode(g.instructions[init]!.data));r.fill(0,1);g.instructions[init]!.data=bs58.encode(r)}
 if(variant==='mint')g.instructions[init]!.accounts[1]=g.instructions[init]!.accounts[0]!;
 if(variant==='ordering'){const [x]=g.instructions.splice(transfer,1);g.instructions.splice(init,0,x!)}
 if(variant==='post-balance')t.meta.postTokenBalances.find(b=>b.accountIndex===i)!.uiTokenAmount.amount='21449719';
 if(variant==='duplicate-init')g.instructions.splice(init+1,0,structuredClone(g.instructions[init]!));
 if(variant==='missing-native-evidence')delete t.meta.preBalances;
 expect(()=>proveTransparentMint(mint,6,p.blocks)).toThrow('TOKEN_2022_TRANSPARENT');
 const b=newLinkedBranch('bad-init','bad-init',p.before),old=digest(b);await expect(run(p,b)).rejects.toThrow();expect(digest(b)).toBe(old);
});
it('preserves existing PAPER and withheld inventory deltas without financial receipts',async()=>{
 const source='HXGfqRby62FqvZeM3dCDjoFfusZzX1sZpnbU3bnky6C1';
 const b=newLinkedBranch('impact','impact',e.before);b.inventoryDeltas[source]='13';b.inventoryDeltas['withheld:'+source]='7';const old=digest(b),r=await run(e,b);
 expect(digest(b)).toBe(old);expect(r.branch.inventoryDeltas[source]).toBe('13');expect(r.branch.inventoryDeltas['withheld:'+source]).toBe('7');
});
