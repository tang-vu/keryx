param(
  [Parameter(Mandatory = $true)][string]$TestScript,
  [Parameter(Mandatory = $true)][string]$TempRoot,
  [Parameter(Mandatory = $true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
$env:TEMP = $TempRoot
$env:TMP = $TempRoot
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location $repository
# This disposable account explicitly trusts only this checked-out CI tree.
$env:GIT_CONFIG_GLOBAL = Join-Path $TempRoot 'gitconfig'
& git config --file $env:GIT_CONFIG_GLOBAL --add safe.directory $repository
if ($LASTEXITCODE -ne 0) { throw 'Could not trust exact CI checkout for disposable account' }
& $NodePath --import tsx $TestScript
exit $LASTEXITCODE
