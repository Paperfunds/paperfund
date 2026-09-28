param(
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [string]$User = 'paperfund',
  [string]$ComposeFile = 'compose.yml'
)

$ErrorActionPreference = 'Stop'
$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$database = "paperfund_restore_smoke_$stamp"
$containerPath = "/tmp/$([IO.Path]::GetFileName($resolvedBackup))"

if ($database -notmatch '^paperfund_restore_smoke_[0-9]{14}$') {
  throw 'Refusing to use an unexpected restore database name.'
}

try {
  docker compose -f $ComposeFile cp $resolvedBackup "postgres:$containerPath"
  if ($LASTEXITCODE -ne 0) { throw 'Copying the backup into PostgreSQL failed.' }
  docker compose -f $ComposeFile exec -T postgres createdb -U $User $database
  if ($LASTEXITCODE -ne 0) { throw 'Creating the restore-smoke database failed.' }
  docker compose -f $ComposeFile exec -T postgres pg_restore -U $User -d $database --exit-on-error $containerPath
  if ($LASTEXITCODE -ne 0) { throw 'Restoring the backup failed.' }
  $tableCount = docker compose -f $ComposeFile exec -T postgres psql -U $User -d $database -Atc "select count(*) from information_schema.tables where table_schema='public'"
  if ($LASTEXITCODE -ne 0 -or [int]$tableCount -le 0) { throw 'The restored database has no public tables.' }
  Write-Output "Restore smoke passed: $database contains $tableCount public tables."
} finally {
  docker compose -f $ComposeFile exec -T postgres dropdb -U $User --if-exists $database 2>$null | Out-Null
  docker compose -f $ComposeFile exec -T postgres rm -f $containerPath 2>$null | Out-Null
}
