param([Parameter(Mandatory = $true)][string]$Package)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Standard-user smoke is confined to the disposable Windows CI runner'
}
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$revisionLines = @(& git -C $repository rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $revisionLines.Count -ne 1) {
  throw 'Cannot independently resolve the CI checkout source revision'
}
$expectedSourceCommit = $revisionLines[0].Trim()
if ($expectedSourceCommit -cnotmatch '^[a-f0-9]{40}$' -or
    ($env:GITHUB_SHA -and $expectedSourceCommit -cne $env:GITHUB_SHA)) {
  throw 'Cannot independently resolve the CI checkout source revision'
}
$packagePath = [IO.Path]::GetFullPath($Package)
$releaseRoot = [IO.Path]::GetFullPath((Split-Path -Parent $packagePath))
$installerDir = Join-Path $releaseRoot 'installer'
$installers = @(Get-ChildItem -LiteralPath $installerDir -File -Filter '*-setup.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer beside the portable package' }
$installerPath = $installers[0].FullName
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP)
$work = [IO.Path]::GetFullPath((Join-Path $runnerTemp ('keryx-standard-smoke-' + [guid]::NewGuid().ToString('N'))))
if (-not $work.StartsWith($runnerTemp.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Invalid smoke work directory'
}
$name = 'keryxstd' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$password = ConvertTo-SecureString (([guid]::NewGuid().ToString('N')) + 'aA1!') -AsPlainText -Force
$principal = "$env:COMPUTERNAME\$name"
$userCreated = $false
$passed = $false
function Save-SmokeEvidence {
  $artifactRoot = [IO.Path]::GetFullPath((Join-Path $repository '.artifacts/desktop-standard-user'))
  if (-not $artifactRoot.StartsWith($repository.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Invalid standard-user diagnostic artifact root'
  }
  $destination = Join-Path $artifactRoot ([IO.Path]::GetFileName($work))
  foreach ($directory in @((Join-Path $repository '.artifacts'), $artifactRoot)) {
    if ((Test-Path -LiteralPath $directory) -and
        ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Smoke artifact root is a reparse point'
    }
  }
  if (Test-Path -LiteralPath $destination) { throw 'Smoke diagnostic destination already exists' }
  [void][IO.Directory]::CreateDirectory($destination)
  $sources = @()
  foreach ($name in @('stdout.log', 'stderr.log')) {
    $file = Join-Path $work $name
    if (Test-Path -LiteralPath $file -PathType Leaf) { $sources += [pscustomobject]@{ source = $file; name = $name } }
  }
  $launches = @(Get-ChildItem -LiteralPath $work -Directory -Filter 'keryx-tauri-smoke-*')
  if ($launches.Count -gt 64) { throw 'Too many owned smoke launch directories' }
  foreach ($directory in $launches) {
    if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Smoke diagnostic directory is a reparse point' }
    $file = Join-Path $directory.FullName 'launch-diagnostics.json'
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      $sources += [pscustomobject]@{ source = $file; name = $directory.Name + '-launch.json' }
    }
  }
  $records = @()
  foreach ($source in $sources) {
    $file = Get-Item -LiteralPath $source.source -Force
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 8MB) {
      throw 'Smoke diagnostic original is a reparse point or exceeds its evidence bound'
    }
    $target = Join-Path $destination $source.name
    if (Test-Path -LiteralPath $target) { throw 'Smoke diagnostic destination already exists' }
    Copy-Item -LiteralPath $file.FullName -Destination $target
    $digest = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -cne $digest) { throw 'Smoke diagnostic retention changed bytes' }
    $records += [pscustomobject]@{ name = $source.name; bytes = $file.Length; sha256 = $digest.ToLowerInvariant() }
  }
  $metadata = [pscustomobject]@{
    format = 'keryx-standard-user-smoke-diagnostics-v1'
    expectedSourceCommit = $expectedSourceCommit
    capturedAtUtc = [DateTime]::UtcNow.ToString('O')
    standardUserSmokePassed = $passed
    files = @($records)
  }
  [IO.File]::WriteAllText((Join-Path $destination 'retention.json'), ($metadata | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
}
try {
  New-Item -ItemType Directory -Path $work | Out-Null
  New-LocalUser -Name $name -Password $password -AccountNeverExpires -PasswordNeverExpires | Out-Null
  $userCreated = $true
  $users = Get-LocalGroup -SID 'S-1-5-32-545'
  Add-LocalGroupMember -Group $users.Name -Member $principal
  & icacls.exe $work /grant "${principal}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not grant isolated smoke work directory' }
  $credential = [pscredential]::new($principal, $password)
  $node = (Get-Command node.exe).Source
  $child = Join-Path $PSScriptRoot 'standard-user-smoke-child.ps1'
  $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$child`" -Package `"$packagePath`" -Installer `"$installerPath`" -TempRoot `"$work`" -NodePath `"$node`" -ExpectedSourceCommit $expectedSourceCommit"
  $process = Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList $arguments `
    -Credential $credential -LoadUserProfile -WorkingDirectory $repository -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $work 'stdout.log') -RedirectStandardError (Join-Path $work 'stderr.log') `
    -PassThru -Wait
  Get-Content -LiteralPath (Join-Path $work 'stdout.log')
  if ($process.ExitCode -ne 0) {
    Get-Content -LiteralPath (Join-Path $work 'stderr.log')
    throw "Standard-user packaged smoke exited $($process.ExitCode)"
  }
  $passed = $true
} finally {
  $evidenceFailure = $null
  if (Test-Path -LiteralPath $work -PathType Container) {
    try { Save-SmokeEvidence }
    catch { $evidenceFailure = $_; Write-Error "Standard-user diagnostics were not retained: $_" -ErrorAction Continue }
  }
  if ($userCreated) { Remove-LocalUser -Name $name -ErrorAction Continue }
  if ($passed -and -not $evidenceFailure) { Remove-Item -LiteralPath $work -Recurse -Force }
  else { Write-Error "Standard-user smoke files retained at $work" -ErrorAction Continue }
  if ($passed -and $evidenceFailure) { throw $evidenceFailure }
}
