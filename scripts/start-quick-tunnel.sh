#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_path="$project_root/.env.local"
cd "$project_root"

if [[ ! -f "$env_path" ]]; then
  "$project_root/scripts/setup-local.sh"
fi

docker info >/dev/null

compose=(
  docker compose
  --env-file .env.local
  -f docker-compose.yml
  -f docker-compose.quick.yml
)

existing_container="$(
  docker ps -a \
    --filter 'name=^/saytosee-quick-tunnel$' \
    --format '{{.ID}}'
)"
if [[ -n "$existing_container" ]]; then
  docker rm -f saytosee-quick-tunnel >/dev/null
fi

"${compose[@]}" up -d --build --force-recreate \
  relay quick-gateway quick-tunnel

public_url=""
for _ in $(seq 1 60); do
  public_url="$(
    docker logs saytosee-quick-tunnel 2>&1 |
      grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' |
      head -n 1 || true
  )"
  [[ -n "$public_url" ]] && break
  sleep 1
done

if [[ -z "$public_url" ]]; then
  docker logs --tail 100 saytosee-quick-tunnel 2>&1 || true
  printf 'Cloudflare did not issue a Quick Tunnel URL within 60 seconds.\n' >&2
  exit 1
fi

public_host="${public_url#https://}"
env_tmp="$(mktemp "$project_root/.env.local.XXXXXX")"
awk -v media_url="wss://$public_host/media" -v host="$public_host" '
  BEGIN {
    seen_media = 0
    seen_app_domain = 0
    seen_media_domain = 0
  }
  /^MEDIA_WS_URL=/ {
    print "MEDIA_WS_URL=" media_url
    seen_media = 1
    next
  }
  /^APP_DOMAIN=/ {
    print "APP_DOMAIN=" host
    seen_app_domain = 1
    next
  }
  /^MEDIA_DOMAIN=/ {
    print "MEDIA_DOMAIN=" host
    seen_media_domain = 1
    next
  }
  { print }
  END {
    if (!seen_media) print "MEDIA_WS_URL=" media_url
    if (!seen_app_domain) print "APP_DOMAIN=" host
    if (!seen_media_domain) print "MEDIA_DOMAIN=" host
  }
' "$env_path" >"$env_tmp"
chmod 600 "$env_tmp"
mv -f "$env_tmp" "$env_path"

"${compose[@]}" up -d --build --force-recreate --no-deps app

app_port="$(
  awk -F= '$1 == "APP_PORT" { print $2; exit }' "$env_path"
)"
app_port="${app_port:-3000}"
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error \
    "http://127.0.0.1:$app_port" >/dev/null; then
    break
  fi
  sleep 1
done

printf '\nQuick Tunnel is ready.\n'
printf 'Public application: %s\n' "$public_url"
printf 'Audio/video WebSocket: wss://%s/media\n' "$public_host"
