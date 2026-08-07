param(
    [string]$Source = "../frontend/src/assets/saytosee-mark.png",
    [string]$Destination = "appicon.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$buildDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = [IO.Path]::GetFullPath((Join-Path $buildDirectory $Source))
$destinationPath = [IO.Path]::GetFullPath((Join-Path $buildDirectory $Destination))
$generatedWindowsIcon = Join-Path $buildDirectory "windows/icon.ico"

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
$canvas = New-Object System.Drawing.Bitmap 1024, 1024, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$canvas.SetResolution(96, 96)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)

try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $targetWidth = 864
    $targetHeight = [int][Math]::Round($sourceImage.Height * ($targetWidth / $sourceImage.Width))
    $targetX = [int](($canvas.Width - $targetWidth) / 2)
    $targetY = [int](($canvas.Height - $targetHeight) / 2)

    $graphics.DrawImage(
        $sourceImage,
        (New-Object System.Drawing.Rectangle $targetX, $targetY, $targetWidth, $targetHeight),
        0,
        0,
        $sourceImage.Width,
        $sourceImage.Height,
        [System.Drawing.GraphicsUnit]::Pixel
    )

    $canvas.Save($destinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $graphics.Dispose()
    $canvas.Dispose()
    $sourceImage.Dispose()
}

if (Test-Path -LiteralPath $generatedWindowsIcon) {
    Remove-Item -LiteralPath $generatedWindowsIcon -Force
}

Write-Output "Generated $destinationPath"
