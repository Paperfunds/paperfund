param([Parameter(Mandatory=$true)][int]$ExpectedPid,[Parameter(Mandatory=$true)][string]$ExpectedCreatedAt,[switch]$ProbeOnly)
$ErrorActionPreference='Stop'
$pfProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$ExpectedPid"
if(-not $pfProcess -or $pfProcess.Name -ne 'node.exe' -or $pfProcess.CreationDate.ToUniversalTime().ToString('o') -ne $ExpectedCreatedAt){throw 'PROCESS_IDENTITY_CHANGED'}
Add-Type @"
using System;using System.Runtime.InteropServices;
public static class PaperfundConsole {
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool FreeConsole();
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool AttachConsole(uint id);
 [DllImport("kernel32.dll",SetLastError=true)]public static extern uint GetConsoleProcessList(uint[] list,uint count);
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool SetConsoleCtrlHandler(IntPtr h,bool add);
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool GenerateConsoleCtrlEvent(uint ev,uint group);
}
"@
[PaperfundConsole]::FreeConsole() | Out-Null
if(-not [PaperfundConsole]::AttachConsole([uint32]$ExpectedPid)){throw ('NO_ATTACHABLE_CONSOLE:'+ [Runtime.InteropServices.Marshal]::GetLastWin32Error())}
try {
 $pfIds=New-Object uint32[] 64
 $pfCount=[PaperfundConsole]::GetConsoleProcessList($pfIds,64)
 if($pfCount -lt 1 -or $pfCount -gt 64){throw 'CONSOLE_INVENTORY_FAILED'}
 $pfMembers=@($pfIds[0..($pfCount-1)])
 if(@($pfMembers | Where-Object {$_ -ne $ExpectedPid -and $_ -ne $PID}).Count -gt 0){throw 'SHARED_CONSOLE_REFUSED'}
 if($ProbeOnly){ @{status='EXCLUSIVE_CONSOLE_VERIFIED';targetPid=$ExpectedPid;members=$pfMembers;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot ('..\docs\website-redesign\deployment-prep\console-'+$ExpectedPid+'.json'));exit 0}
 [PaperfundConsole]::SetConsoleCtrlHandler([IntPtr]::Zero,$true) | Out-Null
 if(-not [PaperfundConsole]::GenerateConsoleCtrlEvent(0,0)){throw 'SIGINT_DELIVERY_FAILED'}
 Write-Output 'SIGINT_SENT_TO_VERIFIED_EXCLUSIVE_CONSOLE'
} finally {[PaperfundConsole]::FreeConsole() | Out-Null}
