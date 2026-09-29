param(
  [Parameter(Mandatory = $true)][string]$Package,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$TempRoot,
  [Parameter(Mandatory = $true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
$env:TEMP = $TempRoot
$env:TMP = $TempRoot
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class KeryxDesktopContext {
  [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder name, int length, out int needed);
}
'@
function Get-UserObjectName([IntPtr]$Handle) {
  if ($Handle -eq [IntPtr]::Zero) { return 'unavailable' }
  $name = [Text.StringBuilder]::new(256)
  $needed = 0
  if ([KeryxDesktopContext]::GetUserObjectInformation($Handle, 2, $name, 512, [ref]$needed)) {
    return $name.ToString()
  }
  return "unavailable:$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
$runtimeGuid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$machineRuntime = Get-ItemPropertyValue -LiteralPath "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$runtimeGuid" -Name pv -ErrorAction SilentlyContinue
$userRuntime = Get-ItemPropertyValue -LiteralPath "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$runtimeGuid" -Name pv -ErrorAction SilentlyContinue
if ($machineRuntime -isnot [string]) { $machineRuntime = $null }
if ($userRuntime -isnot [string]) { $userRuntime = $null }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
[pscustomobject]@{
  standardUserContext = $true
  sessionId = (Get-Process -Id $PID).SessionId
  administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  windowStation = Get-UserObjectName ([KeryxDesktopContext]::GetProcessWindowStation())
  desktop = Get-UserObjectName ([KeryxDesktopContext]::GetThreadDesktop([KeryxDesktopContext]::GetCurrentThreadId()))
  profileLocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
  environmentLocalAppData = $env:LOCALAPPDATA
  webView2MachineVersion = $machineRuntime
  webView2UserVersion = $userRuntime
} | ConvertTo-Json -Compress | Write-Output
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
function Get-InstalledEntries {
  try { return @([IO.Directory]::EnumerateFileSystemEntries($install)) }
  catch [IO.DirectoryNotFoundException] { return @() }
}
$remaining = @()
for ($attempt = 0; $attempt -lt 120; $attempt++) {
  $remaining = @(Get-InstalledEntries)
  if ($remaining.Count -eq 0) { break }
  Start-Sleep -Milliseconds 250
}
if ($remaining.Count -gt 0) {
  throw 'Isolated NSIS uninstall left installed files'
}
Write-Output 'Portable and isolated current-user NSIS acceptance passed'
