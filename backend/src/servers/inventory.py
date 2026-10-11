"""Which TFMC plugin each Minecraft server runs, against the plugin's GitHub releases.

Each server's `plugins/` and `logs/` folders are mounted read-only into the
backend. A jar is identified by its SHA-256: GitHub reports the digest of every
release asset, so a jar is a release only if its bytes are that release's
file, whatever it is called. The version a server is running comes from the
`Enabling <name> v<version>` lines of its most recent startup log, so a newer
jar on disk shows as waiting for a restart.

Main should run published releases; Dev may also run test builds.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

# (key, label, folder variable, whether only published releases belong there)
SERVERS = (
    ("main", "Main", "SERVER_MAIN_DIR", True),
    ("dev", "Dev", "SERVER_DEV_DIR", False),
)
DEFAULT_ORG = "TF-Minecraft"
# Releases are fetched again after this many seconds; failures are retried sooner.
# One check costs about 40 requests, and GitHub allows 60 an hour without a token.
RELEASES_TTL = 600
RELEASES_TTL_WITHOUT_TOKEN = 3600
RETRY_TTL = 60
RELEASES_PER_REPO = 30
# Older rotated logs are read until one holds a startup.
MAX_LOGS = 12

_BOOT = re.compile(r"\[bootstrap\] Loading Paper (\S+)")
_ENABLING = re.compile(r"\]: \[[^\]]+\] Enabling (\S+) v(\S+)\s*$")
_DONE = re.compile(r"\]: Done \(")
_ROTATED = re.compile(r"^(\d{4}-\d{2}-\d{2})-(\d+)\.log\.gz$")
_YAML_FIELD = re.compile(r"^(name|version):\s*['\"]?([^'\"#\r\n]*?)['\"]?\s*(?:#.*)?$", re.MULTILINE)

Fetch = Callable[[str], Any]


@dataclass(frozen=True)
class Release:
    repo: str
    version: str
    published_at: str
    url: str
    asset: str
    sha256: str

    @property
    def prefix(self) -> str:
        """The jar name before its version: `tfmccore` for `tfmccore-3.4.0.jar`."""
        stem = self.asset[:-4] if self.asset.lower().endswith(".jar") else self.asset
        suffix = f"-{self.version}"
        return stem[: -len(suffix)] if stem.endswith(suffix) else stem


# --------------------
# GitHub
# --------------------

def github_org() -> str:
    return os.getenv("SERVERS_GITHUB_ORG", "").strip() or DEFAULT_ORG


def _token() -> str:
    return os.getenv("SERVERS_GITHUB_TOKEN", "").strip() or os.getenv("PATCHNOTES_GITHUB_TOKEN", "").strip()


def _github(path: str) -> Any:
    headers = {"User-Agent": "TFMC-Servers/1.0", "Accept": "application/vnd.github+json"}
    token = _token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"https://api.github.com{path}", headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode() or "null")


def repo_releases(repo: str, data: Any) -> list[Release]:
    """A repository's published plugin releases, newest first. Drafts and pre-releases don't count."""
    found = []
    for release in data if isinstance(data, list) else []:
        if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
            continue
        published = release.get("published_at")
        tag = str(release.get("tag_name") or "")
        jar = next((a for a in release.get("assets") or []
                    if str(a.get("name", "")).lower().endswith(".jar")
                    and str(a.get("digest") or "").startswith("sha256:")), None)
        if not published or not tag or jar is None:
            continue
        found.append(Release(repo=repo, version=tag[1:] if tag[:1] in "vV" else tag, published_at=published,
                             url=str(release.get("html_url") or ""), asset=str(jar["name"]),
                             sha256=str(jar["digest"]).split(":", 1)[1].lower()))
    return sorted(found, key=lambda r: r.published_at, reverse=True)


def fetch_releases(fetch: Fetch | None = None) -> dict[str, list[Release]]:
    """Every active repository's published plugin releases, by repository name."""
    fetch = fetch or _github
    org = urllib.parse.quote(github_org())
    repos: list[str] = []
    for page in range(1, 4):
        data = fetch(f"/orgs/{org}/repos?per_page=100&page={page}")
        if not isinstance(data, list):
            raise ValueError("unexpected repository list")
        repos += [str(r["name"]) for r in data if isinstance(r, dict) and r.get("name") and not r.get("archived")]
        if len(data) < 100:
            break

    def one(repo: str) -> tuple[str, list[Release]]:
        data = fetch(f"/repos/{org}/{urllib.parse.quote(repo)}/releases?per_page={RELEASES_PER_REPO}")
        return repo, repo_releases(repo, data)

    with ThreadPoolExecutor(max_workers=8) as pool:
        return {repo: found for repo, found in pool.map(one, repos) if found}


class _ReleaseCache:
    def __init__(self):
        self._lock = threading.Lock()
        self._releases: dict[str, list[Release]] | None = None
        self._checked_at: str | None = None
        self._next = 0.0
        self._failed = False

    def get(self, fetch: Fetch | None = None) -> tuple[dict[str, list[Release]] | None, str | None, bool]:
        """(releases, when they were fetched, whether the last fetch failed). Keeps old releases on failure."""
        with self._lock:
            now = time.monotonic()
            if now >= self._next:
                try:
                    self._releases = fetch_releases(fetch)
                    self._checked_at = _now()
                    self._failed = False
                    self._next = now + (RELEASES_TTL if _token() else RELEASES_TTL_WITHOUT_TOKEN)
                except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError):
                    self._failed = True
                    self._next = now + RETRY_TTL
            return self._releases, self._checked_at, self._failed

    def clear(self):
        with self._lock:
            self._releases, self._checked_at, self._next, self._failed = None, None, 0.0, False


releases_cache = _ReleaseCache()


# --------------------
# Servers
# --------------------

@dataclass(frozen=True)
class Jar:
    file: str
    sha256: str
    name: str | None
    version: str | None
    # In plugins/update/, which Paper swaps in at the next start.
    update: bool


_hashes: dict[tuple[str, int, int], tuple[str, str | None, str | None]] = {}
_hashes_lock = threading.Lock()


def _describe(path: Path) -> tuple[str, str | None, str | None]:
    """A jar's SHA-256 and its plugin.yml name and version, cached until the file changes."""
    stat = path.stat()
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    with _hashes_lock:
        if key in _hashes:
            return _hashes[key]
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    name = version = None
    try:
        with zipfile.ZipFile(path) as archive:
            for entry in ("paper-plugin.yml", "plugin.yml"):
                if entry in archive.namelist():
                    fields = dict(_YAML_FIELD.findall(archive.read(entry).decode("utf-8", "replace")))
                    name, version = fields.get("name") or None, fields.get("version") or None
                    break
    except (zipfile.BadZipFile, OSError):
        pass
    value = (digest.hexdigest(), name, version)
    with _hashes_lock:
        _hashes[key] = value
    return value


def read_jars(plugins: Path) -> list[Jar]:
    found = []
    for folder, update in ((plugins, False), (plugins / "update", True)):
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.jar")):
            try:
                sha256, name, version = _describe(path)
            except OSError:
                continue
            found.append(Jar(file=path.name, sha256=sha256, name=name, version=version, update=update))
    return found


def _log_lines(path: Path) -> Iterator[str]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as handle:
        yield from handle


def read_startup(logs: Path) -> dict | None:
    """The most recent startup in the logs: Paper version, whether it finished, and each plugin's enabled version.

    Each startup begins a new log, and Paper starts one at midnight too, so older
    logs are read until one holds a startup.
    """
    rotated = [(m.group(1), int(m.group(2)), path) for path in logs.glob("*.log.gz")
               if (m := _ROTATED.match(path.name))]
    candidates = [logs / "latest.log"] + [path for *_, path in sorted(rotated, reverse=True)[:MAX_LOGS]]
    for path in candidates:
        if not path.is_file():
            continue
        startup = None
        try:
            for line in _log_lines(path):
                boot = _BOOT.search(line)
                if boot:
                    startup = {"paper": boot.group(1), "done": False, "log": path.name, "enabled": {}}
                elif startup is not None:
                    enabled = _ENABLING.search(line)
                    if enabled:
                        startup["enabled"][enabled.group(1).lower()] = enabled.group(2)
                    elif _DONE.search(line):
                        # Paper starts a new log at each startup, so nothing after this changes it.
                        startup["done"] = True
                        break
        except (OSError, EOFError):
            continue
        if startup is not None:
            return startup
    return None


# --------------------
# Comparison
# --------------------

def _plugin_state(jars: list[Jar], latest: Release, by_hash: dict[str, Release], startup: dict | None,
                  releases_only: bool) -> dict:
    if not jars:
        return {"state": "missing", "files": [], "version": None, "release": None, "loaded": None,
                "loaded_state": "unknown", "update": False, "duplicate": False}
    main_jars = [j for j in jars if not j.update] or jars
    loaded = None
    if startup is not None:
        names = [n.lower() for n in {j.name for j in main_jars if j.name} | {latest.repo}]
        loaded = next((startup["enabled"][n] for n in names if n in startup["enabled"]), None)
    # With two jars of one plugin, describe the one the server enabled.
    jar = next((j for j in main_jars if loaded is not None and j.version == loaded), main_jars[0])
    release = by_hash.get(jar.sha256)
    if release is None:
        state = "not_release" if releases_only else "test_build"
    elif release.version == latest.version:
        state = "latest"
    else:
        state = "older_release"
    if startup is None:
        loaded_state = "unknown"
    elif loaded is None:
        loaded_state = "not_loaded" if startup["done"] else "unknown"
    else:
        loaded_state = "same" if loaded == jar.version else "different"
    return {
        "state": state,
        "files": [j.file for j in jars],
        "version": jar.version,
        "release": release.version if release else None,
        "loaded": loaded,
        "loaded_state": loaded_state,
        # A jar in plugins/update/ replaces this one at the next start.
        "update": any(j.update for j in jars),
        # Two jars of one plugin: Paper loads only one of them.
        "duplicate": len(main_jars) > 1,
    }


def _match(jar: Jar, by_hash: dict[str, Release], prefixes: list[tuple[str, str]]) -> str | None:
    if jar.sha256 in by_hash:
        return by_hash[jar.sha256].repo
    lowered = jar.file.lower()
    return next((repo for prefix, repo in prefixes if lowered.startswith(prefix + "-")), None)


def compare(releases: dict[str, list[Release]], servers: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    """(TFMC plugins, other plugins) with each server's copy. `servers` maps key → {jars, startup, releases_only}."""
    by_hash = {r.sha256: r for found in releases.values() for r in found}
    # Longest first, so `vehicleframework-` never takes `vehicleframeworkaddon-`'s jar.
    prefixes = sorted({(r.prefix.lower(), r.repo) for found in releases.values() for r in found},
                      key=lambda p: len(p[0]), reverse=True)
    grouped: dict[str, dict[str, list[Jar]]] = {key: {} for key in servers}
    others: dict[str, dict[str, Any]] = {}
    for key, server in servers.items():
        for jar in server["jars"]:
            repo = _match(jar, by_hash, prefixes)
            if repo is not None:
                grouped[key].setdefault(repo, []).append(jar)
                continue
            name = jar.name or jar.file.removesuffix(".jar")
            entry = others.setdefault(name.lower(), {"name": name, "servers": {k: None for k in servers}})
            entry["servers"][key] = {"file": jar.file, "version": jar.version}

    plugins = []
    for repo in sorted(releases, key=str.lower):
        latest = releases[repo][0]
        plugins.append({
            "repo": repo,
            "latest": {"version": latest.version, "published_at": latest.published_at, "url": latest.url},
            "servers": {key: _plugin_state(grouped[key].get(repo, []), latest, by_hash,
                                           server["startup"], server["releases_only"])
                        for key, server in servers.items()},
        })
    other_list = []
    for entry in sorted(others.values(), key=lambda e: e["name"].lower()):
        versions = {(copy or {}).get("version") for copy in entry["servers"].values()}
        entry["differs"] = len(versions) > 1
        other_list.append(entry)
    return plugins, other_list


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def overview(fetch: Fetch | None = None) -> dict:
    """The staff Servers tab: each server's state and every plugin it has."""
    server_info: list[dict] = []
    readable: dict[str, dict] = {}
    for key, label, variable, releases_only in SERVERS:
        root = os.getenv(variable, "").strip()
        info: dict[str, Any] = {"key": key, "label": label, "releases_only": releases_only,
                                "status": "not_configured", "paper": None, "started": None, "log": None}
        if root:
            plugins = Path(root) / "plugins"
            if plugins.is_dir():
                startup = read_startup(Path(root) / "logs")
                info.update(status="available", paper=startup and startup["paper"],
                            started=startup and startup["done"], log=startup and startup["log"])
                readable[key] = {"jars": read_jars(plugins), "startup": startup, "releases_only": releases_only}
            else:
                info["status"] = "missing"
        server_info.append(info)

    releases, checked_at, failed = releases_cache.get(fetch)
    github = {"status": "available" if releases is not None else "unavailable",
              "checked_at": checked_at, "stale": failed and releases is not None}
    plugins, others = compare(releases or {}, readable) if releases is not None else ([], [])
    return {"checked_at": _now(), "github": github, "servers": server_info, "plugins": plugins, "others": others}

