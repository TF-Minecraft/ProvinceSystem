import gzip
import hashlib
import http.client
import os
import threading
import urllib.error
import urllib.parse
import zipfile

import pytest

from src.servers import inventory


def test_bridge_repository_matches_unchanged_runtime_name():
    latest = inventory.Release("TFMCWebBridge", "1.0", "2026-10-17", "", "tfmcweb-1.0.jar", "published")
    jar = inventory.Jar("custom-test.jar", "unpublished", "TFMCWeb", "DEV", False)
    plugins, others = inventory.compare(
        {"TFMCWebBridge": [latest]},
        {"dev": {"jars": [jar], "startup": None, "releases_only": False}},
    )
    assert others == []
    assert plugins[0]["servers"]["dev"]["state"] == "test_build"
    assert plugins[0]["servers"]["dev"]["files"] == ["custom-test.jar"]


def make_jar(folder, file, name, version, extra=b""):
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / file
    with zipfile.ZipFile(path, "w") as archive:
        for entry, content in (("plugin.yml", f"name: {name}\nversion: '{version}'\nmain: x.Y\n"),
                               ("x/Y.class", extra or file.encode())):
            archive.writestr(zipfile.ZipInfo(entry, date_time=(2026, 10, 15, 0, 0, 0)), content)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def release(tag, published, asset, sha, draft=False, prerelease=False):
    return {"tag_name": tag, "published_at": published, "draft": draft, "prerelease": prerelease,
            "html_url": f"https://github.com/o/r/releases/tag/{tag}",
            "assets": [{"name": "SHA256SUMS", "digest": "sha256:aa"},
                       {"name": asset, "digest": f"sha256:{sha}"}]}


def startup_log(*plugins, paper="1.21.10-130", done=True):
    lines = [f"[06:10:00] [ServerMain/INFO]: [bootstrap] Loading Paper {paper} for Minecraft 1.21.10\n"]
    lines += [f"[06:10:29] [Server thread/INFO]: [{n}] Enabling {n} v{v}\n" for n, v in plugins]
    if done:
        lines.append('[06:10:40] [Server thread/INFO]: Done (40.1s)! For help, type "help"\n')
    return "".join(lines)


@pytest.fixture(autouse=True)
def fresh_environment(monkeypatch):
    for name in ("SERVERS_GITHUB_TOKEN", "PATCHNOTES_GITHUB_TOKEN", "SERVERS_GITHUB_ORG",
                 "SERVER_MAIN_DIR", "SERVER_DEV_DIR"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(inventory, "_check_slots", threading.BoundedSemaphore(2))


def servers_fixture(tmp_path):
    """Main and Dev include an old release, test build, duplicate and pending update."""
    main, dev = tmp_path / "main", tmp_path / "dev"
    shas = {
        "core-new": make_jar(tmp_path / "rel", "core-1.1.0.jar", "Core", "1.1.0"),
        "core-old": make_jar(tmp_path / "rel", "core-1.0.0.jar", "Core", "1.0.0"),
        "lib": make_jar(tmp_path / "rel", "lib-2.0.0.jar", "Lib", "2.0.0"),
    }
    make_jar(main / "plugins", "core-1.0.0.jar", "Core", "1.0.0")
    make_jar(main / "plugins", "lib-2.0.0.jar", "Lib", "2.0.0", extra=b"rebuilt")
    make_jar(main / "plugins", "Essentials-2.22.jar", "Essentials", "2.22")
    make_jar(main / "plugins" / "update", "core-1.1.0.jar", "Core", "1.1.0")
    (main / "logs").mkdir()
    (main / "logs" / "latest.log").write_text(startup_log(("Core", "1.0.0"), ("Lib", "2.0.0"), ("Essentials", "2.22")))
    make_jar(dev / "plugins", "core-DEV-branch.jar", "Core", "main-SNAPSHOT")
    make_jar(dev / "plugins", "core-1.1.0.jar", "Core", "1.1.0")
    make_jar(dev / "plugins", "Essentials-2.23.jar", "Essentials", "2.23")
    (dev / "logs").mkdir()
    (dev / "logs" / "latest.log").write_text(startup_log(("Core", "main-SNAPSHOT"), ("Essentials", "2.23")))
    return main, dev, shas


def repo_data(shas):
    return {
        "Core": [release("v1.1.0", "2026-10-02T00:00:00Z", "core-1.1.0.jar", shas["core-new"]),
                 release("v1.0.0", "2026-10-01T00:00:00Z", "core-1.0.0.jar", shas["core-old"])],
        "Lib": [release("v2.0.0", "2026-10-01T00:00:00Z", "lib-2.0.0.jar", shas["lib"])],
        "Docs": [],
    }


class Github:
    """A strict REST/GraphQL fixture with independent discovery, latest and history calls."""
    def __init__(self, repos, *, failed=(), history_failed=(), heads=None, commits=None, latest=None):
        self.repos = repos
        self.failed = set(failed)
        self.history_failed = set(history_failed)
        self.heads = heads or {}
        self.commits = commits or {}
        self.latest = latest or {}
        self.calls = []

    @property
    def queries(self):
        return [body for path, body in self.calls if path == "/graphql"]

    def node(self, repo, row):
        assets = row["assets"]
        return {"tagName": row["tag_name"], "publishedAt": row["published_at"], "isDraft": row["draft"],
                "isPrerelease": row["prerelease"], "url": row["html_url"],
                "tagCommit": {"oid": self.commits.get(repo, "same")},
                "releaseAssets": {"nodes": assets[:20], "pageInfo": {
                    "hasNextPage": len(assets) > 20, "endCursor": "20"}}}

    def latest_row(self, repo):
        rows = self.repos[repo]
        return next((r for r in rows if r["tag_name"] == self.latest[repo]), None) if repo in self.latest else next(iter(rows), None)

    def __call__(self, path, body=None):
        self.calls.append((path, body))
        if path.startswith("/orgs/"):
            assert body is None
            return [{"name": name} for name in self.repos] + [{"name": "Old", "archived": True}]
        if path != "/graphql":
            assert body is None
            parts = urllib.parse.urlsplit(path)
            repo = parts.path.split("/")[3]
            assert repo != "Old", "archived repositories must be excluded"
            if repo in self.failed:
                raise urllib.error.URLError("repo down")
            if parts.path.endswith("/releases/latest"):
                row = self.latest_row(repo)
                if row is None:
                    raise urllib.error.HTTPError(path, 404, "not found", {}, None)
                return row
            assert parts.path.endswith("/releases")
            assert repo not in self.history_failed or self._history_failure()
            query = urllib.parse.parse_qs(parts.query)
            assert query["per_page"] == ["30"]
            start = (int(query["page"][0]) - 1) * 30
            return self.repos[repo][start:start + 30]
        query, variables = body["query"], body["variables"]
        if "organization(login" in query:
            assert "defaultBranchRef" not in query
            names = list(self.repos)
            page = names[:2] if variables["after"] is None else names[2:]
            return {"data": {"organization": {"repositories": {"nodes": [{"name": n} for n in page],
                    "pageInfo": {"hasNextPage": variables["after"] is None and len(names) > 2, "endCursor": "repos2"}}}}}
        if "latestRelease" in query:
            data = {}
            for alias in sorted(k for k in variables if k.startswith("r") and k[1:].isdigit()):
                repo = variables[alias]
                row = self.latest_row(repo)
                data[alias] = None if repo in self.failed else {
                    "name": repo, "defaultBranchRef": {"name": "master" if repo == "Lib" else "main",
                                                          "target": {"oid": self.heads.get(repo, "same")}},
                    "latestRelease": self.node(repo, row) if row else None}
            return {"data": data, **({"errors": [{"type": "NOT_FOUND"}]} if self.failed else {})}
        if "compare(headRef" in query:
            return {"data": {alias: {"ref": {"compare": {"status": "AHEAD", "aheadBy": 3}}}
                             for alias in variables if alias.startswith("r") and alias[1:].isdigit()}}
        repo = variables["repo"]
        if "releaseAssets(first:20,after:" in query:
            row = next(r for r in self.repos[repo] if r["tag_name"] == variables["tag"])
            start = int(variables["after"])
            assets = row["assets"][start:start + 20]
            return {"data": {"repository": {"release": {"releaseAssets": {"nodes": assets,
                    "pageInfo": {"hasNextPage": start + 20 < len(row["assets"]), "endCursor": str(start + 20)}}}}}}
        if "releases(first:30" in query:
            if repo in self.history_failed:
                self._history_failure()
            start = int(variables["after"] or 0)
            rows = self.repos[repo][start:start + 30]
            return {"data": {"repository": {"releases": {"nodes": [self.node(repo, r) for r in rows],
                    "pageInfo": {"hasNextPage": start + 30 < len(self.repos[repo]), "endCursor": str(start + 30)}}}}}
        assert "release(tagName:$t" in query, query
        tags = {k: tag for k, tag in variables.items() if k.startswith("t") and k[1:].isdigit()}
        return {"data": {"repository": {alias: next((self.node(repo, row) for row in self.repos[repo]
                    if row["tag_name"] == tag), None) for alias, tag in tags.items()}}}

    @staticmethod
    def _history_failure():
        raise http.client.IncompleteRead(b"")


def github(shas, fail=False):
    if fail:
        def failed(path, body=None, **_kwargs):
            raise urllib.error.URLError("down")
        return failed
    return Github(repo_data(shas))


def test_releases_skip_drafts_prereleases_and_releases_without_a_jar():
    data = [release("v1.1.0", None, "core-1.1.0.jar", "d1", draft=True),
            release("v1.0.1", "2026-10-02T00:00:00Z", "core-1.0.1.jar", "b2", prerelease=True),
            release("v1.0.0", "2026-10-01T00:00:00Z", "core-1.0.0.jar", "A1"),
            release("v1.0.2", "2026-10-03T00:00:00Z", "core-1.0.2.tar.gz", "c3"),
            release("2.0.0", "2026-10-04T00:00:00Z", "core-2.0.0.jar", "e4")]
    found = inventory.repo_releases("Core", data)
    assert [(r.version, r.sha256, r.prefix) for r in found] == [("2.0.0", "e4", "core"), ("1.0.0", "a1", "core")]
    assert inventory.repo_releases("Core", {"message": "Not Found"}) == []
    odd = release("v3.0.0", "2026-10-05T00:00:00Z", "core-3.0.0.jar", "f5")
    odd["assets"].insert(0, "not an asset")
    assert [r.version for r in inventory.repo_releases("Core", [odd])] == ["3.0.0"]


def test_overview_compares_each_server_with_verified_releases(tmp_path, monkeypatch):
    main, dev, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVER_MAIN_DIR", str(main))
    monkeypatch.setenv("SERVER_DEV_DIR", str(dev))
    result = inventory.overview(github(shas))
    assert result["github"]["status"] == "available" and result["github"]["checked_at"]
    assert "stale" not in result["github"]
    assert [s["status"] for s in result["servers"]] == ["available", "available"]
    assert result["servers"][0]["paper"] == "1.21.10-130" and result["servers"][0]["started"] is True
    plugins = {p["repo"]: p for p in result["plugins"]}
    assert set(plugins) == {"Core", "Lib"}
    assert plugins["Core"]["latest"]["version"] == "1.1.0"
    assert plugins["Core"]["latest"]["branch"] is None
    core_main = plugins["Core"]["servers"]["main"]
    assert core_main["state"] == "older_release" and core_main["release"] == "1.0.0"
    assert core_main["update"] is True and core_main["loaded_state"] == "same"
    assert core_main["files"] == ["core-1.0.0.jar", "core-1.1.0.jar"]
    assert plugins["Lib"]["servers"]["main"]["state"] == "not_release"
    core_dev = plugins["Core"]["servers"]["dev"]
    assert core_dev["state"] == "test_build" and core_dev["duplicate"] is True
    assert core_dev["loaded"] == "main-SNAPSHOT" and core_dev["loaded_state"] == "same"
    assert plugins["Lib"]["servers"]["dev"]["state"] == "missing"
    assert result["others"] == [{"name": "Essentials", "differs": True, "servers": {
        "main": {"file": "Essentials-2.22.jar", "version": "2.22"},
        "dev": {"file": "Essentials-2.23.jar", "version": "2.23"}}}]


def test_a_newer_jar_than_the_running_one_waits_for_a_restart(tmp_path, monkeypatch):
    main, _, shas = servers_fixture(tmp_path)
    (main / "logs" / "latest.log").write_text(startup_log(("Core", "0.9.0")))
    monkeypatch.setenv("SERVER_MAIN_DIR", str(main))
    result = inventory.overview(github(shas))
    plugins = {p["repo"]: p["servers"]["main"] for p in result["plugins"]}
    assert plugins["Core"]["loaded"] == "0.9.0" and plugins["Core"]["loaded_state"] == "different"
    assert plugins["Lib"]["loaded_state"] == "not_loaded"
    assert result["servers"][1]["status"] == "not_configured"
    assert set(result["plugins"][0]["servers"]) == {"main"}


def test_unreadable_servers_and_github(tmp_path, monkeypatch):
    monkeypatch.setenv("SERVER_MAIN_DIR", str(tmp_path / "gone"))
    result = inventory.overview(github({}, fail=True))
    assert [s["status"] for s in result["servers"]] == ["missing", "not_configured"]
    assert result["github"] == {"status": "unavailable", "checked_at": None}
    assert result["plugins"] == [] and result["others"] == []


@pytest.mark.parametrize("authenticated", [False, True])
def test_every_check_reads_the_designated_latest_release_fresh(tmp_path, monkeypatch, authenticated):
    _, _, shas = servers_fixture(tmp_path)
    if authenticated:
        monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    fetch = github(shas)
    first = inventory.fetch_releases(fetch)
    fetch.repos["Core"].insert(0, release("v1.2.0", "2026-10-03T00:00:00Z", "core-1.2.0.jar", "new"))
    second = inventory.fetch_releases(fetch)
    assert first["Core"][0].version == "1.1.0"
    assert second["Core"][0].version == "1.2.0"
    assert first is not second
    assert first.error is None and second.checked_at
    if authenticated:
        assert sum("organization(login" in b["query"] for b in fetch.queries) == 4
    else:
        assert sum(p.startswith("/orgs/") for p, _ in fetch.calls) == 2


@pytest.mark.parametrize("authenticated", [False, True])
def test_latest_is_github_designation_instead_of_newest_published_date(monkeypatch, authenticated):
    if authenticated:
        monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    fetch = Github({"Core": [release("v1.0.1", "2026-10-15T00:00:00Z", "core-1.0.1.jar", "old"),
                              release("v2.0.0", "2026-10-01T00:00:00Z", "core-2.0.0.jar", "new")]},
                   latest={"Core": "v2.0.0"})
    assert inventory.fetch_releases(fetch)["Core"][0].version == "2.0.0"


def test_identical_commits_annotated_tag_commit_skip_compare(tmp_path, monkeypatch):
    _, _, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    fetch = github(shas)
    found = inventory.fetch_releases(fetch)
    assert found["Core"][0].branch["status"] == "identical"
    assert found["Lib"][0].branch["name"] == "master"
    assert not any("compare(headRef" in q["query"] for q in fetch.queries)
    latest_queries = [q["query"] for q in fetch.queries if "latestRelease" in q["query"]]
    assert latest_queries and all("tagCommit { oid }" in q for q in latest_queries)
    assert all("target { oid }" in q for q in latest_queries)


def test_unequal_commits_only_compare_mismatches_and_unknown_tag_commit_stays_unknown(tmp_path, monkeypatch):
    _, _, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    fetch = Github(repo_data(shas), heads={"Core": "head"}, commits={"Lib": None})
    found = inventory.fetch_releases(fetch)
    assert found["Core"][0].branch == {"name": "main", "status": "ahead", "ahead": 3,
        "url": "https://github.com/TF-Minecraft/Core/compare/v1.1.0...main"}
    assert found["Lib"][0].branch is None
    [compared] = [q for q in fetch.queries if "compare(headRef" in q["query"]]
    assert compared["variables"] == {"org": "TF-Minecraft", "r0": "Core", "t0": "refs/tags/v1.1.0", "b0": "main"}


def test_latest_queries_are_split_into_bounded_chunks(tmp_path, monkeypatch):
    _, _, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    monkeypatch.setattr(inventory, "GRAPHQL_CHUNK", 1)
    fetch = github(shas)
    found = inventory.fetch_releases(fetch)
    assert set(found) == {"Core", "Lib"} and found.repos == {"Core", "Lib", "Docs"}
    assert len([q for q in fetch.queries if "latestRelease" in q["query"]]) == 3


def test_partial_latest_failure_keeps_successful_repo_and_local_plugin_visible(tmp_path, monkeypatch):
    main, _, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    monkeypatch.setenv("SERVER_MAIN_DIR", str(main))
    result = inventory.overview(Github(repo_data(shas), failed={"Core"}))
    assert result["github"]["status"] == "partial"
    plugins = {p["repo"]: p for p in result["plugins"]}
    assert plugins["Lib"]["latest"]["version"] == "2.0.0"
    assert plugins["Core"]["latest"] is None and plugins["Core"]["error"] == "github_unavailable"
    assert plugins["Core"]["servers"]["main"]["state"] == "unverified"
    assert plugins["Core"]["servers"]["main"]["version"] == "1.0.0"


def test_global_failure_does_not_reuse_previous_releases_and_keeps_local_inventory(tmp_path, monkeypatch):
    main, _, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVER_MAIN_DIR", str(main))
    inventory.overview(github(shas))
    failed = inventory.overview(github({}, fail=True))
    assert failed["github"] == {"status": "unavailable", "checked_at": None}
    assert failed["plugins"] == []
    assert {p["name"] for p in failed["others"]} == {"Core", "Lib", "Essentials"}
    assert all(p["unverified"] for p in failed["others"])
    assert failed["servers"][0]["paper"] == "1.21.10-130"


def test_bad_graphql_answer_fails_fresh_check(monkeypatch):
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    found = inventory.fetch_releases(lambda path, body=None: {"errors": [{"message": "nope"}]})
    assert found.error == "github_unavailable" and not found and found.checked_at is None


def test_exact_old_release_tag_verifies_hash_without_history(tmp_path, monkeypatch):
    main = tmp_path / "main"
    sha = make_jar(main / "plugins", "renamed.jar", "Core", "1.0.0")
    rows = [release("v2.0.0", "2026-10-02T00:00:00Z", "core-2.0.0.jar", "new"),
            release("v1.0.0", "2026-10-01T00:00:00Z", "core-1.0.0.jar", sha)]
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    fetch = Github({"Core": rows})
    found, servers = inventory.check_servers({"main": (main, True)}, fetch)
    [plugin], others = inventory.compare(found, servers)
    assert plugin["servers"]["main"]["state"] == "older_release" and not others
    assert plugin["latest"]["version"] == "2.0.0"
    assert any("release(tagName:$t" in q["query"] for q in fetch.queries)
    assert not any("releases(first:30" in q["query"] for q in fetch.queries)
    assert {v for q in fetch.queries for k, v in q["variables"].items() if k.startswith("t")} >= {"v1.0.0", "1.0.0"}


@pytest.mark.parametrize("authenticated", [False, True])
def test_history_paginates_past_thirty_and_recognises_renamed_old_jar(tmp_path, monkeypatch, authenticated):
    if authenticated:
        monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    root = tmp_path / "main"
    sha = make_jar(root / "plugins", "old-engine-custom.jar", "Core", "legacy")
    rows = [release(f"v2.0.{i}", "2026-10-15T00:00:00Z", f"core-2.0.{i}.jar", str(i)) for i in range(31)]
    rows.append(release("v0.9.0", "2025-01-01T00:00:00Z", "ancient-0.9.0.jar", sha))
    fetch = Github({"Core": rows})
    found, servers = inventory.check_servers({"main": (root, True)}, fetch)
    [plugin], others = inventory.compare(found, servers)
    assert plugin["servers"]["main"]["state"] == "older_release"
    assert plugin["servers"]["main"]["release"] == "0.9.0" and not others
    if authenticated:
        pages = [q["variables"]["after"] for q in fetch.queries if "releases(first:30" in q["query"]]
        assert pages == [None, "30"]
    else:
        assert any("per_page=30&page=2" in p for p, _ in fetch.calls)


def test_asset_connection_paginates_before_resolving_old_hash(tmp_path, monkeypatch):
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    root = tmp_path / "main"
    sha = make_jar(root / "plugins", "renamed.jar", "Core", "1.0.0")
    old = release("v1.0.0", "2026-10-01T00:00:00Z", "core-1.0.0.jar", sha)
    old["assets"] = [{"name": f"notes-{n}.txt", "digest": "sha256:notes"} for n in range(25)] + old["assets"]
    fetch = Github({"Core": [release("v2.0.0", "2026-10-02T00:00:00Z", "core-2.0.0.jar", "new"), old]})
    found, servers = inventory.check_servers({"main": (root, True)}, fetch)
    [plugin], _ = inventory.compare(found, servers)
    assert plugin["servers"]["main"]["state"] == "older_release"
    assert any("releaseAssets(first:20,after:" in q["query"] for q in fetch.queries)


@pytest.mark.parametrize("authenticated", [False, True])
def test_incomplete_history_stays_unverified_instead_of_claiming_a_test_build(tmp_path, monkeypatch, authenticated):
    if authenticated:
        monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    root = tmp_path / "dev"
    make_jar(root / "plugins", "core-branch.jar", "Core", "main-SNAPSHOT")
    fetch = Github({"Core": [release("v2.0.0", "2026-10-02T00:00:00Z", "core-2.0.0.jar", "new")]}, history_failed={"Core"})
    found, servers = inventory.check_servers({"dev": (root, False)}, fetch)
    [plugin], _ = inventory.compare(found, servers)
    assert plugin["servers"]["dev"]["state"] == "unverified"
    assert "Core" not in found.complete


def test_same_size_same_mtime_jar_bytes_are_read_again(tmp_path):
    plugins = tmp_path / "plugins"
    first = make_jar(plugins, "core.jar", "Core", "1.0.0", b"AAAA")
    [original] = inventory.read_jars(plugins)
    path = plugins / "core.jar"
    stamp = path.stat()
    second = make_jar(plugins, "core.jar", "Core", "1.0.0", b"BBBB")
    os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    [changed] = inventory.read_jars(plugins)
    assert path.stat().st_size == stamp.st_size
    assert path.stat().st_mtime_ns == stamp.st_mtime_ns
    assert original.sha256 == first and changed.sha256 == second and first != second


def test_two_checks_have_independent_results_and_third_returns_busy_with_local_files(tmp_path, monkeypatch):
    root = tmp_path / "dev"
    make_jar(root / "plugins", "core.jar", "Core", "1.0.0")
    entered = [threading.Event(), threading.Event()]
    release_work = threading.Event()
    results = [None, None]
    calls = []
    workers = []
    def fetch(index):
        def answer(path, body=None):
            calls.append((index, path))
            if path.startswith("/orgs/"):
                entered[index].set()
                assert release_work.wait(5), "test did not release GitHub worker"
            return Github({"Core": [release(f"v{index + 1}.0.0", "2026-10-01T00:00:00Z", f"core-{index + 1}.0.0.jar", str(index))]})(path, body)
        return answer
    def run(index):
        results[index] = inventory.fetch_releases(fetch(index))
    try:
        for i in range(2):
            worker = threading.Thread(target=run, args=(i,))
            workers.append(worker)
            worker.start()
            assert entered[i].wait(3)
        busy, local = inventory.check_servers({"dev": (root, False)}, lambda *_: pytest.fail("busy check fetched GitHub"))
        assert busy.error == "busy" and busy.checked_at is None
        assert local["dev"]["jars"][0].name == "Core"
        assert {i for i, path in calls if path.startswith("/orgs/")} == {0, 1}
    finally:
        release_work.set()
        for worker in workers:
            worker.join(5)
            assert not worker.is_alive()
    assert [r["Core"][0].version for r in results] == ["1.0.0", "2.0.0"]
def test_startup_comes_from_the_newest_log_that_has_one(tmp_path):
    logs = tmp_path / "logs"
    logs.mkdir()
    # After midnight, latest.log holds no startup; the rotated logs are read newest first.
    (logs / "latest.log").write_text("[00:01:00] [Server thread/INFO]: nothing\n")
    with gzip.open(logs / "2026-10-10-2.log.gz", "wt") as handle:
        handle.write(startup_log(("Core", "0.9"), paper="old"))
    with gzip.open(logs / "2026-10-10-10.log.gz", "wt") as handle:
        handle.write(startup_log(("Core", "1.1"), done=False))
    startup = inventory.read_startup(logs)
    assert startup == {"paper": "1.21.10-130", "done": False, "log": "2026-10-10-10.log.gz",
                       "enabled": {"core": "1.1"}, "failed": {}}
    assert inventory.read_startup(tmp_path / "nowhere") is None



def test_unreadable_jar_keeps_its_hash_without_a_version(tmp_path):
    folder = tmp_path / "plugins"
    folder.mkdir()
    (folder / "broken.jar").write_bytes(b"not a zip")
    [jar] = inventory.read_jars(folder)
    assert jar.sha256 == hashlib.sha256(b"not a zip").hexdigest()
    assert jar.name is None and jar.version is None


def test_the_route_is_for_admins(database, postgres, monkeypatch, tmp_path):
    from fastapi import FastAPI

    from src.api import admin_routes, auth_routes
    from src.auth.test_admin import account, client

    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", "https://www.tfminecraft.net")
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    monkeypatch.delenv("SERVER_MAIN_DIR", raising=False)
    monkeypatch.delenv("SERVER_DEV_DIR", raising=False)
    monkeypatch.setattr(inventory, "_github", github({}, fail=True))
    app = FastAPI()
    app.include_router(auth_routes.auth_router)
    admin_routes.install(app)

    _, mod = account(database, "moddy", "mod")
    _, admin = account(database, "boss", "admin")
    assert client(app).get("/admin/servers").status_code == 401
    assert client(app, mod).get("/admin/servers").json() == {"detail": "forbidden"}
    response = client(app, admin).get("/admin/servers")
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    assert [s["status"] for s in response.json()["servers"]] == ["not_configured", "not_configured"]


@pytest.mark.parametrize('failure', [
    '[06:10:30] [Server thread/ERROR]: Error occurred while enabling Core v1.1 (Is it up to date?)\n',
    '[06:10:30] [Server thread/INFO]: [Core] Disabling Core v1.1\n',
])
def test_failed_or_disabled_plugin_is_not_counted_as_enabled(tmp_path, failure):
    text = startup_log(('Core', '1.1'), ('Other', '2.0'))
    (tmp_path / 'latest.log').write_text(text.replace('[06:10:40]', failure + '[06:10:40]'))
    assert inventory.read_startup(tmp_path)['enabled'] == {'other': '2.0'}


def test_plugin_text_quoting_an_enable_failure_is_not_a_failure(tmp_path):
    (tmp_path / "latest.log").write_text(
        "[06:10:00] [ServerMain/INFO]: [bootstrap] Loading Paper 1.21.10-130-main@abc\n"
        "[06:10:20] [Server thread/INFO]: [Core] Enabling Core v1.1\n"
        "[06:10:21] [Server thread/INFO]: [Chat] Player said: Error occurred while enabling Core v1.1\n"
        "[06:10:40] [Server thread/INFO]: Done (40.0s)! For help, type \"help\"\n")
    startup = inventory.read_startup(tmp_path)
    assert startup["enabled"] == {"core": "1.1"} and startup["failed"] == {}


def test_partial_graphql_error_cannot_disguise_failed_latest_as_no_releases(monkeypatch):
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    base = Github({"Core": [release("v1.0.0", "2026-10-01T00:00:00Z", "core-1.0.0.jar", "known")]})
    def failed_latest(path, body=None):
        result = base(path, body)
        if "latestRelease" in body["query"]:
            result["data"]["r0"]["latestRelease"] = None
            result["errors"] = [{"message": "temporary failure", "path": ["r0", "latestRelease"]}]
        return result
    found = inventory.fetch_releases(failed_latest)
    assert found.errors == {"Core": "github_unavailable"} and not found


def test_failed_branch_compare_keeps_latest_release_without_claiming_identity(monkeypatch):
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    base = Github({"Core": [release("v1.0.0", "2026-10-01T00:00:00Z", "core-1.0.0.jar", "known")]},
                  heads={"Core": "changed"})
    def failed_compare(path, body=None):
        if "compare(headRef" in body["query"]:
            return {"data": {"r0": {"ref": None}}, "errors": [{"path": ["r0", "ref"], "message": "unknown tag"}]}
        return base(path, body)
    found = inventory.fetch_releases(failed_compare)
    assert found["Core"][0].version == "1.0.0" and found["Core"][0].branch is None


@pytest.mark.parametrize("authenticated", [False, True])
def test_failure_after_full_first_history_page_cannot_prove_unreleased_bytes(tmp_path, monkeypatch, authenticated):
    if authenticated:
        monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    root = tmp_path / "dev"
    make_jar(root / "plugins", "core-branch.jar", "Core", "branch-SNAPSHOT")
    base = Github({"Core": [release(f"v2.0.{i}", "2026-10-01T00:00:00Z", f"core-2.0.{i}.jar", str(i)) for i in range(31)]})
    def partial_history(path, body=None):
        if (body and "releases(first:30" in body["query"] and body["variables"]["after"] == "30") or "page=2" in path:
            raise urllib.error.URLError("history page two down")
        return base(path, body)
    found, local = inventory.check_servers({"dev": (root, False)}, partial_history)
    [plugin], _ = inventory.compare(found, local)
    assert plugin["servers"]["dev"]["state"] == "unverified"
    assert "Core" not in found.complete


def test_latest_asset_connection_paginates_beyond_first_twenty_assets(monkeypatch):
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    row = release("v1.0.0", "2026-10-01T00:00:00Z", "core-1.0.0.jar", "known")
    row["assets"] = [{"name": f"notes-{n}.txt", "digest": "sha256:notes"} for n in range(25)] + row["assets"]
    fetch = Github({"Core": [row]})
    found = inventory.fetch_releases(fetch)
    assert found["Core"][0].sha256 == "known" and found["Core"][0].branch["status"] == "identical"
    assert any("releaseAssets(first:20,after:" in q["query"] for q in fetch.queries)


def test_local_inventory_and_github_reads_overlap(tmp_path, monkeypatch):
    root = tmp_path / "main"
    make_jar(root / "plugins", "core.jar", "Core", "1.0.0")
    local_started, remote_started = threading.Event(), threading.Event()
    original = inventory._local_server
    def local(*args):
        local_started.set()
        assert remote_started.wait(3), "GitHub work waited for local inventory"
        return original(*args)
    def remote(path, body=None):
        remote_started.set()
        assert local_started.wait(3), "local inventory waited for GitHub"
        return []
    monkeypatch.setattr(inventory, "_local_server", local)
    found, servers = inventory.check_servers({"main": (root, True)}, remote)
    assert found.error is None and servers["main"]["jars"][0].name == "Core"


@pytest.mark.parametrize("authenticated", [False, True])
@pytest.mark.parametrize("releases_only", [False, True])
def test_exhausted_history_with_missing_jar_digest_keeps_unmatched_bytes_unverified(tmp_path, monkeypatch, authenticated, releases_only):
    if authenticated:
        monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    key = "main" if releases_only else "dev"
    root = tmp_path / key
    make_jar(root / "plugins", "core-custom.jar", "Core", "legacy")
    old = release("v1.0.0", "2026-09-01T00:00:00Z", "core-1.0.0.jar", "unknown")
    old["assets"][-1]["digest"] = None
    fetch = Github({"Core": [release("v2.0.0", "2026-10-01T00:00:00Z", "core-2.0.0.jar", "new"), old]})
    found, local = inventory.check_servers({key: (root, releases_only)}, fetch)
    [plugin], others = inventory.compare(found, local)
    assert plugin["servers"][key]["state"] == "unverified" and not others
    assert plugin["servers"][key]["release"] is None
    assert "Core" not in found.complete


@pytest.mark.parametrize("authenticated", [False, True])
def test_positive_historical_hash_wins_even_when_another_release_has_no_jar_digest(tmp_path, monkeypatch, authenticated):
    if authenticated:
        monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    root = tmp_path / "main"
    sha = make_jar(root / "plugins", "renamed-engine.jar", "Core", "legacy")
    unknown = release("v1.5.0", "2026-09-15T00:00:00Z", "core-1.5.0.jar", "unknown")
    unknown["assets"][-1]["digest"] = None
    rows = [release("v2.0.0", "2026-10-01T00:00:00Z", "core-2.0.0.jar", "new"), unknown,
            release("v1.0.0", "2026-09-01T00:00:00Z", "core-1.0.0.jar", sha)]
    found, local = inventory.check_servers({"main": (root, True)}, Github({"Core": rows}))
    [plugin], others = inventory.compare(found, local)
    copy = plugin["servers"]["main"]
    assert copy["state"] == "older_release" and copy["release"] == "1.0.0" and not others
    assert plugin["latest"]["version"] == "2.0.0"


@pytest.mark.parametrize("authenticated", [False, True])
def test_second_jar_asset_in_a_historical_release_can_prove_the_installed_release(tmp_path, monkeypatch, authenticated):
    if authenticated:
        monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    root = tmp_path / "main"
    sha = make_jar(root / "plugins", "renamed-engine.jar", "Core", "legacy")
    old = release("v1.0.0", "2026-09-01T00:00:00Z", "core-api-1.0.0.jar", "f" * 64)
    old["assets"].append({"name": "core-1.0.0.jar", "digest": f"sha256:{sha}"})
    rows = [release("v2.0.0", "2026-10-01T00:00:00Z", "core-2.0.0.jar", "new"), old]
    found, local = inventory.check_servers({"main": (root, True)}, Github({"Core": rows}))
    [plugin], others = inventory.compare(found, local)
    assert plugin["servers"]["main"]["state"] == "older_release" and not others
    assert plugin["servers"]["main"]["release"] == "1.0.0"
    assert sha in {r.sha256 for r in found["Core"]}


def test_http_body_trickle_cannot_extend_the_check_deadline(monkeypatch):
    import http.server
    import time
    from contextlib import contextmanager

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            try:
                for byte in b'{"value":"a deliberately slow JSON body"}':
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                    time.sleep(.02)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    original = inventory.urllib.request.urlopen

    @contextmanager
    def local(_request, timeout):
        with original(f"http://127.0.0.1:{server.server_port}/", timeout=timeout) as response:
            yield response

    monkeypatch.setattr(inventory.urllib.request, "urlopen", local)
    start = time.monotonic()
    try:
        with pytest.raises((TimeoutError, OSError)):
            inventory._github("/graphql", timeout=.1)
        assert time.monotonic() - start < .4
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)
