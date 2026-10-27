import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import bs58 from 'bs58';
import {proveTransparentMint} from './token-2022-flow.js';
import type {ProviderInterval} from './external-flow.js';
const wrapper=JSON.parse(gunzipSync(readFileSync(new URL('../../../../docs/linked-pair-20261024/local-extension-test/block-461304397-close-account.json.gz',import.meta.url))).toString());
const real=JSON.parse(wrapper.json).transactions.find(t=>t.transaction.signatures[0].startsWith('wutwTx'));
const mint='5wdfrLNVZYMBTzCUEWWUZYPXNb6pXVdbnYMfo4Ewpump';
const run=t=>proveTransparentMint(mint,6,[{slot:461304397,result:{transactions:[t]}}] as ProviderInterval['blocks']);
it('proves the genuine full transfer then owner-refund closure with no token or withheld credit',()=>{
 expect(run(real)).toEqual({transfers:1,withheld:'0'});
});
function retained(slot:number,prefix:string){const w=JSON.parse(gunzipSync(readFileSync(new URL(`../../../../docs/linked-pair-20261024/local-extension-test/block-${slot}-account-receipts.json.gz`,import.meta.url))).toString());return JSON.parse(w.json).transactions.find(t=>t.transaction.signatures[0].startsWith(prefix));}
it.each([[461304428,'4tsrR8',1],[461304429,'1buJ4',1],[461304485,'4syYa',1],[461304627,'5QQM9',2]])('proves retained creation/authority/self-transfer/ephemeral closure at %s',(slot,prefix,count)=>{
 expect(run(retained(Number(slot),String(prefix)))).toEqual({transfers:count,withheld:'0'});
});
it('rejects altered seeded derivation, unauthorized closure-authority mutation and missing ephemeral creation',()=>{
 const seeded=retained(461304428,'4tsrR8'),x=seeded.transaction.message.instructions[4],r=Buffer.from(bs58.decode(x.data));r[44]^=1;x.data=bs58.encode(r);expect(()=>run(seeded)).toThrow('TOKEN_2022_TRANSPARENT_SEEDED_CREATION');
 const authority=retained(461304429,'1buJ4'),keys=[...authority.transaction.message.accountKeys,...authority.meta.loadedAddresses.writable,...authority.meta.loadedAddresses.readonly];const a=[...authority.transaction.message.instructions,...authority.meta.innerInstructions.flatMap(g=>g.instructions)].find(x=>keys[x.programIdIndex]==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'&&bs58.decode(x.data)[0]===6);a.accounts[1]=a.accounts[0];expect(()=>run(authority)).toThrow();
 const ephemeral=retained(461304627,'5QQM9');for(const g of ephemeral.meta.innerInstructions)g.instructions=g.instructions.filter(x=>!(Buffer.from(bs58.decode(x.data)).length===52&&bs58.decode(x.data)[0]===0));expect(()=>run(ephemeral)).toThrow();
});
it.each(['missing-close','nonzero-before-close','wrong-destination','wrong-authority','post-lamports','missing-pre','missing-native','native-conservation','reuse-after-close','close-before-transfer'])('rejects controlled %s evidence',variant=>{
 const t=structuredClone(real),keys=[...t.transaction.message.accountKeys,...t.meta.loadedAddresses.writable,...t.meta.loadedAddresses.readonly],close=t.transaction.message.instructions[4],source=close.accounts[0],g=t.meta.innerInstructions.find(g=>g.index===3),transfer=g.instructions.find(x=>keys[x.programIdIndex]==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
 if(variant==='missing-close')t.transaction.message.instructions.splice(4,1);
 if(variant==='nonzero-before-close'){const r=Buffer.from(bs58.decode(transfer.data));r.writeBigUInt64LE(r.readBigUInt64LE(1)-1n,1);transfer.data=bs58.encode(r)}
 if(variant==='wrong-destination')close.accounts[1]=source;
 if(variant==='wrong-authority')close.accounts[2]=source;
 if(variant==='post-lamports')t.meta.postBalances[source]=1;
 if(variant==='missing-pre')t.meta.preTokenBalances=t.meta.preTokenBalances.filter(b=>b.accountIndex!==source);
 if(variant==='missing-native')delete t.meta.preBalances;
 if(variant==='native-conservation')t.meta.postBalances[0]--;
 if(variant==='reuse-after-close')t.transaction.message.instructions.push(structuredClone(transfer));
 if(variant==='close-before-transfer'){t.transaction.message.instructions[3]=close;t.transaction.message.instructions[4]=real.transaction.message.instructions[3];g.index=4;}
 expect(()=>run(t)).toThrow();
});
