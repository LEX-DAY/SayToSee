param(
  [string]$PublicHost = "localhost",
  [int]$AppPort = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"

function New-RandomToken([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($buffer)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$authSecret = New-RandomToken 36
$liveKitApiKey = "API" + (New-RandomToken 12)
$liveKitApiSecret = New-RandomToken 36
$liveKitUrl = if ($PublicHost -eq "localhost") {
  "ws://localhost:7880"
} else {
  "wss://$PublicHost"
}

$lines = @(
  "APP_PORT=$AppPort"
  "MEDIA_AUTH_SECRET=$authSecret"
  "LIVEKIT_URL=$liveKitUrl"
  "LIVEKIT_INTERNAL_URL=http://livekit:7880"
  "LIVEKIT_API_KEY=$liveKitApiKey"
  "LIVEKIT_API_SECRET=$liveKitApiSecret"
  "APP_DOMAIN="
  "MEDIA_DOMAIN=$PublicHost"
  "ACME_EMAIL="
)

[IO.File]::WriteAllLines($envPath, $lines, [Text.UTF8Encoding]::new($false))
Write-Host "Local configuration created: $envPath"
Write-Host "Application URL: http://localhost:$AppPort"
