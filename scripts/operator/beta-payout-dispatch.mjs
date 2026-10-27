// Runs only inside the protected existing automation service after explicit beta activation.
// Root-signed funding remains a separate gate. This does not manufacture creator revenue.
import {inspectBetaHour} from './beta-payout-policy.mjs';
import {generateHourlyShadowPayoutPlan,generateDailyShadowPayoutPlan} from '../../packages/db/src/payout-service.ts';
export async function advanceBetaPayoutPlans({database,policy,acceptance,envelope,now=Date.now(),verifyFunding,inspect=inspectBetaHour,hourlyPlan=generateHourlyShadowPayoutPlan,dailyPlan=generateDailyShadowPayoutPlan}){
 if(acceptance.betaFundingOnly!==true||acceptance.betaPolicyHash!==policy.policyHash||typeof verifyFunding!=='function')throw Error('AUTO_BETA_FUNDING_POLICY_REQUIRED');
 await verifyFunding();
 const candidates=(await database.pool.query("select r.id from hourly_rounds r join hourly_reward_pools p on p.hourly_round_id=r.id where r.state='FINALIZED' and r.starts_at >= $1 and r.ends_at_exclusive <= $2 and p.status in ('FROZEN','FINAL') and p.final_hourly_prize_lamports>0 and exists(select 1 from hourly_results h where h.hourly_round_id=r.id) order by r.starts_at",[policy.effectiveFrom,new Date(Math.min(now,Date.parse(policy.expiresAt)))])).rows,out=[];
 for(const {id} of candidates){
  const c=await database.pool.connect();let checked;
  try{await c.query('begin isolation level repeatable read read only');checked=await inspect(c,id,{effectiveFrom:policy.effectiveFrom,now});await c.query('rollback');}catch(e){await c.query('rollback');throw e;}finally{c.release();}
  if(!checked.eligibleRecordedBetaCandidate){out.push({roundId:id,status:'REVIEW',reasons:checked.reasons});continue;}
  const inserted=await database.pool.query("insert into beta_source_acceptances(id,hourly_round_id,profile,network,genesis,structural_hash,acceptance_hash,policy_hash,signed_envelope,expires_at) select $1,r.id,'BETA_RECORDED_AUTHORITY_V1','mainnet-beta',$2,$3,$4,$5,$6,$7 from hourly_rounds r where r.id=$8 and r.state='FINALIZED' and legacy_hour_digest(r.id)=$3 and not exists(select 1 from legacy_source_reviews v where v.hourly_round_id=r.id) on conflict(hourly_round_id,acceptance_hash) do nothing",['beta:'+policy.policyHash+':'+acceptance.acceptanceHash+':'+id,acceptance.genesis,checked.structuralHash,acceptance.acceptanceHash,policy.policyHash,envelope,acceptance.expiresAt,id]);
  const allowed=(await database.pool.query('select mainnet_hour_allowed($1) allowed',[id])).rows[0]?.allowed;if(allowed!==true){out.push({roundId:id,status:'REVIEW',reasons:['SOURCE_CHANGED_OR_POLICY_EXPIRED']});continue;}
  const plan=await hourlyPlan(database,{hourlyRoundId:id,now:new Date(now)});out.push({roundId:id,status:'PLAN_VALIDATED',planId:plan.id});
 }
 const days=(await database.pool.query("select d.id from daily_competitions d join daily_reward_pools p on p.daily_competition_id=d.id where d.state='FINALIZED' and d.starts_at >= $1 and p.status in ('FROZEN','FINAL') and p.accumulated_lamports>0 and mainnet_source_allowed('DAILY',d.id) and exists(select 1 from daily_results r where r.daily_competition_id=d.id) order by d.starts_at",[policy.effectiveFrom])).rows;
 for(const {id} of days){const plan=await dailyPlan(database,{dailyCompetitionId:id,now:new Date(now)});out.push({dailyId:id,status:'PLAN_VALIDATED',planId:plan.id});}
 return {sources:out,transactionAuthority:'NONE',signingPerformed:false,broadcast:false};
}
