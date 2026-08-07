$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"
$composeFiles = @(
  "-f", "docker-compose.yml",
  "-f", "docker-compose.quick.yml"
)
Set-Location $projectRoot

function Read-EnvValues {
  $result = [ordered]@{}
  foreach ($line in [IO.File]::ReadAllLines($envPath)) {
    if ($line -match "^\s*([^#=\s]+)=(.*)$") {
      $result[$matches[1]] = $matches[2]
    }
  }
  return $result
}

function Save-EnvValues($values) {
  $lines = foreach ($entry in $values.GetEnumerator()) {
    "$($entry.Key)=$($entry.Value)"
  }
  [IO.File]::WriteAllLines($envPath, $lines, [Text.UTF8Encoding]::new($false))
}

function Invoke-Compose {
  & docker compose --env-file .env.local @composeFiles @args
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed: $($args -join ' ')"
  }
}

function Get-TunnelLogs {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    return (& docker logs saytosee-quick-tunnel 2>&1 | Out-String)
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

if (-not (Test-Path -LiteralPath $envPath)) {
  & (Join-Path $PSScriptRoot "setup-local.ps1")
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Engine is not available. Start Docker Desktop first."
}

$values = Read-EnvValues
if (-not $values.Contains("MEDIA_AUTH_SECRET")) {
  if ($values.Contains("LIVEKIT_API_SECRET") -and $values["LIVEKIT_API_SECRET"]) {
    $values["MEDIA_AUTH_SECRET"] = $values["LIVEKIT_API_SECRET"]
  } else {
    throw "MEDIA_AUTH_SECRET is missing. Run npm run local:setup."
  }
}
$values["RELAY_PORT"] = if ($values["RELAY_PORT"]) { $values["RELAY_PORT"] } else { "8081" }
$values["MEDIA_WS_URL"] = "ws://localhost:$($values['RELAY_PORT'])/media"
foreach ($legacyName in @(
  "LIVEKIT_URL",
  "LIVEKIT_INTERNAL_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_NODE_IP",
  "LIVEKIT_DOMAIN"
)) {
  $values.Remove($legacyName)
}
Save-EnvValues $values

$existingContainer = docker ps -a --filter "name=^/saytosee-quick-tunnel$" --format "{{.ID}}"
if (-not [string]::IsNullOrWhiteSpace($existingContainer)) {
  docker rm -f saytosee-quick-tunnel *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not replace the existing saytosee-quick-tunnel container."
  }
}

Invoke-Compose up -d --build --force-recreate relay quick-gateway quick-tunnel

$publicUrl = $null
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  $tunnelLogs = Get-TunnelLogs
  if ($tunnelLogs -match "https://[a-z0-9-]+\.trycloudflare\.com") {
    $publicUrl = $matches[0]
    break
  }
  Start-Sleep -Seconds 1
}

if ([string]::IsNullOrWhiteSpace($publicUrl)) {
  Write-Host (Get-TunnelLogs)
  throw "Cloudflare did not issue a Quick Tunnel URL within 60 seconds."
}

$publicHost = ([Uri]$publicUrl).Host
$values = Read-EnvValues
$values["MEDIA_WS_URL"] = "wss://$publicHost/media"
$values["APP_DOMAIN"] = $publicHost
$values["MEDIA_DOMAIN"] = $publicHost
Save-EnvValues $values

Invoke-Compose up -d --build --force-recreate --no-deps app

$appPort = if ($values.Contains("APP_PORT") -and $values["APP_PORT"]) {
  $values["APP_PORT"]
} else {
  "3000"
}

$localReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$appPort" -TimeoutSec 3 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
      $localReady = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $localReady) {
  throw "The application did not become ready on http://localhost:$appPort."
}

Write-Host ""
Write-Host "Quick Tunnel is ready."
Write-Host "Public application: $publicUrl"
Write-Host "Audio/video WebSocket: wss://$publicHost/media"

$legacyLiveKit = docker ps -a --filter "name=^/calltocall-livekit-1$" --format "{{.ID}}"
if (-not [string]::IsNullOrWhiteSpace($legacyLiveKit)) {
  docker rm -f calltocall-livekit-1 *> $null
}
