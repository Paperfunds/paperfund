// Reviewed worker-only operation. Defaults to Check; never starts, stops or replaces an API.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {runProtectedUpdate} from './reward-elevated-update.mjs';
import {installedSchema} from './reward-installed-schema.mjs';
export const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
export const assert = (v, e) => { if (!v) throw Error(e); };
const pause = ms => new Promise(r => setTimeout(r, ms));
const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
export const contentHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function atomic(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
export function ps(code,timeout=20000) {
  try { return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', code], { encoding: 'utf8', windowsHide: true, timeout }).trim(); }
  catch { throw Error('WINDOWS_IDENTITY_CHECK_FAILED'); }
}
export const quote = v => "'" + v.replaceAll("'", "''") + "'";
export function processInfo(pid) {
  const raw = ps(`$x=Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}';if($x){@{pid=$x.ProcessId;exe=$x.ExecutablePath;createdAt=$x.CreationDate.ToUniversalTime().ToString('o');command=$x.CommandLine}|ConvertTo-Json -Compress}`);
  return raw ? JSON.parse(raw) : null;
}
function safePath(file) {
  let p = path.resolve(file);
  while (fs.existsSync(p)) { assert(!fs.lstatSync(p).isSymbolicLink(), 'REPARSE_PATH_REFUSED'); const next = path.dirname(p); if (next === p) break; p = next; }
}
export function loadPlan(file, pin) {
  const raw=fs.readFileSync(file);
  assert(/^[a-f0-9]{64}$/.test(pin) && createHash('sha256').update(raw).digest('hex') === pin, 'DEPLOYMENT_PLAN_PIN');
  const p = JSON.parse(raw.toString('utf8'));
  assert(p.schema === 'PAPERFUND_REWARD_DEPLOYMENT_V1', 'DEPLOYMENT_SCHEMA');
  assert(['Production', 'Fixture'].includes(p.environment), 'DEPLOYMENT_ENVIRONMENT');
  if (p.environment === 'Fixture') {
    assert(p.workDirectory.startsWith(path.join(process.env.TEMP, 'paperfund-reward-deploy-')), 'FIXTURE_WORK_SCOPE');
    const u = new URL(read(p.configurations.worker.file).DATABASE_URL);
    assert(u.hostname === '127.0.0.1' && u.port === '55462' && /^\/(legacy_beta|reward_deploy)_[a-z0-9_]+$/.test(u.pathname), 'FIXTURE_DB_SCOPE');
    assert(p.api.port === 3397 && p.runtimeFile.startsWith(path.dirname(p.workDirectory) + path.sep), 'FIXTURE_API_SCOPE');
  } else {
    assert(p.api.port === 3000 && p.database.container === 'paperfund-postgres-1' && p.database.name === 'paperfund', 'PRODUCTION_DB_SCOPE');
    assert(p.runtimeFile === path.join(process.env.LOCALAPPDATA, 'PaperfundOperator/runtime.json'), 'PRODUCTION_RUNTIME_SCOPE');
  }
  for (const f of p.files) { const target = path.resolve(p.repositoryRoot, f.path); safePath(target); assert(sha(target) === f.sha256, 'PACKAGE_CHANGED:' + f.path); }
  const base=path.join(p.repositoryRoot,'docs/operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified');
  assert(sha(path.join(base,'release.json'))==='0fac0d6c89d3cb557d409ab1a63db57e0938f0addd27e0ec054112a7de4337f6','BASE_MANIFEST_PIN');
  const parent=read(path.join(base,'release.json'));
  for(const f of parent.files)assert(sha(path.join(base,f.path))===f.sha256,'FROZEN_DEPENDENCY_CHANGED:'+f.path);
  assert(sha(p.node.file) === p.node.sha256, 'NODE_CHANGED');
  for (const c of Object.values(p.configurations)) assert(sha(c.file) === c.sha256, 'CONFIG_CHANGED');
  for (const n of ['NODE_OPTIONS', 'NODE_PATH']) assert(!process.env[n], 'NODE_OVERRIDE_REFUSED');
  const cfg = read(p.configurations.worker.file);
  for (const [k,v] of Object.entries({PRIVATE_BETA_NON_PAYING:'true',PAYOUT_EXECUTION_ENABLED:'false',PAYOUT_SIGNER_TYPE:'DISABLED',CREATOR_FEE_INGESTION_ENABLED:'false',CREATOR_FEE_SHADOW_MODE:'true'})) assert(cfg[k] === v, 'FINANCIAL_FLAG:' + k);
  for (const k of Object.keys(cfg)) assert(!/KEYPAIR|PRIVATE_KEY|SECRET|AUTHORITY|TREASURY|^NODE_OPTIONS$|^NODE_PATH$/.test(k), 'SERVICE_AUTHORITY_CONFIG_REFUSED');
  return p;
}
export const parseAdminOutput = text => text.trim().split(/\r?\n/).filter(Boolean).map(line=>({value:JSON.parse(line)}));
export async function sql(p, text, args = []) {
  if (p.environment === 'Fixture') {
    const pool = new Pool({ connectionString: read(p.configurations.worker.file).DATABASE_URL, max:1 });
    try { const result=await pool.query(text,args);return Array.isArray(result)?result.flatMap(r=>r.rows??[]):result.rows; } finally { await pool.end(); }
  }
  assert(args.length === 0, 'PRODUCTION_SQL_PARAMETERS_REFUSED');
  try {
    const result = execFileSync('docker', ['exec','-i',p.database.container,'psql','-X','-q','-At','-U','paperfund','-d',p.database.name,'-v','ON_ERROR_STOP=1'], { input: text, encoding:'utf8', timeout:120000, maxBuffer:8*1024*1024, windowsHide:true });
    return parseAdminOutput(result);
  } catch { throw Error('ADMIN_DATABASE_OPERATION_FAILED'); }
}
export async function snapshot(p) {
  return (await sql(p, `begin read only;select json_build_object('stop',(select row_to_json(s) from payout_stop_state s where singleton=true),'reviews',(select md5(coalesce(json_agg(r order by r.id)::text,'')) from legacy_source_reviews r),'entry',(select value from app_meta where key='generic_pumpswap_operator_control_v1'),'signed',(select count(*) from payout_signed_transactions),'broadcast',(select count(*) from payout_broadcast_attempts),'executions',(select count(*) from payout_executions)) value;rollback;`))[0].value;
}
function sameSafety(a,b) { assert(a.stop.stopped && b.stop.stopped && JSON.stringify(a) === JSON.stringify(b), 'SAFETY_OR_ENTRY_CHANGED'); }
export async function apiCheck(p) {
  const proc = processInfo(p.api.pid);
  assert(proc && proc.createdAt === p.api.createdAt && proc.exe === p.node.file && proc.command.includes(p.api.entry) && proc.command.includes(p.api.profileSHA256), 'PRESERVED_V6_API_IDENTITY_CHANGED');
  assert(sha(p.api.entry) === p.api.sha256 && sha(p.api.profile) === p.api.profileSHA256, 'API_ARTIFACT_CHANGED');
  const r = await fetch(`http://127.0.0.1:${p.api.port}/ready`, {signal:AbortSignal.timeout(5000)});
  assert(r.status === 200, 'PRESERVED_API_NOT_READY');
  return proc;
}
export function protectedUpdate(p,file,pin,action,failAfter=0){return runProtectedUpdate(p,path.resolve(file),pin,action,failAfter);}
export async function drain(p, receipt) {
  const proc = processInfo(receipt.pid);
  if (!proc) return;
  assert(proc.createdAt === receipt.createdAt && proc.exe === p.node.file && proc.command.includes(receipt.entry) && sha(receipt.entry) === receipt.sha256, 'WORKER_DRAIN_IDENTITY_CHANGED');
  assert(receipt.pid !== p.api.pid, 'API_DRAIN_REFUSED');
  const requestId = randomUUID(), request = path.join(receipt.controlDirectory,'worker-drain.request.json');
  fs.mkdirSync(receipt.controlDirectory,{recursive:true});
  assert(!fs.existsSync(request), 'UNCONSUMED_DRAIN_REQUEST');
  atomic(request,{schema:'PAPERFUND_DRAIN_V1',requestId});
  const ack = path.join(receipt.controlDirectory,'worker-drained.json');
  for (let i=0;i<120;i++) {
    if (fs.existsSync(ack)) { const a=read(ack); if(a.pid===receipt.pid && a.requestId===requestId && !processInfo(receipt.pid)) { fs.renameSync(request,request+'.consumed-'+requestId); return; } }
    await pause(250);
  }
  throw Error('WORKER_DRAIN_TIMEOUT_NO_FORCE');
}
export function validateHeartbeat(h, stat, receipt, now=Date.now()) {
  assert(h.processId===receipt.pid,'HEARTBEAT_PROCESS_MISMATCH');
  assert(Math.abs(Date.parse(h.startedAt)-Date.parse(receipt.createdAt))<15000,'HEARTBEAT_START_IDENTITY');
  const tick=Date.parse(h.lastTickStartedAt),written=stat.mtimeMs;
  assert(Number.isFinite(tick)&&now-tick>=-1000&&now-tick<30000&&now-written>=-1000&&now-written<30000,'STALE_HEARTBEAT');
  const success=Date.parse(h.lastLifecycleSuccessAt),error=Date.parse(h.lastError?.at);
  const held=h.lastError?.scope==='settlement'&&/PUBLIC_PAPER_REWARD_QUALIFICATION_REQUIRED|CURRENT_CUTOFF_|SETTLEMENT_REVIEW/.test(h.lastError?.message??'')&&now-error>=-1000&&now-error<30000;
  assert(held||(!h.lastError&&Number.isFinite(success)&&now-success>=-1000&&now-success<30000),'LIFECYCLE_NOT_HEALTHY_OR_HELD');
  if(receipt.mode==='CANDIDATE')assert(h.rewardCapture?.model==='DURABLE_QUOTE_V2'&&!h.rewardCapture.serviceFailure,'CAPTURE_COLLECTOR_UNHEALTHY');
  return {tick,status:held?'ACTIVE_WITH_SETTLEMENT_REVIEW':'HEALTHY'};
}
export function uniqueWorker(p,receipt){
  const result=JSON.parse(ps("@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"|Select-Object ProcessId,CommandLine)|ConvertTo-Json -Compress")||'[]');
  const rows=Array.isArray(result)?result:[result];
  const matching=rows.filter(r=>[p.previousWorker,p.candidateWorker].some(s=>r.CommandLine?.includes(s.entry)&&r.CommandLine?.includes(s.profile)));
  assert(matching.length===1&&matching[0].ProcessId===receipt.pid,'DUPLICATE_OR_UNIDENTIFIED_WORKER');
}
export async function workerHealth(p,receipt,{timeoutMs=20000}={}){
  const heartbeatFile=receipt.heartbeatFile;
  assert(heartbeatFile&&path.isAbsolute(heartbeatFile),'EXPLICIT_HEARTBEAT_BINDING_REQUIRED');
  assert(sha(receipt.entry)===receipt.sha256&&sha(receipt.profile)===receipt.profileSHA256,'WORKER_HEALTH_ARTIFACT_PIN');
  const proc=processInfo(receipt.pid);
  assert(proc&&proc.exe===p.node.file&&proc.createdAt===receipt.createdAt&&proc.command.includes(receipt.entry)&&proc.command.includes(receipt.profileSHA256),'WORKER_HEALTH_IDENTITY');
  uniqueWorker(p,receipt);
  let first,lastError;
  const until=Date.now()+timeoutMs;
  while(Date.now()<until){
    try{
      assert(!fs.lstatSync(heartbeatFile).isSymbolicLink(),'HEARTBEAT_LINK_REFUSED');const stat=fs.statSync(heartbeatFile);
      const h=read(heartbeatFile),health=validateHeartbeat(h,stat,receipt);
      if(!first)first={tick:health.tick,mtime:stat.mtimeMs};
      else if(health.tick>first.tick&&stat.mtimeMs>first.mtime){
        const after=processInfo(receipt.pid);assert(after?.createdAt===receipt.createdAt,'WORKER_CHANGED_DURING_HEALTH_CHECK');uniqueWorker(p,receipt);
        return{passed:true,pid:receipt.pid,heartbeatFile,firstTick:new Date(first.tick).toISOString(),lastTick:h.lastTickStartedAt,status:health.status,advancing:true};
      }
    }catch(e){lastError=e;}
    await pause(250);
  }
  throw Error('WORKER_HEALTH_TIMEOUT:'+(lastError?.message??'HEARTBEAT_NOT_ADVANCING'));
}
export async function start(p, spec) {
  assert(sha(spec.entry) === spec.sha256 && sha(spec.profile) === spec.profileSHA256, 'WORKER_START_PIN');
  assert(!fs.existsSync(path.join(spec.controlDirectory,'worker-drain.request.json')), 'STALE_DRAIN_REQUEST');
  const processes=JSON.parse(ps("@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"|Select-Object ProcessId,CommandLine)|ConvertTo-Json -Compress")||'[]');
  assert(![...Array.isArray(processes)?processes:[processes]].some(x=>x.CommandLine?.includes(spec.entry)&&x.CommandLine?.includes(spec.profile)),'COMPETING_WORKER_REFUSED');
  // The worker receives only its existing application environment, never protected signer configuration.
  assert(spec.heartbeatFile&&path.isAbsolute(spec.heartbeatFile),'EXPLICIT_HEARTBEAT_BINDING_REQUIRED');
  const cfg=read(p.configurations.worker.file), env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,PATH:process.env.PATH,...cfg,WORKER_HEARTBEAT_FILE:spec.heartbeatFile};
  const stamp=Date.now(),out=fs.openSync(path.join(p.workDirectory,`worker-${stamp}.out.log`),'wx'),err=fs.openSync(path.join(p.workDirectory,`worker-${stamp}.err.log`),'wx');
  let child;try{child=spawn(p.node.file,[spec.entry,spec.profile,spec.profileSHA256],{cwd:p.repositoryRoot,env,windowsHide:true,detached:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
  child.unref();
  await pause(300);
  const proc=processInfo(child.pid);assert(proc,'WORKER_START_FAILED');
  const receipt={...spec,pid:child.pid,createdAt:proc.createdAt};
  atomic(path.join(p.workDirectory,'starting-worker.json'),receipt);
  await workerHealth(p,receipt);return receipt;
}
function sqlLiteral(x){return "'"+String(x).replaceAll("'","''")+"'";}
async function installSchema(p,pin){
  if(p.database.reconciled){
    await verifyInstalledDatabase(p);
    const marker='reward-deployment:'+pin;
    const prior=(await sql(p,`begin read only;select json_build_object('marker',(select value from app_meta where key=${sqlLiteral(marker)}),'policy',(select to_jsonb(x) from current_quote_settlement_policies x where id=${sqlLiteral(p.policy.id)})) value;rollback;`))[0].value;
    if(prior.marker===pin){assert(prior.policy&&Date.parse(prior.policy.effective_from)===Date.parse(p.policy.effectiveFrom)&&prior.policy.provider_id===p.policy.provider,'ENROLLED_POLICY_CHANGED');return;}
    assert(!prior.policy,'UNREVIEWED_EXISTING_POLICY');
    assert(Date.now()<Date.parse(p.policy.effectiveFrom)-60000,'FUTURE_POLICY_START_MISSED');
    await sql(p,`begin;set local lock_timeout='2s';set local statement_timeout='30s';set local timezone='UTC';insert into current_quote_settlement_policies(id,effective_from,ends_before,selection_version,max_age_ms,uncertainty_ms,provider_id) values(${sqlLiteral(p.policy.id)},${sqlLiteral(p.policy.effectiveFrom)},${sqlLiteral(p.policy.endsBefore)},'DURABLE_QUOTE_V2',10000,100,${sqlLiteral(p.policy.provider)});insert into app_meta(key,value) values(${sqlLiteral(marker)},${sqlLiteral(pin)});commit;`);
    return; // Existing migrations and grants are never reapplied.
  }
  const marker='reward-deployment:'+pin;
  const rows=await sql(p,`begin read only;select json_build_object('marker',(select value from app_meta where key=${sqlLiteral(marker)}),'installed',to_regclass('current_quote_settlement_policies') is not null) value;rollback;`);
  if(rows[0].value.marker===pin)return;
  assert(!rows[0].value.installed,'UNREVIEWED_EXISTING_CUTOFF_SCHEMA');
  assert(Date.now()<Date.parse(p.policy.effectiveFrom)-60000,'FUTURE_POLICY_START_MISSED');
  const before=await sql(p,"begin read only;select json_build_object('force',md5(pg_get_functiondef('verify_legacy_forced_fill()'::regprocedure)),'digest',md5(pg_get_functiondef('legacy_hour_digest(text)'::regprocedure))) value;rollback;");
  assert(JSON.stringify(before[0].value)===JSON.stringify(p.database.preimages),'MIGRATION_PREIMAGE_CHANGED');
  const texts=p.schemas.map(f=>fs.readFileSync(path.join(p.repositoryRoot,f),'utf8'));
  const policy=p.policy;
  const text=`begin;set local lock_timeout='2s';set local statement_timeout='30s';set local timezone='UTC';\n${texts.join('\n')}\ninsert into current_quote_settlement_policies(id,effective_from,ends_before,selection_version,max_age_ms,uncertainty_ms,provider_id) values(${sqlLiteral(policy.id)},${sqlLiteral(policy.effectiveFrom)},${sqlLiteral(policy.endsBefore)},'DURABLE_QUOTE_V2',10000,100,${sqlLiteral(policy.provider)});do $$begin if has_table_privilege('paperfund_beta_worker','payout_stop_state','UPDATE') or has_table_privilege('paperfund_beta_worker','current_quote_settlement_policies','INSERT') or not has_function_privilege('paperfund_beta_worker','certify_current_quote_capture(text)','EXECUTE') then raise exception 'REWARD_ROLE_BOUNDARY';end if;end $$;set local role paperfund_beta_api;do $$begin perform legacy_hour_digest('deployment-readonly-nonexistent-round');end $$;reset role;insert into app_meta(key,value) values(${sqlLiteral(marker)},${sqlLiteral(pin)});commit;`;
  await sql(p,text);
}
export async function verifyInstalledDatabase(p){
  const expected=p.database.reconciled;if(!expected)return;
  const actual=await installedSchema(p,sql);assert(actual.sha256===expected.schemaSHA256,'INSTALLED_SCHEMA_OR_GRANTS_DRIFT');
  const value=(await sql(p,`begin read only;select json_build_object('marker',(select value from app_meta where key=${sqlLiteral('reward-deployment:'+expected.approvedPackageSHA256)}),'policy',(select to_jsonb(x) from current_quote_settlement_policies x where id=${sqlLiteral(expected.policy.id)})) value;rollback;`))[0].value;
  assert(value.marker===expected.approvedPackageSHA256&&contentHash(value.policy)===contentHash(expected.policy),'COMMITTED_INSTALLATION_EVIDENCE_DRIFT');
  for(const prior of expected.additional??[]){const row=(await sql(p,`begin read only;select json_build_object('marker',(select value from app_meta where key=${sqlLiteral('reward-deployment:'+prior.packageSHA256)}),'policy',(select to_jsonb(x) from current_quote_settlement_policies x where id=${sqlLiteral(prior.policy.id)})) value;rollback;`))[0].value;assert(row.marker===prior.packageSHA256&&contentHash(row.policy)===contentHash(prior.policy),'ADDITIONAL_ENROLLMENT_EVIDENCE_DRIFT');}
}
export function alignedRuntime(p,mode,file,pin){
  const value=read(path.join(p.repositoryRoot,p.alignedRuntime));
  const worker=mode==='CANDIDATE'?p.candidateWorker:p.previousWorker;
  value.worker.script=path.relative(p.repositoryRoot,worker.entry);value.worker.sha256=worker.sha256;
  const manifest=mode==='CANDIDATE'?path.join(path.dirname(worker.entry),'review.json'):path.resolve(p.repositoryRoot,'docs/operator-candidate/artifact-releases/public-paper-20261026-v6-startup-qualified/release.json');
  value.worker.buildManifest=path.relative(p.repositoryRoot,manifest);value.worker.buildManifestSha256=sha(manifest);
  value.api.launcher=path.relative(p.repositoryRoot,p.launcher.file);value.api.launcherSha256=p.launcher.newSHA256;
  value.rewardDeployment={plan:file,sha256:pin,operation:path.join(p.repositoryRoot,'scripts/operator/reward-deployment-v3.mjs'),operationSHA256:sha(path.join(p.repositoryRoot,'scripts/operator/reward-deployment-v3.mjs')),mode};
  return value;
}
export async function operate(file,pin,action='Check',approved=false,failAt=''){
  file=path.resolve(file);const p=loadPlan(file,pin);assert(['Check','Cutover','Rollback','StartWorker','ReconcileRollback'].includes(action),'ACTION');
  assert(!failAt||p.environment==='Fixture','PRODUCTION_FAULT_INJECTION_REFUSED');
  if(action!=='Check')assert(approved,'SEPARATE_PRODUCTION_APPROVAL_REQUIRED');
  if(p.environment==='Production'&&action!=='Check')assert(ps("$i=[Security.Principal.WindowsIdentity]::GetCurrent();$w=New-Object Security.Principal.WindowsPrincipal($i);$w.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)")==='False','RUN_WORKER_OPERATION_FROM_UNELEVATED_OPERATOR_SESSION');
  await apiCheck(p);
  const safety=await snapshot(p);assert(safety.stop.stopped && safety.signed===0 && safety.broadcast===0,'FINANCIAL_STOP_REQUIRED');
  const stateFile=path.join(p.workDirectory,'deployment-state.json');
  let state=fs.existsSync(stateFile)?read(stateFile):{planSHA256:pin,phase:'BASELINE',worker:p.previousWorker};
  const priorBaseline=p.predecessorBaseline&&state.planSHA256===p.predecessorBaseline.planSHA256&&state.phase==='ROLLED_BACK'&&contentHash(state)===p.predecessorBaseline.stateSHA256;
  const predecessor=['Check','ReconcileRollback'].includes(action)&&p.recovery&&state.planSHA256===p.recovery.predecessorPackageSHA256&&state.phase==='ROLLING_BACK';
  assert(state.planSHA256===pin||predecessor||priorBaseline,'STATE_PLAN_PIN');
  const runtimeSHA=sha(p.runtimeFile),launcherSHA=sha(p.launcher.file);
  const runtimePins=['BASELINE','CANDIDATE'].map(mode=>createHash('sha256').update(JSON.stringify(alignedRuntime(p,mode,file,pin),null,2)+'\n').digest('hex'));
  assert([p.runtimePreimageSHA256,...runtimePins].includes(runtimeSHA),'RUNTIME_PREIMAGE_CHANGED');
  assert([p.launcher.oldSHA256,p.launcher.newSHA256].includes(launcherSHA),'LAUNCHER_PREIMAGE_CHANGED');
  protectedUpdate(p,file,pin,'Check');
  await verifyInstalledDatabase(p);
  if(action==='Check'){
    const observed=state.worker??(predecessor?{...read(path.join(p.workDirectory,'starting-worker.json')),heartbeatFile:p.previousWorker.heartbeatFile}:null);
    const health=observed?await workerHealth(p,observed):null;
    const updater=path.join(p.repositoryRoot,'scripts/operator/reward-protected-update-v2.ps1');
    const verifierReview={uacRequired:p.environment==='Production',updater,updaterSHA256:sha(updater),files:p.protectedUpdate.files.map(f=>({name:f.name,expectedOriginalSHA256:f.oldSHA256,replacementSHA256:f.newSHA256,actualSHA256:sha(path.join(p.protectedUpdate.target,f.name))})),financialAuthority:'NONE'};
    return {passed:true,action,apiPID:p.api.pid,phase:state.phase,health,verifierReview,financialAuthority:'NONE',productionMutated:false};
  }
  fs.mkdirSync(p.workDirectory,{recursive:true});
  const lock=path.join(p.workDirectory,'operation.lock');let lockfd;
  if(fs.existsSync(lock)){const owner=read(lock),proc=processInfo(owner.pid);assert(!proc||proc.createdAt!==owner.createdAt,'ANOTHER_WORKER_OPERATION_ACTIVE');fs.renameSync(lock,lock+'.abandoned-'+randomUUID());}
  lockfd=fs.openSync(lock,'wx');fs.writeFileSync(lockfd,JSON.stringify(processInfo(process.pid)));fs.fsyncSync(lockfd);fs.closeSync(lockfd);
  const record=()=>atomic(stateFile,state);
  const preserve=()=>{assert(!fs.existsSync(path.join(p.workDirectory,'runtime.original.json')),'BACKUP_ALREADY_EXISTS_WITHOUT_STATE');fs.copyFileSync(p.runtimeFile,path.join(p.workDirectory,'runtime.original.json'));fs.copyFileSync(p.launcher.file,path.join(p.workDirectory,'launcher.original.ps1'));assert(sha(path.join(p.workDirectory,'runtime.original.json'))===p.runtimePreimageSHA256,'RUNTIME_BACKUP_PIN');};
  const rollback=async()=>{
    state.phase='ROLLING_BACK';record();
    const starting=path.join(p.workDirectory,'starting-worker.json');
    if(fs.existsSync(starting)){const r=read(starting);if(r.pid!==state.worker?.pid)await drain(p,r);}
    if(state.worker)await drain(p,state.worker);
    const protectedJournal=path.join(p.protectedUpdate.target,'reward-update-'+pin.slice(0,16),'journal.json');
    if(fs.existsSync(protectedJournal))protectedUpdate(p,file,pin,'Restore');
    // The obsolete v5 preimage is retained for audit only. Recovery stays aligned to v6.
    atomic(p.runtimeFile,alignedRuntime(p,'BASELINE',file,pin));
    atomic(p.launcher.file,fs.readFileSync(path.join(p.repositoryRoot,p.launcher.source),'utf8'));
    state.worker=await start(p,{...p.previousWorker,mode:'BASELINE'});
    await apiCheck(p);sameSafety(safety,await snapshot(p));
    state.phase='ROLLED_BACK';state.rollbackVerifiedAt=new Date().toISOString();record();
  };
  try{
    if(action==='ReconcileRollback'){
      assert(p.recovery,'RECONCILIATION_SCOPE_REQUIRED');
      assert(predecessor||(state.planSHA256===pin&&state.phase==='RECONCILING_ROLLBACK'),'UNEXPECTED_RECONCILIATION_STATE');
      if(predecessor)assert(contentHash(state)===p.recovery.stateSHA256,'INTERRUPTED_STATE_CHANGED');
      const receipt=read(path.join(p.workDirectory,'starting-worker.json'));
      assert(contentHash(receipt)===p.recovery.workerReceiptSHA256,'RECOVERY_WORKER_RECEIPT_CHANGED');
      const worker={...receipt,heartbeatFile:p.previousWorker.heartbeatFile};
      assert(worker.pid===p.previousWorker.pid&&worker.sha256===p.previousWorker.sha256,'RECOVERY_BASELINE_IDENTITY');
      const health=await workerHealth(p,worker);
      assert(safety.reviews===p.recovery.reviewFingerprint,'HISTORICAL_REVIEW_CHANGED');
      const proofFile=path.join(p.workDirectory,'rollback-recovery-'+pin.slice(0,16)+'.json');
      if(!fs.existsSync(proofFile))atomic(proofFile,{predecessorState:state,workerReceipt:receipt,safety,health,runtimeBeforeBytes:fs.readFileSync(p.runtimeFile,'utf8'),runtimeBeforeSHA256:sha(p.runtimeFile),launcherBeforeBytes:fs.readFileSync(p.launcher.file,'utf8'),launcherBeforeSHA256:sha(p.launcher.file),authorizedScope:'EXISTING_BASELINE_HEALTH_AND_BINDING_ONLY'});
      state={planSHA256:pin,phase:'RECONCILING_ROLLBACK',worker,predecessorPackageSHA256:p.recovery.predecessorPackageSHA256};record();
      atomic(p.runtimeFile,alignedRuntime(p,'BASELINE',file,pin));
      atomic(p.launcher.file,fs.readFileSync(path.join(p.repositoryRoot,p.launcher.source),'utf8'));
      assert(sha(p.launcher.file)===p.launcher.newSHA256,'RECOVERED_LAUNCHER_PIN');
      if(failAt==='after-recovery-binding')throw Error('SIMULATED_RECOVERY_INTERRUPTION');
      await apiCheck(p);sameSafety(safety,await snapshot(p));await workerHealth(p,worker);
      state.phase='ROLLED_BACK';state.rollbackVerifiedAt=new Date().toISOString();state.recoveryProof=proofFile;record();
      return{passed:true,action,phase:state.phase,apiPID:p.api.pid,workerPID:worker.pid,health,processesRestarted:false,financialAuthority:'NONE'};
    }
    if(action==='Rollback'){await rollback();return {passed:true,action,phase:state.phase,apiPID:p.api.pid};}
    if(action==='StartWorker'){
      assert(['BASELINE','ROLLED_BACK','CANDIDATE'].includes(state.phase),'RECOVERY_REQUIRED');
      assert(!processInfo(state.worker.pid),'WORKER_ALREADY_RUNNING');
      state.worker=await start(p,state.phase==='CANDIDATE'?{...p.candidateWorker,mode:'CANDIDATE'}:{...p.previousWorker,mode:'BASELINE'});record();return{passed:true,action};
    }
    assert(['BASELINE','ROLLED_BACK'].includes(state.phase),'EXPLICIT_ROLLBACK_REQUIRED');
    if(p.environment==='Production'){
      const receipt=read(p.backupReceipt);assert(receipt.status==='PASS'&&receipt.productionMutated===false&&Date.now()-Date.parse(receipt.createdAt)<3600000,'CURRENT_VERIFIED_RESTORE_RECEIPT_REQUIRED');
      for(const f of receipt.files)assert(sha(path.join(receipt.backupDirectory,f.name))===f.sha256,'DATABASE_BACKUP_CHANGED');
    }
    if(!fs.existsSync(stateFile))preserve();
    state.planSHA256=pin;state.phase='DRAINING_BASELINE';record();await drain(p,state.worker);state.worker=null;state.phase='BASELINE_DRAINED';record();await apiCheck(p);
    await installSchema(p,pin);state.phase='SCHEMA_INSTALLED';record();
    protectedUpdate(p,file,pin,'Install');state.phase='VERIFIERS_INSTALLED';record();
    if(failAt==='after-verifiers')throw Error('SIMULATED_POST_VERIFIER_FAILURE');
    atomic(p.launcher.file,fs.readFileSync(path.join(p.repositoryRoot,p.launcher.source),'utf8'));
    atomic(p.runtimeFile,alignedRuntime(p,'CANDIDATE',file,pin));state.phase='STARTING_CANDIDATE';record();
    state.worker=await start(p,{...p.candidateWorker,mode:'CANDIDATE'});state.phase='CANDIDATE';record();
    if(failAt==='after-start')throw Error('SIMULATED_POST_START_FAILURE');
    await apiCheck(p);sameSafety(safety,await snapshot(p));
    return{passed:true,action,phase:state.phase,apiPID:p.api.pid,workerPID:state.worker.pid,financialAuthority:'NONE'};
  }catch(error){
    if(action==='Cutover'&&!['BASELINE','DRAINING_BASELINE'].includes(state.phase)){
      try{await rollback();error.message+='; VERIFIED_WORKER_AND_BUNDLE_ROLLBACK_COMPLETED';if(error.receipt)atomic(path.join(path.dirname(error.receipt),'rollback-result.json'),{at:new Date().toISOString(),passed:true,phase:state.phase,workerPID:state.worker?.pid,apiPID:p.api.pid});}catch(rollbackError){error.message+='; RECOVERY_REQUIRED_KEEP_STOP_NO_FORCE';if(error.receipt)atomic(path.join(path.dirname(error.receipt),'rollback-result.json'),{at:new Date().toISOString(),passed:false,phase:state.phase,diagnosticReceipt:rollbackError.receipt??null});}
    }
    throw error;
  }finally{fs.unlinkSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const[file,pin,action='Check',approval]=process.argv.slice(2);
  const approved=action==='ReconcileRollback'?approval==='OWNER_AUTHORIZED_ROLLBACK_RECOVERY':approval==='OWNER_APPROVED_NONPAYING_DEPLOYMENT';
  try{console.log(JSON.stringify(await operate(file,pin,action,approved)));}catch(e){console.error(e.message);process.exitCode=1;}
}
