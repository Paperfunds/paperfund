param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$DestinationPath
)

$ErrorActionPreference = 'Stop'
$source = [System.IO.Path]::GetFullPath($SourceDirectory)
$destination = [System.IO.Path]::GetFullPath($DestinationPath)
if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "Extension package directory does not exist: $source"
}

Compress-Archive -Path (Join-Path $source '*') -DestinationPath $destination -CompressionLevel Optimal
