param([Parameter(Mandatory=$true)][string]$RequestFile,[Parameter(Mandatory=$true)][string]$RequestSHA256)
$ErrorActionPreference='Stop'
function Digest($bytes){$h=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($h.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function SafePath($file){
 if(-not [IO.Path]::IsPathRooted($file)){throw 'ABSOLUTE_PATH_REQUIRED'}
 $cursor=[IO.Path]::GetFullPath($file)
 while($cursor){if([IO.File]::Exists($cursor) -or [IO.Directory]::Exists($cursor)){if(([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'DIAGNOSTIC_REPARSE_PATH_REFUSED'}};$cursor=[IO.Path]::GetDirectoryName($cursor)}
}
SafePath $RequestFile
$raw=[IO.File]::ReadAllBytes($RequestFile)
if((Digest $raw) -ne $RequestSHA256){throw 'ELEVATED_REQUEST_PIN'}
$request=[Text.Encoding]::UTF8.GetString($raw)|ConvertFrom-Json
foreach($file in @($request.plan,$request.updater,$request.receipt)){SafePath $file}
if([IO.Path]::GetDirectoryName($request.receipt) -ne [IO.Path]::GetDirectoryName($RequestFile)){throw 'RECEIPT_SCOPE'}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$global:RewardUpdateStage='VERIFY_UPDATER_HASH';$global:RewardUpdateContext=@{}
$global:RewardUpdateRecovery='NOT_NEEDED';$global:RewardUpdateErrors=New-Object Collections.ArrayList
$result=@{schema='PAPERFUND_ELEVATED_RESULT_V1';attemptId=$request.attemptId;requestSHA256=$RequestSHA256;action=$request.action;plan=$request.plan;planSHA256=$request.planSHA256;updater=$request.updater;updaterSHA256=$request.updaterSHA256;pid=$PID;elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);workingDirectory=[Environment]::CurrentDirectory;startedAt=[DateTime]::UtcNow.ToString('o');status='RUNNING';events=New-Object Collections.ArrayList}
function Write-UpdateDiagnostic {
 $event=@{at=[DateTime]::UtcNow.ToString('o');operation=$global:RewardUpdateStage;context=$global:RewardUpdateContext.Clone()}
 [void]$result.events.Add($event)
 $result.operation=$global:RewardUpdateStage;$result.recovery=$global:RewardUpdateRecovery;$result.errors=@($global:RewardUpdateErrors.ToArray())
 $bytes=[Text.Encoding]::UTF8.GetBytes(($result|ConvertTo-Json -Depth 20 -Compress))
 $tmp=$request.receipt+'.writing'
 $stream=New-Object IO.FileStream($tmp,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 if([IO.File]::Exists($request.receipt)){[IO.File]::Replace($tmp,$request.receipt,($request.receipt+'.previous-'+[Guid]::NewGuid().ToString('N')))}else{[IO.File]::Move($tmp,$request.receipt)}
}
function Register-UpdateError($record){
 # Equivalent typed diagnostics; never persist arbitrary exception text/source lines/output.
 $message=[string]$record.Exception.Message
 $code=if($message -match '^(UPDATE_[A-Z_]+|ABSOLUTE_[A-Z_]+|SIMULATED_REPLACEMENT_FAILURE|[A-Z_]+_(REQUIRED|CHANGED|MISMATCH|REFUSED|FAILED|ACTIVE|PIN|SCOPE|ALLOWLIST|ACL))(:[a-zA-Z0-9_.-]+)?$'){$message}else{'TYPED_EXCEPTION_SEE_OPERATION_AND_PATH'}
 $fqid=([string]$record.FullyQualifiedErrorId -split ',')[0]
 if($fqid -notmatch '^[a-zA-Z0-9_.-]{1,160}$'){$fqid='REDACTED'}
 $item=@{at=[DateTime]::UtcNow.ToString('o');operation=$global:RewardUpdateStage;context=$global:RewardUpdateContext.Clone();code=$code;exceptionType=$record.Exception.GetType().FullName;hresult=$record.Exception.HResult;fullyQualifiedErrorId=$fqid;category=[string]$record.CategoryInfo.Category;line=$record.InvocationInfo.ScriptLineNumber;messageSHA256=(Digest ([Text.Encoding]::UTF8.GetBytes($message)))}
 if($record.Exception.InnerException){$item.innerExceptionType=$record.Exception.InnerException.GetType().FullName;$item.innerHresult=$record.Exception.InnerException.HResult}
 [void]$global:RewardUpdateErrors.Add($item)
 Write-UpdateDiagnostic
}
$exitCode=0
try{
 Write-UpdateDiagnostic
 if($request.requireElevation -and -not $result.elevated){throw 'ELEVATED_TOKEN_REQUIRED'}
 $source=[IO.File]::ReadAllBytes($request.updater)
 $actual=Digest $source;$global:RewardUpdateContext=@{path=$request.updater;expectedSHA256=$request.updaterSHA256;actualSHA256=$actual}
 if($actual -ne $request.updaterSHA256){throw 'ELEVATED_SCRIPT_PIN'}
 $invoke=@{Action=$request.action;Plan=$request.plan;PlanSHA256=$request.planSHA256;OwnerApproved=$true}
 if($request.failAfter -gt 0){$invoke.FailAfter=[int]$request.failAfter}
 if($request.failAfter -lt 0){$invoke.CrashAfter=-[int]$request.failAfter}
 $messages=@(& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($source))) @invoke)
 $result.output=@($messages|ForEach-Object {if([string]$_ -match '^PASS: [a-zA-Z0-9 /;._-]+$'){[string]$_}else{'REDACTED_OUTPUT_SHA256:'+(Digest ([Text.Encoding]::UTF8.GetBytes([string]$_)))}})
 $result.status='SUCCEEDED'
}catch{
 Register-UpdateError $_
 $result.status='FAILED';$exitCode=1
}finally{
 $result.exitCode=$exitCode;$result.finishedAt=[DateTime]::UtcNow.ToString('o');Write-UpdateDiagnostic
}
exit $exitCode
