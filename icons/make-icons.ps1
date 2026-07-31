# Regenerates icons/icon16.png, icon48.png, icon128.png for Nightfall.
# PowerShell 5.1 + System.Drawing. Run:  powershell -ExecutionPolicy Bypass -File icons\make-icons.ps1
#
# Design: transparent background, filled deep-indigo disc (30,27,75) with a pale
# amber crescent (253,230,138) built as a circle Region minus an offset circle.
# GDI+ FillRegion is always aliased, so each icon is drawn at 4x and downsampled
# with HighQualityBicubic to get clean anti-aliased edges.

Add-Type -AssemblyName System.Drawing

$outDir = $PSScriptRoot
if (-not $outDir) { $outDir = (Get-Location).Path }

$indigo = [System.Drawing.Color]::FromArgb(255, 30, 27, 75)
$amber = [System.Drawing.Color]::FromArgb(255, 253, 230, 138)
$scale = 4

foreach ($size in 16, 48, 128) {
    $big = $size * $scale

    $canvas = New-Object System.Drawing.Bitmap($big, $big, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Disc
    $disc = New-Object System.Drawing.SolidBrush($indigo)
    $g.FillEllipse($disc, 0.0, 0.0, [float]($big - 1), [float]($big - 1))

    # Crescent: circle minus a same-size circle offset up and to the right.
    $r = $big * 0.30
    $cx = $big * 0.46
    $cy = $big * 0.50
    $dx = $big * 0.14
    $dy = $big * -0.06

    $outer = New-Object System.Drawing.Drawing2D.GraphicsPath
    $outer.AddEllipse([float]($cx - $r), [float]($cy - $r), [float]($r * 2), [float]($r * 2))
    $cut = New-Object System.Drawing.Drawing2D.GraphicsPath
    $cut.AddEllipse([float]($cx - $r + $dx), [float]($cy - $r + $dy), [float]($r * 2), [float]($r * 2))

    $region = New-Object System.Drawing.Region($outer)
    $region.Exclude($cut)
    $moon = New-Object System.Drawing.SolidBrush($amber)
    $g.FillRegion($moon, $region)

    # Downsample to the target size.
    $icon = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g2 = [System.Drawing.Graphics]::FromImage($icon)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g2.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g2.Clear([System.Drawing.Color]::Transparent)
    $g2.DrawImage($canvas, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)), 0, 0, $big, $big, [System.Drawing.GraphicsUnit]::Pixel)

    $path = Join-Path $outDir ("icon{0}.png" -f $size)
    $icon.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host ("wrote {0}" -f $path)

    $moon.Dispose()
    $region.Dispose()
    $cut.Dispose()
    $outer.Dispose()
    $disc.Dispose()
    $g2.Dispose()
    $icon.Dispose()
    $g.Dispose()
    $canvas.Dispose()
}
