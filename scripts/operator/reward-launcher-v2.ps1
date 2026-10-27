param([switch]$CheckOnly,[switch]$NoBrowser,[switch]$Shutdown,[switch]$ApiOnly)
$ErrorActionPreference='Stop'
if($Shutdown){throw 'Worker-only deployment launcher never shuts down the public API; use the approved worker Rollback command'}
function Hash($p){$s=[IO.File]::OpenRead($p);$h=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($h.ComputeHash($s)).Replace('-','').ToLowerInvariant()}finally{$s.Dispose();$h.Dispose()}}
$runtime=Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'PaperfundOperator/runtime.json') -Raw|ConvertFrom-Json
$r=$runtime.rewardDeployment
if(-not $r -or (Hash $r.plan) -ne $r.sha256 -or (Hash $r.operation) -ne $r.operationSHA256){throw 'Reviewed worker deployment profile required; no API process started'}
$p=Get-Content -LiteralPath $r.plan -Raw|ConvertFrom-Json
if((Hash $p.node.file) -ne $p.node.sha256){throw 'NODE_PIN'}
# API-only and check-only are observation only. This entry contains no API start/stop command.
& $p.node.file $r.operation $r.plan $r.sha256 Check
if($LASTEXITCODE -ne 0){throw 'DEPLOYMENT_CHECK_FAILED_NO_API_ACTION'}
if(-not $CheckOnly -and -not $ApiOnly){
 $state=Get-Content -LiteralPath (Join-Path $p.workDirectory 'deployment-state.json') -Raw|ConvertFrom-Json
 $worker=Get-CimInstance Win32_Process -Filter "ProcessId=$($state.worker.pid)"
 if(-not $worker){& $p.node.file $r.operation $r.plan $r.sha256 StartWorker OWNER_APPROVED_NONPAYING_DEPLOYMENT;if($LASTEXITCODE -ne 0){throw 'WORKER_START_FAILED'}}
}
Write-Output 'Pinned v6 API preserved. Worker-only startup/check complete; no financial activation.'
