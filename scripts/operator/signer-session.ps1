$ErrorActionPreference='Stop'
try {
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $principal=New-Object Security.Principal.WindowsPrincipal($identity)
 if($identity.Name.Split('\')[-1] -ne 'PaperfundSigner' -or @($identity.Groups | Where-Object {$_.Value -eq 'S-1-5-32-544'}).Count -gt 0 -or $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Dedicated non-administrator PaperfundSigner required'}
 $env:LOCALAPPDATA=[Environment]::GetFolderPath('LocalApplicationData')
 Set-Location -LiteralPath $PSScriptRoot
 Write-Host ('Isolated identity: '+$identity.Name+' / '+$identity.User.Value)
 Write-Host 'Checking only the old disposable record and a fresh offline test. No wallet import or network transaction.'
 & (Join-Path $env:ProgramFiles 'nodejs\node.exe') (Join-Path $PSScriptRoot 'signer-session-check.mjs')
 if($LASTEXITCODE -ne 0){throw 'Offline session test failed; inspect the public result'}
 Write-Host 'Isolated offline session verified. This window remains on your existing desktop.' -ForegroundColor Green
}catch{Write-Host ('SIGNER SESSION ERROR: '+$_.Exception.Message) -ForegroundColor Red}
