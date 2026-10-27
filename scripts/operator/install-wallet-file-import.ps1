$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
$results=Join-Path $env:ProgramData 'PaperfundSignerAcceptance'
try{
 $owner=(Get-Acl -LiteralPath $target).GetOwner([Security.Principal.SecurityIdentifier]).Value
 if($owner -notin @('S-1-5-18','S-1-5-32-544') -or ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Untrusted protected installation'}
 $before=ConvertFrom-Json '{"key-public.mjs":"5259c31bab560b6b56ac22359057e31421e0fb70d672fff1d060c653833bd325","wallet-import.ps1":"e72132f4d3201b68823f63dded45bd31f7e7480c7db8e744cbdc8b4fbad0cad3","open-signer.ps1":"acefce62b6d2446504317343b3eb5cd6337408e28ea724126be70fb94be316b1","wallet-file-local.ps1":"bd17cdc186d8d95b59906f2eeb3764956455faabf4a8e9b7d184e6f98c33fc29","wallet-file-editor.ps1":"53e645ff8b2384178119e09204edd735160984e3d1b242b1362d3aa23ef9d64f","wallet-file-test.ps1":"60b921497a0fe1876fe7d6fd24c3a4e6c2426df235968a8b1f5e8703423a6f4b","wallet-file-test-key.mjs":"45869ce5ec32b24e46d39df3ac821024277a8b7cdb0af4ac27087346d5d8f435"}'
 $after=ConvertFrom-Json '{"key-public.mjs":"5259c31bab560b6b56ac22359057e31421e0fb70d672fff1d060c653833bd325","wallet-import.ps1":"2b097b040a0f45d2e677cea7d8e6af391b2c1d502169f59f5ce70f97c0260a8d","open-signer.ps1":"acefce62b6d2446504317343b3eb5cd6337408e28ea724126be70fb94be316b1","wallet-file-local.ps1":"bd17cdc186d8d95b59906f2eeb3764956455faabf4a8e9b7d184e6f98c33fc29","wallet-file-editor.ps1":"53e645ff8b2384178119e09204edd735160984e3d1b242b1362d3aa23ef9d64f","wallet-file-test.ps1":"60b921497a0fe1876fe7d6fd24c3a4e6c2426df235968a8b1f5e8703423a6f4b","wallet-file-test-key.mjs":"45869ce5ec32b24e46d39df3ac821024277a8b7cdb0af4ac27087346d5d8f435"}'
 foreach($property in $after.PSObject.Properties){
  $name=$property.Name;$source=Join-Path $PSScriptRoot $name;$dest=Join-Path $target $name
  if((Get-FileHash -LiteralPath $source).Hash -ne $property.Value){throw ('Reviewed source hash changed: '+$name)}
  if(Test-Path -LiteralPath $dest){
   $current=(Get-FileHash -LiteralPath $dest).Hash
   if($current -eq $property.Value){continue}
   if(-not $before.$name -or $current -ne $before.$name){throw ('Unknown installed preimage; retained: '+$name)}
   $backup=$dest+'.before-file-import-'+$current.Substring(0,12)
   if(-not(Test-Path -LiteralPath $backup)){[IO.File]::Copy($dest,$backup,$false);$acl=Get-Acl -LiteralPath $backup;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath $backup -AclObject $acl}
   [IO.File]::WriteAllBytes($dest,[IO.File]::ReadAllBytes($source))
  }else{[IO.File]::Copy($source,$dest,$false);$acl=Get-Acl -LiteralPath $dest;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath $dest -AclObject $acl}
  if((Get-FileHash -LiteralPath $dest).Hash -ne $property.Value){throw 'Installed hash verification failed'}
 }
 @{installed=$true;at=[DateTime]::UtcNow.ToString('o');scope='PRIVATE_FILE_IMPORT_ONLY';financialAuthority='NONE';hashes=$after} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $results 'file-import-install.public.json')
}catch{@{installed=$false;error=$_.Exception.Message;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $results 'file-import-install.public.json')}
