import importlib.util
import json
import signal
from pathlib import Path
from types import SimpleNamespace

import pytest


def load_script(name):
    path = Path(__file__).resolve().parents[3] / "scripts" / name
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


updater = load_script("server-control-update.py")
OLD, NEW = "a" * 40, "b" * 40


@pytest.fixture
def host(tmp_path, monkeypatch):
    """A fake host: installed files, GitHub answers, systemd and the helper sockets."""
    code = tmp_path / "code"
    servers = code / "backend/src/servers"
    servers.mkdir(parents=True)
    pinned = {}
    for name in updater.PINNED:
        path = tmp_path / name.replace("/", "_")
        path.write_bytes(b"pinned " + name.encode())
        pinned[name] = path
    monkeypatch.setattr(updater, "PINNED", pinned)
    for name, value in {"CODE": code, "SERVERS": servers, "RECORD": code / "SOURCE.json", "BACKUPS": tmp_path / "backups",
                        "LOCK": tmp_path / "lock", "LOG": tmp_path / "update.log",
                        "STATE_JOBS": tmp_path / "jobs.json"}.items():
        monkeypatch.setattr(updater, name, value)
    monkeypatch.setattr(updater.os, "geteuid", lambda: 0)
    monkeypatch.setattr(updater.time, "sleep", lambda _: None)

    def tree(tag):
        files = {f"backend/src/servers/{m}": f"# {tag} {m}\n".encode() for m in updater.MODULES}
        files.update({name: b"pinned " + name.encode() for name in pinned})
        return files

    state = SimpleNamespace(commits={OLD: tree("old"), NEW: tree("new")}, on_main={OLD, NEW}, build=True,
                            jobs=[], healthy=[True], active=True, restarts=0, urls=[])
    for module, data in updater.modules_of(state.commits[OLD]).items():
        (servers / module).write_bytes(data)

    def get(url):
        state.urls.append(url)
        if url.endswith("/branches/main"):
            return json.dumps({"commit": {"sha": "d" * 40}}).encode()
        if "/compare/" in url:
            head, commit = url.rsplit("/", 1)[1].split("...")
            assert head == "d" * 40
            return json.dumps({"merge_base_commit": {"sha": commit if commit in state.on_main else "c" * 40}}).encode()
        if "/actions/workflows/build.yml/runs" in url:
            assert "event=push" in url and "branch=main" in url and "status=success" in url
            return json.dumps({"total_count": 1 if state.build else 0}).encode()
        commit, name = url.split(f"{updater.REPO}/", 1)[1].split("/", 1)
        return state.commits[commit][name]

    def run(args, **_):
        if args[:2] == ["systemctl", "restart"]:
            state.restarts += 1
        return SimpleNamespace(returncode=0 if state.active else 3)

    def healthy():
        return state.healthy.pop(0) if len(state.healthy) > 1 else state.healthy[0]

    monkeypatch.setattr(updater, "get", get)
    monkeypatch.setattr(updater.subprocess, "run", run)
    monkeypatch.setattr(updater, "status", lambda path: {"jobs": state.jobs, "allowed_servers": updater.SOCKETS[path]})
    monkeypatch.setattr(updater, "healthy", healthy)
    state.servers = servers
    return state


def modules(host):
    return {m: (host.servers / m).read_bytes() for m in updater.MODULES}


def record():
    return json.loads(updater.RECORD.read_text())["commit"]


def test_arguments_are_one_full_commit(host):
    for args in ([], ["main"], [OLD[:7]], [OLD, NEW], ["--adopt", OLD], [OLD + "\n"], [OLD.upper()]):
        with pytest.raises(SystemExit):
            updater.main(args)


def test_first_run_on_the_installed_commit_only_records_it(host):
    assert updater.main([OLD]) == 0
    assert record() == OLD and host.restarts == 0


def test_update_replaces_modules_restarts_and_keeps_a_backup(host):
    updater.main([OLD])
    before = modules(host)
    assert updater.main([NEW]) == 0
    assert modules(host) == updater.modules_of(host.commits[NEW])
    assert record() == NEW and host.restarts == 1
    backup = next(updater.BACKUPS.iterdir())
    assert {m: (backup / m).read_bytes() for m in updater.MODULES} == before
    assert updater.main([NEW]) == 0 and host.restarts == 1  # already installed
    assert "Installed bbbbbbb" in updater.LOG.read_text()


@pytest.mark.parametrize("problem", ["not_on_main", "no_build", "unit", "updater", "syntax", "busy", "busy_stopped"])
def test_refusals_leave_the_installation_alone(host, problem):
    updater.main([OLD])
    if problem == "not_on_main":
        host.on_main.discard(NEW)
    elif problem == "no_build":
        host.build = False
    elif problem in {"unit", "updater"}:
        name = {"unit": "scripts/tfmc-server-control.service", "updater": "scripts/server-control-update.py"}[problem]
        host.commits[NEW][name] = b"changed"
    elif problem == "syntax":
        host.commits[NEW]["backend/src/servers/host.py"] = b"def broken(:\n"
    elif problem == "busy":
        host.jobs = [{"server": "main", "phase": "countdown"}]
    elif problem == "busy_stopped":
        host.active = False
        updater.STATE_JOBS.write_text(json.dumps({"dev": {"server": "dev", "phase": "installing"}}))
    before = modules(host)
    assert updater.main([NEW]) == 1
    assert modules(host) == before and host.restarts == 0 and record() == OLD
    assert "refused " + NEW in updater.LOG.read_text()


def test_a_review_waiting_for_staff_does_not_block_an_update(host):
    updater.main([OLD])
    host.jobs = [{"server": "main", "phase": "awaiting_review"}]
    assert updater.main([NEW]) == 0


def test_unhealthy_update_restores_the_previous_modules(host):
    updater.main([OLD])
    before = modules(host)
    host.healthy = [False, True]
    assert updater.main([NEW]) == 1
    assert modules(host) == before and host.restarts == 2 and record() == OLD


def test_an_interrupted_install_restores_the_previous_modules(host, monkeypatch):
    updater.main([OLD])
    before = modules(host)
    original, calls = updater.write, []

    def flaky(path, data):
        calls.append(path)
        if len(calls) == 2:
            raise OSError("disk full")
        original(path, data)
    monkeypatch.setattr(updater, "write", flaky)
    assert updater.main([NEW]) == 1
    assert modules(host) == before and record() == OLD


def test_signals_are_blocked_while_files_change(host, monkeypatch):
    updater.main([OLD])
    masks = []
    monkeypatch.setattr(updater.signal, "pthread_sigmask", lambda how, sigs: masks.append((how, set(sigs))) or set())
    assert updater.main([NEW]) == 0
    assert masks[0] == (signal.SIG_BLOCK, {signal.SIGINT, signal.SIGHUP, signal.SIGTERM})
    assert masks[-1][0] == signal.SIG_SETMASK


def test_github_errors_are_reported_without_changes(host, monkeypatch):
    updater.main([OLD])
    def offline(url):
        raise updater.urllib.error.URLError("offline")
    monkeypatch.setattr(updater, "get", offline)
    assert updater.main([NEW]) == 1
    assert "failed " + NEW in updater.LOG.read_text()


def test_log_lines_cannot_be_split(host):
    updater.log("refused x: line one\nfake 2026 entry")
    assert updater.LOG.read_text().count("\n") == 1


def test_old_backups_are_pruned(host):
    updater.BACKUPS.mkdir()
    for i in range(updater.KEEP_BACKUPS + 3):
        (updater.BACKUPS / f"update-{i:03}").mkdir()
        updater.os.utime(updater.BACKUPS / f"update-{i:03}", (i, i))
    updater.prune_backups()
    assert sorted(p.name for p in updater.BACKUPS.iterdir())[0] == "update-003"
