param(
  [Parameter(Mandatory = $true)][string]$Package,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$TempRoot,
  [Parameter(Mandatory = $true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
$env:TEMP = $TempRoot
$env:TMP = $TempRoot
Set-Location ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
& $NodePath --import tsx desktop/scripts/tauri-smoke.mjs (Join-Path $Package 'KeryxOperator.exe')
if ($LASTEXITCODE -ne 0) { throw "Portable package smoke failed: $LASTEXITCODE" }

# NSIS /D must be the final, unquoted argument. The disposable runner path is
# checked before use so their application files stay in this standard user's
# fresh fixture, without touching an existing Keryx installation.
$install = [IO.Path]::GetFullPath((Join-Path $TempRoot 'installed-keryx'))
$owned = [IO.Path]::GetFullPath($TempRoot).TrimEnd('\') + '\'
if (-not $install.StartsWith($owned, [StringComparison]::OrdinalIgnoreCase) -or
    $install.Contains(' ') -or (Test-Path -LiteralPath $install)) {
  throw 'Invalid isolated installer destination'
}
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'NSIS installer is missing' }
function Invoke-BoundedInstaller([string]$Executable, [string[]]$Arguments) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  try {
    if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'NSIS process timed out' }
    if ($process.ExitCode -ne 0) { throw "NSIS process exited $($process.ExitCode)" }
  } finally { $process.Dispose() }
}
$uninstaller = Join-Path $install 'uninstall.exe'
try {
  Invoke-BoundedInstaller $Installer @('/S', "/D=$install")
  $installedExe = Join-Path $install 'KeryxOperator.exe'
  if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw 'NSIS did not install into the isolated destination'
  }
  $portableExe = Join-Path $Package 'KeryxOperator.exe'
  if ((Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $portableExe -Algorithm SHA256).Hash) {
    throw 'NSIS installed executable differs from the staged portable executable'
  }
  & $NodePath --import tsx desktop/scripts/check-package.mjs $install
  if ($LASTEXITCODE -ne 0) { throw "Installed package identity check failed: $LASTEXITCODE" }
  & $NodePath --import tsx desktop/scripts/tauri-smoke.mjs $installedExe
  if ($LASTEXITCODE -ne 0) { throw "Installed package smoke failed: $LASTEXITCODE" }
} finally {
  if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
    # Let NSIS self-copy to temp so it can remove its own installed executable.
    Invoke-BoundedInstaller $uninstaller @('/S')
  }
}
for ($attempt = 0; $attempt -lt 120 -and (Test-Path -LiteralPath $install); $attempt++) {
  if (@(Get-ChildItem -LiteralPath $install -Force -ErrorAction SilentlyContinue).Count -eq 0) { break }
  Start-Sleep -Milliseconds 250
}
if ((Test-Path -LiteralPath $install) -and
    @(Get-ChildItem -LiteralPath $install -Force -ErrorAction SilentlyContinue).Count -gt 0) {
  throw 'Isolated NSIS uninstall left installed files'
}
Write-Output 'Portable and isolated current-user NSIS acceptance passed'
