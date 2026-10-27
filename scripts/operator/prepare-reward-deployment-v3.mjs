// Package only: reads installed runtime/code metadata; does not modify production or read custody.
import fs from 'node:fs';
import path from 'node:path';
import { sha,read,assert,ps,quote,processInfo,sql,contentHash } from './reward-deployment-v3.mjs';
import {installedSchema} from './reward-installed-schema.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export function protectedMetadata(target){
  const script=`$ErrorActionPreference='Stop';if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop};$t=${quote(target)};$files=@('automation-service.bundle.cjs','mainnet-tools.bundle.cjs','automation-install-manifest.json');@{directorySddl=(Get-Acl -LiteralPath $t).Sddl;files=@($files|ForEach-Object {@{name=$_;sddl=(Get-Acl -LiteralPath (Join-Path $t $_)).Sddl}})}|ConvertTo-Json -Depth 8 -Compress`;
  return JSON.parse(ps(script));
}
export async function prepare({directory,environment='Production',fixture,predecessor}){
  assert(!fs.existsSync(directory),'NEW_PACKAGE_ONLY');fs.mkdirSync(directory,{recursive:true});
  const candidate=path.join(root,'docs/reward-accounting-20261027/candidate-final-reviewed');
  assert(sha(path.join(candidate,'review.json'))==='2b3a26f2df0c97acc8f5a7e1b8adee6d159bf1a8b99e303cdc291e036ab3356f','CANDIDATE_PIN');
  const review=read(path.join(candidate,'review.json'));
  const runtimeFile=fixture?.runtimeFile??path.join(process.env.LOCALAPPDATA,'PaperfundOperator/runtime.json'),runtime=read(runtimeFile);
  const originalBase=path.join(root,'docs/operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified');
  const base=fixture?.base??originalBase;
  assert(sha(path.join(originalBase,'release.json'))===review.baseManifestSHA256,'BASE_V6_PIN');
  const apiProfile=fixture?.apiProfile??path.join(root,'docs/linked-pair-20261024/public-startup-qualification-20261026/production-profile.json');
  const profile=read(apiProfile),workerConfig=read(runtime.worker.environmentFile);
  const defaultWork=path.join(process.env.LOCALAPPDATA,'PaperfundOperator/reward-deployment-20261027');
  const recoveryReceipt=fixture?.receipt??read(path.join(defaultWork,'starting-worker.json'));
  const api=processInfo(fixture?.apiPID??29660),old=processInfo(fixture?.workerPID??recoveryReceipt.pid);
  assert(api&&old&&api.command.includes(path.join(base,'runtime/api.mjs'))&&old.command.includes(path.join(base,'runtime/worker.mjs')),'ACTUAL_V6_PAIR_REQUIRED');
  const host=new URL(workerConfig.SOLANA_RPC_URL).hostname,provider=host.endsWith('.helius-rpc.com')?'HELIUS':host==='api.mainnet-beta.solana.com'||host==='api.mainnet.solana.com'?'PUBLIC_SOLANA':'CUSTOM_RPC';
  const start=new Date(Math.ceil(Math.max(Date.now()+2*3600000,Date.parse('2026-10-27T18:00:00Z'))/3600000)*3600000).toISOString();
  const policy={id:'reward-deploy-'+start.replace(/\W/g,''),effectiveFrom:start,endsBefore:new Date(Date.parse(start)+72*3600000).toISOString(),provider};
  const publicProfile={...profile,rewardSettlement:{model:'DURABLE_QUOTE_V2',policyId:policy.id}};
  // Sharing the existing control directory permits the established file-drain protocol.
  const profileFile=path.join(directory,'worker-profile.json');fs.writeFileSync(profileFile,JSON.stringify(publicProfile,null,2)+'\n');
  const target=fixture?.protectedTarget??path.join(process.env.ProgramFiles,'PaperfundSigner'),meta=protectedMetadata(target);
  const originalManifest=read(path.join(target,'automation-install-manifest.json'));
  const successor=structuredClone(originalManifest);
  const updates=review.operatorFiles.map(f=>{
    const name=path.basename(f.path),entries=successor.files.filter(e=>e.name===name);assert(entries.length===1,'INSTALLED_MANIFEST_ENTRY_REQUIRED');
    assert(sha(path.join(target,name))===entries[0].sha256,'INSTALLED_PREIMAGE_MISMATCH:'+name);
    const oldSHA256=entries[0].sha256;entries[0].sha256=f.sha256;
    return{name,oldSHA256,newSHA256:f.sha256,source:path.relative(root,path.join(candidate,f.path)),sddl:meta.files.find(e=>e.name===name).sddl};
  });
  const manifestFile=path.join(directory,'automation-install-manifest.next.json');fs.writeFileSync(manifestFile,JSON.stringify(successor,null,2)+'\n');
  updates.push({name:'automation-install-manifest.json',oldSHA256:sha(path.join(target,'automation-install-manifest.json')),newSHA256:sha(manifestFile),source:path.relative(root,manifestFile),sddl:meta.files.find(e=>e.name==='automation-install-manifest.json').sddl});
  const unchanged=originalManifest.files.filter(e=>!updates.some(u=>u.name===e.name));
  for(const e of unchanged)assert(sha(path.join(target,e.name))===e.sha256,'UNCHANGED_INSTALLED_HASH_MISMATCH:'+e.name);
  const workDirectory=fixture?.workDirectory??defaultWork;
  const apiEntry=path.join(base,'runtime/api.mjs'),oldEntry=path.join(base,'runtime/worker.mjs'),newEntry=path.join(candidate,'worker.mjs');
  const configurations=Object.fromEntries(['api','worker','operator'].map(role=>{const file=runtime[role].environmentFile;return[role,{file,sha256:sha(file)}]}));
  const aligned=structuredClone(runtime);
  for(const role of ['api','worker']){aligned[role].script=path.relative(root,role==='api'?apiEntry:newEntry);aligned[role].sha256=sha(role==='api'?apiEntry:newEntry);aligned[role].buildManifest=path.relative(root,path.join(base,'release.json'));aligned[role].buildManifestSha256=sha(path.join(base,'release.json'));}
  aligned.currentQuotes={release:base,releaseSHA256:review.baseManifestSHA256,profileFile:apiProfile,profileSHA256:sha(apiProfile)};
  const alignedFile=path.join(directory,'runtime.aligned.json');fs.writeFileSync(alignedFile,JSON.stringify(aligned,null,2)+'\n');
  const launcher=fixture?.launcher??path.join(root,'scripts/operator/launcher.ps1');
  const p={schema:'PAPERFUND_REWARD_DEPLOYMENT_V1',environment,repositoryRoot:root,createdAt:new Date().toISOString(),financialAuthority:'NONE',node:{file:api.exe,sha256:sha(api.exe)},api:{pid:api.pid,createdAt:api.createdAt,entry:apiEntry,sha256:sha(apiEntry),profile:apiProfile,profileSHA256:sha(apiProfile),port:fixture?3397:3000},runtimeFile,runtimePreimageSHA256:sha(runtimeFile),alignedRuntime:path.relative(root,alignedFile),launcher:{file:launcher,oldSHA256:sha(launcher),source:'scripts/operator/reward-launcher-v2.ps1',newSHA256:sha(path.join(root,'scripts/operator/reward-launcher-v2.ps1'))},configurations,workDirectory,heartbeat:workerConfig.WORKER_HEARTBEAT_FILE,previousWorker:{mode:'BASELINE',pid:old.pid,createdAt:old.createdAt,entry:oldEntry,sha256:sha(oldEntry),profile:apiProfile,profileSHA256:sha(apiProfile),controlDirectory:profile.controlDirectory,heartbeatFile:path.join(base,'runtime/logs/worker-heartbeat.json')},candidateWorker:{entry:newEntry,sha256:sha(newEntry),profile:profileFile,profileSHA256:sha(profileFile),controlDirectory:profile.controlDirectory,heartbeatFile:fixture?path.join(workDirectory,'candidate-heartbeat.json'):path.join(root,'logs/worker-heartbeat.json')},policy,schemas:review.schemas.map(f=>path.relative(root,path.join(candidate,f.path))),protectedUpdate:{target,directorySddl:meta.directorySddl,files:updates,unchanged},database:{container:'paperfund-postgres-1',name:'paperfund'},backupReceipt:path.join(workDirectory,'backup','RECOVERY_VERIFICATION.json')};
  p.heartbeat=path.resolve(root,p.heartbeat??'logs/worker-heartbeat.json');
  const pre=await sql(p,"begin read only;select json_build_object('force',md5(pg_get_functiondef('verify_legacy_forced_fill()'::regprocedure)),'digest',md5(pg_get_functiondef('legacy_hour_digest(text)'::regprocedure))) value;rollback;");p.database.preimages=pre[0].value;
  const oldPin=fixture?.predecessorPackageSHA256??'cecafa4b8f9ac758ccc205c32c78ada276ec9789a87e3e3275a48ce7a03d86b4';
  const committed=(await sql(p,"begin read only;select json_build_object('marker',(select value from app_meta where key='reward-deployment:"+oldPin+"'),'policy',(select to_jsonb(x) from current_quote_settlement_policies x where id='"+(fixture?.oldPolicyId??'reward-deploy-20261027T170000000Z')+"')) value;rollback;"))[0].value;
  assert(committed.marker===oldPin&&committed.policy,'COMMITTED_INSTALLATION_REQUIRED');
  const catalog=await installedSchema(p,sql);
  p.database.reconciled={approvedPackageSHA256:oldPin,policy:committed.policy,schemaSHA256:catalog.sha256};
  fs.writeFileSync(path.join(directory,'installed-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
  const priorState=read(path.join(workDirectory,'deployment-state.json'));
  if(priorState.phase==='ROLLING_BACK')p.recovery={predecessorPackageSHA256:oldPin,stateSHA256:contentHash(priorState),workerReceiptSHA256:contentHash(recoveryReceipt),reviewFingerprint:fixture?.reviewFingerprint??'b79a5fee47ee33ab22474fd439de9e81'};
  else {assert(priorState.phase==='ROLLED_BACK'&&priorState.worker?.pid===old.pid,'FORMAL_BASELINE_REQUIRED');p.predecessorBaseline={planSHA256:priorState.planSHA256,stateSHA256:contentHash(priorState)};}
  if(environment==='Production'){
   const originalPin='ceb7f913ac2450895f8633a9a8f9329631dd37413f5c43e469b7a4c0edb6d5da';
   const original=(await sql(p,`begin read only;select json_build_object('marker',(select value from app_meta where key='reward-deployment:${originalPin}'),'policy',(select to_jsonb(x) from current_quote_settlement_policies x where id='reward-deploy-20261027T140000000Z')) value;rollback;`))[0].value;
   assert(original.marker===originalPin&&original.policy,'ORIGINAL_ENROLLMENT_REQUIRED');
   p.database.reconciled.additional=[{packageSHA256:originalPin,policy:original.policy}];
   const rehearsal=read(path.join(root,'docs/reward-accounting-20261027/updater-fix/elevated-rehearsal.json'));
   assert(rehearsal.passed&&rehearsal.actualRunAs&&rehearsal.elevatedChildReceipts===6,'ACTUAL_ELEVATION_REHEARSAL_REQUIRED');
  }
  const files=new Set(['scripts/operator/reward-deployment-v3.mjs','scripts/operator/reward-installed-schema.mjs','scripts/operator/reward-protected-update-v2.ps1','scripts/operator/reward-update-child.ps1','scripts/operator/reward-elevated-update.mjs','scripts/operator/reward-launcher-v2.ps1',path.relative(root,profileFile),path.relative(root,manifestFile),path.relative(root,alignedFile),path.relative(root,path.join(directory,'installed-catalog.json')),path.relative(root,path.join(candidate,'review.json')),path.relative(root,apiEntry),path.relative(root,oldEntry),path.relative(root,newEntry),path.relative(root,apiProfile),...p.schemas,...updates.map(f=>f.source)]);
  if(environment==='Production')for(const f of ['scripts/operator/prepare-reward-deployment-v3.mjs','scripts/operator/test-reward-elevation.mjs','docs/reward-accounting-20261027/updater-fix/elevated-rehearsal.json','docs/reward-accounting-20261027/updater-fix/elevation-suite.json','docs/reward-accounting-20261027/updater-fix/local-rehearsal.json','docs/reward-accounting-20261027/updater-fix/windows-failure-evidence.json','packages/db/test/reward-recovery.integration.test.ts','docs/reward-accounting-20261027/recovery.config.mjs','docs/reward-accounting-20261027/recovery-rehearsal.json','docs/reward-accounting-20261027/recovery-tests.json','docs/reward-accounting-20261027/deployment-durability-tests.json','scripts/operator/verify-local-recovery.mjs','scripts/db-backup.ps1'])files.add(f);
  p.files=[...files].map(f=>({path:f,sha256:sha(path.resolve(root,f))}));
  const file=path.join(directory,'deployment.json');fs.writeFileSync(file,JSON.stringify(p,null,2)+'\n');
  return{file,pin:sha(file),plan:p};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(import.meta.dirname,'prepare-reward-deployment-v3.mjs')){
 try{const result=await prepare({directory:path.join(root,'docs/reward-accounting-20261027/updater-fixed-release')});console.log(JSON.stringify({file:result.file,pin:result.pin}));}catch(e){console.error(e.message);process.exitCode=1;}
}
