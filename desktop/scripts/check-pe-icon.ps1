param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$CanonicalIcon
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$file = Get-Item -LiteralPath $Executable
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($file.FullName)
if ($null -eq $icon) { throw 'Windows PE has no extractable icon' }
try {
  $bitmap = $icon.ToBitmap()
  try {
    $reference = [System.Drawing.Icon]::new($CanonicalIcon, $bitmap.Width, $bitmap.Height)
    try {
      $referenceBitmap = $reference.ToBitmap()
      try {
        if ($referenceBitmap.Width -ne $bitmap.Width -or $referenceBitmap.Height -ne $bitmap.Height) {
          throw 'Embedded icon dimensions differ from canonical icon'
        }
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
          for ($x = 0; $x -lt $bitmap.Width; $x++) {
            if ($bitmap.GetPixel($x, $y).ToArgb() -ne $referenceBitmap.GetPixel($x, $y).ToArgb()) {
              throw "Embedded PE icon differs from canonical brand at $x,$y"
            }
          }
        }
      } finally { $referenceBitmap.Dispose() }
    } finally { $reference.Dispose() }
  } finally { $bitmap.Dispose() }
} finally { $icon.Dispose() }
[pscustomobject]@{
  productName = $file.VersionInfo.ProductName
  fileDescription = $file.VersionInfo.FileDescription
  iconMatchesCanonical = $true
} | ConvertTo-Json -Compress
