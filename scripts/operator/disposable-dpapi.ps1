param([ValidateSet('Protect','Restore')][string]$Mode,[string]$Record)
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or @($identity.Groups | Where-Object {$_.Value -eq 'S-1-5-32-544'}).Count -gt 0){throw 'Dedicated non-admin identity required'}
if(-not [Console]::IsInputRedirected -or -not [Console]::IsOutputRedirected){throw 'Anonymous pipes required; this tool has no interactive secret output'}
$testRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'PaperfundSigner\disposable-proof'))
$recordPath=[IO.Path]::GetFullPath($Record)
if(-not $recordPath.StartsWith($testRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Disposable test record only'}
Add-Type -AssemblyName System.Security
$bytes=$null;$clear=$null
try {
 if($Mode -eq 'Protect'){
  $bytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())
  $encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $stream=[IO.File]::Open($recordPath,[IO.FileMode]::CreateNew);try{$stream.Write($encrypted,0,$encrypted.Length)}finally{$stream.Dispose()}
  [Console]::Out.Write('PROTECTED')
 }else{
  [Console]::In.ReadToEnd() | Out-Null
  $clear=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($recordPath),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($clear))
 }
}finally{if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};if($clear){[Array]::Clear($clear,0,$clear.Length)}}
