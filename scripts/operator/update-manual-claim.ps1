param([Parameter(Mandatory=$true)][string]$Plan,[Parameter(Mandatory=$true)][string]$ReviewedPlanSha256)
$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'CLAIM_DEPLOYMENT_ADMIN_REQUIRED'}
if((Get-FileHash $Plan).Hash -ne $ReviewedPlanSha256){throw 'CLAIM_REVIEWED_DEPLOYMENT_CHANGED'}
$p=Get-Content -LiteralPath $Plan -Raw|ConvertFrom-Json
$source=Join-Path $p.repository 'scripts\operator'
if((Get-Item $target).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'CLAIM_INSTALLATION_REPARSE_POINT'}
$authority=Join-Path $target 'claim-authority.json'
$authorityHash=if(Test-Path $authority){(Get-FileHash $authority).Hash}else{$null}
foreach($f in $p.files){
 if($f.name -notin @('claim-session.ps1','claim-runtime.bundle.cjs','review-manual-claim.ps1','prepare-manual-review.bundle.cjs','manual-claim-install-manifest.json')){throw 'CLAIM_DEPLOYMENT_FILE_FORBIDDEN'}
 if((Get-FileHash (Join-Path $source $f.name)).Hash -ne $f.sourceSha256){throw 'CLAIM_REVIEWED_SOURCE_CHANGED'}
 $dest=Join-Path $target $f.name
 if(Test-Path $dest){if((Get-FileHash $dest).Hash -notin @($f.installedSha256,$f.sourceSha256)){throw 'CLAIM_UNKNOWN_INSTALLED_FILE_PRESERVED'};if((Get-Item $dest).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'CLAIM_PROTECTED_SOURCE_REPARSE_POINT'}}elseif($f.installedSha256){throw 'CLAIM_INSTALLED_FILE_MISSING'}
}
$stamp=[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')
foreach($f in $p.files){
 $dest=Join-Path $target $f.name
 if(Test-Path $dest){if((Get-FileHash $dest).Hash -eq $f.sourceSha256){continue};Copy-Item -LiteralPath $dest -Destination ($dest+'.before-manual-'+$stamp)}
 [IO.File]::WriteAllBytes($dest,[IO.File]::ReadAllBytes((Join-Path $source $f.name)))
 $acl=Get-Acl $dest;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl $dest $acl
 if((Get-FileHash $dest).Hash -ne $f.sourceSha256){throw 'CLAIM_INSTALLED_HASH_MISMATCH'}
}
if($authorityHash -and (Get-FileHash $authority).Hash -ne $authorityHash){throw 'CLAIM_EXISTING_AUTHORITY_CHANGED'}
@{passed=$true;at=[DateTime]::UtcNow.ToString('o');files=$p.files;existingAuthorityUnchanged=$true;journalAccessed=$false;walletUnlocked=$false;financialAuthorityGranted=$false;signingPerformed=$false;broadcast=$false;automationRestarted=$false}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $env:ProgramData 'PaperfundSignerAcceptance\manual-claim-deployment.public.json')
