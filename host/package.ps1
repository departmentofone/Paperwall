# Builds the app, then produces release zips for each resolution variant:
#   release\ShanShuiInfinite-<variant>-Windows.zip   native wallpaper app (unzip and run)
#   release\ShanShuiInfinite-<variant>-Lively-WE.zip  web wallpaper for Lively Wallpaper / Wallpaper Engine
# Variants differ only in the "Auto" render height (web\variant.js); every build can still
# switch resolution from its menu. Width always follows the monitor, so 21:9 / 32:9 just work.
param([string]$Version = 'dev')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem  # zips with '/' separators (Compress-Archive in PS 5.1 writes '\')
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$dist = Join-Path $root 'dist'
$out  = Join-Path $root 'release'

& (Join-Path $here 'build.ps1')

$variants = @(
    @{ Name = '1080p'; Height = 1080; Label = '1080p (Full HD)' },
    @{ Name = '2K';    Height = 1440; Label = '1440p (2K / QHD)' },
    @{ Name = '4K';    Height = 2160; Label = '2160p (4K / UHD)' }
)

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null
$stage = Join-Path $out '_stage'

foreach ($v in $variants) {
    $cfg = "// $($v.Label) build. autoHeight = internal render height when Resolution is 'Auto'.`r`n" +
           "window.SHANSHUI_VARIANT = { variant: '$($v.Name)', autoHeight: $($v.Height), version: '$Version' };`r`n"

    # Native app
    $app = Join-Path $stage "app-$($v.Name)"
    Copy-Item $dist $app -Recurse
    Set-Content (Join-Path $app 'web\variant.js') $cfg -Encoding utf8
    Copy-Item (Join-Path $root 'LICENSE') $app
    @"
Shan Shui Infinite+ $Version  -  $($v.Label) build

1. Run ShanShuiWallpaper.exe. A red seal icon appears in the system tray.
2. Right-click the tray icon for resolution, speed, time of day, season, weather and style.
3. Options > Start with Windows to launch it at sign-in.
4. Exit (tray menu) restores your normal wallpaper.

Requires Windows 10/11 with the Microsoft Edge WebView2 Runtime (preinstalled on Windows 11).
Project page and docs: see README.md on GitHub.
"@ | Set-Content (Join-Path $app 'README.txt') -Encoding utf8
    [IO.Compression.ZipFile]::CreateFromDirectory($app, (Join-Path $out "ShanShuiInfinite-$($v.Name)-Windows.zip"))

    # Lively Wallpaper / Wallpaper Engine package (web folder only, LivelyInfo.json at the root)
    $web = Join-Path $stage "web-$($v.Name)"
    Copy-Item (Join-Path $root 'web') $web -Recurse
    Set-Content (Join-Path $web 'variant.js') $cfg -Encoding utf8
    $info = Get-Content (Join-Path $web 'LivelyInfo.json') -Raw | ConvertFrom-Json
    $info.Title = "Shan Shui Infinite+ ($($v.Name))"
    $info | ConvertTo-Json | Set-Content (Join-Path $web 'LivelyInfo.json') -Encoding utf8
    [IO.Compression.ZipFile]::CreateFromDirectory($web, (Join-Path $out "ShanShuiInfinite-$($v.Name)-Lively-WE.zip"))
}
Remove-Item $stage -Recurse -Force
Get-ChildItem $out | ForEach-Object { '{0,-45} {1,8:N0} KB' -f $_.Name, ($_.Length / 1KB) }
