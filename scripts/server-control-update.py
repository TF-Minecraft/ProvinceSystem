#!/usr/bin/python3 -I
"""Install the control helper's Python modules from a commit on TFMCWeb main.

The host administrator installs this file once as root, and sudoers lets the
deployment account run it. It only replaces the modules that run as the
unprivileged service account and never imports or runs code from the commit
as root. It refuses commits that change the service unit or this updater;
those still need the administrator.

    tfmc-server-control-update <40-character commit on main>
"""
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = "TF-Minecraft/TFMCWeb"
SERVICE = "tfmc-server-control.service"
CODE = Path("/usr/local/lib/tfmc-server-control")
SERVERS = CODE / "backend/src/servers"
RECORD = CODE / "SOURCE.json"
STATE_JOBS = Path("/var/lib/tfmc-server-control/state/jobs.json")
BACKUPS = Path("/var/backups/tfmc-server-control")
KEEP_BACKUPS = 10
LOCK = Path("/run/tfmc-server-control-update.lock")
LOG = Path("/var/log/tfmc-server-control-update.log")
SOCKETS = {Path("/run/tfmc-server-control/www/control.sock"): ["dev", "main"],
           Path("/run/tfmc-server-control/dev/control.sock"): ["dev"]}
MODULES = ("__init__.py", "control.py", "host.py", "inventory.py")
# Installed by the administrator; a commit that changes them needs root.
PINNED = {"scripts/tfmc-server-control.service": Path("/etc/systemd/system/tfmc-server-control.service"),
          "scripts/server-control-update.py": Path("/usr/local/sbin/tfmc-server-control-update")}
ACTIVE = {"countdown", "installing", "restarting", "checking", "reopening"}
COMMIT = re.compile(r"[0-9a-f]{40}")


class Refused(Exception):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                   "User-Agent": "tfmc-server-control-update"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read((8 << 20) + 1)
    if len(data) > 8 << 20:
        raise Refused(f"{url} is unexpectedly large.")
    return data


def check_commit(commit: str):
    """The commit must be on the main branch and its push Build must have passed."""
    head = json.loads(get(f"https://api.github.com/repos/{REPO}/branches/main"))["commit"]["sha"]
    compare = json.loads(get(f"https://api.github.com/repos/{REPO}/compare/{head}...{commit}"))
    if compare.get("merge_base_commit", {}).get("sha") != commit:
        raise Refused(f"{commit[:7]} is not on {REPO} main.")
    runs = json.loads(get(f"https://api.github.com/repos/{REPO}/actions/workflows/build.yml/runs"
                          f"?head_sha={commit}&event=push&branch=main&status=success"))
    if not runs.get("total_count"):
        raise Refused(f"{commit[:7]} has no passing Build run on main yet.")


def fetch(commit: str, names) -> dict[str, bytes]:
    return {name: get(f"https://raw.githubusercontent.com/{REPO}/{commit}/{name}") for name in names}


def modules_of(files: dict[str, bytes]) -> dict[str, bytes]:
    return {m: files[f"backend/src/servers/{m}"] for m in MODULES}


def installed() -> dict[str, bytes]:
    return {m: (SERVERS / m).read_bytes() for m in MODULES}


def check_scope(files: dict[str, bytes], commit: str):
    for name, path in PINNED.items():
        if sha256(files[name]) != sha256(path.read_bytes()):
            raise Refused(f"{name} changed; the administrator must install {commit[:7]}.")
    for module, data in modules_of(files).items():
        try:
            # Compile only; nothing from the commit is imported or run as root.
            compile(data, module, "exec", dont_inherit=True)
        except (SyntaxError, ValueError) as exc:
            raise Refused(f"{module} does not compile: {exc}") from None


def status(path: Path) -> dict:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(10)
        connection.connect(str(path))
        connection.sendall(b'{"operation":"status"}\n')
        with connection.makefile("rb") as stream:
            result = json.loads(stream.readline(1 << 20))
    if not isinstance(result, dict) or "jobs" not in result:
        raise RuntimeError("unexpected status reply")
    return result


def running() -> bool:
    return subprocess.run(["systemctl", "is-active", "--quiet", SERVICE], timeout=30).returncode == 0


def check_idle():
    if running():
        jobs = status(next(iter(SOCKETS)))["jobs"]
    else:
        jobs = list(json.loads(STATE_JOBS.read_text()).values()) if STATE_JOBS.exists() else []
    busy = [f"{job['server']} {job['phase']}" for job in jobs if job["phase"] in ACTIVE]
    if busy:
        raise Refused("A restart is running (" + ", ".join(busy) + "). Try again when it finishes.")


def healthy() -> bool:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            if running() and all(sorted(status(path).get("allowed_servers", [])) == scope for path, scope in SOCKETS.items()):
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def write(path: Path, data: bytes):
    temporary = path.with_name(f".{path.name}.update")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)


def put(modules: dict[str, bytes]):
    for module, data in modules.items():
        write(SERVERS / module, data)
    subprocess.run(["systemctl", "restart", SERVICE], timeout=60, check=False)


def prune_backups():
    old = sorted(BACKUPS.glob("update-*"), key=lambda p: p.stat().st_mtime)[:-KEEP_BACKUPS]
    for path in old:
        shutil.rmtree(path, ignore_errors=True)


def install(files: dict[str, bytes], commit: str, previous: str) -> str:
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix=f"update-{previous[:7]}-", dir=BACKUPS))
    before = installed()
    for module, data in before.items():
        (backup / module).write_bytes(data)
    check_idle()  # Again, as close to the restart as possible.
    # A dropped SSH session or Ctrl-C must not leave half the modules replaced.
    blocked = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGHUP, signal.SIGTERM})
    try:
        try:
            put(modules_of(files))
            ok = healthy()
        except BaseException:
            ok = False
        if ok:
            write(RECORD, json.dumps({"commit": commit, "installed_at": int(time.time())}).encode())
            prune_backups()
            return str(backup)
        put(before)
        restored = "the previous version is running again" if healthy() else "restoring the previous version also failed; check journalctl"
        raise Refused(f"The helper did not come back after the update, and {restored}. Backup: {backup}")
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, blocked)


def log(line: str):
    line = " ".join(line.split())
    with LOG.open("a") as handle:
        handle.write(time.strftime("%Y-%m-%dT%H:%M:%SZ ", time.gmtime()) + f"uid={os.getenv('SUDO_UID', '0')} {line}\n")


def update(commit: str) -> str:
    check_commit(commit)
    files = fetch(commit, [f"backend/src/servers/{m}" for m in MODULES] + list(PINNED))
    check_scope(files, commit)
    previous = json.loads(RECORD.read_text())["commit"] if RECORD.exists() else "unknown"
    if installed() == modules_of(files):
        if previous != commit:
            write(RECORD, json.dumps({"commit": commit, "installed_at": int(time.time())}).encode())
        return f"{commit[:7]} is already installed."
    check_idle()
    backup = install(files, commit, previous)
    return f"Installed {commit[:7]} (was {previous[:7]}). Both sockets answer. Backup: {backup}"


def main(argv: list[str]) -> int:
    if os.geteuid() != 0:
        raise SystemExit("Run with sudo.")
    if len(argv) != 1 or not COMMIT.fullmatch(argv[0]):
        raise SystemExit("Usage: tfmc-server-control-update <40-character commit on main>")
    commit = argv[0]
    os.umask(0o022)
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd) as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Another update is running.") from None
        try:
            result = update(commit)
        except Refused as exc:
            log(f"refused {commit}: {exc}")
            print(exc, file=sys.stderr)
            return 1
        except Exception as exc:
            log(f"failed {commit}: {exc!r}")
            print(f"Could not finish the check: {exc}", file=sys.stderr)
            return 1
        log(f"{commit}: {result}")
        print(result)
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
