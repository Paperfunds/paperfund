import {it,expect,afterEach,vi} from 'vitest';
vi.setConfig({testTimeout:120000,hookTimeout:30000});
import {readFileSync} from 'node:fs';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FootprintFlowConnector} from './footprint-acquisition.js';
import {FinalizedBankArchive,type ReadOnlyRpc} from './finalized-connector.js';
import {footprintFromFull} from '../../../../packages/protocols/isolated/linked-pair/footprint.js';
import {newLinkedBranch,reconcileLinkedInterval,type ProviderInterval} from '../../../../packages/protocols/isolated/linked-pair/external-flow.js';
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0)){if(!d.startsWith(join(tmpdir(),'pf-footprint-')))throw Error('TEST_PATH');await rm(d,{recursive:true,force:true})}});
async function fixture(){
 const p=JSON.parse(gunzipSync(readFileSync('docs/linked-pair-20261021/external-flow-completion/provider-459758217-459758224.json.gz')).toString()) as ProviderInterval;
 const dir=await mkdtemp(join(tmpdir(),'pf-footprint-'));dirs.push(dir);let fault='',calls=0,accountsCalls=0;
 const f=p.blocks.map(b=>footprintFromFull(b.slot,b.result)),schedule=Buffer.alloc(33);schedule.writeBigUInt64LE(432000n);schedule.writeBigUInt64LE(432000n,8);
 const rpc:ReadOnlyRpc={async call<T>(method,args){calls++;
  if(method==='getBlocks')return (fault==='gap'?p.slots.filter((_,i)=>i!==1):p.slots) as T;
  if(method==='getBlock'){
   const slot=Number(args[0]),config=args[1] as {transactionDetails:string};
   if(slot===p.before.slot)return {blockhash:p.anchor.blockhash,parentSlot:slot-1,previousBlockhash:'prior',blockTime:Number(Buffer.from(p.before.accounts.SysvarC1ock11111111111111111111111111111111!.base64,'base64').readBigInt64LE(32)),signatures:[]} as T;
   const b=p.blocks.find(b=>b.slot===slot)!,m=f.find(f=>f.slot===slot)!;
   if(config.transactionDetails==='signatures')return m.signatureHeader as T;
   accountsCalls++;
   const rows=m.rows.map((r,i)=>({version:r.version,transaction:{signatures:r.signatures,accountKeys:r.accounts.map((i,j)=>({pubkey:m.keys[i],writable:r.writable.includes(j)}))},meta:b.result.transactions[i]!.meta}));
   if(fault==='truncated'&&slot===p.slots[0])rows.pop();
   return {...b.result,transactions:rows} as T;
  }
  if(method==='getTransaction'){
   if(fault==='receipt')throw Error('CONTROLLED_MISSING_RECEIPT');
   for(const b of p.blocks){const index=b.result.transactions.findIndex(t=>t.transaction.signatures[0]===args[0]);if(index>=0)return{...b.result.transactions[index],slot:b.slot,transactionIndex:index,blockTime:b.result.blockTime} as T}throw Error('UNKNOWN_SIGNATURE');
  }
  if(method==='getMultipleAccounts')return {context:{slot:p.after.slot},value:(args[0] as string[]).map(a=>({owner:'Sysvar1111111111111111111111111111111111111',data:[a==='SysvarC1ock11111111111111111111111111111111'?p.after.accounts[a]!.base64:schedule.toString('base64'),'base64']}))} as T;
  throw Error('UNEXPECTED_RPC');
 }};
 const archive=new FinalizedBankArchive(dir,true),branch=newLinkedBranch('rpc-fixture','rpc-fixture',p.before),connector=new FootprintFlowConnector(rpc,archive,()=>Date.parse(p.after.observedAt),{maxTransactions:200000});
 return{p,dir,archive,branch,connector,fault:(f:string)=>{fault=f},calls:()=>calls,accountsCalls:()=>accountsCalls};
}
it('acquires complete coverage and full required receipts, coalesces, then recovers without network',async()=>{
 const f=await fixture(),[a,b]=await Promise.all([f.connector.intervalForBranch(f.branch,f.p.after),f.connector.intervalForBranch(f.branch,f.p.after)]);
 expect(a).toBe(b);expect(a!.schema).toBe('LINKED_RETAINED_RPC_INTERVAL_V2');expect(f.accountsCalls()).toBe(f.p.slots.length);
 const result=await reconcileLinkedInterval(f.branch,a!,Date.parse(f.p.after.observedAt),10000),full=await reconcileLinkedInterval(f.branch,f.p,Date.parse(f.p.after.observedAt),10000);
 expect({...result.branch,intervals:[]}).toEqual({...full.branch,intervals:[]});expect(result.failedTransactions).toBe(full.failedTransactions);
 const restart=new FootprintFlowConnector({call:async()=>{throw Error('NO_NETWORK')}},f.archive,()=>Date.parse(f.p.after.observedAt));
 expect((await restart.intervalForBranch(f.branch,f.p.after))!.coverage).toEqual(a!.coverage);
});
it.each(['gap','truncated','receipt'])('persists a %s gap without a completed interval and retries from durable evidence',async variant=>{
 const f=await fixture();f.fault(variant);await expect(f.connector.intervalForBranch(f.branch,f.p.after)).rejects.toThrow();
 const files=await readdir(f.dir);expect(files.some(n=>n.startsWith('coverage-gap-'))).toBe(true);expect(files.some(n=>n.startsWith('coverage-complete-'))).toBe(false);expect(files.some(n=>n.startsWith('interval-footprint-'))).toBe(false);
 const previous=f.accountsCalls();f.fault('');expect((await f.connector.intervalForBranch(f.branch,f.p.after))!.schema).toBe('LINKED_RETAINED_RPC_INTERVAL_V2');
 if(variant==='receipt')expect(f.accountsCalls()).toBe(previous);
});
