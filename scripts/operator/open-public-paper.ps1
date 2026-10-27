$ErrorActionPreference='Stop'
$repo=Split-Path (Split-Path $PSScriptRoot)
function Hash([string]$file){$s=[IO.File]::OpenRead($file);$h=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($h.ComputeHash($s)).Replace('-','').ToLowerInvariant()}finally{$s.Dispose();$h.Dispose()}}
$manifestFile=Join-Path $PSScriptRoot 'public-paper-dashboard.json'
if((Hash $manifestFile) -ne '0e56dc57724f1acf8c6ff38afdaa4f40d4a459aa762115cda6d36cc5299cb0d9'){throw 'PAPER_DASHBOARD_MANIFEST_CHANGED'}
$manifest=Get-Content -LiteralPath $manifestFile -Raw|ConvertFrom-Json
foreach($f in $manifest.files){if((Hash (Join-Path $repo $f.path)) -ne $f.sha256){throw ('PAPER_DASHBOARD_FILE_CHANGED: '+$f.path)}}
if((Hash $manifest.node.executable) -ne $manifest.node.sha256){throw 'PAPER_DASHBOARD_NODE_CHANGED'}
if((Hash $manifest.environmentFile) -ne $manifest.environmentSHA256){throw 'PAPER_DASHBOARD_CONFIGURATION_CHANGED'}
$sessionFile=Join-Path $repo 'logs/operator/session.json'
$listeners=@(Get-NetTCPConnection -LocalPort 3188 -State Listen -ErrorAction SilentlyContinue)
if($listeners.Count -gt 0){
 $session=Get-Content -LiteralPath $sessionFile -Raw|ConvertFrom-Json
 $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($session.processId)"
 if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $listeners[0].OwningProcess -ne $session.processId -or -not $owner.CommandLine.Contains((Join-Path $repo 'scripts/operator/server.mjs').Replace('/','\'))){throw 'PAPER_DASHBOARD_PORT_IDENTITY_MISMATCH'}
}else{
 if($env:NODE_OPTIONS -or $env:NODE_PATH){throw 'PAPER_DASHBOARD_NODE_OVERRIDE_REFUSED'}
 $config=Get-Content -LiteralPath $manifest.environmentFile -Raw|ConvertFrom-Json
 $saved=@{}
 try{
  foreach($p in $config.PSObject.Properties){$saved[$p.Name]=[Environment]::GetEnvironmentVariable($p.Name,'Process');[Environment]::SetEnvironmentVariable($p.Name,[string]$p.Value,'Process')}
  $stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')
  $process=Start-Process -FilePath $manifest.node.executable -ArgumentList @(('"'+(Join-Path $repo 'scripts/operator/server.mjs')+'"')) -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $repo "logs/operator/paper-dashboard-$stamp.log") -RedirectStandardError (Join-Path $repo "logs/operator/paper-dashboard-$stamp.error.log") -PassThru
 }finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
 for($i=0;$i -lt 60;$i++){
  Start-Sleep -Milliseconds 300
  if($process.HasExited){throw 'PAPER_DASHBOARD_START_FAILED'}
  if(Test-Path -LiteralPath $sessionFile){$session=Get-Content -LiteralPath $sessionFile -Raw|ConvertFrom-Json;if($session.processId -eq $process.Id){break}}
 }
 if($session.processId -ne $process.Id){throw 'PAPER_DASHBOARD_SESSION_NOT_READY'}
}
$chrome=@((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),(Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
if($chrome){Start-Process -FilePath $chrome -ArgumentList $session.url}else{Start-Process $session.url}
Write-Host 'PAPER controls opened. Connect the configured trusted-operator wallet, sign in, then click Enable public PAPER trading.'
