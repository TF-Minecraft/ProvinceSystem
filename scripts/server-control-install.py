#!/usr/bin/python3
"""Administrator cutover to a locked service account, with verified state copy."""
import hashlib
import json
import os
import pwd
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ACCOUNT = "tfmc-server-control"
CODE = Path("/usr/local/lib/tfmc-server-control")
STATE = Path("/var/lib/tfmc-server-control")
RUN = Path("/run/tfmc-server-control")
INSTANCES = Path("/home/amp/.ampdata/instances")
LEGACY = Path("/home/ryan/.local/share/tfmc-server-control")
USER_UNIT = Path("/home/ryan/.config/systemd/user/tfmc-server-control.service")
UNIT = Path("/etc/systemd/system/tfmc-server-control.service")
SUDOERS = Path("/etc/sudoers.d/tfmc-server-control")
WRAPPER = Path("/usr/local/sbin/tfmc-server-command")
BUSY = {"countdown", "installing", "restarting", "checking", "reopening", "awaiting_review"}


def command(*args, check=True):
    return subprocess.run([str(arg) for arg in args], check=check, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def user_command(*args, check=True):
    uid = pwd.getpwnam("ryan").pw_uid
    return command("runuser", "-u", "ryan", "--", "env", f"XDG_RUNTIME_DIR=/run/user/{uid}",
                   f"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{uid}/bus", "systemctl", "--user",
                   *args, check=check)


def rpc(path, operation="status", **body):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(30)
        connection.connect(str(path))
        connection.sendall(json.dumps({"operation": operation, **body}).encode() + b"\n")
        with connection.makefile("rb") as stream:
            result = json.loads(stream.readline(1 << 20))
    if "error" in result:
        raise RuntimeError("Helper refused the verification: " + result["error"])
    return result


def assert_idle(root, socket_path, running):
    if running:
        jobs = rpc(socket_path)["jobs"]
    else:
        path = root / "state/jobs.json"
        jobs = list(json.loads(path.read_text()).values()) if path.exists() else []
    if any(job["phase"] in BUSY for job in jobs):
        raise RuntimeError("Finish active restarts and pending feature checks before account migration.")


def manifest(folder):
    if folder.is_symlink():
        raise RuntimeError("Refusing a symlinked state folder.")
    result = {}
    if not folder.exists():
        return result
    for path in sorted(folder.rglob("*")):
        if path.is_symlink():
            raise RuntimeError("Refusing symlinks in migrated state.")
        if path.is_dir():
            continue
        if not stat.S_ISREG(path.stat().st_mode):
            raise RuntimeError("Unexpected file type in migrated state.")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1 << 20), b""):
                digest.update(chunk)
        result[str(path.relative_to(folder))] = digest.hexdigest()
    return result


def copy_state(source, target):
    expected = manifest(source)
    existing = manifest(target)
    if existing and existing != expected:
        raise RuntimeError("Old and new job state differ; refusing to overwrite either copy.")
    target.mkdir(parents=True, exist_ok=True)
    if source.exists() and not existing:
        shutil.copytree(source, target, dirs_exist_ok=True)
    if manifest(target) != expected:
        raise RuntimeError("Job state checksum verification failed.")
    return expected


def verify_preserved_state(expected, after):
    for name, checksum in expected.items():
        folder = name.split("/", 1)[0]
        # Read-only plan probes prune expired, never-accepted plans. Journals
        # and every file belonging to an accepted job must remain identical.
        if name not in after and re.fullmatch(r"[0-9a-f]{32}", folder) and f"{folder}/job.json" not in expected:
            continue
        if after.get(name) != checksum:
            raise RuntimeError("Migrated job evidence changed during verification; keeping previous installation.")


def access_paths():
    ancestors = [Path("/home/amp"), INSTANCES.parent, INSTANCES]
    paths = set(ancestors)
    for instance in ("TFMCMain01", "TFMCDev01"):
        root = INSTANCES / instance
        minecraft = root / "Minecraft"
        plugins, logs = minecraft / "plugins", minecraft / "logs"
        maintenance = plugins / "Maintenance"
        required = [root, minecraft, plugins, logs, maintenance, maintenance / "config.yml"]
        if any(not path.exists() or path.is_symlink() for path in required):
            raise RuntimeError(f"Missing or symlinked required server paths for {instance}.")
        paths.update(required)
        paths.update(plugins.glob("*.jar"))
        paths.update(logs.rglob("*"))
        backups = root / "Backups"
        if backups.is_dir():
            paths.add(backups)
            paths.update(backups.iterdir())
    if any(path.is_symlink() for path in paths):
        raise RuntimeError("Refusing to grant access through symlinked server paths.")
    return sorted(paths)


def grant_access():
    for path in (Path("/home/amp"), INSTANCES.parent, INSTANCES):
        command("setfacl", "-m", f"u:{ACCOUNT}:--x", path)
    for instance in ("TFMCMain01", "TFMCDev01"):
        root = INSTANCES / instance
        minecraft = root / "Minecraft"
        plugins, logs = minecraft / "plugins", minecraft / "logs"
        for path in (root, minecraft):
            command("setfacl", "-m", f"u:{ACCOUNT}:--x", path)
        command("setfacl", "-m", f"u:{ACCOUNT}:rwx,d:u:{ACCOUNT}:r--", plugins)
        jars = list(plugins.glob("*.jar"))
        unreadable = command("runuser", "-u", ACCOUNT, "--", "python3", "-I", "-c",
                             "import os,sys,json; print(json.dumps([p for p in sys.argv[1:] if not os.access(p,os.R_OK)]))",
                             *jars)
        for path in json.loads(unreadable.stdout):
            command("setfacl", "-m", f"u:{ACCOUNT}:r--", path)
        maintenance = plugins / "Maintenance"
        command("setfacl", "-m", f"u:{ACCOUNT}:r-x,d:u:{ACCOUNT}:r--", maintenance)
        command("setfacl", "-m", f"u:{ACCOUNT}:r--", maintenance / "config.yml")
        command("setfacl", "-R", "-m", f"u:{ACCOUNT}:r-X", logs)
        command("setfacl", "-m", f"d:u:{ACCOUNT}:r-x", logs)
        backups = root / "Backups"
        if backups.is_dir():
            # Read directory entries/stat times, not archive contents.
            command("setfacl", "-m", f"u:{ACCOUNT}:r-x,d:u:{ACCOUNT}:---", backups)
            for path in backups.iterdir():
                command("setfacl", "-m", f"u:{ACCOUNT}:---", path)


def install_file(source, target, mode):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    target.chmod(mode)
    os.chown(target, 0, 0)


def wait_ready():
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            www, dev = rpc(RUN / "www/control.sock"), rpc(RUN / "dev/control.sock")
            if set(www["allowed_servers"]) == {"main", "dev"} and dev["allowed_servers"] == ["dev"]:
                return
        except (OSError, ValueError):
            pass
        time.sleep(.2)
    raise RuntimeError("The dedicated helper did not expose both scoped sockets.")


def backup_legacy(backup):
    if LEGACY.exists():
        manifest(LEGACY / "state")
        shutil.copytree(LEGACY, backup / "legacy", symlinks=True,
                        ignore=shutil.ignore_patterns("control.sock", "lock", "__pycache__"))
    if USER_UNIT.exists():
        shutil.copy2(USER_UNIT, backup / "ryan.service")


def cleanup_legacy(backup):
    # Cutover backups hold the complete old state and code before cleanup.
    if LEGACY.exists():
        shutil.rmtree(LEGACY)
    USER_UNIT.unlink(missing_ok=True)
    user_command("daemon-reload", check=False)
    archive = backup / "legacy-staging"
    archive.mkdir()
    uid = pwd.getpwnam("ryan").pw_uid
    parent = LEGACY.parent
    for path in parent.iterdir():
        if re.fullmatch(r"tfmc-server-control-(?:stage-[0-9a-f]{7,40}|[0-9a-f]{7,40}\.tar)", path.name) and not path.is_symlink() and path.stat().st_uid == uid:
            shutil.move(str(path), str(archive / path.name))


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run this installer with sudo as the host administrator.")
    os.umask(0o077)
    source = Path(__file__).resolve().parents[1]
    if any(path.is_symlink() for path in (CODE, STATE, RUN, LEGACY, UNIT, SUDOERS, WRAPPER)):
        raise SystemExit("Refusing symlinked installation or state paths.")
    for name in ("python3", "useradd", "passwd", "setfacl", "getfacl", "visudo", "systemctl", "runuser", "docker"):
        if shutil.which(name) is None:
            raise SystemExit("Required host tool is missing: " + name)
    for container in ("provincesystem-backend-1", "tfmc-staging-backend-1"):
        mounts = command("docker", "inspect", "--format", "{{json .Mounts}}", container, check=False)
        if mounts.returncode == 0 and any(str(m["Source"]).startswith(str(LEGACY)) for m in json.loads(mounts.stdout)):
            raise SystemExit("Remove the legacy socket mount and recreate that backend before cutover.")
    old_running = user_command("is-active", "--quiet", "tfmc-server-control.service", check=False).returncode == 0
    new_running = command("systemctl", "is-active", "--quiet", "tfmc-server-control.service", check=False).returncode == 0
    assert_idle(LEGACY, LEGACY / "www/control.sock", old_running)
    assert_idle(STATE, RUN / "www/control.sock", new_running)
    paths = access_paths()
    try:
        account = pwd.getpwnam(ACCOUNT)
    except KeyError:
        command("useradd", "--system", "--user-group", "--home-dir", STATE,
                "--no-create-home", "--shell", "/usr/sbin/nologin", ACCOUNT)
        account = pwd.getpwnam(ACCOUNT)
    if account.pw_dir != str(STATE) or account.pw_shell != "/usr/sbin/nologin" or set(os.getgrouplist(ACCOUNT, account.pw_gid)) != {account.pw_gid}:
        raise SystemExit("Existing service account has unexpected home, shell or groups; inspect it manually.")
    if command("passwd", "-S", ACCOUNT).stdout.split()[1] not in {"L", "LK"}:
        raise SystemExit("The service account must have a locked password.")
    backup_root = Path("/var/backups/tfmc-server-control")
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = Path(tempfile.mkdtemp(prefix="cutover-", dir=backup_root))
    backup_legacy(backup)
    saved = {}
    for target in (UNIT, SUDOERS, WRAPPER):
        saved[target] = target.exists()
        if target.exists():
            shutil.copy2(target, backup / target.name)
    if CODE.exists():
        shutil.copytree(CODE, backup / "code")
    (backup / "access.acl").write_text(command("getfacl", "-p", *paths).stdout)
    old_enabled = user_command("is-enabled", "--quiet", "tfmc-server-control.service", check=False).returncode == 0
    new_enabled = command("systemctl", "is-enabled", "--quiet", "tfmc-server-control.service", check=False).returncode == 0
    try:
        if old_running or USER_UNIT.exists():
            user_command("disable", "--now", "tfmc-server-control.service")
        if new_running:
            command("systemctl", "stop", "tfmc-server-control.service")
        assert_idle(LEGACY, LEGACY / "www/control.sock", False)
        assert_idle(STATE, RUN / "www/control.sock", False)
        STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        if LEGACY.exists():
            expected = copy_state(LEGACY / "state", STATE / "state")
            (backup / "state-manifest.json").write_text(json.dumps(expected, sort_keys=True))
        expected = manifest(STATE / "state")
        manifest(STATE)
        command("chown", "-R", f"{ACCOUNT}:{ACCOUNT}", STATE)
        STATE.chmod(0o700)
        for module in ("__init__.py", "inventory.py", "control.py", "host.py"):
            install_file(source / "backend/src/servers" / module, CODE / "backend/src/servers" / module, 0o644)
        for folder in (CODE, CODE / "backend", CODE / "backend/src", CODE / "backend/src/servers"):
            folder.chmod(0o755)
            os.chown(folder, 0, 0)
        install_file(source / "scripts/server-control-command.py", WRAPPER, 0o755)
        sudo_temp = backup / "new.sudoers"
        sudo_temp.write_text(f"Defaults:{ACCOUNT} timestamp_timeout=0, !lecture\n"
                            f"{ACCOUNT} ALL=(amp) NOPASSWD: /usr/local/sbin/tfmc-server-command\n")
        command("visudo", "-cf", sudo_temp)
        install_file(sudo_temp, SUDOERS, 0o440)
        grant_access()
        install_file(source / "scripts/tfmc-server-control.service", UNIT, 0o644)
        command("systemctl", "daemon-reload")
        command("systemctl", "enable", "--now", "tfmc-server-control.service")
        wait_ready()
        # Exercise real permissions/console access without starting a job.
        for server in ("main", "dev"):
            rpc(RUN / "www/control.sock", "plan", server=server, mode="restart", releases=[])
        after = manifest(STATE / "state")
        verify_preserved_state(expected, after)
    except Exception:
        command("systemctl", "disable", "--now", "tfmc-server-control.service", check=False)
        command("setfacl", "--restore=" + str(backup / "access.acl"), check=False)
        for target, existed in saved.items():
            if existed:
                shutil.copy2(backup / target.name, target)
            else:
                target.unlink(missing_ok=True)
        if (backup / "code").exists():
            shutil.rmtree(CODE)
            shutil.copytree(backup / "code", CODE)
        command("systemctl", "daemon-reload", check=False)
        if new_enabled:
            command("systemctl", "enable", "tfmc-server-control.service", check=False)
        if new_running:
            command("systemctl", "start", "tfmc-server-control.service", check=False)
        if old_enabled:
            user_command("enable", "tfmc-server-control.service", check=False)
        if old_running:
            user_command("start", "tfmc-server-control.service", check=False)
        print("Cutover failed; previous service/config restore attempted. Inspect backup:", backup, file=sys.stderr)
        raise
    cleanup_legacy(backup)
    print("Dedicated account and system service installed; legacy ryan helper cleaned up.")
    print("Previous code, state and ACLs are backed up at:", backup)
    print("www socket mount: /run/tfmc-server-control/www:/server-control:ro")
    print("Dev-only socket mount: /run/tfmc-server-control/dev:/server-control:ro")


if __name__ == "__main__":
    main()
