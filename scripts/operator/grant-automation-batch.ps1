$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'AUTO_ADMINISTRATOR_DEPLOYMENT_REQUIRED'}
$dir=Join-Path $env:ProgramData 'PaperfundSignerAcceptance';$beforeFile=Join-Path $dir 'automation-rights-before.inf';$afterFile=Join-Path $dir 'automation-rights-after.inf';$report=Join-Path $dir 'automation-batch-right.public.json'
try{
 $user=Get-LocalUser PaperfundSigner;$config=Get-Content (Join-Path $env:ProgramFiles 'PaperfundSigner\automation-config.json') -Raw|ConvertFrom-Json
 if($user.SID.Value -ne $config.signerSid){throw 'AUTO_SIGNER_SID_CHANGED'}
 & secedit.exe /export /cfg $beforeFile /areas USER_RIGHTS /quiet|Out-Null;if($LASTEXITCODE){throw 'AUTO_RIGHTS_EXPORT_FAILED'}
 $before=@(Get-Content $beforeFile|Where-Object {$_ -match '^Se[A-Za-z]+Right\s*='})
 $deny=@($before|Where-Object {$_ -match '^SeDenyBatchLogonRight\s*='})
 $members=@($user.SID.Value,'S-1-1-0','S-1-5-11','S-1-5-113','S-1-5-3')
 $adsi=[ADSI]('WinNT://'+$env:COMPUTERNAME+'/PaperfundSigner,user')
 foreach($group in @($adsi.Groups())){$binary=$group.GetType().InvokeMember('objectSid','GetProperty',$null,$group,$null);$members+=([Security.Principal.SecurityIdentifier]::new([byte[]]$binary,0).Value)}
 foreach($line in $deny){foreach($entry in (($line -split '=',2)[1] -split ',')){$entry=$entry.Trim().TrimStart('*');if(-not $entry){continue};$sid=if($entry.StartsWith('S-')){$entry}else{(New-Object Security.Principal.NTAccount($entry)).Translate([Security.Principal.SecurityIdentifier]).Value};if($sid -in $members){throw 'AUTO_DENY_BATCH_RIGHT_REVIEW_REQUIRED'}}}
 $source=@"
using System;using System.Runtime.InteropServices;using System.Security.Principal;using System.ComponentModel;
public static class PaperfundBatchRight {
 [StructLayout(LayoutKind.Sequential)] struct OA{public uint Length;public IntPtr RootDirectory,ObjectName;public uint Attributes;public IntPtr SecurityDescriptor,SecurityQualityOfService;}
 [StructLayout(LayoutKind.Sequential)] struct US{public ushort Length,MaximumLength;public IntPtr Buffer;}
 [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system,ref OA attributes,uint access,out IntPtr handle);
 [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr handle,byte[] sid,ref US rights,uint count);
 [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr handle);
 [DllImport("advapi32.dll")] static extern uint LsaEnumerateAccountRights(IntPtr handle,byte[] sid,out IntPtr rights,out uint count);
 [DllImport("advapi32.dll")] static extern uint LsaFreeMemory(IntPtr buffer);
 [DllImport("advapi32.dll")] static extern uint LsaNtStatusToWinError(uint status);
 public static string[] Rights(string sidString){var sid=new SecurityIdentifier(sidString);byte[] bytes=new byte[sid.BinaryLength];sid.GetBinaryForm(bytes,0);var oa=new OA();oa.Length=(uint)Marshal.SizeOf(typeof(OA));IntPtr handle;uint status=LsaOpenPolicy(IntPtr.Zero,ref oa,0x800,out handle);if(status!=0)throw new Win32Exception((int)LsaNtStatusToWinError(status));IntPtr buffer=IntPtr.Zero;try{uint count;status=LsaEnumerateAccountRights(handle,bytes,out buffer,out count);if(status==0xc0000034)return new string[0];if(status!=0)throw new Win32Exception((int)LsaNtStatusToWinError(status));var result=new string[count];int size=Marshal.SizeOf(typeof(US));for(int i=0;i<count;i++){var item=(US)Marshal.PtrToStructure(IntPtr.Add(buffer,i*size),typeof(US));result[i]=Marshal.PtrToStringUni(item.Buffer,item.Length/2);}return result;}finally{if(buffer!=IntPtr.Zero)LsaFreeMemory(buffer);LsaClose(handle);}}
 public static void Grant(string sidString){var sid=new SecurityIdentifier(sidString);byte[] bytes=new byte[sid.BinaryLength];sid.GetBinaryForm(bytes,0);var oa=new OA();oa.Length=(uint)Marshal.SizeOf(typeof(OA));IntPtr handle;uint status=LsaOpenPolicy(IntPtr.Zero,ref oa,0x810,out handle);if(status!=0)throw new Win32Exception((int)LsaNtStatusToWinError(status));string name="SeBatchLogonRight";var us=new US();us.Buffer=Marshal.StringToHGlobalUni(name);us.Length=(ushort)(name.Length*2);us.MaximumLength=(ushort)(us.Length+2);try{status=LsaAddAccountRights(handle,bytes,ref us,1);if(status!=0)throw new Win32Exception((int)LsaNtStatusToWinError(status));}finally{Marshal.FreeHGlobal(us.Buffer);LsaClose(handle);}}
}
"@
 Add-Type -TypeDefinition $source
 $directBefore=@([PaperfundBatchRight]::Rights($user.SID.Value));$denying=@();foreach($member in $members){if('SeDenyBatchLogonRight' -in @([PaperfundBatchRight]::Rights($member))){$denying+=$member}}
 if($denying.Count){@{passed=$false;error='AUTO_EXPLICIT_BATCH_DENIAL';denyingSids=$denying;directRights=$directBefore;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 5|Set-Content $report;exit 2}
 [PaperfundBatchRight]::Grant($user.SID.Value)
 $directAfter=@([PaperfundBatchRight]::Rights($user.SID.Value))
 & secedit.exe /export /cfg $afterFile /areas USER_RIGHTS /quiet|Out-Null;if($LASTEXITCODE){throw 'AUTO_RIGHTS_EXPORT_FAILED'}
 $after=@(Get-Content $afterFile|Where-Object {$_ -match '^Se[A-Za-z]+Right\s*='})
 if(@(Compare-Object @($before|Where-Object {$_ -notmatch '^SeBatchLogonRight\s*='}) @($after|Where-Object {$_ -notmatch '^SeBatchLogonRight\s*='})).Count){throw 'AUTO_OTHER_LOGON_RIGHT_CHANGED'}
 if('SeBatchLogonRight' -notin $directAfter){throw 'AUTO_BATCH_RIGHT_NOT_GRANTED'}
 if(@(Compare-Object @($directBefore|Where-Object {$_ -ne 'SeBatchLogonRight'}) @($directAfter|Where-Object {$_ -ne 'SeBatchLogonRight'})).Count){throw 'AUTO_OTHER_DIRECT_RIGHT_CHANGED'}
 @{passed=$true;signerSid=$user.SID.Value;onlySeBatchLogonRightAdded=$true;otherRightsUnchanged=$true;passwordChanged=$false;adminMembershipChanged=$false;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content $report
 if(Get-ScheduledTask -TaskName PaperfundIsolatedAutomation -ErrorAction SilentlyContinue){Start-ScheduledTask -TaskName PaperfundIsolatedAutomation}
}catch{@{passed=$false;error=$_.Exception.Message;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content $report;throw}
