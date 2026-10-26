param(
    [string]$SpotifyClientId = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot

Write-Host "phipster Windows installer" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found. Install Node.js 20 or newer, reopen PowerShell, and run this script again."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found. Reinstall Node.js with npm enabled."
}

$Major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($Major -lt 20) {
    throw "phipster requires Node.js 20 or newer. Found: $(node --version)"
}

New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot "logs") | Out-Null

$EnvPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path $EnvPath)) {
    $Template = Get-Content (Join-Path $ProjectRoot ".env.example") -Raw
    $Bytes = New-Object byte[] 32
    $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $Rng.GetBytes($Bytes)
    $Rng.Dispose()
    $AdminKey = ([BitConverter]::ToString($Bytes)).Replace("-", "").ToLowerInvariant()
    $Template = $Template.Replace("ADMIN_KEY=change-me-to-a-long-random-string", "ADMIN_KEY=$AdminKey")
    if ($SpotifyClientId) {
        $Template = $Template.Replace("VITE_SPOTIFY_CLIENT_ID=", "VITE_SPOTIFY_CLIENT_ID=$SpotifyClientId")
    }
    Set-Content -Path $EnvPath -Value $Template -Encoding UTF8
    Write-Host "Created .env with a random ADMIN_KEY." -ForegroundColor Green
} elseif ($SpotifyClientId) {
    $Text = Get-Content $EnvPath -Raw
    if ($Text -match '(?m)^VITE_SPOTIFY_CLIENT_ID=.*$') {
        $Text = [regex]::Replace($Text, '(?m)^VITE_SPOTIFY_CLIENT_ID=.*$', "VITE_SPOTIFY_CLIENT_ID=$SpotifyClientId")
    } else {
        $Text += "`r`nVITE_SPOTIFY_CLIENT_ID=$SpotifyClientId`r`n"
    }
    Set-Content -Path $EnvPath -Value $Text -Encoding UTF8
}

Write-Host "Installing dependencies..." -ForegroundColor Cyan
& npm.cmd install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Write-Host "Building phipster..." -ForegroundColor Cyan
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }

Write-Host ""
Write-Host "phipster is installed." -ForegroundColor Green
Write-Host "Cloudflare Tunnel target: http://127.0.0.1:3000"
Write-Host "Public hostname:          https://phipster.tallgin.com"
Write-Host "Start it with:            npm run win:start"
Write-Host ""
if (-not $SpotifyClientId) {
    Write-Host "Spotify is currently optional/unconfigured. To enable it, put your client ID in .env as VITE_SPOTIFY_CLIENT_ID and run: npm run build" -ForegroundColor Yellow
}
