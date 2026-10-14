import gzip
import hashlib
import http.client
import threading
import urllib.error
import zipfile

import pytest

from src.servers import inventory


def make_jar(folder, file, name, version, extra=b""):
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / file
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("plugin.yml", f"name: {name}\nversion: '{version}'\nmain: x.Y\n")
        archive.writestr("x/Y.class", extra or file.encode())
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
def fresh_cache(monkeypatch):
    monkeypatch.delenv("SERVERS_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("PATCHNOTES_GITHUB_TOKEN", raising=False)
    inventory.releases_cache.clear()
    yield
    inventory.releases_cache.clear()


def test_releases_skip_drafts_prereleases_and_releases_without_a_jar():
    data = [
        release("v1.1.0", None, "core-1.1.0.jar", "d1", draft=True),
        release("v1.0.1", "2026-10-02T00:00:00Z", "core-1.0.1.jar", "b2", prerelease=True),
        release("v1.0.0", "2026-10-01T00:00:00Z", "core-1.0.0.jar", "A1"),
        release("v1.0.2", "2026-10-03T00:00:00Z", "core-1.0.2.tar.gz", "c3"),
        release("2.0.0", "2026-10-04T00:00:00Z", "core-2.0.0.jar", "e4"),
    ]
    found = inventory.repo_releases("Core", data)
    assert [(r.version, r.sha256, r.prefix) for r in found] == [("2.0.0", "e4", "core"), ("1.0.0", "a1", "core")]
    assert inventory.repo_releases("Core", {"message": "Not Found"}) == []
    odd = release("v3.0.0", "2026-10-05T00:00:00Z", "core-3.0.0.jar", "f5")
    odd["assets"].insert(0, "not an asset")
    assert [r.version for r in inventory.repo_releases("Core", [odd])] == ["3.0.0"]


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


def servers_fixture(tmp_path):
    """Main and Dev folders with a release, an older release, a test build and a pending update."""
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


def github(shas, fail=False):
    """GitHub's REST API, as read without a token."""
    calls = []

    def fetch(path, body=None):
        calls.append(path)
        if fail:
            raise urllib.error.URLError("down")
        assert body is None, "GraphQL needs a token"
        repos = repo_data(shas)
        if path.startswith("/orgs/"):
            return [{"name": name} for name in repos] + [{"name": "Old", "archived": True}]
        if "/Old/" in path:
            raise AssertionError("archived repositories are not read")
        return next((found for name, found in repos.items() if f"/{name}/" in path), [])

    fetch.calls = calls
    return fetch


def graphql(shas):
    """GitHub's GraphQL API, as read with a token."""
    queries = []
    repos = repo_data(shas)
    branches = {"Core": "main", "Lib": "master", "Docs": "main"}

    def node(r):
        return {"tagName": r["tag_name"], "publishedAt": r["published_at"], "isDraft": r["draft"],
                "isPrerelease": r["prerelease"], "url": r["html_url"], "releaseAssets": {"nodes": r["assets"]}}

    def fetch(path, body=None):
        assert path == "/graphql"
        query, variables = body["query"], body["variables"]
        queries.append(body)
        aliases = sorted(k for k in variables if k[0] == "r")
        if "pageInfo" in query:
            # Two pages, to follow the cursor.
            names = ["Core", "Lib"] if variables["after"] is None else ["Docs"]
            nodes = [{"name": n, "defaultBranchRef": {"name": branches[n]}} for n in names]
            return {"data": {"organization": {"repositories": {
                "pageInfo": {"hasNextPage": variables["after"] is None, "endCursor": "c1"}, "nodes": nodes}}}}
        if "compare" in query:
            data = {}
            for alias in aliases:
                # GitHub can't find Lib's tag.
                data[alias] = {"ref": None} if variables[alias] == "Lib" else {"ref": {"compare": {
                    "status": "AHEAD", "aheadBy": 3}}}
            return {"data": data}
        return {"data": {a: {"releases": {"nodes": [node(r) for r in repos[variables[a]]]}} for a in aliases}}

    fetch.queries = queries
    return fetch


def test_overview_compares_each_server_with_the_releases(tmp_path, monkeypatch):
    main, dev, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVER_MAIN_DIR", str(main))
    monkeypatch.setenv("SERVER_DEV_DIR", str(dev))
    result = inventory.overview(github(shas))

    assert result["github"]["status"] == "available" and not result["github"]["stale"]
    assert [s["status"] for s in result["servers"]] == ["available", "available"]
    assert result["servers"][0]["paper"] == "1.21.10-130" and result["servers"][0]["started"] is True
    plugins = {p["repo"]: p for p in result["plugins"]}
    assert set(plugins) == {"Core", "Lib"}
    assert plugins["Core"]["latest"]["version"] == "1.1.0"
    # Without a token, releases aren't compared with the branch.
    assert plugins["Core"]["latest"]["branch"] is None

    core_main = plugins["Core"]["servers"]["main"]
    assert core_main["state"] == "older_release" and core_main["release"] == "1.0.0"
    assert core_main["update"] is True and core_main["loaded_state"] == "same"
    assert core_main["files"] == ["core-1.0.0.jar", "core-1.1.0.jar"]

    # Same name and version as the release, different bytes: Main only runs releases.
    lib_main = plugins["Lib"]["servers"]["main"]
    assert lib_main["state"] == "not_release" and lib_main["release"] is None

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
    monkeypatch.delenv("SERVER_DEV_DIR", raising=False)
    result = inventory.overview(github(shas))
    plugins = {p["repo"]: p["servers"]["main"] for p in result["plugins"]}
    assert plugins["Core"]["loaded"] == "0.9.0" and plugins["Core"]["loaded_state"] == "different"
    # Lib never enabled in a startup that finished.
    assert plugins["Lib"]["loaded_state"] == "not_loaded"
    assert result["servers"][1]["status"] == "not_configured"
    assert set(result["plugins"][0]["servers"]) == {"main"}


def test_unreadable_servers_and_github(tmp_path, monkeypatch):
    monkeypatch.setenv("SERVER_MAIN_DIR", str(tmp_path / "gone"))
    monkeypatch.setenv("SERVER_DEV_DIR", "")
    result = inventory.overview(github({}, fail=True))
    assert [s["status"] for s in result["servers"]] == ["missing", "not_configured"]
    assert result["github"] == {"status": "unavailable", "checked_at": None, "stale": False}
    assert result["plugins"] == [] and result["others"] == []


def test_releases_are_cached_and_kept_when_github_fails(tmp_path, monkeypatch):
    main, _, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVER_MAIN_DIR", str(main))
    fetch = github(shas)
    inventory.overview(fetch)
    calls = len(fetch.calls)
    inventory.overview(fetch)
    assert len(fetch.calls) == calls

    inventory.releases_cache._next = 0
    inventory.overview(github(shas, fail=True))
    inventory.releases_cache.wait_for_refresh()
    result = inventory.overview(github(shas, fail=True))
    assert result["github"]["status"] == "available" and result["github"]["stale"] is True
    assert {p["repo"] for p in result["plugins"]} == {"Core", "Lib"}


def test_with_a_token_releases_come_from_graphql_and_are_compared_with_the_default_branch(tmp_path, monkeypatch):
    main, _, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVER_MAIN_DIR", str(main))
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    fetch = graphql(shas)
    result = inventory.overview(fetch)
    plugins = {p["repo"]: p for p in result["plugins"]}
    assert set(plugins) == {"Core", "Lib"}
    assert plugins["Core"]["servers"]["main"]["state"] == "older_release"
    assert plugins["Core"]["latest"]["branch"] == {"name": "main", "status": "ahead", "ahead": 3,
                                                   "url": "https://github.com/TF-Minecraft/Core/compare/v1.1.0...main"}
    # GitHub couldn't compare Lib's release with master, so nothing is claimed.
    assert plugins["Lib"]["latest"]["branch"] is None
    # Two pages of repositories, one releases query and one comparison of the latest releases.
    assert len(fetch.queries) == 4
    compare = fetch.queries[-1]["variables"]
    assert {compare["t0"], compare["b0"], compare["t1"], compare["b1"]} == {
        "refs/tags/v1.1.0", "main", "refs/tags/v2.0.0", "master"}


def test_queries_are_split_into_small_groups(tmp_path, monkeypatch):
    _, _, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    monkeypatch.setattr(inventory, "GRAPHQL_CHUNK", 1)
    fetch = graphql(shas)
    assert set(inventory.fetch_releases(fetch)) == {"Core", "Lib"}
    # 2 repository pages, then releases for each of 3 repositories and comparisons for the 2 with releases.
    assert len(fetch.queries) == 7


def test_a_bad_graphql_answer_fails_the_check(monkeypatch):
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    releases, _, failed = inventory.releases_cache.get(lambda path, body=None: {"errors": [{"message": "nope"}]})
    assert releases is None and failed is True


def test_after_the_first_check_releases_refresh_in_the_background(tmp_path, monkeypatch):
    _, _, shas = servers_fixture(tmp_path)
    first, _, _ = inventory.releases_cache.get(github(shas))
    inventory.releases_cache._next = 0
    slow = threading.Event()

    def waiting(path, body=None):
        slow.wait(5)
        raise urllib.error.URLError("down")

    # The expired releases come back at once while GitHub is asked again.
    again, _, failed = inventory.releases_cache.get(waiting)
    assert again is first and failed is False
    slow.set()
    inventory.releases_cache.wait_for_refresh()
    kept, _, failed = inventory.releases_cache.get(waiting)
    assert kept is first and failed is True


def test_github_is_read_by_one_fetch_at_a_time(tmp_path):
    _, _, shas = servers_fixture(tmp_path)
    inventory.releases_cache.get(github(shas))
    inventory.releases_cache._next = 0
    entered, release_it = threading.Event(), threading.Event()
    fetches = []

    def slow(path, body=None):
        if path.startswith("/orgs/"):
            fetches.append(path)
            entered.set()
            release_it.wait(5)
        return github(shas)(path)

    def unused(path, body=None):
        fetches.append("second")
        return github(shas)(path)

    inventory.releases_cache.get(slow)  # starts the background refresh
    assert entered.wait(5)
    # Another page load and a waiting caller share the refresh in flight.
    inventory.releases_cache.get(unused)
    waited = []
    waiter = threading.Thread(target=lambda: waited.append(inventory.releases_cache.get(unused, wait=True)))
    waiter.start()
    waiter.join(0.1)
    assert waiter.is_alive()
    release_it.set()
    waiter.join(5)
    [(releases, _, failed)] = waited
    assert releases is not None and failed is False and len(fetches) == 1


def test_any_fetch_error_is_recorded_for_a_waiting_caller(tmp_path):
    _, _, shas = servers_fixture(tmp_path)
    inventory.releases_cache.get(github(shas))
    inventory.releases_cache._next = 0

    def cut_short(path, body=None):
        raise http.client.IncompleteRead(b"")

    releases, _, failed = inventory.releases_cache.get(cut_short, wait=True)
    assert releases is not None and failed is True


def test_a_fetch_running_when_the_cache_is_cleared_is_ignored(tmp_path):
    _, _, shas = servers_fixture(tmp_path)
    entered, release_it = threading.Event(), threading.Event()

    def slow(path, body=None):
        entered.set()
        release_it.wait(5)
        return github(shas)(path)

    waiter = threading.Thread(target=lambda: inventory.releases_cache.get(slow))
    waiter.start()
    assert entered.wait(5)
    inventory.releases_cache.clear()
    release_it.set()
    waiter.join(5)
    assert inventory.releases_cache._state() == (None, None, False)


def test_a_graphql_error_in_releases_fails_the_check_but_not_in_comparisons(tmp_path, monkeypatch):
    _, _, shas = servers_fixture(tmp_path)
    monkeypatch.setenv("SERVERS_GITHUB_TOKEN", "token")
    fetch = graphql(shas)

    def missing_repository(path, body=None):
        answer = fetch(path, body)
        if "...releases" in body["query"]:
            answer["data"]["r0"] = None
            answer["errors"] = [{"type": "NOT_FOUND", "path": ["r0"]}]
        return answer

    releases, _, failed = inventory.releases_cache.get(missing_repository)
    assert releases is None and failed is True

    def compare_error(path, body=None):
        answer = fetch(path, body)
        if "compare" in body["query"]:
            answer["errors"] = [{"type": "NOT_FOUND", "path": ["r1", "ref"]}]
        return answer

    releases = inventory.fetch_releases(compare_error)
    assert releases["Core"][0].branch["status"] == "ahead" and releases["Lib"][0].branch is None


def test_a_caller_can_wait_for_fresh_releases(tmp_path, monkeypatch):
    _, _, shas = servers_fixture(tmp_path)
    inventory.releases_cache.get(github(shas))
    inventory.releases_cache._next = 0
    releases, _, failed = inventory.releases_cache.get(github(shas, fail=True), wait=True)
    assert releases is not None and failed is True


def test_unreadable_jar_keeps_its_hash_without_a_version(tmp_path):
    folder = tmp_path / "plugins"
    folder.mkdir()
    (folder / "broken.jar").write_bytes(b"not a zip")
    [jar] = inventory.read_jars(folder)
    assert jar.sha256 == hashlib.sha256(b"not a zip").hexdigest()
    assert jar.name is None and jar.version is None


def test_the_route_is_for_admins(database, monkeypatch, tmp_path):
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
