param([ValidateSet('WriteAudit','ReadAudit','WriteWallet','ReadWallet')][string]$Mode)
$ErrorActionPreference='Stop'
if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop}
try {
 . (Join-Path $PSScriptRoot 'wallet-file-local.ps1')
 $identity=Assert-LocalSigner
 $base=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PaperfundSigner\automation'
 foreach($dir in @($base,(Join-Path $base 'keys'))){
  if(Test-Path $dir){if((Get-Item $dir).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'AUTO_PRIVATE_PATH_INVALID'}}
  [IO.Directory]::CreateDirectory($dir)|Out-Null
  $acl=(New-Object IO.DirectoryInfo($dir)).GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
  $acl.SetAccessRuleProtection($true,$false);foreach($r in @($acl.Access)){$acl.RemoveAccessRuleSpecific($r)};$acl.SetOwner($identity.User)
  foreach($sid in @($identity.User.Value,'S-1-5-18')){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}
  (New-Object IO.DirectoryInfo($dir)).SetAccessControl($acl)
 }
 Add-Type -AssemblyName System.Security
 $bytes=$null;$plain=$null
 if($Mode -eq 'WriteAudit'){$record=Join-Path $base 'audit.dpapi';$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())}
 if($Mode -eq 'ReadAudit'){$record=Join-Path $base 'audit.dpapi'}
 if($Mode -eq 'WriteWallet'){$inputValue=[Console]::In.ReadToEnd()|ConvertFrom-Json;if($inputValue.wallet -notmatch '^[1-9A-HJ-NP-Za-km-z]{32,44}$' -or $inputValue.wallet -eq 'GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW'){throw 'AUTO_FRESH_CUSTODY_REQUIRED'};$record=Join-Path $base ('keys\'+$inputValue.wallet+'.dpapi');$bytes=[Text.Encoding]::UTF8.GetBytes($inputValue.key);$inputValue=$null}
 if($Mode -eq 'ReadWallet'){$custody=Get-Content (Join-Path $PSScriptRoot 'automation-custody.json') -Raw|ConvertFrom-Json;if($custody.wallet -notmatch '^[1-9A-HJ-NP-Za-km-z]{32,44}$' -or $custody.compromised -ne $false -or $custody.wallet -eq 'GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW'){throw 'AUTO_FRESH_CUSTODY_REQUIRED'};$record=Join-Path $base ('keys\'+$custody.wallet+'.dpapi')}
 if($Mode.StartsWith('Write')){
  if(Test-Path $record){throw 'AUTO_EXISTING_KEY_PRESERVED'}
  $encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $roundtrip=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);if([Convert]::ToBase64String($roundtrip) -cne [Convert]::ToBase64String($bytes)){throw 'AUTO_DPAPI_ROUNDTRIP_FAILED'};[Array]::Clear($roundtrip,0,$roundtrip.Length)
  $stream=[IO.File]::Open($record,[IO.FileMode]::CreateNew);try{$stream.Write($encrypted,0,$encrypted.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  if($Mode -eq 'WriteWallet'){[IO.File]::Copy($record,$record+'.backup',$false)}
 }else{
  $acl=Get-Acl $record;if((Get-Item $record).Attributes -band [IO.FileAttributes]::ReparsePoint -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value){throw 'AUTO_PRIVATE_KEY_OWNER_INVALID'}
  foreach($r in $acl.Access){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($identity.User.Value,'S-1-5-18')){throw 'AUTO_PRIVATE_KEY_ACCESS_INVALID'}}
  $plain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($record),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  if($Mode -eq 'ReadAudit'){[Console]::Out.Write([Convert]::ToBase64String($plain))}else{[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))}
 }
}catch{[Console]::Error.WriteLine('AUTO_DPAPI_OPERATION_BLOCKED');exit 1}
finally{if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};if($plain){[Array]::Clear($plain,0,$plain.Length)}}
