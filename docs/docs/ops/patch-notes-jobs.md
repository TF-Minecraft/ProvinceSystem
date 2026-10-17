# Patch note host jobs

Three systemd units on the TF server feed the patch notes on `www.tfminecraft.net`. They call www's API on
`127.0.0.1:8000` with the staff key from `/etc/tfmc/patchnotes.env` (root, mode 600, `STAFF_KEY` and
`API_BASE_URL`), and run a root-owned copy of
[`backend/src/patchnotes`](../../../backend/src/patchnotes), never the
site checkout.

| Unit | Runs | As | Sees |
| --- | --- | --- | --- |
| `tfmc-patchnotes-watch.timer` | `patchnotes.watch_plugins --once` every ten minutes | throwaway user (`DynamicUser`) | Main's `plugins` folder, read-only; state in `/var/lib/tfmc-patchnotes/` |
| `tfmc-patchnotes-weekly.timer` | `patchnotes.weekly_run` every ten minutes, offset by five | throwaway user | Main's `Backups` folder, read-only |
| `tfmc-patchnotes-rewrite.service` | `patchnotes.rewrite_worker`, always on | root | the Codex CLI and its login in `/root`; no `/home`, no Docker |

The watcher holds `CAP_DAC_READ_SEARCH` because some plugin files are `amp`'s and mode 600, so it can read any file
it can see. Its `/home` holds only the plugin folders and its `/var/lib` only its own state; the rest of the system is
read-only, with `/etc/shadow`, `/etc/ssh`, `/etc/ssl/private`, `/etc/tfmc`, the Docker socket and the logs hidden. The
weekly job has no extra rights: the backup zips are world-readable. Both time out after 30 minutes. The rewrite worker
stays root because the Codex login it uses belongs to root.

## Updating the code

The copies live in `/usr/local/lib/tfmc-patchnotes/<commit>/patchnotes/`, and `current` points at the one in use.
`site-deploy` installs a new copy after a www deploy that changes `backend/src/patchnotes/`. By hand:

```bash
sudo tfmc-patchnotes-update <full commit on main>
```

[`tfmc-patchnotes-update`](../../../scripts/patchnotes-update.py)
refuses commits that are not on `main` or have no passing **Build**, and commits that change the updater or any of
the five unit files: install those by hand as below. It downloads the package's modules from GitHub (tests are left
out; any other file or folder in the package is refused), restarts the rewrite worker and needs it to stay up with the
same process for 20 seconds. Otherwise it puts the previous copy back, or stops the worker if there was none. The
timers pick up the new copy on their next run. It keeps the five newest copies and logs to
`/var/log/tfmc-patchnotes-update.log`; `site-deploy` also records a failed update in its own log.

## Installing

From a TFMCWeb checkout, as root:

```bash
install -m 600 /dev/null /etc/tfmc/patchnotes.env   # then set STAFF_KEY=... and API_BASE_URL=...
install -m 755 scripts/patchnotes-update.py /usr/local/sbin/tfmc-patchnotes-update
cp scripts/tfmc-patchnotes-*.service scripts/tfmc-patchnotes-*.timer /etc/systemd/system/
systemctl daemon-reload
tfmc-patchnotes-update <full commit on main>
systemctl enable --now tfmc-patchnotes-rewrite tfmc-patchnotes-watch.timer tfmc-patchnotes-weekly.timer
systemctl start tfmc-patchnotes-watch tfmc-patchnotes-weekly   # one run of each, to check
```

The account that runs `site-deploy` needs `NOPASSWD` sudo for `/usr/local/sbin/tfmc-patchnotes-update`. After a
change to the updater or a unit, repeat the `install`/`cp` lines and `systemctl daemon-reload` before updating.

Check them with `systemctl list-timers 'tfmc-patchnotes-*'` and `journalctl -u 'tfmc-patchnotes-*'`.
