/** Coverage-complete acquisition. Existing native replay/ledger remain authoritative. */
import {performance} from 'node:perf_hooks';
import {FinalizedFlowConnector,FinalizedBankArchive,type ReadOnlyRpc} from './finalized-connector.js';
import {digest,reconcileLinkedInterval,type LinkedBranch,type ProviderInterval,type Receipt} from '../../../../packages/protocols/isolated/linked-pair/external-flow.js';
import {footprintFromFull,footprintFromRpc,validateFootprint,bindReceipt,footprintRoots,needsReceipt,FootprintReceiptRequired,type FootprintBlock} from '../../../../packages/protocols/isolated/linked-pair/footprint.js';
import {requiredTokenFeeMints,feePolicies,type Token2022Evidence} from '../../../../packages/protocols/isolated/linked-pair/token-2022-flow.js';
import {CLOCK_ACCOUNT,EPOCH_SCHEDULE_ACCOUNT,epochProgression,type EpochWitness,verifiedClock} from '../../../../packages/protocols/isolated/linked-pair/epoch-flow.js';
import type {Stage1Snapshot} from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
import {linkedBindings} from '../../../../packages/protocols/isolated/linked-pair/shared-bridge.js';
const fail=(m:string):never=>{throw Error('FOOTPRINT_ACQUISITION_'+m)};
const topology=(s:Stage1Snapshot)=>digest({mint:s.mint,quote:s.quoteMint,pool:s.targetPool,bridge:s.bridgePool,accounts:Object.keys(s.accounts).sort(),absent:s.absentAccounts});
const impact=(b:LinkedBranch)=>digest({real:b.real,simulated:b.simulated,deltas:b.inventoryDeltas,reserves:b.nativeReserves});
type Witnesses=Pick<ProviderInterval,'token2022'|'epochWitness'>;
async function parallel<T,U>(values:T[],count:number,work:(v:T)=>Promise<U>){
 const result:U[]=new Array(values.length);let next=0,error:unknown;
 await Promise.all(Array.from({length:Math.min(count,values.length)},async()=>{while(next<values.length&&!error){const i=next++;try{result[i]=await work(values[i]!)}catch(e){error=e}}}));
 if(error)throw error;return result;
}
/** Common builder for retained full evidence and live indices. Dynamic impact can only ADD receipts. */
export async function assembleFootprintInterval(branch:LinkedBranch,base:ProviderInterval,manifests:FootprintBlock[],
 readReceipt:(block:FootprintBlock,index:number)=>Promise<Receipt>,witnesses:(p:ProviderInterval)=>Promise<Witnesses>,concurrency=8){
 const coverage=structuredClone(manifests);coverage.forEach(f=>{validateFootprint(f);f.selected=[]});
 const bodies=new Map<string,Receipt>(),roots=footprintRoots(branch),key=(slot:number,index:number)=>slot+':'+index;
 const acquire=async(f:FootprintBlock,i:number)=>{const k=key(f.slot,i);if(!bodies.has(k)){const t=await readReceipt(f,i);bindReceipt(f,i,t);bodies.set(k,t)}};
 await parallel(coverage.flatMap(f=>f.rows.flatMap((r,i)=>needsReceipt(f,r,roots,branch.inventoryDeltas,branch.nativeReserves)?[{f,i}]:[])),concurrency,({f,i})=>acquire(f,i));
 for(let attempt=0;attempt<=512;attempt++){
  const p:ProviderInterval={...base,schema:'LINKED_RETAINED_RPC_INTERVAL_V2',coverage:{schema:'FINALIZED_DEPENDENCY_FOOTPRINT_V1',blocks:coverage},blocks:coverage.map(f=>{
   f.selected=f.rows.flatMap((_,i)=>bodies.has(key(f.slot,i))?[i]:[]);
   return{slot:f.slot,result:{parentSlot:f.parentSlot,previousBlockhash:f.previousBlockhash,blockhash:f.blockhash,blockTime:f.blockTime,transactions:f.selected.map(i=>bodies.get(key(f.slot,i))!)}};
  })};
  const w=await witnesses(p);delete p.token2022;delete p.epochWitness;Object.assign(p,w);
  // A later-used intermediary fee mint may have been mutated EARLIER in this interval.
  const policyRoots=footprintRoots(branch,[...requiredTokenFeeMints(p.before,p.blocks),...Object.keys(w.token2022?.mints??{})]);
  const policyMissing=coverage.flatMap(f=>f.rows.flatMap((r,i)=>!bodies.has(key(f.slot,i))&&needsReceipt(f,r,policyRoots,branch.inventoryDeltas,branch.nativeReserves)?[{f,i}]:[]));
  if(policyMissing.length){await parallel(policyMissing,concurrency,({f,i})=>acquire(f,i));continue}
  try{const at=performance.now();await reconcileLinkedInterval(branch,p,Date.parse(p.after.observedAt),10000);performance.measure('linked.footprint.reconcile',{start:at,detail:{attempt,receipts:bodies.size}});performance.clearMeasures('linked.footprint.reconcile');return p}
  catch(e){if(!(e instanceof FootprintReceiptRequired))throw e;const f=coverage.find(f=>f.slot===e.slot);if(!f||bodies.has(key(e.slot,e.index)))throw e;await acquire(f,e.index)}
 }
 return fail('DEPENDENCY_CLOSURE_BOUND');
}
/** Genuine full captures remain the trusted comparison and fallback, not edited historical artifacts. */
export async function projectRetainedInterval(branch:LinkedBranch,full:ProviderInterval){
 if(full.schema!=='LINKED_RETAINED_RPC_INTERVAL_V1')fail('FULL_EVIDENCE_REQUIRED');
 return assembleFootprintInterval(branch,full,full.blocks.map(b=>footprintFromFull(b.slot,b.result)),async(f,i)=>full.blocks.find(b=>b.slot===f.slot)!.result.transactions[i]!,async p=>{
  const needed=requiredTokenFeeMints(p.before,p.blocks),token2022=full.token2022?{...full.token2022,mints:Object.fromEntries(needed.map(m=>[m,full.token2022!.mints[m]!]))}:undefined;
  return{...(token2022&&needed.length?{token2022}:{}),...(full.epochWitness?{epochWitness:full.epochWitness}:{})};
 });
}
export interface FootprintOptions {loadBranch?:(anchor:Stage1Snapshot)=>Promise<LinkedBranch>;fallbackFull?:boolean;addressIndex?:boolean;concurrency?:number;maxSlots?:number;maxTransactions?:number}
export class FootprintFlowConnector extends FinalizedFlowConnector{
 private readonly pending=new Map<string,Promise<ProviderInterval|null>>();
 private readonly indexedReceipts=new Map<string,Receipt>();
 constructor(rpc:ReadOnlyRpc,archive:FinalizedBankArchive,now:()=>number=Date.now,readonly footprintOptions:FootprintOptions={}){
  super(rpc,archive,now,{...(footprintOptions.maxSlots!==undefined?{maxSlots:footprintOptions.maxSlots}:{}),...(footprintOptions.maxTransactions!==undefined?{maxTransactions:footprintOptions.maxTransactions}:{}),blockConcurrency:footprintOptions.concurrency??8});
 }
 override async interval(anchor:Stage1Snapshot,end?:Stage1Snapshot){
  if(!this.footprintOptions.loadBranch)fail('PERSISTED_BRANCH_LOADER_REQUIRED');
  return this.intervalForBranch(await this.footprintOptions.loadBranch!(anchor),end);
 }
 async intervalForBranch(branch:LinkedBranch,end?:Stage1Snapshot):Promise<ProviderInterval|null>{
  const anchor=branch.real,after=end??await this.observe(anchor);
  if(topology(anchor)!==topology(after))fail('DEPENDENCY_TOPOLOGY_CHANGED');
  if(after.slot===anchor.slot){if(digest({...after,observedAt:''})!==digest({...anchor,observedAt:''}))fail('SAME_SLOT_CHANGED');return null}
  if(after.slot<anchor.slot||after.slot-anchor.slot>this.maxSlots)fail('SLOT_BOUND');
  const id='interval-footprint-v1-'+impact(branch)+'-'+digest(after);let pending=this.pending.get(id);
  if(!pending){pending=this.acquire(branch,after,id);this.pending.set(id,pending)}
  try{return await pending}finally{if(this.pending.get(id)===pending)this.pending.delete(id)}
 }
 /** Independent durable acquisition coverage. Never asserts market eligibility or changes a liquidity head. */
 async captureCoverage(before:Stage1Snapshot,after:Stage1Snapshot){
  if(topology(before)!==topology(after)||after.slot<=before.slot||after.slot-before.slot>this.maxSlots)fail('COVERAGE_BOUND');
  const anchor=await this.header(before.slot),result=await this.captureSlotCoverage({slot:before.slot,blockhash:anchor.blockhash,blockTime:verifiedClock(before.accounts[CLOCK_ACCOUNT]!,before.slot).seconds},after.slot);
  if(result.manifests.at(-1)!.blockTime!==verifiedClock(after.accounts[CLOCK_ACCOUNT]!,after.slot).seconds)fail('BANK_TIME');
  return result;
 }
 /** Complete transaction coverage is not a market snapshot or a reconciled-liquidity checkpoint. */
 async captureSlotCoverage(before:{slot:number;blockhash:string;blockTime:number},to:number){
  if(!Number.isSafeInteger(to)||!Number.isSafeInteger(before.slot)||to<=before.slot||to-before.slot>this.maxSlots)fail('COVERAGE_BOUND');
  const slots=await this.rpc.call<number[]>('getBlocks',[before.slot+1,to,{commitment:'finalized'}]);
  if(!Array.isArray(slots)||slots.length>this.maxSlots||slots.at(-1)!==to||slots.some((s,i)=>!Number.isSafeInteger(s)||s<=before.slot||s>to||(i>0&&s<=slots[i-1]!)))fail('INCOMPLETE_SLOTS');
  const anchor=await this.header(before.slot);
  if(anchor.blockhash!==before.blockhash||anchor.blockTime!==before.blockTime)fail('ANCHOR_HEADER');
  const manifests=await parallel(slots,this.blockConcurrency,s=>this.manifest(s));
  let parent=before.slot,hash=anchor.blockhash,time=before.blockTime,total=0;
  for(const f of manifests){validateFootprint(f);if(f.parentSlot!==parent||f.previousBlockhash!==hash||f.blockTime<time)fail('FRONTIER_GAP');parent=f.slot;hash=f.blockhash;time=f.blockTime;total+=f.rows.length}
  if(total>this.maxTransactions)fail('TRANSACTION_BOUND');
  const complete={schema:'FINALIZED_FOOTPRINT_RANGE_V1',from:before.slot,to,anchor:anchor.blockhash,slots,manifests:manifests.map(f=>({slot:f.slot,hash:digest(f)}))};
  await this.archive.put('coverage-range-'+digest({from:before.slot,to,anchor:anchor.blockhash}),complete);
  return{slots,anchor,manifests,total};
 }
 private async acquire(branch:LinkedBranch,after:Stage1Snapshot,id:string){
  const before=branch.real,cached=await this.archive.get<ProviderInterval>(id);if(cached){
   await reconcileLinkedInterval(branch,cached,Date.parse(after.observedAt),10000);
   await this.archive.put('coverage-complete-'+digest(id),{schema:'FINALIZED_COVERAGE_COMPLETE_V1',from:before.slot,to:after.slot,branchHash:impact(branch),intervalHash:digest(cached),intervalKey:id});
   return cached;
  }
  const started=performance.now();let retainedCoverage:FootprintBlock[]=[];
  try{
   const {slots,anchor,manifests,total}=await this.captureCoverage(before,after);
   retainedCoverage=manifests;
   if(this.footprintOptions.addressIndex)await this.prefetchAddressIndex(branch,after,manifests);
   const base:ProviderInterval={schema:'LINKED_RETAINED_RPC_INTERVAL_V1',commitment:'finalized',acquiredAt:new Date(this.now()).toISOString(),before,after,slots,anchor:{blockhash:anchor.blockhash},blocks:[]};
   let witness:Witnesses={};
   const packet=await assembleFootprintInterval(branch,base,manifests,(f,i)=>this.receipt(f,i),async p=>{
    const required=requiredTokenFeeMints(before,p.blocks),existing=new Set(Object.keys(witness.token2022?.mints??{}));
    if(!witness.epochWitness||required.some(m=>!existing.has(m)))witness=await this.witnesses(p,required);
    return witness;
   },this.blockConcurrency);
   // Publication is the completion marker. Partial files/gap records never advance a market checkpoint.
   await this.archive.put(id,packet);
   await this.archive.put('coverage-complete-'+digest(id),{schema:'FINALIZED_COVERAGE_COMPLETE_V1',from:before.slot,to:after.slot,branchHash:impact(branch),intervalHash:digest(packet),intervalKey:id});
   performance.measure('linked.footprint.acquire',{start:started,detail:{from:before.slot,to:after.slot,totalTransactions:total,fullReceipts:packet.blocks.reduce((n,b)=>n+b.result.transactions.length,0)}});performance.clearMeasures('linked.footprint.acquire');
   return packet;
  }catch(error){
   const missing=/^MULTI_HOP_DEPENDENCY_MISSING:([1-9A-HJ-NP-Za-km-z]+)$/.exec((error as Error).message);
   if(missing){
    const pool=missing[1]!,receipts=retainedCoverage.flatMap(f=>f.rows.flatMap((r,index)=>!r.failed&&r.accounts.some(k=>f.keys[k]===pool)?[{slot:f.slot,index,signature:r.signatures[0]}]:[]));
    // An exact historical-state request, not permission to substitute today's account bytes.
    await this.archive.put('backfill-required-'+digest({id,pool}),{schema:'FINALIZED_DEPENDENCY_BACKFILL_REQUIRED_V1',pool,from:before.slot,to:after.slot,beforeBankHash:digest(before),afterBankHash:digest(after),branchHash:impact(branch),receipts,required:'Verified pre-interval pool/dependency state and complete ordered changes through the end bank',complete:false,checkpointEligible:false});
   }
   await this.archive.put('coverage-gap-'+digest({id,reason:String((error as Error).message)}),{schema:'FINALIZED_COVERAGE_GAP_V1',from:before.slot,to:after.slot,branchHash:impact(branch),reason:(error as Error).message,...((error as Error).cause?{detail:(error as Error).cause}:{}),complete:false});
   if(this.footprintOptions.fallbackFull){const full=await super.interval(before,after);if(full)await reconcileLinkedInterval(branch,full,Date.parse(after.observedAt),10000);return full}
   throw error;
  }
 }
 private async header(slot:number){
  const key='coverage-header-'+slot,old=await this.archive.get<any>(key);if(old)return old;
  const h=await this.rpc.call<any>('getBlock',[slot,{commitment:'finalized',transactionDetails:'signatures',rewards:false,maxSupportedTransactionVersion:1}]);
  if(!h||!Array.isArray(h.signatures)||!h.blockhash||!Number.isSafeInteger(h.blockTime))fail('HEADER_UNAVAILABLE');await this.archive.put(key,h);return h;
 }
 private async manifest(slot:number){
  const key='footprint-effects-v1-'+slot,old=await this.archive.get<FootprintBlock>(key);if(old){validateFootprint(old);return old}
  const [block,header]=await Promise.all([this.rpc.call<any>('getBlock',[slot,{commitment:'finalized',encoding:'json',transactionDetails:'accounts',rewards:false,maxSupportedTransactionVersion:1}]),this.header(slot)]);
  const f=footprintFromRpc(slot,block,header);validateFootprint(f);await this.archive.put(key,f);return f;
 }
 private async receipt(f:FootprintBlock,index:number){
  const signature=f.rows[index]!.signatures[0]!,key='receipt-'+digest({slot:f.slot,index,signature}),indexed=this.indexedReceipts.get(key);
  if(indexed){bindReceipt(f,index,indexed);return indexed}
  const old=await this.archive.get<Receipt>(key);if(old){bindReceipt(f,index,old);return old}
  const t=await this.rpc.call<any>('getTransaction',[signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:1}]);
  if(!t||t.slot!==f.slot||t.transactionIndex!==undefined&&t.transactionIndex!==index||t.blockTime!==f.blockTime)fail('RECEIPT_CONTEXT');
  const body:Receipt={transaction:t.transaction,meta:t.meta,version:t.version};bindReceipt(f,index,body);await this.archive.put(key,body);return body;
 }
 private async prefetchAddressIndex(branch:LinkedBranch,after:Stage1Snapshot,manifests:FootprintBlock[]){
  // This index is an optimization only: complete block footprints remain the authority.
  // Missing/paginated/lagging results fall back to exact getTransaction, never to an empty effect.
  const before=branch.real,roots=footprintRoots(branch);
  const pools=[...new Set([...linkedBindings(before).flatMap(r=>[r.targetPool,r.bridgePool]),...Object.entries(before.accounts).filter(([,a])=>[
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA','6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'].includes(a.owner)&&[166,287,300,301].includes(Buffer.from(a.base64,'base64').length)).map(([a])=>a)])];
  const lookup=new Map(manifests.flatMap(f=>f.rows.map((r,i)=>[r.signatures[0]!,{f,i}] as const)));
  await parallel(pools,Math.min(4,this.blockConcurrency),async address=>{
   let cursor:string|undefined;const cursors=new Set<string>();
   for(let page=0;page<8;page++){
    const pageKey='address-page-'+digest({address,from:before.slot,to:after.slot,cursor:cursor??null,status:'succeeded'});
    let response:any=await this.archive.get(pageKey);
    if(!response){try{response=await this.rpc.call('getTransactionsForAddress',[address,{transactionDetails:'full',commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:1,sortOrder:'asc',limit:1000,...(cursor?{paginationToken:cursor}:{}),filters:{slot:{gt:before.slot,lte:after.slot},status:'succeeded',tokenAccounts:'none'}}])}catch{return}
      if(!Array.isArray(response?.data))return;await this.archive.put(pageKey,response);
    }
    if(!Array.isArray(response?.data))return;
    for(const t of response.data){const match=lookup.get(t.transaction?.signatures?.[0]);if(!match||t.slot!==match.f.slot)continue;
      if(t.transactionIndex!==undefined&&t.transactionIndex!==match.i)fail('ADDRESS_INDEX_CONTEXT');
      if(!needsReceipt(match.f,match.f.rows[match.i]!,roots,branch.inventoryDeltas,branch.nativeReserves))continue;
      const body:Receipt={transaction:t.transaction,meta:t.meta,version:t.version};bindReceipt(match.f,match.i,body);
      this.indexedReceipts.set('receipt-'+digest({slot:match.f.slot,index:match.i,signature:body.transaction.signatures[0]}),body);
      if(this.indexedReceipts.size>5000)this.indexedReceipts.delete(this.indexedReceipts.keys().next().value!);
    }
    if(!response.data.length||!response.paginationToken)return;
    if(cursors.has(response.paginationToken))return;cursors.add(response.paginationToken);cursor=response.paginationToken;
   }
  });
 }
 private async witnesses(p:ProviderInterval,mints:string[]):Promise<Witnesses>{
  if(mints.length>98)fail('WITNESS_DEPENDENCY_BOUND');
  for(let attempt=0;attempt<3;attempt++){
   const addresses=[...mints,CLOCK_ACCOUNT,EPOCH_SCHEDULE_ACCOUNT],r=await this.rpc.call<any>('getMultipleAccounts',[addresses,{commitment:'finalized',encoding:'base64',minContextSlot:p.after.slot}]);
   if(!Number.isSafeInteger(r?.context?.slot)||r.context.slot<p.after.slot||r.value?.length!==addresses.length||r.value.some((a:any)=>!a||a.data?.[1]!=='base64'))fail('WITNESS_SHAPE');
   const account=(i:number)=>({owner:r.value[i].owner,base64:r.value[i].data[0]});
   const epochWitness:EpochWitness={schema:'FINALIZED_EPOCH_SCHEDULE_V1',contextSlot:r.context.slot,clock:account(mints.length),schedule:account(mints.length+1)};
   try{epochProgression(p.before,p.after,p.blocks,epochWitness)}catch(e){if(attempt<2&&String(e).includes('EPOCH_CLOCK_CONTEXT'))continue;throw e}
   const token2022:Token2022Evidence|undefined=mints.length?{schema:'TOKEN_2022_FEE_SCHEDULE_WITNESS_V1',contextSlot:r.context.slot,clock:epochWitness.clock,mints:Object.fromEntries(mints.map((m,i)=>[m,account(i)]))}:undefined;
   feePolicies(token2022,p.before,p.after,p.blocks,epochWitness);
   return{epochWitness,...(token2022?{token2022}:{})};
  }
  return fail('COHERENT_WITNESS_UNAVAILABLE');
 }
}
