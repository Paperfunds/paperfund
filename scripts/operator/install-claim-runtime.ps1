$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
$report=Join-Path $env:ProgramData 'PaperfundSignerAcceptance\claim-install.public.json'
try{
 $user=Get-LocalUser PaperfundSigner;$operator=Get-LocalUser stanp
 $admin=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
 if((Get-Acl $target).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $admin.Value -or ((Get-Item $target).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Untrusted signer installation'}
 $before=ConvertFrom-Json '{"claim-session.ps1":"e69920e35aa6e79cf390d943d3c7f524d01b937ce8e2f4d22860993b143b0c92","open-claim.ps1":"cf553c488b28bddd4cffb00115a5f1f394bcab8047e5751977a9b96e200f0284","claim-runtime.bundle.cjs":"621064f2b9dae10fabfda87fa6d1deb5cccc008a9476fe98683544cc980ed887","authorize-claim.ps1":"e1122c9f1164a1c5113df9fda63e056af5cb9ff32009dcf468104631fa1e3748"}'
 $after=ConvertFrom-Json '{"claim-session.ps1":"e69920e35aa6e79cf390d943d3c7f524d01b937ce8e2f4d22860993b143b0c92","open-claim.ps1":"cf553c488b28bddd4cffb00115a5f1f394bcab8047e5751977a9b96e200f0284","claim-runtime.bundle.cjs":"ef0592ede8e1e42731bdf2f7de371627c089ae3e3d23f7caa70f679f935a2fba","authorize-claim.ps1":"e1122c9f1164a1c5113df9fda63e056af5cb9ff32009dcf468104631fa1e3748"}'
 foreach($property in $after.PSObject.Properties){
  $source=Join-Path $PSScriptRoot $property.Name;$dest=Join-Path $target $property.Name
  if((Get-FileHash $source).Hash -ne $property.Value){throw 'Reviewed source hash changed'}
  if(Test-Path -LiteralPath $dest){if((Get-FileHash $dest).Hash -ne $property.Value){if((Get-FileHash $dest).Hash -ne $before.($property.Name)){throw 'Unknown installed component retained'};$backup=$dest+'.before-'+$before.($property.Name).Substring(0,12);if(-not(Test-Path $backup)){[IO.File]::Copy($dest,$backup,$false);$backupAcl=Get-Acl $backup;$backupAcl.SetOwner($admin);Set-Acl -LiteralPath $backup -AclObject $backupAcl};[IO.File]::WriteAllBytes($dest,[IO.File]::ReadAllBytes($source))}}else{[IO.File]::Copy($source,$dest,$false);$acl=Get-Acl $dest;$acl.SetOwner($admin);Set-Acl -LiteralPath $dest -AclObject $acl}
 }
 $stage=Join-Path $env:LOCALAPPDATA 'PaperfundOperator\claim-rpc.install.json'
 $config=Get-Content -LiteralPath $stage -Raw|ConvertFrom-Json
 if(([Uri]$config.endpoint).Scheme -ne 'https'){throw 'HTTPS RPC required'}
 $configDest=Join-Path $target 'claim-rpc.json'
 if(Test-Path -LiteralPath $configDest){if((Get-FileHash $configDest).Hash -ne (Get-FileHash $stage).Hash){throw 'Existing RPC configuration differs; retained'}}else{[IO.File]::Copy($stage,$configDest,$false);$acl=Get-Acl $configDest;$acl.SetOwner($admin);Set-Acl -LiteralPath $configDest -AclObject $acl}
 $queue=Join-Path $env:ProgramData 'PaperfundClaimReview'
 if(Test-Path -LiteralPath $queue){if((Get-Item $queue).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Claim queue reparse point refused'}}
 [IO.Directory]::CreateDirectory($queue)|Out-Null
 $acl=(New-Object IO.DirectoryInfo($queue)).GetAccessControl([Security.AccessControl.AccessControlSections]::Access);$acl.SetAccessRuleProtection($true,$false);foreach($rule in @($acl.Access)){$acl.RemoveAccessRuleSpecific($rule)};$acl.SetOwner($admin)
 foreach($sid in @('S-1-5-18',$admin.Value)){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($operator.SID,'Modify','ContainerInherit,ObjectInherit','None','Allow')))
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($user.SID,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')))
 (New-Object IO.DirectoryInfo($queue)).SetAccessControl($acl)
 if(Test-Path -LiteralPath (Join-Path $target 'claim-authority.json')){throw 'Existing claim authority detected; installer will not activate or overwrite it'}
 @{installed=$true;financialAuthority='NONE';apiWorkerModified=$false;hashes=$after;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $report
}catch{@{installed=$false;error=$_.Exception.Message;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $report}
