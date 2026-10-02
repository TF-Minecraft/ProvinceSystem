#!/bin/bash
# Run the host rewrite agent with the API container's staff key.
set -euo pipefail
cd /home/tfmc/ProvinceSystem/backend
export PYTHONPATH=src
export API_BASE_URL=http://127.0.0.1:8000
export STAFF_KEY
STAFF_KEY="$(docker exec provincesystem-backend-1 printenv STAFF_KEY)"
export HOME=/root
export PATCHNOTES_CODEX_BIN=/root/.npm-global/bin/codex
export PATH=/root/.npm-global/bin:$PATH
exec python3 -m patchnotes.rewrite_worker "$@"
