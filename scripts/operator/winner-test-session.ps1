param([ValidateSet('WinnerTest','ReconcileWinnerTest')][string]$Mode='ReconcileWinnerTest',[Parameter(Mandatory=$true)][string]$ApplicationProcessIdList,[ValidatePattern('^[a-f0-9]{64}$')][string]$DashboardReviewSha256,[switch]$NonInteractiveRecovery)
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
function Assert-AdminFile([string]$file){
 if((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'CLAIM_PROTECTED_SOURCE_REPARSE_POINT'}
 $acl=Get-Acl -LiteralPath $file
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'CLAIM_SOURCE_OWNER_INVALID'}
 foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band ([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions)) -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'CLAIM_SOURCE_WRITABLE_OUTSIDE_ADMINISTRATORS'}}
}
$expected='GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW'
$isTransfer=$true;$isRecovery=$Mode -eq 'ReconcileWinnerTest';$runtimeName='winner-test.bundle.cjs'
$secretBytes=$null;$key=$null;$child=$null;$recoveryExitCode=0
try{
 if($NonInteractiveRecovery -and -not $isRecovery){throw 'CLAIM_RECOVERY_ONLY_SWITCH'}
 . (Join-Path $PSScriptRoot 'wallet-file-local.ps1')
 $identity=Assert-LocalSigner
 foreach($name in @('winner-test-session.ps1',$runtimeName,'claim-rpc.json')){Assert-AdminFile (Join-Path $PSScriptRoot $name)}
 if(-not $isRecovery){
 $ids=@($ApplicationProcessIdList.Split(',')|ForEach-Object{[int]$_});if($ids.Count -ne 2 -or $ids[0] -eq $ids[1]){throw 'CLAIM_API_WORKER_PIDS_REQUIRED'}
 foreach($appId in $ids){$app=Get-WmiObject Win32_Process -Filter "ProcessId=$appId";if(-not $app -or $app.Name -ne 'node.exe' -or $app.GetOwnerSid().Sid -eq $identity.User.Value){throw 'CLAIM_APPLICATION_IDENTITY_INVALID'}}
 }
 if($isTransfer -and -not $isRecovery -and -not $DashboardReviewSha256){throw 'WINNER_PROTECTED_EXACT_APPROVAL_REQUIRED'}
 $review=$null;$permit=$null
 if($Mode -in @('WinnerTest')){
  if($DashboardReviewSha256){$approved=Join-Path $PSScriptRoot ($(if($isTransfer){'manual-winner-test-'}else{'manual-claim-'})+$DashboardReviewSha256+'.json');Assert-AdminFile $approved;$envelope=Get-Content -LiteralPath $approved -Raw|ConvertFrom-Json}else{$envelope=Get-Content -LiteralPath (Join-Path $env:ProgramData 'PaperfundClaimReview\review.json') -Raw | ConvertFrom-Json}
  $review=$envelope.review
  if($Mode -in @('WinnerTest')){
   if($DashboardReviewSha256){$permit=$envelope.permit;if($permit.reviewSha256 -cne $DashboardReviewSha256){throw 'CLAIM_DASHBOARD_REVIEW_CHANGED'}}else{$permitPath=Join-Path $PSScriptRoot 'claim-authority.json';Assert-AdminFile $permitPath;$permit=Get-Content -LiteralPath $permitPath -Raw | ConvertFrom-Json}
   Write-Host ('MAINNET one-time winner test; round '+$review.plan.roundId+'; principal '+$review.plan.principalLamports+'; fee cap '+$review.plan.maximumFeeLamports+' lamports')
   Write-Host ('Message SHA256: '+$review.messageSha256+'; expires '+$review.expiresAt)
   if(-not $DashboardReviewSha256){$confirmation=Read-Host 'Type the complete reviewed message SHA256 to authorize THIS transaction locally';if($confirmation -cne $review.messageSha256){throw 'CLAIM_LOCAL_CONFIRMATION_REQUIRED'}}
  }
 }
 if(-not $isRecovery){
 $base=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PaperfundSigner'
 $records=@(Get-ChildItem -LiteralPath $base -Filter ($expected+'-*.dpapi') -File | Sort-Object LastWriteTimeUtc -Descending)
 if($records.Count -eq 0){throw 'CLAIM_IMPORTED_WALLET_NOT_FOUND'}
 $record=$records[0].FullName
 foreach($entry in @($base,$record)){
  $item=Get-Item -LiteralPath $entry;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'CLAIM_SECRET_REPARSE_POINT'}
  $acl=Get-Acl -LiteralPath $entry;if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value){throw 'CLAIM_SECRET_OWNER_INVALID'}
  foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($identity.User.Value,'S-1-5-18')){throw 'CLAIM_SECRET_ACCESS_NOT_PRIVATE'}}
 }
 Add-Type -AssemblyName System.Security
 $secretBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($record),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 $key=[Text.Encoding]::UTF8.GetString($secretBytes)
 }
 $start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe';$start.Arguments='"'+(Join-Path $PSScriptRoot $runtimeName)+'"';$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $child=[Diagnostics.Process]::Start($start)
 $payload=@{mode=$(if($isTransfer){if($isRecovery){'Reconcile'}else{'Execute'}}else{$Mode});key=$key;review=$review;permit=$permit}|ConvertTo-Json -Depth 30 -Compress
 $child.StandardInput.Write($payload);$child.StandardInput.Close();$payload=$null;$key=$null
 $output=$child.StandardOutput.ReadToEnd();$safeError=$child.StandardError.ReadToEnd();$child.WaitForExit()
 if($child.ExitCode -ne 0){
  $code=($safeError.Trim() -split '[\r\n]+')[-1]
  if($code -match '^(CLAIM|KEY|TRANSFER|WINNER)_[A-Z0-9_]+(:[a-zA-Z0-9_:-]+)?$'){throw $code}
  throw 'CLAIM_INTERNAL_RUNTIME_FAILED_NO_AUTOMATIC_RETRY'
 }
 $result=$output|ConvertFrom-Json
 $public=@{mode=$Mode;wallet=$expected;signerSid=$identity.User.Value;apiWorkerSeparated=$(if($DashboardReviewSha256){$null}else{-not $isRecovery});applicationIdentitySeparated=(-not $isRecovery);checkedOrdinaryProcessIds=$ids;recordPublicName=$(if($record){[IO.Path]::GetFileName($record)}else{$null});at=[DateTime]::UtcNow.ToString('o');result=$result}
 $public|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $env:ProgramData ('PaperfundSignerAcceptance\claim-recovery-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')+'.public.json'))
 $public|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $env:ProgramData ('PaperfundSignerAcceptance\claim-'+$Mode+'.public.json'))
 Write-Host ($public|ConvertTo-Json -Depth 20)
}catch{
 $recoveryExitCode=1
 @{mode=$Mode;at=[DateTime]::UtcNow.ToString('o');error=$_.Exception.Message;passed=$false}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $env:ProgramData ('PaperfundSignerAcceptance\claim-error-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')+'.public.json'))
 Write-Host ('CLAIM ACTION FAILED: '+$_.Exception.Message) -ForegroundColor Red
}finally{if($secretBytes){[Array]::Clear($secretBytes,0,$secretBytes.Length)};$key=$null;if($NonInteractiveRecovery){exit $recoveryExitCode};Read-Host 'Press Enter to close isolated claim window'|Out-Null}
