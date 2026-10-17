"""Archive copy engine: throwaway map ids only, never prod main/calavorn."""

from __future__ import annotations

import gzip
import json
import os
import sys
import time
from pathlib import Path

import pytest
import yaml

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

from src.api.map_registry import clear_map_registry_cache, load_map_registry  # noqa: E402
from src.scripts.chronicle import store as chronicle_store  # noqa: E402
from src.scripts.ledger import store as ledger_store  # noqa: E402
from src.scripts.maps.archive_copy import (  # noqa: E402
    ArchiveCopyError,
    archive_map,
)
from src.scripts.util import dirs  # noqa: E402
from src import database  # noqa: E402

COMMITTED_REGISTRY = _BACKEND_SRC / "config" / "maps.yml"

SOURCE = "chsrc"
DEST = "ch01"

_MIN_YAML = """
maps:
  - id: chsrc
    public: true
    display_name: Source
    realm_id: chsrc
"""


@pytest.fixture
def archive_env(tmp_path, monkeypatch, postgres):
    input_dir = tmp_path / "input"
    defines_dir = tmp_path / "defines"
    output_dir = tmp_path / "output"
    monkeypatch.setattr(dirs, "INPUT_DIR", str(input_dir))
    monkeypatch.setattr(dirs, "DEFINES_DIR", str(defines_dir))
    monkeypatch.setattr(dirs, "OUTPUT_DIR", str(output_dir))
    monkeypatch.setattr(chronicle_store, "OUTPUT_DIR", str(output_dir))
    monkeypatch.setattr(ledger_store, "OUTPUT_DIR", str(output_dir))

    registry = tmp_path / "maps.yml"
    registry.write_text(_MIN_YAML, encoding="utf-8")
    monkeypatch.setenv("MAP_REGISTRY_PATH", str(registry))
    clear_map_registry_cache()

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


def _seed_source(archive_env, *, nation: str = "alpha", day: str = "2026-09-01") -> None:
    src_input = archive_env["input"] / SOURCE
    src_input.mkdir(parents=True)
    (src_input / "nation.json").write_text(
        json.dumps({"name": nation}), encoding="utf-8"
    )
    src_defines = archive_env["defines"] / SOURCE
    src_defines.mkdir(parents=True)
    (src_defines / "county.json").write_text("{}", encoding="utf-8")

    path = chronicle_store.stored_file_path(SOURCE, day, "nation")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump({"day": day, "name": nation}, handle)
    chronicle_store.upsert_snapshot(
        SOURCE,
        day,
        SOURCE,
        int(time.time()),
        os.path.getsize(path),
        None,
        {"files": {"nation": {"sha256": day}}},
    )


def test_copy_leaves_source_and_indexes_dest(archive_env):
    _seed_source(archive_env)
    result = archive_map(SOURCE, DEST, "Chapter One")
    assert result.dest_id == DEST
    assert result.days == ["2026-09-01"]

    src_nation = archive_env["input"] / SOURCE / "nation.json"
    dest_nation = archive_env["input"] / DEST / "nation.json"
    assert json.loads(src_nation.read_text(encoding="utf-8")) == {"name": "alpha"}
    assert dest_nation.read_text(encoding="utf-8") == src_nation.read_text(
        encoding="utf-8"
    )
    assert (archive_env["defines"] / DEST / "county.json").is_file()
    assert chronicle_store.list_days(SOURCE) == ["2026-09-01"]
    assert chronicle_store.list_days(DEST) == ["2026-09-01"]
    dest_day = chronicle_store.stored_file_path(DEST, "2026-09-01", "nation")
    assert os.path.isfile(dest_day)

    entries = load_map_registry(force=True)
    assert entries[DEST].archived is True
    assert entries[DEST].public is True
    assert entries[DEST].display_name == "Chapter One"
    assert entries[DEST].realm_id == DEST
    assert entries[SOURCE].archived is False


def test_second_archive_replaces_dest(archive_env):
    _seed_source(archive_env, nation="alpha")
    archive_map(SOURCE, DEST, "Chapter One")
    (archive_env["input"] / SOURCE / "nation.json").write_text(
        json.dumps({"name": "beta"}), encoding="utf-8"
    )
    archive_map(SOURCE, DEST, "Chapter One")
    dest = json.loads(
        (archive_env["input"] / DEST / "nation.json").read_text(encoding="utf-8")
    )
    assert dest == {"name": "beta"}
    src = json.loads(
        (archive_env["input"] / SOURCE / "nation.json").read_text(encoding="utf-8")
    )
    assert src == {"name": "beta"}


@pytest.mark.parametrize("dest, code", [("main", "dest_live_socket"), ("dev", "dest_live_socket"), ("unknown", "dest_unknown")])
def test_refuse_live_and_unknown_dest_writes_nothing(archive_env, dest, code):
    _seed_source(archive_env)
    with pytest.raises(ArchiveCopyError) as ctx:
        archive_map(SOURCE, dest, "Nope")
    assert ctx.value.code == code
    assert not (archive_env["input"] / dest).exists()
    maps = yaml.safe_load(archive_env["registry"].read_text(encoding="utf-8"))["maps"]
    assert [row["id"] for row in maps] == [SOURCE]
    assert chronicle_store.list_days(SOURCE) == ["2026-09-01"]
    assert chronicle_store.list_days(dest) == []


def test_committed_registry_still_only_live_and_calavorn(archive_env):
    _seed_source(archive_env)
    archive_map(SOURCE, DEST, "Chapter One")
    committed = yaml.safe_load(COMMITTED_REGISTRY.read_text(encoding="utf-8"))
    ids = [row["id"] for row in committed["maps"]]
    assert ids == ["main", "dev", "calavorn"]
    assert DEST not in ids


def test_missing_source_tree_is_refused(archive_env):
    with pytest.raises(ArchiveCopyError) as ctx:
        archive_map(SOURCE, DEST, "Chapter One")
    assert ctx.value.code == "source_missing"
    assert not (archive_env["input"] / DEST).exists()
