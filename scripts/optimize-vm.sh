#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sudo modprobe tcp_bbr
printf 'tcp_bbr\n' | sudo tee /etc/modules-load.d/saytosee-realtime.conf >/dev/null
sudo install -m 0644 \
  "$project_root/infra/99-saytosee-realtime.conf" \
  /etc/sysctl.d/99-saytosee-realtime.conf
sudo sysctl --system >/dev/null

printf 'Realtime network tuning applied.\n'
sysctl \
  net.core.rmem_max \
  net.core.wmem_max \
  net.core.netdev_max_backlog \
  net.ipv4.tcp_congestion_control
