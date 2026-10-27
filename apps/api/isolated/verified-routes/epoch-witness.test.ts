// Controlled RPC responses; no market-price or mainnet-acceptance claim.
import {it,expect,afterEach} from 'vitest';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FinalizedBankArchive,FinalizedFlowConnector,type ReadOnlyRpc} from './finalized-connector.js';
import {CLOCK_ACCOUNT,EPOCH_SCHEDULE_ACCOUNT} from '../../../../packages/protocols/isolated/linked-pair/epoch-flow.js';
import type {Stage1Snapshot} from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
const dirs:string[]=[],owner='Sysvar1111111111111111111111111111111111111';
afterEach(async()=>{for(const d of dirs.splice(0)){if(!d.startsWith(join(tmpdir(),'pf-epoch-test-')))throw Error('TEST_PATH');await rm(d,{recursive:true,force:true})}});
function clock(slot:number){const b=Buffer.alloc(40);b.writeBigUInt64LE(BigInt(slot),0);b.writeBigInt64LE(slot<8?100n:107n,8);b.writeBigUInt64LE(slot<8?0n:1n,16);b.writeBigUInt64LE(slot<8?1n:2n,24);b.writeBigInt64LE(BigInt(99+slot),32);return{owner,base64:b.toString('base64')}}
async function fixture(variant='retry'){
 const dir=await mkdtemp(join(tmpdir(),'pf-epoch-test-'));dirs.push(dir);let reads=0;
 const before:Stage1Snapshot={version:'NON_SOL_PUMPSWAP_STAGE1_V1',mint:'controlled',quoteMint:'quote',targetPool:'target',bridgePool:'bridge',slot:7,observedAt:new Date(106000).toISOString(),accounts:{[CLOCK_ACCOUNT]:clock(7)},absentAccounts:[]},after={...before,slot:8,observedAt:new Date(107000).toISOString(),accounts:{[CLOCK_ACCOUNT]:clock(8)}};
 const schedule=Buffer.alloc(33);schedule.writeBigUInt64LE(8n);schedule.writeBigUInt64LE(8n,8);
 const rpc:ReadOnlyRpc={async call<T>(method,args){
  if(method==='getBlocks')return[8] as T;
  if(method==='getBlock'){const n=Number(args[0]);return{blockhash:n===7?'anchor':'after',previousBlockhash:n===7?'previous':'anchor',parentSlot:n-1,blockTime:99+n,transactions:[]} as T}
  if(method==='getMultipleAccounts'){reads++;expect(args[0]).toEqual([CLOCK_ACCOUNT,EPOCH_SCHEDULE_ACCOUNT]);
   const c=clock(9);if(variant==='bad-epoch'){const b=Buffer.from(c.base64,'base64');b.writeBigUInt64LE(99n,16);c.base64=b.toString('base64')}
   return {context:{slot:variant==='retry'&&reads===1?10:9},value:[{owner:c.owner,data:[c.base64,'base64']},variant==='missing'?null:{owner,data:[schedule.toString('base64'),'base64']}]} as T;
  }throw Error('UNEXPECTED_RPC');
 }};
 const archive=new FinalizedBankArchive(dir),connector=new FinalizedFlowConnector(rpc,archive,()=>107000);
 return{before,after,connector,archive,dir,reads:()=>reads};
}
it('retries the whole incoherent witness, retains its exact proof and recovers without RPC',async()=>{
 const f=await fixture(),p=await f.connector.interval(f.before,f.after);expect(f.reads()).toBe(2);expect(p!.epochWitness!.contextSlot).toBe(9);
 const restarted=new FinalizedFlowConnector({call:async()=>{throw Error('NO_RPC')}},f.archive,()=>107000);
 expect((await restarted.interval(f.before,f.after))!.epochWitness).toEqual(p!.epochWitness);
});
it.each(['missing','bad-epoch'])('rejects %s evidence before publishing an interval',async variant=>{
 const f=await fixture(variant);await expect(f.connector.interval(f.before,f.after)).rejects.toThrow();
 expect((await readdir(f.dir)).some(n=>n.startsWith('interval-'))).toBe(false);
});
