import fs from 'node:fs';import path from 'node:path';
import {Transaction} from '@solana/web3.js';
import {encode58} from './key-public.mjs';
import {GENESIS,WALLET,vault,digest,validateTransaction,verifyFinalized} from './claim-core.mjs';
export const RECOVERY_METHODS=new Set(['getGenesisHash','getBlockHeight','getMultipleAccounts','getSignatureStatuses','getTransaction']);
export function safeClaimError(error){const m=error?.message??'';if(/^(CLAIM|KEY)_[A-Z0-9_]+(?::[a-zA-Z0-9_:-]+)?$/.test(m))return m;return /^E[A-Z]+$/.test(error?.code??'')?'CLAIM_LOCAL_IO_'+error.code:'CLAIM_INTERNAL_RUNTIME_FAILED';}
function inventory(root){if(!fs.existsSync(root))return [];return fs.readdirSync(root).filter(name=>fs.statSync(path.join(root,name)).isFile()).sort().map(name=>{const data=fs.readFileSync(path.join(root,name));return {file:name,bytes:data.length,sha256:digest(data)};});}
export async function recoverClaimState(root,provider,{verifyReceipt=verifyFinalized}={}){
 const before=inventory(root),rpc=async(method,params=[])=>{if(!RECOVERY_METHODS.has(method))throw Error('CLAIM_RECOVERY_READ_ONLY');return provider(method,params);};
 if(await rpc('getGenesisHash')!==GENESIS)throw Error('CLAIM_GENESIS_MISMATCH');
 const records=[];
 for(const info of before.filter(i=>i.file.endsWith('.json')||i.file.includes('.pending-'))){
  let state;try{state=JSON.parse(fs.readFileSync(path.join(root,info.file),'utf8'));}catch{records.push({...info,status:'JOURNAL_PARSE_ERROR_PRESERVED',signature:null});continue;}
  const item={...info,journalState:state.state,reviewSha256:state.reviewHash??null,messageSha256:state.messageSha256??state.review?.messageSha256??null,signature:state.signature??null,hasSignedBytes:typeof state.signedTransactionBase64==='string',signedBytesVerified:false};
  if(!state.review||!state.signature){records.push({...item,status:state.state==='RESERVED_BEFORE_SIGNING'?'RESERVED_NO_DURABLE_SIGNATURE':'INCOMPLETE_JOURNAL_PRESERVED',broadcastThroughThisPipeline:false});continue;}
  try{
   validateTransaction(state.review);
   if(state.reviewHash!==digest(JSON.stringify(state.review)))throw Error('CLAIM_JOURNAL_REVIEW_HASH_MISMATCH');
   if(item.hasSignedBytes){const tx=Transaction.from(Buffer.from(state.signedTransactionBase64,'base64'));if(!tx.verifySignatures()||encode58(tx.signature)!==state.signature||digest(tx.serializeMessage())!==state.review.messageSha256)throw Error('CLAIM_SIGNED_ARTIFACT_MISMATCH');item.signedBytesVerified=true;}
   const statuses=await rpc('getSignatureStatuses',[[state.signature],{searchTransactionHistory:true}]),status=statuses.value?.[0];
   if(!status){const height=await rpc('getBlockHeight',[{commitment:'finalized'}]);records.push({...item,status:height>state.review.lastValidBlockHeight?'SIGNED_EXPIRED_NOT_FOUND_UNCERTAIN':'SIGNED_STATUS_NOT_FOUND_UNCERTAIN',finalized:false});continue;}
   if(status.err){records.push({...item,status:status.confirmationStatus==='finalized'?'FAILED_FINALIZED':'FAILED_NOT_FINALIZED',chainError:status.err,slot:status.slot,finalized:status.confirmationStatus==='finalized',broadcastObserved:true});continue;}
   if(status.confirmationStatus!=='finalized'){records.push({...item,status:'BROADCAST_PENDING_FINALITY',slot:status.slot,finalized:false,broadcastObserved:true});continue;}
   const transaction=await rpc('getTransaction',[state.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
   if(!transaction){records.push({...item,status:'FINALIZED_TRANSACTION_UNAVAILABLE',finalized:true,broadcastObserved:true});continue;}
   try{const receipt=verifyReceipt(state.review,state.signature,transaction);records.push({...item,status:'FINALIZED_VERIFIED',finalized:true,broadcastObserved:true,receipt});}catch(e){records.push({...item,status:'FINALIZED_REVIEW_REQUIRED',finalized:true,broadcastObserved:true,error:safeClaimError(e)});}
  }catch(e){records.push({...item,status:'RECOVERY_REVIEW_REQUIRED',error:safeClaimError(e)});}
 }
 const accounts=await rpc('getMultipleAccounts',[[WALLET,vault],{commitment:'finalized',encoding:'base64'}]);
 const after=inventory(root);if(JSON.stringify(before)!==JSON.stringify(after))throw Error('CLAIM_JOURNAL_CHANGED_DURING_READ_ONLY_RECOVERY');
 return {mode:'Reconcile',readOnly:true,keyUnlocked:false,approvalRequired:false,signingPerformed:false,broadcast:false,originalJournalAndLockUnchanged:true,lockPresent:before.some(i=>i.file==='execution.lock'),status:records.length?'EXISTING_EXECUTION_INSPECTED':'NO_PERSISTED_EXECUTION',records,finalizedBalances:{slot:accounts.context.slot,walletLamports:accounts.value?.[0]?.lamports??null,vaultLamports:accounts.value?.[1]?.lamports??null},checkedAt:new Date().toISOString()};
}
