#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_path="$project_root/.env.local"
public_ip="${PUBLIC_IP:-${1:-}}"

if [[ -z "$public_ip" ]]; then
  printf 'Usage: PUBLIC_IP=203.0.113.10 %s\n' "$0" >&2
  exit 1
fi

random_secret() {
  openssl rand -base64 48 |
    tr -d '\n' |
    tr '+/' '-_' |
    tr -d '='
}

umask 077
meeting_auth_secret="$(random_secret)"
livekit_api_key="API$(openssl rand -hex 12)"
livekit_api_secret="$(random_secret)"

printf '%s\n' \
  "APP_PORT=3000" \
  "APP_PUBLIC_URL=https://$public_ip" \
  "MEDIA_AUTH_SECRET=$meeting_auth_secret" \
  "LIVEKIT_URL=wss://$public_ip" \
  "LIVEKIT_INTERNAL_URL=http://127.0.0.1:7880" \
  "LIVEKIT_BIND_ADDRESS=127.0.0.1" \
  "LIVEKIT_USE_EXTERNAL_IP=false" \
  "LIVEKIT_NODE_IP=$public_ip" \
  "LIVEKIT_API_KEY=$livekit_api_key" \
  "LIVEKIT_API_SECRET=$livekit_api_secret" \
  "PUBLIC_IP=$public_ip" \
  "APP_DOMAIN=$public_ip" \
  "MEDIA_DOMAIN=$public_ip" \
  "ACME_EMAIL=" \
  >"$env_path"
chmod 600 "$env_path"

printf 'VM configuration created: %s\n' "$env_path"
printf 'Application URL: https://%s\n' "$public_ip"
