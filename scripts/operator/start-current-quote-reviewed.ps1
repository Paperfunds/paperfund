param([ValidateSet('check','live')][string]$Mode='check',[ValidateSet('api','worker')][string]$Role='api',[Parameter(Mandatory=$true)][string]$Release,[Parameter(Mandatory=$true)][string]$ReleaseSHA256,[Parameter(Mandatory=$true)][string]$Profile,[Parameter(Mandatory=$true)][string]$ProfileSHA256)
$ErrorActionPreference='Stop'
function Hash($p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$releasePath=[IO.Path]::GetFullPath($Release)
if((Hash (Join-Path $releasePath 'release.json')) -ne $ReleaseSHA256){throw 'RELEASE_PIN'}
$manifest=Get-Content (Join-Path $releasePath 'release.json') -Raw | ConvertFrom-Json
if($manifest.schema -ne 'PAPERFUND_SCOPED_CURRENT_QUOTE_RELEASE_V1' -or $manifest.destination -ne $releasePath){throw 'RELEASE_IDENTITY'}
$node=$manifest.node.executable
if((Hash $node) -ne $manifest.node.sha256 -or (Hash $Profile) -ne $ProfileSHA256){throw 'NODE_OR_PROFILE_PIN'}
foreach($name in @('NODE_OPTIONS','NODE_PATH')){if([Environment]::GetEnvironmentVariable($name,'Process')){throw 'INHERITED_NODE_OVERRIDE_REFUSED'}}
$repo=$manifest.repositoryRoot
& $node (Join-Path $repo 'scripts/operator/prepare-current-quote-release.mjs') verify $releasePath $ReleaseSHA256
if($LASTEXITCODE -ne 0){throw 'RELEASE_INTEGRITY'}
$configPin=@($manifest.configurations | Where-Object role -eq $Role)[0]
if((Hash $configPin.file) -ne $configPin.sha256){throw 'PROTECTED_CONFIG_PIN'}
$cfg=Get-Content $configPin.file -Raw | ConvertFrom-Json
if($cfg.PRIVATE_BETA_NON_PAYING -ne 'true' -or $cfg.PAYOUT_EXECUTION_ENABLED -ne 'false' -or $cfg.PAYOUT_SIGNER_TYPE -ne 'DISABLED' -or $cfg.BETA_INVITE_ONLY -ne 'true'){throw 'FINANCIAL_PROTECTIONS'}
# Existing independent observer STOP, nonpaying role and 945-object schema qualification. Read-only.
$workerConfig=@($manifest.configurations | Where-Object role -eq 'worker')[0].file
& $node (Join-Path $repo 'scripts/operator/qualify-guarded-worker.mjs') $workerConfig
if($LASTEXITCODE -ne 0){throw 'STOP_ROLE_OR_SCHEMA_QUALIFICATION'}
$scope=Get-Content $Profile -Raw | ConvertFrom-Json
if($scope.schema -ne 'PAPERFUND_SCOPED_CURRENT_QUOTES_V1' -or $scope.nonPaying -ne $true -or -not [IO.Path]::IsPathRooted($scope.controlDirectory)){throw 'SCOPE_PROFILE'}
$entry=Join-Path $releasePath $manifest.$Role
$heartbeatCfg=Get-Content $workerConfig -Raw | ConvertFrom-Json
$heartbeatPath=$heartbeatCfg.WORKER_HEARTBEAT_FILE
if(-not [IO.Path]::IsPathRooted($heartbeatPath)){$heartbeatPath=Join-Path $repo $heartbeatPath}
if($Role -eq 'api'){
 $heartbeat=Get-Content $heartbeatPath -Raw | ConvertFrom-Json
 if($heartbeat.currentQuoteRewardHold -ne 'ALL_RECORDED_CURRENT_QUOTE_ROUNDS_REVIEW' -or -not $heartbeat.lastTickStartedAt -or ([datetime]::UtcNow-[datetime]::Parse($heartbeat.lastTickStartedAt).ToUniversalTime()).TotalSeconds -gt 30){throw 'QUALIFIED_HOLD_WORKER_REQUIRED'}
 $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($heartbeat.processId)"
 if(-not $owner -or $owner.CommandLine.IndexOf((Join-Path $releasePath $manifest.worker),[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'WORKER_IDENTITY'}
}
if($Mode -eq 'check'){Write-Output 'PASS: release/config/STOP/schema verified; no process started.';exit 0}
if($Role -eq 'api' -and (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)){throw 'DRAIN_EXISTING_API_FIRST'}
if($Role -eq 'worker' -and (Test-Path $heartbeatPath)){
 $prior=Get-Content $heartbeatPath -Raw | ConvertFrom-Json
 if($prior.processId -and (Get-Process -Id $prior.processId -ErrorAction SilentlyContinue)){throw 'DRAIN_EXISTING_WORKER_FIRST'}
}
foreach($property in $cfg.PSObject.Properties){[Environment]::SetEnvironmentVariable($property.Name,[string]$property.Value,'Process')}
$logRoot=Join-Path $repo 'logs';$stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff');$out=Join-Path $logRoot "scoped-current-$Role-$stamp.log";$err=Join-Path $logRoot "scoped-current-$Role-$stamp.error.log"
$child=Start-Process -FilePath $node -ArgumentList @(('"'+$entry+'"'),('"'+[IO.Path]::GetFullPath($Profile)+'"'),$ProfileSHA256) -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
$receipt=[ordered]@{schema='PAPERFUND_SCOPED_CURRENT_START_V1';pid=$child.Id;role=$Role;startedAt=[datetime]::UtcNow.ToString('o');releaseSHA256=$ReleaseSHA256;entrySHA256=(Hash $entry);profileSHA256=$ProfileSHA256;configSHA256=$configPin.sha256;nonPaying=$true}
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logRoot "scoped-current-$Role-$stamp.receipt.json")
Write-Output ("Started scoped current-quote $Role PID "+$child.Id+'; verify readiness and heartbeat before admission.')
