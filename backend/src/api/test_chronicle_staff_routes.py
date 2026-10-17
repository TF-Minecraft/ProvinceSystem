"""API tests for the staff-gated chronicle wipe / backups / restore routes.

The app under test is assembled here from the two chronicle routers rather than
imported from `server`. That keeps the tests scoped to the routers' own
contract, and it sidesteps `server.py`'s GZip middleware configuration, which
fails to construct against older Starlette builds — a pre-existing environment
mismatch unrelated to these routes.

Auth is exercised through the real `map_access` chain: only the session lookup
(`get_session`) and the permission oracle (`has_map_staff_access`) are stubbed,
so the gate itself, the identity that lands in the audit row, and the 403s are
the production code paths.
"""

from __future__ import annotations

import gzip
import json
import os
import sys
import time
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.api import map_access  # noqa: E402
from src.api.chronicle_routes import chronicle_router  # noqa: E402
from src.api.chronicle_staff_routes import chronicle_staff_router  # noqa: E402
from src.api.map_registry import clear_map_registry_cache  # noqa: E402
from src.scripts.chronicle import audit, store  # noqa: E402
from src import database  # noqa: E402
from src.skins import db as skins_db  # noqa: E402

TEST_REGISTRY = """
maps:
  - id: main
    public: true
    display_name: Adavaar
    realm_id: main
  - id: dev
    public: false
    display_name: Adavaar
    realm_id: dev
    staff_permission: tfmc.map.staff
"""

STAFF_TOKEN = "staff-token"
STAFF_UUID = "staff-uuid"
STAFF_AUTH = {"Authorization": f"Bearer {STAFF_TOKEN}"}


@pytest.fixture
def staff_state():
    """Flipped by tests to turn the staff permission off."""
    return {"is_staff": True}


@pytest.fixture
def chronicle_env(tmp_path, monkeypatch, staff_state, postgres):
    registry = tmp_path / "maps.yml"
    registry.write_text(TEST_REGISTRY, encoding="utf-8")
    monkeypatch.setenv("MAP_REGISTRY_PATH", str(registry))
    clear_map_registry_cache()

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(skins_db, "DATA_DIR", data_dir)
    monkeypatch.setattr(skins_db, "SKINS_DIR", data_dir / "skins")
    monkeypatch.setattr(skins_db, "WARDROBE_DIR", data_dir / "wardrobe")
    monkeypatch.setattr(skins_db, "DRINKS_DIR", data_dir / "drinks")
    monkeypatch.setattr(store, "OUTPUT_DIR", str(tmp_path / "output"))

    def fake_session(token: str):
        if token != STAFF_TOKEN:
            return None
        return {"scope": "profile", "player_uuid": STAFF_UUID, "realm_id": "main"}

    monkeypatch.setattr(map_access, "get_session", fake_session)
    monkeypatch.setattr(
        map_access,
        "has_map_staff_access",
        lambda *_args, **_kwargs: staff_state["is_staff"],
    )

    skins_db.ensure_directories()
    try:
        yield tmp_path
    finally:
        clear_map_registry_cache()


@pytest.fixture
def client(chronicle_env):
    app = FastAPI()
    app.include_router(chronicle_router)
    app.include_router(chronicle_staff_router)
    with TestClient(app) as test_client:
        yield test_client


def _capture_day(map_name: str, day: str) -> None:
    path = store.stored_file_path(map_name, day, "nation")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump({"day": day}, handle)
    store.upsert_snapshot(
        map_name,
        day,
        "main",
        int(time.time()),
        os.path.getsize(path),
        None,
        {"files": {"nation": {"sha256": day}}},
    )


def _backup_dir(map_id: str, wipe_id: int) -> str:
    """On-disk backup path, read from the audit row.

    The API only ever reports the *basename* (finding 9): the absolute server
    path is not the client's business, and `backup_id` is all a restore needs.
    """
    record = audit.get_wipe(map_id, wipe_id)
    assert record is not None and record.backup_path
    return record.backup_path


def _wipe(client, *, confirm="main", reason="cleanup", map_name="main", **extra):
    body = {"confirm": confirm, "reason": reason}
    body.update(extra)
    return client.post(f"/{map_name}/chronicle/wipe", json=body, headers=STAFF_AUTH)


# --- gate --------------------------------------------------------------------


def test_wipe_without_a_session_is_forbidden(client):
    response = client.post(
        "/main/chronicle/wipe", json={"confirm": "main", "reason": "x"}
    )
    assert response.status_code == 403


def test_wipe_without_the_staff_permission_is_forbidden(client, staff_state):
    staff_state["is_staff"] = False
    _capture_day("main", "2026-01-01")

    response = _wipe(client)

    assert response.status_code == 403
    assert store.list_days("main") == ["2026-01-01"]


def test_backups_and_restore_are_staff_gated(client, staff_state):
    staff_state["is_staff"] = False
    assert client.get("/main/chronicle/backups", headers=STAFF_AUTH).status_code == 403
    assert (
        client.post(
            "/main/chronicle/restore",
            json={"confirm": "main", "backup_id": 1},
            headers=STAFF_AUTH,
        ).status_code
        == 403
    )


def test_unknown_map_is_not_found(client):
    response = client.post(
        "/nosuchmap/chronicle/wipe",
        json={"confirm": "nosuchmap", "reason": "x"},
        headers=STAFF_AUTH,
    )
    assert response.status_code == 404


# --- confirmation ------------------------------------------------------------


@pytest.mark.parametrize("confirm", ["", "Main", " main", "dev", None, 1])
def test_wrong_or_missing_confirmation_is_rejected(client, confirm):
    _capture_day("main", "2026-01-01")

    body = {"reason": "cleanup"}
    if confirm is not None:
        body["confirm"] = confirm
    response = client.post("/main/chronicle/wipe", json=body, headers=STAFF_AUTH)

    assert response.status_code == 400
    assert store.list_days("main") == ["2026-01-01"]


@pytest.mark.parametrize("reason", ["", "   ", None])
def test_missing_reason_is_rejected(client, reason):
    _capture_day("main", "2026-01-01")

    body = {"confirm": "main"}
    if reason is not None:
        body["reason"] = reason
    response = client.post("/main/chronicle/wipe", json=body, headers=STAFF_AUTH)

    assert response.status_code == 400
    assert store.list_days("main") == ["2026-01-01"]


def test_a_non_object_body_is_rejected(client):
    response = client.post("/main/chronicle/wipe", json=["main"], headers=STAFF_AUTH)
    assert response.status_code == 400


# --- wipe --------------------------------------------------------------------


def test_wipe_archives_days_and_writes_an_audit_row(client):
    _capture_day("main", "2026-01-01")
    _capture_day("main", "2026-01-02")
    root = store.chronicle_root("main")

    body = _wipe(client, reason="fresh start").json()

    assert body["ok"] is True
    assert body["performed"] is True
    assert body["day_count"] == 2
    assert body["wiped_by"] == STAFF_UUID
    assert isinstance(body["wipe_id"], int)

    # The bytes are set aside, not deleted.
    backup = _backup_dir("main", body["wipe_id"])
    assert os.path.isdir(backup)
    assert sorted(os.listdir(backup)) == ["2026-01-01", "2026-01-02"]
    assert os.path.isfile(os.path.join(backup, "2026-01-01", "nation.json.gz"))
    assert not os.path.exists(root)
    assert store.list_days("main") == []

    record = audit.get_wipe("main", body["wipe_id"])
    assert record is not None
    assert record.wiped_by == STAFF_UUID
    assert record.reason == "fresh start"
    assert record.day_count == 2
    assert record.backup_path == backup
    # The response carries the basename only, never the server path.
    assert body["backup_path"] == os.path.basename(backup)
    assert not os.path.isabs(body["backup_path"])
    assert record.restored_at is None


def test_wipe_leaves_other_maps_alone(client):
    _capture_day("main", "2026-01-01")
    _capture_day("dev", "2026-01-01")

    _wipe(client)

    assert store.list_days("dev") == ["2026-01-01"]
    assert os.path.isdir(store.chronicle_root("dev"))


def test_wipe_of_an_empty_map_writes_no_audit_row(client):
    body = _wipe(client).json()

    assert body["performed"] is False
    assert body["wipe_id"] is None
    assert audit.list_wipes("main") == []
    assert client.get("/main/chronicle/index").json()["last_wiped_at"] is None


# --- index -------------------------------------------------------------------


def test_index_reports_last_wiped_at_only_after_a_wipe(client):
    _capture_day("main", "2026-01-01")

    before = client.get("/main/chronicle/index").json()
    assert before["days"] == ["2026-01-01"]
    assert before["last_wiped_at"] is None

    wiped = _wipe(client).json()

    after = client.get("/main/chronicle/index").json()
    assert after["days"] == []
    assert after["last_wiped_at"] == wiped["wiped_at"]
    # Additive only: the pre-existing fields are untouched.
    for field in ("first", "last", "geometry_version", "incomplete_days",
                  "incomplete_day_count", "stale_geometry_days"):
        assert field in after


# --- backups -----------------------------------------------------------------


def test_backups_lists_the_wipe_history(client):
    _capture_day("main", "2026-01-01")
    wiped = _wipe(client, reason="because").json()

    body = client.get("/main/chronicle/backups", headers=STAFF_AUTH).json()

    assert body["map"] == "main"
    assert body["count"] == 1
    entry = body["backups"][0]
    assert entry["id"] == wiped["wipe_id"]
    assert entry["day_count"] == 1
    assert entry["reason"] == "because"
    assert entry["wiped_by"] == STAFF_UUID
    assert entry["restored"] is False
    assert entry["restored_at"] is None
    assert entry["backup_exists"] is True


def test_backups_never_lists_another_maps_wipes(client):
    _capture_day("dev", "2026-01-01")
    _wipe(client, confirm="dev", map_name="dev")

    body = client.get("/main/chronicle/backups", headers=STAFF_AUTH).json()
    assert body["backups"] == []


def test_describe_runs_via_run_in_threadpool(client, monkeypatch):
    """Finding 5: `_describe`'s realpath+isdir stats must not run inline.

    They used to run synchronously inside the `async def` route handler, once
    per listed backup, blocking the event loop for up to BACKUP_LIST_LIMIT
    stats. `list_chronicle_backups` must hand that work to
    `run_in_threadpool`, same as `audit.list_wipes` already does for the row
    fetch just above it.
    """
    from starlette.concurrency import run_in_threadpool as real_run_in_threadpool

    from src.api import chronicle_staff_routes as routes_mod

    _capture_day("main", "2026-01-01")
    _wipe(client, reason="because")

    calls = []

    async def spy_run_in_threadpool(func, *args, **kwargs):
        calls.append(func)
        return await real_run_in_threadpool(func, *args, **kwargs)

    monkeypatch.setattr(routes_mod, "run_in_threadpool", spy_run_in_threadpool)

    body = client.get("/main/chronicle/backups", headers=STAFF_AUTH).json()

    assert body["count"] == 1
    # One call for audit.list_wipes, one for the _describe pass over the rows.
    assert len(calls) == 2


# --- restore -----------------------------------------------------------------


def _restore(client, backup_id, *, confirm="main", map_name="main", **extra):
    body = {"confirm": confirm, "backup_id": backup_id}
    body.update(extra)
    return client.post(f"/{map_name}/chronicle/restore", json=body, headers=STAFF_AUTH)


def test_restore_puts_the_days_back_and_stamps_the_row(client):
    _capture_day("main", "2026-01-01")
    _capture_day("main", "2026-01-02")
    wiped = _wipe(client).json()

    body = _restore(client, wiped["wipe_id"]).json()

    assert body["ok"] is True
    assert body["restored_days"] == ["2026-01-01", "2026-01-02"]
    assert body["restored_rows"] == 2
    assert body["restored_by"] == STAFF_UUID

    assert store.list_days("main") == ["2026-01-01", "2026-01-02"]
    assert os.path.isfile(
        os.path.join(store.chronicle_root("main"), "2026-01-01", "nation.json.gz")
    )
    assert client.get("/main/chronicle/index").json()["days"] == [
        "2026-01-01",
        "2026-01-02",
    ]
    # The day is servable again, not just indexed.
    assert client.get("/main/chronicle/2026-01-01/data/nation").status_code == 200

    entry = client.get("/main/chronicle/backups", headers=STAFF_AUTH).json()["backups"][0]
    assert entry["restored"] is True
    assert entry["restored_by"] == STAFF_UUID
    assert entry["restored_at"] == body["restored_at"]
    assert entry["backup_exists"] is False


def test_restore_refuses_when_live_data_exists(client):
    _capture_day("main", "2026-01-01")
    wiped = _wipe(client).json()
    _capture_day("main", "2026-02-01")

    response = _restore(client, wiped["wipe_id"])

    assert response.status_code == 409
    assert response.json()["code"] == "live_data"
    assert store.list_days("main") == ["2026-02-01"]
    assert os.path.isdir(_backup_dir("main", wiped["wipe_id"]))
    assert audit.get_wipe("main", wiped["wipe_id"]).restored_at is None


def test_restore_merges_only_when_asked_and_never_overwrites_live_days(client):
    _capture_day("main", "2026-01-01")
    _capture_day("main", "2026-01-02")
    wiped = _wipe(client).json()
    # The same day is captured again after the wipe, plus a new one.
    _capture_day("main", "2026-01-02")

    body = _restore(client, wiped["wipe_id"], merge=True).json()

    assert body["restored_days"] == ["2026-01-01"]
    assert body["skipped_days"] == ["2026-01-02"]
    assert store.list_days("main") == ["2026-01-01", "2026-01-02"]
    # The colliding day stayed in the backup rather than replacing live bytes.
    assert os.path.isfile(
        os.path.join(_backup_dir("main", wiped["wipe_id"]), "2026-01-02", "nation.json.gz")
    )


def test_restore_rejects_a_backup_path_outside_the_map_output_dir(client, tmp_path):
    _capture_day("main", "2026-01-01")
    wiped = _wipe(client).json()

    escape = tmp_path / "elsewhere"
    escape.mkdir()
    (escape / "keep.txt").write_text("untouched", encoding="utf-8")
    with database.connect() as conn:
        conn.execute(
            "UPDATE map_chronicle_wipes SET backup_path = %s WHERE id = %s",
            (str(escape), wiped["wipe_id"]),
        )

    response = _restore(client, wiped["wipe_id"])

    assert response.status_code == 400
    assert response.json()["code"] == "bad_backup_path"
    assert (escape / "keep.txt").is_file()
    assert store.list_days("main") == []
    assert audit.get_wipe("main", wiped["wipe_id"]).restored_at is None


def test_restore_rejects_a_traversal_backup_path(client):
    _capture_day("main", "2026-01-01")
    wiped = _wipe(client).json()

    with database.connect() as conn:
        conn.execute(
            "UPDATE map_chronicle_wipes SET backup_path = %s WHERE id = %s",
            (os.path.join(store.chronicle_root("main"), "..", "..", "dev"), wiped["wipe_id"]),
        )

    response = _restore(client, wiped["wipe_id"])
    assert response.status_code == 400
    assert response.json()["code"] == "bad_backup_path"


def test_restore_will_not_reach_across_maps(client):
    _capture_day("dev", "2026-01-01")
    wiped = _wipe(client, confirm="dev", map_name="dev").json()

    # Same audit id, asked for on the wrong map.
    response = _restore(client, wiped["wipe_id"])

    assert response.status_code == 404
    assert store.list_days("dev") == []


def test_restore_requires_the_typed_confirmation(client):
    _capture_day("main", "2026-01-01")
    wiped = _wipe(client).json()

    response = _restore(client, wiped["wipe_id"], confirm="MAIN")

    assert response.status_code == 400
    assert store.list_days("main") == []


def test_restore_rejects_a_non_integer_backup_id(client):
    response = _restore(client, "not-a-number")
    assert response.status_code == 400


# --- security regressions ----------------------------------------------------


def test_ui_dev_bearer_cannot_wipe(client, monkeypatch):
    """Even with CHARACTER_UI_DEV=1, the ui-dev bearer cannot wipe.

    The bypass exists so staff-only *reads* can be developed without a real
    session. `ui-dev-session` is a literal constant in this repo, not a
    secret, so honouring it here would put a destructive, irreversible-looking
    operation behind an env var and stamp the audit row with a non-person.
    The env var being set is exactly the case this pins: the flag is on, and
    the wipe is still refused.
    """
    monkeypatch.setenv("CHARACTER_UI_DEV", "1")
    _capture_day("main", "2026-01-01")

    response = client.post(
        "/main/chronicle/wipe",
        json={"confirm": "main", "reason": "x"},
        headers={"Authorization": f"Bearer {map_access.UI_DEV_SESSION_TOKEN}"},
    )

    assert response.status_code == 403
    # The days and the audit table are the real assertion: a 403 that still
    # moved the folders aside would be worse than no gate at all.
    assert store.list_days("main") == ["2026-01-01"]
    assert audit.list_wipes("main", 10) == []


def test_ui_dev_bearer_cannot_wipe_when_dev_flag_is_unset(client, monkeypatch):
    """Without `CHARACTER_UI_DEV=1`, the same bearer is not a valid session."""
    monkeypatch.delenv("CHARACTER_UI_DEV", raising=False)
    _capture_day("main", "2026-01-01")

    response = client.post(
        "/main/chronicle/wipe",
        json={"confirm": "main", "reason": "x"},
        headers={"Authorization": f"Bearer {map_access.UI_DEV_SESSION_TOKEN}"},
    )

    assert response.status_code == 403
    assert store.list_days("main") == ["2026-01-01"]
    assert audit.list_wipes("main", 10) == []


def test_backups_listing_hides_the_server_path(client):
    """Only the basename is returned; the key stays present for the UI."""
    _capture_day("main", "2026-01-01")
    wiped = _wipe(client).json()

    entry = client.get("/main/chronicle/backups", headers=STAFF_AUTH).json()["backups"][0]

    on_disk = _backup_dir("main", wiped["wipe_id"])
    assert entry["backup_path"] == os.path.basename(on_disk)
    assert os.sep not in entry["backup_path"]
    assert entry["backup_exists"] is True


def test_a_deeply_nested_body_is_a_400_not_a_500(client):
    """`request.json()` let json.loads' RecursionError escape as a 500."""
    depth = 20000  # under MAX_STAFF_BODY_BYTES, far past the recursion limit
    body = ("[" * depth) + ("]" * depth)

    response = client.post(
        "/main/chronicle/wipe",
        content=body,
        headers={**STAFF_AUTH, "Content-Type": "application/json"},
    )

    assert response.status_code == 400


def test_an_oversize_body_is_refused(client):
    from src.api.chronicle_staff_routes import MAX_STAFF_BODY_BYTES

    response = client.post(
        "/main/chronicle/wipe",
        content=b'{"confirm": "main", "reason": "' + b"x" * MAX_STAFF_BODY_BYTES + b'"}',
        headers={**STAFF_AUTH, "Content-Type": "application/json"},
    )

    assert response.status_code == 413


def test_a_wipe_is_refused_while_another_process_holds_the_map_lock(client):
    """The lock used to be a process-local `threading.Lock`, so a second uvicorn
    worker saw nothing. It is now a lock file every process contends for — a
    subprocess standing in for that second worker gets the 429."""
    import subprocess
    import textwrap

    _capture_day("main", "2026-01-01")
    lock_path = store.chronicle_lock_path("main")
    script = textwrap.dedent(
        f"""
        import sys, time
        sys.path.insert(0, {str(_BACKEND_ROOT)!r})
        sys.path.insert(0, {str(_BACKEND_SRC)!r})
        from src.scripts.util.maplock import map_lock
        with map_lock({lock_path!r}):
            print("held", flush=True)
            time.sleep(30)
        """
    )
    holder = subprocess.Popen(
        [sys.executable, "-c", script],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert holder.stdout.readline().strip() == "held"
        response = _wipe(client)
        assert response.status_code == 429
        assert "already running" in response.json()["detail"]
    finally:
        holder.kill()
        holder.wait(timeout=30)

    # Nothing happened: the chronicle is untouched and there is no audit row.
    assert store.list_days("main") == ["2026-01-01"]
    assert audit.list_wipes("main", 10) == []

    # And once the other process lets go, the same request goes through.
    assert _wipe(client).status_code == 200
