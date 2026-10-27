import {allocateCreatorFees,competitionConfig} from '../../packages/core/dist/index.js';
export function finalizedClaimAllocations(receipt) {
 if(receipt?.commitment!=='finalized'||!receipt.signature||!/^\d+$/.test(receipt.grossLamports)||!/^\d+$/.test(receipt.feeLamports)||BigInt(receipt.netLamports)!==BigInt(receipt.grossLamports)-BigInt(receipt.feeLamports))throw Error('CLAIM_FINALIZED_RECEIPT_REQUIRED');
 const modes={};
 for(const mode of ['NORMAL','BUFFER_ACCUMULATION']) {
  const r=allocateCreatorFees({creatorFeeLamports:BigInt(receipt.grossLamports),mode,config:competitionConfig});if(!r.ok)throw Error('CLAIM_ALLOCATION_INVALID');const a=r.allocation;
  modes[mode]={hourlyLamports:String(a.currentHourly),dailyLamports:String(a.daily),bufferLamports:String(a.rewardBuffer),platformGrossLamports:String(a.platform),networkFeePlatformExpenseLamports:receipt.feeLamports,platformAfterFeeLamports:String(a.platform>BigInt(receipt.feeLamports)?a.platform-BigInt(receipt.feeLamports):0n),externalFeeSubsidyRequiredLamports:String(a.platform<BigInt(receipt.feeLamports)?BigInt(receipt.feeLamports)-a.platform:0n)};
 }
 return {signature:receipt.signature,grossActuallyReceivedLamports:receipt.grossLamports,netWalletIncreaseLamports:receipt.netLamports,modes,selectedMode:null,platformDestination:null,platformTransferAuthorized:false,databaseCredited:false,spendableRewardCapitalLamports:'0',status:'FINALIZED_RECEIPT_ALLOCATION_REVIEW_TOKEN_AND_EVENT_TIME_ATTRIBUTION_REQUIRED',reason:'A creator-vault claim aggregates revenue. Do not assign the full claim to its collection hour or credit unverified token revenue.'};
}
