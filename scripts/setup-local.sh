#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_path="$project_root/.env.local"
app_port="${APP_PORT:-3000}"

umask 077
auth_secret="$(
  openssl rand -base64 48 |
    tr -d '\n' |
    tr '+/' '-_' |
    tr -d '='
)"
livekit_api_key="API$(openssl rand -hex 12)"
livekit_api_secret="$(
  openssl rand -base64 48 |
    tr -d '\n' |
    tr '+/' '-_' |
    tr -d '='
)"

printf '%s\n' \
  "APP_PORT=$app_port" \
  "MEDIA_AUTH_SECRET=$auth_secret" \
  "LIVEKIT_URL=ws://localhost:7880" \
  "LIVEKIT_INTERNAL_URL=http://livekit:7880" \
  "LIVEKIT_API_KEY=$livekit_api_key" \
  "LIVEKIT_API_SECRET=$livekit_api_secret" \
  "APP_DOMAIN=" \
  "MEDIA_DOMAIN=localhost" \
  "ACME_EMAIL=" \
  >"$env_path"
chmod 600 "$env_path"

printf 'Local configuration created: %s\n' "$env_path"
printf 'Application URL: http://localhost:%s\n' "$app_port"
