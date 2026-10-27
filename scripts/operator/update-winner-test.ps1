param([Parameter(Mandatory=$true)][string]$Plan,[Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ReviewedPlanSha256)
$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'WINNER_DEPLOYMENT_ADMIN_REQUIRED'}
if((Get-FileHash -LiteralPath $Plan).Hash -ne $ReviewedPlanSha256){throw 'WINNER_REVIEWED_PLAN_CHANGED'}
$p=Get-Content -LiteralPath $Plan -Raw|ConvertFrom-Json
if($p.authority -ne 'NONE' -or $p.activatePolicy -or $p.sign -or $p.broadcast){throw 'WINNER_DISABLED_DEPLOYMENT_ONLY'}
if((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'WINNER_INSTALLATION_REPARSE_POINT'}
$allowed=@('winner-test.bundle.cjs','winner-test-session.ps1','review-winner-test.ps1','manual-winner-test-install-manifest.json','winner-test-intent.json')
foreach($f in $p.files){
 if($f.name -notin $allowed -or (Get-FileHash -LiteralPath $f.source).Hash -ne $f.sha256){throw 'WINNER_REVIEWED_SOURCE_CHANGED'}
 $dest=Join-Path $target $f.name
 if(Test-Path -LiteralPath $dest){if((Get-FileHash -LiteralPath $dest).Hash -ne $f.sha256){throw 'WINNER_EXISTING_FILE_PRESERVED_REVIEW_REQUIRED'};if((Get-Item -LiteralPath $dest).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'WINNER_SOURCE_REPARSE_POINT'}}
}
foreach($f in $p.files){
 $dest=Join-Path $target $f.name
 if(-not(Test-Path -LiteralPath $dest)){[IO.File]::WriteAllBytes($dest,[IO.File]::ReadAllBytes($f.source));$acl=Get-Acl -LiteralPath $dest;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath $dest -AclObject $acl}
 if((Get-FileHash -LiteralPath $dest).Hash -ne $f.sha256){throw 'WINNER_INSTALLED_HASH_MISMATCH'}
}
@{at=[DateTime]::UtcNow.ToString('o');installed=$true;authority='NONE';policyActivated=$false;signingPerformed=$false;broadcast=$false;walletAccessed=$false;databaseChanged=$false;serviceRestarted=$false}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $env:ProgramData 'PaperfundSignerAcceptance\winner-test-deployment.public.json')
