# Bloom Installer for Windows
# Usage: irm https://artifacts.videodb.io/bloom/install.ps1 | iex

$ErrorActionPreference = "Stop"

$AppName = "Bloom"
$Version = "2.2.0"
$BaseUrl = "https://artifacts.videodb.io/bloom"
$ExeFile = "bloom-$Version-x64.exe"
$ExeUrl = "$BaseUrl/$ExeFile"

Write-Host ""
Write-Host "  Bloom Installer" -ForegroundColor White
Write-Host "  ----------------"
Write-Host ""

# --- Pre-flight checks ---

if ($env:OS -ne "Windows_NT") {
    Write-Host "error: This installer only supports Windows." -ForegroundColor Red
    exit 1
}

# --- Download ---

$TmpDir = Join-Path $env:TEMP "bloom-install"
if (Test-Path $TmpDir) { Remove-Item $TmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $TmpDir | Out-Null

$TmpExe = Join-Path $TmpDir $ExeFile

Write-Host "==> Downloading $ExeFile..." -ForegroundColor Blue
try {
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $ExeUrl -OutFile $TmpExe -UseBasicParsing
} catch {
    Write-Host "error: Failed to download $ExeUrl" -ForegroundColor Red
    exit 1
}

Write-Host "==> Download complete." -ForegroundColor Green

# --- Install ---

Write-Host "==> Running installer..." -ForegroundColor Blue
Start-Process -FilePath $TmpExe -Wait

# --- Cleanup ---

Write-Host "==> Cleaning up..." -ForegroundColor Blue
Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue

# --- Done ---

Write-Host ""
Write-Host "==> Bloom has been installed!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Open Bloom from the Start Menu"
Write-Host "    2. Enter your VideoDB API key (get one at https://console.videodb.io)"
Write-Host ""
