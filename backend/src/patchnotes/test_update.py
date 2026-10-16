"""Patch note updater tests with GitHub and systemd faked."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "patchnotes-update.py"
_SPEC = importlib.util.spec_from_file_location("patchnotes_update", _SCRIPT)
updater = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(updater)

OLD, NEW = "a" * 40, "b" * 40


@pytest.fixture
def host(tmp_path, monkeypatch):
    """A fake host: the install folder, pinned files, GitHub answers and the worker's systemd state."""
    root = tmp_path / "lib"
    pinned = {}
    for name in updater.PINNED:
        path = tmp_path / "pinned" / name.replace("/", "_")
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(b"pinned " + name.encode())
        pinned[name] = path
    for name, value in {"ROOT": root, "CURRENT": root / "current", "LOCK": tmp_path / "lock",
                        "LOG": tmp_path / "update.log", "PINNED": pinned, "OWNER": os.getuid()}.items():
        monkeypatch.setattr(updater, name, value)
    monkeypatch.setattr(updater.os, "geteuid", lambda: 0)
    monkeypatch.setattr(updater.time, "sleep", lambda _: None)

    def tree(tag):
        files = {"__init__.py": b"", "rewrite_worker.py": f"TAG = {tag!r}\n".encode(),
                 "watch_plugins.py": b"", "weekly_run.py": b"", "test_rewrite_worker.py": b"import pytest\n"}
        files.update({name: b"pinned " + name.encode() for name in pinned})
        return files

    state = SimpleNamespace(commits={OLD: tree("old"), NEW: tree("new")}, on_main={OLD, NEW}, build=True,
                            extra=[], up={OLD: True, NEW: True}, flaky=set(), pid=100, calls=[])

    def get(url):
        if url.endswith("/branches/main"):
            return json.dumps({"commit": {"sha": "d" * 40}}).encode()
        if "/compare/" in url:
            commit = url.rsplit("...", 1)[1]
            return json.dumps({"merge_base_commit": {"sha": commit if commit in state.on_main else "c" * 40}}).encode()
        if "/actions/workflows/build.yml/runs" in url:
            assert "event=push" in url and "branch=main" in url and "status=success" in url
            return json.dumps({"total_count": 1 if state.build else 0}).encode()
        if "/contents/" in url:
            commit = url.rsplit("ref=", 1)[1]
            listing = [{"name": name, "type": "file"} for name in state.commits[commit] if "/" not in name]
            return json.dumps(listing + state.extra).encode()
        commit, name = url.split(f"{updater.REPO}/", 1)[1].split("/", 1)
        return state.commits[commit][name.removeprefix(f"{updater.PACKAGE}/")]

    def run(args, **_):
        state.calls.append(args[:2])
        running = updater.installed_commit() if updater.CURRENT.is_symlink() else ""
        if args[:2] == ["systemctl", "show"]:
            if running in state.flaky:
                state.pid += 1  # A crash loop: active, but a new process each time.
            active = state.up.get(running)
            return SimpleNamespace(returncode=0, stdout=f"MainPID={state.pid if active else 0}\n"
                                                        f"ActiveState={'active' if active else 'activating'}\n")
        return SimpleNamespace(returncode=0, stdout="")

    monkeypatch.setattr(updater, "get", get)
    monkeypatch.setattr(updater.subprocess, "run", run)
    state.root = root
    return state


def tag(host):
    return (host.root / "current/patchnotes/rewrite_worker.py").read_text()


def restarts(host):
    return host.calls.count(["systemctl", "restart"])


def test_installs_the_package_without_tests(host):
    assert updater.main([OLD]) == 0
    assert tag(host) == "TAG = 'old'\n"
    assert sorted(p.name for p in (host.root / "current/patchnotes").iterdir()) == [
        "__init__.py", "rewrite_worker.py", "watch_plugins.py", "weekly_run.py"]
    assert updater.installed_commit() == OLD
    assert restarts(host) == 1

    assert updater.main([NEW]) == 0
    assert tag(host) == "TAG = 'new'\n"
    assert (host.root / OLD).is_dir()


def test_same_commit_is_left_alone(host):
    updater.main([OLD])
    assert updater.main([OLD]) == 0
    assert restarts(host) == 1


@pytest.mark.parametrize("problem", ["off_main", "no_build", "broken", "missing", "subfolder", "data_file", "pinned"])
def test_refuses_before_touching_the_install(host, problem):
    updater.main([OLD])
    new = host.commits[NEW]
    if problem == "off_main":
        host.on_main.discard(NEW)
    elif problem == "no_build":
        host.build = False
    elif problem == "broken":
        new["rewrite_worker.py"] = b"def broken(:\n"
    elif problem == "missing":
        del new["weekly_run.py"]
    elif problem == "subfolder":
        host.extra.append({"name": "rules", "type": "dir"})
    elif problem == "data_file":
        new["rules.yml"] = b"a: 1\n"
    else:
        new["scripts/tfmc-patchnotes-watch.service"] = b"changed"
    assert updater.main([NEW]) == 1
    assert updater.installed_commit() == OLD
    assert not (host.root / NEW).exists()
    assert restarts(host) == 1
    assert "refused" in updater.LOG.read_text()


@pytest.mark.parametrize("failure", ["down", "crash_loop"])
def test_worker_that_will_not_stay_up_is_rolled_back(host, failure, capsys):
    updater.main([OLD])
    if failure == "down":
        host.up[NEW] = False
    else:
        host.flaky.add(NEW)
    assert updater.main([NEW]) == 1
    assert updater.installed_commit() == OLD
    assert tag(host) == "TAG = 'old'\n"
    assert not (host.root / NEW).exists()
    assert "previous copy is running again" in capsys.readouterr().err


def test_first_install_that_fails_stops_the_worker(host, capsys):
    host.up[OLD] = False
    assert updater.main([OLD]) == 1
    assert not updater.CURRENT.is_symlink()
    assert ["systemctl", "stop"] in host.calls
    assert "worker is stopped" in capsys.readouterr().err


def test_keeps_the_newest_copies(host, monkeypatch):
    monkeypatch.setattr(updater, "KEEP", 2)
    commits = [c * 40 for c in "1234"]
    for commit in commits:
        host.commits[commit] = dict(host.commits[OLD])
        host.on_main.add(commit)
        host.up[commit] = True
        assert updater.main([commit]) == 0
    assert sorted(p.name for p in host.root.iterdir() if updater.COMMIT.fullmatch(p.name)) == commits[2:]


def test_refuses_an_install_folder_others_can_write(host):
    host.root.mkdir(mode=0o777)
    host.root.chmod(0o777)
    assert updater.main([OLD]) == 1
    assert not updater.CURRENT.exists()


def test_needs_root_and_a_full_commit(host, monkeypatch):
    with pytest.raises(SystemExit):
        updater.main(["abc"])
    monkeypatch.setattr(updater.os, "geteuid", lambda: 1000)
    with pytest.raises(SystemExit):
        updater.main([OLD])
