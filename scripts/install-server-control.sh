#!/usr/bin/env bash
# Install the restricted host helper as ryan; website mounts are configured separately.
set -euo pipefail
[[ $(id -un) == ryan ]] || { echo 'Run as ryan on the Minecraft host.' >&2; exit 1; }
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
control_root=/home/ryan/.local/share/tfmc-server-control
if systemctl --user is-active --quiet tfmc-server-control.service; then
  echo 'The helper is already running. Check its jobs before updating it.' >&2
  exit 1
fi
install -d -m 700 "$control_root/code/backend/src/servers" /home/ryan/.config/systemd/user
for module in __init__.py inventory.py control.py host.py; do
  install -m 600 "$source_root/backend/src/servers/$module" "$control_root/code/backend/src/servers/$module"
done
install -m 600 "$source_root/scripts/tfmc-server-control.service" /home/ryan/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tfmc-server-control.service
cd "$control_root/code/backend"
python3 - <<'PY'
import os
import time
from src.servers import control

for attempt in range(50):
    ready = True
    for site in ("www", "dev"):
        os.environ["SERVER_CONTROL_SOCKET"] = f"/home/ryan/.local/share/tfmc-server-control/{site}/control.sock"
        ready = ready and control.status()["status"] == "available"
    if ready:
        break
    time.sleep(.2)
else:
    raise SystemExit("The helper did not expose both sockets. Check its user journal.")
PY
systemctl --user is-active tfmc-server-control.service
