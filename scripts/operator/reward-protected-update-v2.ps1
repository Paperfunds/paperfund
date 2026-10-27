param([ValidateSet('Check','Install','Restore')][string]$Action='Check',[Parameter(Mandatory=$true)][string]$Plan,[Parameter(Mandatory=$true)][string]$PlanSHA256,[switch]$OwnerApproved,[int]$FailAfter=0,[int]$CrashAfter=0)
$ErrorActionPreference='Stop'
$global:RewardUpdateRecovery='NOT_NEEDED'
function Stage($name,$context=@{}) { $global:RewardUpdateStage=$name;$global:RewardUpdateContext=$context;if(Get-Command Write-UpdateDiagnostic -ErrorAction SilentlyContinue){Write-UpdateDiagnostic} }
Stage 'READ_PLAN' @{path=$Plan}
if(-not [IO.Path]::IsPathRooted($Plan)){throw 'ABSOLUTE_PLAN_PATH_REQUIRED'}
if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop}
function Hash($p){$global:RewardUpdateContext.path=$p;$global:RewardUpdateContext.actualSHA256=$null;$s=[IO.File]::OpenRead($p);$h=[Security.Cryptography.SHA256]::Create();try{$v=[BitConverter]::ToString($h.ComputeHash($s)).Replace('-','').ToLowerInvariant();$global:RewardUpdateContext.actualSHA256=$v;return $v}finally{$s.Dispose();$h.Dispose()}}
function ReadJson($p){Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}
$planBytes=[IO.File]::ReadAllBytes($Plan);$hasher=[Security.Cryptography.SHA256]::Create()
try{$actualPlanPin=[BitConverter]::ToString($hasher.ComputeHash($planBytes)).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose()}
Stage 'VERIFY_PLAN_HASH' @{path=$Plan;expectedSHA256=$PlanSHA256;actualSHA256=$actualPlanPin}
if($actualPlanPin -ne $PlanSHA256){throw 'UPDATE_PLAN_PIN'}
$p=[Text.Encoding]::UTF8.GetString($planBytes)|ConvertFrom-Json;$u=$p.protectedUpdate;$target=[IO.Path]::GetFullPath($u.target);$fixture=$p.environment -eq 'Fixture'
if($p.schema -ne 'PAPERFUND_REWARD_DEPLOYMENT_V1'){throw 'UPDATE_PLAN_SCHEMA'}
if($fixture){if(-not $target.StartsWith(([IO.Path]::GetTempPath()+'paperfund-reward-deploy-'),[StringComparison]::OrdinalIgnoreCase)){throw 'FIXTURE_TARGET_SCOPE'}}
else{
 if($target -ne (Join-Path $env:ProgramFiles 'PaperfundSigner')){throw 'PROTECTED_TARGET_SCOPE'}
 if($FailAfter -ne 0 -or $CrashAfter -ne 0){throw 'PRODUCTION_FAULT_INJECTION_REFUSED'}
 if($Action -ne 'Check'){$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent());if(-not $OwnerApproved -or -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'EXPLICIT_ADMIN_UPDATE_APPROVAL_REQUIRED'}}
}
function AssertPath($f){if((Get-Item -LiteralPath $f).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UPDATE_REPARSE_POINT'}}
Stage 'VERIFY_TARGET_AND_ACL' @{path=$target}
AssertPath $target
function Sddl($f){(Get-Acl -LiteralPath $f).Sddl}
if((Sddl $target) -ne $u.directorySddl){throw 'PROTECTED_DIRECTORY_ACL_CHANGED'}
function AssertTrustedAcl($f){
 if($fixture){return};$acl=Get-Acl -LiteralPath $f
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'UNTRUSTED_PROTECTED_OWNER'}
 foreach($r in $acl.Access){if($r.AccessControlType -eq 'Allow' -and ($r.FileSystemRights -band ([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions)) -and $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'UNTRUSTED_PROTECTED_WRITE_PERMISSION'}}
}
AssertTrustedAcl $target
Stage 'VERIFY_PACKAGE'
foreach($pin in $p.files){$global:RewardUpdateContext.expectedSHA256=$pin.sha256;$f=Join-Path $p.repositoryRoot $pin.path;if((Hash $f) -ne $pin.sha256){throw ('UPDATE_PACKAGE_CHANGED:'+ $pin.path)}}
$allowed=@('automation-service.bundle.cjs','mainnet-tools.bundle.cjs','automation-install-manifest.json')
if(@($u.files).Count -ne 3 -or @($u.files|Where-Object {$_.name -notin $allowed}).Count){throw 'UPDATE_ALLOWLIST'}
foreach($e in $u.files){$f=Join-Path $target $e.name;AssertPath $f;AssertTrustedAcl $f;if((Sddl $f) -ne $e.sddl){throw ('PROTECTED_FILE_ACL_CHANGED:'+ $e.name)}}
# All unchanged installed entries remain part of the integrity contract.
foreach($e in $u.unchanged){$f=Join-Path $target $e.name;AssertPath $f;if((Hash $f) -ne $e.sha256){throw ('UNCHANGED_INSTALLED_FILE_CHANGED:'+ $e.name)}}
Stage 'VERIFY_DESTINATIONS'
$backup=Join-Path $target ('reward-update-'+$PlanSHA256.Substring(0,16));$journal=Join-Path $backup 'journal.json'
function FlushJson($file,$value){$raw=[Text.Encoding]::UTF8.GetBytes(($value|ConvertTo-Json -Depth 20));$s=New-Object IO.FileStream($file,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$s.Write($raw,0,$raw.Length);$s.Flush($true)}finally{$s.Dispose()}}
function AssertHashState {foreach($e in $u.files){$h=Hash (Join-Path $target $e.name);if($h -ne $e.oldSHA256 -and $h -ne $e.newSHA256){throw ('UNVERIFIED_DESTINATION_REFUSED:'+ $e.name)}}}
AssertHashState
if($Action -eq 'Check'){Write-Output 'PASS: protected preimages/ACLs/package verified; no writes';return}
Stage 'ACQUIRE_MUTEX'
$mutexName=if($fixture){'Local\PaperfundRewardVerifier-'+$PlanSHA256.Substring(0,16)}else{'Global\PaperfundRewardVerifierUpdate'}
$updateMutex=New-Object Threading.Mutex($false,$mutexName)
if(-not $updateMutex.WaitOne(0)){throw 'ANOTHER_PROTECTED_UPDATE_ACTIVE'}
Stage 'BACKUP_ORIGINALS' @{path=$backup}
if(-not(Test-Path -LiteralPath $backup)){
 if($Action -eq 'Restore'){throw 'VERIFIED_UPDATE_BACKUP_REQUIRED'}
 foreach($e in $u.files){if((Hash (Join-Path $target $e.name)) -ne $e.oldSHA256){throw 'ORIGINAL_PREIMAGE_REQUIRED'}}
 [IO.Directory]::CreateDirectory($backup)|Out-Null
 $acl=Get-Acl -LiteralPath $target;Set-Acl -LiteralPath $backup -AclObject $acl
 foreach($e in $u.files){$f=Join-Path $backup $e.name;[IO.File]::Copy((Join-Path $target $e.name),$f,$false);if((Hash $f) -ne $e.oldSHA256){throw 'BACKUP_HASH_MISMATCH'}}
 FlushJson $journal @{planSHA256=$PlanSHA256;phase='BACKED_UP';originalsVerified=$true}
}
AssertPath $backup
if((Sddl $backup) -ne $u.directorySddl){throw 'BACKUP_ACL_CHANGED'}
$j=ReadJson $journal;if($j.planSHA256 -ne $PlanSHA256 -or -not $j.originalsVerified){throw 'UPDATE_JOURNAL_PIN'}
foreach($e in $u.files){if((Hash (Join-Path $backup $e.name)) -ne $e.oldSHA256){throw 'BACKUP_CHANGED'}}
$script:supervisor=$j.supervisor
function RecordPhase($phase){FlushJson $journal @{planSHA256=$PlanSHA256;phase=$phase;originalsVerified=$true;supervisor=$script:supervisor}}
function PauseSupervisor {
 Stage 'PAUSE_SUPERVISOR'
 if($fixture){return}
 $task=Get-ScheduledTask -TaskName 'PaperfundIsolatedAutomation' -ErrorAction Stop
 if(@($task.Actions).Count -ne 1 -or $task.Actions[0].Arguments -notlike ('*-File "'+(Join-Path $target 'automation-host.ps1')+'"') -or $task.Principal.UserId -notmatch '(^|\\)PaperfundSigner$'){throw 'EXISTING_SUPERVISOR_IDENTITY_CHANGED'}
 $status=ReadJson (Join-Path $env:ProgramData 'PaperfundAutomation/public/status.json')
 if($status.policy -or $status.settings.claims -or $status.settings.hourly -or $status.settings.daily -or -not $status.gate.stopped -or $status.unresolved -ne 0 -or @($status.jobs|Where-Object {$_.state -notin @('VERIFIED','REJECTED','EXPIRED')}).Count){throw 'PROTECTED_FINANCIAL_QUIESCENCE_REQUIRED'}
 if(-not $script:supervisor){
  if(([DateTime]::UtcNow-[DateTime]::Parse($status.at).ToUniversalTime()).TotalSeconds -gt 45){throw 'FRESH_NONE_AUTHORITY_STATUS_REQUIRED'}
  $xml=Export-ScheduledTask -TaskName 'PaperfundIsolatedAutomation'
  [IO.File]::WriteAllText((Join-Path $backup 'supervisor.original.xml'),$xml)
  $script:supervisor=@{wasEnabled=($task.State -ne 'Disabled');wasRunning=($task.State -eq 'Running');xmlSHA256=(Hash (Join-Path $backup 'supervisor.original.xml'))}
  RecordPhase 'PAUSING_SUPERVISOR'
 }
 if((Hash (Join-Path $backup 'supervisor.original.xml')) -ne $script:supervisor.xmlSHA256){throw 'SUPERVISOR_BACKUP_CHANGED'}
 Disable-ScheduledTask -TaskName 'PaperfundIsolatedAutomation'|Out-Null
 Stop-ScheduledTask -TaskName 'PaperfundIsolatedAutomation'
 for($i=0;$i -lt 60;$i++){if(-not(Get-Process -Id $status.processId -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 250}
 if(Get-Process -Id $status.processId -ErrorAction SilentlyContinue){throw 'SUPERVISOR_CHILD_DID_NOT_STOP_NO_FORCE'}
 $active=@(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='powershell.exe'"|Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -match 'PaperfundSigner[\\/](automation-host.ps1|automation-service.bundle.cjs|mainnet-tools.bundle.cjs)'})
 if($active.Count){throw 'PROTECTED_RUNTIME_STILL_ACTIVE'}
 RecordPhase 'SUPERVISOR_PAUSED'
}
function ResumeSupervisor {
 Stage 'RESUME_SUPERVISOR'
 if($fixture -or -not $script:supervisor){return}
 if($script:supervisor.wasEnabled){Enable-ScheduledTask -TaskName 'PaperfundIsolatedAutomation'|Out-Null}
 if($script:supervisor.wasRunning){Start-ScheduledTask -TaskName 'PaperfundIsolatedAutomation'}
}
function ReplaceVerified($e,$source,$expected){
 $dest=Join-Path $target $e.name;Stage 'REPLACE_VERIFIED_FILE' @{path=$dest;source=$source;expectedSHA256=$expected};AssertHashState
 $temp=Join-Path $target ($e.name+'.reward-stage');if(Test-Path -LiteralPath $temp){AssertPath $temp;[IO.File]::Move($temp,($temp+'.quarantine-'+[Guid]::NewGuid().ToString('N')))}
 try{
  [IO.File]::Copy($source,$temp,$false);$acl=Get-Acl -LiteralPath $dest;Set-Acl -LiteralPath $temp -AclObject $acl
  if((Hash $temp) -ne $expected -or (Sddl $temp) -ne $e.sddl){throw 'STAGED_HASH_OR_ACL'}
  $prior=$dest+'.reward-prior-'+[Guid]::NewGuid().ToString('N')
  [IO.File]::Replace($temp,$dest,$prior)
  if((Hash $dest) -ne $expected -or (Sddl $dest) -ne $e.sddl){throw 'REPLACEMENT_VERIFICATION_FAILED'}
  if((Hash $prior) -notin @($e.oldSHA256,$e.newSHA256)){throw 'REPLACEMENT_PREIMAGE_CHANGED'}
  Remove-Item -LiteralPath $prior
 }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
}
function RestoreOriginals {
 AssertHashState
 foreach($e in $u.files){ReplaceVerified $e (Join-Path $backup $e.name) $e.oldSHA256}
 RecordPhase 'RESTORED';$global:RewardUpdateRecovery='RESTORED'
}
if($Action -eq 'Restore'){PauseSupervisor;RestoreOriginals;ResumeSupervisor;Write-Output 'PASS: verified originals restored';return}
$replacementStarted=$false
try{
 PauseSupervisor
 $replacementStarted=$true
 RecordPhase 'REPLACING'
 $n=0
 # Plan order is two bundles first and the reviewed successor manifest last.
 foreach($e in $u.files){ReplaceVerified $e (Join-Path $p.repositoryRoot $e.source) $e.newSHA256;$n++;if($CrashAfter -eq $n){exit 91};if($FailAfter -eq $n){throw 'SIMULATED_REPLACEMENT_FAILURE'}}
 RecordPhase 'INSTALLED'
 ResumeSupervisor
 Write-Output 'PASS: verified bundles and successor manifest installed; no financial entrypoint invoked'
}catch{
 $primary=$_
 if(Get-Command Register-UpdateError -ErrorAction SilentlyContinue){Register-UpdateError $primary}
 Stage 'AUTO_RESTORE'
 try{if($replacementStarted){RestoreOriginals};ResumeSupervisor}catch{
  $global:RewardUpdateRecovery='FAILED'
  if(Get-Command Register-UpdateError -ErrorAction SilentlyContinue){Register-UpdateError $_}
 }
 throw $primary
}finally{$updateMutex.ReleaseMutex();$updateMutex.Dispose()}
