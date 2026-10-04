"""Live nation images must catch up even when uploads omit queue entries."""

from unittest.mock import patch

from . import regeneration
from .regen_types import parse_regen_type
from .test_regeneration_derived import _DerivedTestCase


class TestNationRenderFreshness(_DerivedTestCase):
    def setUp(self):
        super().setUp()
        for name in ("map_image", "region_overlay_file"):
            patcher = patch.object(
                regeneration, name,
                lambda map_name, mode, kind=name: self.defines_file(map_name, f"{mode}.{kind}"),
            )
            patcher.start()
            self.addCleanup(patcher.stop)
        self.source = self.defines_file(self.map_name, "nation.json")
        self.write(self.source, '{"old": {"rgb": "1,2,3", "provinces": [1]}}')
        self.write(regeneration.map_image(self.map_name, "nation"), "pick")
        self.write(regeneration.region_overlay_file(self.map_name, "nation"), "overlays")

    def mark_rendered(self):
        fingerprint, _ = regeneration.nation_render_state(self.map_name)
        regeneration._save_stamp(self.map_name, "nation_render", fingerprint)

    def test_existing_maps_without_stamp_need_repair(self):
        self.assertTrue(regeneration.nation_render_state(self.map_name)[1])
        self.mark_rendered()
        self.assertFalse(regeneration.nation_render_state(self.map_name)[1])

    def test_compile_without_render_does_not_mark_images_current(self):
        self.mark_rendered()
        self.write(self.source, '{"new": {"rgb": "4,5,6", "provinces": [2]}}')
        self.assertTrue(regeneration.nation_render_state(self.map_name)[1])
        # Multiple text compiles must not hide the outstanding render change.
        self.assertTrue(regeneration.nation_render_state(self.map_name)[1])
        self.mark_rendered()
        self.assertFalse(regeneration.nation_render_state(self.map_name)[1])

    def test_occupation_changes_invalidate_images(self):
        self.mark_rendered()
        self.write(self.input_file(self.map_name, "province_data.json"), '[{"id": 1, "occupied_by": "new"}]')
        self.assertTrue(regeneration.nation_render_state(self.map_name)[1])

    def test_stale_nation_runs_with_empty_queue_but_respects_mode_scope(self):
        with patch.object(regeneration, "load_queue", return_value=[]):
            self.assertEqual(regeneration.modes_to_run(self.map_name, parse_regen_type("queued"), stale_nation=True), ["nation", "trade"])
            self.assertEqual(regeneration.modes_to_run(self.map_name, parse_regen_type("queued:county"), stale_nation=True), [])
            self.assertEqual(regeneration.modes_to_run(self.map_name, parse_regen_type("textonly"), stale_nation=True), [])

    def run_regen(self, kind, *, fail=False, queue=None):
        from contextlib import ExitStack
        with ExitStack() as stack:
            for name in ("validate_map", "process_nations", "compile_queue", "print_queues", "generate_zoc_overlays", "create_infestation_map", "run_derived_artifacts", "warm_webp_cache"):
                stack.enter_context(patch.object(regeneration, name))
            stack.enter_context(patch.object(regeneration, "load_queue", return_value=queue or []))
            stack.enter_context(patch.object(regeneration.MapGeometryCache, "load"))
            render = stack.enter_context(patch.object(regeneration, "_run_mode_serial"))
            if fail:
                render.side_effect = RuntimeError("render failed")
            regeneration._sync_regeneration(self.map_name, kind)
            return render

    def test_queued_regen_repairs_all_nation_shapes_then_records_success(self):
        render = self.run_regen("queued:nation")
        self.assertEqual(render.call_count, 1)
        self.assertTrue(render.call_args.args[2].full_regions)
        self.assertFalse(regeneration.nation_render_state(self.map_name)[1])
        self.assertEqual(self.run_regen("queued:nation").call_count, 0)

    def test_failed_render_is_retried(self):
        with self.assertRaisesRegex(RuntimeError, "render failed"):
            self.run_regen("queued:nation", fail=True)
        self.assertTrue(regeneration.nation_render_state(self.map_name)[1])
        self.assertEqual(self.run_regen("queued:nation").call_count, 1)

    def test_partial_queue_cannot_leave_other_changed_nations_stale(self):
        self.mark_rendered()
        self.write(self.source, '{"new": {"rgb": "4,5,6", "provinces": [2]}}')
        render = self.run_regen("queued:nation", queue=["1_2_3"])
        self.assertTrue(render.call_args.args[2].full_regions)
        self.assertFalse(regeneration.nation_render_state(self.map_name)[1])

    def test_textonly_does_not_render_or_advance_stamp(self):
        self.assertEqual(self.run_regen("textonly").call_count, 0)
        self.assertTrue(regeneration.nation_render_state(self.map_name)[1])
