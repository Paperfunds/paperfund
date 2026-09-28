param(
  [string]$Database = 'paperfund',
  [string]$User = 'paperfund',
  [string]$OutputDirectory = 'backups',
  [string]$ComposeFile = 'compose.yml'
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$fileName = "paperfund-$stamp.dump"
$containerPath = "/tmp/$fileName"
$outputPath = Join-Path (Resolve-Path '.').Path (Join-Path $OutputDirectory $fileName)
New-Item -ItemType Directory -Force -Path (Split-Path $outputPath) | Out-Null

try {
  docker compose -f $ComposeFile exec -T postgres pg_dump -U $User -d $Database --format=custom --file=$containerPath
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
  docker compose -f $ComposeFile cp "postgres:$containerPath" $outputPath
  if ($LASTEXITCODE -ne 0) { throw 'Copying the backup from PostgreSQL failed.' }
  $backup = Get-Item -LiteralPath $outputPath
  if ($backup.Length -eq 0) { throw 'The backup file is empty.' }
  Write-Output $backup.FullName
} finally {
  docker compose -f $ComposeFile exec -T postgres rm -f $containerPath 2>$null | Out-Null
}
