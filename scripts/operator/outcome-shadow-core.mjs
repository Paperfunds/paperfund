// Offline diagnostics only. No production caller, acceptance writer or signing authority.
import { allocatePayouts } from '../../packages/core/dist/index.js';
export function bracketOrdering(eventId, proof, start, end) {
  const a=Date.parse(start),b=Date.parse(end);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b)return 'INVALID_WINDOW';
  // Attestations belong to a reviewed evidence verifier, never a host timestamp.
  if(!proof||proof.eventId!==eventId||!/^[a-f0-9]{64}$/.test(proof.evidenceHash??'')||
    proof.independent!==true||proof.sourceVerified!==true||proof.eventBindingVerified!==true||
    proof.continuityVerified!==true||proof.coverageVerified!==true)return 'MISSING_TRUSTED_EVENT_BRACKET';
  const lo=Date.parse(proof.earliestUtc),hi=Date.parse(proof.latestUtc);
  if(![lo,hi].every(Number.isFinite)||lo>hi)return 'INVALID_EVENT_BRACKET';
  if(hi<a)return 'BEFORE_WINDOW';if(lo>=b)return 'AFTER_WINDOW';
  if(lo>=a&&hi<b)return 'WITHIN_WINDOW';return 'CROSSES_BOUNDARY';
}
export function payableOutcome(rows,curve,pool){
  const sorted=[...rows].sort((a,b)=>BigInt(a.pnl)>BigInt(b.pnl)?-1:BigInt(a.pnl)<BigInt(b.pnl)?1:a.userId<b.userId?-1:a.userId>b.userId?1:0),groups=[];
  for(const row of sorted){let g=groups.at(-1);if(!g||BigInt(g.score)!==BigInt(row.pnl)){g={rank:groups.reduce((n,g)=>n+g.results.length,0)+1,score:row.pnl,results:[]};groups.push(g);}g.results.push({userId:row.userId});}
  if(new Set(sorted.map(r=>r.userId)).size!==sorted.length)throw Error('DUPLICATE_RESULT_USER');
  const result=allocatePayouts({prizePoolLamports:BigInt(pool),leaderboard:{participantCount:rows.length,rankGroups:groups.map(g=>({...g,tieGroupSize:g.results.length,tied:g.results.length>1}))},payoutCurve:curve.map(c=>({rank:c.rank,sharePpm:BigInt(c.sharePpm)}))});
  if(!result.ok)throw Error('INVALID_SHADOW_PAYOUT_INPUT');
  return result.allocations.map(x=>{const wallet=rows.find(r=>r.userId===x.userId)?.wallet;if(typeof wallet!=='string'||!wallet)throw Error('MISSING_WINNER_WALLET');return {userId:x.userId,wallet,rank:x.rank,lamports:String(x.payoutLamports)};}).sort((a,b)=>a.userId<b.userId?-1:a.userId>b.userId?1:0);
}
export function compareOutcomes(outcomes,{exhaustive=false,verifiedCoverageHash}={}){
  const valid=Array.isArray(outcomes)&&outcomes.length>0,normalize=x=>JSON.stringify(x.map(r=>({userId:r.userId,wallet:r.wallet,rank:r.rank,lamports:String(r.lamports)})).sort((a,b)=>a.userId.localeCompare(b.userId))),same=valid&&outcomes.every(x=>normalize(x)===normalize(outcomes[0])),covered=exhaustive===true&&/^[a-f0-9]{64}$/.test(verifiedCoverageHash??'');
  return {observedSame:!!same,provenInvariant:!!same&&covered,reason:!valid?'NO_REPLAY_OUTCOMES':!same?'WINNERS_RANKS_WALLETS_OR_AMOUNTS_DIFFER':!covered?'ALTERNATIVE_OUTCOME_COVERAGE_UNPROVEN':'VERIFIED_EXHAUSTIVE_OUTCOMES_IDENTICAL'};
}
export function evaluateShadowRound(input){
  const reasons=new Set(),eventChecks=[];
  if(!input.inventoryComplete)reasons.add('ADMISSION_AND_POSITION_INVENTORY_NOT_VERIFIED');
  if(!input.finalized)reasons.add('ROUND_NOT_FINALIZED');if(input.historicalReview)reasons.add('EXISTING_REVIEW_PRESERVED');
  for(const event of input.events){const ordering=bracketOrdering(event.id,event.proof,input.start,input.end);eventChecks.push({eventId:event.id,ordering});if(ordering!=='WITHIN_WINDOW')reasons.add(ordering);}
  const relevant=new Set(input.relevantMarketIds);
  for(const id of relevant){const e=input.marketChecks.find(m=>m.marketId===id);if(!e?.executableReplayVerified)reasons.add('RELEVANT_EXECUTABLE_STATE_REPLAY_MISSING');if(!e?.providerCoverageVerified)reasons.add('RELEVANT_PROVIDER_ROUTE_COVERAGE_MISSING');if(!e?.freshnessVerified)reasons.add('RELEVANT_STATE_FRESHNESS_UNPROVEN');}
  if(!input.settlementVerified)reasons.add('EXACT_CUTOFF_SETTLEMENT_INPUT_BINDING_UNPROVEN');if(!input.resultReconciled)reasons.add('RESULT_RECONCILIATION_UNPROVEN');if(input.dailyDependenciesVerified===false)reasons.add('DAILY_HOURLY_DEPENDENCIES_UNQUALIFIED');
  return {status:reasons.size?'REVIEW':'SHADOW_PROVABLE_NOT_PRODUCTION_ACCEPTANCE',reasons:[...reasons],eventChecks,relevantMarkets:[...relevant],ignoredUnrelatedMarkets:input.marketChecks.filter(m=>!relevant.has(m.marketId)).map(m=>m.marketId),financialAuthority:'NONE',fundingQualified:false,productionAcceptanceChanged:false};
}
