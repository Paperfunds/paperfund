// Isolated synthetic files only. No production plan, database, service, task or financial entrypoint.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runProtectedUpdate} from './reward-elevated-update.mjs';
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'docs/reward-accounting-20261027/updater-fix');
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const json=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const sources=['scripts/operator/reward-protected-update-v2.ps1','scripts/operator/reward-update-child.ps1','scripts/operator/reward-elevated-update.mjs','scripts/operator/test-reward-elevation.mjs'];
function prepare(){
 fs.mkdirSync(out,{recursive:true});const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paperfund-reward-deploy-updater-'));
 const cases=[];
 for(const name of ['success','failure','interrupted','integrity']){
  const work=path.join(dir,name),target=path.join(work,'protected');fs.mkdirSync(target,{recursive:true});
  const files=[];for(const file of ['automation-service.bundle.cjs','mainnet-tools.bundle.cjs','automation-install-manifest.json']){
   const original=path.join(target,file),replacement=path.join(work,file+'.replacement');fs.writeFileSync(original,'ISOLATED ORIGINAL '+name+' '+file+'\n');fs.writeFileSync(replacement,'ISOLATED REPLACEMENT '+name+' '+file+'\n');
   files.push({name:file,oldSHA256:hash(original),newSHA256:hash(replacement),source:path.relative(root,replacement)});
  }
  const meta=JSON.parse(execFileSync(ps,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop';if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop};@{directorySddl=(Get-Acl -LiteralPath ${quote(target)}).Sddl;files=@(${files.map(f=>`@{name=${quote(f.name)};sddl=(Get-Acl -LiteralPath ${quote(path.join(target,f.name))}).Sddl}`).join(';')})}|ConvertTo-Json -Depth 5 -Compress`],{encoding:'utf8',windowsHide:true}));
  files.forEach(f=>f.sddl=meta.files.find(x=>x.name===f.name).sddl);
  const p={schema:'PAPERFUND_REWARD_DEPLOYMENT_V1',environment:'Fixture',repositoryRoot:root,workDirectory:work,protectedUpdate:{target,directorySddl:meta.directorySddl,files,unchanged:[]},files:[...sources.map(f=>({path:f,sha256:hash(path.join(root,f))})),...files.map(f=>({path:f.source,sha256:f.newSHA256}))]};
  const file=path.join(work,'plan.json');fs.writeFileSync(file,JSON.stringify(p,null,2)+'\n');cases.push({name,file,pin:hash(file),target});
 }
 const manifest={schema:'PAPERFUND_ISOLATED_ELEVATION_SUITE_V1',createdAt:new Date().toISOString(),root:dir,productionMutated:false,scope:'Four synthetic fixture directories only; no production files/services/database/tasks; RunAs Windows PowerShell per updater call',files:sources.map(f=>({path:path.join(root,f),sha256:hash(path.join(root,f))})),cases};
 const file=path.join(out,'elevation-suite.json');fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({file,pin:hash(file),scope:manifest.scope,fixtureRoot:dir}));
}
function rehearse(file,pin,elevate){
 assert.equal(hash(file),pin);const suite=json(file);
 assert.ok(suite.root.startsWith(path.join(os.tmpdir(),'paperfund-reward-deploy-updater-')));
 for(const x of suite.files)assert.equal(hash(x.path),x.sha256);
 const evidence=[];
 const invoke=(c,action,fault=0)=>{
  const p=json(c.file);assert.ok(p.protectedUpdate.target.startsWith(suite.root+path.sep));assert.equal(p.environment,'Fixture');
  // Deliberately pass a relative plan: the parent must resolve it before the System32 child starts.
  try{const r=runProtectedUpdate(p,path.relative(process.cwd(),c.file),c.pin,action,fault,{elevate});evidence.push(r);return r;}
  catch(e){assert.ok(e.diagnostic&&e.receipt,e.message);evidence.push({...e.diagnostic,parentReceipt:e.receipt});return e.diagnostic;}
 };
 const verify=(c,state)=>{for(const f of json(c.file).protectedUpdate.files)assert.equal(hash(path.join(c.target,f.name)),state==='original'?f.oldSHA256:f.newSHA256);};
 for(const c of suite.cases){
  assert.equal(hash(c.file),c.pin);
  if(c.name==='success'){
   const r=invoke(c,'Install');assert.equal(r.passed,true);assert.equal(r.processExitCode,0);assert.equal(r.childResult.elevated,elevate);assert.ok(path.isAbsolute(r.childResult.plan));assert.match(r.childResult.workingDirectory,/system32/i);verify(c,'replacement');
   assert.equal(invoke(c,'Restore').passed,true);verify(c,'original');
  }else if(c.name==='failure'){
   const r=invoke(c,'Install',1);assert.equal(r.passed,false);assert.equal(r.processExitCode,1);assert.equal(r.childResult.recovery,'RESTORED');assert.ok(r.childResult.errors.some(e=>e.code==='SIMULATED_REPLACEMENT_FAILURE'));verify(c,'original');
  }else if(c.name==='interrupted'){
   const r=invoke(c,'Install',-1);assert.equal(r.status,'INTERRUPTED');assert.equal(r.processExitCode,91);assert.equal(r.childResult.status,'RUNNING');
   assert.equal(invoke(c,'Restore').passed,true);verify(c,'original');
  }else{
   const source=json(c.file).protectedUpdate.files[0].source;fs.appendFileSync(source,'INTENTIONAL FIXTURE TAMPER\n');
   const r=invoke(c,'Install');assert.equal(r.passed,false);assert.equal(r.processExitCode,1);assert.equal(r.childResult.operation,'VERIFY_PACKAGE');assert.ok(r.childResult.errors.length);verify(c,'original');
  }
 }
 const result={at:new Date().toISOString(),passed:true,actualRunAs:elevate,elevatedChildReceipts:evidence.filter(x=>x.childResult?.elevated).length,parentChildExitPropagation:true,absolutePlanFromSystem32:true,successfulReplacementAndRestore:true,intentionalFailureCapturedAndRestored:true,interruptionCapturedAndRecovered:true,integrityRejected:true,productionMutated:false,financialAuthority:'NONE',suiteFile:file,suiteSHA256:pin,evidence};
 fs.writeFileSync(path.join(out,elevate?'elevated-rehearsal.json':'local-rehearsal.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,evidence:evidence.map(r=>({action:r.action,status:r.status,exitCode:r.processExitCode,receipt:r.parentReceipt}))}));
}
try{
 const [action,file,pin,approval]=process.argv.slice(2);
 if(action==='Prepare')prepare();
 else if(action==='Local')rehearse(path.resolve(file),pin,false);
 else if(action==='Elevated'){assert.equal(approval,'OWNER_APPROVED_ISOLATED_ELEVATION');rehearse(path.resolve(file),pin,true);}
 else throw Error('ACTION_REQUIRED');
}catch(e){console.error(e.message);process.exitCode=1;}
