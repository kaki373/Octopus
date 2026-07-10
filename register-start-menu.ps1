$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronExe = Join-Path $appDir 'node_modules\electron\dist\electron.exe'
$rendererIndex = Join-Path $appDir 'dist\index.html'
$mainEntry = Join-Path $appDir 'dist-electron\main.js'
$iconPath = Join-Path $appDir 'assets\octopus.ico'
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$shortcutPath = Join-Path $startMenuDir 'Octopus.lnk'
$legacyShortcutPath = Join-Path $startMenuDir 'Desktop Media Viewer.lnk'

if (-not (Test-Path -LiteralPath $electronExe)) {
  throw "Electron runtime was not found. Run 'npm install' in $appDir first."
}

if (-not (Test-Path -LiteralPath $rendererIndex) -or -not (Test-Path -LiteralPath $mainEntry)) {
  throw "Built files were not found. Run 'npm run build' in $appDir first."
}

if (-not (Test-Path -LiteralPath $iconPath)) {
  throw "App icon was not found: $iconPath"
}

New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null

if (Test-Path -LiteralPath $legacyShortcutPath) {
  Remove-Item -LiteralPath $legacyShortcutPath -Force
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electronExe
$shortcut.Arguments = '"' + $appDir + '"'
$shortcut.WorkingDirectory = $appDir
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Octopus - every media viewer'
$shortcut.Save()

Write-Host "Created Start Menu shortcut:"
Write-Host $shortcutPath
