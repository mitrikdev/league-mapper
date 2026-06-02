param(
  [int]$Scale = 1,
  [int]$MaxColors = 96
)

Add-Type -AssemblyName System.Drawing

$src = (Resolve-Path "assets\Summoner's_Rift_Minimap.png").Path
$out = (Resolve-Path "assets").Path + "\rift-map.svg"
$bmp = [System.Drawing.Bitmap]::FromFile($src)
$paths = @{}
$colorCounts = @{}

for ($y = 0; $y -lt $bmp.Height; $y++) {
  for ($x = 0; $x -lt $bmp.Width; $x++) {
    $argb = $bmp.GetPixel($x, $y).ToArgb()
    if ($colorCounts.ContainsKey($argb)) {
      $colorCounts[$argb]++
    } else {
      $colorCounts[$argb] = 1
    }
  }
}

$palette = $colorCounts.GetEnumerator() |
  Sort-Object Value -Descending |
  Select-Object -First $MaxColors |
  ForEach-Object {
    $key = [int]$_.Key
    [pscustomobject]@{
      Argb = $key
      A = ($key -shr 24) -band 255
      R = ($key -shr 16) -band 255
      G = ($key -shr 8) -band 255
      B = $key -band 255
    }
  }

$nearestCache = @{}

function Get-NearestPaletteColor {
  param(
    [int]$Argb,
    [object[]]$Palette,
    [hashtable]$Cache
  )

  if ($Cache.ContainsKey($Argb)) {
    return $Cache[$Argb]
  }

  $a = ($Argb -shr 24) -band 255
  $r = ($Argb -shr 16) -band 255
  $g = ($Argb -shr 8) -band 255
  $b = $Argb -band 255
  $best = $Palette[0].Argb
  $bestDistance = [double]::PositiveInfinity

  foreach ($candidate in $Palette) {
    $da = $a - $candidate.A
    $dr = $r - $candidate.R
    $dg = $g - $candidate.G
    $db = $b - $candidate.B
    $distance = ($da * $da * 2) + ($dr * $dr) + ($dg * $dg * 1.7) + ($db * $db)
    if ($distance -lt $bestDistance) {
      $bestDistance = $distance
      $best = $candidate.Argb
    }
  }

  $Cache[$Argb] = $best
  return $best
}

for ($y = 0; $y -lt $bmp.Height; $y++) {
  $x = 0
  while ($x -lt $bmp.Width) {
    $argb = Get-NearestPaletteColor -Argb $bmp.GetPixel($x, $y).ToArgb() -Palette $palette -Cache $nearestCache
    $start = $x
    $x++
    while ($x -lt $bmp.Width -and (Get-NearestPaletteColor -Argb $bmp.GetPixel($x, $y).ToArgb() -Palette $palette -Cache $nearestCache) -eq $argb) {
      $x++
    }

    if (-not $paths.ContainsKey($argb)) {
      $paths[$argb] = [System.Text.StringBuilder]::new()
    }

    $sx = $start * $Scale
    $sy = $y * $Scale
    $sw = ($x - $start) * $Scale
    [void]$paths[$argb].Append(('M{0} {1}h{2}v{3}h-{2}z' -f $sx, $sy, $sw, $Scale))
  }
}

$size = $bmp.Width * $Scale
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine(('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {0} {0}" shape-rendering="crispEdges" text-rendering="geometricPrecision" role="img" aria-label="Vectorized Summoner&apos;s Rift minimap">' -f $size))

foreach ($key in $paths.Keys) {
  $a = ($key -shr 24) -band 255
  $r = ($key -shr 16) -band 255
  $g = ($key -shr 8) -band 255
  $b = $key -band 255

  if ($a -eq 0) {
    continue
  }

  $hex = '#{0:x2}{1:x2}{2:x2}' -f $r, $g, $b
  $d = $paths[$key].ToString()

  if ($a -lt 255) {
    $op = [Math]::Round($a / 255, 4).ToString([Globalization.CultureInfo]::InvariantCulture)
    [void]$sb.AppendLine(('  <path fill="{0}" fill-opacity="{1}" d="{2}"/>' -f $hex, $op, $d))
  } else {
    [void]$sb.AppendLine(('  <path fill="{0}" d="{1}"/>' -f $hex, $d))
  }
}

[void]$sb.AppendLine('</svg>')
[System.IO.File]::WriteAllText($out, $sb.ToString(), [System.Text.Encoding]::UTF8)
$bmp.Dispose()

Get-Item $out | Select-Object FullName, Length
