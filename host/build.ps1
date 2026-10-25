# Builds dist\Paperwall.exe with the C# compiler built into Windows (.NET Framework 4.8).
# The only download is Microsoft's WebView2 SDK package from nuget.org (~9 MB, cached in host\packages).
param([string]$WebView2Version = '1.0.4258.31')
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$root = Split-Path $here -Parent
$dist = Join-Path $root 'dist'
$pkg  = Join-Path $here "packages\Microsoft.Web.WebView2.$WebView2Version"

if (-not (Test-Path $pkg)) {
    New-Item -ItemType Directory -Force (Split-Path $pkg) | Out-Null
    $zip = "$pkg.zip"
    Write-Host "Downloading Microsoft.Web.WebView2 $WebView2Version from nuget.org..."
    Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$WebView2Version" -OutFile $zip -UseBasicParsing
    Expand-Archive $zip $pkg
    Remove-Item $zip
}

$lib = Get-ChildItem (Join-Path $pkg 'lib') -Directory | Where-Object { $_.Name -like 'net4*' } | Sort-Object Name | Select-Object -First 1
if (-not $lib) { throw 'No .NET Framework build found inside the WebView2 package.' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }

New-Item -ItemType Directory -Force $dist | Out-Null

# App icons (docs/brand has the source SVGs): ink tile for the exe and light taskbars, paper tile for dark ones.
$ico = Join-Path $here 'paperwall.ico'
$icoLight = Join-Path $here 'paperwall-light.ico'

$refs = @('System.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll',
          (Join-Path $lib.FullName 'Microsoft.Web.WebView2.Core.dll'),
          (Join-Path $lib.FullName 'Microsoft.Web.WebView2.WinForms.dll')) | ForEach-Object { "/r:$_" }

& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/win32icon:$ico" "/resource:$ico,Paperwall.ico" "/resource:$icoLight,Paperwall.light.ico" "/out:$(Join-Path $dist 'Paperwall.exe')" @refs (Join-Path $here 'Paperwall.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }

Copy-Item (Join-Path $lib.FullName 'Microsoft.Web.WebView2.Core.dll'), (Join-Path $lib.FullName 'Microsoft.Web.WebView2.WinForms.dll') $dist -Force
foreach ($arch in 'win-x64', 'win-arm64', 'win-x86') {
    $src = Join-Path $pkg "runtimes\$arch\native\WebView2Loader.dll"
    if (Test-Path $src) {
        $dst = Join-Path $dist "runtimes\$arch\native"
        New-Item -ItemType Directory -Force $dst | Out-Null
        Copy-Item $src $dst -Force
    }
}
$web = Join-Path $dist 'web'
if (Test-Path $web) { Remove-Item $web -Recurse -Force }
Copy-Item (Join-Path $root 'web') $web -Recurse
Get-ChildItem $web -Filter '_*' | Remove-Item -Force
Write-Host "Built $(Join-Path $dist 'Paperwall.exe')"
