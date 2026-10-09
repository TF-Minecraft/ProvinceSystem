#!/bin/bash
# Scan TFMCMain plugin folders once, then send the closed week's comparison
# for the Discord post if the API does not have it yet. The staff key stays
# in the API container.
set -euo pipefail
cd /home/tfmc/ProvinceSystem/backend
export PYTHONPATH=src
export API_BASE_URL=http://127.0.0.1:8000
export PATCHNOTES_PLUGINS_DIR=/home/amp/.ampdata/instances/TFMCMain01/Minecraft/plugins
export PATCHNOTES_PLUGINS_STATE=/var/lib/tfmc/plugin-patchnotes.json
export PATCHNOTES_BACKUPS_DIR=/home/amp/.ampdata/instances/TFMCMain01/Backups
export STAFF_KEY
STAFF_KEY="$(docker exec provincesystem-backend-1 printenv STAFF_KEY)"
status=0
python3 -m patchnotes.watch_plugins --once || status=$?
# Reading two backups takes a while; a slow run must not overlap the next one.
flock -n -E 0 /run/lock/tfmc-patchnotes-weekly.lock python3 -m patchnotes.weekly_run || status=$?
exit "$status"
