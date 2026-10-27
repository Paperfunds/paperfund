import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {digest,assertExecutionPermit,WALLET,GENESIS} from './claim-core.mjs';
export const MANUAL_GROSS_CAP='20000000';
export function manualPermit(review,operator='LOCAL_PROTECTED_REVIEW',now=Date.now()) {
 const permit={schema:'paperfund-exact-claim-authority-v1',reviewSha256:digest(JSON.stringify(review)),messageSha256:review.messageSha256,wallet:WALLET,genesis:GENESIS,operator,action:'SIGN_AND_SUBMIT_ONE_CREATOR_CLAIM',expiresAt:review.expiresAt,maximumFeeLamports:review.maximumFeeLamports,expectedGrossLamports:review.expectedGrossLamports};
 assertExecutionPermit(review,permit,now);
 if(BigInt(review.expectedGrossLamports)>BigInt(MANUAL_GROSS_CAP))throw Error('CLAIM_MANUAL_GROSS_CAP_EXCEEDED');
 return permit;
}
export function checkManualRequest(envelope,request,now=Date.now()) {
 const permit=manualPermit(envelope.review,undefined,now);
 if(request?.reviewSha256!==permit.reviewSha256||request?.messageSha256!==permit.messageSha256)throw Error('CLAIM_DASHBOARD_REVIEW_CHANGED');
 return permit;
}
export async function launchManualClaim(envelope,request) {
 if(request?.mode!==undefined&&request.mode!=='read-only-test')throw Error('CLAIM_NATIVE_MODE_FORBIDDEN');
 const permit=checkManualRequest(envelope,request);
 const root=path.join(process.env.ProgramFiles??'C:/Program Files','PaperfundSigner');
 const manifestFile=path.join(root,'manual-claim-install-manifest.json');
 if(!fs.existsSync(manifestFile))throw Error('CLAIM_MANUAL_DEPLOYMENT_REQUIRED');
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8').replace(/^\uFEFF/,''));
 for(const f of manifest.files)if(digest(fs.readFileSync(path.join(root,f.name)))!==f.sha256)throw Error('CLAIM_MANUAL_INSTALLED_HASH_CHANGED');
 // Public hash only. The elevated protected tool independently validates and displays the review.
 const script=path.join(root,'review-manual-claim.ps1');
 const readOnlyTest=request?.mode==='read-only-test';
 const args=["'-NoProfile'","'-STA'","'-NoExit'","'-File'","'\""+script+"\"'","'-ReviewSha256'","'"+permit.reviewSha256+"'"];
 if(readOnlyTest)args.push("'-ReadOnlyLaunchTest'");
 const code="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$env:PSModulePath=Join-Path $PSHOME 'Modules';try{$p=Start-Process powershell.exe -Verb RunAs -WindowStyle Normal -PassThru -ArgumentList @("+args.join(',')+");@{launched=$true;processId=$p.Id;sessionId=$p.SessionId}|ConvertTo-Json -Compress}catch{$native=$_.Exception.NativeErrorCode;if(-not $native -and $_.Exception.InnerException){$native=$_.Exception.InnerException.NativeErrorCode};@{launched=$false;nativeErrorCode=$native;baseNativeErrorCode=$_.Exception.GetBaseException().NativeErrorCode;errorId=$_.FullyQualifiedErrorId;message=$_.Exception.Message}|ConvertTo-Json -Compress;exit 1}";
 const result=await runWindowsBootstrap(code);
 if(!result.launched||!Number.isInteger(result.processId)||result.sessionId<=0)throw Error('CLAIM_NATIVE_INTERACTIVE_LAUNCH_UNVERIFIED');
 return {status:'LOCAL_PROTECTED_WINDOW_STARTED',nativeProcessId:result.processId,sessionId:result.sessionId,readOnlyTest,reviewSha256:permit.reviewSha256,signingPerformed:false,broadcast:false,authorityGranted:false};
}
export function runWindowsBootstrap(code,{timeoutMs=120000}={}) {
 return new Promise((resolve,reject)=>{
  // Windows PowerShell exits silently before executing -EncodedCommand when detached here.
  const child=spawn('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,detached:false,stdio:['ignore','pipe','pipe']});
  let output='',diagnostic='';const timer=setTimeout(()=>reject(Error('CLAIM_NATIVE_LAUNCH_TIMEOUT_CHECK_LOCAL_WINDOWS')),timeoutMs);
  child.stdout.on('data',b=>{output+=b;if(output.length>8192)output=output.slice(-8192);});
  child.stderr.on('data',b=>{diagnostic+=b;if(diagnostic.length>8192)diagnostic=diagnostic.slice(-8192);});
  child.on('error',e=>{clearTimeout(timer);reject(Error('CLAIM_NATIVE_PROCESS_CREATE_'+(e.code??'FAILED')));});
  child.on('close',status=>{clearTimeout(timer);
   const secrets=[process.env.DATABASE_URL,process.env.SOLANA_RPC_URL].filter(Boolean);let safeDiagnostic=diagnostic;for(const value of secrets)safeDiagnostic=safeDiagnostic.split(value).join('[REDACTED]');safeDiagnostic=safeDiagnostic.replace(/https?:\/\/[^\s<]+/g,'[REDACTED_URL]');
   const evidence={at:new Date().toISOString(),shellProcessId:child.pid,exitCode:status,stdout:output,stderrPreview:safeDiagnostic.slice(-2048),stderrSha256:digest(diagnostic),signingPerformed:false,broadcast:false};
   try{const dir=path.resolve('artifacts/operator');fs.writeFileSync(path.join(dir,'native-claim-bootstrap-'+Date.now()+'-'+child.pid+'.json'),JSON.stringify(evidence,null,2),{flag:'wx'});fs.writeFileSync(path.join(dir,'native-claim-bootstrap-latest.json'),JSON.stringify(evidence,null,2));}catch{/* Native acknowledgment still reports the launch independently of a local evidence write. */}
   let parsed;try{parsed=JSON.parse(output.trim());}catch{reject(Error(status===0?'CLAIM_NATIVE_BOOTSTRAP_NO_ACK':'CLAIM_NATIVE_BOOTSTRAP_EXIT_'+status));return;}
   if(status!==0||!parsed.launched){reject(Error(parsed.nativeErrorCode===1223?'CLAIM_WINDOWS_CONSENT_CANCELLED':'CLAIM_NATIVE_WINDOWS_ERROR_'+(parsed.nativeErrorCode??'UNKNOWN')));return;}
   resolve(parsed);
  });
 });
}
