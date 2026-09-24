#!/bin/bash
# Scan TFMCMain plugin folders once. The staff key stays in the API container.
set -euo pipefail
cd /home/tfmc/ProvinceSystem/backend
export PYTHONPATH=src
export API_BASE_URL=http://127.0.0.1:8000
export PATCHNOTES_PLUGINS_DIR=/home/amp/.ampdata/instances/TFMCMain01/Minecraft/plugins
export PATCHNOTES_PLUGINS_STATE=/var/lib/tfmc/plugin-patchnotes.json
export STAFF_KEY
STAFF_KEY="$(docker exec provincesystem-backend-1 printenv STAFF_KEY)"
exec python3 -m patchnotes.watch_plugins --once
