#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

docker compose \
  --env-file .env.local \
  -f docker-compose.yml \
  -f docker-compose.quick.yml \
  rm -f -s quick-tunnel quick-gateway

printf 'Quick Tunnel stopped. Local application and media relay remain running.\n'
