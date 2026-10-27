/** Complete finalized RPC account footprints. Projection admission, never execution math. */
import type {LinkedBranch, ProviderInterval, Receipt} from './external-flow.js';
import {createHash} from 'node:crypto';
export interface FootprintRow {signatures:string[]; accounts:number[]; writable:number[]; failed:boolean; version:number|'legacy';effectsHash:string}
export interface FootprintBlock {
  slot:number; parentSlot:number; previousBlockhash:string; blockhash:string; blockTime:number;
  keys:string[]; rows:FootprintRow[];
  /** Independent finalized signatures-mode response, retained rather than a caller-supplied count. */
  signatureHeader:{parentSlot:number;previousBlockhash:string;blockhash:string;blockTime:number;signatures:string[]};
  selected:number[];
}
export interface FootprintCoverage {schema:'FINALIZED_DEPENDENCY_FOOTPRINT_V1';blocks:FootprintBlock[]}
export class FootprintReceiptRequired extends Error {
  constructor(readonly slot:number,readonly index:number,readonly signature:string){super(`FOOTPRINT_RECEIPT_REQUIRED:${slot}:${index}:${signature}`)}
}
const fail=(m:string):never=>{throw Error('FOOTPRINT_'+m)};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function receiptEffectsHash(meta:any){
 const balances=(v:any[])=>v?.map(b=>[b.accountIndex,b.mint,b.owner??null,b.programId??null,b.uiTokenAmount?.amount,b.uiTokenAmount?.decimals]);
 return createHash('sha256').update(JSON.stringify([meta.err,meta.fee,meta.preBalances,meta.postBalances,balances(meta.preTokenBalances),balances(meta.postTokenBalances)])).digest('hex');
}
export function receiptKeys(t:Receipt){return[...t.transaction.message.accountKeys,...(t.meta.loadedAddresses?.writable??[]),...(t.meta.loadedAddresses?.readonly??[])]}
export function receiptWrites(t:Receipt):number[]{
  const message=t.transaction.message as typeof t.transaction.message&{header?:{numRequiredSignatures:number;numReadonlySignedAccounts:number;numReadonlyUnsignedAccounts:number}};
  const h=message.header,n=message.accountKeys.length;
  if(!h||![h.numRequiredSignatures,h.numReadonlySignedAccounts,h.numReadonlyUnsignedAccounts].every(Number.isSafeInteger)||
    h.numRequiredSignatures<0||h.numRequiredSignatures>n||h.numReadonlySignedAccounts<0||h.numReadonlySignedAccounts>h.numRequiredSignatures||h.numReadonlyUnsignedAccounts<0||h.numReadonlyUnsignedAccounts>n-h.numRequiredSignatures)fail('MESSAGE_HEADER');
  const signed=h!.numRequiredSignatures,staticWrites=Array.from({length:n},(_,i)=>i).filter(i=>i<signed?i<signed-h!.numReadonlySignedAccounts:i<n-h!.numReadonlyUnsignedAccounts);
  const keys=receiptKeys(t),loader=keys.includes('BPFLoaderUpgradeab1e11111111111111111111111'),
    called=new Set(t.transaction.message.instructions.map(ix=>ix.programIdIndex));
  const reserved=new Set(['11111111111111111111111111111111','SysvarC1ock11111111111111111111111111111111','SysvarRent111111111111111111111111111111111','SysvarEpochSchedu1e111111111111111111111111']);
  return [...staticWrites,...(t.meta.loadedAddresses?.writable??[]).map((_,i)=>n+i)].filter(i=>{
    // Runtime write-lock demotion is distinct from the transaction's requested header flags.
    // Other dynamic reserved-key changes still reject rather than assuming an epoch feature set.
    if(!reserved.has(keys[i]!)&&(!called.has(i)||loader))return true;
    if(t.meta.preBalances?.[i]===undefined||t.meta.postBalances?.[i]!==t.meta.preBalances[i])fail('DEMOTED_ACCOUNT_EFFECTS');
    return false;
  });
}
export function footprintFromFull(slot:number,result:ProviderInterval['blocks'][number]['result']):FootprintBlock{
 const keys:string[]=[],ids=new Map<string,number>();
 const rows=result.transactions.map(t=>{const accounts=receiptKeys(t).map(k=>{if(!ids.has(k)){ids.set(k,keys.length);keys.push(k)}return ids.get(k)!});
   return{signatures:[...t.transaction.signatures],accounts,writable:receiptWrites(t),failed:t.meta.err!==null,version:t.version,effectsHash:receiptEffectsHash(t.meta)}});
 return{slot,parentSlot:result.parentSlot,previousBlockhash:result.previousBlockhash,blockhash:result.blockhash,blockTime:result.blockTime,keys,rows,
  signatureHeader:{parentSlot:result.parentSlot,previousBlockhash:result.previousBlockhash,blockhash:result.blockhash,blockTime:result.blockTime,signatures:rows.map(r=>r.signatures[0]!)},selected:[]};
}
export function footprintFromRpc(slot:number,block:any,signatureHeader:any):FootprintBlock{
 if(!Array.isArray(block?.transactions)||!Array.isArray(signatureHeader?.signatures))fail('RPC_SHAPE');
 const keys:string[]=[],ids=new Map<string,number>();
 const rows:FootprintRow[]=block.transactions.map((t:any)=>{
  if(!Array.isArray(t.transaction?.accountKeys)||!Array.isArray(t.transaction?.signatures)||!t.meta||!('err'in t.meta))fail('RPC_RECEIPT');
  const writable:number[]=[];
  const accounts=t.transaction.accountKeys.map((a:any,i:number)=>{if(typeof a?.pubkey!=='string'||typeof a.writable!=='boolean')fail('RPC_KEYS');if(a.writable)writable.push(i);if(!ids.has(a.pubkey)){ids.set(a.pubkey,keys.length);keys.push(a.pubkey)}return ids.get(a.pubkey)!});
  return{signatures:t.transaction.signatures,accounts,writable,failed:t.meta.err!==null,version:t.version,effectsHash:receiptEffectsHash(t.meta)};
 });
 return{slot,parentSlot:block.parentSlot,previousBlockhash:block.previousBlockhash,blockhash:block.blockhash,blockTime:block.blockTime,keys,rows,
  signatureHeader:{parentSlot:signatureHeader.parentSlot,previousBlockhash:signatureHeader.previousBlockhash,blockhash:signatureHeader.blockhash,blockTime:signatureHeader.blockTime,signatures:signatureHeader.signatures},selected:[]};
}
export function validateFootprint(f:FootprintBlock){
 if(!f||!Number.isSafeInteger(f.slot)||!Number.isSafeInteger(f.parentSlot)||!Number.isSafeInteger(f.blockTime)||f.slot<=f.parentSlot||!f.blockhash||!f.previousBlockhash||!Array.isArray(f.rows)||!Array.isArray(f.keys)||new Set(f.keys).size!==f.keys.length||f.keys.some(k=>typeof k!=='string'||!k))fail('BLOCK_SHAPE');
 for(const k of['parentSlot','previousBlockhash','blockhash','blockTime']as const)if(f[k]!==f.signatureHeader?.[k])fail('SIGNATURE_HEADER');
 if(!Array.isArray(f.signatureHeader.signatures)||f.rows.length!==f.signatureHeader.signatures.length)fail('TRANSACTION_COUNT');
 for(const [i,r]of f.rows.entries()){
  if(!Array.isArray(r.signatures)||!r.signatures.length||r.signatures.some(s=>typeof s!=='string'||!s)||r.signatures[0]!==f.signatureHeader.signatures[i]||
    ![0,1,'legacy'].includes(r.version)||typeof r.failed!=='boolean'||!/^[a-f0-9]{64}$/.test(r.effectsHash)||!Array.isArray(r.accounts)||!r.accounts.length||r.accounts.some(n=>!Number.isSafeInteger(n)||n<0||n>=f.keys.length)||
    !Array.isArray(r.writable)||r.writable.some(n=>!Number.isSafeInteger(n)||n<0||n>=r.accounts.length)||new Set(r.writable).size!==r.writable.length)fail('ROW');
 }
 if(new Set(f.signatureHeader.signatures).size!==f.rows.length)fail('DUPLICATE_SIGNATURE');
 if(!Array.isArray(f.selected)||f.selected.some((n,i)=>!Number.isSafeInteger(n)||n<0||n>=f.rows.length||(i>0&&n<=f.selected[i-1]!)))fail('SELECTED_INDICES');
}
export function bindReceipt(f:FootprintBlock,index:number,t:Receipt){
 const r=f.rows[index],reasons:string[]=[];
 if(!r)return fail('RECEIPT_INDEX');
 if(!same(r.signatures,t.transaction.signatures))reasons.push('signature');if(r.version!==t.version)reasons.push('version');
 if(r.failed!==(t.meta.err!==null))reasons.push('status');if(!same(r.accounts.map(i=>f.keys[i]!),receiptKeys(t)))reasons.push('keys');
 if(!same(r.writable,receiptWrites(t)))reasons.push('writable');if(r.effectsHash!==receiptEffectsHash(t.meta))reasons.push('effects');
 if(reasons.length)throw new Error('FOOTPRINT_RECEIPT_BINDING',{cause:{slot:f.slot,index,signature:r.signatures[0],reasons,reportedWrites:r.writable,messageWrites:receiptWrites(t)}});
}
const IMMUTABLE_SYSVARS=new Set(['SysvarC1ock11111111111111111111111111111111','SysvarRent111111111111111111111111111111111','SysvarEpochSchedu1e111111111111111111111111']);
export function footprintRoots(branch:LinkedBranch,policies:string[]=[]){return new Set([...Object.keys(branch.real.accounts),...Object.keys(branch.simulated.accounts),...branch.real.absentAccounts,...policies].filter(a=>!IMMUTABLE_SYSVARS.has(a)))}
export function needsReceipt(f:FootprintBlock,r:FootprintRow,roots:ReadonlySet<string>,deltas:Record<string,string>,nativeReserves:Record<string,string>={}){
 if(r.failed)return false; // The unchanged native engine ignores failed effects, including their already-observed fees.
 const keys=r.accounts.map(i=>f.keys[i]!);
 if(r.writable.some(i=>roots.has(keys[i]!)))return true;
 return keys.some(a=>BigInt(deltas[a]??'0')!==0n||BigInt(deltas['lamports:'+a]??'0')!==0n||BigInt(deltas['withheld:'+a]??'0')!==0n||a in nativeReserves);
}
export function prepareFootprintReplay(branch:LinkedBranch,e:ProviderInterval,policyMints:string[]){
 if(e.schema==='LINKED_RETAINED_RPC_INTERVAL_V1'){
  if(e.coverage)fail('UNVERSIONED_PROJECTION');return null;
 }
 const c=e.coverage;
 if(e.schema!=='LINKED_RETAINED_RPC_INTERVAL_V2'||c?.schema!=='FINALIZED_DEPENDENCY_FOOTPRINT_V1'||c.blocks.length!==e.blocks.length)fail('COVERAGE_REQUIRED');
 const roots=footprintRoots(branch,policyMints),seen=new Set<string>();
 return c!.blocks.map((f,bi)=>{
  validateFootprint(f);const b=e.blocks[bi]!;
  if(f.slot!==b.slot||f.selected.length!==b.result.transactions.length)fail('SELECTED_COUNT');
  for(const k of['parentSlot','previousBlockhash','blockhash','blockTime']as const)if(f[k]!==b.result[k])fail('BLOCK_BINDING');
  const bodies=new Map<number,Receipt>();
  f.selected.forEach((i,j)=>{const t=b.result.transactions[j]!;bindReceipt(f,i,t);bodies.set(i,t)});
  return f.rows.map((r,index)=>{
   const signature=r.signatures[0]!;if(seen.has(signature))fail('DUPLICATE_SIGNATURE');seen.add(signature);
   return{receipt:bodies.get(index),signature,failed:r.failed,assertOmission(deltas:Record<string,string>,reserves:Record<string,string>){
    if(needsReceipt(f,r,roots,deltas,reserves))throw new FootprintReceiptRequired(f.slot,index,signature);
   }};
  });
 });
}
