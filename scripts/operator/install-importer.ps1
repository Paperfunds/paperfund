# Execute as administrator after reviewing and hashing the two source files. Does not import a key.
$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
if(Test-Path -LiteralPath $target){throw 'Installation exists; review a versioned upgrade rather than overwrite signer tools.'}
[IO.Directory]::CreateDirectory($target) | Out-Null
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')),'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')))
Set-Acl -LiteralPath $target -AclObject $acl
foreach($name in @('wallet-import.ps1','key-public.mjs')){[IO.File]::Copy((Join-Path $PSScriptRoot $name),(Join-Path $target $name),$false)}
foreach($name in @('wallet-import.ps1','key-public.mjs')){$file=Join-Path $target $name;$fileAcl=Get-Acl -LiteralPath $file;$fileAcl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath $file -AclObject $fileAcl}
Write-Host 'Protected importer installed. Switch to a dedicated non-admin signer Windows account before importing.'
