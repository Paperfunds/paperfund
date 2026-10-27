param([string]$Draft,[switch]$Revoke,[string]$PolicyId)
$ErrorActionPreference='Stop'
if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop}
if(-not(Get-PSDrive Cert -ErrorAction SilentlyContinue)){throw 'AUTO_CERTIFICATE_PROVIDER_UNAVAILABLE'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator approval required for standing authority'}
$target=Join-Path $env:ProgramFiles 'PaperfundSigner';if([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)){throw 'Use protected installed authorization tool'}
$utf8=New-Object Text.UTF8Encoding($false)
if($Revoke){if($PolicyId -notmatch '^[-a-zA-Z0-9]{16,128}$'){throw 'Invalid policy ID'};$file=Join-Path $target 'policy-revocations.json';$ids=@(Get-Content $file -Raw|ConvertFrom-Json);if($PolicyId -notin $ids){$ids+=$PolicyId};[IO.File]::WriteAllText($file,(ConvertTo-Json -InputObject $ids),$utf8);Write-Host 'Standing policy revoked. Existing transaction evidence retained.';exit}
if(-not $Draft){throw 'Choose the public standing-policy draft exported by the dashboard'}
$raw=Get-Content -LiteralPath $Draft -Raw;$p=$raw|ConvertFrom-Json
Write-Host $raw
Write-Host 'This is a MAINNET standing mandate. STOP and independent financial gates remain mandatory. No transaction is sent by enrollment.'
if((Read-Host 'Type APPROVE STANDING MAINNET only after checking every limit, wallet and expiry') -cne 'APPROVE STANDING MAINNET'){throw 'Standing policy not approved'}
# Validate the public draft in the same installed runtime before signing it.
$start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe';$start.Arguments='"'+(Join-Path $target 'automation-policy-check.bundle.cjs')+'"';$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
$child=[Diagnostics.Process]::Start($start);$child.StandardInput.Write($raw);$child.StandardInput.Close();$output=$child.StandardOutput.ReadToEnd();$errorText=$child.StandardError.ReadToEnd();$child.WaitForExit();if($child.ExitCode -ne 0){throw 'Standing policy rejected: fresh custody, positive explicit limits, valid identity and future expiry are required'}
$certificateFile=Join-Path $target 'standing-policy-root.cer'
if(Test-Path $certificateFile){$cert=New-Object Security.Cryptography.X509Certificates.X509Certificate2($certificateFile);$cert=Get-Item ('Cert:\LocalMachine\My\'+$cert.Thumbprint)}else{
 $cert=New-SelfSignedCertificate -Subject 'CN=Paperfund Standing Policy Authority' -Type Custom -Provider 'Microsoft Software Key Storage Provider' -KeyAlgorithm RSA -KeyLength 3072 -KeyExportPolicy NonExportable -KeyUsage DigitalSignature -CertStoreLocation 'Cert:\LocalMachine\My' -NotBefore ([DateTime]::Now.AddMinutes(-5)) -NotAfter ([DateTime]::Now.AddYears(2))
 $rsa=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
 $keyFile=Join-Path $env:ProgramData ('Microsoft\Crypto\Keys\'+$rsa.Key.UniqueName);$acl=Get-Acl $keyFile;$acl.SetAccessRuleProtection($true,$false);foreach($rule in @($acl.Access)){$acl.RemoveAccessRuleSpecific($rule)};foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','Allow')))};Set-Acl $keyFile $acl
 [IO.File]::WriteAllBytes($certificateFile,$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert));$acl=Get-Acl $certificateFile;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl $certificateFile $acl
}
$rsa=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert);$bytes=[Text.Encoding]::UTF8.GetBytes($raw);$signature=$rsa.SignData($bytes,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
$dest=Join-Path $target 'standing-policy.json';if(Test-Path $dest){$history=Join-Path $target ('standing-policy.previous-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')+'.json');[IO.File]::Copy($dest,$history,$false)}
[IO.File]::WriteAllText($dest,(@{payloadBase64=[Convert]::ToBase64String($bytes);signatureBase64=[Convert]::ToBase64String($signature)}|ConvertTo-Json -Compress),$utf8)
$acl=Get-Acl $dest;$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl $dest $acl
Write-Host 'Signed standing mandate enrolled. Channels remain OFF until enabled through the dashboard and all gates pass.'
