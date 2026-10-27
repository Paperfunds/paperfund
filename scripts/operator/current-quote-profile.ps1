# Proposed normal-launcher integration. No action until explicitly installed with runtime.json pins.
function Get-CurrentQuoteProfile {
 $profile=Get-Content (Join-Path $env:LOCALAPPDATA 'PaperfundOperator/runtime.json') -Raw | ConvertFrom-Json
 $q=$profile.currentQuotes
 if(-not $q){return $null}
 $rel='docs/operator-candidate/artifact-releases/public-paper-20261026-v5'
 $release=Join-Path $repoRoot $rel
 $pin='c7f269ef87bd90cf286318f207e4edda572c1cec85b69a3040c8ef6e5838a201'
 if($q.release -ne $rel -or $q.releaseSHA256 -ne $pin -or (Reviewed-Hash (Join-Path $release 'release.json')) -ne $pin){throw 'CURRENT_QUOTE_RELEASE_PIN'}
 $manifest=Get-Content (Join-Path $release 'release.json') -Raw | ConvertFrom-Json
 foreach($role in @('api','worker')){
  $entry=$profile.$role;$relative=$rel+'/'+$manifest.$role;$entryPin=@($manifest.files | Where-Object path -eq $manifest.$role)[0].sha256
  if($entry.script.Replace('\','/') -ne $relative -or $entry.sha256 -ne $entryPin -or $entry.buildManifest.Replace('\','/') -ne ($rel+'/release.json') -or $entry.buildManifestSha256 -ne $pin){throw 'CURRENT_QUOTE_RUNTIME_PROFILE'}
 }
 if((Reviewed-Hash $q.profileFile) -ne $q.profileSHA256){throw 'CURRENT_QUOTE_SCOPE_PIN'}
 $verifier=Join-Path $repoRoot 'scripts/operator/prepare-current-quote-release.mjs'
 $sourcePin=@($manifest.sourceInputs | Where-Object path -eq 'scripts/operator/prepare-current-quote-release.mjs')[0].sha256
 if(-not $sourcePin -or (Reviewed-Hash $verifier) -ne $sourcePin){throw 'CURRENT_QUOTE_VERIFIER_PIN'}
 & $manifest.node.executable $verifier verify $release $pin | Out-Host
 if($LASTEXITCODE -ne 0){throw 'CURRENT_QUOTE_RELEASE_REJECTED'}
 return [pscustomobject]@{Profile=$profile;Scope=$q;Release=$release;Manifest=$manifest;Node=$manifest.node.executable;Starter=(Join-Path $release 'operator/start-current-quote-reviewed.ps1')}
}
function Confirm-CurrentQuoteReceipt($q,$Owner,$Role) {
 if(-not $Owner.CreationDate -or -not $Owner.ExecutablePath -or [IO.Path]::GetFullPath($Owner.ExecutablePath) -ne [IO.Path]::GetFullPath($q.Manifest.node.executable)){throw 'CURRENT_QUOTE_EXECUTABLE_IDENTITY'}
 $entryPin=@($q.Manifest.files | Where-Object path -eq $q.Manifest.$Role)[0].sha256
 $configPin=@($q.Manifest.configurations | Where-Object role -eq $Role)[0].sha256
 $matched=$false
 foreach($file in Get-ChildItem -LiteralPath (Join-Path $repoRoot 'logs') -Filter "scoped-current-$Role-*.receipt.json" -ErrorAction SilentlyContinue){
  try{$r=Get-Content $file.FullName -Raw | ConvertFrom-Json
   if($r.schema -eq 'PAPERFUND_SCOPED_CURRENT_START_V1' -and $r.role -eq $Role -and $r.pid -eq $Owner.ProcessId -and $r.releaseSHA256 -eq $q.Scope.releaseSHA256 -and $r.profileSHA256 -eq $q.Scope.profileSHA256 -and $r.entrySHA256 -eq $entryPin -and $r.configSHA256 -eq $configPin -and $r.nonPaying -eq $true -and [Math]::Abs(($Owner.CreationDate.ToUniversalTime()-[datetime]::Parse($r.startedAt).ToUniversalTime()).TotalSeconds) -lt 5){$matched=$true;break}
  }catch{}
 }
 if(-not $matched){throw 'CURRENT_QUOTE_STARTUP_RECEIPT_REQUIRED'}
}
function Confirm-CurrentQuoteWorker($q) {
 $configPin=@($q.Manifest.configurations | Where-Object role -eq 'worker')[0]
 $cfg=Get-Content -LiteralPath $configPin.file -Raw | ConvertFrom-Json
 $hp=$cfg.WORKER_HEARTBEAT_FILE;if(-not $hp){$hp='logs/worker-heartbeat.json'};if(-not [IO.Path]::IsPathRooted($hp)){$hp=Join-Path $repoRoot $hp}
 if(-not(Test-Path $hp)){return $false}
 $h=Get-Content $hp -Raw | ConvertFrom-Json
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($h.processId)" -ErrorAction SilentlyContinue
 if(-not $p){return $false}
 $entry=Join-Path $q.Release $q.Manifest.worker
 if($p.Name -ne 'node.exe' -or -not $p.CommandLine -or $p.CommandLine.IndexOf($entry,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or $h.currentQuoteRewardHold -ne 'ALL_RECORDED_CURRENT_QUOTE_ROUNDS_REVIEW'){throw 'UNQUALIFIED_EXISTING_WORKER_PRESERVED'}
 Confirm-CurrentQuoteReceipt $q $p 'worker'
 if(-not $h.lastTickStartedAt -or ([datetime]::UtcNow-[datetime]::Parse($h.lastTickStartedAt).ToUniversalTime()).TotalSeconds -gt 30){throw 'CURRENT_QUOTE_WORKER_STALE'}
 return $true
}
function Invoke-CurrentQuoteStarter($q,$Role) {
 $savedEnvironment=@{}
 foreach($item in Get-ChildItem Env:){$savedEnvironment[$item.Name]=$item.Value}
 try{
  & $q.Starter -Mode live -Role $Role -Release $q.Release -ReleaseSHA256 $q.Scope.releaseSHA256 -Profile $q.Scope.profileFile -ProfileSHA256 $q.Scope.profileSHA256
 }finally{
  foreach($item in Get-ChildItem Env:){if(-not $savedEnvironment.ContainsKey($item.Name)){[Environment]::SetEnvironmentVariable($item.Name,$null,'Process')}}
  foreach($key in $savedEnvironment.Keys){[Environment]::SetEnvironmentVariable($key,$savedEnvironment[$key],'Process')}
 }
}
function Start-CurrentQuoteReviewed($q,$Role) {
 if($Role -eq 'api' -and -not(Confirm-CurrentQuoteWorker $q)){
  Invoke-CurrentQuoteStarter $q 'worker'
  if($LASTEXITCODE -ne 0){throw 'CURRENT_QUOTE_WORKER_START_FAILED'}
  $ready=$false;for($n=0;$n -lt 60;$n++){Start-Sleep -Milliseconds 250;if(Confirm-CurrentQuoteWorker $q){$ready=$true;break}}
  if(-not $ready){throw 'CURRENT_QUOTE_WORKER_NOT_READY'}
 }
 if($Role -eq 'worker' -and (Confirm-CurrentQuoteWorker $q)){Write-Host 'Verified quote-hold worker preserved.';return}
 Invoke-CurrentQuoteStarter $q $Role
 if($LASTEXITCODE -ne 0){throw 'CURRENT_QUOTE_SERVICE_START_FAILED'}
}
function Confirm-CurrentQuoteApi($q,$Connections) {
 if(@($Connections).Count -ne 1 -or $Connections[0].LocalAddress -ne '127.0.0.1' -or -not(Healthy 'http://127.0.0.1:3000/ready')){throw 'CURRENT_QUOTE_API_READINESS'}
 $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($Connections[0].OwningProcess)"
 $entry=Join-Path $q.Release $q.Manifest.api
 if(-not $owner -or $owner.Name -ne 'node.exe' -or -not $owner.CommandLine -or $owner.CommandLine.IndexOf($entry,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or $owner.CommandLine.IndexOf($q.Scope.profileSHA256,[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'CURRENT_QUOTE_API_PROCESS_IDENTITY'}
 Confirm-CurrentQuoteReceipt $q $owner 'api'
 if(-not(Confirm-CurrentQuoteWorker $q)){throw 'CURRENT_QUOTE_WORKER_MISSING'}
 Write-Host "Verified scoped PAPER API ready; preserving PID $($owner.ProcessId)."
}
