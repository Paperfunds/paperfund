param([ValidateSet('Inspect','Execute','Reconcile')][string]$Mode='Inspect')
$ErrorActionPreference='Stop'
try{
 . (Join-Path $PSScriptRoot 'wallet-file-local.ps1')
 $identity=Assert-LocalSigner
 foreach($name in @('devnet-payout.ps1','devnet-payout.bundle.cjs','devnet-payout-plan.json')){ $f=Join-Path $PSScriptRoot $name;$acl=Get-Acl $f;if((Get-Item $f).Attributes -band [IO.FileAttributes]::ReparsePoint -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'DEVNET_PROTECTED_SOURCE_REQUIRED'} }
 if($Mode -eq 'Execute'){ $f=Join-Path $PSScriptRoot 'devnet-authority.json';$acl=Get-Acl $f;if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544'){throw 'DEVNET_PROTECTED_APPROVAL_REQUIRED'} }
 $start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe';$start.Arguments='"'+(Join-Path $PSScriptRoot 'devnet-payout.bundle.cjs')+'" '+$Mode;$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $p=[Diagnostics.Process]::Start($start);$output=$p.StandardOutput.ReadToEnd();$err=$p.StandardError.ReadToEnd();$p.WaitForExit();if($p.ExitCode -ne 0){$safe=($err.Trim() -split '[\r\n]+')[-1];if($safe -notmatch '^DEVNET_[A-Z0-9_]+$'){$safe='DEVNET_ACTION_FAILED'};throw $safe}
 $r=$output|ConvertFrom-Json;$r|ConvertTo-Json -Depth 15|Set-Content -LiteralPath (Join-Path $env:ProgramData ('PaperfundSignerAcceptance\devnet-'+$Mode+'.public.json'));Write-Host ($r|ConvertTo-Json -Depth 15)
}catch{Write-Host $_.Exception.Message -ForegroundColor Red}finally{Read-Host 'Press Enter to close disposable DEVNET window'|Out-Null}
