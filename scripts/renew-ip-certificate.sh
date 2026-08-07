#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm --pull=always \
  -v "$project_root/certbot/conf:/etc/letsencrypt" \
  -v "$project_root/certbot/www:/var/www/certbot" \
  certbot/certbot:latest \
  renew --preferred-profile shortlived --non-interactive --no-random-sleep-on-renew

mapfile -t caddy_containers < <(
  docker ps -q \
    --filter "status=running" \
    --filter "label=com.docker.compose.service=caddy"
)

if [[ "${#caddy_containers[@]}" -ne 1 ]]; then
  printf 'Expected one running Caddy container, found %d\n' "${#caddy_containers[@]}" >&2
  exit 1
fi

# Caddy keeps manually configured certificates in memory. A container restart
# is required after Certbot replaces the files; a config reload may retain the
# previous certificate until it expires.
docker restart "${caddy_containers[0]}" >/dev/null
