import{it,expect}from'vitest';
import fs from'node:fs';import os from'node:os';import path from'node:path';import{spawn}from'node:child_process';
import{fixture}from'./legacy-beta-fixture.js';
import{read,sha,processInfo,drain,workerHealth,sql}from'../../../scripts/operator/reward-deployment-v3.mjs';
import{protectedMetadata}from'../../../scripts/operator/prepare-reward-deployment-v3.mjs';
import{installedSchema}from'../../../scripts/operator/reward-installed-schema.mjs';
import{prepareTiming}from'../../../scripts/operator/prepare-reward-policy-timing.mjs';
import{timing}from'../../../scripts/operator/reward-policy-timing.mjs';
it('switches only timing on the real candidate, preserves API/verifiers/policies, and restores the original candidate on failure',async()=>{
 const f=await fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'paperfund-reward-deploy-timing-')),root=process.cwd();let p:any,api:any,worker:any;
 const wait=async(fn:()=>Promise<boolean>|boolean)=>{for(let n=0;n<80;n++){if(await fn())return;await new Promise(r=>setTimeout(r,250));}throw Error('TIMING_FIXTURE_READY');};
 try{
  for(const name of['settlement.sql','durable.sql','platform-accounting.sql','grants.sql'])await f.db.pool.query(fs.readFileSync('packages/db/isolated/current-quotes/'+name,'utf8'));
  const prod=read('docs/reward-accounting-20261027/updater-fixed-release/deployment.json'),database=(await f.db.pool.query('select current_database() n')).rows[0].n;
  const config={DATABASE_URL:'postgresql://beta:disposable-beta-only@127.0.0.1:55462/'+database,REDIS_URL:'redis://127.0.0.1:6381/15',SOLANA_RPC_URL:'https://example.invalid',PRIVATE_BETA_NON_PAYING:'true',BETA_INVITE_ONLY:'true',PAYOUT_EXECUTION_ENABLED:'false',PAYOUT_SIGNER_TYPE:'DISABLED',CREATOR_FEE_INGESTION_ENABLED:'false',CREATOR_FEE_SHADOW_MODE:'true',WORKER_TICK_INTERVAL_MS:'500',API_HOST:'127.0.0.1',API_PORT:'3397',WORKER_HEARTBEAT_FILE:path.join(dir,'worker-heartbeat.json')};
  const cfg=path.join(dir,'worker.json');fs.writeFileSync(cfg,JSON.stringify(config));
  const control=path.join(dir,'control');fs.mkdirSync(control);
  const next=new Date(Math.ceil((Date.now()+3600000)/3600000)*3600000),old=new Date(next.getTime()+3600000),end=new Date(old.getTime()+72*3600000);
  await f.db.pool.query("insert into current_quote_settlement_policies(id,effective_from,ends_before,selection_version,provider_id) values('timing-parent-policy',$1,$2,'DURABLE_QUOTE_V2','CUSTOM_RPC')",[old,end]);
  const profile={...read(prod.candidateWorker.profile),archiveDirectory:path.join(dir,'archive'),controlDirectory:control,qualification:{apiPort:3397},rewardSettlement:{model:'DURABLE_QUOTE_V2',policyId:'timing-parent-policy'}};
  const profileFile=path.join(dir,'profile.json');fs.writeFileSync(profileFile,JSON.stringify(profile));
  const launch=(entry:string,role:string)=>{const out=fs.openSync(path.join(dir,role+'.log'),'a');const child=spawn(process.execPath,[entry,profileFile,sha(profileFile)],{cwd:root,windowsHide:true,env:{...process.env,...config},stdio:['ignore',out,out]});fs.closeSync(out);return child;};
  worker=launch(prod.candidateWorker.entry,'worker');api=launch(prod.api.entry,'api');
  await wait(()=>fs.existsSync(config.WORKER_HEARTBEAT_FILE));await wait(async()=>{try{return(await fetch('http://127.0.0.1:3397/ready')).status===200;}catch{return false;}});
  const receipt={...prod.candidateWorker,profile:profileFile,profileSHA256:sha(profileFile),controlDirectory:control,heartbeatFile:config.WORKER_HEARTBEAT_FILE,mode:'CANDIDATE',pid:worker.pid,createdAt:processInfo(worker.pid).createdAt};
  const protectedTarget=path.join(dir,'protected');fs.mkdirSync(protectedTarget);for(const entry of [...prod.protectedUpdate.files,...prod.protectedUpdate.unchanged])fs.copyFileSync(path.join(prod.protectedUpdate.target,entry.name),path.join(protectedTarget,entry.name));
  const meta=protectedMetadata(protectedTarget),work=path.join(dir,'work');fs.mkdirSync(work);
  const launcher=path.join(dir,'launcher.ps1');fs.copyFileSync(prod.launcher.file,launcher);
  const runtimeFile=path.join(dir,'runtime.json');fs.writeFileSync(runtimeFile,JSON.stringify({rewardDeployment:{mode:'CANDIDATE'}}));
  p={...prod,environment:'Fixture',configurations:Object.fromEntries(['api','worker','operator'].map(role=>[role,{file:cfg,sha256:sha(cfg)}])),runtimeFile,workDirectory:work,api:{...prod.api,pid:api.pid,createdAt:processInfo(api.pid).createdAt,port:3397,profile:profileFile,profileSHA256:sha(profileFile)},previousWorker:receipt,candidateWorker:receipt,policy:{id:'timing-parent-policy',effectiveFrom:old.toISOString(),endsBefore:end.toISOString(),provider:'CUSTOM_RPC'},launcher:{...prod.launcher,file:launcher},protectedUpdate:{...prod.protectedUpdate,target:protectedTarget,directorySddl:meta.directorySddl,files:prod.protectedUpdate.files.map((x:any)=>({...x,sddl:meta.files.find((y:any)=>y.name===x.name).sddl}))}};
  const prior=(await f.db.pool.query("select to_jsonb(x) p from current_quote_settlement_policies x where id='timing-parent-policy'")).rows[0].p;
  p.database={...prod.database,reconciled:{approvedPackageSHA256:'fixture-parent-marker',policy:prior,schemaSHA256:(await installedSchema(p,sql)).sha256}};
  await f.db.pool.query("insert into app_meta(key,value) values('reward-deployment:fixture-parent-marker','fixture-parent-marker')");
  const parentFile=path.join(dir,'parent.json');fs.writeFileSync(parentFile,JSON.stringify(p));const parentPin=sha(parentFile);
  await f.db.pool.query('insert into app_meta(key,value) values($1,$2)',['reward-deployment:'+parentPin,parentPin]);
  const stateFile=path.join(work,'deployment-state.json');fs.writeFileSync(stateFile,JSON.stringify({planSHA256:parentPin,phase:'CANDIDATE',worker:receipt}));
  const apiIdentity=processInfo(api.pid),protectedHashes=p.protectedUpdate.files.map((x:any)=>sha(path.join(protectedTarget,x.name)));
  const first=await prepareTiming(parentFile,parentPin,path.join(dir,'switch'),{start:next.toISOString(),id:'timing-fixture-first'});
  expect((await timing(first.file,first.pin,'Check')).activePolicy).toBe('timing-parent-policy');
  expect((await timing(first.file,first.pin,'Switch',true)).activePolicy).toBe('timing-fixture-first');
  expect((await timing(first.file,first.pin,'Check')).health.advancing).toBe(true);
  expect((await timing(first.file,first.pin,'Rollback',true)).activePolicy).toBe('timing-parent-policy');
  const second=await prepareTiming(parentFile,parentPin,path.join(dir,'failure'),{start:next.toISOString(),id:'timing-fixture-failure'});
  await expect(timing(second.file,second.pin,'Switch',true,'after-start')).rejects.toThrow('VERIFIED_ORIGINAL_POLICY_RESTORED');
  const finalState=read(stateFile);expect(finalState.planSHA256).toBe(parentPin);expect(finalState.phase).toBe('CANDIDATE');expect((await workerHealth({...p,previousWorker:finalState.worker},finalState.worker)).advancing).toBe(true);
  expect(processInfo(api.pid)).toEqual(apiIdentity);expect((await fetch('http://127.0.0.1:3397/ready')).status).toBe(200);
  expect(p.protectedUpdate.files.map((x:any)=>sha(path.join(protectedTarget,x.name)))).toEqual(protectedHashes);
  expect((await f.db.pool.query("select to_jsonb(x) p from current_quote_settlement_policies x where id='timing-parent-policy'")).rows[0].p).toEqual(prior);
 }finally{
  if(p){const stateFile=path.join(p.workDirectory,'deployment-state.json');if(fs.existsSync(stateFile))await drain({...p,previousWorker:read(stateFile).worker},read(stateFile).worker).catch(()=>{});}
  if(api?.pid){const requestId='cleanup-'+Date.now();fs.writeFileSync(path.join(dir,'control/api-drain.request.json'),JSON.stringify({schema:'PAPERFUND_DRAIN_V1',requestId}));await wait(()=>!processInfo(api.pid)).catch(()=>{});}
  await f.cleanup();
 }
},600000);
