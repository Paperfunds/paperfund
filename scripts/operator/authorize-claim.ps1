# Run ONLY after separate transaction-specific operator approval. Never invoked by dashboard.
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Local administrator consent required to grant protected exact claim authority'}
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)){throw 'Use installed protected approval tool'}
$bundle=Join-Path $target 'claim-runtime.bundle.cjs'
$acl=Get-Acl $bundle;if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Untrusted claim runtime'}
$envelope=Get-Content -LiteralPath (Join-Path $env:ProgramData 'PaperfundClaimReview\review.json') -Raw|ConvertFrom-Json
$r=$envelope.review
Write-Host ('Network: '+$r.network+' | Creator/fee payer/recipient: '+$r.wallet)
Write-Host ('Instruction: '+$r.instruction+' | Expected gross: '+$r.expectedGrossLamports+' lamports | Maximum fee: '+$r.maximumFeeLamports+' lamports')
Write-Host ('Message SHA256: '+$r.messageSha256+' | Expiry: '+$r.expiresAt+' | Last valid block height: '+$r.lastValidBlockHeight)
Write-Host 'Only the displayed claim is authorized. Global payout STOP remains asserted. This tool does not sign or send.'
$confirmation=Read-Host 'After reviewing the dashboard, type its complete message SHA256'
if($confirmation -cne $r.messageSha256){throw 'Exact approval confirmation did not match'}
$start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe';$start.Arguments='"'+$bundle+'"';$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
$child=[Diagnostics.Process]::Start($start);$child.StandardInput.Write((@{mode='ApprovalTemplate';review=$r;operator=$identity.Name}|ConvertTo-Json -Depth 30 -Compress));$child.StandardInput.Close();$permit=$child.StandardOutput.ReadToEnd();$safeError=$child.StandardError.ReadToEnd();$child.WaitForExit()
if($child.ExitCode -ne 0){throw 'Approval blocked: review expired or invalid. Prepare and review a new transaction.'}
$dest=Join-Path $target 'claim-authority.json'
if(Test-Path $dest){$old=Get-Content $dest -Raw|ConvertFrom-Json;if([DateTime]::Parse($old.expiresAt).ToUniversalTime() -gt [DateTime]::UtcNow){throw 'Existing unexpired authority retained; wait for expiry before another approval'}}
[IO.File]::WriteAllText($dest,$permit,(New-Object Text.UTF8Encoding($false)))
$acl=Get-Acl $dest;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath $dest -AclObject $acl
Write-Host 'Exact claim authority stored. Execute only through open-claim.ps1 -Mode Execute before expiry; later use -Mode Reconcile. No broadcast performed.'
