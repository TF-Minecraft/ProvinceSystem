"""Round-trip tests for the backing-up chronicle wipe CLI."""

from __future__ import annotations

import errno
import gzip
import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

from src.scripts.chronicle import store, wipe  # noqa: E402
from src.scripts.util import atomic, maplock  # noqa: E402
from src import database  # noqa: E402


@pytest.fixture
def chronicle_env(tmp_path, monkeypatch, postgres):
    monkeypatch.setattr(store, "OUTPUT_DIR", str(tmp_path / "output"))
    return tmp_path


def _capture_day(map_name: str, day: str) -> None:
    path = store.stored_file_path(map_name, day, "nation")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump({"day": day}, handle)
    store.upsert_snapshot(
        map_name,
        day,
        "dev",
        int(time.time()),
        os.path.getsize(path),
        None,
        {"files": {"nation": {"sha256": day}}},
    )


def _live_rows(map_name: str) -> list[str]:
    with database.connect() as conn:
        rows = conn.execute(
            "SELECT day FROM map_chronicle_snapshots WHERE map_id = %s ORDER BY day",
            (map_name,),
        ).fetchall()
    return [row["day"] for row in rows]


def _archive_rows(map_name: str) -> list[str]:
    with database.connect() as conn:
        rows = conn.execute(
            "SELECT day, archived_at FROM map_chronicle_snapshots_archive "
            "WHERE map_id = %s ORDER BY day",
            (map_name,),
        ).fetchall()
    return [row["day"] for row in rows]


def _backup_dirs(root: str) -> list[str]:
    parent = os.path.dirname(root)
    if not os.path.isdir(parent):
        return []
    prefix = os.path.basename(root) + ".bak."
    return sorted(n for n in os.listdir(parent) if n.startswith(prefix))


def test_wipe_round_trip(chronicle_env, capsys):
    _capture_day("dev", "2026-01-01")
    _capture_day("dev", "2026-01-02")
    root = store.chronicle_root("dev")

    assert wipe.main(["--map", "dev"]) == 0

    assert not os.path.exists(root)
    backups = _backup_dirs(root)
    assert len(backups) == 1
    backup_path = os.path.join(os.path.dirname(root), backups[0])
    assert sorted(os.listdir(backup_path)) == ["2026-01-01", "2026-01-02"]
    # The bytes are set aside, never removed.
    assert os.path.isfile(os.path.join(backup_path, "2026-01-01", "nation.json.gz"))

    assert _live_rows("dev") == []
    assert _archive_rows("dev") == ["2026-01-01", "2026-01-02"]


def test_wipe_leaves_other_maps_alone(chronicle_env):
    _capture_day("dev", "2026-01-01")
    _capture_day("main", "2026-01-01")

    assert wipe.main(["--map", "dev"]) == 0

    assert _live_rows("main") == ["2026-01-01"]
    assert os.path.isdir(store.chronicle_root("main"))


def test_dry_run_changes_nothing(chronicle_env, capsys):
    _capture_day("dev", "2026-01-01")
    root = store.chronicle_root("dev")

    assert wipe.main(["--map", "dev", "--dry-run"]) == 0

    out = capsys.readouterr().out
    assert "[dry-run]" in out
    assert os.path.isdir(root)
    assert _backup_dirs(root) == []
    assert _live_rows("dev") == ["2026-01-01"]
    assert _archive_rows("dev") == []


def test_nothing_to_wipe_exits_zero(chronicle_env, capsys):
    assert wipe.main(["--map", "dev"]) == 0
    assert "Nothing to wipe" in capsys.readouterr().out


def test_map_argument_is_required(chronicle_env):
    with pytest.raises(SystemExit):
        wipe.main([])


def test_invalid_map_name_is_rejected(chronicle_env):
    with pytest.raises(SystemExit):
        wipe.main(["--map", "../etc"])


def _freeze_wipe_clock(monkeypatch, stamp: int) -> None:
    """Pin wipe's timestamp so both runs land in the same second."""
    monkeypatch.setattr(wipe.time, "time", lambda: stamp)


def test_two_wipes_in_one_second_do_not_nest_or_overwrite(chronicle_env, monkeypatch):
    _freeze_wipe_clock(monkeypatch, 1767225600)
    root = store.chronicle_root("dev")

    _capture_day("dev", "2026-01-01")
    assert wipe.main(["--map", "dev"]) == 0
    # A fresh capture of the same day, then a second wipe in the same second.
    _capture_day("dev", "2026-01-01")
    assert wipe.main(["--map", "dev"]) == 0

    backups = _backup_dirs(root)
    assert len(backups) == 2, backups
    for name in backups:
        path = os.path.join(os.path.dirname(root), name)
        # shutil.move onto an existing directory would have nested one backup
        # inside the other instead of failing.
        assert os.listdir(path) == ["2026-01-01"]
        assert not os.path.isdir(os.path.join(path, "chronicle"))

    # Both runs' index rows survived; the second did not REPLACE the first.
    with database.connect() as conn:
        stamps = conn.execute(
            "SELECT archived_at FROM map_chronicle_snapshots_archive "
            "WHERE map_id = %s AND day = %s",
            ("dev", "2026-01-01"),
        ).fetchall()
    assert len({row["archived_at"] for row in stamps}) == 2


def test_backup_path_is_unique_when_the_timestamped_one_exists(chronicle_env, monkeypatch):
    """Directory-only wipes (no index rows) keep the same second, so the path
    itself has to disambiguate."""
    _freeze_wipe_clock(monkeypatch, 1767225600)
    root = store.chronicle_root("dev")

    for _ in range(2):
        os.makedirs(os.path.join(root, "2026-01-01"), exist_ok=True)
        with open(os.path.join(root, "2026-01-01", "marker"), "w", encoding="utf-8") as fh:
            fh.write("x")
        assert wipe.main(["--map", "dev"]) == 0

    backups = _backup_dirs(root)
    assert backups == ["chronicle.bak.1767225600", "chronicle.bak.1767225600-1"]
    for name in backups:
        path = os.path.join(os.path.dirname(root), name)
        assert os.path.isfile(os.path.join(path, "2026-01-01", "marker"))


def test_rows_survive_a_failure_during_the_directory_move(chronicle_env, monkeypatch):
    """Archive-insert -> move -> delete: a failed move must leave the live rows
    in place, so the state is 'wipe did not finish', not 'rows point at files
    that moved'."""
    _capture_day("dev", "2026-01-01")

    def boom(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(atomic.os, "rename", boom)

    with pytest.raises(OSError):
        wipe.wipe_map("dev")

    assert _live_rows("dev") == ["2026-01-01"]
    assert os.path.isdir(store.chronicle_root("dev"))
    # The archive copy is already there; a re-run REPLACEs it harmlessly.
    assert _archive_rows("dev") == ["2026-01-01"]


def test_cross_device_backup_fails_loudly_instead_of_copying(chronicle_env, monkeypatch):
    """`shutil.move` degrades to copytree+rmtree across a filesystem boundary,
    which is not the "renamed aside" this module promises. Say so instead."""
    _capture_day("dev", "2026-01-01")

    def exdev(*_args, **_kwargs):
        raise OSError(errno.EXDEV, "Invalid cross-device link")

    monkeypatch.setattr(atomic.os, "rename", exdev)

    with pytest.raises(atomic.CrossDeviceError) as excinfo:
        wipe.perform_wipe("dev")
    assert "same filesystem" in str(excinfo.value)

    # Nothing was copied, nothing was deleted: the live rows and tree stand.
    assert _live_rows("dev") == ["2026-01-01"]
    assert os.path.isdir(store.chronicle_root("dev"))
    assert _backup_dirs(store.chronicle_root("dev")) == []


def test_a_second_wipe_is_refused_while_one_is_running(chronicle_env):
    """The staff routes' 'already running' answer, and the CLI's protection
    against being run twice against the same live server."""
    _capture_day("dev", "2026-01-01")
    lock_path = store.chronicle_lock_path("dev")

    held = threading.Event()
    release = threading.Event()

    def holder():
        with maplock.map_lock(lock_path):
            held.set()
            release.wait(30)

    thread = threading.Thread(target=holder)
    thread.start()
    try:
        assert held.wait(30)
        with pytest.raises(maplock.MapLockBusy):
            with maplock.map_lock(lock_path, blocking=False):
                pass
    finally:
        release.set()
        thread.join(30)

    # Untouched by the refusal.
    assert _live_rows("dev") == ["2026-01-01"]


def test_the_cli_reports_a_busy_lock_instead_of_a_traceback(
    chronicle_env, monkeypatch, capsys
):
    """`main` is what an operator sees; a raw MapLockBusy traceback is not an
    answer to "why did my wipe not run"."""
    _capture_day("dev", "2026-01-01")

    def busy(*_args, **_kwargs):
        raise maplock.MapLockBusy("held")

    monkeypatch.setattr(wipe, "map_lock", busy)

    with pytest.raises(SystemExit) as excinfo:
        wipe.main(["--map", "dev"])

    assert excinfo.value.code == 2
    assert "Wait for it to finish" in capsys.readouterr().err
