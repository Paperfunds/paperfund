$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)){throw 'Use installed protected tool'}
Write-Host 'One-time fresh unattended-custody provisioning. This does not transfer funds, change creator authority, approve a mandate or reuse the compromised wallet.'
if((Read-Host 'Type CREATE FRESH CUSTODY to generate a new isolated key and encrypted backup') -cne 'CREATE FRESH CUSTODY'){throw 'Not approved'}
$password=Read-Host 'PaperfundSigner WINDOWS-account password (hidden)' -AsSecureString
try{$credential=New-Object Management.Automation.PSCredential(($env:COMPUTERNAME+'\PaperfundSigner'),$password);Start-Process powershell.exe -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','RemoteSigned','-File',('"'+(Join-Path $target 'automation-host.ps1')+'"'),'-ProvisionFreshWallet') -Credential $credential -LoadUserProfile -WorkingDirectory $target -WindowStyle Normal}finally{$password.Dispose()}
