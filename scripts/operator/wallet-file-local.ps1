function Assert-LocalSigner {
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($identity)
 if($identity.Name.Split('\')[-1] -ne 'PaperfundSigner' -or $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or @($identity.Groups | Where-Object {$_.Value -eq 'S-1-5-32-544'}).Count -gt 0){throw 'KEY_DEDICATED_NONADMIN_SIGNER_REQUIRED'}
 $installation=Join-Path $env:ProgramFiles 'PaperfundSigner'
 if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($installation)){throw 'KEY_PROTECTED_INSTALLATION_REQUIRED'}
 foreach($name in @('','wallet-file-local.ps1','wallet-import.ps1','key-public.mjs','wallet-file-editor.ps1')){
  $file=if($name){Join-Path $installation $name}else{$installation};$item=Get-Item -LiteralPath $file
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'KEY_INSTALLATION_REPARSE_POINT_REFUSED'}
  $acl=Get-Acl -LiteralPath $file
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'KEY_INSTALLATION_OWNER_MISMATCH'}
  foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band ([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions)) -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'KEY_INSTALLATION_WRITABLE_OUTSIDE_ADMINISTRATORS'}}
 }
 return $identity
}
function Initialize-WalletImportFile {
 $identity=Assert-LocalSigner
 $base=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PaperfundSigner'
 foreach($dir in @($base,(Join-Path $base 'Import'))){
  if(Test-Path -LiteralPath $dir){if((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'KEY_FILE_REPARSE_POINT_REFUSED'}}
  [IO.Directory]::CreateDirectory($dir) | Out-Null
  $acl=(New-Object IO.DirectoryInfo($dir)).GetAccessControl([Security.AccessControl.AccessControlSections]::Access);$acl.SetAccessRuleProtection($true,$false);foreach($rule in @($acl.Access)){$acl.RemoveAccessRuleSpecific($rule)};$acl.SetOwner($identity.User)
  foreach($sid in @($identity.User.Value,'S-1-5-18')){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}
  (New-Object IO.DirectoryInfo($dir)).SetAccessControl($acl)
 }
 $file=Join-Path $base 'Import\phantom-private-key.txt'
 if(Test-Path -LiteralPath $file){
  $item=Get-Item -LiteralPath $file;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'KEY_FILE_REPARSE_POINT_REFUSED'}
  $acl=Get-Acl -LiteralPath $file;if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value){throw 'KEY_FILE_OWNER_MISMATCH'}
  foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($identity.User.Value,'S-1-5-18')){throw 'KEY_FILE_ACCESS_NOT_PRIVATE'}}
 }else{$stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew);$stream.Dispose()}
 [IO.File]::SetAttributes($file,([IO.FileAttributes]::Temporary -bor [IO.FileAttributes]::NotContentIndexed))
 return $file
}
function Remove-WalletImportFile {
 $file=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PaperfundSigner\Import\phantom-private-key.txt'
 if(Test-Path -LiteralPath $file){if((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'KEY_FILE_REPARSE_POINT_REFUSED'};[IO.File]::WriteAllBytes($file,[byte[]]@());[IO.File]::Delete($file)}
}
