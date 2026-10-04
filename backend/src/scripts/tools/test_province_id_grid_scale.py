"""Tests for decimated province id grids (province_id_grid_q{N}.bin.gz)."""

import gzip
import io
import os
import subprocess
import sys
import tempfile
import unittest

import numpy as np

from ..province_id_grid import (
    GRID_FILENAME,
    decimate_province_id_map,
    lost_province_ids,
    province_id_grid_filename,
    serialize_province_id_grid,
    write_province_id_grid_file,
)
from ..util.dirs import input_file

REPO_BACKEND = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)


def _grid(rows):
    arr = np.array(rows, dtype=np.uint16)
    return arr.shape[1], arr.shape[0], arr


class TestProvinceIdGridFilename(unittest.TestCase):
    def test_scale_one_keeps_the_existing_artifact_name(self):
        self.assertEqual(province_id_grid_filename(1), GRID_FILENAME)

    def test_scaled_name_gains_a_q_suffix(self):
        self.assertEqual(
            province_id_grid_filename(4), "province_id_grid_q4.bin.gz"
        )


class TestDecimateProvinceIdMap(unittest.TestCase):
    def test_scale_one_is_the_identity(self):
        width, height, ids = _grid([[1, 2], [3, 4]])
        w, h, out = decimate_province_id_map(width, height, ids, 1)
        self.assertEqual((w, h), (width, height))
        np.testing.assert_array_equal(out, ids)

    def test_scale_two_takes_the_block_majority(self):
        # Top-left block is 3x id 5 and 1x id 9 -> 5 wins; the other blocks are
        # uniform, so the whole 4x4 collapses to a predictable 2x2.
        width, height, ids = _grid(
            [
                [5, 5, 7, 7],
                [5, 9, 7, 7],
                [8, 8, 0, 0],
                [8, 8, 0, 0],
            ]
        )
        w, h, out = decimate_province_id_map(width, height, ids, 2)
        self.assertEqual((w, h), (2, 2))
        np.testing.assert_array_equal(out, np.array([[5, 7], [8, 0]], dtype=np.uint16))

    def test_scale_four_collapses_each_block_to_its_dominant_id(self):
        # 8x8 quadrants of 1/2/3/4, each with a single dissenting pixel that must
        # be outvoted rather than averaged into a nonexistent id.
        ids = np.zeros((8, 8), dtype=np.uint16)
        ids[:4, :4] = 1
        ids[:4, 4:] = 2
        ids[4:, :4] = 3
        ids[4:, 4:] = 4
        ids[0, 0] = 99
        ids[7, 7] = 99

        w, h, out = decimate_province_id_map(8, 8, ids, 4)
        self.assertEqual((w, h), (2, 2))
        np.testing.assert_array_equal(out, np.array([[1, 2], [3, 4]], dtype=np.uint16))

    def test_output_never_invents_an_id(self):
        rng = np.random.default_rng(1234)
        ids = rng.integers(0, 40, size=(24, 24), dtype=np.uint16)
        _w, _h, out = decimate_province_id_map(24, 24, ids, 3)
        self.assertTrue(np.isin(out, np.unique(ids)).all())

    def test_ties_resolve_to_the_lower_id_deterministically(self):
        width, height, ids = _grid([[4, 7], [7, 4]])
        _w, _h, out = decimate_province_id_map(width, height, ids, 2)
        self.assertEqual(int(out[0, 0]), 4)

    def test_chunking_does_not_change_the_result(self):
        # Force many bands so the banded loop is exercised against a single-shot
        # reference computed with an effectively unlimited chunk budget.
        from .. import province_id_grid as mod

        rng = np.random.default_rng(7)
        ids = rng.integers(0, 50, size=(64, 64), dtype=np.uint16)
        _w, _h, reference = decimate_province_id_map(64, 64, ids, 4)

        original = mod._DECIMATE_CHUNK_ELEMENTS
        mod._DECIMATE_CHUNK_ELEMENTS = 1
        try:
            _w, _h, chunked = decimate_province_id_map(64, 64, ids, 4)
        finally:
            mod._DECIMATE_CHUNK_ELEMENTS = original

        np.testing.assert_array_equal(chunked, reference)

    def test_rejects_non_positive_scale(self):
        width, height, ids = _grid([[1, 2], [3, 4]])
        with self.assertRaises(ValueError):
            decimate_province_id_map(width, height, ids, 0)
        with self.assertRaises(ValueError):
            decimate_province_id_map(width, height, ids, -2)

    def test_rejects_scale_that_does_not_divide_evenly(self):
        width, height, ids = _grid([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
        with self.assertRaisesRegex(ValueError, "does not divide"):
            decimate_province_id_map(width, height, ids, 2)


class TestWriteScaledGrid(unittest.TestCase):
    def test_scale_one_write_is_byte_identical_to_the_unscaled_payload(self):
        # The regression guard: existing callers and artifacts must be untouched.
        width, height, ids = _grid([[1, 2, 0], [0, 3, 4]])
        expected = serialize_province_id_grid(width, height, ids)

        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "grid.bin.gz")
            write_province_id_grid_file(
                "main", dest=dest, source=(width, height, ids), scale=1
            )
            with gzip.open(dest, "rb") as f:
                self.assertEqual(f.read(), expected)

    def test_scaled_write_stores_the_decimated_payload(self):
        ids = np.zeros((4, 4), dtype=np.uint16)
        ids[:2, :2] = 11
        ids[:2, 2:] = 12
        ids[2:, :2] = 13
        ids[2:, 2:] = 14

        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "grid_q2.bin.gz")
            write_province_id_grid_file("main", dest=dest, source=(4, 4, ids), scale=2)
            with gzip.open(dest, "rb") as f:
                payload = f.read()
            self.assertEqual(
                payload,
                serialize_province_id_grid(
                    2, 2, np.array([[11, 12], [13, 14]], dtype=np.uint16)
                ),
            )


class TestWriteGridIsAtomic(unittest.TestCase):
    """Readers must see complete gzip files throughout regeneration."""

    def test_no_temp_sibling_survives_a_successful_write(self):
        width, height, ids = _grid([[1, 2, 0], [0, 3, 4]])
        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "grid.bin.gz")
            write_province_id_grid_file("main", dest=dest, source=(width, height, ids))
            self.assertEqual(os.listdir(tmp), ["grid.bin.gz"])

    def test_a_write_failure_leaves_no_partial_destination_file(self):
        from unittest.mock import patch

        from ..util import atomic

        width, height, ids = _grid([[1, 2, 0], [0, 3, 4]])
        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "grid.bin.gz")
            with patch.object(atomic.os, "fsync", side_effect=OSError("disk gone")):
                with self.assertRaises(OSError):
                    write_province_id_grid_file(
                        "main", dest=dest, source=(width, height, ids)
                    )
            # No truncated grid.bin.gz and no leftover `.province-id-grid-*.part`.
            self.assertEqual(os.listdir(tmp), [])


class TestBuildProvinceIdGridCli(unittest.TestCase):
    def _run(self, *args):
        return subprocess.run(
            [sys.executable, "-m", "src.scripts.tools.build_province_id_grid", *args],
            cwd=REPO_BACKEND,
            capture_output=True,
            text=True,
        )

    def test_invalid_scale_errors_cleanly(self):
        result = self._run("--map", "main", "--scale", "0", "--dry-run")
        self.assertEqual(result.returncode, 2)
        self.assertIn("--scale must be a positive integer", result.stderr)

    def test_indivisible_scale_errors_cleanly(self):
        if not os.path.isfile(input_file("main", "provinces.png")):
            self.skipTest("input/main/provinces.png not available")

        result = self._run("--map", "main", "--scale", "7", "--dry-run")
        self.assertEqual(result.returncode, 2)
        self.assertIn("does not divide", result.stderr)

    def test_dry_run_reports_the_scaled_target(self):
        if not os.path.isfile(input_file("main", "provinces.png")):
            self.skipTest("input/main/provinces.png not available")

        result = self._run("--map", "main", "--scale", "4", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("scale=4", result.stdout)
        self.assertIn("province_id_grid_q4.bin.gz", result.stdout)


if __name__ == "__main__":
    unittest.main()


class TestOceanDoesNotWinTheVote(unittest.TestCase):
    """Province id 0 is ocean/background, not a province.

    Letting it vote as an ordinary value was wrong twice: it outvoted the land it
    surrounds, and because ties resolve to the lowest id it won *every* tie. The
    grid still looked healthy (nonzero_pixels only counts pixels), so whole
    provinces vanished with nothing reporting it.
    """

    def test_an_even_split_goes_to_land_not_ocean(self):
        # 8 ocean vs 8 land at scale 4: the old tie-break returned 0, eroding
        # every coastline inward by half a block.
        ids = np.zeros((4, 4), dtype=np.uint16)
        ids[:2, :] = 7
        _w, _h, out = decimate_province_id_map(4, 4, ids, 4)
        self.assertEqual(int(out[0, 0]), 7)

    def test_a_single_land_pixel_survives_a_block_of_ocean(self):
        ids = np.zeros((4, 4), dtype=np.uint16)
        ids[2, 2] = 42
        _w, _h, out = decimate_province_id_map(4, 4, ids, 4)
        self.assertEqual(int(out[0, 0]), 42)

    def test_a_small_island_is_not_erased(self):
        # 3x3 island centred in a 4x4 block: 9 land vs 7 ocean already, but the
        # regression case is the surrounding blocks it bleeds into.
        ids = np.zeros((8, 8), dtype=np.uint16)
        ids[3:6, 3:6] = 5
        _w, _h, out = decimate_province_id_map(8, 8, ids, 4)
        self.assertIn(5, out.tolist()[0] + out.tolist()[1])
        self.assertEqual(lost_province_ids(ids, out), [])

    def test_a_one_pixel_strait_province_is_not_erased(self):
        ids = np.zeros((8, 8), dtype=np.uint16)
        ids[:, 3] = 9  # 1px-wide vertical strait province
        _w, _h, out = decimate_province_id_map(8, 8, ids, 4)
        self.assertEqual(lost_province_ids(ids, out), [])

    def test_an_entirely_ocean_block_stays_ocean(self):
        ids = np.zeros((4, 4), dtype=np.uint16)
        _w, _h, out = decimate_province_id_map(4, 4, ids, 4)
        self.assertEqual(int(out[0, 0]), 0)

    def test_land_majority_still_wins_among_land(self):
        ids = np.array(
            [
                [0, 3, 3, 0],
                [0, 3, 4, 0],
                [0, 3, 4, 0],
                [0, 0, 0, 0],
            ],
            dtype=np.uint16,
        )
        _w, _h, out = decimate_province_id_map(4, 4, ids, 4)
        self.assertEqual(int(out[0, 0]), 3)

    def test_land_ties_still_resolve_to_the_lower_id(self):
        ids = np.array([[0, 6], [8, 0]], dtype=np.uint16)
        _w, _h, out = decimate_province_id_map(2, 2, ids, 2)
        self.assertEqual(int(out[0, 0]), 6)

    def test_output_still_never_invents_an_id(self):
        rng = np.random.default_rng(99)
        ids = rng.integers(0, 40, size=(24, 24), dtype=np.uint16)
        _w, _h, out = decimate_province_id_map(24, 24, ids, 3)
        self.assertTrue(np.isin(out, np.unique(ids)).all())

    def test_matches_a_brute_force_reference(self):
        from collections import Counter

        rng = np.random.default_rng(2026)
        for _ in range(50):
            ids = rng.integers(0, 6, size=(12, 12), dtype=np.uint16)
            _w, _h, out = decimate_province_id_map(12, 12, ids, 4)
            for by in range(3):
                for bx in range(3):
                    block = ids[by * 4 : by * 4 + 4, bx * 4 : bx * 4 + 4].ravel()
                    land = [int(v) for v in block if v]
                    if not land:
                        expected = 0
                    else:
                        counts = Counter(land)
                        best = max(counts.values())
                        expected = min(v for v, c in counts.items() if c == best)
                    self.assertEqual(int(out[by, bx]), expected)


class TestLostProvinceIds(unittest.TestCase):
    def test_reports_ids_that_disappeared(self):
        before = np.array([[1, 2, 3, 0]], dtype=np.uint16)
        after = np.array([[1, 0]], dtype=np.uint16)
        self.assertEqual(lost_province_ids(before, after), [2, 3])

    def test_ocean_is_never_reported_as_lost(self):
        before = np.array([[0, 1]], dtype=np.uint16)
        after = np.array([[1]], dtype=np.uint16)
        self.assertEqual(lost_province_ids(before, after), [])

    def test_nothing_lost_is_an_empty_list(self):
        before = np.array([[1, 2]], dtype=np.uint16)
        after = np.array([[1, 2]], dtype=np.uint16)
        self.assertEqual(lost_province_ids(before, after), [])


class TestCliReportsProvinceLoss(unittest.TestCase):
    """The CLI reports province IDs lost during decimation."""

    def _run_main(self, ids, scale, dest):
        from unittest.mock import patch

        from . import build_province_id_grid as cli

        height, width = ids.shape
        argv = [
            "build_province_id_grid",
            "--map",
            "main",
            "--scale",
            str(scale),
            "--output",
            dest,
        ]
        err = io.StringIO()
        with patch.object(sys, "argv", argv), patch.object(
            cli, "build_province_id_map", lambda name: (width, height, ids)
        ), patch.object(sys, "stderr", err):
            try:
                cli.main()
            except SystemExit as exc:
                return int(exc.code or 0), err.getvalue()
        return 0, err.getvalue()

    def test_lost_province_is_named_and_the_exit_code_is_non_zero(self):
        ids = np.full((4, 4), 2, dtype=np.uint16)
        ids[0, 0] = 1  # outvoted 15-to-1, so id 1 is gone from the q4 grid

        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "grid_q4.bin.gz")
            code, err = self._run_main(ids, 4, dest)
            # The artifact is still written: it is optional and the viewer falls
            # back to the full-resolution runs, so a lossy grid beats no grid.
            self.assertTrue(os.path.isfile(dest))

        self.assertEqual(code, 1)
        self.assertIn("1 province(s) vanished", err)
        self.assertIn("1", err)

    def test_a_lossless_build_still_exits_zero_and_says_nothing(self):
        ids = np.array(
            [[1, 1, 2, 2], [1, 1, 2, 2], [3, 3, 4, 4], [3, 3, 4, 4]], dtype=np.uint16
        )
        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "grid_q2.bin.gz")
            code, err = self._run_main(ids, 2, dest)
        self.assertEqual(code, 0)
        self.assertEqual(err, "")
