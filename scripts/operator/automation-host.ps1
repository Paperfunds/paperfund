param([switch]$ProvisionFreshWallet)
$ErrorActionPreference='Stop'
$phase='MODULE_INITIALIZATION';$child=$null;$identity=$null
try{
 if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop}
 $phase='SIGNER_IDENTITY';. (Join-Path $PSScriptRoot 'wallet-file-local.ps1');$identity=Assert-LocalSigner
 $phase='PROTECTED_MANIFEST';$manifest=Get-Content (Join-Path $PSScriptRoot 'automation-install-manifest.json') -Raw|ConvertFrom-Json
 foreach($entry in $manifest.files){$file=Join-Path $PSScriptRoot $entry.name;if((Get-Item $file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'AUTO_SOURCE_REPARSE_POINT'};$acl=Get-Acl $file;if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'AUTO_SOURCE_OWNER_INVALID'};foreach($r in $acl.Access){if($r.AccessControlType -eq 'Allow' -and ($r.FileSystemRights -band ([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions)) -and $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'AUTO_SOURCE_WRITABLE'}};if((Get-FileHash $file).Hash -ne $entry.sha256){throw 'AUTO_SOURCE_HASH_MISMATCH'}}
 $env:LOCALAPPDATA=[Environment]::GetFolderPath('LocalApplicationData')
 if($ProvisionFreshWallet){& (Join-Path $env:ProgramFiles 'nodejs\node.exe') (Join-Path $PSScriptRoot 'automation-provision.bundle.cjs');Read-Host 'Only the public wallet is shown. Press Enter to close'|Out-Null;exit $LASTEXITCODE}

 $phase='CHILD_SUPERVISION'
 Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PaperfundAutomationJob {
 [StructLayout(LayoutKind.Sequential)] struct Basic {public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
 [StructLayout(LayoutKind.Sequential)] struct Io {public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
 [StructLayout(LayoutKind.Sequential)] struct Extended {public Basic BasicLimitInformation;public Io IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref Extended info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr value);
 public static IntPtr Create(){var h=CreateJobObject(IntPtr.Zero,null);var x=new Extended();x.BasicLimitInformation.LimitFlags=0x2000;if(h==IntPtr.Zero||!SetInformationJobObject(h,9,ref x,(uint)Marshal.SizeOf(x))){if(h!=IntPtr.Zero)CloseHandle(h);throw new InvalidOperationException("AUTO_CHILD_SUPERVISION_FAILED");}return h;}
 public static void Assign(IntPtr job,IntPtr process){if(!AssignProcessToJobObject(job,process))throw new InvalidOperationException("AUTO_CHILD_SUPERVISION_FAILED");}
}
"@
 $job=[PaperfundAutomationJob]::Create()
 $phase='NODE_START';$start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe';$start.Arguments='"'+(Join-Path $PSScriptRoot 'automation-service.bundle.cjs')+'"';$start.WorkingDirectory=$PSScriptRoot;$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $child=[Diagnostics.Process]::Start($start);try{[PaperfundAutomationJob]::Assign($job,$child.Handle)}catch{if(-not $child.HasExited){$child.Kill()};throw};$output=$child.StandardOutput.ReadToEnd();$safeError=$child.StandardError.ReadToEnd();$child.WaitForExit();$phase='NODE_EXIT'
 if($child.ExitCode -ne 0){$codes=@($safeError.Trim() -split '[\r\n]+'|Where-Object {$_ -match '^(AUTO|CLAIM|KEY)_[A-Z0-9_]+$'});$code=if($codes.Count){$codes[-1]}else{''};if($code -match '^(AUTO|CLAIM|KEY)_[A-Z0-9_]+$'){throw $code};throw 'AUTO_BACKGROUND_RUNTIME_FAILED'}
 exit 0
}catch{
 $code=$_.Exception.Message;if($code -notmatch '^(AUTO|KEY)_[A-Z0-9_]+$'){$code='AUTO_HOST_'+$phase+'_FAILED'}
 $record=@{error=$code;phase=$phase;signerSid=$(if($identity){$identity.User.Value}else{$null});at=[DateTime]::UtcNow.ToString('o')}
 $json=$record|ConvertTo-Json -Compress;$public=Join-Path $env:ProgramData 'PaperfundAutomation\public';$utf8=New-Object Text.UTF8Encoding($false)
 [IO.File]::WriteAllText((Join-Path $public ('host-start-error-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')+'.json')),$json,$utf8)
 [IO.File]::WriteAllText((Join-Path $public 'host-start-error.json'),$json,$utf8)
 [Console]::Error.WriteLine($code);exit 1
}

finally{if($job -and $job -ne [IntPtr]::Zero){[PaperfundAutomationJob]::CloseHandle($job)|Out-Null}}
