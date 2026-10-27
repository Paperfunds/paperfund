# Existing per-service procedure. Execute ONLY after applicable policy clearance and operator approval.
# Editing this file does not clear the prior tool-level denial. No candidate schema/bootstrap is applied.
param([Parameter(Mandatory=$true)][ValidateSet('rehearsal','live')][string]$Mode)
$ErrorActionPreference='Stop'
$pfRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pfRelease=Join-Path $pfRoot 'docs\website-redesign\deployment-prep\artifact-releases\api-guarded-restoration-20261023-v2'
$pfManifestSha256='97d2fc67fbcfcd12c0da5308fd139ccb3be50e3b9d1a894ffa46606cacaa6b53'
$pfEntrySha256='96cd785ad4abfb9878948ce6a0e5854fffdd119848047f87e3864cedd79ffb4b'
Set-Location -LiteralPath $pfRoot
$pfManifestPath=Join-Path $pfRelease 'release.json'
if((Get-FileHash -LiteralPath $pfManifestPath -Algorithm SHA256).Hash -ne $pfManifestSha256){throw 'RELEASE_MANIFEST_CHANGED'}
$pfManifest=Get-Content -LiteralPath $pfManifestPath -Raw | ConvertFrom-Json
if($pfManifest.destination -ne $pfRelease -or $pfManifest.entry -ne 'runtime/main.mjs' -or $pfManifest.defaultBuyAdmission -ne 'DENY_ALL_BUY' -or $pfManifest.installedEntryAuthorizer -ne $false -or $pfManifest.mixedBootstrapInstalled -ne $false){throw 'GUARDED_BASELINE_PROFILE_REQUIRED'}
$pfEntry=Join-Path $pfRelease $pfManifest.entry
if((Get-FileHash -LiteralPath $pfEntry -Algorithm SHA256).Hash -ne $pfEntrySha256){throw 'GUARDED_ENTRY_CHANGED'}
$pfNode=$pfManifest.node.executable
if((Get-FileHash -LiteralPath $pfNode -Algorithm SHA256).Hash -ne $pfManifest.node.sha256){throw 'NODE_RUNTIME_CHANGED'}
# Refuse process-level code injection before invoking even the read-only verifier.
foreach($pfName in @('NODE_OPTIONS','NODE_PATH')){if([Environment]::GetEnvironmentVariable($pfName,'Process')){throw 'INHERITED_NODE_OVERRIDE_REFUSED'}}
foreach($pfEnvItem in Get-ChildItem Env:){if($pfEnvItem.Name -match 'PAYOUT.*(KEY|SECRET)|SIGNING.*(KEY|SECRET)|OPERATOR.*(KEY|SECRET)|TREASURY.*(KEY|SECRET)'){throw 'INHERITED_SIGNING_AUTHORITY_REFUSED'}}
$pfProfilePath=Join-Path $env:LOCALAPPDATA 'PaperfundOperator\runtime.json'
$pfProfileSha256=(Get-FileHash -LiteralPath $pfProfilePath -Algorithm SHA256).Hash
$pfProfile=Get-Content -LiteralPath $pfProfilePath -Raw | ConvertFrom-Json
if([IO.Path]::GetFullPath($pfProfile.api.environmentFile) -ne [IO.Path]::GetFullPath($pfManifest.configFile)){throw 'PROTECTED_API_CONFIG_PATH_CHANGED'}
if((Get-FileHash -LiteralPath $pfManifest.configFile -Algorithm SHA256).Hash -ne $pfManifest.configSHA256){throw 'PROTECTED_API_CONFIG_CHANGED'}
$pfVariables=Get-Content -LiteralPath $pfManifest.configFile -Raw | ConvertFrom-Json
foreach($pfProperty in $pfVariables.PSObject.Properties){if($pfProperty.Name -ne 'GENERIC_PUMPSWAP_OPERATOR_USER_IDS' -and $pfProperty.Name -match 'KEYPAIR|PRIVATE_KEY|SECRET|OPERATOR|AUTHORITY|TREASURY|^NODE_OPTIONS$|^NODE_PATH$'){throw 'SIGNING_OR_NODE_OVERRIDE_CONFIG_REFUSED'}}
if($pfVariables.PRIVATE_BETA_NON_PAYING -ne 'true' -or $pfVariables.PAYOUT_EXECUTION_ENABLED -ne 'false' -or $pfVariables.BETA_INVITE_ONLY -ne 'true' -or $pfVariables.PAYOUT_SIGNER_TYPE -ne 'DISABLED'){throw 'NONPAYING_INVITE_ONLY_DISABLED_SIGNER_REQUIRED'}
if($pfVariables.API_HOST -ne '127.0.0.1' -or [string]$pfVariables.API_PORT -ne '3000'){throw 'EXPECTED_LOOPBACK_API_CONFIG_REQUIRED'}
& $pfNode (Join-Path $pfRoot 'scripts/operator/prepare-guarded-api-release.mjs') verify $pfRelease $pfManifestSha256
if($LASTEXITCODE -ne 0){throw 'ARTIFACT_GUARD_FAILED'}
$pfPort=if($Mode -eq 'rehearsal'){3002}else{3000}
if(Get-NetTCPConnection -State Listen -LocalPort $pfPort -ErrorAction SilentlyContinue){throw 'START_PORT_ALREADY_OCCUPIED'}
# Only this short-lived read-only probe sees the existing operator DB configuration.
# Those credentials are never copied into the API environment or output.
$pfStopProbe=@"
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const [release,local]=process.argv.slice(1),load=createRequire(path.join(release,'runtime/__stop_probe__.cjs')),{Pool}=load('pg');
(async()=>{let pool;try{const profile=JSON.parse(fs.readFileSync(path.join(local,'PaperfundOperator/runtime.json'))),cfg=JSON.parse(fs.readFileSync(profile.operator.environmentFile));pool=new Pool({connectionString:cfg.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000,max:1});const c=await pool.connect();try{await c.query('begin read only');const r=await c.query('select stopped from payout_stop_state where singleton=true');await c.query('rollback');if(r.rowCount!==1||r.rows[0].stopped!==true)throw Error('STOP_NOT_ASSERTED');console.log(JSON.stringify({financialStop:true,readOnly:true}));}finally{c.release()}}catch{console.error('FINANCIAL_STOP_VERIFICATION_FAILED');process.exitCode=1}finally{await pool?.end()}})();
"@
$pfStopResult=& $pfNode -e $pfStopProbe $pfRelease $env:LOCALAPPDATA
if($LASTEXITCODE -ne 0){throw 'FINANCIAL_STOP_VERIFICATION_FAILED'}
$pfStopState=$pfStopResult | ConvertFrom-Json
if($pfStopState.financialStop -ne $true -or $pfStopState.readOnly -ne $true){throw 'FINANCIAL_STOP_REQUIRED'}
if((Get-FileHash -LiteralPath $pfProfilePath -Algorithm SHA256).Hash -ne $pfProfileSha256){throw 'PROTECTED_RUNTIME_PROFILE_CHANGED'}
$pfSaved=@{}
$pfNewProcess=$null
try {
 foreach($pfProperty in $pfVariables.PSObject.Properties){$pfSaved[$pfProperty.Name]=[Environment]::GetEnvironmentVariable($pfProperty.Name,'Process');[Environment]::SetEnvironmentVariable($pfProperty.Name,[string]$pfProperty.Value,'Process')}
 $env:API_PORT=[string]$pfPort
 $pfLogs=Join-Path $env:LOCALAPPDATA 'PaperfundOperator\website-artifact-services'
 New-Item -ItemType Directory -Path $pfLogs -Force | Out-Null
 $pfStamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
 $pfLog=Join-Path $pfLogs ('api-'+$Mode+'-'+$pfStamp+'.log')
 $pfErrorLog=Join-Path $pfLogs ('api-'+$Mode+'-'+$pfStamp+'-error.log')
 # Recheck immediately before the one existing per-service startup operation.
 if(Get-NetTCPConnection -State Listen -LocalPort $pfPort -ErrorAction SilentlyContinue){throw 'START_PORT_ALREADY_OCCUPIED'}
 $pfNewProcess=Start-Process -FilePath $pfNode -ArgumentList @(('"'+$pfEntry+'"')) -WorkingDirectory $pfRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $pfLog -RedirectStandardError $pfErrorLog
 $pfReady=$false
 for($pfAttempt=0;$pfAttempt -lt 30;$pfAttempt++){
  Start-Sleep -Milliseconds 500
  $pfNewProcess.Refresh()
  if($pfNewProcess.HasExited){throw 'GUARDED_API_EXITED'}
  try{
   $pfHealth=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$pfPort+'/health') -TimeoutSec 2
   $pfReadiness=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$pfPort+'/ready') -TimeoutSec 2
   $pfListener=Get-NetTCPConnection -State Listen -LocalPort $pfPort -ErrorAction SilentlyContinue
   if($pfHealth.status -eq 'ok' -and $pfHealth.application -eq 'paperfund-api' -and $pfReadiness.status -eq 'ok' -and @($pfListener).Count -eq 1 -and $pfListener.OwningProcess -eq $pfNewProcess.Id -and $pfListener.LocalAddress -eq '127.0.0.1'){$pfReady=$true;break}
  }catch{}
 }
 if(-not $pfReady){throw 'GUARDED_API_READINESS_TIMEOUT'}
 $pfPostStop=& $pfNode -e $pfStopProbe $pfRelease $env:LOCALAPPDATA
 if($LASTEXITCODE -ne 0 -or ($pfPostStop | ConvertFrom-Json).financialStop -ne $true){throw 'FINANCIAL_STOP_POSTCHECK_FAILED'}
 if((Get-FileHash -LiteralPath $pfManifest.configFile -Algorithm SHA256).Hash -ne $pfManifest.configSHA256 -or (Get-FileHash -LiteralPath $pfProfilePath -Algorithm SHA256).Hash -ne $pfProfileSha256){throw 'PROTECTED_CONFIGURATION_CHANGED_DURING_STARTUP'}
 $pfReceipt=[ordered]@{at=[DateTime]::UtcNow.ToString('o');mode=$Mode;pid=$pfNewProcess.Id;startedAt=$pfNewProcess.StartTime.ToUniversalTime().ToString('o');entry=$pfEntry;entrySHA256=$pfEntrySha256;manifestSHA256=$pfManifestSha256;configSHA256=$pfManifest.configSHA256;host='127.0.0.1';port=$pfPort;financialStop=$true;buyAdmission='DENY_ALL_BUY';mixedRuntimeActive=$false;log=$pfLog;errorLog=$pfErrorLog}
 $pfReceipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pfLogs ('api-'+$Mode+'-'+$pfStamp+'-receipt.json')) -Encoding UTF8
 Write-Output ('GUARDED API '+$Mode+' READY; PID '+$pfNewProcess.Id+'; BUY DENIED; STOP ASSERTED; mixed runtime inactive')
}catch{
 # Startup failure recovery is limited to the exact new process handle created above.
 # Disconnect/termination lets PostgreSQL roll back any incomplete transaction; never restore DB files.
 if($null -ne $pfNewProcess){$pfNewProcess.Refresh();if(-not $pfNewProcess.HasExited){Stop-Process -InputObject $pfNewProcess -ErrorAction Stop}}
 throw
}finally{
 foreach($pfKey in $pfSaved.Keys){[Environment]::SetEnvironmentVariable($pfKey,$pfSaved[$pfKey],'Process')}
}
