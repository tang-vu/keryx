param([Parameter(Mandatory = $true)][string]$Package)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Standard-user smoke is confined to the disposable Windows CI runner'
}
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
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
  $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$child`" -Package `"$packagePath`" -Installer `"$installerPath`" -TempRoot `"$work`" -NodePath `"$node`""
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
  if ($userCreated) { Remove-LocalUser -Name $name -ErrorAction Continue }
  if ($passed) { Remove-Item -LiteralPath $work -Recurse -Force }
  else { Write-Error "Standard-user smoke files retained at $work" -ErrorAction Continue }
}
