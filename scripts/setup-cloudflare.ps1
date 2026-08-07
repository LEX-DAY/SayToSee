param(
  [Parameter(Mandatory = $true)]
  [string]$AppDomain,

  [Parameter(Mandatory = $true)]
  [string]$MediaDomain
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"

if (-not (Test-Path -LiteralPath $envPath)) {
  & (Join-Path $PSScriptRoot "setup-local.ps1")
}

if ($AppDomain -notmatch "^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$") {
  throw "AppDomain must be a hostname, for example call.example.com"
}

if ($MediaDomain -notmatch "^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$") {
  throw "MediaDomain must be a hostname, for example media.example.com"
}

$secureToken = Read-Host "Paste the Cloudflare Tunnel token" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $tunnelToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}

if ([string]::IsNullOrWhiteSpace($tunnelToken)) {
  throw "Cloudflare Tunnel token cannot be empty"
}

$values = [ordered]@{}
foreach ($line in [IO.File]::ReadAllLines($envPath)) {
  if ($line -match "^\s*([^#=\s]+)=(.*)$") {
    $values[$matches[1]] = $matches[2]
  }
}

$values["MEDIA_WS_URL"] = "wss://$MediaDomain/media"
$values["APP_DOMAIN"] = $AppDomain
$values["MEDIA_DOMAIN"] = $MediaDomain
$values["CLOUDFLARE_TUNNEL_TOKEN"] = $tunnelToken

$lines = foreach ($entry in $values.GetEnumerator()) {
  "$($entry.Key)=$($entry.Value)"
}

[IO.File]::WriteAllLines($envPath, $lines, [Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Cloudflare configuration saved to .env.local"
Write-Host "Public application: https://$AppDomain"
Write-Host "WebSocket media relay: wss://$MediaDomain/media"
Write-Host ""
Write-Host "The tunnel token was stored locally and is excluded from Git."
