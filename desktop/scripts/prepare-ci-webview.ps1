$ErrorActionPreference = "Stop"

# Qualify the runtime observed in failed native CI, rather than silently using
# an older runner image. This is a CI fixture floor, not an app requirement.
$minimum = [version]"156.0.4314.50"

function Assert-HostedWebViewRunner([hashtable]$Context) {
  if ($Context.actions -cne "true" -or $Context.environment -cne "github-hosted" -or
      $Context.os -cne "Windows" -or $Context.arch -cne "X64" -or
      $Context.repository -cne "tang-vu/keryx" -or
      $Context.elevated -isnot [bool] -or $Context.elevated -ne $true) {
    throw "WebView2 fixture preparation requires an elevated disposable Keryx GitHub-hosted Windows X64 runner"
  }
}

function Convert-WebViewVersion($Value) {
  if ($null -eq $Value -or $Value -eq "") { return [version]"0.0.0.0" }
  if ($Value -isnot [string] -or $Value -cnotmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "Unexpected WebView2 runtime version"
  }
  return [version]$Value
}

function Get-MachineWebViewVersion {
  $client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  $versions = foreach ($base in @('HKLM:\SOFTWARE\WOW6432Node', 'HKLM:\SOFTWARE')) {
    $key = "$base\Microsoft\EdgeUpdate\Clients\$client"
    $value = if (Test-Path -LiteralPath $key) { (Get-ItemProperty -LiteralPath $key -ErrorAction Stop).pv } else { $null }
    Convert-WebViewVersion $value
  }
  return ($versions | Sort-Object -Descending | Select-Object -First 1)
}

function Assert-MicrosoftWebViewInstaller($Signature) {
  if ($Signature.Status -ne 'Valid' -or $null -eq $Signature.SignerCertificate -or
      $Signature.SignerCertificate.Subject -cnotmatch '(^|, )O=Microsoft Corporation(,|$)') {
    throw "WebView2 installer must have a valid Microsoft Corporation signature"
  }
}

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
Assert-HostedWebViewRunner @{
  actions = $env:GITHUB_ACTIONS; environment = $env:RUNNER_ENVIRONMENT
  os = $env:RUNNER_OS; arch = $env:RUNNER_ARCH; repository = $env:GITHUB_REPOSITORY
  elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
$before = Get-MachineWebViewVersion
if ($before -ge $minimum) {
  @{ webView2Fixture = 'ready'; minimum = "$minimum"; before = "$before"; after = "$before"; installed = $false } | ConvertTo-Json -Compress
  return
}

if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or -not [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) {
  throw "Hosted runner temporary directory must be absolute"
}
$directory = Join-Path $env:RUNNER_TEMP ("keryx-webview2-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null
$installer = Join-Path $directory 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
# Microsoft's Evergreen standalone X64 installer; no runtime downgrade or policy edit.
Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/?linkid=2124701' -OutFile $installer -TimeoutSec 120 -MaximumRedirection 5
$file = Get-Item -LiteralPath $installer
if ($file.Length -lt 1MB -or $file.Length -gt 350MB) { throw "Unexpected WebView2 installer size" }
$signature = Get-AuthenticodeSignature -LiteralPath $installer
Assert-MicrosoftWebViewInstaller $signature
@{ webView2Fixture = 'installing'; minimum = "$minimum"; before = "$before"; installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant(); publisher = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress
$ownedInstaller = Start-Process -FilePath $installer -ArgumentList @('/silent', '/install') -WindowStyle Hidden -PassThru
if (-not $ownedInstaller.WaitForExit(300000)) {
  $ownedInstaller.Kill($true)
  throw "Owned WebView2 installer exceeded five minutes"
}
if ($ownedInstaller.ExitCode -ne 0) { throw "WebView2 installer failed with exit code $($ownedInstaller.ExitCode)" }
$after = Get-MachineWebViewVersion
if ($after -lt $minimum) { throw "WebView2 fixture runtime $after is older than observed regression baseline $minimum" }
@{ webView2Fixture = 'ready'; minimum = "$minimum"; before = "$before"; after = "$after"; installed = $true } | ConvertTo-Json -Compress
