# Standard account + existing protected importer + disposable OFFLINE proof only.
$ErrorActionPreference='Stop'
$password=$null;$mutex=$null;$locked=$false;$results=$null
function Assert-Protected($Path) {
 $item=Get-Item -LiteralPath $Path
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Protected installation cannot use reparse points'}
 $acl=Get-Acl -LiteralPath $Path
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Existing installation is not administrator-owned; retained without changes'}
 foreach($rule in $acl.Access){
  if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band ([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions))){
   if($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Existing installation has unsafe write permissions; retained without changes'}
  }
 }
}
try {
 $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
 if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Elevated local PowerShell required'}
 $mutex=New-Object Threading.Mutex($false,'Local\PaperfundSignerSetup')
 $locked=$mutex.WaitOne(0);if(-not $locked){throw 'Another signer setup is active; close that setup window first'}
 $account='PaperfundSigner';$description='Paperfund isolated signer; no authority'
 if($description.Length -gt 48){throw 'Account description exceeds 48 characters'}
 $target=Join-Path $env:ProgramFiles 'PaperfundSigner'
 $reviewedUpdates=@{'disposable-signing-proof.mjs'='C7F2BE8A423AD7DFDCC52188F753EDED97FD3FF2EE5F9B8BF3CAF148AF68EA31'}
 $names=@('wallet-import.ps1','key-public.mjs','disposable-dpapi.ps1','disposable-signing-proof.mjs','run-disposable-proof.ps1')
 $user=Get-LocalUser -Name $account -ErrorAction SilentlyContinue
 if($user){
  if(-not $user.Enabled){throw 'Existing signer account is disabled; retained without changing credentials'}
  $admins=Get-LocalGroupMember -SID 'S-1-5-32-544'
  if(@($admins | Where-Object {$_.SID.Value -eq $user.SID.Value}).Count -gt 0){throw 'Existing signer is an administrator; retained without changing membership'}
 }
 if(Test-Path -LiteralPath $target){
  Assert-Protected $target
  foreach($name in $names){$file=Join-Path $target $name;if(Test-Path -LiteralPath $file){Assert-Protected $file;if((Get-FileHash -LiteralPath $file).Hash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $name)).Hash){
    if($reviewedUpdates.ContainsKey($name) -and (Get-FileHash -LiteralPath $file).Hash -eq $reviewedUpdates[$name]){
     $backup=$file+'.before-'+$reviewedUpdates[$name].Substring(0,12)
     if(-not(Test-Path -LiteralPath $backup)){[IO.File]::Copy($file,$backup,$false);$backupAcl=Get-Acl -LiteralPath $backup;$backupAcl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath $backup -AclObject $backupAcl}
     [IO.File]::WriteAllBytes($file,[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $name)))
    }else{throw ('Existing protected file differs: '+$name+'. Retained; reviewed repair required')}
   }}}
 }
 Write-Host 'Approved setup: standard signer account and disposable OFFLINE tests. No wallet private key is requested.'
 if($user){
  Write-Host 'Reusing the existing account; its password will NOT be reset.'
  $password=Read-Host 'Existing PaperfundSigner WINDOWS account password (hidden)' -AsSecureString
 }else{
  Write-Host 'Choose a WINDOWS ACCOUNT password; remember it for signer sign-in.'
  $password=Read-Host 'New PaperfundSigner Windows account password (hidden)' -AsSecureString
  $confirm=Read-Host 'Repeat Windows account password (hidden)' -AsSecureString
  $a=[IntPtr]::Zero;$b=[IntPtr]::Zero
  try{
   $a=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($password);$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
   if([Runtime.InteropServices.Marshal]::PtrToStringBSTR($a) -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)){throw 'Passwords differ; no account created'}
  }finally{if($a -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($a)};if($b -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)};$confirm.Dispose()}
  $user=New-LocalUser -Name $account -Password $password -Description $description
 }
 $users=(Get-LocalGroup -SID 'S-1-5-32-545').Name
 if(@(Get-LocalGroupMember -Group $users | Where-Object {$_.SID.Value -eq $user.SID.Value}).Count -eq 0){Add-LocalGroupMember -Group $users -Member $user}
 if(-not(Test-Path -LiteralPath $target)){
  & (Join-Path $PSScriptRoot 'install-importer.ps1')
 }
 foreach($name in $names){
  $file=Join-Path $target $name
  if(-not(Test-Path -LiteralPath $file)){
   [IO.File]::Copy((Join-Path $PSScriptRoot $name),$file,$false)
   $acl=Get-Acl -LiteralPath $file;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath $file -AclObject $acl
  }
  Assert-Protected $file
 }
 $results=Join-Path $env:ProgramData 'PaperfundSignerAcceptance'
 [IO.Directory]::CreateDirectory($results) | Out-Null
 $acl=New-Object Security.AccessControl.DirectorySecurity
 $acl.SetAccessRuleProtection($true,$false);$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
 foreach($sid in @('S-1-5-18','S-1-5-32-544',$user.SID.Value)){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')),'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')))
 Set-Acl -LiteralPath $results -AclObject $acl
 $run=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')
 $proofPath=Join-Path $results ($run+'.proof.public.json');$errorPath=Join-Path $results ($run+'.error.txt')
 $credential=New-Object Management.Automation.PSCredential(($env:COMPUTERNAME+'\'+$account),$password)
 $runner=Join-Path $target 'run-disposable-proof.ps1'
 $process=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList @('-NoProfile','-ExecutionPolicy','RemoteSigned','-File',('"'+$runner+'"')) -Credential $credential -LoadUserProfile -WorkingDirectory $target -WindowStyle Hidden -RedirectStandardOutput $proofPath -RedirectStandardError $errorPath -PassThru
 $process.WaitForExit()
 if($null -ne $process.ExitCode -and $process.ExitCode -ne 0){throw ('Disposable proof failed; inspect '+$errorPath+'. Existing account and credentials retained')}
 $proof=Get-Content -LiteralPath $proofPath -Raw | ConvertFrom-Json
 if(-not $proof.passed -or $proof.signerSid -ne $user.SID.Value){throw 'Proof identity mismatch'}
 @{account=$account;signerSid=$user.SID.Value;passed=$true;proofFile=$proofPath;protectedInstallation=$target;scope='DISPOSABLE_OFFLINE_ONLY';financialAuthority='NONE';at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $results 'setup.public.json')
 Write-Host 'PASS: isolated disposable signing and same-profile DPAPI restoration. No broadcast or real-key import.' -ForegroundColor Green
} catch {
 Write-Host ('SETUP ACTION REQUIRED: '+$_.Exception.Message) -ForegroundColor Red
 if($results){@{passed=$false;error=$_.Exception.Message;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $results 'setup-error.public.json')}
} finally {
 if($password){$password.Dispose()}
 if($locked){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()}
 Read-Host 'Press Enter to close this setup window' | Out-Null
}
