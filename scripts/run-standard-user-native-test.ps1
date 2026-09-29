param([Parameter(Mandatory = $true)][string]$TestScript)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Standard-user native test is confined to a disposable Windows CI runner'
}
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script = [IO.Path]::GetFullPath((Join-Path $repository $TestScript))
if (-not $script.StartsWith($repository.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'Invalid native test script' }
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP)
$work = [IO.Path]::GetFullPath((Join-Path $runnerTemp ('keryx-native-standard-' + [guid]::NewGuid().ToString('N'))))
if (-not $work.StartsWith($runnerTemp.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid work path' }
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
  if ($LASTEXITCODE -ne 0) { throw 'Could not grant isolated work directory' }
  $credential = [pscredential]::new($principal, $password)
  $node = (Get-Command node.exe).Source
  $child = Join-Path $PSScriptRoot 'standard-user-native-child.ps1'
  $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$child`" -TestScript `"$script`" -TempRoot `"$work`" -NodePath `"$node`""
  $process = Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList $arguments `
    -Credential $credential -LoadUserProfile -WorkingDirectory $repository -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $work 'stdout.log') -RedirectStandardError (Join-Path $work 'stderr.log') `
    -PassThru -Wait
  Get-Content -LiteralPath (Join-Path $work 'stdout.log')
  if ($process.ExitCode -ne 0) {
    Get-Content -LiteralPath (Join-Path $work 'stderr.log')
    throw "Standard-user native test exited $($process.ExitCode)"
  }
  $passed = $true
} finally {
  if ($userCreated) { Remove-LocalUser -Name $name -ErrorAction Continue }
  if ($passed) { Remove-Item -LiteralPath $work -Recurse -Force }
  else { Write-Error "Standard-user native test files retained at $work" -ErrorAction Continue }
}
