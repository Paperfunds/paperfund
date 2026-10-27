import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readonlyRpc,discover} from './discovery.mjs';
import {hash,json,saveEvidence,DATA} from './common.mjs';
import {makeTransaction,GENESIS,WALLET,MINT,vault,digest,PROGRAM} from './claim-core.mjs';
export async function prepareMainnetClaim({rpcOverride,persist=true}={}){
 const {rpc,captures}=rpcOverride?{rpc:rpcOverride,captures:[]}:await readonlyRpc(['getLatestBlockhash','getBlockHeight','getFeeForMessage','simulateTransaction']);
 const d=await discover(rpc);
 if(!d.authorityMatches||d.sharingExists||d.market!=='ACTIVE_PUMP_CURVE'||d.claimableAmmWsolLamports!=='0')throw Error('CLAIM_TOPOLOGY_REVIEW');
 const latest=await rpc('getLatestBlockhash',[{commitment:'finalized',minContextSlot:d.vaultSlot}]);
 const tx=makeTransaction(latest.value.blockhash),message=tx.serializeMessage(),unsigned=tx.serialize({requireAllSignatures:false,verifySignatures:false});
 const fee=await rpc('getFeeForMessage',[message.toString('base64'),{commitment:'finalized',minContextSlot:latest.context.slot}]);
 if(!Number.isSafeInteger(fee.value)||fee.value<0)throw Error('CLAIM_FEE_UNAVAILABLE');
 const simulated=await rpc('simulateTransaction',[unsigned.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'finalized',minContextSlot:latest.context.slot,accounts:{encoding:'base64',addresses:[WALLET,vault]}}]);
 const simulation=simulated.value;const walletPost=simulation.accounts?.[0]?.lamports,vaultPost=simulation.accounts?.[1]?.lamports;
 const gross=BigInt(d.claimableBondingExcessLamports),expectedWalletPost=BigInt(d.walletBalanceLamports)+gross-BigInt(fee.value);
 const grossVerified=simulation.err===null&&Number.isSafeInteger(walletPost)&&Number.isSafeInteger(vaultPost)&&BigInt(walletPost)===expectedWalletPost&&BigInt(vaultPost)===BigInt(d.rentLamports);
 const now=Date.now(),maximumFee='5000',funded=BigInt(d.walletBalanceLamports)>=BigInt(maximumFee);
 const review={schema:'paperfund-mainnet-claim-review-v1',preparedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),network:'mainnet-beta',genesis:GENESIS,mint:MINT,wallet:WALLET,recipient:WALLET,vault,program:PROGRAM,instruction:'collect_creator_fee_v2',scope:d.scope,finalizedObservation:d,expectedGrossLamports:String(gross),maximumFeeLamports:maximumFee,feeLamports:String(fee.value),minimumNetLamports:String(gross-BigInt(maximumFee)),walletBalanceLamports:d.walletBalanceLamports,feeFundingSufficient:funded,profitable:gross>BigInt(maximumFee),priorityFeeLamports:'0',computeUnitLimit:50000,blockhash:latest.value.blockhash,lastValidBlockHeight:latest.value.lastValidBlockHeight,messageSha256:digest(message),unsignedTransactionBase64:unsigned.toString('base64'),instructions:tx.instructions.map(ix=>({program:ix.programId.toBase58(),dataBase64:ix.data.toString('base64'),accounts:ix.keys.map(k=>({address:k.pubkey.toBase58(),signer:k.isSigner,writable:k.isWritable}))})),simulation:{error:simulation.err,slot:simulated.context.slot,unitsConsumed:simulation.unitsConsumed,logs:simulation.logs,grossVerified,walletPostLamports:walletPost,vaultPostLamports:vaultPost,signatureVerification:false},readyForApproval:grossVerified&&funded&&fee.value<=5000&&gross>5000n,authorization:'NONE',broadcast:'BLOCKED',signature:null,historicalObservationLamports:'5844557',reconciliation:'FINALIZED_SIGNATURE_AND_EXACT_MESSAGE_PLUS_VAULT_WALLET_DELTAS_REQUIRED_NO_AUTOMATIC_DATABASE_CREDIT'};
 if(!persist)return {review,reviewSha256:hash(JSON.stringify(review))};
 const evidence=await saveEvidence('claim-simulation',{review,captures});
 const envelope={review,reviewSha256:hash(JSON.stringify(review)),evidence};
 await writeFile(resolve(DATA,'claim-review-latest.json'),json(envelope));
 if(process.platform==='win32'){try{await writeFile(resolve(process.env.ProgramData,'PaperfundClaimReview/review.json'),JSON.stringify(envelope));}catch(e){if(e.code!=='ENOENT')throw Error('CLAIM_REVIEW_QUEUE_WRITE_FAILED',{cause:e});}}
 return envelope;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareMainnetClaim().then(r=>console.log(json(r))).catch(e=>{console.error(/^CLAIM_|^RPC_|MAINNET_/.test(e.message)?e.message:'CLAIM_PREPARATION_FAILED');process.exitCode=1;});
