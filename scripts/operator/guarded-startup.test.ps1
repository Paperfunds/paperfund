# Isolated function/branch tests ONLY. Never executes the launcher top level or starts/stops services.
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'launcher.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'PARSE_FAILED'}
$definitions=@{}
foreach($name in @('Reviewed-Hash','Get-GuardedApiProfile','Confirm-GuardedApiListener','Start-Reviewed')){
 $node=$ast.Find({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if(-not $node){throw ('FUNCTION_MISSING:'+ $name)}
 $definitions[$name]=[scriptblock]::Create($node.Extent.Text)
 . $definitions[$name]
}
# Tripwires: functions under test cannot perform process/service/container operations.
function Start-Process {throw 'UNEXPECTED_PROCESS_START'}
function Stop-Process {throw 'UNEXPECTED_PROCESS_STOP'}
function Start-Service {throw 'UNEXPECTED_SERVICE_START'}
function docker {throw 'UNEXPECTED_DOCKER_CALL'}
$originalLocal=$env:LOCALAPPDATA
$tempBase=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture=Join-Path $tempBase ('paperfund-guarded-launcher-test-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory((Join-Path $fixture 'PaperfundOperator'))|Out-Null
$profilePath=Join-Path $fixture 'PaperfundOperator\runtime.json'
$receiptDir=Join-Path $fixture 'PaperfundOperator\website-artifact-services'
[IO.Directory]::CreateDirectory($receiptDir)|Out-Null
$proposed=Get-Content -LiteralPath (Join-Path $repoRoot 'docs/linked-pair-20261024/one-click-startup/runtime.proposed.json') -Raw | ConvertFrom-Json
$old=Get-Content -LiteralPath (Join-Path $repoRoot 'docs/linked-pair-20261024/one-click-startup/runtime.before.json') -Raw | ConvertFrom-Json
$results=New-Object Collections.Generic.List[object]
function Assert($condition,$message){if(-not $condition){throw $message}}
function Save-Profile($value){$value|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $profilePath -Encoding UTF8}
function Denied($action,$pattern){try{& $action|Out-Null}catch{if($_.Exception.Message -match $pattern){return};throw};throw ('EXPECTED_DENIAL:'+ $pattern)}
try{
 $env:LOCALAPPDATA=$fixture
 Save-Profile $proposed
 $g=Get-GuardedApiProfile
 Assert ($g.Launcher -eq (Join-Path $repoRoot 'scripts/website-start-pinned-api.ps1')) 'WRONG_DELEGATE'
 $results.Add(@{case='proposed exact profile validates real pinned manifest, entry, helper, Node and protected config';status='PASS'})
 Save-Profile $old
 Denied {Get-GuardedApiProfile} 'GUARDED_API_PROFILE_UPDATE_REQUIRED'
 $results.Add(@{case='legacy API profile cannot start';status='PASS'})
 foreach($field in @('script','sha256','buildManifest','buildManifestSha256','launcher','launcherSha256','environmentFile')){
  $changed=$proposed|ConvertTo-Json -Depth 8|ConvertFrom-Json
  $changed.api.$field='unreviewed'
  Save-Profile $changed
  Denied {Get-GuardedApiProfile} 'GUARDED_API_PROFILE_UPDATE_REQUIRED|PROTECTED_API_CONFIG_CHANGED'
 }
 $results.Add(@{case='every pinned API/config field rejects substitution';status='PASS'})
 Save-Profile $proposed
 # Mock only the delegate selector; never invoke the actual guarded startup script.
 function Get-GuardedApiProfile {return @{Launcher={param($Mode)$script:delegations+=@($Mode)}}}
 $script:delegations=@()
 Start-Reviewed 'api'
 Assert ($script:delegations.Count -eq 1 -and $script:delegations[0] -eq 'live') 'INCORRECT_API_DELEGATION'
 $results.Add(@{case='cold API dispatch delegates once and cannot reach generic Node startup';status='PASS'})
 . $definitions['Get-GuardedApiProfile']
 # The existing web cold-start hash guard remains strict; source is never re-pinned.
 function node {$global:LASTEXITCODE=0}
 Denied {Start-Reviewed 'web'} 'web build hash mismatch'
 $results.Add(@{case='outdated web hash still denies cold start without re-pinning or process effects';status='PASS'})
 # Warm recognition uses fixture listener/process/receipt, never a running production API.
 $script:process=[pscustomobject]@{ProcessId=424242;Name='node.exe';CreationDate=[datetime]'2026-10-24T00:00:00Z';CommandLine=''}
 function Healthy {return $true}
 function Get-CimInstance {return $script:process}
 function Get-GuardedApiProfile {return @{Entry=$proposed.api;Release='fixture';Manifest=@{configSHA256='fixture-config'};Node={param($a,$b,$c,$d)$global:LASTEXITCODE=0}}}
 $receipt=[ordered]@{pid=424242;entry=(Join-Path $repoRoot $proposed.api.script);entrySHA256=$proposed.api.sha256;manifestSHA256=$proposed.api.buildManifestSha256;configSHA256='fixture-config';buyAdmission='DENY_ALL_BUY';financialStop=$true;mixedRuntimeActive=$false;host='127.0.0.1';port=3000;startedAt='2026-10-24T00:00:00Z'}
 $receipt|ConvertTo-Json|Set-Content (Join-Path $receiptDir 'api-live-fixture-receipt.json') -Encoding UTF8
 $listener=@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=424242})
 Confirm-GuardedApiListener $listener
 $results.Add(@{case='healthy guarded PID is preserved with exact receipt and creation identity even if command line is unavailable';status='PASS'})
 $script:process.CommandLine='node apps\api\dist\main.js'
 Denied {Confirm-GuardedApiListener $listener} 'API_LISTENER_IS_NOT_GUARDED_RELEASE'
 $script:process.CommandLine=''
 $receipt.pid=424241;$receipt|ConvertTo-Json|Set-Content (Join-Path $receiptDir 'api-live-fixture-receipt.json') -Encoding UTF8
 Denied {Confirm-GuardedApiListener $listener} 'GUARDED_API_STARTUP_RECEIPT_REQUIRED'
 $results.Add(@{case='old API listener and reused/mismatched PID receipt are rejected without killing either process';status='PASS'})
 # Evaluate ONLY the ApiOnly conditional extracted from the AST, with every effect stubbed.
 $apiBranch=$ast.Find({param($n)$n -is [System.Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -eq '$ApiOnly'},$true)
 Assert ($null -ne $apiBranch) 'API_ONLY_BRANCH_MISSING'
 $block=[scriptblock]::Create($apiBranch.Extent.Text)
 function Listeners {return @()}
 function Start-Reviewed {param($Name)$script:started+=@($Name)}
 $script:started=@();$ApiOnly=$true;$CheckOnly=$false
 & $block
 Assert ($script:started.Count -eq 1 -and $script:started[0] -eq 'api') 'API_ONLY_TOUCHED_OTHER_SERVICE'
 $CheckOnly=$true;$script:started=@()
 Denied {& $block} 'Guarded API is offline'
 Assert ($script:started.Count -eq 0) 'CHECK_ONLY_STARTED_API'
 $results.Add(@{case='API-only branch starts only API; check-only starts nothing and never reaches Docker/website/worker/evidence/dashboard';status='PASS'})
 # The full-stack entry must reject an old API profile before Docker or other service effects.
 . $definitions['Get-GuardedApiProfile']
 Save-Profile $old
 $topTry=@($ast.EndBlock.Statements|Where-Object {$_ -is [System.Management.Automation.Language.TryStatementAst]})[0]
 $gate=@($topTry.Body.Statements|Where-Object {$_.Extent.Text -eq 'Get-GuardedApiProfile | Out-Null'})[0]
 $dockerCall=$topTry.Body.Find({param($n)$n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'docker'},$true)
 Assert ($null -ne $gate -and $gate.Extent.StartOffset -lt $dockerCall.Extent.StartOffset) 'FULL_STACK_API_GATE_TOO_LATE'
 Denied {& ([scriptblock]::Create($gate.Extent.Text))} 'GUARDED_API_PROFILE_UPDATE_REQUIRED'
 $results.Add(@{case='legacy full-stack profile rejects before containers or unrelated services can start';status='PASS'})
 $record=@{status='PASS';cases=$results;count=$results.Count;launcherTopLevelExecuted=$false;actualStartupOrSignal=$false;productionConfigurationChanged=$false}
 Write-Output ('TEST_RESULT_JSON='+($record|ConvertTo-Json -Depth 6 -Compress))
 $record|ConvertTo-Json -Depth 6
}finally{
 $env:LOCALAPPDATA=$originalLocal
 $resolvedFixture=[IO.Path]::GetFullPath($fixture)
 if(-not $resolvedFixture.StartsWith((Join-Path $tempBase 'paperfund-guarded-launcher-test-'),[StringComparison]::OrdinalIgnoreCase)){throw 'TEMP_CLEANUP_PATH_INVALID'}
 Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
