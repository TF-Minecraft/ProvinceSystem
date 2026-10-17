#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose -f docker-compose.staging.yml down
echo "Staging stack stopped (tfmcweb-staging)."
