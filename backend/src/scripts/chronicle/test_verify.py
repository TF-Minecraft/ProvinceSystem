"""Tests for the read-only chronicle integrity check."""

from __future__ import annotations

import gzip
import json
import os
import sys
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
from src.scripts.chronicle import store, verify  # noqa: E402
from src.scripts.util import dirs  # noqa: E402

MAP = "testmap"


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, postgres):
    """Same isolation as test_capture: nothing touches the real output/db."""
    monkeypatch.setattr(dirs, "INPUT_DIR", str(tmp_path / "input"))
    monkeypatch.setattr(dirs, "DEFINES_DIR", str(tmp_path / "defines"))
    monkeypatch.setattr(store, "OUTPUT_DIR", str(tmp_path / "output"))

    (tmp_path / "input" / MAP).mkdir(parents=True)
    (tmp_path / "defines" / MAP).mkdir(parents=True)
    monkeypatch.setattr(store, "get_map_entry", lambda _map_id: None)
    return tmp_path


def _write_all_sources(root: Path) -> None:
    for name in store.CHRONICLE_FILES:
        bucket = "defines" if name in capture_mod._DEFINES_SOURCES else "input"
        (root / bucket / MAP / f"{name}.json").write_text(
            json.dumps({"n": name}), encoding="utf-8"
        )


def test_healthy_chronicle_verifies_clean(env: Path) -> None:
    _write_all_sources(env)
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    # Day 2 is entirely same_as pointers.
    capture_mod.capture_snapshot(MAP, day="2026-01-02")

    assert verify.verify_map(MAP) == []
    assert verify.main(["--map", MAP]) == 0


def test_tampered_bytes_are_detected_through_a_same_as_pointer(env: Path) -> None:
    _write_all_sources(env)
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    capture_mod.capture_snapshot(MAP, day="2026-01-02")

    # Exactly what a forced re-capture of day 1 used to do silently.
    target = store.stored_file_path(MAP, "2026-01-01", "nation")
    with open(target, "wb") as fh:
        fh.write(gzip.compress(b'{"n": "tampered"}', mtime=0))

    problems = verify.verify_map(MAP)
    assert any("2026-01-01/nation" in line and "mismatch" in line for line in problems)
    assert any(
        "2026-01-02/nation" in line and "same_as -> 2026-01-01" in line
        for line in problems
    )
    assert verify.main(["--map", MAP]) == 1


def test_dangling_same_as_and_missing_files_are_reported(env: Path) -> None:
    _write_all_sources(env)
    capture_mod.capture_snapshot(MAP, day="2026-01-01")
    capture_mod.capture_snapshot(MAP, day="2026-01-02")

    os.remove(store.stored_file_path(MAP, "2026-01-01", "trade"))

    problems = verify.verify_map(MAP)
    assert any("2026-01-01/trade" in line and "missing" in line for line in problems)
    assert any("2026-01-02/trade" in line and "dangling" in line for line in problems)


def test_incomplete_manifests_are_reported(env: Path) -> None:
    # Only one source present, and one of them torn.
    (env / "defines" / MAP / "nation.json").write_text('{"a": 1}', encoding="utf-8")
    (env / "input" / MAP / "province_data.json").write_text("   ", encoding="utf-8")
    capture_mod.capture_snapshot(MAP, day="2026-01-01")

    problems = verify.verify_map(MAP)
    assert any("province_data" in line and "unparsable" in line for line in problems)
    assert any("guilds" in line and "absent" in line for line in problems)
    assert verify.main(["--map", MAP]) == 1


def test_verify_writes_nothing(env: Path) -> None:
    _write_all_sources(env)
    capture_mod.capture_snapshot(MAP, day="2026-01-01")

    day_dir = Path(store.chronicle_day_dir(MAP, "2026-01-01"))
    before = {p.name: (p.stat().st_mtime_ns, p.read_bytes()) for p in day_dir.iterdir()}

    assert verify.verify_map(MAP) == []

    after = {p.name: (p.stat().st_mtime_ns, p.read_bytes()) for p in day_dir.iterdir()}
    assert after == before


def test_invalid_map_name_is_rejected(env: Path) -> None:
    with pytest.raises(SystemExit):
        verify.main(["--map", "../etc"])
