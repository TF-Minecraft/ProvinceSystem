"""Finding 6 (nit): `list_wipes` / `get_wipe` select explicit columns, not `*`.

`_row_to_record` unpacks by name regardless, so the behavioural surface is the
same either way; this locks in the query shape and covers the ordinary
round-trip while doing it.
"""

from __future__ import annotations

import os
import sys
from contextlib import contextmanager
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

from src.scripts.chronicle import audit  # noqa: E402
from src import database  # noqa: E402

MAP = "main"


@pytest.fixture
def db_env(tmp_path, monkeypatch, postgres):
    return tmp_path


class _ExecuteSpyConnection:
    """Forwards everything to a real connection, logging `execute()` SQL."""

    def __init__(self, conn, calls: list[str]):
        self._conn = conn
        self._calls = calls

    def execute(self, sql, *args, **kwargs):
        self._calls.append(sql)
        return self._conn.execute(sql, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def test_list_wipes_and_get_wipe_do_not_select_star(db_env, monkeypatch):
    calls: list[str] = []
    real_connect = database.connect

    @contextmanager
    def spying_connect(*args, **kwargs):
        with real_connect(*args, **kwargs) as conn:
            yield _ExecuteSpyConnection(conn, calls)

    monkeypatch.setattr(database, "connect", spying_connect)

    wipe_id = audit.record_wipe(
        MAP,
        wiped_at=1000,
        wiped_by="staffer",
        day_count=2,
        backup_path="/tmp/chronicle.bak.1000",
        reason="cleanup",
    )

    calls.clear()
    records = audit.list_wipes(MAP)
    record = audit.get_wipe(MAP, wipe_id)

    select_calls = [sql for sql in calls if sql.strip().upper().startswith("SELECT")]
    assert select_calls, "expected at least one SELECT"
    for sql in select_calls:
        assert "SELECT *" not in sql.upper()
        assert "id" in sql and "map_id" in sql

    assert len(records) == 1
    assert records[0].id == wipe_id
    assert record is not None
    assert record.id == wipe_id
    assert record.reason == "cleanup"
    assert record.backup_path == "/tmp/chronicle.bak.1000"


def test_round_trip_fields_survive_the_explicit_column_list(db_env):
    wipe_id = audit.record_wipe(
        MAP,
        wiped_at=2000,
        wiped_by="staffer",
        day_count=5,
        backup_path=None,
        reason="because",
    )

    record = audit.get_wipe(MAP, wipe_id)
    assert record is not None
    assert record.day_count == 5
    assert record.backup_path is None
    assert record.restored_at is None
    assert record.restored_by is None

    audit.mark_restored(MAP, wipe_id, restored_at=2500, restored_by="someone")
    restored = audit.get_wipe(MAP, wipe_id)
    assert restored is not None
    assert restored.restored_at == 2500
    assert restored.restored_by == "someone"


if __name__ == "__main__":
    sys.exit(pytest.main([os.path.abspath(__file__), "-q"]))
