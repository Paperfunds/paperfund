import {finalizedClaimAllocations} from './claim-allocation.mjs';
import {recoverClaimState,safeClaimError,RECOVERY_METHODS} from './claim-recovery.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createPrivateKey,sign as edSign} from 'node:crypto';
import {Transaction} from '@solana/web3.js';
import {derivePublic,decode58,encode58} from './key-public.mjs';
import {validateTransaction,assertExecutionPermit,digest,WALLET,GENESIS,vault} from './claim-core.mjs';
export function keyHandle(raw,expected=WALLET){
 if(derivePublic(raw)!==expected)throw Error('CLAIM_DPAPI_WALLET_MISMATCH');
 let b=raw.trim().startsWith('[')?Buffer.from(JSON.parse(raw.trim())):decode58(raw.trim());
 const der=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),b.subarray(0,32)]);
 try{const key=createPrivateKey({key:der,format:'der',type:'pkcs8'});return {publicKey:expected,signTransaction(unsigned){const tx=Transaction.from(unsigned);tx.addSignature(tx.feePayer,edSign(null,tx.serializeMessage(),key));return {signedTransaction:tx.serialize(),signature:encode58(tx.signature)};}};}finally{b.fill(0);der.fill(0);}
}
export async function executeClaim({review,permit,handle,rpc,journal,now=Date.now()}){
 const reviewHash=assertExecutionPermit(review,permit,now);
 if(handle.publicKey!==WALLET)throw Error('CLAIM_SIGNER_IDENTITY_MISMATCH');
 if(await rpc('getGenesisHash',[])!==GENESIS)throw Error('CLAIM_GENESIS_MISMATCH');
 const height=await rpc('getBlockHeight',[{commitment:'finalized'}]);
 if(height>review.lastValidBlockHeight-5)throw Error('CLAIM_BLOCKHASH_EXPIRED_OR_NEAR_EXPIRY');
 const balances=await rpc('getMultipleAccounts',[[WALLET,vault],{commitment:'finalized',encoding:'base64',minContextSlot:review.simulation.slot}]);
 const [walletAccount,vaultAccount]=balances.value;
 if(!walletAccount||walletAccount.owner!=='11111111111111111111111111111111'||!vaultAccount||vaultAccount.owner!=='11111111111111111111111111111111'||!Number.isSafeInteger(walletAccount.lamports)||!Number.isSafeInteger(vaultAccount.lamports)||BigInt(walletAccount.lamports)<BigInt(review.maximumFeeLamports)||BigInt(vaultAccount.lamports)!==BigInt(review.finalizedObservation.vaultLamports))throw Error('CLAIM_CHAIN_STATE_CHANGED_REVIEW_AGAIN');
 const fee=await rpc('getFeeForMessage',[validateTransaction(review).serializeMessage().toString('base64'),{commitment:'finalized'}]);
 if(fee.value===null||BigInt(fee.value)>BigInt(review.maximumFeeLamports))throw Error('CLAIM_FEE_CHANGED');
 const simulation=await rpc('simulateTransaction',[review.unsignedTransactionBase64,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'finalized',minContextSlot:balances.context.slot,accounts:{encoding:'base64',addresses:[WALLET,vault]}}]);
 const [wp,vp]=simulation.value.accounts??[];
 if(simulation.value.err!==null||!wp||!vp||!Number.isSafeInteger(wp.lamports)||!Number.isSafeInteger(vp.lamports)||BigInt(vp.lamports)!==BigInt(review.finalizedObservation.rentLamports)||BigInt(wp.lamports)!==BigInt(walletAccount.lamports)+BigInt(review.expectedGrossLamports)-BigInt(fee.value))throw Error('CLAIM_EXECUTION_SIMULATION_CHANGED');
 // CreateNew reservation before signing. Any interrupted/uncertain execution blocks a second sign.
 const state=journal.reserve(reviewHash);
 assertExecutionPermit(review,permit,Date.now());
 const signed=handle.signTransaction(Buffer.from(review.unsignedTransactionBase64,'base64'));
 const decoded=Transaction.from(signed.signedTransaction);
 if(!decoded.verifySignatures()||digest(decoded.serializeMessage())!==review.messageSha256||encode58(decoded.signature)!==signed.signature)throw Error('CLAIM_SIGNED_ARTIFACT_MISMATCH');
 journal.persist(state,{state:'SIGNED_NOT_SUBMITTED',reviewHash,messageSha256:review.messageSha256,signature:signed.signature,signedTransactionBase64:Buffer.from(signed.signedTransaction).toString('base64'),review});
 // Persist uncertain status BEFORE send; no automatic replacement or resend after lost acknowledgement.
 journal.persist(state,{state:'SUBMISSION_UNCERTAIN',reviewHash,messageSha256:review.messageSha256,signature:signed.signature,signedTransactionBase64:Buffer.from(signed.signedTransaction).toString('base64'),review});
 let acknowledgement;
 try{acknowledgement=await rpc('sendTransaction',[Buffer.from(signed.signedTransaction).toString('base64'),{encoding:'base64',skipPreflight:false,preflightCommitment:'finalized',maxRetries:0,minContextSlot:simulation.context.slot}]);}catch{throw Error('CLAIM_SEND_UNCERTAIN_RECONCILE_PERSISTED_SIGNATURE_ONLY');}
 if(acknowledgement!==signed.signature)throw Error('CLAIM_SEND_ACK_MISMATCH_RECONCILE');
 return {state:'SUBMITTED_PENDING_FINALITY',signature:signed.signature,reviewHash,broadcast:true};
}
export function createClaimJournal(root){
 return {reserve(h){const lock=fs.openSync(path.join(root,'execution.lock'),'wx');fs.closeSync(lock);for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.json'))){let old;try{old=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));}catch{throw Error('CLAIM_PRIOR_JOURNAL_REVIEW_REQUIRED');}if(old.state!=='FINALIZED_VERIFIED')throw Error('CLAIM_PRIOR_UNRESOLVED_EXECUTION_RECONCILE_FIRST');}const file=path.join(root,h+'.json');const fd=fs.openSync(file,'wx');try{fs.writeSync(fd,JSON.stringify({state:'RESERVED_BEFORE_SIGNING',reviewHash:h}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return file;},persist(file,data){const temp=file+'.pending-'+process.pid;const fd=fs.openSync(temp,'wx');try{fs.writeSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}};
}
async function main(){
 let input='';for await(const c of process.stdin){input+=c;if(input.length>200000)throw Error('CLAIM_INPUT_LIMIT');}
 const request=JSON.parse(input);
 // Clear the raw secret-bearing request after parsing.
 // eslint-disable-next-line no-useless-assignment
 input='';
 if(request.mode==='ApprovalTemplate'){
  const r=request.review;validateTransaction(r);
  const permit={schema:'paperfund-exact-claim-authority-v1',reviewSha256:digest(JSON.stringify(r)),messageSha256:r.messageSha256,wallet:WALLET,genesis:GENESIS,operator:request.operator,action:'SIGN_AND_SUBMIT_ONE_CREATOR_CLAIM',expiresAt:r.expiresAt,maximumFeeLamports:r.maximumFeeLamports,expectedGrossLamports:r.expectedGrossLamports};
  assertExecutionPermit(r,permit);console.log(JSON.stringify(permit));return;
 }
 if(request.mode==='CheckWallet'){const handle=keyHandle(request.key);request.key='';console.log(JSON.stringify({wallet:handle.publicKey,dpapiAvailable:true,signingPerformed:false,broadcast:false,transactionAuthority:'NONE'}));return;}
 const root=path.join(process.env.LOCALAPPDATA,'PaperfundSigner','claims');if(request.mode!=='Reconcile')fs.mkdirSync(root,{recursive:true});
 const config=JSON.parse(fs.readFileSync(path.join(process.env.ProgramFiles,'PaperfundSigner','claim-rpc.json'),'utf8'));
 if(new URL(config.endpoint).protocol!=='https:')throw Error('CLAIM_HTTPS_REQUIRED');
 const attempt=async(method,params=[])=>{
  if(request.mode==='Reconcile'&&!RECOVERY_METHODS.has(method))throw Error('CLAIM_RECOVERY_READ_ONLY');
  if(!['getGenesisHash','getBlockHeight','getMultipleAccounts','getFeeForMessage','simulateTransaction','sendTransaction','getSignatureStatuses','getTransaction'].includes(method))throw Error('CLAIM_RPC_METHOD_FORBIDDEN');
  let r;try{r=await fetch(config.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});}catch{throw Error('CLAIM_RPC_UNAVAILABLE');}let body;try{body=await r.json();}catch{throw Error('CLAIM_RPC_RESPONSE_INVALID');}if(!r.ok||body.error)throw Error('CLAIM_RPC_REJECTED:'+method+':HTTP_'+r.status+':CODE_'+(Number.isInteger(body.error?.code)?body.error.code:0));return body.result;
 };
 const rpc=async(method,params=[])=>{for(let n=0;;n++){try{return await attempt(method,params);}catch(e){if(method==='sendTransaction'||n>=4||!/CLAIM_RPC_UNAVAILABLE|HTTP_(429|5\d\d)|CODE_-3200[459]|CODE_-32016/.test(e.message))throw e;await new Promise(resolve=>setTimeout(resolve,500*2**n));}}};
 if(request.mode==='Reconcile'){console.log(JSON.stringify(await recoverClaimState(root,rpc)));return;}
 const journal=createClaimJournal(root);
 if(request.mode!=='Execute')throw Error('CLAIM_MODE_FORBIDDEN');
 const handle=keyHandle(request.key);request.key='';
 const result=await executeClaim({review:request.review,permit:request.permit,handle,rpc,journal});
 // Read-only recovery only: never resend, replace bytes or remove the execution lock.
 try {for(let i=0;i<8;i++){const recovery=await recoverClaimState(root,rpc);result.reconciliation=recovery;const finalized=recovery.records.find(r=>r.signature===result.signature&&r.status==='FINALIZED_VERIFIED');if(finalized){result.finalizedReceipt=finalized.receipt;result.allocationReview=finalizedClaimAllocations(finalized.receipt);break;}if(recovery.records.some(r=>r.signature===result.signature&&r.status==='FAILED_FINALIZED'))break;await new Promise(resolve=>setTimeout(resolve,1500));}}catch(e){result.reconciliationError=safeClaimError(e);}
 console.log(JSON.stringify(result));
}
if(process.argv[1]?.endsWith('claim-runtime.bundle.cjs'))main().catch(e=>{console.error(safeClaimError(e));process.exitCode=1;});
