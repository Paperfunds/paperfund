// Genuine retained full intervals compare economic outcomes; altered proof tests are controlled.
import {it,expect,vi} from 'vitest';
// Genuine full-history replay is an offline test; interactive API deadlines are unchanged.
vi.setConfig({testTimeout:120000,hookTimeout:30000});
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {projectRetainedInterval,assembleFootprintInterval} from './footprint-acquisition.js';
import {FootprintReceiptRequired,footprintFromFull,prepareFootprintReplay,receiptWrites,bindReceipt} from '../../../../packages/protocols/isolated/linked-pair/footprint.js';
import {digest,newLinkedBranch,reconcileLinkedInterval,type ProviderInterval,type LinkedBranch} from '../../../../packages/protocols/isolated/linked-pair/external-flow.js';
const read=(file:string)=>JSON.parse(gunzipSync(readFileSync(file)).toString()) as ProviderInterval;
const poolFile='docs/linked-pair-20261021/external-flow-completion/provider-459758217-459758224.json.gz';
const tokenFile='docs/linked-pair-20261024/local-extension-test/provider-461064713-461064721-token2022.json.gz';
const run=(b:LinkedBranch,p:ProviderInterval)=>reconcileLinkedInterval(b,p,Date.parse(p.after.observedAt),10000);
const economic=(b:LinkedBranch)=>({...b,intervals:[]});
it('binds runtime-demoted System Program writes and rejects a claimed native effect',()=>{
 const full=read(poolFile),original=full.blocks[0]!.result.transactions[0]!;
 const t=structuredClone(original),m=t.transaction.message as typeof t.transaction.message&{header:{numRequiredSignatures:number;numReadonlySignedAccounts:number;numReadonlyUnsignedAccounts:number}};
 // Controlled header requests the System Program writable, as in genuine v1 receipt 461396260:73.
 m.accountKeys=['payer','11111111111111111111111111111111'];m.header={numRequiredSignatures:1,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:0};m.instructions=[{programIdIndex:1,accounts:[0],data:''}];
 t.meta.loadedAddresses={writable:[],readonly:[]};t.meta.preBalances=[1000,1];t.meta.postBalances=[900,1];
 expect(receiptWrites(t)).toEqual([0]);
 const b={...full.blocks[0]!.result,transactions:[t]},f=footprintFromFull(full.blocks[0]!.slot,b);expect(()=>bindReceipt(f,0,t)).not.toThrow();
 t.meta.postBalances[1]=2;expect(()=>receiptWrites(t)).toThrow('DEMOTED_ACCOUNT_EFFECTS');
});
it.each([poolFile,tokenFile])('retains complete coverage and exactly matches full replay economic outcomes for %s',async file=>{
 const full=read(file),branch=newLinkedBranch('retained-footprint','retained-footprint',full.before),projected=await projectRetainedInterval(branch,full);
 const a=await run(branch,full),b=await run(branch,projected);
 expect(b.events).toBe(a.events);expect(b.failedTransactions).toBe(a.failedTransactions);expect(economic(b.branch)).toEqual(economic(a.branch));
 expect(projected.coverage!.blocks.reduce((n,f)=>n+f.rows.length,0)).toBe(full.blocks.reduce((n,b)=>n+b.result.transactions.length,0));
 const restore=JSON.parse(JSON.stringify(b.branch));expect((await run(restore,projected)).replay).toBe(true);
 expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(Buffer.byteLength(JSON.stringify(full)));
});
it('preserves genuine Token-2022 gross/net/withheld effects with controlled preexisting PAPER differences',async()=>{
 const full=read(tokenFile),b=newLinkedBranch('impact','impact',full.before),mid='B1BAF7Gh6RvZ3qG5VmoWZzhmNtvcFaST7tbnGVHPgz1j';
 b.inventoryDeltas[mid]='100';b.inventoryDeltas['withheld:'+mid]='17';
 const p=await projectRetainedInterval(b,full),a=await run(b,full),r=await run(b,p);
 expect(r.token2022Transfers).toEqual(a.token2022Transfers);expect(economic(r.branch)).toEqual(economic(a.branch));
});
it.skipIf(!process.env.PAPERFUND_EPOCH_EVIDENCE)('matches the complete genuine 15778-transaction epoch-crossing replay',async()=>{
 const full=read(process.env.PAPERFUND_EPOCH_EVIDENCE!),b=newLinkedBranch('epoch-footprint','epoch-footprint',full.before),p=await projectRetainedInterval(b,full),a=await run(b,full),r=await run(b,p);
 expect(full.blocks.reduce((n,b)=>n+b.result.transactions.length,0)).toBe(15778);expect(r.failedTransactions).toBe(a.failedTransactions);expect(economic(r.branch)).toEqual(economic(a.branch));
});
it.each(['coverage-missing','count','keys','receipt','unversioned','order'])('rejects controlled %s tampering before changing its predecessor',async variant=>{
 const full=read(poolFile),b=newLinkedBranch('invalid','invalid',full.before),p=await projectRetainedInterval(b,full),hash=digest(b);
 if(variant==='coverage-missing')delete p.coverage;
 if(variant==='count')p.coverage!.blocks[0]!.rows.pop();
 if(variant==='keys')p.coverage!.blocks[0]!.keys=[];
 if(variant==='receipt'){const f=p.coverage!.blocks.find(f=>f.selected.length)!;p.blocks.find(b=>b.slot===f.slot)!.result.transactions[0]!.transaction.signatures=['wrong'];}
 if(variant==='unversioned')p.schema='LINKED_RETAINED_RPC_INTERVAL_V1';
 if(variant==='order')p.coverage!.blocks.reverse();
 await expect(run(b,p)).rejects.toThrow();expect(digest(b)).toBe(hash);
});
it('requires additional receipts when a concurrent PAPER impact reaches an omitted account',async()=>{
 const full=read(poolFile),b=newLinkedBranch('closure','closure',full.before),p=await projectRetainedInterval(b,full),plan=prepareFootprintReplay(b,p,[])!;
 let tested=false;
 for(const[bi,rows]of plan.entries())for(const[i,row]of rows.entries())if(!row.receipt&&!row.failed){
   const f=p.coverage!.blocks[bi]!,account=f.keys[f.rows[i]!.accounts[0]!]!;
   expect(()=>row.assertOmission({[account]:'1'},{})).toThrow(FootprintReceiptRequired);tested=true;break;
 }
 expect(tested).toBe(true);
});
