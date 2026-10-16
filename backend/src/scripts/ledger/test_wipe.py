"""Locking and reporting for the backing-up ledger wipe and the reindex CLI."""

from __future__ import annotations

import errno
import os
import threading
from pathlib import Path

import pytest

from src.scripts.ledger import ingest, reindex, store, wipe
from src.scripts.ledger.schema import normalize_snapshot
from src.scripts.util import atomic, maplock

from .conftest import MAP, snapshot_payload

DAY = "2026-09-01"


def _post(**overrides) -> dict:
    snapshot = normalize_snapshot(snapshot_payload(**overrides), MAP)
    ingest.store_raw(MAP, snapshot)
    return snapshot


def _gate_rename(monkeypatch, at_move: threading.Event, release: threading.Event):
    """Park the wipe inside its rename-aside until `release` is set.

    Patches `os.rename` (what `atomic.rename_aside` calls) rather than swapping
    the `shutil` module object out from under the wipe: the wipe no longer uses
    `shutil`, and replacing a module attribute reached into a shared import.
    """
    real_rename = atomic.os.rename

    def gated(source, destination, *args, **kwargs):
        at_move.set()
        assert release.wait(30)
        return real_rename(source, destination, *args, **kwargs)

    monkeypatch.setattr(atomic.os, "rename", gated)


def test_a_promote_cannot_land_in_the_middle_of_a_wipe(env: Path, monkeypatch) -> None:
    """`promote_day` runs as a BackgroundTask on every upload and used to take
    only the per-(map, day) lock. One landing between the directory move and the
    DELETE loop re-created `daily/{day}.json.gz` under a freshly made root and
    re-inserted rows the loop then deleted."""
    _post()
    ingest.promote_day(MAP, DAY)

    order: list[str] = []
    at_move = threading.Event()
    release = threading.Event()
    _gate_rename(monkeypatch, at_move, release)

    def run_wipe() -> None:
        wipe.wipe_map(MAP)
        order.append("wipe-done")

    wipe_thread = threading.Thread(target=run_wipe)
    wipe_thread.start()
    assert at_move.wait(30)

    promoted: list[object] = []
    at_promote = threading.Event()

    def run_promote() -> None:
        at_promote.set()
        promoted.append(ingest.promote_day(MAP, DAY))
        order.append("promote-done")

    promote_thread = threading.Thread(target=run_promote)
    promote_thread.start()
    assert at_promote.wait(30)
    # Blocked on the map lock while the wipe sits mid-move.
    promote_thread.join(1.0)
    assert promote_thread.is_alive()
    assert order == []

    release.set()
    wipe_thread.join(30)
    promote_thread.join(30)
    assert not wipe_thread.is_alive() and not promote_thread.is_alive()
    assert order == ["wipe-done", "promote-done"]

    # The promote that followed found no raw/ to rebuild from: the wipe renamed
    # the whole `ledger/` tree aside, `raw/` included. That is the wipe doing
    # its job, not raw/ being protected — see
    # `test_a_raw_write_cannot_land_in_the_middle_of_a_wipe` for what actually
    # keeps an in-flight upload's bytes out of a half-wiped tree.
    assert promoted == [None]
    assert store.get_day(MAP, DAY) is None


def test_a_raw_write_cannot_land_in_the_middle_of_a_wipe(
    env: Path, monkeypatch
) -> None:
    """`store_raw` runs *synchronously on the upload request*, not as a
    background task, and writes into `raw/` inside the tree the wipe renames
    away. One landing mid-wipe either failed the upload or re-created
    `raw/{day}/` under a root already set aside, stranding the only durable copy
    of that 5-minute sample outside both trees."""
    _post()
    ingest.promote_day(MAP, DAY)

    order: list[str] = []
    at_move = threading.Event()
    release = threading.Event()
    _gate_rename(monkeypatch, at_move, release)

    def run_wipe() -> None:
        wipe.wipe_map(MAP)
        order.append("wipe-done")

    wipe_thread = threading.Thread(target=run_wipe)
    wipe_thread.start()
    assert at_move.wait(30)

    later = normalize_snapshot(
        snapshot_payload(captured_at=f"{DAY}T13:00:00Z"), MAP
    )
    stored: list[str] = []
    at_store = threading.Event()

    def run_store() -> None:
        at_store.set()
        stored.append(ingest.store_raw(MAP, later))
        order.append("store-done")

    store_thread = threading.Thread(target=run_store)
    store_thread.start()
    assert at_store.wait(30)
    # Blocked on the map lock while the wipe sits mid-rename.
    store_thread.join(1.0)
    assert store_thread.is_alive()
    assert order == []

    release.set()
    wipe_thread.join(30)
    store_thread.join(30)
    assert not wipe_thread.is_alive() and not store_thread.is_alive()
    assert order == ["wipe-done", "store-done"]

    # The upload's bytes landed in the fresh tree, whole, after the wipe — never
    # inside the directory being renamed away.
    assert os.path.isfile(stored[0])
    assert stored[0].startswith(store.ledger_root(MAP) + os.sep)
    # And the backup the wipe made holds only what was there before it started.
    backup = next(
        entry
        for entry in os.listdir(os.path.dirname(store.ledger_root(MAP)))
        if entry.startswith("ledger.bak.")
    )
    backup_raw = os.path.join(
        os.path.dirname(store.ledger_root(MAP)), backup, "raw", DAY
    )
    assert os.path.basename(stored[0]) not in os.listdir(backup_raw)


def test_cross_device_backup_fails_loudly_instead_of_copying(
    env: Path, monkeypatch
) -> None:
    """Same promise, same trap as the chronicle wipe: `shutil.move` degraded to
    copytree+rmtree across a filesystem boundary."""
    _post()
    ingest.promote_day(MAP, DAY)

    def exdev(*_args, **_kwargs):
        raise OSError(errno.EXDEV, "Invalid cross-device link")

    monkeypatch.setattr(atomic.os, "rename", exdev)

    with pytest.raises(atomic.CrossDeviceError) as excinfo:
        wipe.wipe_map(MAP)
    assert "same filesystem" in str(excinfo.value)

    # Nothing was copied and nothing was deleted.
    assert os.path.isdir(store.ledger_root(MAP))
    assert store.get_day(MAP, DAY) is not None


def test_deleted_count_is_not_the_pre_move_census(env: Path, monkeypatch, capsys) -> None:
    """`total` used to be summed before the move, so the line reported a count
    taken at a different moment from the DELETEs it describes."""
    _post()
    ingest.promote_day(MAP, DAY)
    real_counts = wipe._row_counts

    def inflated(conn, map_name: str) -> dict[str, int]:
        return {
            table: count + 100 for table, count in real_counts(conn, map_name).items()
        }

    monkeypatch.setattr(wipe, "_row_counts", inflated)
    wipe.wipe_map(MAP)

    line = next(
        entry
        for entry in capsys.readouterr().out.splitlines()
        if entry.startswith("Deleted ")
    )
    # Four tables, each inflated by 100: the census says 400 more than exists.
    assert int(line.split()[1]) < 100


def test_wipe_reports_the_rows_it_actually_deleted(env: Path, capsys) -> None:
    _post()
    ingest.promote_day(MAP, DAY)
    with store.open_connection() as conn:
        expected = sum(
            conn.execute(
                f"SELECT COUNT(*) AS n FROM {table} WHERE map_id = %s", (MAP,)
            ).fetchone()["n"]
            for table in wipe._TABLES
        )

    wipe.wipe_map(MAP)
    assert f"Deleted {expected} index row(s)" in capsys.readouterr().out


def test_reindex_map_holds_the_lock_for_the_whole_run(env: Path, monkeypatch) -> None:
    """A server still ingesting must not slip a promote between two days of a
    rebuild, leaving the index half old and half new."""
    _post()
    ingest.promote_day(MAP, DAY)

    busy: list[bool] = []
    real_reindex_day = ingest.reindex_day

    def spy(map_id: str, day: str):
        def probe() -> None:
            try:
                with maplock.map_lock(store.ledger_lock_path(map_id), blocking=False):
                    busy.append(False)
            except maplock.MapLockBusy:
                busy.append(True)

        thread = threading.Thread(target=probe)
        thread.start()
        thread.join(30)
        return real_reindex_day(map_id, day)

    monkeypatch.setattr(reindex, "reindex_day", spy)
    assert reindex.reindex_map(MAP) == 0
    assert busy == [True]


def test_the_lock_file_survives_the_wipe(env: Path) -> None:
    """It is a sibling of `ledger/`, not a file inside it, so the rename that
    sets the tree aside does not carry the rendezvous point off with it."""
    _post()
    ingest.promote_day(MAP, DAY)
    lock_path = store.ledger_lock_path(MAP)
    with maplock.map_lock(lock_path):
        pass

    wipe.wipe_map(MAP)
    assert os.path.isfile(lock_path)
    assert os.path.dirname(lock_path) == os.path.dirname(store.ledger_root(MAP))


def test_reindex_day_never_makes_the_day_vanish(env: Path, monkeypatch) -> None:
    """`delete_day` + `index_snapshot` were two transactions, so a reader
    landing between them saw the day disappear and come back."""
    _post()
    ingest.promote_day(MAP, DAY)

    seen: list[bool] = []
    real_index = ingest.index_snapshot

    def spy(map_id: str, snapshot: dict) -> None:
        # A *separate* connection: it cannot see anything the rebuild has not
        # committed, so this is exactly what a concurrent reader would see.
        seen.append(store.get_day(map_id, snapshot["day"]) is not None)
        return real_index(map_id, snapshot)

    monkeypatch.setattr(ingest, "index_snapshot", spy)
    assert ingest.reindex_day(MAP, DAY) is not None
    assert seen == [True]
    assert store.get_day(MAP, DAY)["server_day"] == 41


def test_reindex_day_still_replaces_stale_rows(env: Path) -> None:
    """Dropping the redundant `delete_day` must not leave rows behind: the
    `replace_day_*` calls delete inside their own transaction, which is the
    whole reason the separate delete was safe to remove."""
    _post()
    promoted = ingest.promote_day(MAP, DAY)
    ghost = dict(promoted["factions"][0])
    ghost["key"] = "ghost"
    ghost["id"] = "ghost"
    store.replace_day_factions(MAP, DAY, [*promoted["factions"], ghost])
    assert {row["faction_id"] for row in store.read_faction_days(MAP, DAY, DAY)} == {
        "alba",
        "ghost",
    }

    ingest.reindex_day(MAP, DAY)
    assert {row["faction_id"] for row in store.read_faction_days(MAP, DAY, DAY)} == {
        "alba"
    }


def test_a_second_wipe_is_refused_while_one_is_running(env: Path) -> None:
    _post()
    ingest.promote_day(MAP, DAY)
    lock_path = store.ledger_lock_path(MAP)

    held = threading.Event()
    release = threading.Event()

    def holder() -> None:
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

    assert store.get_day(MAP, DAY) is not None


def test_the_cli_reports_a_busy_lock_instead_of_a_traceback(
    env: Path, monkeypatch, capsys
) -> None:
    """`main` is what an operator sees; a raw MapLockBusy traceback is not an
    answer to "why did my wipe not run"."""

    def busy(*_args, **_kwargs):
        raise maplock.MapLockBusy("held")

    monkeypatch.setattr(wipe, "map_lock", busy)

    with pytest.raises(SystemExit) as excinfo:
        wipe.main(["--map", MAP])

    assert excinfo.value.code == 2
    assert "Wait for it to finish" in capsys.readouterr().err


def test_the_reindex_cli_reports_a_busy_lock_too(env: Path, monkeypatch, capsys) -> None:
    _post()
    ingest.promote_day(MAP, DAY)

    def busy(*_args, **_kwargs):
        raise maplock.MapLockBusy("held")

    monkeypatch.setattr(reindex, "map_lock", busy)

    with pytest.raises(SystemExit) as excinfo:
        reindex.main(["--map", MAP])

    assert excinfo.value.code == 2
    assert "Wait for it to finish" in capsys.readouterr().err
