"""Chronicle capture + store tests. Filesystem and DB are fully isolated."""

from __future__ import annotations

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

from src import database  # noqa: E402
from src.scripts.chronicle import capture as capture_mod  # noqa: E402
from src.scripts.chronicle import store  # noqa: E402
from src.scripts.util import dirs  # noqa: E402

MAP = "testmap"


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, postgres):
    """Redirect input/defines/output into tmp_path; the index is the test Postgres."""
    monkeypatch.setattr(dirs, "INPUT_DIR", str(tmp_path / "input"))
    monkeypatch.setattr(dirs, "DEFINES_DIR", str(tmp_path / "defines"))
    # store binds OUTPUT_DIR by value at import time.
    monkeypatch.setattr(store, "OUTPUT_DIR", str(tmp_path / "output"))

    (tmp_path / "input" / MAP).mkdir(parents=True)
    (tmp_path / "defines" / MAP).mkdir(parents=True)
    # No maps.yml entry for the fixture map — realm falls back to 'main'.
    monkeypatch.setattr(store, "get_map_entry", lambda _map_id: None)
    return tmp_path


def _write_source(root: Path, name: str, payload: dict) -> None:
    bucket = "defines" if name in capture_mod._DEFINES_SOURCES else "input"
    path = root / bucket / MAP / f"{name}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_all_sources(root: Path, payload: dict | None = None) -> None:
    """Every chronicle source present, so a manifest comes back complete."""
    for name in store.CHRONICLE_FILES:
        _write_source(root, name, payload if payload is not None else {"n": name})


def test_capture_writes_day_dir_manifest_and_index_row(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert manifest is not None
    day_dir = Path(store.chronicle_day_dir(MAP, "2026-01-01"))
    assert (day_dir / "manifest.json").exists()
    assert (day_dir / "nation.json.gz").exists()
    on_disk = json.loads((day_dir / "manifest.json").read_text(encoding="utf-8"))
    assert on_disk["files"]["nation"]["sha256"] == manifest["files"]["nation"]["sha256"]

    row = store.get_snapshot(MAP, "2026-01-01")
    assert row is not None
    assert row["realm_id"] == "main"
    assert row["bytes"] == manifest["files"]["nation"]["gzip_bytes"]
    assert store.list_days(MAP) == ["2026-01-01"]
    assert store.latest_day(MAP) == "2026-01-01"

    stored = Path(store.resolve_stored_file(MAP, "2026-01-01", "nation"))
    assert json.loads(gzip.decompress(stored.read_bytes())) == {"a": 1}


def test_second_capture_same_day_is_noop_unless_forced(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})
    assert capture_mod.capture_snapshot(MAP, day="2026-01-01") is not None
    assert capture_mod.capture_snapshot(MAP, day="2026-01-01") is None

    _write_source(env, "nation", {"a": 2})
    forced = capture_mod.capture_snapshot(MAP, day="2026-01-01", force=True)
    assert forced is not None
    stored = Path(store.resolve_stored_file(MAP, "2026-01-01", "nation"))
    assert json.loads(gzip.decompress(stored.read_bytes())) == {"a": 2}


def test_identical_source_dedups_to_same_as_pointer(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    second = capture_mod.capture_snapshot(MAP, day="2026-01-02")

    assert second["files"]["nation"]["same_as"] == "2026-01-01"
    assert "gzip_bytes" not in second["files"]["nation"]
    assert not os.path.exists(store.stored_file_path(MAP, "2026-01-02", "nation"))
    assert store.get_snapshot(MAP, "2026-01-02")["bytes"] == 0

    # The pointer still resolves back to day 1's real bytes.
    resolved = store.resolve_stored_file(MAP, "2026-01-02", "nation")
    assert resolved == store.stored_file_path(MAP, "2026-01-01", "nation")

    # A third identical day collapses to the same root, not a chain.
    third = capture_mod.capture_snapshot(MAP, day="2026-01-03")
    assert third["files"]["nation"]["same_as"] == "2026-01-01"


def test_changed_source_writes_a_new_file(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    _write_source(env, "nation", {"a": 2})
    second = capture_mod.capture_snapshot(MAP, day="2026-01-02")

    assert "same_as" not in second["files"]["nation"]
    assert os.path.exists(store.stored_file_path(MAP, "2026-01-02", "nation"))
    resolved = Path(store.resolve_stored_file(MAP, "2026-01-02", "nation"))
    assert json.loads(gzip.decompress(resolved.read_bytes())) == {"a": 2}


def test_missing_sources_are_recorded_not_fatal(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})
    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    required = set(store.CHRONICLE_FILES) - set(store.OPTIONAL_CHRONICLE_FILES)
    assert set(manifest["missing"]) == required - {"nation"}
    # The optional sources are absent, not missing — see OPTIONAL_CHRONICLE_FILES.
    assert set(manifest["absent"]) == set(store.OPTIONAL_CHRONICLE_FILES)
    assert manifest["invalid"] == []
    assert list(manifest["files"]) == ["nation"]
    assert manifest["geometry_version"] is None
    assert store.resolve_stored_file(MAP, "2026-01-01", "trade") is None


def test_capture_if_due_skips_when_today_indexed(env: Path, monkeypatch) -> None:
    monkeypatch.setattr(store, "today_utc", lambda: "2026-01-01")
    monkeypatch.setattr(capture_mod, "today_utc", lambda: "2026-01-01")
    _write_all_sources(env)

    assert capture_mod.capture_if_due(MAP) is not None
    assert capture_mod.capture_if_due(MAP) is None


def test_capture_if_due_swallows_failures(env: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        capture_mod,
        "get_snapshot",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    assert capture_mod.capture_if_due(MAP) is None


def test_resolve_stored_file_survives_a_cyclic_same_as_chain(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    capture_mod.capture_snapshot(MAP, day="2026-01-02")

    # Corrupt the index into a cycle: each day points at the other.
    for day, other in (("2026-01-01", "2026-01-02"), ("2026-01-02", "2026-01-01")):
        snapshot = store.get_snapshot(MAP, day)
        snapshot["manifest"]["files"]["nation"] = {"sha256": "x", "same_as": other}
        store.upsert_snapshot(
            map_id=MAP,
            day=day,
            realm_id="main",
            captured_at=0,
            byte_count=0,
            geometry_version=None,
            manifest=snapshot["manifest"],
        )

    assert store.resolve_stored_file(MAP, "2026-01-01", "nation") is None


def test_invalid_inputs_are_rejected(env: Path) -> None:
    assert store.is_valid_day("2026-02-30") is False
    assert store.is_valid_day("2026-1-1") is False
    assert store.is_valid_day("2026-01-01") is True
    with pytest.raises(ValueError):
        capture_mod.capture_snapshot("bad/map", day="2026-01-01")
    with pytest.raises(ValueError):
        capture_mod.capture_snapshot(MAP, day="not-a-day")


def test_torn_source_is_recorded_invalid_and_does_not_lose_other_files(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})
    # Simulate a capture landing mid-upload: truncated JSON on disk.
    (env / "input" / MAP / "province_data.json").write_text('{"a": 1', encoding="utf-8")

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert manifest["invalid"] == ["province_data"]
    assert "province_data" not in manifest["files"]
    assert "province_data" not in manifest["missing"]
    assert not os.path.exists(store.stored_file_path(MAP, "2026-01-01", "province_data"))
    # The healthy file was still captured.
    assert "nation" in manifest["files"]
    assert store.resolve_stored_file(MAP, "2026-01-01", "province_data") is None


def test_force_recapture_fixes_up_a_previously_invalid_file(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})
    (env / "input" / MAP / "province_data.json").write_text('{"a": 1', encoding="utf-8")
    capture_mod.capture_snapshot(MAP, day="2026-01-01")

    _write_source(env, "province_data", {"a": 1})
    fixed = capture_mod.capture_snapshot(MAP, day="2026-01-01", force=True)

    assert fixed["invalid"] == []
    assert "province_data" in fixed["files"]
    resolved = Path(store.resolve_stored_file(MAP, "2026-01-01", "province_data"))
    assert json.loads(gzip.decompress(resolved.read_bytes())) == {"a": 1}


def test_previous_snapshot_ignores_the_day_being_written(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    capture_mod.capture_snapshot(MAP, day="2026-01-02")

    assert store.previous_snapshot(MAP, "2026-01-02")["day"] == "2026-01-01"
    assert store.previous_snapshot(MAP, "2026-01-01") is None


# --- regression: force re-capture must not mutate what later days resolve to ---


def test_force_recapture_refuses_when_a_later_day_dedups_against_it(env: Path) -> None:
    _write_source(env, "nation", {"nations": ["A", "B", "C"]})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    second = capture_mod.capture_snapshot(MAP, day="2026-01-02")
    assert second["files"]["nation"]["same_as"] == "2026-01-01"

    before = Path(store.resolve_stored_file(MAP, "2026-01-02", "nation")).read_bytes()
    entry_before = store.get_snapshot(MAP, "2026-01-02")["manifest"]["files"]["nation"]

    _write_source(env, "nation", {"nations": ["TOTALLY", "DIFFERENT"]})
    with pytest.raises(capture_mod.ChronicleForwardReferenceError) as excinfo:
        capture_mod.capture_snapshot(MAP, day="2026-01-01", force=True)
    # The operator needs to know which days block them.
    assert "2026-01-02" in str(excinfo.value)

    # Nothing changed: day 2 still serves the bytes its sha256 claims.
    after = Path(store.resolve_stored_file(MAP, "2026-01-02", "nation")).read_bytes()
    assert after == before
    assert json.loads(gzip.decompress(after)) == {"nations": ["A", "B", "C"]}
    assert store.get_snapshot(MAP, "2026-01-02")["manifest"]["files"]["nation"] == entry_before


def test_force_refusal_also_covers_a_source_that_vanished(env: Path) -> None:
    """The worst variant: day 1 would get no files entry at all, orphaning
    every later day that points at it."""
    _write_source(env, "nation", {"a": 1})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    capture_mod.capture_snapshot(MAP, day="2026-01-02")

    os.remove(env / "defines" / MAP / "nation.json")
    with pytest.raises(capture_mod.ChronicleForwardReferenceError):
        capture_mod.capture_snapshot(MAP, day="2026-01-01", force=True)

    assert store.resolve_stored_file(MAP, "2026-01-02", "nation") is not None


def test_force_is_allowed_when_nothing_points_at_the_day(env: Path) -> None:
    """The real use of force -- fixing today -- must still work."""
    _write_source(env, "nation", {"a": 1})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    _write_source(env, "nation", {"a": 2})

    forced = capture_mod.capture_snapshot(MAP, day="2026-01-01", force=True)
    assert forced is not None
    resolved = Path(store.resolve_stored_file(MAP, "2026-01-01", "nation"))
    assert json.loads(gzip.decompress(resolved.read_bytes())) == {"a": 2}


def test_days_referencing_only_looks_forward(env: Path) -> None:
    _write_source(env, "nation", {"a": 1})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    capture_mod.capture_snapshot(MAP, day="2026-01-02")

    assert store.days_referencing(MAP, "2026-01-01") == ["2026-01-02"]
    assert store.days_referencing(MAP, "2026-01-02") == []


# --- regression: a transient bad source must not block its own retry ---


def test_a_later_manifest_that_is_not_an_object_blocks_the_overwrite(env: Path) -> None:
    """It cannot be shown not to point back here, so it counts as a dependant."""
    _write_source(env, "nation", {"a": 1})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    store.upsert_snapshot(MAP, "2026-01-02", "main", 0, 0, None, {"files": {}})
    with database.connect() as conn:
        conn.execute(
            "UPDATE map_chronicle_snapshots SET manifest = %s WHERE map_id = %s AND day = %s",
            (database.Jsonb([1, 2, 3]), MAP, "2026-01-02"),
        )

    assert store.days_referencing(MAP, "2026-01-01") == ["2026-01-02"]
    assert store.get_snapshot(MAP, "2026-01-02")["manifest"] == {}


def test_capture_if_due_retries_a_day_whose_source_was_torn(env: Path, monkeypatch) -> None:
    monkeypatch.setattr(store, "today_utc", lambda: "2026-01-01")
    monkeypatch.setattr(capture_mod, "today_utc", lambda: "2026-01-01")
    _write_all_sources(env)
    # The 00:03 upload catches province_data.json mid-rewrite.
    (env / "input" / MAP / "province_data.json").write_text('{"a": 1', encoding="utf-8")

    first = capture_mod.capture_if_due(MAP)
    assert first["invalid"] == ["province_data"]

    # The writer finished. The next upload must not be short-circuited by the
    # row the failed capture wrote.
    _write_source(env, "province_data", {"provinces": [1, 2, 3]})
    second = capture_mod.capture_if_due(MAP)
    assert second is not None
    assert second["invalid"] == []
    resolved = Path(store.resolve_stored_file(MAP, "2026-01-01", "province_data"))
    assert json.loads(gzip.decompress(resolved.read_bytes())) == {"provinces": [1, 2, 3]}

    # Now complete, it stops re-running.
    assert capture_mod.capture_if_due(MAP) is None


def test_capture_if_due_retry_rewrites_nothing_when_a_source_stays_absent(
    env: Path, monkeypatch
) -> None:
    """A permanently absent source retries once per upload forever. That is
    accepted -- but the retry must not churn the stored bytes."""
    monkeypatch.setattr(store, "today_utc", lambda: "2026-01-01")
    monkeypatch.setattr(capture_mod, "today_utc", lambda: "2026-01-01")
    _write_source(env, "nation", {"a": 1})

    first = capture_mod.capture_if_due(MAP)
    assert "province_data" in first["missing"]
    stored = Path(store.stored_file_path(MAP, "2026-01-01", "nation"))
    before_bytes = stored.read_bytes()

    writes: list[str] = []
    real_write = capture_mod._write_atomic

    def spy_write(path: str, data: bytes) -> None:
        writes.append(path)
        real_write(path, data)

    monkeypatch.setattr(capture_mod, "_write_atomic", spy_write)

    again = capture_mod.capture_if_due(MAP)
    assert again is not None
    assert again["missing"] == first["missing"]
    # Only the manifest is rewritten; the payload is kept by entry.
    assert [os.path.basename(p) for p in writes] == ["manifest.json"]
    assert stored.read_bytes() == before_bytes


# --- regression: concurrent captures of the same day ---


def test_concurrent_captures_of_one_day_are_serialised(env: Path, monkeypatch) -> None:
    """Two threadpool workers start a capture for the same (map, day) -- the
    first upload burst of a UTC day does exactly this."""
    _write_all_sources(env)

    real_write = capture_mod._write_atomic

    def slow_write(path: str, data: bytes) -> None:
        # Widen the window a second writer could land in.
        time.sleep(0.02)
        real_write(path, data)

    monkeypatch.setattr(capture_mod, "_write_atomic", slow_write)

    barrier = threading.Barrier(2)
    results: list[object] = []
    errors: list[BaseException] = []

    def run() -> None:
        try:
            barrier.wait()
            results.append(capture_mod.capture_snapshot(MAP, day="2026-01-01"))
        except BaseException as exc:  # noqa: BLE001 - recorded, asserted below
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not errors, errors
    # Exactly one capture ran; the loser saw the finished row and backed off.
    assert sorted(r is None for r in results) == [False, True]

    day_dir = Path(store.chronicle_day_dir(MAP, "2026-01-01"))
    # No half-written temp siblings left behind.
    assert [p.name for p in day_dir.iterdir() if ".part" in p.name] == []
    for name in store.CHRONICLE_FILES:
        resolved = Path(store.resolve_stored_file(MAP, "2026-01-01", name))
        assert json.loads(gzip.decompress(resolved.read_bytes())) == {"n": name}


def test_write_atomic_uses_a_unique_temp_name(env: Path, monkeypatch) -> None:
    """A fixed <path>.tmp sibling is what let two writers collide."""
    day_dir = Path(store.chronicle_day_dir(MAP, "2026-01-01"))
    day_dir.mkdir(parents=True)
    target = day_dir / "nation.json.gz"

    seen: list[str] = []
    real_mkstemp = capture_mod.tempfile.mkstemp

    def spy(*args, **kwargs):
        fd, path = real_mkstemp(*args, **kwargs)
        seen.append(path)
        return fd, path

    monkeypatch.setattr(capture_mod.tempfile, "mkstemp", spy)
    capture_mod._write_atomic(str(target), b"one")
    capture_mod._write_atomic(str(target), b"two")

    assert len(set(seen)) == 2
    assert str(target) + ".tmp" not in seen
    assert target.read_bytes() == b"two"
    assert list(day_dir.iterdir()) == [target]


# --- regression: whitespace-only sources ---


@pytest.mark.parametrize("payload", ["", "   ", "\n\t \r\n"])
def test_blank_source_is_rejected_as_invalid(env: Path, payload: str) -> None:
    _write_source(env, "nation", {"a": 1})
    (env / "input" / MAP / "province_data.json").write_text(payload, encoding="utf-8")

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert manifest["invalid"] == ["province_data"]
    assert "province_data" not in manifest["files"]
    assert not os.path.exists(store.stored_file_path(MAP, "2026-01-01", "province_data"))


@pytest.mark.parametrize("payload", ["{}", "[]", '{"a": {}}'])
def test_empty_json_containers_are_still_captured(env: Path, payload: str) -> None:
    """zoc_overlays.json is legitimately 2 bytes -- an empty container is data."""
    (env / "defines" / MAP / "zoc_overlays.json").write_text(payload, encoding="utf-8")

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert manifest["invalid"] == []
    assert "zoc_overlays" in manifest["files"]
    resolved = Path(store.resolve_stored_file(MAP, "2026-01-01", "zoc_overlays"))
    assert gzip.decompress(resolved.read_bytes()).decode("utf-8") == payload


# --- empire + infestation_data: optional sources added to the captured set ---


_NEW_FILES = ("empire", "infestation_data")


def test_new_optional_sources_are_captured_when_present(env: Path) -> None:
    """Both new names round-trip, which also proves the defines/ vs input/
    split: a title tier looked for in input/ would come back absent."""
    _write_all_sources(env)

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert manifest["missing"] == []
    assert manifest["absent"] == []
    assert manifest["invalid"] == []
    for name in _NEW_FILES:
        assert name in manifest["files"], name
        resolved = Path(store.resolve_stored_file(MAP, "2026-01-01", name))
        assert json.loads(gzip.decompress(resolved.read_bytes())) == {"n": name}


_TITLE_FILES = ("county", "duchy", "kingdom")


def test_empire_is_read_from_defines_not_input(env: Path) -> None:
    """The trap: omitting empire from _DEFINES_SOURCES makes capture look in
    input/, find nothing, and flag every day."""
    assert "empire" in capture_mod._DEFINES_SOURCES
    assert capture_mod._source_path(MAP, "empire") == str(
        env / "defines" / MAP / "empire.json"
    )
    for name in _TITLE_FILES:
        assert name in store.CHRONICLE_FILES
        assert name in capture_mod._DEFINES_SOURCES
        assert capture_mod._source_path(MAP, name) == str(
            env / "defines" / MAP / f"{name}.json"
        )
        assert name not in store.OPTIONAL_CHRONICLE_FILES
    # infestation_data is an upload, so it stays in input/.
    assert "infestation_data" not in capture_mod._DEFINES_SOURCES
    assert capture_mod._source_path(MAP, "infestation_data") == str(
        env / "input" / MAP / "infestation_data.json"
    )


def test_title_tiers_are_captured_when_present(env: Path) -> None:
    _write_all_sources(env)

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert manifest["missing"] == []
    assert manifest["invalid"] == []
    for name in _TITLE_FILES:
        assert name in manifest["files"], name
        resolved = Path(store.resolve_stored_file(MAP, "2026-01-01", name))
        assert json.loads(gzip.decompress(resolved.read_bytes())) == {"n": name}


def test_missing_title_tier_is_incomplete_not_absent(env: Path) -> None:
    """County/duchy/kingdom are required; a map without county.json is degraded."""
    for name in store.CHRONICLE_FILES:
        if name == "county":
            continue
        _write_source(env, name, {"n": name})

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert "county" in manifest["missing"]
    assert "county" not in manifest.get("absent", [])
    assert "county" not in manifest["files"]
    assert capture_mod._is_incomplete(manifest) is True


def test_unchanged_title_tiers_dedup_via_same_as(env: Path) -> None:
    _write_all_sources(env)
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    _write_source(env, "nation", {"n": "changed"})
    second = capture_mod.capture_snapshot(MAP, day="2026-01-02")

    for name in _TITLE_FILES:
        assert second["files"][name]["same_as"] == "2026-01-01"
        assert not os.path.exists(store.stored_file_path(MAP, "2026-01-02", name))
        assert store.resolve_stored_file(
            MAP, "2026-01-02", name
        ) == store.stored_file_path(MAP, "2026-01-01", name)

    third = capture_mod.capture_snapshot(MAP, day="2026-01-03")
    assert third["files"]["county"]["same_as"] == "2026-01-01"


def test_torn_county_json_is_invalid_not_stored(env: Path) -> None:
    _write_all_sources(env)
    (env / "defines" / MAP / "county.json").write_text('{"a": 1', encoding="utf-8")

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert "county" in manifest["invalid"]
    assert "county" not in manifest["files"]
    assert capture_mod._is_incomplete(manifest) is True


def test_absent_optional_sources_do_not_degrade_the_day(env: Path) -> None:
    """A map with no empires and no infestation feed -- i.e. `main` today --
    must still produce a complete day."""
    for name in store.CHRONICLE_FILES:
        if name not in store.OPTIONAL_CHRONICLE_FILES:
            _write_source(env, name, {"n": name})

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert manifest["missing"] == []
    assert manifest["invalid"] == []
    assert set(manifest["absent"]) == set(_NEW_FILES)
    # The whole point: not incomplete, so the index will not list it as degraded
    # and capture_if_due will not force a re-capture on every upload.
    assert capture_mod._is_incomplete(manifest) is False


def test_capture_if_due_stops_retrying_when_only_optional_sources_are_absent(
    env: Path, monkeypatch
) -> None:
    monkeypatch.setattr(store, "today_utc", lambda: "2026-01-01")
    monkeypatch.setattr(capture_mod, "today_utc", lambda: "2026-01-01")
    for name in store.CHRONICLE_FILES:
        if name not in store.OPTIONAL_CHRONICLE_FILES:
            _write_source(env, name, {"n": name})

    assert capture_mod.capture_if_due(MAP) is not None
    assert capture_mod.capture_if_due(MAP) is None


def test_present_but_torn_optional_source_is_still_invalid(env: Path) -> None:
    """Optional means "may not exist", not "may be corrupt"."""
    _write_all_sources(env)
    (env / "defines" / MAP / "empire.json").write_text('{"a": 1', encoding="utf-8")

    manifest = capture_mod.capture_snapshot(MAP, day="2026-01-01")

    assert manifest["invalid"] == ["empire"]
    assert manifest["absent"] == []
    assert "empire" not in manifest["files"]
    assert capture_mod._is_incomplete(manifest) is True


def test_unchanged_empire_dedups_via_same_as(env: Path) -> None:
    """Empires change rarely, so same_as is the common path for them."""
    _write_all_sources(env)
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    # Only nation moves; the new files are byte-identical.
    _write_source(env, "nation", {"n": "changed"})
    second = capture_mod.capture_snapshot(MAP, day="2026-01-02")

    assert "same_as" not in second["files"]["nation"]
    for name in _NEW_FILES:
        assert second["files"][name]["same_as"] == "2026-01-01"
        assert not os.path.exists(store.stored_file_path(MAP, "2026-01-02", name))
        assert store.resolve_stored_file(
            MAP, "2026-01-02", name
        ) == store.stored_file_path(MAP, "2026-01-01", name)

    # A third identical day collapses to the same root, not a chain.
    third = capture_mod.capture_snapshot(MAP, day="2026-01-03")
    assert third["files"]["empire"]["same_as"] == "2026-01-01"


def test_a_day_captured_before_the_new_files_existed_still_resolves(env: Path) -> None:
    """Old stored days simply have no entry for the new names: resolve returns
    None (which the read route turns into its 404), never an exception."""
    _write_source(env, "nation", {"a": 1})
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    # Rewrite the row exactly as a pre-change capture left it: no new names in
    # `files`, no `absent` key at all.
    snapshot = store.get_snapshot(MAP, "2026-01-01")
    legacy = {
        "map": MAP,
        "day": "2026-01-01",
        "captured_at": 0,
        "geometry_version": None,
        "files": {"nation": snapshot["manifest"]["files"]["nation"]},
        "missing": [],
        "invalid": [],
    }
    store.upsert_snapshot(
        map_id=MAP,
        day="2026-01-01",
        realm_id="main",
        captured_at=0,
        byte_count=0,
        geometry_version=None,
        manifest=legacy,
    )

    for name in _NEW_FILES:
        assert store.resolve_stored_file(MAP, "2026-01-01", name) is None
    # The pre-existing file is untouched.
    assert store.resolve_stored_file(MAP, "2026-01-01", "nation") is not None
    assert capture_mod._is_incomplete(legacy) is False


def test_a_capture_cannot_land_in_the_middle_of_a_wipe(env: Path, monkeypatch) -> None:
    """The destructive race: archive -> move -> delete is three steps, and
    `capture_if_due` runs from every upload. A capture landing after the archive
    insert used to write a live row the delete then removed with no archive
    copy, losing that day for good."""
    from src.scripts.chronicle import wipe as wipe_mod

    _write_all_sources(env)
    day = store.today_utc()
    assert capture_mod.capture_snapshot(MAP, day=day) is not None

    order: list[str] = []
    at_move = threading.Event()
    release = threading.Event()
    real_rename = wipe_mod.rename_aside

    def gated_rename(root: str, backup: str) -> None:
        at_move.set()
        assert release.wait(30)
        real_rename(root, backup)

    monkeypatch.setattr(wipe_mod, "rename_aside", gated_rename)

    wiped: list[object] = []

    def run_wipe() -> None:
        wiped.append(wipe_mod.perform_wipe(MAP))
        order.append("wipe-done")

    wipe_thread = threading.Thread(target=run_wipe)
    wipe_thread.start()
    assert at_move.wait(30)

    captured: list[object] = []
    at_capture = threading.Event()

    def run_capture() -> None:
        at_capture.set()
        captured.append(capture_mod.capture_if_due(MAP))
        order.append("capture-done")

    capture_thread = threading.Thread(target=run_capture)
    capture_thread.start()
    assert at_capture.wait(30)
    # Blocked on the map lock: the wipe is parked mid-move and has not finished,
    # so the capture must still be waiting when this join times out.
    capture_thread.join(1.0)
    assert capture_thread.is_alive()
    assert order == []

    release.set()
    wipe_thread.join(30)
    capture_thread.join(30)
    assert not wipe_thread.is_alive() and not capture_thread.is_alive()

    # The capture ran strictly after the wipe, never inside it.
    assert order == ["wipe-done", "capture-done"]
    assert captured and captured[0] is not None

    result = wiped[0]
    # The wiped day went to the archive *and* to the backup: fully archived.
    assert result.day_count == 1
    with database.connect() as conn:
        archived = [
            row["day"]
            for row in conn.execute(
                "SELECT day FROM map_chronicle_snapshots_archive WHERE map_id = %s",
                (MAP,),
            ).fetchall()
        ]
    assert archived == [day]
    assert os.path.isdir(os.path.join(result.backup_path, day))

    # And every live row that exists now has its bytes in the live tree.
    for live_day in store.list_days(MAP):
        assert os.path.isdir(store.chronicle_day_dir(MAP, live_day))
