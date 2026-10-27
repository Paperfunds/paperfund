import {Transaction,SystemProgram,PublicKey} from '@solana/web3.js';
import {WALLET,GENESIS,makeTransaction,digest,verifyFinalized} from './claim-core.mjs';
import {encode58} from './key-public.mjs';
export {WALLET,GENESIS,digest};
export const RECIPIENT='53sJCZ59TSkVynoD9SfaAXZMKyZtvRgN9QZTrzqRXrbx';
export const CLAIM_SIGNATURE='2R9LJiad5GXZ4dajxAYAERsrqCMQfB2A8dhnRTabcSNyNLDHiGn4prz48gEpdVXJLcMMRsnyyJEr9z5ggz9uFsfv';
export const PLATFORM_ALLOCATION=1141036n,CLAIM_GROSS=11410357n,CLAIM_FEE=5000n;
export const TRANSFER_ID=digest(JSON.stringify({scope:'ONE_TIME_MANUAL_PLATFORM_TEST_V1',genesis:GENESIS,sender:WALLET,claim:CLAIM_SIGNATURE}));
const fail=c=>{throw Error('TRANSFER_'+c);};
export function transferTransaction(blockhash,amount){return new Transaction({feePayer:new PublicKey(WALLET),recentBlockhash:blockhash}).add(SystemProgram.transfer({fromPubkey:new PublicKey(WALLET),toPubkey:new PublicKey(RECIPIENT),lamports:BigInt(amount)}));}
export function validateTransfer(r){
 if(r.schema!=='paperfund-manual-developer-transfer-v1'||r.network!=='mainnet-beta'||r.genesis!==GENESIS||r.sender!==WALLET||r.recipient!==RECIPIENT||r.claimSignature!==CLAIM_SIGNATURE||r.transferId!==TRANSFER_ID)fail('IDENTITY_MISMATCH');
 for(const k of ['recipientLamports','feeLamports','maximumFeeLamports','totalDebitLamports'])if(!/^\d+$/.test(r[k]))fail('AMOUNT_ENCODING');
 const amount=BigInt(r.recipientLamports),fee=BigInt(r.feeLamports),max=BigInt(r.maximumFeeLamports);
 if(r.platformAllocationLamports!==String(PLATFORM_ALLOCATION)||r.claimFeeLamports!==String(CLAIM_FEE)||amount<=0n||fee!==max||fee>5000n||BigInt(r.totalDebitLamports)!==amount+fee||CLAIM_FEE+fee+amount!==PLATFORM_ALLOCATION)fail('PLATFORM_BUDGET_MISMATCH');
 const tx=Transaction.from(Buffer.from(r.unsignedTransactionBase64,'base64'));if(!tx.serializeMessage().equals(transferTransaction(r.blockhash,amount).serializeMessage())||digest(tx.serializeMessage())!==r.messageSha256||tx.signatures.length!==1||tx.signatures[0].signature!==null)fail('EXACT_TRANSFER_MESSAGE_REQUIRED');
 return tx;
}
export function transferPermit(r,operator,now=Date.now()){
 validateTransfer(r);if(!operator)fail('OPERATOR_REQUIRED');if(!r.readyForApproval||r.simulation?.error!==null||!r.simulation?.exactDeltasVerified)fail('PREFLIGHT_BLOCKED');
 if(!Number.isFinite(Date.parse(r.expiresAt))||now>=Date.parse(r.expiresAt))fail('REVIEW_EXPIRED');
 return {schema:'paperfund-exact-developer-transfer-authority-v1',action:'SIGN_AND_SUBMIT_ONE_MANUAL_DEVELOPER_TRANSFER',transferId:TRANSFER_ID,reviewSha256:digest(JSON.stringify(r)),messageSha256:r.messageSha256,genesis:GENESIS,sender:WALLET,recipient:RECIPIENT,recipientLamports:r.recipientLamports,maximumFeeLamports:r.maximumFeeLamports,expiresAt:r.expiresAt,operator};
}
export function assertTransferPermit(r,p,now=Date.now()){
 const exact=transferPermit(r,p?.operator,now);if(!p||Object.keys(p).length!==Object.keys(exact).length||Object.entries(exact).some(([k,v])=>p[k]!==v))fail('EXACT_PROTECTED_AUTHORITY_REQUIRED');return exact.reviewSha256;
}
export async function verifyClaimFunding(rpc,{checkNoSubsequentActivity=true}={}){
 if(await rpc('getGenesisHash',[])!==GENESIS)fail('MAINNET_GENESIS_MISMATCH');
 const status=(await rpc('getSignatureStatuses',[[CLAIM_SIGNATURE],{searchTransactionHistory:true}])).value?.[0];if(status?.confirmationStatus!=='finalized'||status.err)fail('CLAIM_NOT_FINALIZED');
 const receipt=await rpc('getTransaction',[CLAIM_SIGNATURE,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);if(!receipt)fail('CLAIM_TRANSACTION_UNAVAILABLE');
 const tx=Transaction.from(Buffer.from(receipt.transaction[0],'base64'));if(!tx.serializeMessage().equals(makeTransaction(tx.recentBlockhash).serializeMessage()))fail('CLAIM_MESSAGE_MISMATCH');
 const proof=verifyFinalized({messageSha256:digest(tx.serializeMessage()),expectedGrossLamports:String(CLAIM_GROSS),maximumFeeLamports:String(CLAIM_FEE)},CLAIM_SIGNATURE,receipt);if(proof.feeLamports!==String(CLAIM_FEE))fail('CLAIM_FEE_MISMATCH');
 if(checkNoSubsequentActivity){const history=await rpc('getSignaturesForAddress',[WALLET,{commitment:'finalized',limit:100}]);if(!Array.isArray(history)||history[0]?.signature!==CLAIM_SIGNATURE)fail('POST_CLAIM_ACTIVITY_REQUIRES_REVIEW');}
 return proof;
}
export function verifyTransferReceipt(r,signature,chain){
 validateTransfer(r);if(!chain||chain.meta?.err||chain.version!==undefined&&chain.version!=='legacy')fail('FINALITY_OR_VERSION_UNVERIFIED');
 const tx=Transaction.from(Buffer.from(chain.transaction[0],'base64'));if(!tx.verifySignatures()||!tx.signature||encode58(tx.signature)!==signature||digest(tx.serializeMessage())!==r.messageSha256)fail('SIGNED_RECEIPT_MESSAGE_MISMATCH');
 const amounts=verifyTransferBalances(r,chain.meta,tx.compileMessage().accountKeys.map(k=>k.toBase58()));
 return {signature,slot:chain.slot,commitment:'finalized',sender:WALLET,recipient:RECIPIENT,recipientLamports:amounts.recipientLamports,feeLamports:amounts.feeLamports,senderDebitLamports:amounts.senderDebitLamports,platformAllocationLamports:String(PLATFORM_ALLOCATION),claimFeeLamports:String(CLAIM_FEE),messageSha256:r.messageSha256,classification:'MANUALLY_AUTHORIZED_MAINNET_TRANSFER_TEST',databaseCredited:false,tokenAttributed:false,competitionPayoutAuthority:false};
}

export function verifyTransferBalances(r,m,keys){
 const si=keys.indexOf(WALLET),ri=keys.indexOf(RECIPIENT);if(si<0||ri<0||![...m.preBalances,...m.postBalances,m.fee].every(Number.isSafeInteger))fail('RECEIPT_BALANCES_UNSAFE');
 const debit=BigInt(m.preBalances[si])-BigInt(m.postBalances[si]),credit=BigInt(m.postBalances[ri])-BigInt(m.preBalances[ri]),fee=BigInt(m.fee);
 if(credit!==BigInt(r.recipientLamports)||fee!==BigInt(r.feeLamports)||debit!==credit+fee||CLAIM_FEE+credit+fee>PLATFORM_ALLOCATION)fail('FINALIZED_AMOUNT_MISMATCH');
 return {recipientLamports:String(credit),feeLamports:String(fee),senderDebitLamports:String(debit)};
}
