import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fixture } from './legacy-beta-fixture.js';
import { prepare } from '../../../scripts/operator/prepare-reward-deployment-v2.mjs';
import { sha, read, processInfo, operate, parseAdminOutput, snapshot, validateHeartbeat, workerHealth, start } from '../../../scripts/operator/reward-deployment-v2.mjs';
it('normalizes the production psql JSON result to the fixture driver row shape',()=>{
 expect(parseAdminOutput('{"stop":{"stopped":true}}\r\n')).toEqual([{value:{stop:{stopped:true}}}]);
 expect(parseAdminOutput('')).toEqual([]);
});
it('rejects stale, wrong-process and non-lifecycle heartbeat data',()=>{
 const now=Date.now(),r={pid:1,createdAt:new Date(now-5000).toISOString()};
 const h={processId:1,startedAt:r.createdAt,lastTickStartedAt:new Date(now).toISOString(),lastLifecycleSuccessAt:new Date(now).toISOString()};
 expect(validateHeartbeat(h,{mtimeMs:now},r).status).toBe('HEALTHY');
 expect(()=>validateHeartbeat({...h,processId:2},{mtimeMs:now},r)).toThrow('PROCESS_MISMATCH');
 expect(()=>validateHeartbeat({...h,lastTickStartedAt:new Date(now-31000).toISOString()},{mtimeMs:now},r)).toThrow('STALE_HEARTBEAT');
 expect(()=>validateHeartbeat({...h,lastLifecycleSuccessAt:null},{mtimeMs:now},r)).toThrow('LIFECYCLE');
});
it('recovers the actual frozen-runtime heartbeat layout with omitted config, installed SQL, interrupted reconciliation and complete worker rollback', async()=>{
 const f=await fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'paperfund-reward-deploy-'));
 const children:ReturnType<typeof spawn>[]=[];let finalPlan:any;let polls=0,errors=0;let timer:ReturnType<typeof setInterval>|undefined;
 const originalBase=path.resolve('docs/operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified');
 const base=path.join(dir,'frozen/public-paper-20261026-v6-startup-qualified');
 fs.mkdirSync(path.join(base,'runtime'),{recursive:true});
 fs.copyFileSync(path.join(originalBase,'release.json'),path.join(base,'release.json'));
 for(const entry of fs.readdirSync(path.join(originalBase,'runtime'),{withFileTypes:true})){
  if(entry.isFile())fs.copyFileSync(path.join(originalBase,'runtime',entry.name),path.join(base,'runtime',entry.name));
 }
 fs.cpSync(path.join(originalBase,'runtime/apps'),path.join(base,'runtime/apps'),{recursive:true});
 for(const name of ['node_modules','packages'])fs.symlinkSync(path.join(originalBase,'runtime',name),path.join(base,'runtime',name),'junction');
 const baselineHeartbeat=path.join(base,'runtime/logs/worker-heartbeat.json');
 const wait=async(test:()=>Promise<boolean>|boolean)=>{for(let i=0;i<80;i++){if(await test())return;await new Promise(r=>setTimeout(r,250));}throw Error('FIXTURE_PROCESS_READY_TIMEOUT');};
 try{
  const database=(await f.db.pool.query('select current_database() n')).rows[0].n;
  const config={DATABASE_URL:'postgresql://beta:disposable-beta-only@127.0.0.1:55462/'+database,REDIS_URL:'redis://127.0.0.1:6381/15',SOLANA_RPC_URL:'https://example.invalid',PRIVATE_BETA_NON_PAYING:'true',BETA_INVITE_ONLY:'true',PAYOUT_EXECUTION_ENABLED:'false',PAYOUT_SIGNER_TYPE:'DISABLED',CREATOR_FEE_INGESTION_ENABLED:'false',CREATOR_FEE_SHADOW_MODE:'true',WORKER_TICK_INTERVAL_MS:'500',API_HOST:'127.0.0.1',API_PORT:'3397'};
  const entryControl=JSON.stringify({schema:'GENERIC_OPERATOR_CONTROL_V1',mode:'ENTRY',publicPaper:true,authorizationId:'fixture',expiresAt:null});
  await f.db.pool.query("insert into app_meta(key,value) values('generic_pumpswap_operator_control_v1',$1) on conflict(key) do update set value=excluded.value",[entryControl]);
  const originalFills=(await f.db.pool.query('select count(*)::int n from fills')).rows[0].n;
  const cfg=path.join(dir,'worker.json');fs.writeFileSync(cfg,JSON.stringify(config));
  const control=path.join(dir,'control');fs.mkdirSync(control);
  const profile={schema:'PAPERFUND_PUBLIC_CURRENT_QUOTES_V1',approvalReference:'ISOLATED_DEPLOYMENT_REHEARSAL_ONLY',authorizationId:'fixture',nonPaying:true,admission:'PUBLIC_PAPER',rewardHoldFrom:'2026-10-26T00:00:00Z',archiveDirectory:path.join(dir,'archive'),controlDirectory:control,qualification:{apiPort:3397}};
  const profileFile=path.join(dir,'api-profile.json');fs.writeFileSync(profileFile,JSON.stringify(profile));
  const runtimeFile=path.join(dir,'runtime.json'),runtime:any={};for(const role of ['api','worker','operator'])runtime[role]={environmentFile:cfg};runtime.currentQuotes={};fs.writeFileSync(runtimeFile,JSON.stringify(runtime));
  const launcher=path.join(dir,'launcher.ps1');fs.copyFileSync('scripts/operator/launcher.ps1',launcher);
  const launch=(role:string)=>{
   const out=fs.openSync(path.join(dir,role+'.out.log'),'w'),err=fs.openSync(path.join(dir,role+'.err.log'),'w');
   const env={...process.env,...config};delete env.WORKER_HEARTBEAT_FILE;
   const c=spawn(process.execPath,[path.join(base,'runtime',role+'.mjs'),profileFile,sha(profileFile)],{cwd:process.cwd(),windowsHide:true,env,stdio:['ignore',out,err]});fs.closeSync(out);fs.closeSync(err);children.push(c);return c;
  };
  const old=launch('worker'),api=launch('api');
  await wait(()=>fs.existsSync(baselineHeartbeat));
  await wait(async()=>{try{return(await fetch('http://127.0.0.1:3397/ready')).status===200;}catch{return false;}});
  const apiIdentity=processInfo(api.pid);
  timer=setInterval(()=>{void fetch('http://127.0.0.1:3397/ready').then(r=>{polls++;if(r.status!==200)errors++;}).catch(()=>errors++);},500);
  const protectedTarget=path.join(dir,'protected');fs.mkdirSync(protectedTarget);
  const installed=path.join(process.env.ProgramFiles!,'PaperfundSigner'),manifest=read(path.join(installed,'automation-install-manifest.json'));
  for(const entry of manifest.files)fs.copyFileSync(path.join(installed,entry.name),path.join(protectedTarget,entry.name));
  fs.copyFileSync(path.join(installed,'automation-install-manifest.json'),path.join(protectedTarget,'automation-install-manifest.json'));
  for(const name of ['settlement.sql','durable.sql','platform-accounting.sql','grants.sql'])await f.db.pool.query(fs.readFileSync('packages/db/isolated/current-quotes/'+name,'utf8'));
  const oldPin='a'.repeat(64),workDirectory=path.join(dir,'work');fs.mkdirSync(workDirectory);
  await f.db.pool.query("insert into current_quote_settlement_policies(id,effective_from,ends_before,selection_version,provider_id) values('fixture-existing-policy','2043-01-01T00:00Z','2043-01-02T00:00Z','DURABLE_QUOTE_V2','CUSTOM_RPC')");
  await f.db.pool.query('insert into app_meta(key,value) values($1,$2)',['reward-deployment:'+oldPin,oldPin]);
  const oldProc=processInfo(old.pid),receipt={mode:'BASELINE',pid:old.pid,createdAt:oldProc.createdAt,entry:path.join(base,'runtime/worker.mjs'),sha256:sha(path.join(base,'runtime/worker.mjs')),profile:profileFile,profileSHA256:sha(profileFile),controlDirectory:control};
  fs.writeFileSync(path.join(workDirectory,'starting-worker.json'),JSON.stringify(receipt));
  fs.writeFileSync(path.join(workDirectory,'deployment-state.json'),JSON.stringify({planSHA256:oldPin,phase:'ROLLING_BACK',worker:null}));
  const beforeTables=(await f.db.pool.query("select oid::text from pg_class where relname='current_quote_cutoff_captures'")).rows[0].oid;
  const priorPolicy=(await f.db.pool.query("select to_jsonb(x) p from current_quote_settlement_policies x where id='fixture-existing-policy'")).rows[0].p;
  const reviews=(await snapshot({environment:'Fixture',configurations:{worker:{file:cfg}}})).reviews;
  const result=await prepare({directory:path.join(dir,'package'),environment:'Fixture',fixture:{runtimeFile,apiProfile:profileFile,apiPID:api.pid,workerPID:old.pid,protectedTarget,workDirectory,launcher,base,receipt,predecessorPackageSHA256:oldPin,oldPolicyId:'fixture-existing-policy',reviewFingerprint:reviews}});
  finalPlan=result;
  expect((await operate(result.file,result.pin,'Check')).passed).toBe(true);
  await expect(operate(result.file,result.pin,'Cutover',false)).rejects.toThrow('SEPARATE_PRODUCTION_APPROVAL_REQUIRED');
  await expect(workerHealth(result.plan,{...receipt,heartbeatFile:path.join(dir,'wrong-repository-heartbeat.json')},{timeoutMs:500})).rejects.toThrow('WORKER_HEALTH_TIMEOUT');
  await expect(operate(result.file,result.pin,'ReconcileRollback',true,'after-recovery-binding')).rejects.toThrow('SIMULATED_RECOVERY_INTERRUPTION');
  expect(read(path.join(workDirectory,'deployment-state.json')).phase).toBe('RECONCILING_ROLLBACK');
  expect((await operate(result.file,result.pin,'ReconcileRollback',true)).phase).toBe('ROLLED_BACK');
  expect(read(path.join(workDirectory,'deployment-state.json')).worker.pid).toBe(old.pid);
  const recoveryProof=read(read(path.join(workDirectory,'deployment-state.json')).recoveryProof);
  expect(recoveryProof.runtimeBeforeSHA256).toBe(result.plan.runtimePreimageSHA256);
  expect(recoveryProof.launcherBeforeSHA256).toBe(result.plan.launcher.oldSHA256);
  const badProfile=path.join(dir,'bad-profile.json');fs.writeFileSync(badProfile,JSON.stringify({...read(result.plan.candidateWorker.profile),nonPaying:false}));
  await expect(start(result.plan,{...result.plan.candidateWorker,mode:'CANDIDATE',profile:badProfile,profileSHA256:sha(badProfile)})).rejects.toThrow();
  expect((await f.db.pool.query("select to_regclass('current_quote_capture_certificates')::text n")).rows[0].n).toBe('current_quote_capture_certificates');
  await expect(operate(result.file,result.pin,'Cutover',true,'after-start')).rejects.toThrow('VERIFIED_WORKER_AND_BUNDLE_ROLLBACK_COMPLETED');
  expect((await operate(result.file,result.pin,'Cutover',true)).phase).toBe('CANDIDATE');
  const candidate=read(path.join(result.plan.workDirectory,'deployment-state.json')).worker;
  expect(read(result.plan.candidateWorker.heartbeatFile).processId).toBe(candidate.pid);
  expect(read(result.plan.candidateWorker.heartbeatFile).rewardCapture.model).toBe('DURABLE_QUOTE_V2');
  const counts=await f.db.pool.query('select (select count(*)::int from current_quote_settlement_policies) policies,(select count(*)::int from payout_signed_transactions) signed,(select count(*)::int from payout_executions) executions,(select count(*)::int from payout_broadcast_attempts) broadcasts');
  expect(counts.rows[0]).toEqual({policies:2,signed:0,executions:0,broadcasts:0});
  await operate(result.file,result.pin,'Rollback',true);
  for(const e of result.plan.protectedUpdate.files)expect(sha(path.join(protectedTarget,e.name))).toBe(e.oldSHA256);
  expect(read(runtimeFile).worker.script).toContain('v6-startup-qualified');
  expect(read(runtimeFile).api.script).toContain('v6-startup-qualified');
  expect(read(path.join(workDirectory,'deployment-state.json')).phase).toBe('ROLLED_BACK');
  expect((await f.db.pool.query("select oid::text from pg_class where relname='current_quote_cutoff_captures'")).rows[0].oid).toBe(beforeTables);
  expect((await f.db.pool.query("select to_jsonb(x) p from current_quote_settlement_policies x where id='fixture-existing-policy'")).rows[0].p).toEqual(priorPolicy);
  expect(processInfo(api.pid)).toEqual(apiIdentity);expect(errors).toBe(0);expect(polls).toBeGreaterThan(0);
  expect((await f.db.pool.query("select value from app_meta where key='generic_pumpswap_operator_control_v1'")).rows[0].value).toBe(entryControl);
  expect((await f.db.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(originalFills);
  const report={at:new Date().toISOString(),passed:true,apiArtifact:'UNCHANGED_FROZEN_V6',apiIdentityPreserved:true,httpPolls:polls,httpFailures:errors,actualFrozenLayout:true,heartbeatConfigOmitted:true,baselineHeartbeat,explicitCandidateHeartbeat:result.plan.candidateWorker.heartbeatFile,advancingHeartbeatRequired:true,wrongHeartbeatRejected:true,startupFailureRejected:true,interruptedReconciliationRecovered:true,postCandidateStartupFailureRecovered:true,candidateBooted:true,formalRollback:'ROLLED_BACK',schemasNotReapplied:true,oldPolicyUnchanged:true,catalogSHA256:result.plan.database.reconciled.schemaSHA256,counts:counts.rows[0],fixtureDatabase:database,productionMutated:false,financialAuthority:'NONE'};
  fs.writeFileSync('docs/reward-accounting-20261027/recovery-rehearsal.json',JSON.stringify(report,null,2)+'\n');
 }finally{
  if(timer)clearInterval(timer);
  // Cleanup only this isolated worker/API through their file protocols, never production PIDs.
  for(const role of ['worker','api']){
   fs.writeFileSync(path.join(dir,'control',role+'-drain.request.json'),JSON.stringify({schema:'PAPERFUND_DRAIN_V1',requestId:'fixture-cleanup-'+Date.now()}));
  }
  await new Promise(r=>setTimeout(r,1500));
  if(finalPlan){const stateFile=path.join(finalPlan.plan.workDirectory,'deployment-state.json');if(fs.existsSync(stateFile)){const pid=read(stateFile).worker?.pid;await wait(()=>!processInfo(pid));}}
  for(const c of children){if(c.exitCode===null)await wait(()=>!processInfo(c.pid));}
  await f.cleanup();
 }
},240000);
