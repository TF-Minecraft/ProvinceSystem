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
import http.client
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

# Each check owns its results. The slots bound work, never share responses.
CHECK_TIMEOUT = 20
GRAPHQL_CHUNK = 8
GITHUB_WORKERS = 6
RELEASES_PER_REPO = 30
_check_slots = threading.BoundedSemaphore(2)


class Releases(dict):
    def __init__(self):
        super().__init__()
        self.repos: set[str] = set()
        self.errors: dict[str, str] = {}
        self.complete: set[str] = set()
        self.error: str | None = None
        self.checked_at: str | None = None


def github_org() -> str:
    return os.getenv("SERVERS_GITHUB_ORG", "").strip() or DEFAULT_ORG


def _token() -> str:
    return os.getenv("SERVERS_GITHUB_TOKEN", "").strip() or os.getenv("PATCHNOTES_GITHUB_TOKEN", "").strip()


def _github(path: str, body: dict | None = None, *, timeout: float = CHECK_TIMEOUT) -> Any:
    headers = {"User-Agent": "TFMC-Servers/1.0", "Accept": "application/vnd.github+json", "Cache-Control": "no-cache"}
    if token := _token():
        headers["Authorization"] = f"Bearer {token}"
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"https://api.github.com{path}", data=data, headers=headers)
    deadline = time.monotonic() + timeout
    with urllib.request.urlopen(request, timeout=timeout) as response:
        chunks, size = [], 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("GitHub check deadline")
            sock = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
            if sock is not None:
                sock.settimeout(remaining)
            chunk = response.read1(65536)
            if time.monotonic() >= deadline:
                raise TimeoutError("GitHub check deadline")
            if not chunk:
                break
            size += len(chunk)
            if size > 8 << 20:
                raise ValueError("GitHub response too large")
            chunks.append(chunk)
        return json.loads(b"".join(chunks).decode() or "null")


def _fetcher(fetch: Fetch | None, deadline: float) -> Fetch:
    def request(path: str, body: dict | None = None):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("GitHub check deadline")
        result = fetch(path, body) if fetch else _github(path, body, timeout=remaining)
        if time.monotonic() >= deadline:
            raise TimeoutError("GitHub check deadline")
        return result
    return request


def repo_releases(repo: str, data: Any) -> list[Release]:
    found = []
    for release in data if isinstance(data, list) else []:
        if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
            continue
        published, tag = release.get("published_at"), str(release.get("tag_name") or "")
        if not published or not tag:
            continue
        for jar in release.get("assets") or []:
            if not isinstance(jar, dict) or not str(jar.get("name", "")).lower().endswith(".jar"):
                continue
            digest = str(jar.get("digest") or "")
            if not digest.startswith("sha256:") or not digest[7:]:
                continue
            found.append(Release(repo=repo, version=tag[1:] if tag[:1] in "vV" else tag, published_at=published,
                                 url=str(release.get("html_url") or ""), asset=str(jar["name"]),
                                 sha256=digest[7:].lower(), tag=tag))
    return sorted(found, key=lambda r: r.published_at, reverse=True)


class HistoryPage(list):
    def __init__(self, repo: str, rows: list[dict]):
        super().__init__(repo_releases(repo, rows))
        # Missing asset digests prevent a negative proof even when every page was read.
        self.verifiable = not any(
            isinstance(r, dict) and r.get("published_at") and not r.get("draft") and not r.get("prerelease")
            and any(isinstance(a, dict) and str(a.get("name", "")).lower().endswith(".jar")
                    and (not str(a.get("digest") or "").startswith("sha256:") or not str(a.get("digest") or "")[7:])
                    for a in r.get("assets") or [])
            for r in rows)


_REPOSITORIES = """query($org: String!, $after: String) {
 organization(login: $org) { repositories(first: 100, after: $after, isArchived: false) {
  pageInfo { hasNextPage endCursor } nodes { name }
 } }
}"""
_ASSETS = "releaseAssets(first: 20) { pageInfo { hasNextPage endCursor } nodes { name digest } }"
_RELEASE_FIELDS = "tagName publishedAt isDraft isPrerelease url " + _ASSETS
_LATEST = "name defaultBranchRef { name target { oid } } latestRelease { tagCommit { oid } " + _RELEASE_FIELDS + " }"


def _graphql(fetch: Fetch, query: str, variables: dict, partial: bool = False) -> dict:
    raw = fetch("/graphql", {"query": query, "variables": variables})
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), dict) or (raw.get("errors") and not partial):
        raise ValueError("unexpected GraphQL answer")
    data = raw["data"]
    if partial and raw.get("errors"):
        data = {**data, "_errors": raw["errors"]}
    return data


def _aliased(repos: list[str], body: Callable[[int], str], extra: Callable[[int, str], dict] | None = None):
    params, variables, fields = ["$org: String!"], {"org": github_org()}, []
    for i, repo in enumerate(repos):
        params.append(f"$r{i}: String!"); variables[f"r{i}"] = repo
        for name, value in (extra(i, repo) if extra else {}).items():
            params.append(f"${name}: String!"); variables[name] = value
        fields.append(f"r{i}: repository(owner: $org, name: $r{i}) {{ {body(i)} }}")
    return f"query({', '.join(params)}) {{ " + " ".join(fields) + " }", variables


def _assets(repo: str, node: dict, fetch: Fetch) -> dict:
    connection = node.get("releaseAssets") or {}
    assets = list(connection.get("nodes") or [])
    while (connection.get("pageInfo") or {}).get("hasNextPage"):
        cursor = connection["pageInfo"].get("endCursor")
        if not cursor:
            raise ValueError("missing asset cursor")
        query = """query($org:String!,$repo:String!,$tag:String!,$after:String!){repository(owner:$org,name:$repo){
          release(tagName:$tag){releaseAssets(first:20,after:$after){pageInfo{hasNextPage endCursor} nodes{name digest}}}}}"""
        raw = _graphql(fetch, query, {"org": github_org(), "repo": repo, "tag": node["tagName"], "after": cursor})
        release = (raw.get("repository") or {}).get("release")
        if not release:
            raise ValueError("release disappeared")
        connection = release["releaseAssets"]
        if (connection.get("pageInfo") or {}).get("endCursor") == cursor and connection["pageInfo"].get("hasNextPage"):
            raise ValueError("asset cursor did not advance")
        assets.extend(connection.get("nodes") or [])
    return {"tag_name": node.get("tagName"), "published_at": node.get("publishedAt"),
            "draft": node.get("isDraft"), "prerelease": node.get("isPrerelease"),
            "html_url": node.get("url"), "assets": assets}


def _compare_branches(fetch: Fetch, latest: dict[str, tuple[str, str]]) -> dict[str, dict]:
    if not latest:
        return {}
    repos = sorted(latest)
    query, variables = _aliased(repos,
        lambda i: f"ref(qualifiedName: $t{i}) {{ compare(headRef: $b{i}) {{ status aheadBy }} }}",
        lambda i, repo: {f"t{i}": f"refs/tags/{latest[repo][0]}", f"b{i}": latest[repo][1]})
    try:
        data = _graphql(fetch, query, variables, partial=True)
    except (OSError, ValueError, http.client.HTTPException):
        return {}
    found = {}
    for i, repo in enumerate(repos):
        compare = (((data.get(f"r{i}") or {}).get("ref") or {}).get("compare") or {})
        status = str(compare.get("status") or "").lower()
        if status in {"identical", "ahead", "behind", "diverged"}:
            tag, branch = latest[repo]
            found[repo] = _branch(repo, tag, branch, status, int(compare.get("aheadBy") or 0))
    return found


def _branch(repo, tag, branch, status, ahead=0):
    return {"name": branch, "status": status, "ahead": ahead,
            "url": f"https://github.com/{urllib.parse.quote(github_org())}/{urllib.parse.quote(repo)}/compare/"
                   f"{urllib.parse.quote(tag, safe='')}...{urllib.parse.quote(branch, safe='')}"}


def _history(repo: str, fetch: Fetch, *, graphql: bool):
    """Yield pages until exhausted; a deadline/error must not prove 'not a release'."""
    cursor, page = None, 1
    while True:
        if graphql:
            query = "query($org:String!,$repo:String!,$after:String){repository(owner:$org,name:$repo){releases(first:30,after:$after,orderBy:{field:CREATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{" + _RELEASE_FIELDS + "}}}}"
            data = _graphql(fetch, query, {"org": github_org(), "repo": repo, "after": cursor})
            repository = data.get("repository")
            if not repository or not isinstance(repository.get("releases"), dict):
                raise ValueError("repository disappeared")
            connection = repository["releases"]
            yield HistoryPage(repo, [_assets(repo, n, fetch) for n in connection.get("nodes") or []])
            info = connection.get("pageInfo") or {}
            if not info.get("hasNextPage"):
                return
            new_cursor = info.get("endCursor")
            if not new_cursor or new_cursor == cursor:
                raise ValueError("release cursor did not advance")
            cursor = new_cursor
        else:
            rows = fetch(f"/repos/{urllib.parse.quote(github_org())}/{urllib.parse.quote(repo)}/releases?per_page=30&page={page}")
            if not isinstance(rows, list):
                raise ValueError("unexpected release list")
            yield HistoryPage(repo, rows)
            if len(rows) < RELEASES_PER_REPO:
                return
            page += 1


def _latest(fetch: Fetch) -> Releases:
    found = Releases()
    if not _token():
        for page in range(1, 100):
            rows = fetch(f"/orgs/{urllib.parse.quote(github_org())}/repos?per_page=100&page={page}")
            if not isinstance(rows, list):
                raise ValueError("unexpected repository list")
            found.repos.update(r["name"] for r in rows if isinstance(r, dict) and r.get("name") and not r.get("archived"))
            if len(rows) < 100:
                break
        def rest(repo):
            try:
                try:
                    data = fetch(f"/repos/{urllib.parse.quote(github_org())}/{urllib.parse.quote(repo)}/releases/latest")
                except urllib.error.HTTPError as error:
                    if error.code != 404:
                        raise
                    return repo, [], None
                releases = repo_releases(repo, [data])
                if not releases:
                    releases = next((p for p in _history(repo, fetch, graphql=False) if p), [])
                return repo, releases[:1], None
            except (OSError, ValueError, http.client.HTTPException):
                return repo, [], "github_unavailable"
        with ThreadPoolExecutor(max_workers=GITHUB_WORKERS) as pool:
            for repo, releases, error in pool.map(rest, sorted(found.repos)):
                if releases: found[repo] = releases
                if error: found.errors[repo] = error
    else:
        cursor = None
        while True:
            data = _graphql(fetch, _REPOSITORIES, {"org": github_org(), "after": cursor})
            connection = (data.get("organization") or {}).get("repositories")
            if not isinstance(connection, dict):
                raise ValueError("unexpected repository list")
            found.repos.update(n["name"] for n in connection.get("nodes") or [] if isinstance(n, dict) and n.get("name"))
            info = connection.get("pageInfo") or {}
            if not info.get("hasNextPage"): break
            next_cursor = info.get("endCursor")
            if not next_cursor or next_cursor == cursor: raise ValueError("missing repository cursor")
            cursor = next_cursor
        def chunk(repos):
            local, errors, unequal = {}, {}, {}
            try:
                query, variables = _aliased(repos, lambda i: _LATEST)
                data = _graphql(fetch, query, variables, partial=True)
            except (OSError, ValueError, http.client.HTTPException):
                return {}, {r: "github_unavailable" for r in repos}
            for i, repo in enumerate(repos):
                try:
                    if any((error.get("path") or [None])[0] == f"r{i}" for error in data.get("_errors", [])):
                        raise ValueError("repository lookup failed")
                    node = data.get(f"r{i}")
                    if not isinstance(node, dict) or "latestRelease" not in node:
                        raise ValueError("missing repository")
                    latest = node["latestRelease"]
                    if latest is None: continue
                    releases = repo_releases(repo, [_assets(repo, latest, fetch)])
                    if not releases:
                        releases = next((p for p in _history(repo, fetch, graphql=True) if p), [])
                    if not releases: continue
                    release = releases[0]; branch = node.get("defaultBranchRef") or {}
                    head = (branch.get("target") or {}).get("oid")
                    commit = (latest.get("tagCommit") or {}).get("oid") if release.tag == latest.get("tagName") else None
                    if branch.get("name") and head and commit:
                        if head == commit:
                            release = replace(release, branch=_branch(repo, release.tag, branch["name"], "identical"))
                        else: unequal[repo] = (release.tag, branch["name"])
                    local[repo] = [release]
                except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
                    errors[repo] = "github_unavailable"
            for repo, state in _compare_branches(fetch, unequal).items():
                local[repo][0] = replace(local[repo][0], branch=state)
            return local, errors
        names = sorted(found.repos)
        with ThreadPoolExecutor(max_workers=GITHUB_WORKERS) as pool:
            for releases, errors in pool.map(chunk, [names[i:i + GRAPHQL_CHUNK] for i in range(0, len(names), GRAPHQL_CHUNK)]):
                found.update(releases); found.errors.update(errors)
    found.checked_at = _now()
    return found


def _resolve(found: Releases, jars: list[Jar], fetch: Fetch):
    by_hash = {r.sha256: r for rows in found.values() for r in rows}
    prefixes = sorted({(r.prefix.lower(), repo) for repo, rows in found.items() for r in rows}, key=lambda x: -len(x[0]))
    needed: dict[str, list[Jar]] = {}
    for jar in jars:
        repo = _match(jar, by_hash, prefixes)
        if repo in found and jar.sha256 not in by_hash:
            needed.setdefault(repo, []).append(jar)
    def resolve(item):
        repo, candidates = item; releases = list(found[repo]); complete = False
        wanted = {j.sha256 for j in candidates}
        try:
            if _token():
                versions = sorted({j.version for j in candidates if j.version and re.fullmatch(r"\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?", j.version)})
                tags = list(dict.fromkeys(t for v in versions for t in ("v" + v, v)))
                if tags:
                    fields = " ".join(f"t{i}:release(tagName:$t{i}){{{_RELEASE_FIELDS}}}" for i in range(len(tags)))
                    params = ",".join(f"$t{i}:String!" for i in range(len(tags)))
                    query = f"query($org:String!,$repo:String!,{params}){{repository(owner:$org,name:$repo){{{fields}}}}}"
                    data = _graphql(fetch, query, {"org": github_org(), "repo": repo, **{f"t{i}": t for i,t in enumerate(tags)}})
                    repository = data.get("repository")
                    if not isinstance(repository, dict): raise ValueError("repository disappeared")
                    releases.extend(repo_releases(repo, [_assets(repo, n, fetch) for n in repository.values() if n]))
            if not wanted <= {r.sha256 for r in releases}:
                verifiable = True
                for page in _history(repo, fetch, graphql=bool(_token())):
                    verifiable = verifiable and page.verifiable
                    releases.extend(page)
                    if wanted <= {r.sha256 for r in releases}: break
                else: complete = verifiable
        except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
            pass  # Unknown bytes stay unverified until history has been exhausted.
        return repo, list({r.sha256: r for r in reversed(releases)}.values()), complete
    with ThreadPoolExecutor(max_workers=GITHUB_WORKERS) as pool:
        for repo, releases, complete in pool.map(resolve, needed.items()):
            # Keep the designated latest at index zero even after exact/history lookups.
            latest = found[repo][0]
            found[repo] = [latest] + [r for r in releases if r.sha256 != latest.sha256]
            if complete: found.complete.add(repo)


def _local_server(root: Path, releases_only: bool):
    return {"jars": read_jars(root / "plugins"), "startup": read_startup(root / "logs"), "releases_only": releases_only}


def check_servers(roots: dict[str, tuple[Path, bool]], fetch: Fetch | None = None):
    """Fresh GitHub and local reads overlap; no response survives this call."""
    deadline = time.monotonic() + CHECK_TIMEOUT
    request = _fetcher(fetch, deadline)
    acquired = _check_slots.acquire(blocking=False)
    found = Releases()
    try:
        with ThreadPoolExecutor(max_workers=max(1, len(roots) + 1)) as pool:
            locals_ = {key: pool.submit(_local_server, root, only) for key, (root, only) in roots.items()}
            remote = pool.submit(_latest, request) if acquired else None
            servers = {key: future.result() for key, future in locals_.items()}
            if remote is None:
                found.error = "busy"
            else:
                try:
                    found = remote.result()
                    _resolve(found, [j for server in servers.values() for j in server["jars"]], request)
                except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
                    found = Releases(); found.error = "github_unavailable"
        return found, servers
    finally:
        if acquired: _check_slots.release()


def fetch_releases(fetch: Fetch | None = None) -> Releases:
    """Fresh latest-release metadata; installed history is resolved by check_servers."""
    return check_servers({}, fetch)[0]


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


def _archive_metadata(archive) -> tuple[str | None, str | None]:
    for entry in ("paper-plugin.yml", "plugin.yml"):
        if entry in archive.namelist():
            fields = dict(_YAML_FIELD.findall(archive.read(entry).decode("utf-8", "replace")))
            return fields.get("name") or None, fields.get("version") or None
    return None, None


def _describe(path: Path) -> tuple[str, str | None, str | None]:
    digest = hashlib.sha256()
    name = version = None
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
        handle.seek(0)
        try:
            with zipfile.ZipFile(handle) as archive:
                name, version = _archive_metadata(archive)
        except zipfile.BadZipFile:
            pass
    return digest.hexdigest(), name, version


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
                  releases_only: bool, complete: bool = True) -> dict:
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
        state = ("not_release" if releases_only else "test_build") if complete else "unverified"
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


def plugin_identifier(name: str | None) -> str:
    lowered = (name or "").lower()
    return {"activity": "activitytf", "geiger_counter": "geigercounters", "tfmcweb": "tfmcwebbridge"}.get(lowered, lowered)


def _match(jar: Jar, by_hash: dict[str, Release], prefixes: list[tuple[str, str]]) -> str | None:
    if jar.sha256 in by_hash:
        return by_hash[jar.sha256].repo
    lowered = jar.file.lower()
    matched = next((repo for prefix, repo in prefixes if lowered.startswith(prefix + "-")), None)
    if matched:
        return matched
    # Stable Bukkit identifiers differ from repository names for these plugins.
    name = plugin_identifier(jar.name)
    return next((repo for _, repo in prefixes if repo.lower() == name), None)


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
            if repo is None:
                name = plugin_identifier(jar.name)
                repo = next((r for r in getattr(releases, "errors", {}) if r.lower() == name), None)
            if repo is not None:
                grouped[key].setdefault(repo, []).append(jar)
                continue
            name = jar.name or jar.file.removesuffix(".jar")
            entry = others.setdefault(name.lower(), {"name": name, "servers": {k: None for k in servers}})
            entry["servers"][key] = {"file": jar.file, "version": jar.version}
            if getattr(releases, "error", None) or getattr(releases, "errors", {}):
                entry["unverified"] = True

    plugins = []
    for repo in sorted(set(releases) | set(getattr(releases, "errors", {})), key=str.lower):
        latest = releases[repo][0] if repo in releases else None
        plugins.append({
            "repo": repo,
            "latest": {"version": latest.version, "published_at": latest.published_at, "url": latest.url,
                       "branch": latest.branch} if latest else None,
            **({"error": "github_unavailable"} if latest is None else {}),
            "servers": {key: _plugin_state(grouped[key].get(repo, []), latest or Release(repo, "", "", "", "", ""), by_hash,
                                           server["startup"], server["releases_only"],
                                           repo in releases.complete if isinstance(releases, Releases) else True)
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
    roots = {}
    server_info = []
    for key, label, variable, only in SERVERS:
        value = os.getenv(variable, "").strip()
        available = bool(value) and (Path(value) / "plugins").is_dir()
        server_info.append({"key": key, "label": label, "releases_only": only,
                            "status": "available" if available else "missing" if value else "not_configured",
                            "paper": None, "started": None, "log": None})
        if available: roots[key] = (Path(value), only)
    releases, servers = check_servers(roots, fetch)
    for info in server_info:
        startup = servers.get(info["key"], {}).get("startup")
        if startup:
            info.update(paper=startup["paper"], started=startup["done"], log=startup["log"])
    plugins, others = compare(releases, servers)
    status = "busy" if releases.error == "busy" else "unavailable" if releases.error else "partial" if releases.errors else "available"
    return {"checked_at": _now(), "github": {"status": status, "checked_at": releases.checked_at},
            "servers": server_info, "plugins": plugins, "others": others}
