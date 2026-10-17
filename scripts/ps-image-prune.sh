#!/bin/bash
# Installed as root's /usr/local/sbin/ps-image-prune; run weekly.
# Keep revision images for the 30-day rollback window. Docker retains images
# referenced by containers; deployment locks protect builds and recovery.
set -euo pipefail
if [[ $(id -un) == root ]]; then exec runuser -u tfmc -- "$0" "$@"; fi
[[ $(id -un) == tfmc ]] || { echo "run as tfmc" >&2; exit 2; }
exec 8> /home/tfmc/.site-deploy-www.lock
exec 9> /home/tfmc/.site-deploy-dev.lock
flock 8
flock 9
for site in www dev; do
  docker image prune -a -f --filter "label=net.tfminecraft.site=$site" --filter 'until=720h'
done
# Clean older untagged images from before revision tags were introduced.
docker image prune -f --filter 'label=com.docker.compose.project=provincesystem'
docker image prune -f --filter 'label=com.docker.compose.project=tfmc-staging'
docker builder prune -f --filter 'until=168h'
