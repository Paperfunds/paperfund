param([switch]$ActivateApprovedDevnet)
$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner';$admin=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
if((Get-Acl $target).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $admin.Value -or ((Get-Item $target).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Untrusted signer installation'}
$hashes=ConvertFrom-Json '{"devnet-payout.ps1":"589f01b2779683d7791ba3705ebc387ce11c007281e56e4ccea158cc83aa883f","open-devnet-payout.ps1":"26cda0291a1b36184d4d8baed2ff3fad24a9d5a59c5eb297fbeaa84af949580c","devnet-payout.bundle.cjs":"92190939f1d4c6a21c640bf8aa409670d7e71861c3541b769e8e33beb74b065f","devnet-payout-plan.json":"76c3ca36b79f1193bea38492c66ce6451a19d41c856c17fe9f7692f41554713c"}'
foreach($p in $hashes.PSObject.Properties){$source=$(if($p.Name -eq 'devnet-payout-plan.json'){Join-Path $PSScriptRoot '..\..\artifacts\operator\devnet-payout-plan.json'}else{Join-Path $PSScriptRoot $p.Name});if((Get-FileHash $source).Hash -ne $p.Value){throw 'Reviewed source differs'};$dest=Join-Path $target $p.Name;if((Test-Path $dest) -and (Get-FileHash $dest).Hash -ne $p.Value){throw 'Unknown existing devnet component retained'}}
foreach($p in $hashes.PSObject.Properties){$source=$(if($p.Name -eq 'devnet-payout-plan.json'){Join-Path $PSScriptRoot '..\..\artifacts\operator\devnet-payout-plan.json'}else{Join-Path $PSScriptRoot $p.Name});$dest=Join-Path $target $p.Name;if(-not(Test-Path $dest)){[IO.File]::Copy($source,$dest,$false);$acl=Get-Acl $dest;$acl.SetOwner($admin);Set-Acl $dest $acl}}
$plan=Get-Content (Join-Path $target 'devnet-payout-plan.json') -Raw|ConvertFrom-Json
if($ActivateApprovedDevnet){
 Write-Host 'DEVNET ONLY; separate transaction-specific approval. Global mainnet STOP stays asserted.'
 Write-Host ('Signer: '+$plan.intent.signer+' | Principal: '+$plan.intent.principalLamports+' lamports | Max fee: '+$plan.intent.maximumFeeLamports)
 foreach($r in $plan.intent.recipients){Write-Host ($r.destination+' -> '+$r.lamports+' lamports')}
 Write-Host ('Intent SHA256: '+$plan.intentSha256)
 $confirmation=Read-Host 'Type the full intent SHA256 to authorize exactly ONE DEVNET transaction'
 if($confirmation -cne $plan.intentSha256){throw 'Devnet approval confirmation mismatch'}
 $f=Join-Path $target 'devnet-authority.json';if(Test-Path $f){throw 'Existing devnet authority retained; do not overwrite'}
 $authority=@{action='ONE_DISPOSABLE_DEVNET_PAYOUT';intentSha256=$plan.intentSha256;operator=[Security.Principal.WindowsIdentity]::GetCurrent().Name;expiresAt=[DateTime]::UtcNow.AddMinutes(15).ToString('o')}|ConvertTo-Json
 [IO.File]::WriteAllText($f,$authority,(New-Object Text.UTF8Encoding($false)))
 $acl=Get-Acl $f;$acl.SetOwner($admin);Set-Acl $f $acl
}
Write-Host 'DEVNET components installed. No signing or submission performed. Mainnet is unchanged.'
