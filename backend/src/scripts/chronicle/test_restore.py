"""Unit tests for the chronicle restore (the undo half of the backing-up wipe)."""

from __future__ import annotations

import gzip
import json
import os
import shutil
import sys
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

from src.scripts.chronicle import restore, store, wipe  # noqa: E402
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


def test_round_trip_restores_days_and_rows(chronicle_env):
    _capture_day("dev", "2026-01-01")
    _capture_day("dev", "2026-01-02")
    result = wipe.perform_wipe("dev")

    restored = restore.restore_wipe(
        "dev", archived_at=result.archived_at, backup_path=result.backup_path
    )

    assert restored.restored_days == ["2026-01-01", "2026-01-02"]
    assert restored.restored_rows == 2
    assert store.list_days("dev") == ["2026-01-01", "2026-01-02"]
    assert store.resolve_stored_file("dev", "2026-01-01", "nation") is not None
    # The emptied backup directory is cleaned up; the archive rows are kept.
    assert not os.path.exists(result.backup_path)


def test_retrying_a_half_finished_restore_completes_it(chronicle_env, monkeypatch):
    """Directories move first, then rows: a crash in between must be resumable."""
    _capture_day("dev", "2026-01-01")
    _capture_day("dev", "2026-01-02")
    result = wipe.perform_wipe("dev")

    real_move = restore.shutil.move
    calls = {"n": 0}

    def flaky_move(src, dst):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk full")
        return real_move(src, dst)

    monkeypatch.setattr(restore.shutil, "move", flaky_move)
    with pytest.raises(OSError):
        restore.restore_wipe(
            "dev", archived_at=result.archived_at, backup_path=result.backup_path
        )

    # Half the bytes are back, no rows are live yet — invisible, not corrupt.
    assert store.list_days("dev") == []
    monkeypatch.setattr(restore.shutil, "move", real_move)

    second = restore.restore_wipe(
        "dev",
        archived_at=result.archived_at,
        backup_path=result.backup_path,
        merge=True,
    )

    assert second.restored_days == ["2026-01-02"]
    assert store.list_days("dev") == ["2026-01-01", "2026-01-02"]


def test_restore_never_overwrites_a_live_day(chronicle_env):
    _capture_day("dev", "2026-01-01")
    result = wipe.perform_wipe("dev")
    _capture_day("dev", "2026-01-01")
    live = store.stored_file_path("dev", "2026-01-01", "nation")
    with open(live, "rb") as handle:
        before = handle.read()

    restored = restore.restore_wipe(
        "dev",
        archived_at=result.archived_at,
        backup_path=result.backup_path,
        merge=True,
    )

    assert restored.skipped_days == ["2026-01-01"]
    assert restored.restored_days == []
    with open(live, "rb") as handle:
        assert handle.read() == before
    # The skipped copy stays in the backup rather than being dropped.
    assert os.path.isfile(
        os.path.join(result.backup_path, "2026-01-01", "nation.json.gz")
    )


def test_unrecognised_entries_are_left_in_the_backup(chronicle_env):
    _capture_day("dev", "2026-01-01")
    result = wipe.perform_wipe("dev")
    stray = os.path.join(result.backup_path, "not-a-day")
    os.makedirs(stray)

    restore.restore_wipe(
        "dev", archived_at=result.archived_at, backup_path=result.backup_path
    )

    assert os.path.isdir(stray)
    assert not os.path.exists(os.path.join(store.chronicle_root("dev"), "not-a-day"))


def test_nothing_to_restore_is_an_error_not_a_hollow_success(chronicle_env):
    with pytest.raises(restore.RestoreError) as excinfo:
        restore.restore_wipe(
            "dev",
            archived_at=1767225600,
            backup_path=store.chronicle_root("dev") + ".bak.1767225600",
        )
    assert excinfo.value.code == "nothing_to_restore"


@pytest.mark.parametrize(
    "suffix",
    [
        os.path.join("..", "dev"),
        os.path.join("..", "..", "etc"),
        "chronicle",  # the live root is not a backup
        "banners",
    ],
)
def test_backup_path_must_be_this_maps_own_backup_dir(chronicle_env, suffix):
    map_dir = os.path.dirname(store.chronicle_root("dev"))
    with pytest.raises(restore.RestoreError) as excinfo:
        restore.validate_backup_path("dev", os.path.join(map_dir, suffix))
    assert excinfo.value.code == "bad_backup_path"


def test_backup_path_of_another_map_is_rejected(chronicle_env):
    _capture_day("main", "2026-01-01")
    other = wipe.perform_wipe("main")

    with pytest.raises(restore.RestoreError):
        restore.validate_backup_path("dev", other.backup_path)


def test_valid_backup_path_is_accepted(chronicle_env):
    _capture_day("dev", "2026-01-01")
    result = wipe.perform_wipe("dev")
    assert restore.validate_backup_path("dev", result.backup_path) == os.path.realpath(
        result.backup_path
    )


def test_has_live_data_sees_rows_and_bare_directories(chronicle_env):
    assert restore.has_live_data("dev") is False
    _capture_day("dev", "2026-01-01")
    assert restore.has_live_data("dev") is True

    wipe.perform_wipe("dev")
    assert restore.has_live_data("dev") is False

    # A directory with no index row still counts: a wipe that crashed after its
    # move, or a capture that started refilling, must block a blind restore.
    os.makedirs(os.path.join(store.chronicle_root("dev"), "2026-03-01"))
    assert restore.has_live_data("dev") is True


def test_missing_backup_does_not_republish_rows_for_absent_days(chronicle_env):
    """Archive rows outlive the backup directory. Re-inserting a row for a day
    whose bytes are gone publishes a day that 404s file by file."""
    _capture_day("dev", "2026-01-01")
    _capture_day("dev", "2026-01-02")
    result = wipe.perform_wipe("dev")

    root = store.chronicle_root("dev")
    # One day put back by hand; the backup directory then removed entirely, as
    # a half-finished restore plus an operator tidy-up would leave it.
    os.makedirs(root, exist_ok=True)
    shutil.move(
        os.path.join(result.backup_path, "2026-01-01"),
        os.path.join(root, "2026-01-01"),
    )
    shutil.rmtree(result.backup_path)

    restored = restore.restore_wipe(
        "dev",
        archived_at=result.archived_at,
        backup_path=result.backup_path,
        merge=True,
    )

    assert restored.restored_days == []
    assert restored.restored_rows == 1
    # Only the day whose directory is actually back is live again.
    assert store.list_days("dev") == ["2026-01-01"]
    for day in store.list_days("dev"):
        assert os.path.isdir(store.chronicle_day_dir("dev", day))
