param([ValidateSet('Inspect','Execute','Reconcile')][string]$Mode='Inspect')
$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner';if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)){throw 'Use protected installed launcher'}
Write-Host ('DISPOSABLE DEVNET ONLY: '+$Mode+'. Never enter a wallet key in this window.')
$password=Read-Host 'PaperfundSigner WINDOWS password (hidden)' -AsSecureString
try{$credential=New-Object Management.Automation.PSCredential(($env:COMPUTERNAME+'\PaperfundSigner'),$password);Start-Process powershell.exe -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','RemoteSigned','-File',('"'+(Join-Path $target 'devnet-payout.ps1')+'"'),'-Mode',$Mode) -Credential $credential -LoadUserProfile -WorkingDirectory $target -WindowStyle Normal}finally{$password.Dispose()}
