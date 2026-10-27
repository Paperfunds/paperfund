param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ReviewSha256,[switch]$PreviewOnly,[switch]$ReadOnlyLaunchTest,[switch]$RecoveryOnly)
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
function Assert-ProtectedFile([string]$file){
 $item=Get-Item -LiteralPath $file
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'CLAIM_PROTECTED_SOURCE_REPARSE_POINT'}
 $acl=Get-Acl $file
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'CLAIM_SOURCE_OWNER_INVALID'}
 foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band ([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions)) -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'CLAIM_SOURCE_WRITABLE_OUTSIDE_ADMINISTRATORS'}}
}
function Get-ValidatedReview {
 $envelope=Get-Content -LiteralPath (Join-Path $env:ProgramData 'PaperfundClaimReview\developer-transfer-review.json') -Raw|ConvertFrom-Json
 $r=$envelope.review
 $start=New-Object Diagnostics.ProcessStartInfo
 $start.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe';$start.Arguments='"'+(Join-Path $target 'developer-transfer.bundle.cjs')+'"';$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $child=[Diagnostics.Process]::Start($start)
 $child.StandardInput.Write((@{mode='ApprovalTemplate';review=$r;operator=[Security.Principal.WindowsIdentity]::GetCurrent().Name}|ConvertTo-Json -Depth 40 -Compress));$child.StandardInput.Close()
 $output=$child.StandardOutput.ReadToEnd();$safeError=$child.StandardError.ReadToEnd();$child.WaitForExit()
 if($child.ExitCode -ne 0){$code=($safeError.Trim() -split '[\r\n]+')[-1];if($code -match '^(CLAIM|TRANSFER)_[A-Z0-9_]+$'){throw $code};throw 'CLAIM_EXPIRED_OR_INVALID_PREPARE_AGAIN'}
 $permit=$output|ConvertFrom-Json
 if($permit.reviewSha256 -cne $ReviewSha256){throw 'CLAIM_DASHBOARD_REVIEW_CHANGED'}
 if($r.recipient -cne '53sJCZ59TSkVynoD9SfaAXZMKyZtvRgN9QZTrzqRXrbx'){throw 'TRANSFER_RECIPIENT_MISMATCH'}
 return @{review=$r;permit=$permit}
}
function Set-NativeLaunchPhase([string]$Phase,[string]$Code=''){
 $public=@{at=[DateTime]::UtcNow.ToString('o');phase=$Phase;error=$Code;processId=$PID;sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;userInteractive=[Environment]::UserInteractive;readOnlyTest=[bool]$ReadOnlyLaunchTest;reviewSha256=$ReviewSha256;authorityGranted=$false;signingPerformed=$false;broadcast=$false}
 try{[IO.File]::WriteAllText((Join-Path $env:ProgramData 'PaperfundSignerAcceptance\native-developer-transfer-launch.public.json'),($public|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))}catch{Write-Host 'CLAIM_NATIVE_PUBLIC_STATUS_WRITE_FAILED'}
}
function Invoke-IsolatedRecovery([string]$RecoveryMode){
 $started=[DateTime]::UtcNow;$stem='developer-transfer-readonly-'+$PID+'-'+$RecoveryMode+'-'+$started.ToString('yyyyMMddHHmmssfff');$log=Join-Path $env:ProgramData 'PaperfundSignerAcceptance';$out=Join-Path $log ($stem+'.stdout.public.log');$err=Join-Path $log ($stem+'.stderr.public.log')
 $p=Start-Process powershell.exe -Credential $credential -LoadUserProfile -WorkingDirectory $target -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',('"'+(Join-Path $target 'claim-session.ps1')+'"'),'-Mode',$RecoveryMode,'-ApplicationProcessIdList','0,0','-NonInteractiveRecovery')
 $null=$p.Handle;$p.WaitForExit();if($p.ExitCode -ne 0){throw 'TRANSFER_RECOVERY_FAILED_INSPECT_READONLY_LOG'}
 $r=Get-Content -LiteralPath (Join-Path $log ('claim-'+$RecoveryMode+'.public.json')) -Raw|ConvertFrom-Json
 if([datetime]::Parse($r.at).ToUniversalTime() -lt $started -or -not $r.result.readOnly -or $r.result.keyUnlocked -or $r.result.signingPerformed -or $r.result.broadcast -or -not $r.result.originalJournalAndLockUnchanged){throw 'TRANSFER_FRESH_RECOVERY_UNVERIFIED'}
 return $r
}
$password=$null
try {
 if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)){throw 'CLAIM_INSTALLED_PROTECTED_TOOL_REQUIRED'}
 foreach($name in @('review-developer-transfer.ps1','claim-session.ps1','developer-transfer.bundle.cjs','manual-developer-transfer-install-manifest.json','claim-runtime.bundle.cjs','claim-rpc.json')){Assert-ProtectedFile (Join-Path $target $name)}
 $manifest=Get-Content (Join-Path $target 'manual-developer-transfer-install-manifest.json') -Raw|ConvertFrom-Json
 foreach($f in $manifest.files){Assert-ProtectedFile (Join-Path $target $f.name);if((Get-FileHash (Join-Path $target $f.name)).Hash -ne $f.sha256){throw 'CLAIM_MANUAL_INSTALLED_HASH_CHANGED'}}
 if(-not $RecoveryOnly){$checked=Get-ValidatedReview}
 if($PreviewOnly){@{validated=$true;readOnly=$true;reviewSha256=$ReviewSha256;authorityGranted=$false;signingPerformed=$false;broadcast=$false}|ConvertTo-Json;return}
 $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
 if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'CLAIM_LOCAL_ADMIN_CONSENT_REQUIRED'}
 if(-not [Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -le 0){throw 'CLAIM_INTERACTIVE_DESKTOP_REQUIRED'}
 Set-NativeLaunchPhase 'WINDOWS_PASSWORD_REQUIRED'
 Write-Host 'Enter ONLY the existing PaperfundSigner WINDOWS account password. No wallet key is requested.'
 $password=Read-Host 'PaperfundSigner Windows password (hidden)' -AsSecureString
 $credential=New-Object Management.Automation.PSCredential(($env:COMPUTERNAME+'\PaperfundSigner'),$password)
 Set-NativeLaunchPhase 'RECONCILING_READ_ONLY'
 $transferState=Invoke-IsolatedRecovery 'ReconcileDeveloperTransfer'
 if($RecoveryOnly){Set-NativeLaunchPhase 'READ_ONLY_RECOVERY_COMPLETED';Write-Host ($transferState|ConvertTo-Json -Depth 30);return}
 if($transferState.result.lockPresent -or @($transferState.result.records).Count -ne 0){throw 'TRANSFER_ALREADY_RESERVED_OR_EXECUTED_RECONCILE_ONLY'}
 $claimState=Invoke-IsolatedRecovery 'Reconcile'
 $records=@($claimState.result.records)
 if($records.Count -ne 1 -or $records[0].signature -cne '2R9LJiad5GXZ4dajxAYAERsrqCMQfB2A8dhnRTabcSNyNLDHiGn4prz48gEpdVXJLcMMRsnyyJEr9z5ggz9uFsfv' -or $records[0].status -ne 'FINALIZED_VERIFIED' -or -not $records[0].signedBytesVerified){throw 'TRANSFER_SOURCE_CLAIM_RECONCILIATION_REQUIRED'}
 # The finalized claim's existing execution lock and signed journal are deliberately preserved.
 Set-NativeLaunchPhase 'SIMULATING_UNSIGNED_TRANSFER'
 # Obtain a fresh UNSIGNED simulation after the Windows password prompt. Approval has not occurred yet.
 $prep=New-Object Diagnostics.ProcessStartInfo;$prep.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe';$prep.Arguments='"'+(Join-Path $target 'developer-transfer.bundle.cjs')+'" Prepare';$prep.UseShellExecute=$false;$prep.CreateNoWindow=$true;$prep.RedirectStandardOutput=$true;$prep.RedirectStandardError=$true
 $preparer=[Diagnostics.Process]::Start($prep);$fresh=$preparer.StandardOutput.ReadToEnd();$prepError=$preparer.StandardError.ReadToEnd();$preparer.WaitForExit()
 if($preparer.ExitCode -ne 0){$code=($prepError.Trim() -split '[\r\n]+')[-1];if($code -match '^(CLAIM|TRANSFER)_[A-Z0-9_]+(:[a-zA-Z0-9_:-]+)?$'){throw $code};throw 'CLAIM_FRESH_SIMULATION_FAILED_NO_AUTHORITY'}
 $freshEnvelope=$fresh|ConvertFrom-Json
 $ReviewSha256=$freshEnvelope.reviewSha256
 [IO.File]::WriteAllText((Join-Path $env:ProgramData 'PaperfundClaimReview\developer-transfer-review.json'),$fresh,(New-Object Text.UTF8Encoding($false)))
 $checked=Get-ValidatedReview
 $r=$checked.review
 Add-Type -AssemblyName System.Windows.Forms
 $details="MAINNET: authorize ONE developer transfer TEST`r`nSender: $($r.sender)`r`nRecipient: $($r.recipient)`r`nRecipient amount: $($r.recipientLamports) lamports`r`nTransfer fee / maximum: $($r.maximumFeeLamports) lamports`r`nNew sender debit: $($r.totalDebitLamports) lamports`r`nPrior claim fee: $($r.claimFeeLamports) lamports`r`nTotal platform cost / allocation: $($r.totalPlatformCostLamports) / $($r.platformAllocationLamports) lamports`r`nSource claim: $($r.claimSignature)`r`nMessage SHA256: $($r.messageSha256)`r`nExpires UTC: $($r.expiresAt)`r`n`r`nMANUALLY AUTHORIZED MAINNET TRANSFER TEST. Not token-attributed or database-credited. No competition payout or unattended authority. Financial STOP remains asserted. YES authorizes exactly ONE displayed transfer; NO cancels."
 $title='Paperfund - exact MAINNET developer transfer authorization'
 if($ReadOnlyLaunchTest){$title='Paperfund - READ-ONLY developer transfer test';$details="READ-ONLY LAUNCH TEST: neither YES nor NO can authorize a transaction. Recovery completed without unlocking the wallet. No permit will be stored and no signing process will be launched.`r`n`r`n"+$details}
 Set-NativeLaunchPhase $(if($ReadOnlyLaunchTest){'READ_ONLY_CONFIRMATION_VISIBLE'}else{'EXACT_CONFIRMATION_VISIBLE'})
 $answer=[Windows.Forms.MessageBox]::Show($details,$title,'YesNo','Warning','Button2')
 if($ReadOnlyLaunchTest){Set-NativeLaunchPhase 'READ_ONLY_TEST_COMPLETED';Write-Host 'READ-ONLY LAUNCH TEST PASSED. No authority, wallet unlock, signing or broadcast.';return}
 if($answer -ne 'Yes'){throw 'CLAIM_OPERATOR_CANCELLED'}
 # Revalidate the SAME bytes and expiry after local approval; never auto-refresh a transaction.
 $checked=Get-ValidatedReview
 $dest=Join-Path $target ('manual-developer-transfer-'+$ReviewSha256+'.json')
 if(Test-Path -LiteralPath $dest){throw 'CLAIM_ALREADY_AUTHORIZED_RECONCILE_FIRST'}
 $payload=$checked|ConvertTo-Json -Depth 40 -Compress
 $stream=New-Object IO.FileStream($dest,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes($payload);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 $acl=Get-Acl $dest;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl $dest $acl;Assert-ProtectedFile $dest
 $signerSid=(New-Object Security.Principal.NTAccount($env:COMPUTERNAME,'PaperfundSigner')).Translate([Security.Principal.SecurityIdentifier]).Value
 $nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
 $apps=@($nodes|Where-Object {$_.CommandLine -match '[\\/]Paperfund-new[\\/](apps[\\/](api|worker)[\\/]|scripts[\\/]operator[\\/]server\.mjs)' -or $_.CommandLine -match 'scripts/operator/server\.mjs'})
 $ids=@($apps|ForEach-Object {$owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid;if($owner.Sid -eq $signerSid){throw 'CLAIM_APPLICATION_IDENTITY_INVALID'};[int]$_.ProcessId}|Select-Object -Unique)
 if($ids.Count -lt 1){throw 'CLAIM_APPLICATION_IDENTITY_UNAVAILABLE'}
 # Session checks two distinct ordinary-process identities. Console+worker are valid if API is offline.
 if($ids.Count -eq 1){throw 'CLAIM_APPLICATION_IDENTITY_UNAVAILABLE'}
 $pair=[string]$ids[0]+','+[string]$ids[1]
 Start-Process powershell.exe -Credential $credential -LoadUserProfile -WorkingDirectory $target -WindowStyle Normal -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','RemoteSigned','-File',('"'+(Join-Path $target 'claim-session.ps1')+'"'),'-Mode','DeveloperTransfer','-ApplicationProcessIdList',$pair,'-DashboardReviewSha256',$ReviewSha256)
 Write-Host 'Exact developer transfer authorized locally. Watch the isolated signer result; never repeat Execute after uncertainty. Use Reconcile.'
} catch {
 $code=$_.Exception.Message
 if($code -notmatch '^(CLAIM|TRANSFER)_[A-Z0-9_]+(:[a-zA-Z0-9_:-]+)?$'){$code='CLAIM_LOCAL_LAUNCH_FAILED_AT_LINE_'+$_.InvocationInfo.ScriptLineNumber}
 Set-NativeLaunchPhase 'FAILED' $code
 Write-Host $code -ForegroundColor Red
 @{at=[DateTime]::UtcNow.ToString('o');error=$code;errorCategory=[string]$_.CategoryInfo.Category;errorId=$_.FullyQualifiedErrorId;reviewSha256=$ReviewSha256}|ConvertTo-Json|Set-Content (Join-Path $env:ProgramData 'PaperfundSignerAcceptance\manual-developer-transfer-error.public.json')
} finally {if($password){$password.Dispose()}}
