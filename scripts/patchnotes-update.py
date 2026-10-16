#!/usr/bin/python3 -I
"""Install the patch note jobs' Python package from a commit on ProvinceSystem main.

The rewrite worker runs as root because the Codex login belongs to root, so the
worker and the watch jobs run a root-owned copy of backend/src/patchnotes, never
the site checkout. Installed as root at /usr/local/sbin/tfmc-patchnotes-update:

    tfmc-patchnotes-update <40-character commit on main>

Copies live in /usr/local/lib/tfmc-patchnotes/<commit>/patchnotes, and `current`
points at the one in use. Nothing from the commit is imported or run as root
here; the worker is restarted and checked, and the previous copy is put back if
it does not stay up. A commit that changes this updater or the units is refused;
the administrator installs those by hand.
"""
import fcntl
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "TF-Minecraft/ProvinceSystem"
PACKAGE = "backend/src/patchnotes"
ROOT = Path("/usr/local/lib/tfmc-patchnotes")
CURRENT = ROOT / "current"
WORKER = "tfmc-patchnotes-rewrite.service"
KEEP = 5
STABLE = 20  # Longer than RestartSec, so a crash loop shows up as a new process.
OWNER = 0
LOCK = Path("/run/tfmc-patchnotes-update.lock")
LOG = Path("/var/log/tfmc-patchnotes-update.log")
COMMIT = re.compile(r"[0-9a-f]{40}")
MODULE = re.compile(r"[a-z_][a-z0-9_]*\.py")
REQUIRED = {"__init__.py", "rewrite_worker.py", "watch_plugins.py", "weekly_run.py"}
# Installed by the administrator; a commit that changes them needs root by hand.
PINNED = {"scripts/patchnotes-update.py": Path("/usr/local/sbin/tfmc-patchnotes-update")} | {
    f"scripts/{unit}": Path("/etc/systemd/system") / unit
    for unit in ("tfmc-patchnotes-rewrite.service", "tfmc-patchnotes-watch.service", "tfmc-patchnotes-watch.timer",
                 "tfmc-patchnotes-weekly.service", "tfmc-patchnotes-weekly.timer")}


class Refused(Exception):
    pass


def get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                   "User-Agent": "tfmc-patchnotes-update"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read((4 << 20) + 1)
    if len(data) > 4 << 20:
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


def check_pinned(commit: str):
    for name, path in PINNED.items():
        try:
            data = get(f"https://raw.githubusercontent.com/{REPO}/{commit}/{name}")
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                raise
            data = None
        if data is None or not path.is_file() or path.read_bytes() != data:
            raise Refused(f"{name} changed; install {commit[:7]} by hand as root.")


def fetch(commit: str) -> dict[str, bytes]:
    listing = json.loads(get(f"https://api.github.com/repos/{REPO}/contents/{PACKAGE}?ref={commit}"))
    names = []
    for entry in listing:
        name = entry["name"]
        if name.startswith("test_") and name.endswith(".py") and entry["type"] == "file":
            continue
        if entry["type"] != "file" or not MODULE.fullmatch(name):
            # Anything else would be left out of the copy, so the package would not match the commit.
            raise Refused(f"{PACKAGE}/{name} at {commit[:7]} is not a module this updater installs.")
        names.append(name)
    if missing := REQUIRED - set(names):
        raise Refused(f"{PACKAGE} at {commit[:7]} is missing {', '.join(sorted(missing))}.")
    files = {name: get(f"https://raw.githubusercontent.com/{REPO}/{commit}/{PACKAGE}/{name}") for name in sorted(names)}
    for name, data in files.items():
        try:
            # Compile only; nothing from the commit is imported or run as root.
            compile(data, name, "exec", dont_inherit=True)
        except (SyntaxError, ValueError) as exc:
            raise Refused(f"{name} does not compile: {exc}") from None
    return files


def check_root():
    ROOT.mkdir(mode=0o755, parents=True, exist_ok=True)
    info = ROOT.lstat()
    if not ROOT.is_dir() or ROOT.is_symlink() or info.st_uid != OWNER or info.st_mode & 0o022:
        raise Refused(f"{ROOT} must be a root-owned folder that only root can write.")


def installed_commit() -> str:
    return CURRENT.resolve().name if CURRENT.is_symlink() else ""


def unpack(commit: str, files: dict[str, bytes]) -> Path:
    target = ROOT / commit
    staging = ROOT / f".new-{commit}"
    shutil.rmtree(staging, ignore_errors=True)
    package = staging / "patchnotes"
    package.mkdir(mode=0o755, parents=True)
    for name, data in files.items():
        (package / name).write_bytes(data)
        os.chmod(package / name, 0o644)
    shutil.rmtree(target, ignore_errors=True)
    os.replace(staging, target)
    return target


def point_at(commit: str):
    link = ROOT / ".current-new"
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(commit)
    os.replace(link, CURRENT)


def worker_state() -> tuple[str, str]:
    result = subprocess.run(["systemctl", "show", WORKER, "-p", "ActiveState", "-p", "MainPID"],
                            capture_output=True, text=True, timeout=30)
    values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    return values.get("ActiveState", ""), values.get("MainPID", "0")


def worker_up() -> bool:
    """Restart the worker; it must stay active with one process for STABLE seconds."""
    subprocess.run(["systemctl", "restart", WORKER], timeout=120, check=False)
    first = None
    for poll in range(STABLE // 2 + 1):
        if poll:
            time.sleep(2)
        state, pid = worker_state()
        if state != "active" or pid in ("", "0") or first not in (None, pid):
            return False
        first = pid
    return True


def prune():
    keep = {installed_commit()}
    copies = sorted((p for p in ROOT.iterdir() if COMMIT.fullmatch(p.name)), key=lambda p: p.stat().st_mtime)
    for path in copies[:-KEEP]:
        if path.name not in keep:
            shutil.rmtree(path, ignore_errors=True)


def log(line: str):
    line = " ".join(line.split())
    with LOG.open("a") as handle:
        handle.write(time.strftime("%Y-%m-%dT%H:%M:%SZ ", time.gmtime()) + f"uid={os.getenv('SUDO_UID', '0')} {line}\n")


def checked_up() -> bool:
    try:
        return worker_up()
    except BaseException:  # A systemctl timeout counts as a failed start.
        return False


def switch(commit: str, previous: str) -> str:
    point_at(commit)
    if checked_up():
        prune()
        return f"Installed {commit[:7]} (was {previous[:7] or 'nothing'}). The rewrite worker is running."
    try:
        if previous:
            point_at(previous)
            state = "the previous copy is running again" if checked_up() else "the previous copy did not start either; check journalctl"
        else:
            # Stop first, so Restart=always never loops on a missing copy.
            subprocess.run(["systemctl", "stop", WORKER], timeout=120, check=False)
            CURRENT.unlink(missing_ok=True)
            state = "there was no previous copy, so the worker is stopped"
    finally:
        shutil.rmtree(ROOT / commit, ignore_errors=True)
    raise Refused(f"The rewrite worker did not stay up on {commit[:7]}, and {state}.")


def update(commit: str) -> str:
    previous = installed_commit()
    if previous == commit:
        return f"{commit[:7]} is already installed."
    check_root()
    check_commit(commit)
    check_pinned(commit)
    files = fetch(commit)
    unpack(commit, files)
    # A dropped SSH session or Ctrl-C must not leave an unchecked copy in use.
    blocked = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGHUP, signal.SIGTERM})
    try:
        return switch(commit, previous)
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, blocked)


def main(argv: list[str]) -> int:
    if os.geteuid() != 0:
        raise SystemExit("Run with sudo.")
    if len(argv) != 1 or not COMMIT.fullmatch(argv[0]):
        raise SystemExit("Usage: tfmc-patchnotes-update <40-character commit on main>")
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
            print(f"Could not finish the update: {exc}", file=sys.stderr)
            return 1
        log(f"{commit}: {result}")
        print(result)
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
