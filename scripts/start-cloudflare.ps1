$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"
Set-Location $projectRoot

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Run npm run local:setup and npm run cloudflare:setup -- -AppDomain call.example.com -MediaDomain media.example.com first"
}

$required = @(
  "CLOUDFLARE_TUNNEL_TOKEN",
  "APP_DOMAIN",
  "MEDIA_DOMAIN",
  "MEDIA_WS_URL"
)

$values = @{}
foreach ($line in [IO.File]::ReadAllLines($envPath)) {
  if ($line -match "^\s*([^#=\s]+)=(.*)$") {
    $values[$matches[1]] = $matches[2]
  }
}

foreach ($name in $required) {
  if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
    throw "Missing $name in .env.local. Run npm run cloudflare:setup first."
  }
}

docker compose --env-file .env.local `
  -f docker-compose.yml `
  -f docker-compose.cloudflare.yml `
  up -d --build

if ($LASTEXITCODE -ne 0) {
  throw "Could not start SayToSee with Cloudflare Tunnel"
}

Write-Host ""
Write-Host "SayToSee and cloudflared are running."
Write-Host "Public URL: https://$($values['APP_DOMAIN'])"
Write-Host "WebSocket media: $($values['MEDIA_WS_URL'])"
Write-Host "Check connector status: docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.cloudflare.yml logs cloudflared"
