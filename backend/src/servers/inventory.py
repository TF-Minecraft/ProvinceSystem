"""Which TFMC plugin each Minecraft server runs, against the plugin's GitHub releases.

Each server's `plugins/` and `logs/` folders are mounted read-only into the
backend. A jar is identified by its SHA-256: GitHub reports the digest of every
release asset, so a jar is a release only if its bytes are that release's
file, whatever it is called. Each latest release is also compared with its
repository's default branch, to show merged work that is not released yet.
The version a server is running comes from the
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
from dataclasses import dataclass, replace
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
# With a token a check is about 11 GraphQL queries; without one it is about 40 REST
# requests, and GitHub allows 60 an hour.
RELEASES_TTL = 600
RELEASES_TTL_WITHOUT_TOKEN = 3600
RETRY_TTL = 60
RELEASES_PER_REPO = 30
# Older rotated logs are read until one holds a startup.
MAX_LOGS = 12

_BOOT = re.compile(r"\[bootstrap\] Loading Paper (\S+)")
_ENABLING = re.compile(r"\]: \[[^\]]+\] Enabling (\S+) v(\S+)\s*$")
_ENABLE_FAILED = re.compile(r"\]: Error occurred while enabling (\S+) v(\S+)")
_DISABLING = re.compile(r"\]: \[[^\]]+\] Disabling (\S+) v(\S+)")
_DONE = re.compile(r"\]: Done \(")
_ROTATED = re.compile(r"^(\d{4}-\d{2}-\d{2})-(\d+)\.log\.gz$")
_YAML_FIELD = re.compile(r"^(name|version):\s*['\"]?([^'\"#\r\n]*?)['\"]?\s*(?:#.*)?$", re.MULTILINE)

# (path, body): a REST GET of `path`, or a POST of `body` when given.
Fetch = Callable[..., Any]


@dataclass(frozen=True)
class Release:
    repo: str
    version: str
    published_at: str
    url: str
    asset: str
    sha256: str
    tag: str = ""
    # The default branch against this release, for a repository's latest release when known:
    # GitHub's compare status ("identical", "ahead", "behind", "diverged"), how many commits the
    # branch has that the release lacks, and the compare page.
    branch: dict | None = None

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


def _github(path: str, body: dict | None = None) -> Any:
    """A REST GET, or a POST of `body` (a GraphQL query to `/graphql`)."""
    headers = {"User-Agent": "TFMC-Servers/1.0", "Accept": "application/vnd.github+json"}
    token = _token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"https://api.github.com{path}", data=data, headers=headers)
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
                    if isinstance(a, dict) and str(a.get("name", "")).lower().endswith(".jar")
                    and str(a.get("digest") or "").startswith("sha256:")), None)
        if not published or not tag or jar is None:
            continue
        found.append(Release(repo=repo, version=tag[1:] if tag[:1] in "vV" else tag, published_at=published,
                             url=str(release.get("html_url") or ""), asset=str(jar["name"]),
                             sha256=str(jar["digest"]).split(":", 1)[1].lower(), tag=tag))
    return sorted(found, key=lambda r: r.published_at, reverse=True)


def fetch_releases(fetch: Fetch | None = None) -> dict[str, list[Release]]:
    """Every active repository's published plugin releases, by repository name.

    With a token this takes a handful of GraphQL queries, and each latest release
    is compared with its default branch. Without one GraphQL isn't available, so it
    reads each repository's releases over REST and skips the comparison.
    """
    fetch = fetch or _github
    if _token():
        return _graphql_releases(fetch)
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


# Repositories per releases (and comparison) query: GitHub answers several small
# queries in parallel much sooner than one large one.
GRAPHQL_CHUNK = 8

_REPOSITORIES = """query($org: String!, $after: String) {
  organization(login: $org) {
    repositories(first: 100, after: $after, isArchived: false) {
      pageInfo { hasNextPage endCursor }
      nodes { name defaultBranchRef { name } }
    }
  }
}"""
_RELEASES = """fragment releases on Repository {
  releases(first: %d, orderBy: {field: CREATED_AT, direction: DESC}) {
    nodes { tagName publishedAt isDraft isPrerelease url releaseAssets(first: 20) { nodes { name digest } } }
  }
}""" % RELEASES_PER_REPO


def _graphql(fetch: Fetch, query: str, variables: dict) -> dict:
    data = fetch("/graphql", {"query": query, "variables": variables})
    if not isinstance(data, dict) or not isinstance(data.get("data"), dict):
        raise ValueError("unexpected GraphQL answer")
    return data["data"]


def _aliased(repos: list[str], body: Callable[[int], str], extra: Callable[[int, str], dict] | None = None
             ) -> tuple[str, dict]:
    """One `rN: repository(...)` field per repository, with its name passed as a variable."""
    fields, params, variables = [], ["$org: String!"], {"org": github_org()}
    for i, repo in enumerate(repos):
        params.append(f"$r{i}: String!")
        variables[f"r{i}"] = repo
        for name, value in (extra(i, repo) if extra else {}).items():
            params.append(f"${name}: String!")
            variables[name] = value
        fields.append(f"r{i}: repository(owner: $org, name: $r{i}) {{ {body(i)} }}")
    return f"query({', '.join(params)}) {{\n  " + "\n  ".join(fields) + "\n}", variables


def _graphql_releases(fetch: Fetch) -> dict[str, list[Release]]:
    branches: dict[str, str] = {}
    after = None
    for _ in range(3):
        page = _graphql(fetch, _REPOSITORIES, {"org": github_org(), "after": after})["organization"]["repositories"]
        branches.update((str(r["name"]), str((r.get("defaultBranchRef") or {}).get("name") or "main"))
                        for r in page["nodes"] if isinstance(r, dict) and r.get("name"))
        if not page["pageInfo"]["hasNextPage"]:
            break
        after = page["pageInfo"]["endCursor"]

    def chunk(repos: list[str]) -> dict[str, list[Release]]:
        query, variables = _aliased(repos, lambda i: "...releases")
        data = _graphql(fetch, f"{query}\n{_RELEASES}", variables)
        found = {}
        for i, repo in enumerate(repos):
            nodes = ((data.get(f"r{i}") or {}).get("releases") or {}).get("nodes") or []
            found[repo] = repo_releases(repo, [{
                "tag_name": n.get("tagName"), "published_at": n.get("publishedAt"), "draft": n.get("isDraft"),
                "prerelease": n.get("isPrerelease"), "html_url": n.get("url"),
                "assets": (n.get("releaseAssets") or {}).get("nodes") or [],
            } for n in nodes if isinstance(n, dict)])
        found = {repo: f for repo, f in found.items() if f}
        compared = _compare_branches(fetch, {repo: (f[0].tag, branches[repo]) for repo, f in found.items()})
        for repo, state in compared.items():
            found[repo][0] = replace(found[repo][0], branch=state)
        return found

    names = sorted(branches)
    releases: dict[str, list[Release]] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for found in pool.map(chunk, [names[i:i + GRAPHQL_CHUNK] for i in range(0, len(names), GRAPHQL_CHUNK)]):
            releases.update(found)
    return releases


def _compare_branches(fetch: Fetch, latest: dict[str, tuple[str, str]]) -> dict[str, dict]:
    """Each repository's default branch against its latest release's tag, in one query.

    One large query is much slower than several small ones, so each releases
    query is followed by the comparisons for its own repositories.

    A failure leaves the releases without a comparison rather than failing them.
    """
    repos = sorted(latest)
    if not repos:
        return {}
    query, variables = _aliased(
        repos, lambda i: f"ref(qualifiedName: $t{i}) {{ compare(headRef: $b{i}) {{ status aheadBy }} }}",
        lambda i, repo: {f"t{i}": f"refs/tags/{latest[repo][0]}", f"b{i}": latest[repo][1]})
    try:
        data = _graphql(fetch, query, variables)
    except (urllib.error.URLError, OSError, ValueError):
        return {}
    org = urllib.parse.quote(github_org())
    found = {}
    for i, repo in enumerate(repos):
        compare = (((data.get(f"r{i}") or {}).get("ref") or {}).get("compare") or {})
        status = str(compare.get("status") or "").lower()
        if status not in {"identical", "ahead", "behind", "diverged"}:
            continue
        tag, branch = latest[repo]
        found[repo] = {"name": branch, "status": status, "ahead": int(compare.get("aheadBy") or 0),
                       "url": f"https://github.com/{org}/{urllib.parse.quote(repo)}/compare/"
                              f"{urllib.parse.quote(tag, safe='')}...{urllib.parse.quote(branch, safe='')}"}
    return found


_FETCH_ERRORS = (urllib.error.URLError, OSError, ValueError, KeyError, TypeError, AttributeError)


class _ReleaseCache:
    """Releases, refreshed after a while.

    Only the first fetch makes a caller wait. After that an expired cache is
    refreshed in the background and callers get the releases already known,
    unless they ask to wait for fresh ones.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._releases: dict[str, list[Release]] | None = None
        self._checked_at: str | None = None
        self._next = 0.0
        self._failed = False
        self._refresh: threading.Thread | None = None

    def get(self, fetch: Fetch | None = None, wait: bool = False
            ) -> tuple[dict[str, list[Release]] | None, str | None, bool]:
        """(releases, when they were fetched, whether the last fetch failed). Keeps old releases on failure."""
        with self._lock:
            if time.monotonic() >= self._next:
                if wait or self._releases is None:
                    self._store(*self._load(fetch))
                elif self._refresh is None or not self._refresh.is_alive():
                    self._refresh = threading.Thread(target=self._background, args=(fetch,), daemon=True)
                    self._refresh.start()
            return self._releases, self._checked_at, self._failed

    def wait_for_refresh(self):
        refresh = self._refresh
        if refresh is not None:
            refresh.join()

    @staticmethod
    def _load(fetch: Fetch | None) -> tuple[dict[str, list[Release]] | None, bool]:
        try:
            return fetch_releases(fetch), False
        except _FETCH_ERRORS:
            return None, True

    def _background(self, fetch: Fetch | None):
        releases, failed = self._load(fetch)
        with self._lock:
            self._store(releases, failed)

    def _store(self, releases: dict[str, list[Release]] | None, failed: bool):
        now = time.monotonic()
        if failed:
            self._failed = True
            self._next = now + RETRY_TTL
        else:
            self._releases, self._checked_at, self._failed = releases, _now(), False
            self._next = now + (RELEASES_TTL if _token() else RELEASES_TTL_WITHOUT_TOKEN)

    def clear(self):
        self.wait_for_refresh()
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
                    startup = {"paper": boot.group(1), "done": False, "log": path.name, "enabled": {}, "failed": {}}
                elif startup is not None:
                    enabled = _ENABLING.search(line)
                    failed = _ENABLE_FAILED.search(line) or _DISABLING.search(line)
                    if enabled:
                        startup["enabled"][enabled.group(1).lower()] = enabled.group(2)
                        startup["failed"].pop(enabled.group(1).lower(), None)
                    elif failed:
                        startup["enabled"].pop(failed.group(1).lower(), None)
                        startup["failed"][failed.group(1).lower()] = failed.group(2)
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
            "latest": {"version": latest.version, "published_at": latest.published_at, "url": latest.url,
                       "branch": latest.branch},
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

