"""Staff Archive as… route: throwaway ids only, never prod main/calavorn dest."""

from __future__ import annotations

import gzip
import json
import os
import sys
import time
from pathlib import Path

import pytest
import yaml

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
from src.api.chronicle_staff_routes import chronicle_staff_router  # noqa: E402
from src.api.map_registry import clear_map_registry_cache, load_map_registry  # noqa: E402
from src.scripts.chronicle import store as chronicle_store  # noqa: E402
from src.scripts.ledger import store as ledger_store  # noqa: E402
from src.scripts.util import dirs  # noqa: E402
from src.skins import db as skins_db  # noqa: E402

COMMITTED_REGISTRY = _BACKEND_SRC / "config" / "maps.yml"

SOURCE = "chsrc"
DEST = "ch01"

TEST_REGISTRY = """
maps:
  - id: chsrc
    public: true
    display_name: Source
    realm_id: chsrc
  - id: calavorn
    public: true
    archived: true
    display_name: Calavorn
    realm_id: calavorn
"""

STAFF_TOKEN = "staff-token"
STAFF_UUID = "staff-uuid"
STAFF_AUTH = {"Authorization": f"Bearer {STAFF_TOKEN}"}


@pytest.fixture
def archive_http_env(tmp_path, monkeypatch, postgres):
    registry = tmp_path / "maps.yml"
    registry.write_text(TEST_REGISTRY, encoding="utf-8")
    monkeypatch.setenv("MAP_REGISTRY_PATH", str(registry))
    clear_map_registry_cache()

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(skins_db, "DATA_DIR", data_dir)
    monkeypatch.setattr(skins_db, "DB_PATH", data_dir / "province.db")
    monkeypatch.setattr(skins_db, "SKINS_DIR", data_dir / "skins")
    monkeypatch.setattr(skins_db, "WARDROBE_DIR", data_dir / "wardrobe")
    monkeypatch.setattr(skins_db, "DRINKS_DIR", data_dir / "drinks")

    input_dir = tmp_path / "input"
    defines_dir = tmp_path / "defines"
    output_dir = tmp_path / "output"
    monkeypatch.setattr(dirs, "INPUT_DIR", str(input_dir))
    monkeypatch.setattr(dirs, "DEFINES_DIR", str(defines_dir))
    monkeypatch.setattr(dirs, "OUTPUT_DIR", str(output_dir))
    monkeypatch.setattr(chronicle_store, "OUTPUT_DIR", str(output_dir))
    monkeypatch.setattr(ledger_store, "OUTPUT_DIR", str(output_dir))

    def fake_session(token: str):
        if token != STAFF_TOKEN:
            return None
        return {"scope": "profile", "player_uuid": STAFF_UUID, "realm_id": "chsrc"}

    monkeypatch.setattr(map_access, "get_session", fake_session)
    monkeypatch.setattr(
        map_access,
        "has_map_staff_access",
        lambda *_args, **_kwargs: True,
    )

    skins_db.migrate()
    committed = COMMITTED_REGISTRY.read_text(encoding="utf-8")
    try:
        yield {
            "root": tmp_path,
            "input": input_dir,
            "defines": defines_dir,
            "output": output_dir,
            "registry": registry,
            "committed": committed,
        }
    finally:
        clear_map_registry_cache()
        assert COMMITTED_REGISTRY.read_text(encoding="utf-8") == committed


@pytest.fixture
def client(archive_http_env):
    app = FastAPI()
    app.include_router(chronicle_staff_router)
    with TestClient(app) as test_client:
        yield test_client


def _seed_source(archive_http_env, *, day: str = "2026-09-01") -> None:
    src_input = archive_http_env["input"] / SOURCE
    src_input.mkdir(parents=True)
    (src_input / "nation.json").write_text("{}", encoding="utf-8")
    (archive_http_env["defines"] / SOURCE).mkdir(parents=True)
    (archive_http_env["defines"] / SOURCE / "county.json").write_text(
        "{}", encoding="utf-8"
    )
    path = chronicle_store.stored_file_path(SOURCE, day, "nation")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump({"day": day}, handle)
    chronicle_store.upsert_snapshot(
        SOURCE,
        day,
        SOURCE,
        int(time.time()),
        os.path.getsize(path),
        None,
        {"files": {"nation": {"sha256": day}}},
    )


def _archive_body(**overrides):
    body = {
        "dest_id": DEST,
        "display_name": "Chapter One",
        "confirm": DEST,
        "reason": "test archive",
        "replace": False,
        "allow_unknown": False,
    }
    body.update(overrides)
    return body


def test_anonymous_archive_is_403(client, archive_http_env):
    _seed_source(archive_http_env)
    response = client.post(f"/{SOURCE}/chronicle/archive", json=_archive_body())
    assert response.status_code == 403
    assert not (archive_http_env["input"] / DEST).exists()


def test_archive_copy_leaves_source_days(client, archive_http_env):
    _seed_source(archive_http_env)
    response = client.post(
        f"/{SOURCE}/chronicle/archive", json=_archive_body(), headers=STAFF_AUTH
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["source"] == SOURCE
    assert body["dest"] == DEST
    assert body["days"] == ["2026-09-01"]
    assert chronicle_store.list_days(SOURCE) == ["2026-09-01"]
    assert chronicle_store.list_days(DEST) == ["2026-09-01"]
    entries = load_map_registry(force=True)
    assert entries[DEST].archived is True
    assert entries[SOURCE].archived is False


@pytest.mark.parametrize("dest", ["main", "dev"])
def test_archive_refuses_live_dest(client, archive_http_env, dest):
    _seed_source(archive_http_env)
    response = client.post(
        f"/{SOURCE}/chronicle/archive",
        json=_archive_body(dest_id=dest, confirm=dest),
        headers=STAFF_AUTH,
    )
    assert response.status_code == 400
    assert response.json()["code"] == "dest_live_socket"
    assert not (archive_http_env["input"] / dest).exists()
    assert chronicle_store.list_days(SOURCE) == ["2026-09-01"]


def test_archive_existing_dest_needs_replace(client, archive_http_env):
    _seed_source(archive_http_env)
    first = client.post(
        f"/{SOURCE}/chronicle/archive", json=_archive_body(), headers=STAFF_AUTH
    )
    assert first.status_code == 200
    second = client.post(
        f"/{SOURCE}/chronicle/archive", json=_archive_body(), headers=STAFF_AUTH
    )
    assert second.status_code == 400
    assert second.json()["code"] == "dest_exists"
    replaced = client.post(
        f"/{SOURCE}/chronicle/archive",
        json=_archive_body(replace=True),
        headers=STAFF_AUTH,
    )
    assert replaced.status_code == 200
    assert chronicle_store.list_days(SOURCE) == ["2026-09-01"]


def test_archive_refuses_archived_source(client, archive_http_env):
    response = client.post(
        "/calavorn/chronicle/archive", json=_archive_body(), headers=STAFF_AUTH
    )
    assert response.status_code == 400
    assert response.json()["code"] == "source_archived"
    assert not (archive_http_env["input"] / DEST).exists()


def test_committed_yaml_unchanged(client, archive_http_env):
    _seed_source(archive_http_env)
    client.post(
        f"/{SOURCE}/chronicle/archive", json=_archive_body(), headers=STAFF_AUTH
    )
    committed = yaml.safe_load(COMMITTED_REGISTRY.read_text(encoding="utf-8"))
    assert [row["id"] for row in committed["maps"]] == ["main", "dev", "calavorn"]
