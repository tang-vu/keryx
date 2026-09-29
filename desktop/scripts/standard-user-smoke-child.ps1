param(
  [Parameter(Mandatory = $true)][string]$Package,
  [Parameter(Mandatory = $true)][string]$TempRoot,
  [Parameter(Mandatory = $true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
$env:TEMP = $TempRoot
$env:TMP = $TempRoot
Set-Location ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
& $NodePath --import tsx desktop/scripts/tauri-smoke.mjs (Join-Path $Package 'KeryxOperator.exe')
exit $LASTEXITCODE
