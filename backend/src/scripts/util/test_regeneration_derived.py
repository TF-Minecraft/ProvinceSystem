"""Tests for the staleness-gated derived artifacts wired into regeneration."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from . import regeneration
from .regeneration import (
    _RegenTimings,
    _rebuild_derived,
    derived_is_current,
    run_derived_artifacts,
    warm_webp_cache,
)


class _DerivedTestCase(unittest.TestCase):
    """Redirects input/ and defines/ at a throwaway tree."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = self._tmp.name
        self.map_name = "testmap"

        def input_file(map_name: str, filename: str) -> str:
            path = os.path.join(root, "input", map_name, filename)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            return path

        def defines_file(map_name: str, filename: str) -> str:
            path = os.path.join(root, "defines", map_name, filename)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            return path

        self.input_file = input_file
        self.defines_file = defines_file

        for target in ("input_file", "defines_file"):
            patcher = patch.object(regeneration, target, locals()[target])
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)

    def write(self, path: str, text: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)


class TestRebuildDerived(_DerivedTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.source = self.input_file(self.map_name, "provinces.png")
        self.output = self.defines_file(self.map_name, "artifact.bin")
        self.write(self.source, "pixels-v1")
        self.calls: list[int] = []

    def build(self) -> None:
        self.calls.append(1)
        self.write(self.output, "built-%d" % len(self.calls))

    def run_once(self, timings: _RegenTimings | None = None) -> None:
        _rebuild_derived(
            self.map_name,
            "artifact",
            "artifact",
            [self.source],
            [self.output],
            self.build,
            timings or _RegenTimings(),
        )

    def test_builds_when_missing_then_skips_when_unchanged(self) -> None:
        self.run_once()
        self.assertEqual(len(self.calls), 1)
        self.run_once()
        self.assertEqual(len(self.calls), 1, "unchanged sources must not rebuild")

    def test_rebuilds_when_source_content_changes(self) -> None:
        self.run_once()
        self.write(self.source, "pixels-v2")
        self.run_once()
        self.assertEqual(len(self.calls), 2)

    def test_touching_source_without_content_change_does_not_rebuild(self) -> None:
        """A git checkout or docker build moves mtimes but not bytes."""
        self.run_once()
        stat = os.stat(self.source)
        os.utime(self.source, (stat.st_atime + 10_000, stat.st_mtime + 10_000))
        self.run_once()
        self.assertEqual(len(self.calls), 1)

    def test_rebuilds_when_output_deleted(self) -> None:
        self.run_once()
        os.remove(self.output)
        self.run_once()
        self.assertEqual(len(self.calls), 2)

    def test_missing_source_skips_without_raising(self) -> None:
        os.remove(self.source)
        self.run_once()
        self.assertEqual(self.calls, [])

    def test_build_failure_is_not_fatal_and_is_not_stamped(self) -> None:
        def boom() -> None:
            self.calls.append(1)
            raise RuntimeError("scan exploded")

        _rebuild_derived(
            self.map_name,
            "artifact",
            "artifact",
            [self.source],
            [self.output],
            boom,
            _RegenTimings(),
        )
        self.assertEqual(len(self.calls), 1)
        # Nothing was stamped, so the next regen retries even though a partial
        # output exists.
        self.write(self.output, "partial")
        self.run_once()
        self.assertEqual(len(self.calls), 2)

    def test_records_timing_only_when_it_builds(self) -> None:
        built = _RegenTimings()
        self.run_once(built)
        self.assertEqual(
            [label for label, _ in built.sorted_rows()], ["derived.artifact"]
        )

        skipped = _RegenTimings()
        self.run_once(skipped)
        self.assertEqual(skipped.sorted_rows(), [])

    def test_derived_is_current_false_without_stamp(self) -> None:
        self.write(self.output, "orphan")
        self.assertFalse(
            derived_is_current(
                self.map_name, "artifact", {"provinces.png": "x"}, [self.output]
            )
        )


class TestRunDerivedArtifacts(_DerivedTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.write(self.input_file(self.map_name, "provinces.png"), "pixels")
        self.write(self.defines_file(self.map_name, "provinces.txt"), "1=1,2,3")
        self.write(self.input_file(self.map_name, "map.png"), "base")

    def _patched_run(self, twice: bool = False) -> dict[str, int]:
        recorded = {"grid": 0, "q4": 0, "runs": 0, "geometry": 0, "preview": 0}

        def grid(map_name: str, dest=None, source=None, scale: int = 1) -> None:
            # The q4 variant goes through the same writer with an explicit
            # dest, so tell the two apart by the target filename.
            path = dest or self.defines_file(map_name, regeneration.GRID_FILENAME)
            recorded["q4" if regeneration.Q4_GRID_FILENAME in path else "grid"] += 1
            self.write(path, "g")

        # The grid entry writes both artifacts, so both outputs must exist or the
        # entry is never considered up to date.
        def runs(map_name: str, source=None) -> None:
            recorded["runs"] += 1
            self.write(self.defines_file(map_name, regeneration.RUNS_FILENAME), "r")

        def geometry(map_name: str) -> None:
            recorded["geometry"] += 1
            for name in (
                "province_neighbors.json",
                "province_label_neighbors.json",
                "province_centroids.json",
                "province_label_grid.bin.gz",
                "province_label_grid.json",
            ):
                self.write(self.defines_file(map_name, name), "{}")

        def preview(map_name: str) -> None:
            recorded["preview"] += 1
            self.write(self.defines_file(map_name, "map_preview.webp"), "webp")

        # run_derived_artifacts decodes provinces.png once and hands the array
        # to both writers, so the decode needs stubbing too.
        # A real (tiny) array: _build_q4_grid decimates it for the q4 variant,
        # so a None stand-in would not survive the arithmetic.
        with patch.object(
            regeneration,
            "build_province_id_map",
            lambda name: (4, 4, np.ones((4, 4), dtype=np.uint16)),
        ), \
                patch.object(regeneration, "write_province_id_grid_file", grid), \
                patch.object(regeneration, "write_province_id_runs_file", runs), \
                patch.object(regeneration, "write_province_geometry", geometry), \
                patch.object(regeneration, "create_map_preview", preview), \
                patch.object(
                    regeneration,
                    "map_preview_path",
                    lambda name: self.defines_file(name, "map_preview.webp"),
                ):
            run_derived_artifacts(self.map_name, _RegenTimings())
            if twice:
                run_derived_artifacts(self.map_name, _RegenTimings())
        return recorded

    def test_first_run_builds_all_three(self) -> None:
        self.assertEqual(
            self._patched_run(),
            {"grid": 1, "q4": 1, "runs": 1, "geometry": 1, "preview": 1},
        )

    def test_second_run_rebuilds_nothing(self) -> None:
        self.assertEqual(
            self._patched_run(twice=True),
            {"grid": 1, "q4": 1, "runs": 1, "geometry": 1, "preview": 1},
        )

    def test_province_change_rebuilds_province_artifacts_only(self) -> None:
        self._patched_run()
        self.write(self.input_file(self.map_name, "provinces.png"), "new-pixels")
        self.assertEqual(
            self._patched_run(),
            {"grid": 1, "q4": 1, "runs": 1, "geometry": 1, "preview": 0},
        )

    def test_map_change_rebuilds_preview_only(self) -> None:
        self._patched_run()
        self.write(self.input_file(self.map_name, "map.png"), "new-base")
        self.assertEqual(
            self._patched_run(),
            {"grid": 0, "q4": 0, "runs": 0, "geometry": 0, "preview": 1},
        )

    def test_env_kill_switch_skips_geometry(self) -> None:
        with patch.dict(os.environ, {"REGEN_SKIP_PROVINCE_GEOMETRY": "1"}):
            self.assertEqual(
                self._patched_run(),
                {"grid": 1, "q4": 1, "runs": 1, "geometry": 0, "preview": 1},
            )

    def test_q4_grid_is_rebuilt_with_the_grid_and_runs(self) -> None:
        """geometry_version hashes the runs, so a q4 grid left behind by a regen
        is served as fresh geometry while holding the previous map's pixels."""
        self._patched_run()
        q4 = self.defines_file(self.map_name, regeneration.Q4_GRID_FILENAME)
        self.assertTrue(os.path.isfile(q4))

    def test_missing_q4_grid_alone_triggers_a_rebuild(self) -> None:
        """A map that has never had a q4 grid must acquire one on the next regen
        even though provinces.png has not changed since the last stamp."""
        self._patched_run()
        os.remove(self.defines_file(self.map_name, regeneration.Q4_GRID_FILENAME))
        self.assertEqual(
            self._patched_run(),
            {"grid": 1, "q4": 1, "runs": 1, "geometry": 0, "preview": 0},
        )


class TestWarmWebpCache(_DerivedTestCase):
    """Content stamps prevent an identical source rewrite from triggering a
    ~26 s WebP encode synchronously while regeneration holds the map lock.
    """

    def setUp(self) -> None:
        super().setUp()
        self.source = self.input_file(self.map_name, "map.png")
        self.cached = self.defines_file(self.map_name, "map.webp")
        self.write(self.source, "base-v1")

        for target, value in (
            ("webp_warm_sources", lambda name: [self.source]),
            ("cache_path_for", lambda source: self.cached),
        ):
            patcher = patch.object(regeneration, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _warm(self) -> int:
        calls = {"n": 0}

        def warm(map_names: list[str]) -> int:
            calls["n"] += 1
            self.write(self.cached, "webp")
            return len(map_names)

        with patch.object(regeneration, "warm_map_webp", warm):
            warm_webp_cache(self.map_name, _RegenTimings())
        return calls["n"]

    def test_encodes_once_then_skips_while_sources_are_unchanged(self) -> None:
        self.assertEqual(self._warm(), 1)
        self.assertEqual(self._warm(), 0, "identical sources must not re-encode")

    def test_rewriting_source_with_identical_bytes_does_not_re_encode(self) -> None:
        self._warm()
        self.write(self.source, "base-v1")
        self.assertEqual(self._warm(), 0)

    def test_changed_source_re_encodes(self) -> None:
        self._warm()
        self.write(self.source, "base-v2")
        self.assertEqual(self._warm(), 1)

    def test_missing_cache_file_re_encodes(self) -> None:
        self._warm()
        os.remove(self.cached)
        self.assertEqual(self._warm(), 1)

    def test_encode_failure_does_not_break_regen(self) -> None:
        with patch.object(
            regeneration, "warm_map_webp", side_effect=OSError("disk full")
        ):
            warm_webp_cache(self.map_name, _RegenTimings())


if __name__ == "__main__":
    unittest.main()


class TestQ4GridApplicability(_DerivedTestCase):
    """A map whose provinces.png is not a multiple of 4 has no q4 artifact.

    It must not be listed as a required output in that case, or the grid entry
    would look permanently stale and re-decode provinces.png on every regen.
    """

    def _write_grid(self, width: int, height: int) -> None:
        import gzip
        import struct

        from ..province_id_grid import serialize_province_id_grid

        ids = np.zeros((height, width), dtype=np.uint16)
        path = self.defines_file(self.map_name, regeneration.GRID_FILENAME)
        with gzip.open(path, "wb") as handle:
            handle.write(serialize_province_id_grid(width, height, ids))

    def test_divisible_dimensions_expect_a_q4_grid(self) -> None:
        self._write_grid(8, 8)
        self.assertTrue(regeneration._q4_grid_applicable(self.map_name))

    def test_indivisible_dimensions_expect_no_q4_grid(self) -> None:
        self._write_grid(6, 6)
        self.assertFalse(regeneration._q4_grid_applicable(self.map_name))

    def test_absent_or_unreadable_grid_assumes_q4_is_wanted(self) -> None:
        # Nothing to read the dimensions from, and we are about to rebuild
        # anyway, so err toward requiring the artifact.
        self.assertTrue(regeneration._q4_grid_applicable(self.map_name))
        self.write(self.defines_file(self.map_name, regeneration.GRID_FILENAME), "junk")
        self.assertTrue(regeneration._q4_grid_applicable(self.map_name))

    def test_indivisible_build_removes_a_stale_q4_grid(self) -> None:
        # A wrong q4 grid is worse than a missing one: the route's documented
        # "404 and fall back to the runs" path only fires when the file is gone.
        stale = self.defines_file(self.map_name, regeneration.Q4_GRID_FILENAME)
        self.write(stale, "old-pixels")
        regeneration._build_q4_grid(
            self.map_name, (6, 6, np.ones((6, 6), dtype=np.uint16))
        )
        self.assertFalse(os.path.exists(stale))
