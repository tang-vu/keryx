param(
  [Parameter(Mandatory = $true)][string]$Package,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$TempRoot,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$ExpectedSourceCommit,
  [switch]$Reentered
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
$env:LOCALAPPDATA = [IO.Path]::GetFullPath((Join-Path $profileRoot 'AppData\Local'))
$env:APPDATA = [IO.Path]::GetFullPath((Join-Path $profileRoot 'AppData\Roaming'))
foreach ($folder in @($env:LOCALAPPDATA, $env:APPDATA)) {
  [void][IO.Directory]::CreateDirectory($folder)
  $probe = Join-Path $folder ('keryx-smoke-write-' + [guid]::NewGuid().ToString('N'))
  try { [IO.File]::WriteAllText($probe, '') }
  finally { if ([IO.File]::Exists($probe)) { [IO.File]::Delete($probe) } }
}
if (-not $Reentered) {
  # The first PowerShell may have cached shell folders from the runner's
  # inherited environment before this script corrected it. Start exactly one
  # fresh process under the same standard-user token and corrected environment.
  $argsForChild = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    ('"' + $PSCommandPath + '"'), '-Package', ('"' + $Package + '"'),
    '-Installer', ('"' + $Installer + '"'), '-TempRoot', ('"' + $TempRoot + '"'),
    '-NodePath', ('"' + $NodePath + '"'), '-ExpectedSourceCommit', $ExpectedSourceCommit, '-Reentered')
  $start = [Diagnostics.ProcessStartInfo]::new((Get-Command powershell.exe).Source, ($argsForChild -join ' '))
  $start.WorkingDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($name in @('USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'USERDOMAIN', 'USERNAME',
      'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'KERYX_EXPECTED_SOURCE_COMMIT')) {
    $start.EnvironmentVariables[$name] = [Environment]::GetEnvironmentVariable($name)
  }
  $process = [Diagnostics.Process]::Start($start)
  try {
    $output = $process.StandardOutput.ReadToEndAsync()
    $errors = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(600000)) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
      [void]$process.WaitForExit(10000)
      throw 'Corrected-environment standard-user child timed out'
    }
    if (-not $output.Wait(10000) -or -not $errors.Wait(10000)) {
      throw 'Corrected-environment standard-user output did not close'
    }
    $childOutput = $output.Result
    $childErrors = $errors.Result
    $childExitCode = $process.ExitCode
  } finally { $process.Dispose() }
  if ($childOutput) { Write-Output $childOutput }
  if ($childExitCode -ne 0) {
    if ($childErrors) { [Console]::Error.Write($childErrors) }
    throw "Corrected-environment standard-user child exited $childExitCode"
  }
  exit 0
}
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
$localFolderId = [Guid]'F1B32785-6FBA-4FCF-9D55-7B8E7F157091'
$roamingFolderId = [Guid]'3EB685DB-65F9-4CF6-A03A-E3EF65729F3D'
$localReadback = Read-KnownFolder $localFolderId 0
$roamingReadback = Read-KnownFolder $roamingFolderId 0
function Test-TargetFolder($Readback) {
  return [bool]($Readback.path -and $Readback.path.StartsWith($profileRoot + '\', [StringComparison]::OrdinalIgnoreCase))
}
$localValid = Test-TargetFolder $localReadback
$roamingValid = Test-TargetFolder $roamingReadback
if (-not $localValid -or -not $roamingValid) {
  [pscustomobject]@{
    phase = 'corrected-environment-known-folder-refusal'
    accountSid = $identity.User.Value
    profileRoot = $profileRoot
    initialEnvironmentWasOutsideProfile = -not ($inheritedLocalAppData -and
      $inheritedLocalAppData.StartsWith($profileRoot + '\', [StringComparison]::OrdinalIgnoreCase))
    chosenLocal = $env:LOCALAPPDATA
    chosenRoaming = $env:APPDATA
    localReadbackHresult = $localReadback.hresult
    roamingReadbackHresult = $roamingReadback.hresult
    localReadbackInsideProfile = $localValid
    roamingReadbackInsideProfile = $roamingValid
  } | ConvertTo-Json -Depth 4 -Compress | Write-Output
}
foreach ($readback in @($localReadback, $roamingReadback)) {
  if (-not (Test-TargetFolder $readback)) {
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
  profileLocalAppData = $env:LOCALAPPDATA
  profileRoamingAppData = $env:APPDATA
  actualLocalAppData = $localReadback.path
  actualRoamingAppData = $roamingReadback.path
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
  $start = [Diagnostics.ProcessStartInfo]::new($Executable, ($Arguments -join ' '))
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $process = [Diagnostics.Process]::Start($start)
  try {
    if (-not $process.WaitForExit(180000)) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
      [void]$process.WaitForExit(10000)
      throw 'NSIS process timed out'
    }
    if ($process.ExitCode -ne 0) { throw "NSIS process exited $($process.ExitCode)" }
  } finally { $process.Dispose() }
}
function Get-LiteralSha256([string]$FilePath) {
  $stream = $null
  $algorithm = $null
  try {
    $stream = [IO.File]::OpenRead($FilePath)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
  } finally {
    if ($algorithm) { $algorithm.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}
$uninstaller = Join-Path $install 'uninstall.exe'
$externalUninstaller = [IO.Path]::GetFullPath((Join-Path $TempRoot 'isolated-uninstall-copy.exe'))
if (-not $externalUninstaller.StartsWith($owned, [StringComparison]::OrdinalIgnoreCase) -or
    $externalUninstaller.StartsWith($install.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $externalUninstaller.Contains(' ') -or (Test-Path -LiteralPath $externalUninstaller)) {
  throw 'Invalid isolated external uninstaller destination'
}
try {
  Invoke-BoundedInstaller $Installer @('/S', "/D=$install")
  $installedExe = Join-Path $install 'KeryxOperator.exe'
  if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw 'NSIS did not install into the isolated destination'
  }
  & $NodePath desktop/scripts/compare-tauri-packages.mjs $Package $install
  if ($LASTEXITCODE -ne 0) { throw "NSIS package identity check failed: $LASTEXITCODE" }
  & $NodePath --import tsx desktop/scripts/check-package.mjs $install
  if ($LASTEXITCODE -ne 0) { throw "Installed package identity check failed: $LASTEXITCODE" }
  & $NodePath --import tsx desktop/scripts/tauri-smoke.mjs $installedExe
  if ($LASTEXITCODE -ne 0) { throw "Installed package smoke failed: $LASTEXITCODE" }
} finally {
  if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
    # NSIS's default self-copy exits its launcher before the actual uninstall.
    # Run an exact external copy with _?= LAST so the bounded wait observes the
    # actual uninstaller, which can still delete its installed executable.
    $resolvedUninstaller = [IO.Path]::GetFullPath($uninstaller)
    if (-not $resolvedUninstaller.StartsWith($install.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not $resolvedUninstaller.StartsWith($owned, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Invalid isolated installed uninstaller source'
    }
    $verificationStage = 'copy'
    try {
      Copy-Item -LiteralPath $resolvedUninstaller -Destination $externalUninstaller -ErrorAction Stop
      $verificationStage = 'source-hash'
      $sourceHash = Get-LiteralSha256 $resolvedUninstaller
      $verificationStage = 'copy-hash'
      $copyHash = Get-LiteralSha256 $externalUninstaller
      $verificationStage = 'compare'
      if ($sourceHash -cne $copyHash) { throw 'Uninstaller copy mismatch' }
    } catch {
      $exceptionType = $_.Exception.GetType().FullName
      if ($exceptionType.Length -gt 128 -or $exceptionType -cnotmatch '^[A-Za-z0-9_.+`]+$') {
        $exceptionType = 'unclassified'
      }
      @{ isolatedUninstallerVerification = 'failed'; stage = $verificationStage;
        exceptionType = $exceptionType; hresult = [int]$_.Exception.HResult } |
        ConvertTo-Json -Compress | Write-Output
      throw 'Isolated external uninstaller copy verification failed'
    }
    Invoke-BoundedInstaller $externalUninstaller @('/S', "_?=$install")
    Remove-Item -LiteralPath $externalUninstaller -Force -ErrorAction Stop
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
  $categories = @($remaining | Select-Object -First 32 | ForEach-Object {
    if ([IO.Path]::GetFileName($_) -ceq 'KeryxOperator.exe') { 'installed-executable' }
    elseif ([IO.Path]::GetFileName($_) -ceq 'uninstall.exe') { 'installed-uninstaller' }
    elseif (Test-Path -LiteralPath $_ -PathType Container) { 'directory' }
    else { 'other-file' }
  })
  @{ isolatedUninstallFailure = 'remaining-entries'; sampledEntries = $categories } |
    ConvertTo-Json -Compress | Write-Output
  throw 'Isolated NSIS uninstall left installed files'
}
Write-Output 'Portable and isolated current-user NSIS acceptance passed'
