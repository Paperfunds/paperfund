# Explicit reviewed API/worker dispatcher; default is read-only inspection. No SQL or forced termination.
param([switch]$Mixed,[Parameter(Mandatory=$true)][string]$PlanFile,[Parameter(Mandatory=$true)][string]$PlanSHA256,
 [ValidateSet('Check','PreflightBaseline','SchemaGate','DrainBaseline','Start','DrainMixed')][string]$Mode='Check',[string]$ApprovalReference)
$ErrorActionPreference='Stop'
$mixedMutex=New-Object Threading.Mutex($false,'Local\PaperfundBetaLauncher')
if(-not $mixedMutex.WaitOne(0)){$mixedMutex.Dispose();throw 'MIXED_LAUNCH_ANOTHER_LAUNCHER_ACTIVE'}
try {
function Hash($Path){$s=[IO.File]::OpenRead($Path);$h=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($h.ComputeHash($s)).Replace('-','').ToLowerInvariant()}finally{$s.Dispose();$h.Dispose()}}
function Assert($Value,$Reason){if(-not $Value){throw ('MIXED_LAUNCH_'+$Reason)}}
Assert ([IO.Path]::IsPathRooted($PlanFile) -and $PlanSHA256 -match '^[a-f0-9]{64}$' -and (Hash $PlanFile) -eq $PlanSHA256) 'PLAN_PIN'
$p=Get-Content -LiteralPath $PlanFile -Raw|ConvertFrom-Json
Assert ($p.schema -eq 'PAPERFUND_MIXED_CUTOVER_V1' -and $p.mode -eq 'EXIT_ONLY' -and $p.buyAdmission -eq 'DENY_ALL_BUY') 'PLAN_CONTRACT'
Assert ([datetime]::UtcNow -ge [datetime]::Parse($p.notBefore).ToUniversalTime() -and ($Mode -eq 'DrainMixed' -or [datetime]::UtcNow -lt [datetime]::Parse($p.expiresAt).ToUniversalTime())) 'WINDOW'
$artifact=$p.releaseDirectory;$manifestFile=Join-Path $artifact 'release.json'
Assert ((Hash $manifestFile) -eq $p.manifestSHA256) 'MANIFEST_PIN'
$m=Get-Content -LiteralPath $manifestFile -Raw|ConvertFrom-Json
Assert ($m.schema -eq 'PAPERFUND_MIXED_OPERATIONAL_RELEASE_V1' -and $m.destination -eq $artifact -and $m.api -eq 'runtime/api.mjs' -and $m.worker -eq 'runtime/worker.mjs' -and $m.shared -eq 'runtime/shared-runtime.mjs' -and $m.buyAdmission -eq 'DENY_ALL_BUY' -and $m.mode -eq 'EXIT_ONLY') 'RELEASE_CONTRACT'
Assert ((Hash $m.node.executable) -eq $m.node.sha256) 'NODE_PIN'
Assert ((Hash $p.scopeFile) -eq $p.scopeSHA256) 'SCOPE_PIN'
$scope=Get-Content -LiteralPath $p.scopeFile -Raw|ConvertFrom-Json
$approvedScope=$scope;$approvedScopeSHA256=$p.scopeSHA256
$operatorDir=Join-Path $artifact 'operator'
foreach($name in @('start-mixed-reviewed.ps1','mixed-live-preflight.mjs','mixed-deployment.mjs','drain-legacy-console.ps1')){
 $relative='operator/'+$name;$record=@($m.files|Where-Object {$_.path -eq $relative});Assert ($record.Count -eq 1 -and (Hash (Join-Path $operatorDir $name)) -eq $record[0].sha256) 'HELPER_PIN'
}
Assert ((Hash $PSCommandPath) -eq (Hash (Join-Path $operatorDir 'start-mixed-reviewed.ps1'))) 'DISPATCHER_PIN'
foreach($name in @('NODE_OPTIONS','NODE_PATH')){Assert (-not [Environment]::GetEnvironmentVariable($name,'Process')) 'NODE_OVERRIDE'}
foreach($e in Get-ChildItem Env:){Assert ($e.Name -notmatch 'PAYOUT.*(KEY|SECRET)|SIGNING.*(KEY|SECRET)|OPERATOR.*(KEY|SECRET)|TREASURY.*(KEY|SECRET)') 'SIGNING_ENVIRONMENT'}
# ACL approval is exact, owner-provided evidence, not an automatically generated permission change.
$required=@((Split-Path $PlanFile),(Split-Path $p.scopeFile),$p.receiptDirectory,$scope.controlDirectory)+@($scope.scopes|ForEach-Object {$_.archiveDirectory})
foreach($directory in $required){Assert ([IO.Path]::IsPathRooted($directory) -and (Test-Path -LiteralPath $directory -PathType Container)) 'PROTECTED_DIRECTORY';$record=@($p.acls|Where-Object {$_.path -eq $directory});Assert ($record.Count -eq 1) 'ACL_REQUIRED';$acl=Get-Acl -LiteralPath $directory;$h=[Security.Cryptography.SHA256]::Create();try{$pin=[BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($acl.Sddl))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};Assert ($pin -eq $record[0].sha256) 'ACL_CHANGED'
 foreach($ace in $acl.Access){$sid=$ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($ace.AccessControlType -eq 'Allow' -and $sid -in @('S-1-1-0','S-1-5-11','S-1-5-32-545')){Assert (([int]$ace.FileSystemRights -band 278) -eq 0) 'BROAD_DIRECTORY_WRITER'}}
}
function Preflight($Phase){$output=& $m.node.executable (Join-Path $operatorDir 'mixed-live-preflight.mjs') $PlanFile $PlanSHA256 $Phase;Assert ($LASTEXITCODE -eq 0) 'PREFLIGHT_FAILED';return ($output|ConvertFrom-Json)}
function UsePreparedScope {
 Assert ([IO.Path]::GetDirectoryName($p.runtimeScopeFile) -eq $scope.controlDirectory) 'RUNTIME_SCOPE_DIRECTORY'
 $r=Get-Content -LiteralPath ($p.runtimeScopeFile+'.receipt.json') -Raw|ConvertFrom-Json
 Assert ($r.schema -eq 'PAPERFUND_PREPARED_SCOPE_V1' -and $r.planSHA256 -eq $PlanSHA256 -and $r.templateSHA256 -eq $approvedScopeSHA256 -and $r.manifestSHA256 -eq $p.manifestSHA256 -and (Hash $p.runtimeScopeFile) -eq $r.scopeSHA256) 'PREPARED_SCOPE_RECEIPT'
 $derived=Get-Content -LiteralPath $p.runtimeScopeFile -Raw|ConvertFrom-Json
 $a=$approvedScope|ConvertTo-Json -Depth 32|ConvertFrom-Json;$b=$derived|ConvertTo-Json -Depth 32|ConvertFrom-Json
 foreach($s in $a.scopes){$s.initialBankSHA256=('0'*64)};foreach($s in $b.scopes){Assert ($s.initialBankSHA256 -match '^[a-f0-9]{64}$') 'BANK_PIN';$s.initialBankSHA256=('0'*64)}
 Assert (($a|ConvertTo-Json -Depth 32 -Compress) -eq ($b|ConvertTo-Json -Depth 32 -Compress)) 'SCOPE_PROJECTION'
 $script:scope=$derived;$p.scopeFile=$p.runtimeScopeFile;$p.scopeSHA256=$r.scopeSHA256
}
function ProcessIdentity($ProcessId,$CreatedAt,$Entry,$Arguments){
 $o=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
 Assert ($o -and $o.Name -eq 'node.exe' -and $o.ExecutablePath -and $o.CommandLine -and $o.CreationDate) 'PROCESS_UNREADABLE'
 Assert ([Math]::Abs(($o.CreationDate.ToUniversalTime()-[datetime]::Parse($CreatedAt).ToUniversalTime()).TotalMilliseconds) -lt 2) 'PID_REUSED'
 Assert ((Hash $o.ExecutablePath) -eq $m.node.sha256) 'PROCESS_NODE'
 $pattern='^\s*(?:"'+[regex]::Escape($o.ExecutablePath)+'"|'+[regex]::Escape($o.ExecutablePath)+')\s+"?'+[regex]::Escape($Entry)+'"?'+$Arguments+'\s*$'
 Assert ([regex]::IsMatch($o.CommandLine,$pattern,[Text.RegularExpressions.RegexOptions]::IgnoreCase)) 'PROCESS_COMMAND'
 return $o
}
function CurrentMixed($Role,[switch]$IdentityOnly){
 $receiptFile=Join-Path $p.receiptDirectory ($Role+'.json');Assert (Test-Path -LiteralPath $receiptFile) 'STARTUP_RECEIPT_MISSING'
 $r=Get-Content -LiteralPath $receiptFile -Raw|ConvertFrom-Json;$entry=Join-Path $artifact $m.$Role
 Assert ($r.entry -eq $entry -and $r.manifestSHA256 -eq $p.manifestSHA256 -and $r.scopeSHA256 -eq $p.scopeSHA256 -and $r.buyAdmission -eq 'DENY_ALL_BUY') 'STARTUP_RECEIPT'
 $argsPattern='\s+"?'+[regex]::Escape($p.scopeFile)+'"?\s+'+[regex]::Escape($p.scopeSHA256)
 $owner=ProcessIdentity $r.processId $r.createdAt $entry $argsPattern
 if($Role -eq 'api'){$listeners=@(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue);Assert (($IdentityOnly -and $listeners.Count -eq 0) -or ($listeners.Count -eq 1 -and $listeners[0].LocalAddress -eq '127.0.0.1' -and $listeners[0].OwningProcess -eq $owner.ProcessId)) 'API_LISTENER_OWNER';if(-not $IdentityOnly){Assert ((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/ready -TimeoutSec 3).StatusCode -eq 200) 'API_READY'}}
 elseif(-not $IdentityOnly){$h=Get-Content -LiteralPath $scope.heartbeatFile -Raw|ConvertFrom-Json;Assert ($h.processId -eq $owner.ProcessId -and $h.mixedRuntimeActive -eq $true -and $h.buyAdmission -eq 'DENY_ALL_BUY' -and $h.lastTickCompletedAt -and ([datetime]::UtcNow-[datetime]::Parse($h.lastTickCompletedAt).ToUniversalTime()).TotalSeconds -lt 15 -and $h.observation.lastSuccessAt -and (-not $h.observation.lastError) -and ([datetime]::UtcNow-[datetime]::Parse($h.observation.lastSuccessAt).ToUniversalTime()).TotalSeconds -lt 15 -and (-not $h.lastError -or $h.lastError.scope -eq 'settlement')) 'WORKER_LIFECYCLE'}
 return $owner
}
function MaybeMixed($Role){
 $receipt=Join-Path $p.receiptDirectory ($Role+'.json')
 if(Test-Path -LiteralPath $receipt){$r=Get-Content $receipt -Raw|ConvertFrom-Json;if(Get-Process -Id $r.processId -ErrorAction SilentlyContinue){return (CurrentMixed $Role -IdentityOnly)}}
 if($Role -eq 'api'){Assert (@(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue).Count -eq 0) 'UNOWNED_API'}
 elseif(Test-Path -LiteralPath $scope.heartbeatFile){$h=Get-Content $scope.heartbeatFile -Raw|ConvertFrom-Json;Assert (-not(Get-Process -Id $h.processId -ErrorAction SilentlyContinue)) 'UNOWNED_WORKER'}
 return $null
}
if($Mode -eq 'PreflightBaseline'){Preflight 'baseline';return}
if($Mode -eq 'SchemaGate'){Preflight 'schema-gate';return}
if($Mode -eq 'Check'){Preflight 'installed'|Out-Null;UsePreparedScope;CurrentMixed 'worker'|Out-Null;CurrentMixed 'api'|Out-Null;Write-Host 'Mixed API and worker identity/readiness verified; nothing started.';return}
Assert ($ApprovalReference -and $ApprovalReference -eq $p.approvalReference) 'EXPLICIT_ACTION_APPROVAL'
if($Mode -eq 'DrainBaseline'){
 Preflight 'baseline'
 Assert ([datetime]::UtcNow -lt [datetime]::Parse($p.expiresAt).ToUniversalTime()) 'APPROVAL_EXPIRED'
 foreach($role in @('api','worker')){$b=@($p.baseline|Where-Object {$_.role -eq $role});Assert ($b.Count -eq 1 -and (Hash $b[0].entry) -eq $b[0].entrySHA256 -and $b[0].nodeSHA256 -eq $m.node.sha256) 'BASELINE_PIN';ProcessIdentity $b[0].pid $b[0].createdAt $b[0].entry ''|Out-Null}
 foreach($role in @('api','worker')){$b=@($p.baseline|Where-Object {$_.role -eq $role})[0];& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -File (Join-Path $operatorDir 'drain-legacy-console.ps1') -TargetProcessId $b.pid -ExpectedCreationUtc $b.createdAt -ExpectedScript $b.entry -ExpectedScriptSHA256 $b.entrySHA256 -ExpectedNodeSHA256 $b.nodeSHA256 -Mode Inspect;Assert ($? -and $LASTEXITCODE -eq 0) 'DRAIN_INSPECTION'}
 foreach($role in @('api','worker')){$b=@($p.baseline|Where-Object {$_.role -eq $role})[0];& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -File (Join-Path $operatorDir 'drain-legacy-console.ps1') -TargetProcessId $b.pid -ExpectedCreationUtc $b.createdAt -ExpectedScript $b.entry -ExpectedScriptSHA256 $b.entrySHA256 -ExpectedNodeSHA256 $b.nodeSHA256 -Mode Signal -ApprovalReference $ApprovalReference;Assert ($? -and $LASTEXITCODE -eq 0) 'DRAIN_SIGNAL';for($i=0;$i -lt 120 -and (Get-Process -Id $b.pid -ErrorAction SilentlyContinue);$i++){Start-Sleep -Milliseconds 250};Assert (-not(Get-Process -Id $b.pid -ErrorAction SilentlyContinue)) 'DRAIN_TIMEOUT_NO_FORCE_KILL'}
 Write-Host 'Only approved baseline API/worker drained. SQL is not installed by this helper.';return
}
if($Mode -eq 'DrainMixed'){
 UsePreparedScope
 foreach($role in @('api','worker')){$owner=MaybeMixed $role;if(-not $owner){continue};$request=Join-Path $scope.controlDirectory ($role+'-drain.request.json');Assert (-not(Test-Path -LiteralPath $request)) 'PENDING_DRAIN';$requestId=[guid]::NewGuid().ToString('N');$bytes=[Text.Encoding]::UTF8.GetBytes((@{schema='PAPERFUND_DRAIN_V1';requestId=$requestId}|ConvertTo-Json -Compress));$f=[IO.File]::Open($request,[IO.FileMode]::CreateNew);try{$f.Write($bytes,0,$bytes.Length)}finally{$f.Dispose()};for($i=0;$i -lt 120 -and (Get-Process -Id $owner.ProcessId -ErrorAction SilentlyContinue);$i++){Start-Sleep -Milliseconds 250};Assert (-not(Get-Process -Id $owner.ProcessId -ErrorAction SilentlyContinue)) 'DRAIN_TIMEOUT_NO_FORCE_KILL';$ack=Get-Content (Join-Path $scope.controlDirectory ($role+'-drained.json')) -Raw|ConvertFrom-Json;Assert ($ack.pid -eq $owner.ProcessId -and $ack.requestId -eq $requestId) 'DRAIN_ACK'};return
}
if(Test-Path -LiteralPath $p.runtimeScopeFile){UsePreparedScope}
$existingMixed=@{api=(MaybeMixed 'api');worker=(MaybeMixed 'worker')}
foreach($b in $p.baseline){Assert (-not(Get-Process -Id $b.pid -ErrorAction SilentlyContinue)) 'BASELINE_STILL_RUNNING'}
foreach($heartbeat in @($p.baselineHeartbeat,$scope.heartbeatFile)){if(Test-Path -LiteralPath $heartbeat){$old=Get-Content $heartbeat -Raw|ConvertFrom-Json;Assert (-not(Get-Process -Id $old.processId -ErrorAction SilentlyContinue) -or ($existingMixed.worker -and $old.processId -eq $existingMixed.worker.ProcessId)) 'WORKER_ALREADY_RUNNING'}}
$knownWorkerEntries=@($p.baseline|Where-Object {$_.role -eq 'worker'}|ForEach-Object {$_.entry})+@((Join-Path $artifact $m.worker))
foreach($candidate in Get-CimInstance Win32_Process -Filter "Name='node.exe'"){foreach($entry in $knownWorkerEntries){Assert (-not($candidate.CommandLine -and $candidate.CommandLine.IndexOf($entry,[StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($existingMixed.worker -and $candidate.ProcessId -eq $existingMixed.worker.ProcessId)) 'COMPETING_WORKER'}}
Preflight 'prepare-start'|Out-Null
UsePreparedScope
foreach($role in @('worker','api')){
 Assert ([datetime]::UtcNow -lt [datetime]::Parse($p.expiresAt).ToUniversalTime()) 'APPROVAL_EXPIRED'
 if($existingMixed[$role]){CurrentMixed $role|Out-Null;Write-Host "Preserving verified mixed $role PID $($existingMixed[$role].ProcessId).";continue}
 $envRecord=@($m.configurations|Where-Object {$_.role -eq $role})[0];Assert ((Hash $envRecord.file) -eq $envRecord.sha256) 'CONFIG_PIN';$environment=Get-Content $envRecord.file -Raw|ConvertFrom-Json;$saved=@{}
 try{foreach($e in $environment.PSObject.Properties){Assert ($e.Name -eq 'GENERIC_PUMPSWAP_OPERATOR_USER_IDS' -or $e.Name -notmatch 'KEYPAIR|PRIVATE_KEY|SECRET|AUTHORITY|TREASURY|OPERATOR') 'AUTHORITY_CONFIG';$saved[$e.Name]=[Environment]::GetEnvironmentVariable($e.Name,'Process');[Environment]::SetEnvironmentVariable($e.Name,[string]$e.Value,'Process')}
  $entry=Join-Path $artifact $m.$role;$stamp=[guid]::NewGuid().ToString('N')
  $child=Start-Process -FilePath $m.node.executable -ArgumentList @(('"'+$entry+'"'),('"'+$p.scopeFile+'"'),$p.scopeSHA256) -WorkingDirectory $scope.repositoryRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $p.receiptDirectory ($role+'-'+$stamp+'.log')) -RedirectStandardError (Join-Path $p.receiptDirectory ($role+'-'+$stamp+'-error.log')) -PassThru
  $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($child.Id)";Assert ($owner -and $owner.CreationDate) 'CHILD_IDENTITY'
  $receipt=@{processId=$child.Id;createdAt=$owner.CreationDate.ToUniversalTime().ToString('o');entry=$entry;manifestSHA256=$p.manifestSHA256;scopeSHA256=$p.scopeSHA256;buyAdmission='DENY_ALL_BUY'}|ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $p.receiptDirectory ($role+'-'+$stamp+'.receipt.json')),$receipt)
  $target=Join-Path $p.receiptDirectory ($role+'.json');$temp=$target+'.'+$stamp+'.tmp';[IO.File]::WriteAllText($temp,$receipt);Move-Item -LiteralPath $temp -Destination $target -Force
  $ready=$false;for($i=0;$i -lt 80;$i++){Assert (-not $child.HasExited) 'CHILD_EXITED';try{CurrentMixed $role|Out-Null;$ready=$true;break}catch{};Start-Sleep -Milliseconds 250};Assert ($ready) 'NEW_PROCESS_NOT_READY_NO_AUTOMATIC_KILL'
  Write-Host "Verified mixed $role PID $($child.Id); BUY remains denied."
 }finally{foreach($k in $saved.Keys){[Environment]::SetEnvironmentVariable($k,$saved[$k],'Process')}}
}
}finally{$mixedMutex.ReleaseMutex();$mixedMutex.Dispose()}
