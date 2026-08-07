$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

docker compose --env-file .env.local `
  -f docker-compose.yml `
  -f docker-compose.cloudflare.yml `
  down
