/** Native read-only preparation; never initializes liquidity or submits a transaction. */
import {readFile,writeFile,link,unlink,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {linkedBindings,linkedRoute,type LinkedBinding} from '../../../../../packages/protocols/isolated/linked-pair/shared-bridge.js';
import {transitionLinkedSnapshot} from '../../../../../packages/protocols/isolated/linked-pair/native-transition.js';
import type {Stage1Snapshot} from '../../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
import type {FinalizedFlowConnector} from '../finalized-connector.js';
export interface CaptureScope {schema:'PAPERFUND_NATIVE_CAPTURE_V1';approvalReference:string;mints:string[];routes:LinkedBinding[];notBefore:string;expiresAt:string;maxRpcCalls:number;maxSlots:number;maxTransactions:number;}
const check:(v:unknown,m:string)=>asserts v=(v,m)=>{if(!v)throw Error('MIXED_CAPTURE_'+m);};
export function canonical(v:unknown):string {
 if(typeof v==='bigint')return JSON.stringify(v.toString());
 if(v===null||typeof v!=='object')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 return '{'+Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';
}
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const key=(r:LinkedBinding)=>canonical({mint:r.mint,quoteMint:r.quoteMint,targetPool:r.targetPool,bridgePool:r.bridgePool});
export function validateCaptureScope(s:CaptureScope,now=Date.now()) {
 check(s?.schema==='PAPERFUND_NATIVE_CAPTURE_V1'&&typeof s.approvalReference==='string'&&!!s.approvalReference,'APPROVAL');
 check(Number.isFinite(Date.parse(s.notBefore))&&now>=Date.parse(s.notBefore)&&Number.isFinite(Date.parse(s.expiresAt))&&now<Date.parse(s.expiresAt),'TIME');
 check(Array.isArray(s.mints)&&s.mints.length>0&&new Set(s.mints).size===s.mints.length,'MINTS');
 check(Array.isArray(s.routes)&&s.routes.length>0&&new Set(s.routes.map(key)).size===s.routes.length,'ROUTES');
 check(s.routes.every(r=>[r.mint,r.quoteMint,r.targetPool,r.bridgePool].every(x=>typeof x==='string'&&x.length>0)&&s.mints.includes(r.mint))&&s.mints.every(m=>s.routes.some(r=>r.mint===m)),'EXACT_MINT_SCOPE');
 for(const [n,max]of [[s.maxRpcCalls,20000],[s.maxSlots,2048],[s.maxTransactions,200000]])check(Number.isSafeInteger(n)&&n!>0&&n!<=max!,'BOUNDS');
 check(!('mode'in s)&&!('authorizePaperBuy'in s),'NO_ENTRY');return s;
}
export async function captureApprovedBank(seed:Stage1Snapshot,scope:CaptureScope,connector:Pick<FinalizedFlowConnector,'observe'>,now=Date.now) {
 validateCaptureScope(scope,now());
 const exact=(bank:Stage1Snapshot)=>{const bindings=linkedBindings(bank);check(bindings.length>0&&canonical(bindings.map(key).sort())===canonical(scope.routes.map(key).sort()),'EXACT_ROUTE_SCOPE');check(Object.keys(bank.accounts).length+bank.absentAccounts.length<=100,'DEPENDENCY_LIMIT');};
 exact(seed);const bank=await connector.observe(seed);exact(bank);const quotes=[];
 for(const r of scope.routes){
  const snapshot=linkedRoute(bank,r.mint,r.bridgePool),policy={nowMs:now(),maxAgeMs:10000};
  const buy=await transitionLinkedSnapshot(snapshot,10000000n,true,policy);check(buy.quote.output>=4n,'BUY_OUTPUT');
  const reverse=await transitionLinkedSnapshot(buy.next,buy.quote.output,false,policy),partial=await transitionLinkedSnapshot(buy.next,buy.quote.output/4n,false,policy),full=await transitionLinkedSnapshot(partial.next,buy.quote.output-buy.quote.output/4n,false,policy);
  check([reverse,partial,full].every(q=>q.quote.output>0n),'EXIT_OUTPUT');
  quotes.push({route:r,buy:{quote:buy.quote,receipt:buy.receipt},reverse:{quote:reverse.quote,receipt:reverse.receipt},partial:{quote:partial.quote,receipt:partial.receipt},fullResidual:{quote:full.quote,receipt:full.receipt}});
 }
 validateCaptureScope(scope,now());check(now()>=Date.parse(bank.observedAt)&&now()-Date.parse(bank.observedAt)<=10000,'STALE');
 return JSON.parse(canonical({schema:'PAPERFUND_NATIVE_CAPTURE_RESULT_V1',bank,bankSHA256:createHash('sha256').update(canonical(bank)+'\n').digest('hex'),scopeHash:hash(scope),quotes,prospectiveSimulationOnly:true,mainnetMixedTransitionQualified:false}));
}
/** No-replace publication; receipt is the commit marker. Identical interrupted publications recover. */
export async function publishCapture(bankFile:string,receiptFile:string,result:Awaited<ReturnType<typeof captureApprovedBank>>) {
 check(dirname(bankFile)===dirname(receiptFile)&&bankFile!==receiptFile,'OUTPUT_PATHS');await mkdir(dirname(bankFile),{recursive:true});
 async function put(file:string,bytes:string){const temp=file+'.'+randomUUID()+'.pending';await writeFile(temp,bytes,{flag:'wx',mode:0o600});try{await link(temp,file)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(file,'utf8')!==bytes)throw e}finally{await unlink(temp)}}
 await put(bankFile,canonical(result.bank)+'\n');await put(receiptFile,canonical({...result,bank:undefined,bankFile})+'\n');
}
