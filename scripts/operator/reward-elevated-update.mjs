// The same pinned child crosses RunAs in production and the explicitly approved elevation rehearsal.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const hash=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
export function runProtectedUpdate(p,planFile,planSHA256,action,failAfter=0,{elevate=p.environment==='Production'&&action!=='Check'}={}){
 const plan=path.resolve(planFile),updater=path.resolve(p.repositoryRoot,'scripts/operator/reward-protected-update-v2.ps1'),child=path.resolve(p.repositoryRoot,'scripts/operator/reward-update-child.ps1');
 if(!['Check','Install','Restore'].includes(action))throw Error('UPDATE_ACTION');
 if(failAfter&&p.environment!=='Fixture')throw Error('PRODUCTION_FAULT_INJECTION_REFUSED');
 if(hash(fs.readFileSync(plan))!==planSHA256)throw Error('UPDATE_PLAN_PIN');
 for(const file of [updater,child])if(!p.files.some(x=>path.resolve(p.repositoryRoot,x.path)===file&&x.sha256===hash(fs.readFileSync(file))))throw Error('UPDATE_EXECUTABLE_NOT_PINNED');
 const attemptId=randomUUID(),dir=path.join(path.resolve(p.workDirectory),'elevated-diagnostics',attemptId);
 fs.mkdirSync(dir,{recursive:true});
 const requestFile=path.join(dir,'request.json'),receipt=path.join(dir,'child-result.json');
 const request={schema:'PAPERFUND_ELEVATED_REQUEST_V1',attemptId,plan,planSHA256,updater,updaterSHA256:hash(fs.readFileSync(updater)),action,failAfter,requireElevation:elevate,receipt};
 fs.writeFileSync(requestFile,JSON.stringify(request,null,2)+'\n',{flag:'wx'});
 const requestSHA256=hash(fs.readFileSync(requestFile)),childSHA256=hash(fs.readFileSync(child));
 // Bootstrap failure still leaves an identifiable durable receipt; no raw PowerShell output is logged.
 const bootstrap=`$ErrorActionPreference='Stop';try{$b=[IO.File]::ReadAllBytes(${quote(child)});$h=[Security.Cryptography.SHA256]::Create();$actual=[BitConverter]::ToString($h.ComputeHash($b)).Replace('-','').ToLowerInvariant();if($actual -ne '${childSHA256}'){throw 'ELEVATED_CHILD_PIN'};& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -RequestFile ${quote(requestFile)} -RequestSHA256 '${requestSHA256}'}catch{$r=@{schema='PAPERFUND_ELEVATED_BOOTSTRAP_FAILURE_V1';attemptId='${attemptId}';status='FAILED';operation='BOOTSTRAP_OR_REQUEST';exceptionType=$_.Exception.GetType().FullName;hresult=$_.Exception.HResult};[IO.File]::WriteAllText(${quote(path.join(dir,'bootstrap-failure.json'))},($r|ConvertTo-Json -Compress));exit 1}`;
 const encoded=Buffer.from(bootstrap,'utf16le').toString('base64');
 const launchFile=path.join(dir,'launch-result.json');
 let transportError=null,processExitCode=null;
 try{
  if(elevate){
   const launch=`$ErrorActionPreference='Stop';try{$x=Start-Process -FilePath ${quote(powershell)} -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}' -WorkingDirectory ${quote(path.join(process.env.SystemRoot,'System32'))} -Verb RunAs -WindowStyle Hidden -PassThru;$childId=$x.Id;$x.WaitForExit();$x.Refresh();$r=@{status='EXITED';pid=$childId;exitCode=$x.ExitCode};[IO.File]::WriteAllText(${quote(launchFile)},($r|ConvertTo-Json -Compress));if($null -eq $x.ExitCode){exit 2};exit 0}catch{$r=@{status='LAUNCH_FAILED';exceptionType=$_.Exception.GetType().FullName;hresult=$_.Exception.HResult};if($_.Exception.InnerException){$r.nativeErrorCode=$_.Exception.InnerException.NativeErrorCode};[IO.File]::WriteAllText(${quote(launchFile)},($r|ConvertTo-Json -Compress));exit 3}`;
   execFileSync(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(launch,'utf16le').toString('base64')],{windowsHide:true,timeout:180000,stdio:'pipe'});
   processExitCode=read(launchFile).exitCode;
  }else{
   try{execFileSync(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{cwd:path.join(process.env.SystemRoot,'System32'),windowsHide:true,timeout:60000,stdio:'pipe'});processExitCode=0;}catch(e){processExitCode=e.status??null;transportError=e.code??null;}
  }
 }catch(e){transportError=e.code??'LAUNCH_PROCESS_FAILED';}
 const childResult=fs.existsSync(receipt)?read(receipt):null,launch=fs.existsSync(launchFile)?read(launchFile):null;
 const valid=childResult?.attemptId===attemptId&&childResult?.requestSHA256===requestSHA256&&childResult?.planSHA256===planSHA256&&(!elevate||(childResult.elevated===true&&childResult.pid===launch?.pid));
 const passed=processExitCode===0&&valid&&childResult.status==='SUCCEEDED'&&childResult.exitCode===0;
 const result={schema:'PAPERFUND_ELEVATED_PARENT_V1',at:new Date().toISOString(),attemptId,action,passed,plan,planSHA256,requestSHA256,processExitCode,transportError,launch,childReceipt:receipt,childResult,bootstrapFailure:fs.existsSync(path.join(dir,'bootstrap-failure.json'))?read(path.join(dir,'bootstrap-failure.json')):null,status:passed?'SUCCEEDED':childResult?.status==='RUNNING'?'INTERRUPTED':'FAILED'};
 const parentReceipt=path.join(dir,'parent-result.json');fs.writeFileSync(parentReceipt,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 if(!passed){const error=Error(`PROTECTED_UPDATE_${action.toUpperCase()}_FAILED:stage=${childResult?.operation??'ELEVATION_OR_BOOTSTRAP'};exit=${processExitCode};receipt=${parentReceipt}`);error.diagnostic=result;error.receipt=parentReceipt;throw error;}
 return {...result,parentReceipt};
}
