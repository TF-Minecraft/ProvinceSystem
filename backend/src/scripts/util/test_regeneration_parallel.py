"""Tests for parallel fullregen orchestration helpers."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from .regeneration import (
    MODES,
    _RegenTimings,
    merge_worker_timings,
    modes_to_run,
    parallel_mode_count,
    should_parallelize_modes,
)
from .regen_types import parse_regen_type


class TestParallelRegenHelpers(unittest.TestCase):
    def setUp(self) -> None:
        self._env = os.environ.copy()

    def tearDown(self) -> None:
        os.environ.clear()
        os.environ.update(self._env)

    def test_parallel_mode_count_default_off(self) -> None:
        os.environ.pop("REGEN_PARALLEL_MODES", None)
        os.environ.pop("REGEN_SERIAL_MODES", None)
        self.assertEqual(parallel_mode_count(), 0)

    def test_parallel_mode_count_reads_env(self) -> None:
        os.environ["REGEN_PARALLEL_MODES"] = "4"
        self.assertEqual(parallel_mode_count(), 4)

    def test_serial_modes_override_disables_parallel(self) -> None:
        os.environ["REGEN_PARALLEL_MODES"] = "4"
        os.environ["REGEN_SERIAL_MODES"] = "1"
        self.assertEqual(parallel_mode_count(), 0)

    def test_should_parallelize_only_fullregen(self) -> None:
        os.environ["REGEN_PARALLEL_MODES"] = "4"
        self.assertTrue(should_parallelize_modes(parse_regen_type("fullregen")))
        self.assertFalse(should_parallelize_modes(parse_regen_type("fullregen:nation")))
        self.assertFalse(should_parallelize_modes(parse_regen_type("queued")))

    def test_merge_worker_timings(self) -> None:
        timings = _RegenTimings()
        results = [
            {
                "mode": "nation",
                "steps": {
                    "nation.cache": 1.0,
                    "nation.map": 0.5,
                    "nation.regions": 2.0,
                },
            },
            {
                "mode": "trade",
                "steps": {
                    "trade.cache": 1.2,
                    "trade.prosperity": 0.3,
                    "trade.map": 0.4,
                    "trade.regions": 0.1,
                },
            },
        ]
        merge_worker_timings(timings, results)

        rows = dict(timings.sorted_rows())
        self.assertAlmostEqual(rows["nation.cache"], 1.0)
        self.assertAlmostEqual(rows["nation.map"], 0.5)
        self.assertAlmostEqual(rows["nation.regions"], 2.0)
        self.assertAlmostEqual(rows["trade.cache"], 1.2)
        self.assertAlmostEqual(rows["trade.prosperity"], 0.3)
        self.assertAlmostEqual(rows["trade.map"], 0.4)
        self.assertAlmostEqual(rows["trade.regions"], 0.1)

    @patch("scripts.util.regeneration.load_queue")
    def test_modes_to_run_fullregen_includes_all(self, load_queue) -> None:
        load_queue.return_value = []
        runnable = modes_to_run("main", parse_regen_type("fullregen"))
        self.assertEqual(runnable, MODES)

    @patch("scripts.util.regeneration.load_queue")
    def test_modes_to_run_fullregen_single_mode(self, load_queue) -> None:
        load_queue.return_value = []
        runnable = modes_to_run("main", parse_regen_type("fullregen:nation"))
        self.assertEqual(runnable, ["nation"])

    @patch("scripts.util.regeneration.load_queue")
    def test_modes_to_run_incremental_skips_empty_queue(self, load_queue) -> None:
        def _queue(map_name: str, mode: str) -> list:
            return ["51_200_210"] if mode == "nation" else []

        load_queue.side_effect = _queue
        runnable = modes_to_run("main", parse_regen_type("queued"))
        self.assertEqual(runnable, ["nation", "trade"])


if __name__ == "__main__":
    unittest.main()
