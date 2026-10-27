param([Parameter(Mandatory=$true)][string]$Plan,[Parameter(Mandatory=$true)][string]$ReviewedPlanSha256)
$ErrorActionPreference='Stop'
if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Specific approved deployment requires administrator consent'}
if((Get-FileHash -LiteralPath $Plan).Hash -ne $ReviewedPlanSha256){throw 'Reviewed deployment plan changed'}
$p=Get-Content -LiteralPath $Plan -Raw|ConvertFrom-Json
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
$mf=Join-Path $target 'automation-install-manifest.json'
if((Get-FileHash $mf).Hash -ne $p.installedManifestSha256){throw 'Existing protected installation changed; preserve and review'}
foreach($f in $p.installedFiles){if((Get-FileHash (Join-Path $target $f.name)).Hash -ne $f.sha256){throw 'Existing protected artifact changed'}}
$source=Join-Path $p.repository 'scripts\operator'
if((Get-FileHash (Join-Path $source 'automation-install-manifest.json')).Hash -ne $p.sourceManifestSha256){throw 'New reviewed manifest changed'}
$next=Get-Content (Join-Path $source 'automation-install-manifest.json') -Raw|ConvertFrom-Json
foreach($f in $next.files){if((Get-FileHash (Join-Path $source $f.name)).Hash -ne $f.sha256){throw 'New reviewed source changed'}}
$statusPath=Join-Path $env:ProgramData 'PaperfundAutomation\public\status.json'
$status=Get-Content $statusPath -Raw|ConvertFrom-Json
if(([DateTime]::UtcNow-[DateTime]::Parse($status.at)).TotalSeconds -gt 45 -or $status.policy -or $status.settings.claims -or $status.settings.hourly -or $status.settings.daily -or -not $status.gate.stopped){throw 'Fresh NONE authority, OFF channels and financial STOP required'}
# Called only after separate deployment approval. The existing account/task/credential are reused.
$stamp=[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')
Stop-ScheduledTask -TaskName 'PaperfundIsolatedAutomation'
try{
 for($i=0;$i -lt 30;$i++){if(-not(Get-CimInstance Win32_Process -Filter ('ProcessId='+$status.processId))){break};Start-Sleep -Milliseconds 200}
 if(Get-CimInstance Win32_Process -Filter ('ProcessId='+$status.processId)){throw 'Existing signer child did not stop; preserve singleton and investigate'}
 foreach($f in $next.files){
  $dest=Join-Path $target $f.name
  if(Test-Path $dest){if((Get-FileHash $dest).Hash -eq $f.sha256){continue};Copy-Item -LiteralPath $dest -Destination ($dest+'.before-mainnet-'+$stamp)}
  [IO.File]::WriteAllBytes($dest,[IO.File]::ReadAllBytes((Join-Path $source $f.name)))
  $acl=Get-Acl $dest;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl $dest $acl
 }
 Copy-Item -LiteralPath $mf -Destination ($mf+'.before-mainnet-'+$stamp)
 [IO.File]::WriteAllBytes($mf,[IO.File]::ReadAllBytes((Join-Path $source 'automation-install-manifest.json')))
 $payload=@{repository=$p.repository;previousMigrationHash=$p.previousMigrationSha256}|ConvertTo-Json -Compress
 $start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe';$start.Arguments='"'+(Join-Path $target 'mainnet-tools.bundle.cjs')+'" apply-schema';$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $child=[Diagnostics.Process]::Start($start);$child.StandardInput.Write($payload);$child.StandardInput.Close();$output=$child.StandardOutput.ReadToEnd();$errors=$child.StandardError.ReadToEnd();$child.WaitForExit()
 if($child.ExitCode -ne 0){$codes=@($errors -split '[\r\n]+'|Where-Object {$_ -match '^AUTO_[A-Z0-9_]+$'});if($codes.Count){throw $codes[-1]};throw 'Reviewed additive schema update failed; originals and evidence preserved'}
 @{passed=$true;at=[DateTime]::UtcNow.ToString('o');authority='NONE';channels='ALL_OFF';schema=($output|ConvertFrom-Json);apiWorkerRestarted=$false}|ConvertTo-Json -Depth 10|Set-Content (Join-Path $env:ProgramData 'PaperfundSignerAcceptance\mainnet-backend-update.public.json')
}finally{
 Start-ScheduledTask -TaskName 'PaperfundIsolatedAutomation'
}
