#!/usr/bin/python3 -I
"""Install the patch note jobs' Python package from a commit on ProvinceSystem main.

The rewrite worker runs as root because the Codex login belongs to root, so the
worker and the watch jobs run a root-owned copy of backend/src/patchnotes, never
the site checkout. Installed as root at /usr/local/sbin/tfmc-patchnotes-update:

    tfmc-patchnotes-update <40-character commit on main>

Copies live in /usr/local/lib/tfmc-patchnotes/<commit>/patchnotes, and `current`
points at the one in use. Nothing from the commit is imported or run as root
here; the worker is restarted and checked, and the previous copy is put back if
it does not stay up.
"""
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = "TF-Minecraft/ProvinceSystem"
PACKAGE = "backend/src/patchnotes"
ROOT = Path("/usr/local/lib/tfmc-patchnotes")
CURRENT = ROOT / "current"
WORKER = "tfmc-patchnotes-rewrite.service"
KEEP = 5
LOCK = Path("/run/tfmc-patchnotes-update.lock")
LOG = Path("/var/log/tfmc-patchnotes-update.log")
COMMIT = re.compile(r"[0-9a-f]{40}")
MODULE = re.compile(r"[a-z_][a-z0-9_]*\.py")


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


def fetch(commit: str) -> dict[str, bytes]:
    listing = json.loads(get(f"https://api.github.com/repos/{REPO}/contents/{PACKAGE}?ref={commit}"))
    names = sorted(entry["name"] for entry in listing
                   if entry["type"] == "file" and MODULE.fullmatch(entry["name"])
                   and not entry["name"].startswith("test_"))
    if "__init__.py" not in names or "rewrite_worker.py" not in names:
        raise Refused(f"{PACKAGE} at {commit[:7]} is missing its package files.")
    files = {name: get(f"https://raw.githubusercontent.com/{REPO}/{commit}/{PACKAGE}/{name}") for name in names}
    for name, data in files.items():
        try:
            # Compile only; nothing from the commit is imported or run as root.
            compile(data, name, "exec", dont_inherit=True)
        except (SyntaxError, ValueError) as exc:
            raise Refused(f"{name} does not compile: {exc}") from None
    return files


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


def worker_up() -> bool:
    subprocess.run(["systemctl", "restart", WORKER], timeout=60, check=False)
    time.sleep(5)  # Long enough for an import error to stop it.
    return subprocess.run(["systemctl", "is-active", "--quiet", WORKER], timeout=30).returncode == 0


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


def update(commit: str) -> str:
    previous = installed_commit()
    if previous == commit:
        return f"{commit[:7]} is already installed."
    check_commit(commit)
    files = fetch(commit)
    ROOT.mkdir(mode=0o755, parents=True, exist_ok=True)
    unpack(commit, files)
    point_at(commit)
    if worker_up():
        prune()
        return f"Installed {commit[:7]} (was {previous[:7] or 'nothing'}). The rewrite worker is running."
    if previous:
        point_at(previous)
        state = "the previous copy is running again" if worker_up() else "the previous copy did not start either; check journalctl"
    else:
        state = "there was no previous copy to put back"
    raise Refused(f"The rewrite worker did not stay up on {commit[:7]}, and {state}.")


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
