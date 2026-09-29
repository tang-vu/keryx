param(
  [Parameter(Mandatory = $true)][string]$Package,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$TempRoot,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$ExpectedSourceCommit
)
$ErrorActionPreference = 'Stop'
if ($ExpectedSourceCommit -cnotmatch '^[a-f0-9]{40}$') { throw 'Missing independent checkout source revision' }
$env:KERYX_EXPECTED_SOURCE_COMMIT = $ExpectedSourceCommit
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
  [DllImport("userenv.dll", EntryPoint = "GetUserProfileDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool GetUserProfileDirectory(IntPtr token, StringBuilder path, ref int length);
  [DllImport("shell32.dll", ExactSpelling = true)]
  public static extern int SHGetKnownFolderPath(ref Guid folder, uint flags, IntPtr token, out IntPtr path);
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
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
    $identity.Name -notmatch '\\keryxstd[0-9a-f]{8}$') {
  throw 'Smoke child is not the disposable standard Windows user'
}
$profileBuffer = [Text.StringBuilder]::new(32768)
$profileLength = $profileBuffer.Capacity
if (-not [KeryxDesktopContext]::GetUserProfileDirectory($identity.Token, $profileBuffer, [ref]$profileLength)) {
  throw "Cannot resolve disposable user profile: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
$profileRoot = [IO.Path]::GetFullPath($profileBuffer.ToString()).TrimEnd('\')
$accountParts = $identity.Name.Split('\', 2)
if (-not [IO.Directory]::Exists($profileRoot) -or $profileRoot -notmatch '^[A-Za-z]:\\' -or
    -not [IO.Path]::GetFileName($profileRoot).StartsWith($accountParts[1], [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Disposable user profile is missing, not local, or belongs to another account'
}
$inheritedLocalAppData = $env:LOCALAPPDATA
$env:USERPROFILE = $profileRoot
$env:HOMEDRIVE = [IO.Path]::GetPathRoot($profileRoot).TrimEnd('\')
$env:HOMEPATH = $profileRoot.Substring($env:HOMEDRIVE.Length)
$env:USERDOMAIN = $accountParts[0]
$env:USERNAME = $accountParts[1]
function Read-KnownFolder([Guid]$FolderId, [uint32]$Flags) {
  $pointer = [IntPtr]::Zero
  $result = [KeryxDesktopContext]::SHGetKnownFolderPath([ref]$FolderId, $Flags, [IntPtr]::Zero, [ref]$pointer)
  try {
    if ($result -ne 0 -or $pointer -eq [IntPtr]::Zero) {
      return [pscustomobject]@{ path = $null; hresult = $result }
    }
    try {
      return [pscustomobject]@{ path = [IO.Path]::GetFullPath([Runtime.InteropServices.Marshal]::PtrToStringUni($pointer)); hresult = 0 }
    } catch [ArgumentException] {
      return [pscustomobject]@{ path = $null; hresult = $result }
    }
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($pointer) }
  }
}
function Get-TargetKnownFolder([Guid]$FolderId, [string]$DefaultChild) {
  $read = Read-KnownFolder $FolderId 0x4000
  if ($read.path -and $read.path.StartsWith($profileRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    return [pscustomobject]@{ path = $read.path; fromKnownFolder = $true }
  }
  return [pscustomobject]@{ path = [IO.Path]::GetFullPath((Join-Path $profileRoot $DefaultChild)); fromKnownFolder = $false }
}
$localFolderId = [Guid]'F1B32785-6FBA-4FCF-9D55-7B8E7F157091'
$roamingFolderId = [Guid]'3EB685DB-65F9-4CF6-A03A-E3EF65729F3D'
$localFolder = Get-TargetKnownFolder $localFolderId 'AppData\Local'
$roamingFolder = Get-TargetKnownFolder $roamingFolderId 'AppData\Roaming'
$env:LOCALAPPDATA = $localFolder.path
$env:APPDATA = $roamingFolder.path
foreach ($folder in @($env:LOCALAPPDATA, $env:APPDATA)) {
  [void][IO.Directory]::CreateDirectory($folder)
  $probe = Join-Path $folder ('keryx-smoke-write-' + [guid]::NewGuid().ToString('N'))
  try { [IO.File]::WriteAllText($probe, '') }
  finally { if ([IO.File]::Exists($probe)) { [IO.File]::Delete($probe) } }
}
$localReadback = Read-KnownFolder $localFolderId 0
$roamingReadback = Read-KnownFolder $roamingFolderId 0
foreach ($readback in @($localReadback, $roamingReadback)) {
  if (-not $readback.path -or -not $readback.path.StartsWith($profileRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Windows known folder does not resolve inside the disposable user profile (HRESULT $($readback.hresult))"
  }
}
$runtimeGuid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$machineRuntime = Get-ItemPropertyValue -LiteralPath "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$runtimeGuid" -Name pv -ErrorAction SilentlyContinue
$userRuntime = Get-ItemPropertyValue -LiteralPath "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$runtimeGuid" -Name pv -ErrorAction SilentlyContinue
if ($machineRuntime -isnot [string]) { $machineRuntime = $null }
if ($userRuntime -isnot [string]) { $userRuntime = $null }
[pscustomobject]@{
  standardUserContext = $true
  sessionId = (Get-Process -Id $PID).SessionId
  administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  windowStation = Get-UserObjectName ([KeryxDesktopContext]::GetProcessWindowStation())
  desktop = Get-UserObjectName ([KeryxDesktopContext]::GetThreadDesktop([KeryxDesktopContext]::GetCurrentThreadId()))
  profileRoot = $profileRoot
  profileLocalAppData = $localFolder.path
  profileRoamingAppData = $roamingFolder.path
  actualLocalAppData = $localReadback.path
  actualRoamingAppData = $roamingReadback.path
  localFolderFromKnownFolder = $localFolder.fromKnownFolder
  roamingFolderFromKnownFolder = $roamingFolder.fromKnownFolder
  localKnownFolderReadbackInsideProfile = [bool]$localReadback.path
  roamingKnownFolderReadbackInsideProfile = [bool]$roamingReadback.path
  localKnownFolderReadbackHresult = $localReadback.hresult
  roamingKnownFolderReadbackHresult = $roamingReadback.hresult
  inheritedLocalAppData = $inheritedLocalAppData
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
