import {encode58} from './key-public.mjs';
import {createHash} from 'node:crypto';
import {Transaction,TransactionInstruction,PublicKey,ComputeBudgetProgram} from '@solana/web3.js';
export const WALLET='GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW',MINT='3JVd8Z3kEEXBaBoZo9rcWk4MHJPSUAf6zAjvAF5spump',GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const PROGRAM='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const digest=b=>createHash('sha256').update(b).digest('hex');
export const stable=o=>JSON.stringify(o,Object.keys(o).sort());
const pk=s=>new PublicKey(s),token='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',wsol='So11111111111111111111111111111111111111112',ata='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const pda=(seeds,program)=>PublicKey.findProgramAddressSync(seeds,pk(program))[0];
export const vault=pda([Buffer.from('creator-vault'),pk(WALLET).toBuffer()],PROGRAM).toBase58();
export function claimInstruction(){
 const associated=owner=>pda([pk(owner).toBuffer(),pk(token).toBuffer(),pk(wsol).toBuffer()],ata).toBase58();
 const addresses=[WALLET,associated(WALLET),vault,associated(vault),wsol,token,ata,'11111111111111111111111111111111',pda([Buffer.from('__event_authority')],PROGRAM).toBase58(),PROGRAM];
 return new TransactionInstruction({programId:pk(PROGRAM),keys:addresses.map((address,i)=>({pubkey:pk(address),isSigner:false,isWritable:i<4})),data:Buffer.from('zxGK8gQiEzg=','base64')});
}
export function makeTransaction(blockhash){return new Transaction({feePayer:pk(WALLET),recentBlockhash:blockhash}).add(ComputeBudgetProgram.setComputeUnitLimit({units:50000}),claimInstruction());}
export function validateTransaction(review){
 if(review.network!=='mainnet-beta'||review.genesis!==GENESIS||review.wallet!==WALLET||review.mint!==MINT)throw Error('CLAIM_IDENTITY_MISMATCH');
 const tx=Transaction.from(Buffer.from(review.unsignedTransactionBase64,'base64'));
 const expected=makeTransaction(review.blockhash);
 if(!tx.serializeMessage().equals(expected.serializeMessage())||digest(tx.serializeMessage())!==review.messageSha256)throw Error('CLAIM_MESSAGE_MISMATCH');
 if(tx.signatures.length!==1||tx.signatures[0].signature!==null)throw Error('CLAIM_UNSIGNED_REQUIRED');
 return tx;
}
export function assertExecutionPermit(review,permit,now=Date.now()){
 validateTransaction(review);
 const hash=digest(JSON.stringify(review));
 if(!permit||permit.schema!=='paperfund-exact-claim-authority-v1'||permit.reviewSha256!==hash||permit.messageSha256!==review.messageSha256||permit.wallet!==WALLET||permit.genesis!==GENESIS||permit.action!=='SIGN_AND_SUBMIT_ONE_CREATOR_CLAIM'||!permit.operator)throw Error('CLAIM_PROTECTED_AUTHORITY_REQUIRED');
 if(!Number.isFinite(Date.parse(review.expiresAt))||now>=Date.parse(review.expiresAt)||now>=Date.parse(permit.expiresAt)||!Number.isFinite(Date.parse(permit.expiresAt)))throw Error('CLAIM_APPROVAL_EXPIRED');
 if(!review.readyForApproval||review.simulation?.error!==null||!review.simulation?.grossVerified||!review.feeFundingSufficient)throw Error('CLAIM_PREFLIGHT_BLOCKED');
 if(BigInt(review.maximumFeeLamports)>5000n||BigInt(review.feeLamports)>BigInt(review.maximumFeeLamports)||BigInt(review.expectedGrossLamports)<=BigInt(review.maximumFeeLamports))throw Error('CLAIM_FEE_OR_PROFIT_LIMIT');
 if(permit.maximumFeeLamports!==review.maximumFeeLamports||permit.expectedGrossLamports!==review.expectedGrossLamports)throw Error('CLAIM_AMOUNT_APPROVAL_MISMATCH');
 return hash;
}
export function verifyFinalized(review,signature,transaction){
 if(!transaction||transaction.meta?.err||transaction.version!==undefined&&transaction.version!=='legacy')throw Error('CLAIM_FINALITY_OR_VERSION_UNVERIFIED');
 const tx=Transaction.from(Buffer.from(transaction.transaction[0],'base64'));
 if(tx.signatures.length!==1||!tx.verifySignatures()||!tx.signature||encode58(tx.signature)!==signature||tx.signatures[0].publicKey.toBase58()!==WALLET||digest(tx.serializeMessage())!==review.messageSha256)throw Error('CLAIM_RECEIPT_MESSAGE_MISMATCH');
 const keys=tx.compileMessage().accountKeys.map(k=>k.toBase58()),wi=keys.indexOf(WALLET),vi=keys.indexOf(vault),meta=transaction.meta;
 if(wi<0||vi<0||![...meta.preBalances,...meta.postBalances,meta.fee].every(Number.isSafeInteger))throw Error('CLAIM_RECEIPT_BALANCES_UNSAFE');
 const gross=BigInt(meta.preBalances[vi])-BigInt(meta.postBalances[vi]),net=BigInt(meta.postBalances[wi])-BigInt(meta.preBalances[wi]),fee=BigInt(meta.fee);
 if(gross!==BigInt(review.expectedGrossLamports)||net!==gross-fee||fee>BigInt(review.maximumFeeLamports))throw Error('CLAIM_FINALIZED_AMOUNT_REVIEW_REQUIRED');
 return {signature,slot:transaction.slot,commitment:'finalized',grossLamports:String(gross),feeLamports:String(fee),netLamports:String(net),messageSha256:review.messageSha256,tokenAttribution:'REVIEW_NOT_PAYOUT_CAPITAL',databaseCredited:false};
}
