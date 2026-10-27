param([string]$Draft,[string]$EvidenceDirectory,[Parameter(Mandatory=$true)][string]$Repository,[switch]$Publish,[switch]$RevokeAcceptance,[string]$AcceptanceHash,[string]$Reason,[switch]$InitializeReviewCertificate,[switch]$EnrollRuntime,[string]$Limits)
$ErrorActionPreference='Stop'
if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator review required'}
$target=Join-Path $env:ProgramFiles 'PaperfundSigner'
if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)){throw 'Use installed protected tool'}
$status=Get-Content (Join-Path $env:ProgramData 'PaperfundAutomation\public\status.json') -Raw|ConvertFrom-Json
if(-not $RevokeAcceptance -and ($status.settings.claims -or $status.settings.hourly -or $status.settings.daily -or -not $status.gate.stopped)){throw 'All channels must be OFF and financial STOP asserted'}
$utf8=New-Object Text.UTF8Encoding($false)
if($InitializeReviewCertificate){
 $certificateFile=Join-Path $target 'standing-policy-root.cer'
 if(Test-Path $certificateFile){Write-Host 'Existing protected review certificate preserved';exit}
 if((Read-Host 'Type INITIALIZE PUBLIC REVIEW AUTHORITY') -cne 'INITIALIZE PUBLIC REVIEW AUTHORITY'){throw 'Not approved'}
 $cert=New-SelfSignedCertificate -Subject 'CN=Paperfund Standing Policy Authority' -Type Custom -Provider 'Microsoft Software Key Storage Provider' -KeyAlgorithm RSA -KeyLength 3072 -KeyExportPolicy NonExportable -KeyUsage DigitalSignature -CertStoreLocation 'Cert:\LocalMachine\My' -NotBefore ([DateTime]::Now.AddMinutes(-5)) -NotAfter ([DateTime]::Now.AddYears(2))
 $rsa=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
 try{
  $keyFile=Join-Path $env:ProgramData ('Microsoft\Crypto\Keys\'+$rsa.Key.UniqueName)
  $acl=Get-Acl $keyFile;$acl.SetAccessRuleProtection($true,$false)
  foreach($rule in @($acl.Access)){$acl.RemoveAccessRuleSpecific($rule)}
  foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','Allow')))}
  Set-Acl $keyFile $acl
 }finally{$rsa.Dispose()}
 [IO.File]::WriteAllBytes($certificateFile,$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
 $acl=Get-Acl $certificateFile;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl $certificateFile $acl
 Write-Host 'Non-exportable review certificate initialized. No standing policy, financial acceptance or transaction authority created.'
 exit
}
if($RevokeAcceptance){
 if($AcceptanceHash -notmatch '^[a-f0-9]{64}$'){throw 'Invalid public acceptance hash'}
 $payload=@{repository=$Repository;acceptanceHash=$AcceptanceHash;reason=$Reason}|ConvertTo-Json -Compress
 $mode='revoke'
}elseif($EnrollRuntime){
 $custody=Get-Content (Join-Path $target 'automation-custody.json') -Raw|ConvertFrom-Json
 $caps=Get-Content -LiteralPath $Limits -Raw|ConvertFrom-Json
 Write-Host ('Enroll isolated mainnet database runtime for public wallet: '+$custody.wallet)
 Write-Host ($caps|ConvertTo-Json)
 if((Read-Host 'Type ENROLL DISABLED MAINNET BACKEND') -cne 'ENROLL DISABLED MAINNET BACKEND'){throw 'Not approved'}
 $payload=@{repository=$Repository;treasury=$custody.wallet;limits=$caps}|ConvertTo-Json -Depth 20 -Compress
 $mode='enroll-runtime'
}else{
 $raw=Get-Content -LiteralPath $Draft -Raw
 Write-Host $raw
 Write-Host 'This financial acceptance attests genuine retained source, UTC and received-funding evidence. It grants no transaction or STOP-release authority.'
 if((Read-Host 'Type REVIEWED MAINNET FINANCIAL EVIDENCE') -cne 'REVIEWED MAINNET FINANCIAL EVIDENCE'){throw 'Not accepted'}
 $certificateFile=Join-Path $target 'standing-policy-root.cer'
 if(-not(Test-Path $certificateFile)){throw 'Initialize the protected review certificate first; no certificate or grant is invented here'}
 $public=New-Object Security.Cryptography.X509Certificates.X509Certificate2($certificateFile)
 $cert=Get-Item ('Cert:\LocalMachine\My\'+$public.Thumbprint)
 $rsa=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes($raw);$sig=$rsa.SignData($bytes,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)}finally{$rsa.Dispose()}
 $envelope=@{payloadBase64=[Convert]::ToBase64String($bytes);signatureBase64=[Convert]::ToBase64String($sig)}
 $payload=@{repository=$Repository;envelope=$envelope;evidenceDirectory=$EvidenceDirectory}|ConvertTo-Json -Depth 20 -Compress
 $mode=if($Publish){'publish'}else{'validate'}
 if($Publish -and (Read-Host 'Type PUBLISH SOURCE ACCEPTANCE WITH STOP PRESERVED') -cne 'PUBLISH SOURCE ACCEPTANCE WITH STOP PRESERVED'){throw 'Not approved'}
}
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe'
$start.Arguments='"'+(Join-Path $target 'mainnet-tools.bundle.cjs')+'" '+$mode
$start.WorkingDirectory=$target;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
$child=[Diagnostics.Process]::Start($start)
$child.StandardInput.Write($payload);$child.StandardInput.Close()
$output=$child.StandardOutput.ReadToEnd();$errors=$child.StandardError.ReadToEnd();$child.WaitForExit()
if($child.ExitCode -ne 0){
 $code=@($errors -split '[\r\n]+'|Where-Object {$_ -match '^AUTO_[A-Z0-9_]+$'})|Select-Object -Last 1
 if(-not $code){$code='AUTO_FINANCIAL_ACCEPTANCE_BLOCKED'}
 throw $code
}
Write-Host $output
Write-Host 'No transaction was signed or submitted. Channels and financial STOP are unchanged.'
