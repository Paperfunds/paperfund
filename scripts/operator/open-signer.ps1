param([switch]$FileImport,[switch]$FileImportTest)
# Start the existing isolated signer on this desktop; no credential is saved.
$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)){throw 'Use the protected installed launcher'}
$account=$env:COMPUTERNAME+'\PaperfundSigner'
Write-Host ('Opening '+$account+' on the CURRENT desktop. Use its WINDOWS password, not a PIN or wallet key.')
$password=Read-Host 'PaperfundSigner WINDOWS password (hidden; one attempt)' -AsSecureString
try {
 $credential=New-Object Management.Automation.PSCredential($account,$password)
 $session=Join-Path $target 'signer-session.ps1'
 $extra=@();$keepOpen=@('-NoExit')
 if($FileImport -or $FileImportTest){
  $keepOpen=@()
  $nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
  $api=@($nodes | Where-Object {$_.CommandLine -match '[\\/]Paperfund-new[\\/]apps[\\/]api[\\/]dist[\\/]main\.js'})
  $worker=@($nodes | Where-Object {$_.CommandLine -match '[\\/]Paperfund-new[\\/]apps[\\/]worker[\\/]dist[\\/]index\.js'})
  if($api.Count -ne 1 -or $worker.Count -ne 1){throw 'Current API/worker identity is ambiguous; no import opened'}
  $session=Join-Path $target $(if($FileImportTest){'wallet-file-test.ps1'}else{'wallet-file-editor.ps1'})
  $extra=@('-ApplicationProcessIdList',([string]$api[0].ProcessId+','+[string]$worker[0].ProcessId))
 }
 Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList (@('-NoProfile','-STA')+$keepOpen+@('-ExecutionPolicy','RemoteSigned','-File',('"'+$session+'"'))+$extra) -Credential $credential -LoadUserProfile -WorkingDirectory $target -WindowStyle Normal -ErrorAction Stop | Out-Null
 Write-Host 'Separate-account signer window opened. No wallet key requested and no transaction broadcast.'
}catch{
 Write-Host ('Launch failed: '+$_.Exception.Message) -ForegroundColor Red
 Write-Host 'No password reset, rights change or credential saving was performed.'
}finally{$password.Dispose()}
