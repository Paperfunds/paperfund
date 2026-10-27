import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fixture } from './legacy-beta-fixture.js';
import { prepare } from '../../../scripts/operator/prepare-reward-deployment.mjs';
import { sha, read, processInfo, operate, protectedUpdate, parseAdminOutput } from '../../../scripts/operator/reward-deployment.mjs';
it('normalizes the production psql JSON result to the fixture driver row shape',()=>{
 expect(parseAdminOutput('{"stop":{"stopped":true}}\r\n')).toEqual([{value:{stop:{stopped:true}}}]);
 expect(parseAdminOutput('')).toEqual([]);
});
it('rehearses pinned v6 API preservation, transactional schema/grants, protected replacement faults, candidate cutover and worker-only recovery', async()=>{
 const f=await fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'paperfund-reward-deploy-'));
 const children:ReturnType<typeof spawn>[]=[];let finalPlan:any;let polls=0,errors=0;let timer:ReturnType<typeof setInterval>|undefined;
 const base=path.resolve('docs/operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified');
 const wait=async(test:()=>Promise<boolean>|boolean)=>{for(let i=0;i<80;i++){if(await test())return;await new Promise(r=>setTimeout(r,250));}throw Error('FIXTURE_PROCESS_READY_TIMEOUT');};
 try{
  const database=(await f.db.pool.query('select current_database() n')).rows[0].n;
  const config={DATABASE_URL:'postgresql://beta:disposable-beta-only@127.0.0.1:55462/'+database,REDIS_URL:'redis://127.0.0.1:6381/15',SOLANA_RPC_URL:'https://example.invalid',PRIVATE_BETA_NON_PAYING:'true',BETA_INVITE_ONLY:'true',PAYOUT_EXECUTION_ENABLED:'false',PAYOUT_SIGNER_TYPE:'DISABLED',CREATOR_FEE_INGESTION_ENABLED:'false',CREATOR_FEE_SHADOW_MODE:'true',WORKER_TICK_INTERVAL_MS:'500',WORKER_HEARTBEAT_FILE:path.join(dir,'heartbeat.json'),API_HOST:'127.0.0.1',API_PORT:'3397'};
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
   const c=spawn(process.execPath,[path.join(base,'runtime',role+'.mjs'),profileFile,sha(profileFile)],{cwd:process.cwd(),windowsHide:true,env:{...process.env,...config},stdio:['ignore',out,err]});fs.closeSync(out);fs.closeSync(err);children.push(c);return c;
  };
  const old=launch('worker'),api=launch('api');
  await wait(()=>fs.existsSync(config.WORKER_HEARTBEAT_FILE));
  await wait(async()=>{try{return(await fetch('http://127.0.0.1:3397/ready')).status===200;}catch{return false;}});
  const apiIdentity=processInfo(api.pid);
  timer=setInterval(()=>{void fetch('http://127.0.0.1:3397/ready').then(r=>{polls++;if(r.status!==200)errors++;}).catch(()=>errors++);},500);
  const protectedTarget=path.join(dir,'protected');fs.mkdirSync(protectedTarget);
  const installed=path.join(process.env.ProgramFiles!,'PaperfundSigner'),manifest=read(path.join(installed,'automation-install-manifest.json'));
  for(const entry of manifest.files)fs.copyFileSync(path.join(installed,entry.name),path.join(protectedTarget,entry.name));
  fs.copyFileSync(path.join(installed,'automation-install-manifest.json'),path.join(protectedTarget,'automation-install-manifest.json'));
  const result=await prepare({directory:path.join(dir,'package'),environment:'Fixture',fixture:{runtimeFile,apiProfile:profileFile,apiPID:api.pid,workerPID:old.pid,protectedTarget,workDirectory:path.join(dir,'work'),launcher}});
  finalPlan=result;
  expect((await operate(result.file,result.pin,'Check')).passed).toBe(true);
  await expect(operate(result.file,result.pin,'Cutover',false)).rejects.toThrow('SEPARATE_PRODUCTION_APPROVAL_REQUIRED');
  const migration=await f.db.pool.connect();
  try{await migration.query('begin');for(const file of result.plan.schemas)await migration.query(fs.readFileSync(file,'utf8'));await expect(migration.query('select 1/0')).rejects.toThrow();}finally{await migration.query('rollback');migration.release();}
  expect((await f.db.pool.query("select to_regclass('current_quote_settlement_policies')::text n")).rows[0].n).toBeNull();
  // Partial replacement must restore all verified originals, including the manifest.
  expect(()=>protectedUpdate(result.plan,result.file,result.pin,'Install',1)).toThrow();
  for(const e of result.plan.protectedUpdate.files)expect(sha(path.join(protectedTarget,e.name))).toBe(e.oldSHA256);
  expect(()=>protectedUpdate(result.plan,result.file,result.pin,'Install',-1)).toThrow();
  fs.writeFileSync(path.join(protectedTarget,'automation-service.bundle.cjs.reward-stage'),'abandoned unverified fixture stage');
  protectedUpdate(result.plan,result.file,result.pin,'Restore');
  for(const e of result.plan.protectedUpdate.files)expect(sha(path.join(protectedTarget,e.name))).toBe(e.oldSHA256);
  protectedUpdate(result.plan,result.file,result.pin,'Install');
  protectedUpdate(result.plan,result.file,result.pin,'Restore');
  const bad=path.join(protectedTarget,'mainnet-tools.bundle.cjs'),original=fs.readFileSync(bad);fs.writeFileSync(bad,'unverified fixture bytes');
  expect(()=>protectedUpdate(result.plan,result.file,result.pin,'Install')).toThrow();expect(fs.readFileSync(bad,'utf8')).toBe('unverified fixture bytes');fs.writeFileSync(bad,original);
  await expect(operate(result.file,result.pin,'Cutover',true,'after-verifiers')).rejects.toThrow('VERIFIED_WORKER_AND_BUNDLE_ROLLBACK_COMPLETED');
  expect(read(path.join(result.plan.workDirectory,'deployment-state.json')).phase).toBe('BASELINE');
  expect((await f.db.pool.query("select to_regclass('current_quote_capture_certificates')::text n")).rows[0].n).toBe('current_quote_capture_certificates');
  await expect(operate(result.file,result.pin,'Cutover',true,'after-start')).rejects.toThrow('VERIFIED_WORKER_AND_BUNDLE_ROLLBACK_COMPLETED');
  expect((await operate(result.file,result.pin,'Cutover',true)).phase).toBe('CANDIDATE');
  const candidate=read(path.join(result.plan.workDirectory,'deployment-state.json')).worker;
  expect(read(config.WORKER_HEARTBEAT_FILE).processId).toBe(candidate.pid);
  expect(read(config.WORKER_HEARTBEAT_FILE).rewardCapture.model).toBe('DURABLE_QUOTE_V2');
  const counts=await f.db.pool.query('select (select count(*)::int from current_quote_settlement_policies) policies,(select count(*)::int from payout_signed_transactions) signed,(select count(*)::int from payout_executions) executions,(select count(*)::int from payout_broadcast_attempts) broadcasts');
  expect(counts.rows[0]).toEqual({policies:1,signed:0,executions:0,broadcasts:0});
  await operate(result.file,result.pin,'Rollback',true);
  for(const e of result.plan.protectedUpdate.files)expect(sha(path.join(protectedTarget,e.name))).toBe(e.oldSHA256);
  expect(read(runtimeFile).worker.script).toContain('v6-startup-qualified');
  expect(read(runtimeFile).api.script).toContain('v6-startup-qualified');
  expect(processInfo(api.pid)).toEqual(apiIdentity);expect(errors).toBe(0);expect(polls).toBeGreaterThan(0);
  expect((await f.db.pool.query("select value from app_meta where key='generic_pumpswap_operator_control_v1'")).rows[0].value).toBe(entryControl);
  expect((await f.db.pool.query('select count(*)::int n from fills')).rows[0].n).toBe(originalFills);
  const report={at:new Date().toISOString(),passed:true,apiArtifact:'UNCHANGED_FROZEN_V6',apiIdentityPreserved:true,httpPolls:polls,httpFailures:errors,transactionalSchemaAndGrants:true,failedSqlTransactionRolledBack:true,partialProtectedReplacementRestored:true,hardInterruptionRecovered:true,abandonedStageQuarantined:true,unverifiedDestinationRefused:true,postMigrationFailureRecovered:true,postCandidateStartupFailureRecovered:true,candidateBooted:true,rollbackToV6:true,schemasRetained:true,counts:counts.rows[0],fixtureDatabase:database,productionMutated:false,financialAuthority:'NONE'};
  fs.writeFileSync('docs/reward-accounting-20261027/deployment-rehearsal.json',JSON.stringify(report,null,2)+'\n');
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
},180000);
