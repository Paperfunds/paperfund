// Timing-only worker maintenance; never installs SQL, touches protected bundles or starts/stops an API.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadPlan,read,sha,assert,atomic,apiCheck,snapshot,workerHealth,drain,start,verifyInstalledDatabase,protectedUpdate,contentHash,sql,processInfo,ps} from './reward-deployment-v3.mjs';
const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
function runtimeFor(p,file,pin){const r=structuredClone(p.timingOnly.runtimeBefore);r.rewardDeployment={plan:file,sha256:pin,operation:fileURLToPath(import.meta.url),operationSHA256:sha(fileURLToPath(import.meta.url)),mode:'CANDIDATE'};return r;}
export async function timing(file,pin,action='Check',approved=false,fault=''){
 file=path.resolve(file);const p=loadPlan(file,pin),t=p.timingOnly;
 assert(t&&['Check','Switch','Rollback','StartWorker'].includes(action),'TIMING_ACTION');
 assert(!fault||p.environment==='Fixture','PRODUCTION_FAULT_INJECTION_REFUSED');
 if(action!=='Check')assert(approved,'OWNER_TIMING_APPROVAL_REQUIRED');
 if(action!=='Check'&&p.environment==='Production')assert(ps("$p=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent());$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)")==='False','UNELEVATED_WORKER_OPERATION_REQUIRED');
 assert(sha(t.parentPlan)===t.parentSHA256,'PARENT_DEPLOYMENT_PIN');
 const parent=read(t.parentPlan);await apiCheck(p);await verifyInstalledDatabase(p);
 assert(sha(p.launcher.file)===p.launcher.newSHA256,'LAUNCHER_CHANGED');
 for(const f of p.protectedUpdate.files)assert(sha(path.join(p.protectedUpdate.target,f.name))===f.newSHA256,'INSTALLED_VERIFIER_CHANGED');
 const safety=await snapshot(p);assert(safety.stop.stopped&&safety.signed===0&&safety.broadcast===0&&safety.executions===0,'FINANCIAL_STOP_REQUIRED');
 assert(contentHash(safety)===t.safetySHA256,'FINANCIAL_OR_ENTRY_CHANGED');
 const stateFile=path.join(p.workDirectory,'deployment-state.json'),journalFile=path.join(p.workDirectory,'timing-'+pin.slice(0,16)+'.json');
 let state=read(stateFile),journal=fs.existsSync(journalFile)?read(journalFile):null;
 const before=state.planSHA256===t.parentSHA256&&state.phase==='CANDIDATE'&&contentHash(state)===t.stateSHA256;
 const own=state.planSHA256===pin;
 assert(before||own||action==='Rollback'&&journal,'TIMING_STATE_PIN');
 const runtimeHash=sha(p.runtimeFile),newRuntime=runtimeFor(p,file,pin);
 assert([t.runtimeSHA256,contentHashBytes(newRuntime)].includes(runtimeHash),'TIMING_RUNTIME_DRIFT');
 const policy=(await sql(p,`begin read only;select to_jsonb(x) value from current_quote_settlement_policies x where id=${literal(p.policy.id)};rollback;`))[0]?.value;
 if(own&&state.phase==='CANDIDATE')assert(policy&&Date.parse(policy.effective_from)===Date.parse(p.policy.effectiveFrom)&&policy.selection_version==='DURABLE_QUOTE_V2','TIMING_POLICY_BINDING');
 if(action==='Check')return{passed:true,action,phase:state.phase,activePolicy:own?p.policy.id:parent.policy.id,requestedPolicy:p.policy.id,requestedPolicyEnrolled:!!policy,apiPID:p.api.pid,health:await workerHealth(p,state.worker),canStartBefore:t.startBefore,completionBefore:p.policy.effectiveFrom};
 const lock=path.join(p.workDirectory,'operation.lock');
 if(fs.existsSync(lock)){const owner=read(lock),proc=processInfo(owner.pid);assert(!proc||proc.createdAt!==owner.createdAt,'ANOTHER_WORKER_OPERATION_ACTIVE');fs.renameSync(lock,lock+'.abandoned-'+randomUUID());}
 const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify(processInfo(process.pid)));fs.fsyncSync(fd);fs.closeSync(fd);
 const record=()=>atomic(stateFile,state),recordJournal=()=>atomic(journalFile,journal);
 const verifySafety=async()=>{await apiCheck(p);assert(contentHash(await snapshot(p))===t.safetySHA256,'FINANCIAL_OR_ENTRY_CHANGED');for(const f of p.protectedUpdate.files)assert(sha(path.join(p.protectedUpdate.target,f.name))===f.newSHA256,'VERIFIER_CHANGED');};
 const rollback=async()=>{
  assert(journal,'TIMING_RECOVERY_JOURNAL_REQUIRED');journal.phase='ROLLING_BACK';recordJournal();
  const starting=path.join(p.workDirectory,'starting-worker.json');
  if(fs.existsSync(starting)){const candidate=read(starting);if(candidate.profile===p.candidateWorker.profile&&candidate.pid!==state.worker?.pid)await drain(p,candidate);}
  if(state.worker&&state.worker.profile===p.candidateWorker.profile)await drain(p,state.worker);
  let old=journal.originalState.worker;
  if(!processInfo(old.pid))old=await start(p,{...p.previousWorker,mode:'CANDIDATE'});
  const health=await workerHealth(p,old);await verifySafety();
  atomic(p.runtimeFile,t.runtimeBefore);state={...journal.originalState,worker:old,lastTimingRollback:{at:new Date().toISOString(),receipt:journalFile}};record();
  journal.phase='ROLLED_BACK_TO_ORIGINAL_POLICY';journal.health=health;journal.completedAt=new Date().toISOString();recordJournal();return health;
 };
 try{
  if(action==='Rollback'){const health=await rollback();return{passed:true,action,phase:journal.phase,activePolicy:parent.policy.id,health};}
  if(action==='StartWorker'){
   assert(own&&state.phase==='CANDIDATE'&&!processInfo(state.worker.pid),'TIMING_START_STATE');state.worker=await start(p,{...p.candidateWorker,mode:'CANDIDATE'});record();await verifySafety();return{passed:true,action};
  }
  assert(before&&!journal&&!policy,'TIMING_SINGLE_ATTEMPT_REQUIRED');
  assert(Date.now()<Date.parse(t.startBefore),'TIMING_START_DEADLINE');
  await workerHealth(p,state.worker);protectedUpdate(p,file,pin,'Check');
  if(p.environment==='Production'){const backup=read(p.backupReceipt);assert(backup.status==='PASS'&&!backup.productionMutated&&Date.now()-Date.parse(backup.createdAt)<3600000,'CURRENT_VERIFIED_RESTORE_RECEIPT_REQUIRED');for(const f of backup.files)assert(sha(path.join(backup.backupDirectory,f.name))===f.sha256,'BACKUP_CHANGED');}
  journal={schema:'PAPERFUND_TIMING_JOURNAL_V1',planSHA256:pin,phase:'PREPARED',originalState:state,originalRuntimeSHA256:runtimeHash,startedAt:new Date().toISOString()};recordJournal();
  assert(Date.now()<Date.parse(t.enrollmentBefore),'FUTURE_ENROLLMENT_DEADLINE');
  await sql(p,`begin;set local lock_timeout='2s';set local statement_timeout='15s';set local timezone='UTC';insert into current_quote_settlement_policies(id,effective_from,ends_before,selection_version,max_age_ms,uncertainty_ms,provider_id) values(${literal(p.policy.id)},${literal(p.policy.effectiveFrom)},${literal(p.policy.endsBefore)},'DURABLE_QUOTE_V2',10000,100,${literal(p.policy.provider)});insert into app_meta(key,value) values(${literal('reward-timing:'+pin)},${literal(pin)});commit;`);
  journal.phase='POLICY_ENROLLED';recordJournal();
  state={...state,planSHA256:pin,phase:'TIMING_DRAINING'};record();await drain(p,state.worker);state.worker=null;state.phase='TIMING_STARTING';record();
  atomic(p.runtimeFile,newRuntime);state.worker=await start(p,{...p.candidateWorker,mode:'CANDIDATE'});record();
  if(fault==='after-start')throw Error('SIMULATED_TIMING_FAILURE');
  await verifySafety();const health=await workerHealth(p,state.worker);assert(Date.now()<Date.parse(p.policy.effectiveFrom),'TIMING_COMPLETION_DEADLINE');
  state.phase='CANDIDATE';state.timingVerifiedAt=new Date().toISOString();record();journal.phase='ACTIVE';journal.health=health;journal.completedAt=state.timingVerifiedAt;recordJournal();
  return{passed:true,action,phase:'CANDIDATE',activePolicy:p.policy.id,activation:p.policy.effectiveFrom,apiPID:p.api.pid,health,protectedFilesReplaced:false,sqlReapplied:false};
 }catch(error){if(journal&&action==='Switch'){try{await rollback();error.message+='; VERIFIED_ORIGINAL_POLICY_RESTORED';}catch{error.message+='; RECOVERY_REQUIRED_KEEP_STOP';}}throw error;}
 finally{fs.unlinkSync(lock);}
}
function contentHashBytes(value){return shaBytes(JSON.stringify(value,null,2)+'\n');}
import {createHash} from 'node:crypto';
function shaBytes(bytes){return createHash('sha256').update(bytes).digest('hex');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [file,pin,action='Check',approval]=process.argv.slice(2);
 try{console.log(JSON.stringify(await timing(file,pin,action,approval==='OWNER_APPROVED_TIMING_POLICY_SWITCH'||action==='StartWorker'&&approval==='OWNER_APPROVED_NONPAYING_DEPLOYMENT')));}catch(e){console.error(e.message);process.exitCode=1;}
}
