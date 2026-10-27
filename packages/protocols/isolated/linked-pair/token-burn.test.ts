import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import bs58 from 'bs58';
import { digest, newLinkedBranch, reconcileLinkedInterval, type ProviderInterval } from './external-flow.js';
const e=JSON.parse(gunzipSync(readFileSync(new URL('../../../../docs/linked-pair-20261024/local-extension-test/provider-461273931-461273938-burn.json.gz',import.meta.url))).toString()) as ProviderInterval;
const source='4RnxqGVW5KPz1QtM5Fvqq2Z5uf4Vwqn6gknwcG6j9M4w',mint='CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump';
const run=(p=e,b=newLinkedBranch('burn-receipt','burn-receipt',p.before))=>reconcileLinkedInterval(b,p,Date.parse(p.after.observedAt),10000);
const tx=(p:ProviderInterval)=>p.blocks.flatMap(b=>b.result.transactions).find(t=>t.transaction.signatures[0]!.startsWith('2Z8Goy'))!;
it('replays genuine Burn(1) then CloseAccount, including exact supply, lamport refund, duplicate and restored state',async()=>{
 expect(digest(e)).toBe('8c9504c1b48d2190aab7b7a4bc244f58252e5110d7eae1fbc4a5b5a188ed4e21');
 const before=Buffer.from(e.before.accounts[mint]!.base64,'base64').readBigUInt64LE(36);
 const r=await run();expect(r.events).toBe(1);expect(r.failedTransactions).toBe(360);
 expect(r.branch.real).toEqual(e.after);expect(r.branch.simulated.accounts).toEqual(e.after.accounts);
 expect(Buffer.from(r.branch.real.accounts[mint]!.base64,'base64').readBigUInt64LE(36)).toBe(before-1n);
 const restored=JSON.parse(JSON.stringify(r.branch)),duplicate=await run(e,restored);
 expect(duplicate.replay).toBe(true);expect(digest(duplicate.branch)).toBe(digest(restored));
});
it('rejects changed burn evidence and preserves the caller checkpoint',async()=>{
 const p=structuredClone(e),b=newLinkedBranch('invalid','invalid',p.before),original=digest(b);
 const raw=Buffer.from(bs58.decode(tx(p).transaction.message.instructions[0]!.data));raw.writeBigUInt64LE(2n,1);tx(p).transaction.message.instructions[0]!.data=bs58.encode(raw);
 await expect(run(p,b)).rejects.toThrow('TOKEN_BURN_EVIDENCE_UNSUPPORTED');expect(digest(b)).toBe(original);
});
it('does not erase carried PAPER inventory to permit an on-chain account closure',async()=>{
 const b=newLinkedBranch('impact','impact',e.before);b.inventoryDeltas[source]='1';const original=digest(b);
 await expect(run(e,b)).rejects.toThrow('TOKEN_BURN_CLOSE_NOT_EMPTY');expect(digest(b)).toBe(original);
});
it('requires a chronological close receipt when the provider post-token balance is absent',async()=>{
 const p=structuredClone(e);tx(p).transaction.message.instructions.pop();await expect(run(p)).rejects.toThrow('TOKEN_BURN_EVIDENCE_UNSUPPORTED');
});
