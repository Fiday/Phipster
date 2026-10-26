$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot

$ClientIndex = Join-Path $ProjectRoot "client\dist\index.html"
$ServerEntry = Join-Path $ProjectRoot "server\dist\index.js"

if (-not (Test-Path $ClientIndex) -or -not (Test-Path $ServerEntry)) {
    Write-Host "Production build not found; building phipster first..." -ForegroundColor Yellow
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
}

Write-Host "Starting phipster on http://127.0.0.1:3000" -ForegroundColor Cyan
Write-Host "Cloudflare Tunnel should publish it as https://phipster.tallgin.com" -ForegroundColor Cyan
& node.exe $ServerEntry
exit $LASTEXITCODE
