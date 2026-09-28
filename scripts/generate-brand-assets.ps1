param(
  [string]$SourcePath = 'assets/brand/paperfund-mark.png'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$workspace = (Resolve-Path '.').Path
$source = (Resolve-Path -LiteralPath $SourcePath).Path
if (-not $source.StartsWith($workspace)) { throw 'Brand source must be inside the repository.' }

$extensionIcons = Join-Path $workspace 'apps\extension\public\icons'
$webPublic = Join-Path $workspace 'apps\web\public'
$storeAssets = Join-Path $workspace 'assets\chrome-web-store'
New-Item -ItemType Directory -Force -Path $extensionIcons, $webPublic, $storeAssets | Out-Null

function New-Canvas([int]$width, [int]$height, [System.Drawing.Color]$color) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear($color)
  $graphics.Dispose()
  return $bitmap
}

function Draw-Contained(
  [System.Drawing.Bitmap]$canvas,
  [System.Drawing.Image]$image,
  [int]$padding,
  [bool]$whiteTile = $false
) {
  $availableWidth = $canvas.Width - (2 * $padding)
  $availableHeight = $canvas.Height - (2 * $padding)
  $scale = [Math]::Min($availableWidth / $image.Width, $availableHeight / $image.Height)
  $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
  $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
  $x = [int](($canvas.Width - $width) / 2)
  $y = [int](($canvas.Height - $height) / 2)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($whiteTile) {
    $graphics.FillRectangle([System.Drawing.Brushes]::White, $x, $y, $width, $height)
  }
  $graphics.DrawImage($image, $x, $y, $width, $height)
  $graphics.Dispose()
}

function Save-Png([System.Drawing.Bitmap]$bitmap, [string]$path) {
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

$approved = [System.Drawing.Bitmap]::FromFile($source)
try {
  foreach ($size in 16, 32, 48, 128) {
    $canvas = New-Canvas $size $size ([System.Drawing.Color]::Transparent)
    $padding = if ($size -eq 128) { 16 } else { [Math]::Max(1, [int]($size / 16)) }
    Draw-Contained $canvas $approved $padding $true
    Save-Png $canvas (Join-Path $extensionIcons "paperfund-$size.png")
  }

  $uiMark = New-Canvas 512 512 ([System.Drawing.Color]::White)
  Draw-Contained $uiMark $approved 0 $false
  Save-Png $uiMark (Join-Path $extensionIcons 'paperfund-mark.png')
  Copy-Item -LiteralPath (Join-Path $extensionIcons 'paperfund-mark.png') -Destination (Join-Path $webPublic 'paperfund-mark.png') -Force
  Copy-Item -LiteralPath (Join-Path $extensionIcons 'paperfund-48.png') -Destination (Join-Path $webPublic 'favicon-48.png') -Force
  Copy-Item -LiteralPath (Join-Path $extensionIcons 'paperfund-128.png') -Destination (Join-Path $storeAssets 'icon-128.png') -Force

  foreach ($asset in @(
    @{ Name = 'small-promo-440x280.png'; Width = 440; Height = 280; Mark = 196 },
    @{ Name = 'marquee-1400x560.png'; Width = 1400; Height = 560; Mark = 392 }
  )) {
    $canvas = New-Canvas $asset.Width $asset.Height ([System.Drawing.Color]::FromArgb(255, 9, 13, 15))
    $mark = New-Canvas $asset.Mark $asset.Mark ([System.Drawing.Color]::White)
    Draw-Contained $mark $approved 0 $false
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $x = [int](($asset.Width - $asset.Mark) / 2)
    $y = [int](($asset.Height - $asset.Mark) / 2)
    $graphics.DrawImage($mark, $x, $y, $asset.Mark, $asset.Mark)
    $graphics.Dispose()
    $mark.Dispose()
    Save-Png $canvas (Join-Path $storeAssets $asset.Name)
  }
} finally {
  $approved.Dispose()
}

Write-Output 'Generated exact-source Paperfund browser and Chrome Web Store assets.'
