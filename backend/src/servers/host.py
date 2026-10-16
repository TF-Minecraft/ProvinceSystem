"""Host-side server control. Run as tfmc-server-control, outside website containers.

The Unix socket only accepts plans, countdowns, cancellation and reopening.
Console input and paths are fixed here, never supplied by website callers.
With an AMP login file the helper does everything through the AMP API: console
input, a fresh backup during Main's countdown, and plugin and log files, which it
reads from a private mirror under its state directory. Without the file it uses
the root-owned sudo wrapper and the bind-mounted instance folders.
"""
from __future__ import annotations

import base64
import fcntl
import hashlib
import json
import logging
import os
import re
import shutil
import socketserver
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.servers import inventory
from src.servers.control import ControlError, MAX_MESSAGE

ACTIVE = {"countdown", "installing", "restarting", "checking", "reopening"}
INSTANCES = {"main": "TFMCMain01", "dev": "TFMCDev01"}
ID = re.compile(r"^[0-9a-f]{32}$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
AMP_LOGIN = Path(os.getenv("SERVER_CONTROL_AMP_LOGIN", "/etc/tfmc-server-control/amp-login.json"))
AMP_ADS = os.getenv("SERVER_CONTROL_AMP_URL", "http://127.0.0.1:8080")
BACKUP_WAIT = 1200
CHUNK = 4 << 20


def numeric_version(value: str) -> tuple[int, ...] | None:
    return tuple(map(int, value.split("."))) if re.fullmatch(r"\d+(?:\.\d+){1,3}", value) else None


def scheduled_restart(server: str, now: float, emergency_override: bool = False) -> bool:
    start = datetime.fromtimestamp(now, timezone.utc)
    end = start + timedelta(minutes=20 if server == "main" and not emergency_override else 15)
    midnight = start.replace(hour=0, minute=0, second=0, microsecond=0)
    for day in (-1, 0, 1):
        base = midnight + timedelta(days=day)
        windows = [(base + timedelta(hours=5, minutes=25), base + timedelta(hours=6, minutes=20))] if server == "main" else [
            (base + timedelta(hours=hour, minutes=-15), base + timedelta(hours=hour, minutes=15))
            for hour in (0, 6, 12, 18)]
        if any(start <= right and end >= left for left, right in windows):
            return True
    return False


def save_json(path: Path, value: dict):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as handle:
        json.dump(value, handle, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)
    with open_directory(path.parent) as handle:
        os.fsync(handle)


class open_directory:
    def __init__(self, path):
        self.fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)

    def __enter__(self):
        return self.fd

    def __exit__(self, *_):
        os.close(self.fd)


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            sha.update(chunk)
    return sha.hexdigest()


def amp_time(value: str) -> float:
    """AMP's UTC timestamps carry seven fractional digits, which fromisoformat rejects."""
    match = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?", value or "")
    if not match:
        raise ControlError("amp_unavailable")
    whole = datetime.fromisoformat(match[1]).replace(tzinfo=timezone.utc).timestamp()
    return whole + float("0." + (match[2] or "0"))


def write_new(path: Path, data: bytes):
    temporary = path.with_name(".sync-" + path.name)
    temporary.write_bytes(data)
    temporary.replace(path)


def download(release: dict, target: Path):
    url = "https://github.com/TF-Minecraft/{}/releases/download/{}/{}".format(
        *(urllib.parse.quote(release[field], safe="") for field in ("repo", "tag", "asset")))
    request = urllib.request.Request(url, headers={"User-Agent": "TFMC-Server-Control/1.0"})
    with urllib.request.urlopen(request, timeout=30) as source, target.open("xb") as output:
        size = 0
        while chunk := source.read(1 << 20):
            size += len(chunk)
            if size > 128 << 20:
                raise ControlError("release_too_large")
            output.write(chunk)
        output.flush()
        os.fsync(output.fileno())
    if digest(target) != release["sha256"]:
        raise ControlError("release_checksum_failed")


class Amp:
    """AMP API client for the service account named in the AMP login file."""

    def __init__(self, username: str, password: str, ads: str = AMP_ADS):
        self.username, self.password, self.ads = username, password, ads
        self.sessions: dict[str, tuple[str, str]] = {}
        self.lock = threading.Lock()

    @staticmethod
    def _post(base: str, method: str, **body):
        request = urllib.request.Request(f"{base}/API/{method}", data=json.dumps(body).encode(),
                                         headers={"Accept": "application/json", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                result = json.loads(response.read() or b"null")
        except (OSError, ValueError) as exc:
            raise ControlError("amp_unavailable") from exc
        if isinstance(result, dict) and result.get("Title") == "Unauthorized Access":
            raise PermissionError(method)
        if isinstance(result, dict) and result.get("Status") is False:
            raise ControlError("amp_action_failed")
        return result

    def _login(self, base: str) -> str:
        result = self._post(base, "Core/Login", username=self.username, password=self.password,
                            token="", rememberMe=False)
        if not isinstance(result, dict) or not result.get("success"):
            raise ControlError("amp_login_failed")
        return result["sessionID"]

    def _session(self, server: str) -> tuple[str, str]:
        if server not in self.sessions:
            ads = self._login(self.ads)
            ports = {instance["InstanceName"]: instance["Port"]
                     for target in self._post(self.ads, "ADSModule/GetInstances", SESSIONID=ads)
                     for instance in target.get("AvailableInstances", [])}
            if INSTANCES[server] not in ports:
                raise ControlError("amp_unavailable")
            base = f"http://127.0.0.1:{int(ports[INSTANCES[server]])}"
            self.sessions[server] = base, self._login(base)
        return self.sessions[server]

    def call(self, server: str, method: str, **body):
        with self.lock:
            for attempt in (1, 2):
                base, session = self._session(server)
                try:
                    return self._post(base, method, SESSIONID=session, **body)
                except PermissionError:
                    # Sessions expire; log in again once.
                    del self.sessions[server]
                except ControlError as exc:
                    # Look the instance up again next time; never resend, as AMP may have acted.
                    if exc.code == "amp_unavailable":
                        self.sessions.pop(server, None)
                    raise
            raise ControlError("amp_login_failed")


class Controller:
    def __init__(self, state: Path, roots: dict[str, tuple[Path, Path]], *, console=None, fetch=None, amp=None):
        self.state, self.roots = state, roots
        self.amp_login = None if amp is not None else AMP_LOGIN
        self._amp_client, self._amp_key = amp, None
        self.console = console or self._console
        self.fetch = fetch or download
        self._md5: dict[Path, str] = {}
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.worker = None
        self.status_json = "[]"
        state.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.jobs = json.loads((state / "jobs.json").read_text()) if (state / "jobs.json").exists() else {}
        # Recover an accepted job whose journal reached disk just before a
        # crash prevented the latest-jobs index from being written.
        for path in state.glob("*/job.json"):
            recorded = json.loads(path.read_text())
            current = self.jobs.get(recorded["server"])
            if current is None or recorded.get("accepted_at", recorded["deadline"] - 300) > current.get("accepted_at", current["deadline"] - 300):
                self.jobs[recorded["server"]] = recorded
        # Never replay writes after a helper crash or host restart.
        for job in self.jobs.values():
            if job["phase"] in ACTIVE:
                if job["phase"] == "countdown":
                    try:
                        self.console(job["server"], "broadcast &eThe server restart has been cancelled after a control connection restart.")
                    except Exception:
                        logging.exception("Could not cancel interrupted countdown for %s", job["server"])
                job.update(phase="failed", error="helper_interrupted")
        self._save()

    def _save(self):
        for job in self.jobs.values():
            save_json(self.state / job["id"] / "job.json", job)
        save_json(self.state / "jobs.json", self.jobs)
        self.status_json = json.dumps(list(self.jobs.values()))

    def amp(self) -> Amp | None:
        # The login file can appear or change while the helper runs.
        if self.amp_login is None:
            return self._amp_client
        try:
            key = self.amp_login.stat()
            key = key.st_mtime_ns, key.st_size
            if key != self._amp_key:
                login = json.loads(self.amp_login.read_text())
                self._amp_client, self._amp_key = Amp(login["username"], login["password"]), key
        except FileNotFoundError:
            self._amp_client, self._amp_key = None, None
        except (OSError, ValueError, KeyError, TypeError):
            logging.exception("Cannot read the AMP login file")
            self._amp_client, self._amp_key = None, None
        return self._amp_client

    def _console(self, server: str, command: str):
        if amp := self.amp():
            amp.call(server, "Core/SendConsoleMessage", message=command)
            return
        subprocess.run(["sudo", "-n", "-u", "amp", "/usr/local/sbin/tfmc-server-command",
                        server, command], check=True, timeout=25,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _take_backup(self, server: str, job_id: str, actor: str, reason: str) -> dict:
        title = f"Before restart {job_id[:8]}"
        task = self.amp().call(server, "LocalFileBackupPlugin/TakeBackup", Title=title,
                               Description=f"{actor}: {reason}"[:500], Sticky=False, Local=True, S3=False,
                               WasCreatedAutomatically=False, DirtyOnly=False, BackupWhileRunning=None)
        if not isinstance(task, dict) or not task.get("Id"):
            raise ControlError("amp_backup_failed")
        return {"title": title, "task": task["Id"], "state": "running"}

    def _await_backup(self, server: str, job: dict) -> bool:
        """Wait for the countdown's backup; False when the restart was cancelled meanwhile."""
        backup = job.get("backup")
        if not backup:
            return True
        amp = self.amp()
        if amp is None:
            raise ControlError("amp_unavailable")
        deadline, told = time.monotonic() + BACKUP_WAIT, False
        while any(task.get("Id") == backup["task"] for task in amp.call(server, "Core/GetTasks")):
            if not told:
                self.console(server, "broadcast &7Finishing a backup before the restart.")
                told = True
            if time.monotonic() > deadline:
                raise ControlError("amp_backup_timeout")
            if self.cancelled.wait(10):
                return False
        done = next((b for b in amp.call(server, "LocalFileBackupPlugin/GetBackups")
                     if b.get("Name") == backup["title"]), None)
        if not done:
            raise ControlError("amp_backup_failed")
        with self.lock:
            backup.update(state="done", id=done["Id"])
            self._save()
        return True

    def _paths(self, server: str, *, jars: bool = True, logs: bool = True) -> tuple[Path, Path]:
        if server not in INSTANCES:
            raise ControlError("bad_server", 400)
        if amp := self.amp():
            return self._mirror(amp, server, jars, logs)
        plugins, log_dir = self.roots[server]
        if not plugins.is_dir() or not log_dir.is_dir():
            raise ControlError("server_files_unavailable", 503)
        return plugins, log_dir

    # The mirror holds copies of the files the checks read: plugin jars, the
    # Maintenance config and recent logs. Its latest.log keeps one inode while
    # the server's file only grows, so a new log still looks like a new file.

    def _mirror(self, amp: Amp, server: str, jars: bool, logs: bool) -> tuple[Path, Path]:
        root = self.state / "mirror" / server
        plugins, log_dir = root / "plugins", root / "logs"
        for folder in (plugins / "update", plugins / "Maintenance", log_dir):
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        config = "plugins/Maintenance/config.yml"
        if not self._amp_size(amp, server, config):
            raise ControlError("maintenance_unavailable")
        (plugins / "Maintenance" / "config.yml").write_bytes(self._amp_read(amp, server, config))
        if jars:
            self._mirror_jars(amp, server, "plugins", plugins)
            self._mirror_jars(amp, server, "plugins/update", plugins / "update")
        if logs:
            self._mirror_logs(amp, server, log_dir)
        return plugins, log_dir

    @staticmethod
    def _amp_listing(amp: Amp, server: str, folder: str) -> dict[str, dict]:
        result = amp.call(server, "FileManagerPlugin/GetDirectoryListing", Dir=folder)
        # A missing folder, such as plugins/update, is not a list.
        return {e["Filename"]: e for e in result if not e.get("IsDirectory")} if isinstance(result, list) else {}

    def _amp_size(self, amp: Amp, server: str, path: str) -> int | None:
        folder, _, name = path.rpartition("/")
        entry = self._amp_listing(amp, server, folder).get(name)
        return None if entry is None else entry["SizeBytes"]

    @staticmethod
    def _amp_read(amp: Amp, server: str, path: str, start: int = 0, end: int | None = None) -> bytes:
        data = bytearray()
        while end is None or start + len(data) < end:
            length = CHUNK if end is None else min(CHUNK, end - start - len(data))
            chunk = amp.call(server, "FileManagerPlugin/GetFileChunk", Filename=path, Position=start + len(data), Length=length)
            piece = base64.b64decode(chunk["Base64Data"]) if isinstance(chunk, dict) and chunk.get("Base64Data") else b""
            data += piece
            if len(piece) < length:
                break
        if end is not None and start + len(data) != end:
            raise ControlError("plugins_changed")
        return bytes(data)

    @staticmethod
    def _amp_md5(amp: Amp, server: str, path: str) -> str:
        return amp.call(server, "FileManagerPlugin/CalculateFileMD5Sum", FilePath=path)["Result"]

    def _mirror_jars(self, amp: Amp, server: str, remote: str, local: Path):
        entries = {name: e for name, e in self._amp_listing(amp, server, remote).items() if name.endswith(".jar")}
        for path in local.glob("*.jar"):
            if path.name not in entries:
                path.unlink()
                self._md5.pop(path, None)
        for name, entry in entries.items():
            path = local / name
            md5 = self._amp_md5(amp, server, f"{remote}/{name}")
            if path.exists() and path not in self._md5:
                self._md5[path] = hashlib.md5(path.read_bytes()).hexdigest()
            if self._md5.get(path) != md5:
                data = self._amp_read(amp, server, f"{remote}/{name}", 0, entry["SizeBytes"])
                if hashlib.md5(data).hexdigest() != md5:
                    raise ControlError("plugins_changed")
                write_new(path, data)
                self._md5[path] = md5
            # AMP reports no change time, so the modified time stands in for it.
            changed = amp_time(entry["Modified"])
            os.utime(path, (changed, changed))

    def _mirror_logs(self, amp: Amp, server: str, folder: Path):
        entries = self._amp_listing(amp, server, "logs")
        rotated = sorted(((m[1], int(m[2]), name) for name in entries if (m := inventory._ROTATED.match(name))), reverse=True)
        keep = {name for *_, name in rotated[:inventory.MAX_LOGS]}
        for path in folder.iterdir():
            if path.name != "latest.log" and path.name not in keep:
                path.unlink()
        for name in keep:
            path = folder / name
            if not path.exists() or path.stat().st_size != entries[name]["SizeBytes"]:
                write_new(path, self._amp_read(amp, server, f"logs/{name}", 0, entries[name]["SizeBytes"]))
            os.utime(path, (amp_time(entries[name]["Modified"]),) * 2)
        path, latest = folder / "latest.log", entries.get("latest.log")
        if latest is None:
            path.unlink(missing_ok=True)
            return
        size = latest["SizeBytes"]
        have = path.stat().st_size if path.exists() else None
        same = False
        if have is not None and have <= size:
            head = min(have, 4096)
            with path.open("rb") as handle:
                same = self._amp_read(amp, server, "logs/latest.log", 0, head) == handle.read(head)
        if same:
            if size > have:
                with path.open("ab") as handle:
                    handle.write(self._amp_read(amp, server, "logs/latest.log", have, size))
        else:
            write_new(path, self._amp_read(amp, server, "logs/latest.log", 0, size))
        os.utime(path, (amp_time(latest["Modified"]),) * 2)

    def _changed_at(self, server: str, file: str) -> float:
        if self.amp():
            return (self._paths(server, logs=False)[0] / file).stat().st_mtime
        path = self.roots[server][0] / file
        return max(path.stat().st_mtime, path.stat().st_ctime)

    def snapshot(self, server: str) -> list[dict]:
        plugins, _ = self._paths(server)
        result = []
        names = set()
        for folder, prefix in ((plugins, ""), (plugins / "update", "update/")):
            for path in sorted(folder.glob("*.jar")):
                if path.is_symlink() or not path.is_file():
                    raise ControlError("unsafe_plugin_file")
                try:
                    sha, name, version = inventory._describe(path)
                    if not name or not version or name.lower() in names:
                        raise ControlError("plugin_inventory_conflict")
                    if prefix:
                        raise ControlError("pending_plugin_update")
                    names.add(name.lower())
                    # _describe reads fresh bytes and metadata from the same open file.
                    result.append({"file": path.name, "sha256": sha, "name": name, "version": version})
                except PermissionError:
                    raise ControlError("plugin_unreadable") from None
        return result

    def _maintenance(self, server: str) -> bool:
        plugins, _ = self._paths(server, jars=False, logs=False)
        text = (plugins / "Maintenance" / "config.yml").read_text()
        match = re.search(r"^maintenance-enabled:\s*(true|false)\s*$", text, re.MULTILINE)
        if not match:
            raise ControlError("maintenance_unavailable")
        return match[1] == "true"

    def _idle(self, server):
        if any(job["phase"] in ACTIVE or (key == server and job["phase"] in {"failed", "awaiting_review"})
               for key, job in self.jobs.items()):
            raise ControlError("server_job_active")

    def plan(self, server: str, mode: str, releases: list[dict], expected: list[dict] | None = None) -> dict:
        if mode not in {"restart", "latest"} or not isinstance(releases, list) or len(releases) > 100:
            raise ControlError("bad_server_action", 400)
        with self.lock:
            self._idle(server)
            for folder in self.state.iterdir():
                if folder.is_dir() and ID.fullmatch(folder.name) and not any(
                    job["id"] == folder.name for job in self.jobs.values()
                ):
                    path = folder / "plan.json"
                    if not (folder / "job.json").exists() and (not path.exists() or json.loads(path.read_text())["expires_at"] < time.time()):
                        shutil.rmtree(folder)
            baseline = self.snapshot(server)
            if expected is not None and baseline != expected:
                raise ControlError("plugins_changed")
            _, logs = self._paths(server)
            startup = inventory.read_startup(logs)
            if not startup or not startup["done"] or self._maintenance(server):
                raise ControlError("server_not_ready")
            self.console(server, "list")
            plan_id = uuid.uuid4().hex
            folder = self.state / plan_id
            folder.mkdir(mode=0o700)
            changes = []
            skipped = []
            try:
                if mode == "latest":
                    used = set()
                    for release in releases:
                        if set(release) != {"repo", "tag", "asset", "sha256", "known"} or any(
                            not isinstance(release.get(field), str) or not SAFE_NAME.fullmatch(release[field])
                            for field in ("repo", "tag", "asset")
                        ) or not release["asset"].endswith(".jar") or not SHA.fullmatch(release["sha256"]) or not isinstance(release["known"], list):
                            raise ControlError("bad_release", 400)
                        version = release["tag"].removeprefix("v")
                        prefix = release["asset"].removesuffix(".jar").removesuffix("-" + version)
                        old = [jar for jar in baseline if jar["file"].lower().startswith(prefix.lower() + "-")
                               or inventory.plugin_identifier(jar["name"]) == release["repo"].lower()]
                        if not old:
                            continue  # Never add plugins that are not already installed.
                        if len(old) != 1 or old[0]["file"] in used:
                            raise ControlError("plugin_inventory_conflict")
                        used.add(old[0]["file"])
                        if old[0]["sha256"] == release["sha256"]:
                            continue
                        known = next((r for r in release["known"] if r.get("sha256") == old[0]["sha256"]), None)
                        target_version = numeric_version(version)
                        # A test build is offered for replacement; staff choose it when starting.
                        test_build = known is None
                        if test_build:
                            current_version = numeric_version(old[0]["version"])
                            newer_test = current_version is not None and target_version is not None and current_version > target_version
                        else:
                            current_version = numeric_version(known.get("version", ""))
                            if current_version is None or target_version is None or target_version <= current_version:
                                skipped.append({"repo": release["repo"], "reason": "not_a_newer_version"})
                                continue
                        if server == "main" and not self._dev_verified(release):
                            skipped.append({"repo": release["repo"], "reason": "not_verified_on_dev"})
                            continue
                        target = folder / release["asset"]
                        if (self.roots[server][0] / release["asset"]).exists() and release["asset"] != old[0]["file"]:
                            raise ControlError("plugin_inventory_conflict")
                        self.fetch(release, target)
                        sha, name, jar_version = inventory._describe(target)
                        if sha != release["sha256"] or name != old[0]["name"] or jar_version != version:
                            raise ControlError("release_identity_failed")
                        changes.append({**{k: v for k, v in release.items() if k != "known"}, "name": name, "version": jar_version,
                                        "old_file": old[0]["file"], "old_version": old[0]["version"],
                                        **({"test_build": True, "newer_test": newer_test} if test_build else {})})
                activation = [{"name": jar["name"], "loaded": startup["enabled"].get(jar["name"].lower()),
                               "version": jar["version"]} for jar in baseline
                              if startup["enabled"].get(jar["name"].lower()) != jar["version"]
                              and startup["failed"].get(jar["name"].lower()) != jar["version"]]
                plan = {"id": plan_id, "server": server, "mode": mode, "expires_at": time.time() + 600,
                        "baseline": baseline, "changes": changes, "activation": activation, "skipped": skipped,
                        "boot_errors": self._boot_errors(logs, startup["log"]), "failed_at_startup": startup["failed"],
                        "last_backup_at": self._backup_time(server),
                        "backup": server == "main" and self.amp() is not None}
                save_json(folder / "plan.json", plan)
                return self._public_plan(plan)
            except BaseException:
                shutil.rmtree(folder)
                raise

    @staticmethod
    def _public_plan(plan: dict) -> dict:
        return {**{key: plan[key] for key in ("id", "server", "mode", "expires_at", "changes", "activation", "skipped", "last_backup_at")},
                "backup": plan.get("backup", False)}

    def _backup_time(self, server: str) -> float | None:
        if amp := self.amp():
            try:
                return max((amp_time(b["Timestamp"]) for b in amp.call(server, "LocalFileBackupPlugin/GetBackups")
                            if b.get("StoredLocally")), default=None)
            except ControlError:
                return None
        root = self.roots[server][0].parents[1] / "Backups"
        try:
            return max((p.stat().st_mtime for p in root.glob("*.zip") if p.is_file()), default=None)
        except OSError:
            return None

    def _dev_verified(self, release: dict) -> bool:
        _, logs = self._paths("dev")
        startup = inventory.read_startup(logs)
        if not startup or not startup["done"]:
            return False
        for jar in self.snapshot("dev"):
            if jar["sha256"] == release["sha256"] and startup["enabled"].get(jar["name"].lower()) == jar["version"]:
                # A matching version alone cannot prove the running bytes. The
                # recorded jar must have been on disk before that startup.
                log = logs / startup["log"]
                match = re.match(r"(\d{4}-\d{2}-\d{2})-", log.name)
                zone = ZoneInfo(os.getenv("SERVER_CONTROL_LOG_TIMEZONE", "Etc/UTC"))
                written_at = log.stat().st_mtime
                date = match[1] if match else datetime.fromtimestamp(written_at, zone).strftime("%Y-%m-%d")
                for line in inventory._log_lines(log):
                    if inventory._BOOT.search(line):
                        stamp = re.search(r"\[(\d{2}:\d{2}:\d{2})\]", line)
                        if stamp is None:
                            return False
                        boot = datetime.fromisoformat(date + "T" + stamp[1]).replace(tzinfo=zone)
                        if boot.timestamp() > written_at:
                            boot -= timedelta(days=1)
                        boot_time = boot.timestamp()
                        return self._changed_at("dev", jar["file"]) <= boot_time
        return False

    @staticmethod
    def _boot_errors(logs: Path, name: str) -> list[str]:
        errors = []
        for line in inventory._log_lines(logs / name):
            if "ERROR]" in line or any(text in line for text in ("Error occurred while enabling", "Could not load", "Disabling ")):
                # Preserve the message and severity, strip the log's time.
                errors.append(re.sub(r"^\[\d{2}:\d{2}:\d{2}", "[TIME", line).strip())
            if inventory._DONE.search(line):
                break
        return errors

    @staticmethod
    def _error_key(line: str) -> str:
        # Worker IDs change between boots; preserve the actual error message.
        header, separator, message = line.partition("]:")
        return re.sub(r"\d+", "N", header) + separator + message if separator else line

    def _plan(self, plan_id: str) -> dict:
        if not isinstance(plan_id, str) or not ID.fullmatch(plan_id):
            raise ControlError("bad_plan", 400)
        try:
            return json.loads((self.state / plan_id / "plan.json").read_text())
        except FileNotFoundError:
            raise ControlError("plan_expired") from None

    def _unchanged(self, plan: dict):
        if self.snapshot(plan["server"]) != plan["baseline"]:
            raise ControlError("plugins_changed")
        for change in plan["changes"]:
            if digest(self.state / plan["id"] / change["asset"]) != change["sha256"]:
                raise ControlError("release_checksum_failed")

    def start(self, server: str, plan_id: str, actor: str, reason: str, emergency_override: bool = False,
              replace_test_builds: list[str] | None = None) -> dict:
        replace_test_builds = [] if replace_test_builds is None else replace_test_builds
        with self.lock:
            if not isinstance(emergency_override, bool) or (server != "main" and emergency_override):
                raise ControlError("bad_server_action", 400)
            if not isinstance(replace_test_builds, list) or any(not isinstance(repo, str) for repo in replace_test_builds):
                raise ControlError("bad_server_action", 400)
            plan = self._plan(plan_id)
            if plan["server"] != server:
                raise ControlError("bad_plan", 400)
            # Retrying the same accepted plan must not start a second countdown.
            previous = self.state / plan_id / "job.json"
            if previous.exists():
                return json.loads(previous.read_text())
            self._idle(server)
            if plan["server"] != server or plan["expires_at"] < time.time():
                raise ControlError("plan_expired")
            if scheduled_restart(server, time.time(), emergency_override):
                raise ControlError("scheduled_restart_conflict")
            tests = {change["repo"] for change in plan["changes"] if change.get("test_build")}
            if not set(replace_test_builds) <= tests:
                raise ControlError("bad_server_action", 400)
            kept = tests - set(replace_test_builds)
            if kept:
                # Test builds staff left alone are not installed or checked.
                plan = {**plan, "changes": [c for c in plan["changes"] if c["repo"] not in kept],
                        "skipped": plan["skipped"] + [{"repo": repo, "reason": "test_build_kept"} for repo in sorted(kept)]}
            self._unchanged(plan)
            if self._maintenance(server):
                raise ControlError("server_not_ready")
            self.console(server, "list")
            accepted_at = time.time()
            countdown = server == "main" and not emergency_override
            # The backup runs alongside the countdown; an emergency restart skips it.
            backup = self._take_backup(server, plan_id, actor, reason) if countdown and self.amp() else None
            job = {"id": plan_id, "server": server, "phase": "countdown" if countdown else "installing",
                   "accepted_at": accepted_at, "deadline": accepted_at + (300 if countdown else 0),
                   "emergency_override": emergency_override,
                   "actor": actor, "reason": reason, "changes": plan["changes"], "activation": plan["activation"],
                   "error": None, "maintenance_started": False, "backup": backup, "events": []}
            if kept:
                save_json(self.state / plan_id / "plan.json", plan)
            self.jobs[server] = job
            self.cancelled.clear()
            self._save()
            self.worker = threading.Thread(target=self.run, args=(plan, job), daemon=True)
            self.worker.start()
            return dict(job)

    def _event(self, job: dict, phase: str, **fields):
        with self.lock:
            job.update(phase=phase, **fields)
            job["events"].append({"at": time.time(), "phase": phase})
            self._save()

    def cancel(self, server: str, job_id: str) -> dict:
        with self.lock:
            job = self._job(server, job_id)
            if job["phase"] == "cancelled":
                return dict(job)
            if job["phase"] == "failed" and not job["maintenance_started"]:
                self._unchanged(self._plan(job_id))
                if self._maintenance(server):
                    raise ControlError("cannot_cancel")
            elif job["phase"] != "countdown":
                raise ControlError("cannot_cancel")
            self.console(server, "broadcast &eThe server restart has been cancelled.")
            if job["phase"] == "countdown":
                self.cancelled.set()
            self._event(job, "cancelled")
            return dict(job)

    def _job(self, server: str, job_id: str) -> dict:
        job = self.jobs.get(server)
        if not job or job["id"] != job_id:
            raise ControlError("job_not_found", 404)
        return job

    def run(self, plan: dict, job: dict | None = None):
        server = plan["server"]
        job = job or self.jobs[server]
        if job["id"] != plan["id"]:
            return
        countdown = server == "main" and not job.get("emergency_override", False)
        try:
            announcements = ((300, "5 minutes"), (180, "3 minutes"), (60, "1 minute"),
                             (30, "30 seconds"), (10, "10 seconds"), (0, "")) if countdown else ((0, ""),)
            for remaining, label in announcements:
                delay = max(0, job["deadline"] - remaining - time.time())
                if self.cancelled.wait(delay):
                    return
                if not remaining and not self._await_backup(server, job):
                    return
                with self.lock:
                    if job["phase"] != ("countdown" if countdown else "installing"):
                        return
                    if remaining:
                        self.console(server, f"broadcast &c&lServer restart &7in &f{label}&7. Finish what you are doing.")
                    else:
                        self._unchanged(plan)
                        # The countdown is over; only the restart itself still needs room.
                        if scheduled_restart(server, time.time(), True):
                            raise ControlError("scheduled_restart_conflict")
                        if self._maintenance(server):
                            raise ControlError("maintenance_changed")
                        self._event(job, "installing")  # Cancel and commit to writes share this lock.
            self.console(server, "broadcast &c&lServer restart &7is starting now.")
            with self.lock:
                job["maintenance_started"] = True
                self._save()
            self.console(server, "maintenance on")
            self._wait(lambda: self._maintenance(server), 30, "maintenance_unavailable")
            self._save_game(server)
            self._unchanged(plan)
            self._install(plan)
            before = self._boot(self._paths(server, jars=False)[1])
            self._event(job, "restarting")
            self.console(server, "stop")
            self._event(job, "checking")
            self._wait(lambda: self._boot(self._paths(server, jars=False)[1]) != before and self._startup_ok(plan),
                       600, "startup_check_failed")
            if server == "main" and (plan["changes"] or plan["activation"]):
                self._event(job, "awaiting_review")
            else:
                self._reopen(plan, job)
        except Exception as exc:
            logging.exception("Server operation failed for %s", server)
            if countdown and not job["maintenance_started"]:
                # Players were warned; tell them the restart is off.
                try:
                    self.console(server, "broadcast &eThe server restart has been cancelled.")
                except Exception:
                    logging.exception("Could not announce the failed countdown for %s", server)
            self._event(job, "failed", error=exc.code if isinstance(exc, ControlError) else "server_operation_failed")

    @staticmethod
    def _wait(predicate, timeout: float, code: str):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(1)
        raise ControlError(code)

    def _save_game(self, server: str):
        _, logs = self._paths(server, jars=False)
        path = logs / "latest.log"
        offset = path.stat().st_size
        inode = path.stat().st_ino
        self.console(server, "save-all flush")

        def saved():
            self._paths(server, jars=False)
            if path.stat().st_ino != inode or path.stat().st_size < offset:
                raise ControlError("unexpected_restart")
            with path.open() as handle:
                handle.seek(offset)
                return "Saved the game" in handle.read()
        self._wait(saved, 60, "save_failed")

    def _install(self, plan: dict):
        if amp := self.amp():
            return self._install_amp(amp, plan)
        plugins, _ = self._paths(plan["server"])
        backup = self.state / plan["id"] / "backup"
        backup.mkdir(exist_ok=True, mode=0o700)
        expected = {jar["file"]: jar["sha256"] for jar in plan["baseline"]}
        for change in plan["changes"]:
            old = plugins / change["old_file"]
            if digest(old) != expected[old.name]:
                raise ControlError("plugins_changed")
            shutil.copy2(old, backup / old.name)
            with (backup / old.name).open("rb") as handle:
                os.fsync(handle.fileno())
            if digest(backup / old.name) != expected[old.name]:
                raise ControlError("backup_failed")
        with open_directory(backup) as fd:
            os.fsync(fd)
        # Put the new inode in place: Java keeps its open old inode until stop.
        swapped = []
        try:
            for change in plan["changes"]:
                old, target = plugins / change["old_file"], plugins / change["asset"]
                temporary = plugins / (".control-" + plan["id"])
                shutil.copyfile(self.state / plan["id"] / change["asset"], temporary)
                temporary.chmod(0o644)
                with temporary.open("rb") as handle:
                    os.fsync(handle.fileno())
                if digest(temporary) != change["sha256"]:
                    raise ControlError("release_checksum_failed")
                if digest(old) != expected[old.name]:
                    raise ControlError("plugins_changed")
                temporary.replace(target)
                swapped.append(change)
                if old != target:
                    old.unlink()
        except Exception:
            (plugins / (".control-" + plan["id"])).unlink(missing_ok=True)
            # Restore displaced jars if any swap fails. Each restore
            # also uses a fresh inode; Java's existing open jars are preserved.
            for change in reversed(swapped):
                old, target = plugins / change["old_file"], plugins / change["asset"]
                temporary = plugins / (".restore-" + plan["id"])
                shutil.copyfile(backup / old.name, temporary)
                temporary.chmod(0o644)
                with temporary.open("rb") as handle:
                    os.fsync(handle.fileno())
                temporary.replace(old)
                if old != target:
                    target.unlink(missing_ok=True)
            with open_directory(plugins) as fd:
                os.fsync(fd)
            raise
        with open_directory(plugins) as fd:
            os.fsync(fd)

    def _install_amp(self, amp: Amp, plan: dict):
        server = plan["server"]
        plugins, _ = self._paths(server, logs=False)
        backup = self.state / plan["id"] / "backup"
        backup.mkdir(exist_ok=True, mode=0o700)
        expected = {jar["file"]: jar["sha256"] for jar in plan["baseline"]}
        for change in plan["changes"]:
            old = plugins / change["old_file"]
            if digest(old) != expected[old.name]:
                raise ControlError("plugins_changed")
            shutil.copy2(old, backup / old.name)
            with (backup / old.name).open("rb") as handle:
                os.fsync(handle.fileno())
            if digest(backup / old.name) != expected[old.name]:
                raise ControlError("backup_failed")
        with open_directory(backup) as fd:
            os.fsync(fd)
        # A renamed upload is a new inode; Java keeps the old jar open until stop,
        # and TrashFile moves that old jar into the instance's .trash folder.
        swapped = []
        try:
            for change in plan["changes"]:
                data = (self.state / plan["id"] / change["asset"]).read_bytes()
                if hashlib.sha256(data).hexdigest() != change["sha256"]:
                    raise ControlError("release_checksum_failed")
                saved = (backup / change["old_file"]).read_bytes()
                if self._amp_md5(amp, server, f"plugins/{change['old_file']}") != hashlib.md5(saved).hexdigest():
                    raise ControlError("plugins_changed")
                temporary = f"plugins/.control-{plan['id']}"
                self._amp_upload(amp, server, temporary, data)
                swapped.append(change)
                if change["old_file"] == change["asset"]:
                    amp.call(server, "FileManagerPlugin/TrashFile", Filename=f"plugins/{change['old_file']}")
                    amp.call(server, "FileManagerPlugin/RenameFile", Filename=temporary, NewFilename=change["asset"])
                else:
                    amp.call(server, "FileManagerPlugin/RenameFile", Filename=temporary, NewFilename=change["asset"])
                    amp.call(server, "FileManagerPlugin/TrashFile", Filename=f"plugins/{change['old_file']}")
        except Exception:
            for change in reversed(swapped):
                try:
                    self._amp_restore(amp, server, plan["id"], change, backup / change["old_file"])
                except Exception:
                    logging.exception("Could not restore %s on %s", change["old_file"], server)
            raise

    def _amp_upload(self, amp: Amp, server: str, path: str, data: bytes):
        if self._amp_size(amp, server, path) is not None:
            amp.call(server, "FileManagerPlugin/TrashFile", Filename=path)
        for offset in range(0, max(len(data), 1), CHUNK):
            amp.call(server, "FileManagerPlugin/WriteFileChunk", Filename=path, Offset=offset,
                     Data=base64.b64encode(data[offset:offset + CHUNK]).decode(), FinalChunk=offset + CHUNK >= len(data))
        if self._amp_md5(amp, server, path) != hashlib.md5(data).hexdigest():
            amp.call(server, "FileManagerPlugin/TrashFile", Filename=path)
            raise ControlError("release_checksum_failed")

    def _amp_restore(self, amp: Amp, server: str, plan_id: str, change: dict, saved: Path):
        names = self._amp_listing(amp, server, "plugins")
        if f".control-{plan_id}" in names:
            amp.call(server, "FileManagerPlugin/TrashFile", Filename=f"plugins/.control-{plan_id}")
        original = hashlib.md5(saved.read_bytes()).hexdigest()
        asset, old = change["asset"], change["old_file"]
        if asset in names and (asset != old or self._amp_md5(amp, server, f"plugins/{asset}") != original):
            amp.call(server, "FileManagerPlugin/TrashFile", Filename=f"plugins/{asset}")
            names.pop(asset)
        if old not in names:
            self._amp_upload(amp, server, f"plugins/.restore-{plan_id}", saved.read_bytes())
            amp.call(server, "FileManagerPlugin/RenameFile", Filename=f"plugins/.restore-{plan_id}", NewFilename=old)

    @staticmethod
    def _boot(logs: Path):
        path = logs / "latest.log"
        if not path.exists():
            return None
        with path.open(errors="replace") as handle:
            boot = next((line for line in handle if inventory._BOOT.search(line)), None)
        return path.stat().st_ino, boot

    def _startup_ok(self, plan: dict, *, fresh: bool = True) -> bool:
        _, logs = self._paths(plan["server"])
        startup = inventory.read_startup(logs)
        # Right after a restart the startup must be in latest.log. A later
        # recheck may follow Paper's midnight rotation into an older log.
        if not startup or not startup["done"] or (fresh and startup["log"] != "latest.log"):
            return False
        expected = {jar["name"].lower(): jar["version"] for jar in plan["baseline"]}
        expected.update({change["name"].lower(): change["version"] for change in plan["changes"]})
        changed = {change["name"].lower() for change in plan["changes"]}
        for name, version in expected.items():
            if startup["enabled"].get(name) == version:
                continue
            # An unchanged plugin may retain its explicitly recorded failure;
            # missing, newly failed or upgraded plugins must never pass.
            if (name in changed or plan.get("failed_at_startup", {}).get(name) != version
                    or startup["failed"].get(name) != version):
                return False
        current = self.snapshot(plan["server"])
        expected_files = {jar["file"]: jar["sha256"] for jar in plan["baseline"]}
        for change in plan["changes"]:
            expected_files.pop(change["old_file"])
            expected_files[change["asset"]] = change["sha256"]
        if {jar["file"]: jar["sha256"] for jar in current} != expected_files:
            return False
        return {self._error_key(line) for line in self._boot_errors(logs, startup["log"])} <= {
            self._error_key(line) for line in plan["boot_errors"]}

    def _reopen(self, plan: dict, job: dict, *, fresh: bool = True):
        if not self._startup_ok(plan, fresh=fresh):
            raise ControlError("startup_check_failed")
        self.console(plan["server"], "list")
        self.console(plan["server"], "maintenance off")
        self._wait(lambda: not self._maintenance(plan["server"]), 30, "maintenance_unavailable")
        self.console(plan["server"], "broadcast &aThe restart is complete. The server is open.")
        self._event(job, "complete", error=None)

    def reopen(self, server: str, job_id: str) -> dict:
        with self.lock:
            job = self._job(server, job_id)
            if job["phase"] == "complete":
                return dict(job)
            if job["phase"] not in {"failed", "awaiting_review"}:
                raise ControlError("cannot_reopen")
            if any(other["phase"] in ACTIVE for key, other in self.jobs.items() if key != server):
                raise ControlError("server_job_active")
            plan = self._plan(job_id)
            self._event(job, "reopening")
            try:
                # An operator may have restored the recorded old jars while
                # stopped in AMP. Reopen only after those pass the same checks.
                if not self._startup_ok(plan, fresh=False) and self._startup_ok({**plan, "changes": []}, fresh=False):
                    plan = {**plan, "changes": []}
                    job["rolled_back"] = True
                self._reopen(plan, job, fresh=False)
            except Exception as exc:
                self._event(job, "failed", error=exc.code if isinstance(exc, ControlError) else "server_operation_failed")
                raise
            return dict(job)

    def resolve(self, server: str, job_id: str) -> dict:
        with self.lock:
            job = self._job(server, job_id)
            if job["phase"] == "resolved":
                return dict(job)
            if job["phase"] != "failed":
                raise ControlError("cannot_resolve")
            self._event(job, "resolved")
            return dict(job)

    def dispatch(self, body: dict) -> dict:
        operation = body.get("operation")
        allowed = {"status": {"operation"}, "plan": {"operation", "server", "mode", "releases"},
                   "start": {"operation", "server", "plan_id", "actor", "reason", "emergency_override"},
                   "cancel": {"operation", "server", "job_id", "actor", "reason"},
                   "reopen": {"operation", "server", "job_id", "actor", "reason"},
                   "resolve": {"operation", "server", "job_id", "actor", "reason"}}
        # Older websites omit the optional baseline and test-build choices and still send backup_ref.
        optional = {"replace_test_builds", "backup_ref"} if operation == "start" else {"expected"} if operation == "plan" else set()
        if operation not in allowed or set(body) - optional != allowed[operation]:
            raise ControlError("bad_control_request", 400)
        if operation == "status":
            return {"jobs": json.loads(self.status_json)}
        server = body["server"]
        self._paths(server)
        if operation == "plan":
            expected = body.get("expected")
            if "expected" in body and (not isinstance(expected, list) or len(expected) > 300):
                raise ControlError("bad_control_request", 400)
            return self.plan(server, body["mode"], body["releases"], expected)
        if any(not isinstance(body[key], str) or not 3 <= len(body[key]) <= 500 for key in ("actor", "reason")):
            raise ControlError("bad_control_request", 400)
        if operation == "start":
            replace = body.get("replace_test_builds", [])
            if not isinstance(replace, list) or len(replace) > 100:
                raise ControlError("bad_control_request", 400)
            return self.start(server, body["plan_id"], body["actor"], body["reason"],
                              body["emergency_override"], replace)
        with self.lock:
            job = self._job(server, body["job_id"])
            event = {"at": time.time(), "action": operation, "actor": body["actor"],
                     "reason": body["reason"], "outcome": "requested"}
            job["events"].append(event)
            self._save()
            try:
                if operation == "resolve":
                    result = self.resolve(server, body["job_id"])
                else:
                    result = self.cancel(server, body["job_id"]) if operation == "cancel" else self.reopen(server, body["job_id"])
            except Exception as exc:
                event.update(outcome="failed", error=exc.code if isinstance(exc, ControlError) else "server_operation_failed")
                raise
            else:
                event["outcome"] = "ok"
                return result
            finally:
                self._save()


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(180)
        try:
            raw = self.rfile.readline(MAX_MESSAGE + 1)
            if len(raw) > MAX_MESSAGE or not raw.endswith(b"\n"):
                raise ControlError("bad_control_request", 400)
            body = json.loads(raw)
            if not isinstance(body, dict):
                raise ControlError("bad_control_request", 400)
            if body.get("operation") != "status" and body.get("server") not in self.server.allowed_servers:
                raise ControlError("server_not_allowed", 403)
            result = self.server.controller.dispatch(body)
            if body.get("operation") == "status":
                result["jobs"] = [job for job in result["jobs"] if job["server"] in self.server.allowed_servers]
                result["allowed_servers"] = sorted(self.server.allowed_servers)
        except ControlError as exc:
            result = {"error": exc.code, "status": exc.status}
        except Exception:
            logging.exception("Server control request failed")
            result = {"error": "control_failed", "status": 503}
        self.wfile.write(json.dumps(result).encode() + b"\n")


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allowed_servers = {"main", "dev"}


def main():
    os.umask(0o077)
    root = Path(os.environ["SERVER_CONTROL_HOME"])
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Includes separate invocations and sockets; only one deployment owner.
    with (root / "lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        instances = Path(os.getenv("SERVER_CONTROL_INSTANCES_DIR", "/home/amp/.ampdata/instances"))
        sockets = Path(os.getenv("SERVER_CONTROL_SOCKET_DIR", str(root)))
        roots = {key: (instances / instance / "Minecraft/plugins",
                       instances / instance / "Minecraft/logs")
                 for key, instance in INSTANCES.items()}
        controller = Controller(root / "state", roots)
        servers = []
        for site, allowed in (("www", {"main", "dev"}), ("dev", {"dev"})):
            run = sockets / site
            run.mkdir(exist_ok=True, mode=0o755)
            path = run / "control.sock"
            path.unlink(missing_ok=True)
            server = Server(str(path), Handler)
            server.controller, server.allowed_servers = controller, allowed
            path.chmod(0o600)
            servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            threading.Event().wait()
        finally:
            for server in servers:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    main()
