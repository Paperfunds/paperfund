$ErrorActionPreference='Stop'
$results=Join-Path $env:ProgramData 'PaperfundSignerAcceptance'
try{
 $target=Join-Path $env:ProgramFiles 'PaperfundSigner'
 $acl=Get-Acl -LiteralPath $target
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Untrusted installation owner'}
 foreach($name in @('open-signer.ps1','signer-session.ps1','signer-session-check.mjs')){
  $source=Join-Path $PSScriptRoot $name;$dest=Join-Path $target $name
  if(Test-Path -LiteralPath $dest){if((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $dest).Hash){throw ('Existing file differs; retained: '+$name)}}
  else{[IO.File]::Copy($source,$dest,$false);$fileAcl=Get-Acl -LiteralPath $dest;$fileAcl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath $dest -AclObject $fileAcl}
 }
 @{installed=$true;at=[DateTime]::UtcNow.ToString('o');passwordReset=$false;rightsChanged=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $results 'desktop-install.public.json')
 $old=Get-CimInstance Win32_Process -Filter 'ProcessId=27892'
 if($old -and $old.CommandLine -match 'diagnose-signer-logon.ps1'){Stop-Process -Id 27892}
 $events=@()
 foreach($eventId in @(4625,4776,4724)){
  $recent=@(Get-WinEvent -FilterHashtable @{LogName='Security';Id=$eventId} -MaxEvents 20 -ErrorAction SilentlyContinue)
  foreach($event in $recent){$xml=[xml]$event.ToXml();$d=@{};foreach($f in $xml.Event.EventData.Data){$d[$f.Name]=[string]$f.'#text'}
   if($d.TargetUserName -ieq 'PaperfundSigner'){$events += [PSCustomObject]@{at=$event.TimeCreated.ToUniversalTime().ToString('o');id=$event.Id;domain=$d.TargetDomainName;logonType=$d.LogonType;status=$d.Status;subStatus=$d.SubStatus;process=$d.ProcessName;authentication=$d.AuthenticationPackageName;subject=$d.SubjectUserName}}
  }
 }
 @{at=[DateTime]::UtcNow.ToString('o');events=$events} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $results 'logon-events.public.json')
}catch{@{at=[DateTime]::UtcNow.ToString('o');error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $results 'desktop-install-error.public.json')}
