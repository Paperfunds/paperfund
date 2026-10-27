$ErrorActionPreference='Stop'
try {
 $resultDir=Join-Path $env:ProgramData 'PaperfundSignerAcceptance'
 $user=Get-LocalUser -Name PaperfundSigner
 $policyFile=Join-Path $resultDir 'signer-user-rights.inf'
 & secedit.exe /export /cfg $policyFile /areas USER_RIGHTS /quiet
 if($LASTEXITCODE -ne 0){throw 'User-rights export failed'}
 $rights=@(Get-Content -LiteralPath $policyFile | Where-Object {$_ -match '^Se(Interactive|DenyInteractive|Batch|DenyBatch|Service|DenyService|RemoteInteractive|DenyRemoteInteractive|Network|DenyNetwork)LogonRight'})
 $events=@(Get-WinEvent -FilterHashtable @{LogName='Security';Id=4625,4776,4724,4738;StartTime=(Get-Date).AddHours(-12)} -MaxEvents 2000 -ErrorAction SilentlyContinue | ForEach-Object {
  $xml=[xml]$_.ToXml();$data=@{};foreach($field in $xml.Event.EventData.Data){$data[$field.Name]=[string]$field.'#text'}
  if($data.TargetUserName -ieq 'PaperfundSigner'){
   [PSCustomObject]@{time=$_.TimeCreated.ToUniversalTime().ToString('o');eventId=$_.Id;targetDomain=$data.TargetDomainName;logonType=$data.LogonType;status=$data.Status;subStatus=$data.SubStatus;failureReason=$data.FailureReason;processName=$data.ProcessName;authentication=$data.AuthenticationPackageName;workstation=$data.Workstation;subject=$data.SubjectUserName}
  }
 })
 $adsi=[ADSI]('WinNT://'+$env:COMPUTERNAME+'/PaperfundSigner,user')
 $result=@{at=[DateTime]::UtcNow.ToString('o');account=@{name=$user.Name;sid=$user.SID.Value;enabled=$user.Enabled;passwordLastSet=$user.PasswordLastSet.ToUniversalTime().ToString('o');passwordRequired=$user.PasswordRequired;accountExpires=$user.AccountExpires;passwordExpires=$user.PasswordExpires;userMayChangePassword=$user.UserMayChangePassword;userFlags=[int]$adsi.UserFlags.Value};rights=$rights;events=$events;secondaryLogon=(Get-Service seclogon).Status.ToString();netUser=(& net.exe user PaperfundSigner | Out-String)}
 $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $resultDir 'logon-diagnosis.public.json')
 Write-Host 'Targeted logon diagnosis saved. No account, password, logon right or financial setting changed.'
}catch{Write-Host ('Diagnosis failed: '+$_.Exception.Message)}
