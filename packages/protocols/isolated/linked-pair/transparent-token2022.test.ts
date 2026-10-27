import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import bs58 from 'bs58';
import { digest, newLinkedBranch, reconcileLinkedInterval, type ProviderInterval } from './external-flow.js';
import { feePolicies, proveTransparentMint, WITHHELD_PREFIX } from './token-2022-flow.js';
const MINT='CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH';
const e=JSON.parse(gunzipSync(readFileSync(new URL('../../../../docs/linked-pair-20261024/local-extension-test/provider-461273875-461273882-transparent-token2022.json.gz',import.meta.url))).toString()) as ProviderInterval;
const run=(p=e,b=newLinkedBranch('transparent-receipts','transparent-receipts',p.before))=>reconcileLinkedInterval(b,p,Date.parse(p.after.observedAt),10000);
const tx=(p:ProviderInterval)=>p.blocks.flatMap(b=>b.result.transactions).find(t=>t.transaction.signatures[0]!.startsWith('5iCPrw'))!;
it('replays the complete genuine seven-block interval with exact protected state and zero withheld CASH',async()=>{
 expect(digest(e)).toBe('79bee32f8dbf1e07f1eb8a133c8fbe196b4b35e65dc963e8aafc4bbb0465506e');
 expect(e.blocks.reduce((n,b)=>n+b.result.transactions.length,0)).toBe(2008);
 expect(proveTransparentMint(MINT,6,e.blocks)).toEqual({transfers:4,withheld:'0'});
 const r=await run();expect(r.events).toBe(1);expect(r.failedTransactions).toBe(557);
 expect(r.branch.real).toEqual(e.after);expect(r.branch.simulated.accounts).toEqual(e.after.accounts);
 expect(r.token2022Transfers.map(t=>[t.gross,t.net,t.withheld])).toEqual([['85035','85035','0'],['85035','85035','0'],['9919177','9919177','0']]);
 const restored=JSON.parse(JSON.stringify(r.branch));const duplicate=await run(e,restored);
 expect(duplicate.replay).toBe(true);expect(digest(duplicate.branch)).toBe(digest(restored));
});
it('preserves prior spendable and withheld PAPER differences through recovery without financial effects',async()=>{
 const b=newLinkedBranch('impact','impact',e.before),mid='tZezrHzUhQxoWqFkKPDnf7caa4n99rtjSugPNUSqHrz';
 b.inventoryDeltas[mid]='100';b.inventoryDeltas[WITHHELD_PREFIX+mid]='17';const before=digest(b);
 const r=await run(e,b);expect(digest(b)).toBe(before);expect(r.branch.inventoryDeltas[mid]).toBe('100');expect(r.branch.inventoryDeltas[WITHHELD_PREFIX+mid]).toBe('17');
 expect(digest((await run(e,JSON.parse(JSON.stringify(r.branch)))).branch)).toBe(digest(r.branch));
});
it('proves transparent semantics for a different mint without token-specific exceptions',()=>{
 const p=structuredClone(e),other='11111111111111111111111111111112';
 for(const b of p.blocks)for(const t of b.result.transactions){t.transaction.message.accountKeys=t.transaction.message.accountKeys.map(k=>k===MINT?other:k);for(const type of ['writable','readonly'] as const)if(t.meta.loadedAddresses)t.meta.loadedAddresses[type]=t.meta.loadedAddresses[type].map(k=>k===MINT?other:k);for(const v of [...t.meta.preTokenBalances,...t.meta.postTokenBalances])if(v.mint===MINT)v.mint=other;}
 expect(proveTransparentMint(other,6,p.blocks)).toEqual({transfers:4,withheld:'0'});
});
it('refuses later mint data alone, active hook configuration and unexplained net/withheld amounts',()=>{
 expect(()=>feePolicies(e.token2022,e.before,e.after)).toThrow('TOKEN_2022_TRANSPARENT_PROOF_REQUIRED');
 const p=structuredClone(e),post=tx(p).meta.postTokenBalances.find(b=>b.mint===MINT)!;post.uiTokenAmount.amount=(BigInt(post.uiTokenAmount.amount)-1n).toString();
 expect(()=>proveTransparentMint(MINT,6,p.blocks)).toThrow('TOKEN_2022_TRANSPARENT_NET_MISMATCH');
});
it('rejects an executed hook child, confidential instruction, account closure and missing balance evidence',()=>{
 for(const op of [27,9]){const p=structuredClone(e),i=tx(p).meta.innerInstructions[0]!.instructions[0]!;i.data=bs58.encode(Buffer.from([op]));expect(()=>proveTransparentMint(MINT,6,p.blocks)).toThrow('TOKEN_2022_TRANSPARENT_INSTRUCTION:'+op);}
 const p=structuredClone(e),g=tx(p).meta.innerInstructions[0]!;g.instructions.splice(1,0,{...g.instructions[0]!,stackHeight:3});expect(()=>proveTransparentMint(MINT,6,p.blocks)).toThrow('TOKEN_2022_TRANSPARENT_HOOK_CPI');
 const missing=structuredClone(e);tx(missing).meta.postTokenBalances=tx(missing).meta.postTokenBalances.filter(b=>b.mint!==MINT);expect(()=>proveTransparentMint(MINT,6,missing.blocks)).toThrow('TOKEN_2022_TRANSPARENT_BALANCE_COVERAGE');
});
it('does not use this receipt proof to admit an active hook or unknown extension policy',()=>{
 const p=structuredClone(e.token2022!),raw=Buffer.from(p.mints[MINT]!.base64,'base64');
 for(let offset=166;offset+4<=raw.length;){const type=raw.readUInt16LE(offset),length=raw.readUInt16LE(offset+2);if(type===14){raw[offset+4+32]=1;break;}offset+=4+length;}
 p.mints[MINT]!.base64=raw.toString('base64');expect(()=>feePolicies(p,e.before,e.after,e.blocks)).toThrow('TOKEN_2022_TRANSPARENT_PROOF_REQUIRED');
 const unknown=structuredClone(e.token2022!),data=Buffer.from(unknown.mints[MINT]!.base64,'base64');data.writeUInt16LE(9,166);unknown.mints[MINT]!.base64=data.toString('base64');expect(()=>feePolicies(unknown,e.before,e.after,e.blocks)).toThrow('TOKEN_2022_WITNESS_EXTENSIONS');
});
