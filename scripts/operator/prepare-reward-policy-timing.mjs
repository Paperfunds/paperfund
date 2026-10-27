import fs from 'node:fs';
import path from 'node:path';
import{fileURLToPath}from'node:url';
import{loadPlan,read,sha,snapshot,sql,contentHash,assert}from'./reward-deployment-v3.mjs';
export async function prepareTiming(parentFile,parentPin,directory,{start='2026-10-27T16:00:00.000Z',id='reward-live-20261027T160000000Z'}={}){
 parentFile=path.resolve(parentFile);directory=path.resolve(directory);const p=structuredClone(loadPlan(parentFile,parentPin));
 assert(!fs.existsSync(directory),'NEW_TIMING_PACKAGE_ONLY');assert(Date.now()<Date.parse(start)-5*60000,'TIMING_PREPARATION_DEADLINE');
 const state=read(path.join(p.workDirectory,'deployment-state.json'));assert(state.phase==='CANDIDATE'&&state.planSHA256===parentPin,'RUNNING_SETTLEMENT_CANDIDATE_REQUIRED');
 assert(state.worker.entry===p.candidateWorker.entry&&state.worker.profile===p.candidateWorker.profile,'EXACT_DEPLOYED_WORKER_REQUIRED');
 fs.mkdirSync(directory,{recursive:true});
 const oldPolicy=(await sql(p,`begin read only;select to_jsonb(x) value from current_quote_settlement_policies x where id='${p.policy.id}';rollback;`))[0].value;
 const runtimeBefore=read(p.runtimeFile),safety=await snapshot(p);p.previousWorker=state.worker;
 const profile=read(state.worker.profile);profile.rewardSettlement.policyId=id;const profileFile=path.join(directory,'worker-profile.json');fs.writeFileSync(profileFile,JSON.stringify(profile,null,2)+'\n');
 p.candidateWorker={...p.candidateWorker,profile:profileFile,profileSHA256:sha(profileFile)};
 p.policy={...p.policy,id,effectiveFrom:start};
 if(p.database.reconciled){p.database.reconciled.additional=[...(p.database.reconciled.additional??[]),{packageSHA256:parentPin,policy:oldPolicy}];}
 p.timingOnly={parentPlan:parentFile,parentSHA256:parentPin,stateSHA256:contentHash(state),runtimeSHA256:sha(p.runtimeFile),runtimeBefore,safetySHA256:contentHash(safety),startBefore:new Date(Date.parse(start)-5*60000).toISOString(),enrollmentBefore:new Date(Date.parse(start)-60000).toISOString(),originalPolicy:oldPolicy};
 p.createdAt=new Date().toISOString();delete p.predecessorBaseline;delete p.recovery;
 const extra=['scripts/operator/reward-policy-timing.mjs','scripts/operator/prepare-reward-policy-timing.mjs','packages/db/test/reward-policy-timing.integration.test.ts',path.relative(p.repositoryRoot,profileFile)];
 p.files=[...p.files,...extra.map(f=>({path:f,sha256:sha(path.resolve(p.repositoryRoot,f))}))];
 if(p.environment==='Production')p.files.push({path:'docs/reward-accounting-20261027/timing-test-results.json',sha256:sha(path.join(p.repositoryRoot,'docs/reward-accounting-20261027/timing-test-results.json'))});
 const file=path.join(directory,'deployment.json');fs.writeFileSync(file,JSON.stringify(p,null,2)+'\n');return{file,pin:sha(file),plan:p};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const root=path.resolve(import.meta.dirname,'../..'),r=await prepareTiming(path.join(root,'docs/reward-accounting-20261027/updater-fixed-release/deployment.json'),'f302de4b7209a7592a6e541b679f32a707600392af5208a90b6048b862dbe3ff',path.join(root,'docs/reward-accounting-20261027/live-hour-1600'));console.log(JSON.stringify({file:r.file,pin:r.pin,activation:r.plan.policy.effectiveFrom,startBefore:r.plan.timingOnly.startBefore}));}catch(e){console.error(e.message);process.exitCode=1;}
}
