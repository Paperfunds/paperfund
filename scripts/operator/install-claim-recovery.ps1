$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
$report=Join-Path $env:ProgramData 'PaperfundSignerAcceptance\claim-recovery-install.public.json'
try{
 $before=ConvertFrom-Json '{"claim-session.ps1":"e69920e35aa6e79cf390d943d3c7f524d01b937ce8e2f4d22860993b143b0c92","open-claim.ps1":"cf553c488b28bddd4cffb00115a5f1f394bcab8047e5751977a9b96e200f0284","claim-runtime.bundle.cjs":"ef0592ede8e1e42731bdf2f7de371627c089ae3e3d23f7caa70f679f935a2fba"}'
 $after=ConvertFrom-Json '{"claim-session.ps1":"65a87528fb01eb490716c3a5daae9267b45a650fdd394650b47989f965071146","open-claim.ps1":"45c47e8bb0820a0bdd72741bb2a0c094adeabffa9a4d5b422e92c36c18e6c34d","claim-runtime.bundle.cjs":"f58964b4b69cc6449b490d3a1d734c04637e48ea21df23d3d561fc99d46c7830"}'
 $authority=Join-Path $target 'claim-authority.json';$authorityHash=$(if(Test-Path $authority){(Get-FileHash $authority).Hash}else{$null})
 foreach($property in $after.PSObject.Properties){
  $name=$property.Name;$dest=Join-Path $target $name;$source=Join-Path $PSScriptRoot $name
  if((Get-FileHash $source).Hash -ne $property.Value -or (Get-FileHash $dest).Hash -notin @($before.$name,$property.Value)){throw ('Unreviewed file: '+$name)}
  if((Get-Acl $dest).GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-32-544','S-1-5-18') -or ((Get-Item $dest).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Untrusted protected runtime'}
 }
 foreach($property in $after.PSObject.Properties){
  $name=$property.Name;$dest=Join-Path $target $name;$source=Join-Path $PSScriptRoot $name
  if((Get-FileHash $dest).Hash -eq $property.Value){continue}
  $backup=$dest+'.before-recovery-'+$before.$name.Substring(0,12)
  if(-not(Test-Path $backup)){[IO.File]::Copy($dest,$backup,$false);$acl=Get-Acl $backup;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath $backup -AclObject $acl}
  [IO.File]::WriteAllBytes($dest,[IO.File]::ReadAllBytes($source))
  if((Get-FileHash $dest).Hash -ne $property.Value){throw 'Recovery installed hash mismatch'}
 }
 if($authorityHash -and (Get-FileHash $authority).Hash -ne $authorityHash){throw 'Existing authority changed unexpectedly'}
 @{installed=$true;hashes=$after;authorityPreserved=$true;journalAccessed=$false;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $report
}catch{@{installed=$false;error=$_.Exception.Message;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $report}
