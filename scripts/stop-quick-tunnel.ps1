$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

docker compose --env-file .env.local `
  -f docker-compose.yml `
  -f docker-compose.quick.yml `
  rm -f -s quick-tunnel quick-gateway

if ($LASTEXITCODE -ne 0) {
  throw "Could not stop the Quick Tunnel."
}

Write-Host "Quick Tunnel stopped. The local application and media relay remain running."
