# Builds the app, then produces the two release zips:
#   release\Paperwall-Windows.zip    native wallpaper app (unzip and run)
#   release\Paperwall-Lively-WE.zip  web wallpaper for Lively Wallpaper / Wallpaper Engine
# One build fits every screen: Resolution "Auto" renders at the monitor's own height (up to 4K),
# and width always follows the monitor, so 21:9 / 32:9 just work.
param([string]$Version = 'dev')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem  # zips with '/' separators (Compress-Archive in PS 5.1 writes '\')
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$dist = Join-Path $root 'dist'
$out  = Join-Path $root 'release'

& (Join-Path $here 'build.ps1')

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null
$stage = Join-Path $out '_stage'

# Native app
$app = Join-Path $stage 'app'
Copy-Item $dist $app -Recurse
Copy-Item (Join-Path $root 'LICENSE') $app
@"
Paperwall $Version

1. Run Paperwall.exe. The Paperwall icon appears in the system tray.
2. Double-click the tray icon to open the Paperwall window, where you pick a theme and style
   and change every setting. Right-clicking the icon gives the same settings as a menu.
3. Start with Windows is in the window and under Options in the menu.
4. Exit (tray menu) restores your normal wallpaper.

Resolution "Auto" matches your monitor (up to 4K). Pick a lower one in the menu if your PC struggles.
Requires Windows 10/11 with the Microsoft Edge WebView2 Runtime (preinstalled on Windows 11).
Project page and docs: https://github.com/departmentofone/Paperwall
"@ | Set-Content (Join-Path $app 'README.txt') -Encoding utf8
[IO.Compression.ZipFile]::CreateFromDirectory($app, (Join-Path $out 'Paperwall-Windows.zip'))

# Lively Wallpaper / Wallpaper Engine package (web folder only, LivelyInfo.json at the root)
$web = Join-Path $stage 'web'
Copy-Item (Join-Path $root 'web') $web -Recurse
Get-ChildItem $web -Filter '_*' | Remove-Item -Recurse -Force
[IO.Compression.ZipFile]::CreateFromDirectory($web, (Join-Path $out 'Paperwall-Lively-WE.zip'))

Remove-Item $stage -Recurse -Force
Get-ChildItem $out | ForEach-Object { '{0,-45} {1,8:N0} KB' -f $_.Name, ($_.Length / 1KB) }
