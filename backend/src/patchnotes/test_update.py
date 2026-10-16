"""Patch note updater tests with GitHub and systemd faked."""

from __future__ import annotations

import importlib.util
import json
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
    """A fake host: the install folder, GitHub answers and the worker's systemd state."""
    root = tmp_path / "lib"
    for name, value in {"ROOT": root, "CURRENT": root / "current", "LOCK": tmp_path / "lock",
                        "LOG": tmp_path / "update.log"}.items():
        monkeypatch.setattr(updater, name, value)
    monkeypatch.setattr(updater.os, "geteuid", lambda: 0)
    monkeypatch.setattr(updater.time, "sleep", lambda _: None)

    def tree(tag):
        return {"__init__.py": b"", "rewrite_worker.py": f"TAG = {tag!r}\n".encode(),
                "test_rewrite_worker.py": b"import pytest\n", "notes.txt": b"not a module"}

    state = SimpleNamespace(commits={OLD: tree("old"), NEW: tree("new")}, on_main={OLD, NEW}, build=True,
                            up={OLD: True, NEW: True}, restarts=0)

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
            listing = [{"name": name, "type": "file"} for name in state.commits[commit]]
            return json.dumps(listing + [{"name": "sub", "type": "dir"}]).encode()
        commit, name = url.split(f"{updater.REPO}/", 1)[1].split(f"/{updater.PACKAGE}/")
        return state.commits[commit][name]

    def run(args, **_):
        if args[:2] == ["systemctl", "restart"]:
            state.restarts += 1
        running = updater.installed_commit()
        return SimpleNamespace(returncode=0 if state.up.get(running) else 3)

    monkeypatch.setattr(updater, "get", get)
    monkeypatch.setattr(updater.subprocess, "run", run)
    state.root = root
    return state


def tag(host):
    return (host.root / "current/patchnotes/rewrite_worker.py").read_text()


def test_installs_the_package_without_tests(host):
    assert updater.main([OLD]) == 0
    assert tag(host) == "TAG = 'old'\n"
    assert sorted(p.name for p in (host.root / "current/patchnotes").iterdir()) == ["__init__.py", "rewrite_worker.py"]
    assert updater.installed_commit() == OLD
    assert host.restarts == 1

    assert updater.main([NEW]) == 0
    assert tag(host) == "TAG = 'new'\n"
    assert (host.root / OLD).is_dir()


def test_same_commit_is_left_alone(host):
    updater.main([OLD])
    assert updater.main([OLD]) == 0
    assert host.restarts == 1


@pytest.mark.parametrize("problem", ["off_main", "no_build", "broken"])
def test_refuses_before_touching_the_install(host, problem, capsys):
    updater.main([OLD])
    if problem == "off_main":
        host.on_main.discard(NEW)
    elif problem == "no_build":
        host.build = False
    else:
        host.commits[NEW]["rewrite_worker.py"] = b"def broken(:\n"
    assert updater.main([NEW]) == 1
    assert updater.installed_commit() == OLD
    assert not (host.root / NEW).exists()
    assert host.restarts == 1
    assert "refused" in updater.LOG.read_text()


def test_worker_that_will_not_start_is_rolled_back(host, capsys):
    updater.main([OLD])
    host.up[NEW] = False
    assert updater.main([NEW]) == 1
    assert updater.installed_commit() == OLD
    assert tag(host) == "TAG = 'old'\n"
    assert "previous copy is running again" in capsys.readouterr().err


def test_keeps_the_newest_copies(host, monkeypatch):
    monkeypatch.setattr(updater, "KEEP", 2)
    commits = [c * 40 for c in "1234"]
    for commit in commits:
        host.commits[commit] = dict(host.commits[OLD])
        host.on_main.add(commit)
        host.up[commit] = True
        assert updater.main([commit]) == 0
    assert sorted(p.name for p in host.root.iterdir() if updater.COMMIT.fullmatch(p.name)) == commits[2:]


def test_needs_root_and_a_full_commit(host, monkeypatch):
    with pytest.raises(SystemExit):
        updater.main(["abc"])
    monkeypatch.setattr(updater.os, "geteuid", lambda: 1000)
    with pytest.raises(SystemExit):
        updater.main([OLD])
