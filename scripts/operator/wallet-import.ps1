param([string]$ExpectedAddress='GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW',[int[]]$ApplicationProcessIds,[string]$KeyFile,[switch]$DiagnosticOnly,[switch]$PassThru)
$ErrorActionPreference='Stop'
# Run from the protected installation, never mutable API/worker source.
$installation=Join-Path $env:ProgramFiles 'PaperfundSigner'
if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($installation)){throw 'Install the reviewed importer into Program Files\PaperfundSigner with administrator-owned read-only source before importing a key. See OPERATOR_LAUNCHER.md.'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or @($identity.Groups | Where-Object {$_.Value -eq 'S-1-5-32-544'}).Count -gt 0){throw 'Use a dedicated non-administrator signer Windows account.'}
if(-not $ApplicationProcessIds -or $ApplicationProcessIds.Count -lt 2){throw 'Supply current API and worker PIDs to verify separate identities.'}
if(@($ApplicationProcessIds | Select-Object -Unique).Count -ne $ApplicationProcessIds.Count){throw 'Supply distinct actual API and worker PIDs.'}
foreach($nodeProcess in @(Get-WmiObject Win32_Process -Filter "Name='node.exe'")){
 try{$nodeOwner=$nodeProcess.GetOwnerSid()}catch{if(-not(Get-WmiObject Win32_Process -Filter ("ProcessId="+$nodeProcess.ProcessId))){continue};throw 'KEY_PROCESS_OWNER_CHECK_FAILED'}
 if($nodeOwner.ReturnValue -eq 0 -and $nodeOwner.Sid -eq $identity.User.Value){throw 'No ordinary Node process may run under the dedicated signer identity. Close it before import.'}
}
foreach($id in $ApplicationProcessIds){
 $p=Get-WmiObject Win32_Process -Filter "ProcessId=$id"
 if(-not $p -or $p.Name -ne 'node.exe'){throw 'Application process missing or invalid.'}
 $owner=$p.GetOwnerSid()
 if($owner.ReturnValue -ne 0 -or $owner.Sid -eq $identity.User.Value){throw 'Signer must use a different Windows identity from API/worker.'}
}
foreach($file in @($installation,(Join-Path $installation 'wallet-import.ps1'),(Join-Path $installation 'key-public.mjs'))){
 if((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Signer installation may not contain symbolic links/reparse points.'}
 $acl=Get-Acl -LiteralPath $file
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-32-544','S-1-5-18')){throw 'Signer source must be owned by Administrators or SYSTEM.'}
foreach($rule in $acl.Access){
 if($rule.AccessControlType -eq 'Allow' -and (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0)){
  $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if($sid -notin @('S-1-5-18','S-1-5-32-544')){throw 'Signer installation is writable outside Administrators/SYSTEM.'}
 }
}
}
$node=Join-Path $env:ProgramFiles 'nodejs\node.exe'
if(-not(Test-Path -LiteralPath $node)){throw 'Administrator-installed Node.js required.'}
Write-Host ('Expected public address: '+$ExpectedAddress)
Write-Host 'Import grants NO transaction authority. Financial STOP remains asserted.'
$secret=$null;$ptr=[IntPtr]::Zero;$plain=$null
$folder=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PaperfundSigner'
$expectedFile=Join-Path $folder 'Import\phantom-private-key.txt'
if($KeyFile){
 if([IO.Path]::GetFullPath($KeyFile) -ne [IO.Path]::GetFullPath($expectedFile)){throw 'KEY_FILE_LOCATION_NOT_ALLOWED'}
 foreach($entry in @($folder,(Split-Path $expectedFile),$expectedFile)){
  $item=Get-Item -LiteralPath $entry
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'KEY_FILE_REPARSE_POINT_REFUSED'}
  $acl=Get-Acl -LiteralPath $entry
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value){throw 'KEY_FILE_OWNER_MISMATCH'}
  foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($identity.User.Value,'S-1-5-18')){throw 'KEY_FILE_ACCESS_NOT_PRIVATE'}}
 }
 if((Get-Item -LiteralPath $expectedFile).Length -gt 16384){throw 'KEY_INPUT_TOO_LONG'}
}else{$secret=Read-Host 'Paste 32-byte seed or 64-byte keypair (base58 or one-line JSON; hidden)' -AsSecureString}
try {
 if($KeyFile){$plain=[IO.File]::ReadAllText($expectedFile,[Text.Encoding]::UTF8)}else{$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
 $start=New-Object Diagnostics.ProcessStartInfo
 $start.FileName=$node;$start.Arguments='"'+(Join-Path $installation 'key-public.mjs')+'"'
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $child=[Diagnostics.Process]::Start($start)
 $child.StandardInput.Write($plain);$child.StandardInput.Close()
 $derived=$child.StandardOutput.ReadToEnd().Trim();$safeError=$child.StandardError.ReadToEnd().Trim();$child.WaitForExit()
 if($child.ExitCode -ne 0){if($safeError -notmatch '^KEY_[A-Z0-9_]+$'){$safeError='KEY_VALIDATION_FAILED'};throw $safeError}
 Write-Host ('Derived public address: '+$derived)
 if($derived -ne $ExpectedAddress){$mismatch=New-Object InvalidOperationException('KEY_DERIVED_ADDRESS_MISMATCH_NOT_STORED');$mismatch.Data['DerivedAddress']=$derived;throw $mismatch}
 if($DiagnosticOnly){if($PassThru){[PSCustomObject]@{validated=$true;stored=$false;publicAddress=$derived}};return}
 $bytes=[Text.Encoding]::UTF8.GetBytes($plain)
 try{Add-Type -AssemblyName System.Security;$encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)}finally{[Array]::Clear($bytes,0,$bytes.Length)}
 [IO.Directory]::CreateDirectory($folder) | Out-Null
 if((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'KEY_STORAGE_REPARSE_POINT_REFUSED'}
 $privateAcl=(New-Object IO.DirectoryInfo($folder)).GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
 $privateAcl.SetAccessRuleProtection($true,$false);foreach($rule in @($privateAcl.Access)){$privateAcl.RemoveAccessRuleSpecific($rule)};$privateAcl.SetOwner($identity.User)
 $privateAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
 $privateAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
 (New-Object IO.DirectoryInfo($folder)).SetAccessControl($privateAcl)
 $record=Join-Path $folder ($ExpectedAddress+'-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')+'-'+[Guid]::NewGuid().ToString('N')+'.dpapi')
 $stream=[IO.File]::Open($record,[IO.FileMode]::CreateNew);try{$stream.Write($encrypted,0,$encrypted.Length)}finally{$stream.Dispose()}
 @{version='paperfund-local-wallet-v1';publicAddress=$derived;network='mainnet-beta';signerSid=$identity.User.Value;createdAt=[DateTime]::UtcNow.ToString('o');authorization='NONE'} | ConvertTo-Json | Set-Content -LiteralPath ($record+'.public.json')
 if($KeyFile){try{[IO.File]::WriteAllBytes($expectedFile,[byte[]]@());[IO.File]::Delete($expectedFile)}catch{throw 'KEY_IMPORTED_BUT_PLAINTEXT_REMOVAL_FAILED'}}
 if($PassThru){[PSCustomObject]@{validated=$true;stored=$true;publicAddress=$derived;record=$record;plaintextRemoved=([bool]$KeyFile -and -not(Test-Path -LiteralPath $expectedFile))}}
 Write-Host ('Wallet validated and DPAPI encrypted under signer identity: '+$derived)
 Write-Host 'Execution remains blocked pending protected provider enrollment and transaction-specific approval.'
}finally{
 $plain=$null;if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)};if($secret){$secret.Dispose()}
}
