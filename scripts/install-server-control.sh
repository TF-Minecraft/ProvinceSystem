#!/usr/bin/env bash
# Administrator installer for the dedicated account, service and legacy cleanup.
set -euo pipefail
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
exec /usr/bin/python3 -I "$source_root/scripts/server-control-install.py"
