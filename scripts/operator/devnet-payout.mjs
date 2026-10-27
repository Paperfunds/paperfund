import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {Connection,Transaction,SystemInstruction} from '@solana/web3.js';import {SolanaPayoutRpc} from '../../packages/db/dist/payout-execution.js';import {keyHandle,createClaimJournal} from './claim-runtime.mjs';import {digest} from './claim-core.mjs';
export const DEVNET='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',DISPOSABLE='ZyEdoVJqX2r2X736AQNCpXxe7kuX4gr87MWpEED6H9q';
export function validateDevnetIntent(plan,authority,now=Date.now()){
 const i=plan.intent,hash=digest(JSON.stringify(i));
 if(i.network!=='devnet'||i.genesis!==DEVNET||i.signer!==DISPOSABLE||i.productionResults!==false||i.maximumTransactions!==1||i.principalLamports!=='6300000'||i.maximumFeeLamports!=='5000'||i.recipients.length!==3||i.recipients.some(r=>!/^([1-9][0-9]*)$/.test(r.lamports))||new Set(i.recipients.map(r=>r.destination)).size!==3||i.recipients.reduce((n,r)=>n+BigInt(r.lamports),0n)!==6300000n||hash!==plan.intentSha256)throw Error('DEVNET_INTENT_INVALID');
 if(!authority||authority.intentSha256!==hash||authority.action!=='ONE_DISPOSABLE_DEVNET_PAYOUT'||!authority.operator||!Number.isFinite(Date.parse(authority.expiresAt))||Date.parse(authority.expiresAt)<=now)throw Error('DEVNET_EXACT_OPERATOR_APPROVAL_REQUIRED');
 return hash;
}
export function verifyDevnetTransaction(bytes,intent){const tx=Transaction.from(bytes);if(tx.feePayer.toBase58()!==intent.signer||tx.instructions.length!==intent.recipients.length)throw Error('DEVNET_TRANSACTION_MISMATCH');for(const [n,ix] of tx.instructions.entries()){const d=SystemInstruction.decodeTransfer(ix),r=intent.recipients[n];if(d.fromPubkey.toBase58()!==intent.signer||d.toPubkey.toBase58()!==r.destination||BigInt(d.lamports)!==BigInt(r.lamports))throw Error('DEVNET_TRANSACTION_MISMATCH');}return tx;}
let operationPhase='PROTECTED_PLAN_READ';
async function main(){
 const mode=process.argv[2]??'Inspect',installation=path.join(process.env.ProgramFiles,'PaperfundSigner'),plan=JSON.parse(fs.readFileSync(path.join(installation,'devnet-payout-plan.json'),'utf8')),intent=plan.intent;
 if(intent.signer!==DISPOSABLE||intent.network!=='devnet'||intent.genesis!==DEVNET)throw Error('DEVNET_ONLY');
 const endpoint='https://api.devnet.solana.com',rpc=new SolanaPayoutRpc(endpoint,'finalized'),connection=new Connection(endpoint,'finalized');operationPhase='NETWORK_CHECK';await rpc.assertNetwork('devnet');
 if(mode==='Inspect'){console.log(JSON.stringify({network:'devnet',signer:DISPOSABLE,balanceLamports:String(await rpc.getBalance(DISPOSABLE)),intentSha256:plan.intentSha256,signing:false,broadcast:false}));return;}
 const root=path.join(process.env.LOCALAPPDATA,'PaperfundSigner','devnet-payout'),file=path.join(root,plan.intentSha256+'.json');
 if(mode==='Reconcile'){
  const state=JSON.parse(fs.readFileSync(file,'utf8'));if(!state.signature)throw Error('DEVNET_NO_PERSISTED_SIGNATURE');
  const status=await rpc.getSignatureStatus(state.signature);if(status?.confirmationStatus!=='finalized')throw Error('DEVNET_NOT_FINALIZED_KEEP_LOCK');if(status.error)throw Error('DEVNET_FINALIZED_FAILED_KEEP_LOCK');
  const receipt=await rpc.getFinalizedTransfers(state.signature);if(!receipt||receipt.error||receipt.feeLamports===undefined||receipt.feeLamports>5000n||receipt.transfers.length!==intent.recipients.length)throw Error('DEVNET_RECEIPT_REVIEW_KEEP_LOCK');
  for(const [n,t] of receipt.transfers.entries()){const r=intent.recipients[n];if(t.source!==DISPOSABLE||t.destination!==r.destination||t.lamports!==BigInt(r.lamports))throw Error('DEVNET_RECEIPT_RECIPIENT_MISMATCH');}
  const balances=[];for(const r of intent.recipients)balances.push(String(await rpc.getBalance(r.destination)));
  if(balances.some((b,n)=>BigInt(b)!==BigInt(state.recipientBalancesBefore[n])+BigInt(intent.recipients[n].lamports)))throw Error('DEVNET_RECIPIENT_BALANCE_REVIEW');
  const wallet=await rpc.getBalance(DISPOSABLE);if(BigInt(state.signerBalanceBefore)-wallet!==6300000n+receipt.feeLamports)throw Error('DEVNET_SOURCE_BALANCE_REVIEW');
  const result={state:'FINALIZED_VERIFIED',signature:state.signature,slot:String(receipt.slot),feeLamports:String(receipt.feeLamports),principalLamports:'6300000',recipientBalancesAfter:balances,signerBalanceAfter:String(wallet),idempotent:true,productionResults:false,network:'devnet'};createClaimJournal(root).persist(file,{...state,state:'FINALIZED_VERIFIED',receipt:result});console.log(JSON.stringify(result));return;
 }
 if(mode!=='Execute')throw Error('DEVNET_MODE_INVALID');
 operationPhase='PROTECTED_APPROVAL_READ';
 const authority=JSON.parse(fs.readFileSync(path.join(installation,'devnet-authority.json'),'utf8'));const hash=validateDevnetIntent(plan,authority);
 fs.mkdirSync(root,{recursive:true});if(fs.existsSync(path.join(root,'execution.lock'))||fs.existsSync(file))throw Error('DEVNET_EXISTING_EXECUTION_RECONCILE_ONLY');
 const balance=await rpc.getBalance(DISPOSABLE),rent=BigInt(await connection.getMinimumBalanceForRentExemption(0,'finalized'));if(balance<6305000n+rent)throw Error('DEVNET_FUNDING_REQUIRED');
 const recipientBalancesBefore=[];for(const r of intent.recipients)recipientBalancesBefore.push(String(await rpc.getBalance(r.destination)));
 operationPhase='TRANSACTION_PREPARATION';
 const prepared=await rpc.prepareTransaction(DISPOSABLE,intent.recipients.map(r=>({destination:r.destination,lamports:BigInt(r.lamports)})));verifyDevnetTransaction(prepared.unsignedTransaction,intent);if(prepared.feeLamports>5000n)throw Error('DEVNET_FEE_CAP');
 const sim=await connection.simulateTransaction(Transaction.from(prepared.unsignedTransaction));if(sim.value.err)throw Error('DEVNET_SIMULATION_FAILED');
 const journal=createClaimJournal(root),record=journal.reserve(hash);validateDevnetIntent(plan,authority);
 operationPhase='DISPOSABLE_DPAPI_RESTORE';
 let raw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.join(installation,'disposable-dpapi.ps1'),'-Mode','Restore','-Record',plan.signerRecord],{input:'',encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});const handle=keyHandle(raw,DISPOSABLE);raw='';const signed=handle.signTransaction(prepared.unsignedTransaction);const tx=verifyDevnetTransaction(signed.signedTransaction,intent);if(!tx.verifySignatures())throw Error('DEVNET_SIGNATURE_INVALID');
 const state={state:'SUBMISSION_UNCERTAIN',signature:signed.signature,signedTransactionBase64:Buffer.from(signed.signedTransaction).toString('base64'),intent,signerBalanceBefore:String(balance),recipientBalancesBefore,lastValidBlockHeight:String(prepared.lastValidBlockHeight)};journal.persist(record,state);
 try{const ack=await rpc.sendSignedTransaction(signed.signedTransaction);if(ack!==signed.signature)throw Error('DEVNET_ACK_MISMATCH');}catch{throw Error('DEVNET_SEND_UNCERTAIN_RECONCILE_ONLY');}
 console.log(JSON.stringify({state:'SUBMITTED_PENDING_FINALITY',signature:signed.signature,network:'devnet',intentSha256:hash}));
}
if(process.argv[1]?.endsWith('devnet-payout.bundle.cjs'))main().catch(e=>{console.error(/^DEVNET_[A-Z0-9_]+$/.test(e.message)?e.message:/^PAYOUT_[A-Z0-9_]+$/.test(e.code??'')?'DEVNET_'+e.code:'DEVNET_'+operationPhase+'_FAILED_PRESERVE_JOURNAL');process.exitCode=1;});
