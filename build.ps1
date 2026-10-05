# 打包脚本：把 Electron 运行时 + 应用代码组装成可运行的 exe
# 注意：输出目录不要在 OneDrive / 网盘同步目录里，否则文件会变成占位符导致无法启动。
param(
  [string]$OutDir = 'C:\MCToolbox'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$zip  = Join-Path $root 'build\electron.zip'

Write-Host "[1/4] prepare output: $OutDir"
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "[2/4] extract electron runtime"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $OutDir)

Write-Host "[3/4] copy app code into resources\app"
$app = Join-Path $OutDir 'resources\app'
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item (Join-Path $root 'package.json') $app -Force
Copy-Item (Join-Path $root 'main.js') $app -Force
Copy-Item (Join-Path $root 'preload.js') $app -Force
Copy-Item (Join-Path $root 'src') $app -Recurse -Force
Copy-Item (Join-Path $root 'renderer') $app -Recurse -Force

Write-Host "[4/4] rename executable"
$exe = Join-Path $OutDir 'electron.exe'
if (Test-Path $exe) { Rename-Item $exe 'MCToolbox.exe' -Force }

$size = (Get-ChildItem $OutDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ""
Write-Host "OK. Output: $OutDir"
Write-Host ("Size: " + [math]::Round($size / 1MB, 1) + " MB")
Write-Host ("Exe : " + (Join-Path $OutDir 'MCToolbox.exe'))
Write-Host ""
Write-Host "IMPORTANT: do NOT run it from a OneDrive / cloud-sync folder."
