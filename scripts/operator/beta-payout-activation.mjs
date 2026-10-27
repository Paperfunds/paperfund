import fs from 'node:fs';import path from 'node:path';import {verifyBetaPolicy} from './beta-payout-policy.mjs';
export async function activateBetaPolicy({pool,target,envelope,reviewedPolicyHash,now=Date.now()}){
 const policy=verifyBetaPolicy(envelope,fs.readFileSync(path.join(target,'standing-policy-root.cer')),now,JSON.parse(fs.readFileSync(path.join(target,'policy-revocations.json'),'utf8')));
 if(policy.policyHash!==reviewedPolicyHash||Date.parse(policy.effectiveFrom)<=now)throw Error('AUTO_BETA_FUTURE_POLICY_REVIEW_REQUIRED');
 const configFile=path.join(target,'automation-config.json'),config=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));
 const c=await pool.connect();try{await c.query('begin isolation level serializable');const stop=(await c.query('select stopped from payout_stop_state where singleton=true for share')).rows[0];if(stop?.stopped!==true)throw Error('AUTO_BETA_ACTIVATION_REQUIRES_STOP');await c.query('insert into beta_payout_policies(policy_hash,effective_from,expires_at,signed_policy) values($1,$2,$3,$4) on conflict(policy_hash) do nothing',[policy.policyHash,policy.effectiveFrom,policy.expiresAt,envelope]);await c.query('commit');}catch(e){await c.query('rollback');throw e;}finally{c.release();}
 // If a file write fails after commit, no worker sees an enabled policy; preserve DB audit and review.
 const dest=path.join(target,'beta-payout-policy.json');if(fs.existsSync(dest))fs.copyFileSync(dest,dest+'.previous-'+Date.now(),fs.constants.COPYFILE_EXCL);fs.writeFileSync(dest,JSON.stringify(envelope));fs.writeFileSync(configFile,JSON.stringify({...config,betaPayoutPolicyEnabled:true}));
 return {activated:true,policyHash:policy.policyHash,effectiveFrom:policy.effectiveFrom,channelsChanged:false,financialStopPreserved:true,transactionAuthority:'NONE'};
}
