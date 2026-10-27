param([Parameter(Mandatory=$true)][string]$ApplicationProcessIdList)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'wallet-file-local.ps1')
$identity=Assert-LocalSigner
$ids=@($ApplicationProcessIdList.Split(',') | ForEach-Object {[int]$_})
$results=New-Object Collections.Generic.List[object]
$keys=$null;$testOwnedFile=$false
$path=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PaperfundSigner\Import\phantom-private-key.txt'
if((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -gt 0){throw 'KEY_PENDING_OPERATOR_INPUT_PRESENT_TEST_ABORTED'}
try {
 $start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=Join-Path $env:ProgramFiles 'nodejs\node.exe';$start.Arguments='"'+(Join-Path $PSScriptRoot 'wallet-file-test-key.mjs')+'"';$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $child=[Diagnostics.Process]::Start($start);$generated=$child.StandardOutput.ReadToEnd();$child.WaitForExit();if($child.ExitCode -ne 0){throw 'TEST_KEY_GENERATION_FAILED'};$keys=$generated | ConvertFrom-Json;$generated=$null
 Add-Type -AssemblyName System.Security
 $cases=@(
  @{name='32-byte base58 seed';value=$keys.seed58;expected=$keys.publicAddress;error=$null;diagnostic=$false},
  @{name='64-byte Phantom-compatible base58 keypair';value=$keys.pair58;expected=$keys.publicAddress;error=$null;diagnostic=$false},
  @{name='32-byte JSON seed';value=$keys.seedJson;expected=$keys.publicAddress;error=$null;diagnostic=$false},
  @{name='64-byte multiline JSON keypair';value=$keys.pairJson;expected=$keys.publicAddress;error=$null;diagnostic=$false},
  @{name='Base58 trailing CRLF';value=($keys.pair58+[Environment]::NewLine);expected=$keys.publicAddress;error=$null;diagnostic=$false},
  @{name='Diagnostic mode creates no record';value=$keys.pair58;expected=$keys.publicAddress;error=$null;diagnostic=$true},
  @{name='Invalid base58 encoding';value='0OIl!';expected=$keys.publicAddress;error='KEY_INVALID_BASE58_ENCODING';diagnostic=$false},
  @{name='Invalid JSON encoding';value='[1,';expected=$keys.publicAddress;error='KEY_INVALID_JSON_ENCODING';diagnostic=$false},
  @{name='Wrong byte length';value='[1,2]';expected=$keys.publicAddress;error='KEY_BYTE_LENGTH_EXPECTED_32_OR_64';diagnostic=$false},
  @{name='Embedded public half inconsistent';value=$keys.badPair58;expected=$keys.publicAddress;error='KEY_EMBEDDED_PUBLIC_KEY_INCONSISTENT';diagnostic=$false},
  @{name='Derived address mismatch';value=$keys.pair58;expected=$keys.otherPublicAddress;error='KEY_DERIVED_ADDRESS_MISMATCH_NOT_STORED';diagnostic=$false}
 )
 foreach($case in $cases){
  $file=Initialize-WalletImportFile;$testOwnedFile=$true
  [IO.File]::WriteAllText($file,$case.value,(New-Object Text.UTF8Encoding($false)))
  $caught=$null;$imported=$null
  try{$imported=& (Join-Path $PSScriptRoot 'wallet-import.ps1') -ExpectedAddress $case.expected -ApplicationProcessIds $ids -KeyFile $file -DiagnosticOnly:$case.diagnostic -PassThru}catch{$caught=$_.Exception.Message}
  if($case.error){if($caught -ne $case.error){throw ('TEST_ERROR_CLASSIFICATION_FAILED: '+$case.name)};if(-not(Test-Path -LiteralPath $file)){throw 'TEST_FAILURE_REMOVED_INPUT_UNEXPECTEDLY'};Remove-WalletImportFile}
  else{
   if($caught){throw ('TEST_IMPORT_FAILED: '+$case.name+' / '+$caught)}
   if($imported.publicAddress -ne $keys.publicAddress){throw 'TEST_DERIVED_ADDRESS_FAILED'}
   if($case.diagnostic){if($imported.stored){throw 'TEST_DIAGNOSTIC_STORED_KEY'};Remove-WalletImportFile}
   else{
    if((Test-Path -LiteralPath $file) -or -not $imported.plaintextRemoved){throw 'TEST_PLAINTEXT_NOT_REMOVED'}
    $clear=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($imported.record),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    try{if([Text.Encoding]::UTF8.GetString($clear) -cne $case.value){throw 'TEST_FILE_INPUT_ALTERED_OR_TRUNCATED'}}finally{[Array]::Clear($clear,0,$clear.Length)}
   }
  }
  $results.Add([PSCustomObject]@{case=$case.name;passed=$true;expectedError=$case.error;record=$(if($imported){$imported.record}else{$null})})
 }
 $report=@{passed=$true;signerSid=$identity.User.Value;temporaryPath=$path;plaintextFileAbsent=(-not(Test-Path -LiteralPath $path));cases=$results.ToArray();publicAddress=$keys.publicAddress;at=[DateTime]::UtcNow.ToString('o');signingPerformed=$false;broadcast=$false;inputRoundTripVerified=$true}
 $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $env:ProgramData 'PaperfundSignerAcceptance\file-import-test.public.json')
 Write-Host 'PASS: all file-import cases; exact input round-trip; plaintext cleanup; no signing or broadcast.' -ForegroundColor Green
}catch{
 $failureMessage=$_.Exception.Message;$failureLine=$_.InvocationInfo.ScriptLineNumber;$safe='TEST_FAILED';if($failureMessage -match '^TEST_[A-Z0-9_]+'){$safe=$Matches[0]}
 @{passed=$false;error=$safe;caseName=$case.name;safeFailureDetail=$failureMessage;failureLine=$failureLine;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $env:ProgramData 'PaperfundSignerAcceptance\file-import-test.public.json')
 Write-Host ('FILE IMPORT TEST FAILED: '+$safe) -ForegroundColor Red
}finally{$keys=$null;if($testOwnedFile -and (Test-Path -LiteralPath $path)){Remove-WalletImportFile};Read-Host 'Press Enter to close the disposable test window' | Out-Null}
