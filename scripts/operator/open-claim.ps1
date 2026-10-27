param([ValidateSet('CheckWallet','Execute','Reconcile')][string]$Mode='CheckWallet')
$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)){throw 'Use protected installed claim launcher'}
$processIds='0,0'
if($Mode -ne 'Reconcile'){
$nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
$api=@($nodes|Where-Object{$_.CommandLine -match '[\\/]Paperfund-new[\\/]apps[\\/]api[\\/]dist[\\/]main\.js'})
$worker=@($nodes|Where-Object{$_.CommandLine -match '[\\/]Paperfund-new[\\/]apps[\\/]worker[\\/]dist[\\/]index\.js'})
if($api.Count -ne 1 -or $worker.Count -ne 1){throw 'Current API/worker identity ambiguous'}
$processIds=([string]$api[0].ProcessId+','+[string]$worker[0].ProcessId)
}
Write-Host 'Use only the PaperfundSigner WINDOWS account password in this local prompt. No wallet key is requested.'
$password=Read-Host 'PaperfundSigner WINDOWS password (hidden)' -AsSecureString
try{
 $credential=New-Object Management.Automation.PSCredential(($env:COMPUTERNAME+'\PaperfundSigner'),$password)
 Start-Process powershell.exe -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','RemoteSigned','-File',('"'+(Join-Path $target 'claim-session.ps1')+'"'),'-Mode',$Mode,'-ApplicationProcessIdList',$processIds) -Credential $credential -LoadUserProfile -WorkingDirectory $target -WindowStyle Normal
}finally{$password.Dispose()}
