function ConvertTo-WorkerUtc($Value) {
 if($Value -is [datetime]){return $Value.ToUniversalTime()}
 return [datetime]::Parse([string]$Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}
# Existing worker telemetry has two different clocks: last started/completed tick versus last all-clear tick.
# This classifier grants no settlement, payout or restart authority.
function Get-WorkerLiveness {
 param([Parameter(Mandatory=$true)]$Heartbeat,[Parameter(Mandatory=$true)][datetime]$WrittenAt,[datetime]$Now=[DateTime]::UtcNow)
 $result=@{active=$false;status='TELEMETRY_INVALID';tickAgeSeconds=$null;writeAgeSeconds=$null;lastAllClearAgeSeconds=$null;settlementHold=$false;lastError=$Heartbeat.lastError}
 try {
  $tick=(ConvertTo-WorkerUtc $Heartbeat.lastTickStartedAt)
  $tickAge=($Now.ToUniversalTime()-$tick).TotalSeconds
  $writeAge=($Now.ToUniversalTime()-$WrittenAt.ToUniversalTime()).TotalSeconds
  $result.tickAgeSeconds=[Math]::Round($tickAge,3);$result.writeAgeSeconds=[Math]::Round($writeAge,3)
  if($tickAge -lt -1 -or $writeAge -lt -1){$result.status='CLOCK_OR_FUTURE_TELEMETRY';return [pscustomobject]$result}
  if($tickAge -gt 30 -or $writeAge -gt 30){$result.status='HEARTBEAT_NOT_ADVANCING';return [pscustomobject]$result}
  if(($WrittenAt.ToUniversalTime()-$tick).TotalSeconds -lt -1){$result.status='INCONSISTENT_TICK_AND_WRITE';return [pscustomobject]$result}
  if($Heartbeat.lastLifecycleSuccessAt){
   $successAge=($Now.ToUniversalTime()-(ConvertTo-WorkerUtc $Heartbeat.lastLifecycleSuccessAt)).TotalSeconds
   $result.lastAllClearAgeSeconds=[Math]::Round($successAge,3)
   if($successAge -lt -1){$result.status='CLOCK_OR_FUTURE_TELEMETRY';return [pscustomobject]$result}
  }
  $result.active=$true
  if($Heartbeat.lastError){
   if($Heartbeat.lastError.scope -eq 'settlement'){
    $errorAge=($Now.ToUniversalTime()-(ConvertTo-WorkerUtc $Heartbeat.lastError.at)).TotalSeconds
    if($errorAge -lt -1 -or $errorAge -gt 30){$result.active=$false;$result.status='SETTLEMENT_ERROR_TELEMETRY_INCONSISTENT';return [pscustomobject]$result}
    $result.status='ACTIVE_WITH_SETTLEMENT_REVIEW';$result.settlementHold=$true
   }else{$result.status='ACTIVE_WITH_OPERATIONAL_FAILURE'}
  }elseif($null -eq $result.lastAllClearAgeSeconds -or $result.lastAllClearAgeSeconds -gt 30){$result.status='ACTIVE_WITHOUT_SUCCESS_EVIDENCE'}
  else{$result.status='HEALTHY'}
 }catch{$result.active=$false;$result.status='TELEMETRY_INVALID'}
 return [pscustomobject]$result
}
