$ErrorActionPreference='Stop'
$env:LOCALAPPDATA=[Environment]::GetFolderPath('LocalApplicationData')
& (Join-Path $env:ProgramFiles 'nodejs\node.exe') (Join-Path $PSScriptRoot 'disposable-signing-proof.mjs')
if($LASTEXITCODE -ne 0){exit 1}
