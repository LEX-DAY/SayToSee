$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Test-Path -LiteralPath ".env.local")) {
  & (Join-Path $PSScriptRoot "setup-local.ps1")
}

docker compose --env-file .env.local up -d --build
if ($LASTEXITCODE -ne 0) {
  throw "Could not start SayToSee"
}

Write-Host ""
Write-Host "SayToSee is running: http://localhost:3000"
Write-Host "Stop command: npm run local:down"
