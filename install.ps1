# Installs the standalone canvas binary (no node or bun needed) on Windows.
#   irm https://raw.githubusercontent.com/hyperlab-sh/canvas/main/install.ps1 | iex
#   .\install.ps1 [-Version 0.3.0] [-Uninstall]
# Environment: CANVAS_VERSION (default: the latest release), CANVAS_HOME (default: %LOCALAPPDATA%\canvas),
# CANVAS_DOWNLOAD_BASE (default: the GitHub release). `canvas service` is not available on Windows; run `canvas serve`.
[CmdletBinding()]
param([string]$Version = $env:CANVAS_VERSION, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'hyperlab-sh/canvas'
$homeDir = if ($env:CANVAS_HOME) { $env:CANVAS_HOME } else { Join-Path $env:LOCALAPPDATA 'canvas' }
$binDir = Join-Path $homeDir 'bin'

function Remove-FromUserPath($dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $current) { return }
  $kept = ($current -split ';' | Where-Object { $_ -and ($_ -ne $dir) }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $kept, 'User')
}

if ($Uninstall) {
  Remove-FromUserPath $binDir
  if (Test-Path $homeDir) { Remove-Item -Recurse -Force $homeDir }
  Write-Output "removed $homeDir"
  return
}

if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  throw 'canvas install: only 64-bit Intel/AMD Windows is supported by the standalone binary; use the npm package (npm i -g @hyperlab.sh/canvas).'
}

if (-not $Version) {
  if ($env:CANVAS_DOWNLOAD_BASE) { throw 'canvas install: set CANVAS_VERSION when CANVAS_DOWNLOAD_BASE is set' }
  $latest = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
  $Version = $latest.tag_name
}
$Version = $Version.TrimStart('v')
$base = if ($env:CANVAS_DOWNLOAD_BASE) { $env:CANVAS_DOWNLOAD_BASE } else { "https://github.com/$repo/releases/download/v$Version" }
$archive = "canvas-$Version-windows-x64.zip"

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("canvas-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Output "downloading canvas $Version for windows-x64"
  Invoke-WebRequest "$base/$archive" -OutFile (Join-Path $tmp $archive)
  Invoke-WebRequest "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')
  $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { $_ -match "\s$([regex]::Escape($archive))$" } | Select-Object -First 1
  if (-not $line) { throw "canvas install: $archive is not listed in SHA256SUMS" }
  $expected = ($line -split '\s+')[0]
  $actual = (Get-FileHash (Join-Path $tmp $archive) -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { throw "canvas install: checksum mismatch for $archive; nothing was installed" }

  $new = Join-Path $tmp 'new'
  Expand-Archive (Join-Path $tmp $archive) -DestinationPath $new
  if (-not (Test-Path (Join-Path $new 'bin\canvas.exe'))) { throw 'canvas install: the archive has no bin\canvas.exe' }

  if (Test-Path $homeDir) { Remove-Item -Recurse -Force $homeDir }
  New-Item -ItemType Directory -Path (Split-Path $homeDir) -Force | Out-Null
  Move-Item $new $homeDir
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $binDir)) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath, $binDir | Where-Object { $_ }) -join ';'), 'User')
  Write-Output "added $binDir to your PATH; open a new terminal to use canvas"
}
Write-Output "installed canvas $Version to $homeDir"
