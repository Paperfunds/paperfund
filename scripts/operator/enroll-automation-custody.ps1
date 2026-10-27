param([Parameter(Mandatory=$true)][string]$Wallet)
$ErrorActionPreference='Stop'
if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop};$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'One-time administrator custody enrollment required'}
if($Wallet -notmatch '^[1-9A-HJ-NP-Za-km-z]{32,44}$' -or $Wallet -eq 'GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW'){throw 'Fresh wallet required'}
$target=Join-Path $env:ProgramFiles 'PaperfundSigner';if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)){throw 'Use installed protected tool'}
$source=Join-Path $env:ProgramData ('PaperfundAutomation\public\custody-'+$Wallet+'.json');$p=Get-Content $source -Raw|ConvertFrom-Json
if($p.wallet -cne $Wallet -or $p.compromised -ne $false -or $p.mode -ne 'DPAPI_CURRENT_USER_ISOLATED' -or $p.encryptedBackup -ne $true){throw 'Custody attestation invalid'}
Write-Host ('Enroll fresh protected wallet: '+$Wallet);Write-Host 'Existing balances and creator authority are unchanged. Windows password reset can invalidate CurrentUser DPAPI recovery; retain the existing account and encrypted backup.'
if((Read-Host 'Type ENROLL CUSTODY') -cne 'ENROLL CUSTODY'){throw 'Not approved'}
$p|Add-Member -NotePropertyName signerSid -NotePropertyValue (Get-LocalUser PaperfundSigner).SID.Value -Force
$dest=Join-Path $target 'automation-custody.json';if(Test-Path $dest){[IO.File]::Copy($dest,($dest+'.previous-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')),$false)}
[IO.File]::WriteAllText($dest,($p|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)));$acl=Get-Acl $dest;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl $dest $acl
Write-Host 'Fresh custody enrolled with no transaction authority. Mint/creator binding, STOP, funding and signed mandate still gate execution.'
