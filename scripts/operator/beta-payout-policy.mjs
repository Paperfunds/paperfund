import {createPublicKey,verify,X509Certificate} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {sha,MAINNET,COMPROMISED,fail} from './automation-core.mjs';
export const BETA_PROFILE='BETA_RECORDED_AUTHORITY_V1';
export function verifyBetaPolicy(envelope,certificate,now=Date.now(),revoked=[]){
 const bytes=Buffer.from(envelope?.payloadBase64??'','base64');let key;try{key=new X509Certificate(certificate).publicKey;}catch{key=createPublicKey(certificate);}
 if(!verify('sha256',bytes,key,Buffer.from(envelope?.signatureBase64??'','base64')))fail('BETA_POLICY_SIGNATURE_INVALID');
 const p=JSON.parse(bytes),from=Date.parse(p.effectiveFrom),issued=Date.parse(p.approvedAt),until=Date.parse(p.expiresAt);
 if(p.schema!=='paperfund-beta-payout-policy-v1'||p.profile!==BETA_PROFILE||p.network!=='mainnet-beta'||p.genesis!==MAINNET||!p.operator||!Number.isFinite(from)||from%3600000!==0||!Number.isFinite(issued)||issued>=from||issued>now||!Number.isFinite(until)||until<=now||until<=from||until-issued>7*86400000||p.historicalReviewRelease!==false||p.fundingSeparate!==true||p.recordedServerUtcAccepted!==true||p.materialCutoffAmbiguityBlocks!==true||p.materialPricingDefectBlocks!==true||p.platformShareBps!==1000||p.unattendedCompromisedCustody!==false)fail('BETA_POLICY_INVALID_OR_EXPIRED');
 if(revoked.includes(sha(bytes)))fail('BETA_POLICY_REVOKED');return {...p,policyHash:sha(bytes),signedEnvelope:envelope};
}
export function assertBetaHours(acceptance,policy){
 if(!policy||acceptance.betaPolicyHash!==policy.policyHash||acceptance.profile!==BETA_PROFILE)fail('BETA_POLICY_REQUIRED');
 for(const h of acceptance.hours??[]){const c=h.betaChecks;if(Date.parse(h.startsAt)<Date.parse(policy.effectiveFrom)||Date.parse(h.endsAt)>Date.parse(policy.expiresAt)||!c||!['finalized','ledgerBalanced','resultReconciled','recordedMembershipValid','walletsFrozen','relevantExecutableEvidencePresent'].every(k=>c[k]===true)||!Array.isArray(c.materialFindings)||c.materialFindings.length||!/^[a-f0-9]{64}$/.test(c.evidenceHash??''))fail('BETA_HOUR_REVIEW_REQUIRED');}
 if(!acceptance.hours?.length&&acceptance.betaFundingOnly!==true)fail('BETA_HOUR_REVIEW_REQUIRED');
}
// Uncapped, single read-only snapshot. Recorded evidence is primary under the proposed beta policy;
// this is not an assertion of independent market correctness.
export async function inspectBetaHour(client,roundId,{effectiveFrom,now=Date.now()}={}){
 const q=async(s,a=[roundId])=>(await client.query(s,a)).rows;
 const round=(await q('select *,legacy_hour_digest(id) structural_hash from hourly_rounds where id=$1'))[0];if(!round)fail('BETA_ROUND_NOT_FOUND');
 const accounts=await q('select a.*,u.wallet_address from competition_accounts a join users u on u.id=a.user_id where a.hourly_round_id=$1 order by a.user_id');
 const results=await q('select r.*,u.wallet_address from hourly_results r join users u on u.id=r.user_id where r.hourly_round_id=$1 order by r.user_id');
 const positions=await q('select p.* from positions p join competition_accounts a on a.id=p.competition_account_id where a.hourly_round_id=$1');
 const fills=await q('select f.*,o.competition_account_id,o.execution_context,o.requested_at,e.state_fingerprint,e.normalized_state,e.raw_source,e.observed_at,e.chain_slot from fills f join orders o on o.id=f.order_id join competition_accounts a on a.id=o.competition_account_id left join market_state_evidence e on e.id=f.market_state_evidence_id where a.hourly_round_id=$1 order by f.id');
 const ledger=await q("select l.competition_account_id,l.account_code,sum(case when l.direction='DEBIT' then l.amount_lamports else -l.amount_lamports end)::text balance from ledger_entries l join competition_accounts a on a.id=l.competition_account_id where a.hourly_round_id=$1 group by 1,2 order by 1,2");
 const brokenJournals=await q("select j.id from journal_transactions j join competition_accounts a on a.id=j.competition_account_id left join ledger_entries l on l.journal_transaction_id=j.id where a.hourly_round_id=$1 group by j.id having coalesce(sum(case when l.direction='DEBIT' then l.amount_lamports else -l.amount_lamports end),1)<>0");
 const reviews=await q('select reason from legacy_source_reviews where hourly_round_id=$1');
 const reasons=[];const start=+new Date(round.starts_at),end=+new Date(round.ends_at_exclusive);
 if(!Number.isFinite(Date.parse(effectiveFrom))||start<Date.parse(effectiveFrom))reasons.push('POLICY_FUTURE_ROUNDS_ONLY');
 if(round.state!=='FINALIZED'||now<end+round.reward_finalization_grace_period_seconds*1000)reasons.push('ROUND_NOT_FINALIZED_AFTER_GRACE');
 if(reviews.length)reasons.push('HISTORICAL_REVIEW_PRESERVED');if(positions.some(p=>p.status!=='CLOSED'||BigInt(p.remaining_base_units)!==0n))reasons.push('UNSETTLED_POSITION');if(brokenJournals.length)reasons.push('LEDGER_JOURNAL_IMBALANCE');
 if(!accounts.length||results.length!==accounts.length)reasons.push('RESULT_COVERAGE_MISSING');
 for(const a of accounts){const r=results.find(r=>r.competition_account_id===a.id),cash=ledger.find(l=>l.competition_account_id===a.id&&l.account_code==='CASH');if(!r||!cash||BigInt(cash.balance)!==BigInt(r.final_settled_balance_lamports)||BigInt(a.paper_sol_balance_lamports)!==BigInt(r.final_settled_balance_lamports)||BigInt(r.final_settled_balance_lamports)-BigInt(r.starting_paper_sol_lamports)!==BigInt(r.hourly_pnl_lamports))reasons.push('ACCOUNT_RESULT_LEDGER_MISMATCH');}
 for(const f of fills){const at=+new Date(f.requested_at),exec=+new Date(f.executed_at),forced=f.execution_context==='FORCED_HOURLY_SETTLEMENT';if(!forced&&(at<start||at>=end||exec<start||exec>=end))reasons.push('MATERIAL_RECORDED_CUTOFF_AMBIGUITY');if(!f.market_state_evidence_id||!f.state_fingerprint||!f.normalized_state||!Object.keys(f.normalized_state).length||!f.raw_source||!Object.keys(f.raw_source).length||!f.protocol_id||!f.adapter_version||!f.fee_breakdown||f.chain_slot===null)reasons.push('RELEVANT_EXECUTION_INPUT_MISSING');if(forced&&(+new Date(f.observed_at)>end||exec!==end))reasons.push('FORCED_CUTOFF_INPUT_REVIEW');}
 for(const r of results){try{if(new PublicKey(r.wallet_address).toBase58()!==r.wallet_address)throw Error();}catch{reasons.push('RECIPIENT_WALLET_INVALID');}}
 const summary={roundId,structuralHash:round.structural_hash,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),reasons:[...new Set(reasons)],results:results.map(r=>({resultId:r.id,userId:r.user_id,wallet:r.wallet_address,pnl:String(r.hourly_pnl_lamports),normalFillCount:fills.filter(f=>f.competition_account_id===r.competition_account_id&&f.execution_context==='NORMAL_USER').length})),fillEvidence:fills.map(f=>({fillId:f.id,evidenceId:f.market_state_evidence_id,fingerprint:f.state_fingerprint})),ledger,knownReviews:reviews,independentMarketCorrectnessProven:false,policyActivation:'NONE'};
 return {...summary,evidenceHash:sha(JSON.stringify(summary)),eligibleRecordedBetaCandidate:reasons.length===0};
}
export function assertUnattendedBetaCustody(wallet){if(wallet===COMPROMISED)fail('FRESH_CUSTODY_REQUIRED');}
