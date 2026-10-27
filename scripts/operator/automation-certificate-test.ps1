$ErrorActionPreference='Stop'
if(-not(Get-PSProvider Certificate -ErrorAction SilentlyContinue)){Remove-TypeData -TypeName 'System.Security.AccessControl.ObjectSecurity' -ErrorAction SilentlyContinue;Import-Module Microsoft.PowerShell.Security -ErrorAction Stop}
if(-not(Get-PSDrive Cert -ErrorAction SilentlyContinue)){throw 'AUTO_CERTIFICATE_PROVIDER_UNAVAILABLE'}
$cert=$null
try{
 $cert=New-SelfSignedCertificate -Subject 'CN=Paperfund DISPOSABLE Automation Test' -Type Custom -Provider 'Microsoft Software Key Storage Provider' -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy NonExportable -KeyUsage DigitalSignature -CertStoreLocation 'Cert:\CurrentUser\My' -NotBefore ([DateTime]::Now.AddMinutes(-5)) -NotAfter ([DateTime]::Now.AddDays(1))
 $rsa=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert);$bytes=[Text.Encoding]::UTF8.GetBytes('DISPOSABLE PUBLIC TEST');$signature=$rsa.SignData($bytes,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
 $nonexportable=$false;try{$null=$rsa.ExportParameters($true)}catch{$nonexportable=$true}
 @{certificate=[Convert]::ToBase64String($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert));signature=[Convert]::ToBase64String($signature);nonexportable=$nonexportable}|ConvertTo-Json -Compress
}finally{if($cert -and $cert.Subject -eq 'CN=Paperfund DISPOSABLE Automation Test' -and $cert.Thumbprint -match '^[A-F0-9]{40}$'){Remove-Item -LiteralPath ('Cert:\CurrentUser\My\'+$cert.Thumbprint) -DeleteKey}}
