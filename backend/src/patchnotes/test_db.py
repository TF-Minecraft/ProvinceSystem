"""Unit tests for patch note storage (psycopg2 fully mocked)."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from unittest import mock

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

import patchnotes.db as db  # noqa: E402


def _make_conn(cursor):
    conn = mock.MagicMock()
    conn.__enter__.return_value = conn
    conn.__exit__.return_value = False
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn


class ParseWeekTest(unittest.TestCase):
    def test_canonical_week(self) -> None:
        self.assertEqual(db.parse_week("2026-W39"), "2026-W39")

    def test_rejects_unpadded_or_impossible_week(self) -> None:
        with self.assertRaises(ValueError):
            db.parse_week("2026-W3")
        with self.assertRaises(ValueError):
            db.parse_week("2026-W54")


class NextWeekTest(unittest.TestCase):
    def test_steps_into_the_next_iso_week(self) -> None:
        self.assertEqual(db.next_week("2026-W39"), "2026-W40")
        self.assertEqual(db.next_week("2026-W52"), "2026-W53")


class CurrentWeekTest(unittest.TestCase):
    def test_zone_can_move_the_friday_cutoff(self) -> None:
        # Friday 2026-09-25 10:30 UTC is still morning in UTC and past noon in Berlin.
        moment = datetime(2026, 9, 25, 10, 30, tzinfo=timezone.utc)
        with mock.patch.dict("os.environ", {"PATCHNOTES_TZ": "UTC"}):
            self.assertEqual(db.current_week(moment), "2026-W39")
        with mock.patch.dict("os.environ", {"PATCHNOTES_TZ": "Europe/Berlin"}):
            self.assertEqual(db.current_week(moment), "2026-W40")

    def test_friday_noon_closes_the_week(self) -> None:
        berlin = ZoneInfo("Europe/Berlin")
        with mock.patch.dict("os.environ", {"PATCHNOTES_TZ": "Europe/Berlin"}):
            self.assertEqual(
                db.current_week(datetime(2026, 9, 25, 11, 59, tzinfo=berlin)),
                "2026-W39",
            )
            self.assertEqual(
                db.current_week(datetime(2026, 9, 25, 12, 0, tzinfo=berlin)),
                "2026-W40",
            )
            self.assertEqual(
                db.current_week(datetime(2026, 9, 25, 17, 0, tzinfo=berlin)),
                "2026-W40",
            )
            self.assertEqual(
                db.current_week(datetime(2026, 9, 26, 9, 0, tzinfo=berlin)),
                "2026-W40",
            )

    def test_unknown_zone_is_a_config_error(self) -> None:
        with mock.patch.dict("os.environ", {"PATCHNOTES_TZ": "Not/AZone"}):
            with self.assertRaises(db.PatchnotesConfigError):
                db.current_week()


class MigrateTest(unittest.TestCase):
    def setUp(self) -> None:
        db._MIGRATED = False

    def tearDown(self) -> None:
        db._MIGRATED = False

    @mock.patch.dict("os.environ", {}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_migrate_skips_without_dsn(self, mock_connect) -> None:
        db.migrate()
        mock_connect.assert_not_called()
        self.assertFalse(db._MIGRATED)

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_migrate_creates_table_once(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        mock_connect.return_value = _make_conn(cursor)

        db.migrate()

        sql = " ".join(c.args[0] for c in cursor.execute.call_args_list)
        self.assertIn("CREATE TABLE IF NOT EXISTS patchnote_bullets", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS patchnote_sources", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS patchnote_previews", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS patchnote_week_status", sql)
        self.assertIn("patchnote_bullets_deny_reason_chk", sql)
        self.assertIn("status = 'pending'", sql)
        self.assertTrue(db._MIGRATED)

        db.migrate()
        mock_connect.assert_called_once()


class AutoApproveTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.get_week_status", return_value={"postponed": False})
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_skips_rewritten_lines(self, mock_connect, _status) -> None:
        cursor = mock.MagicMock()
        cursor.rowcount = 2
        mock_connect.return_value = _make_conn(cursor)
        self.assertEqual(db.approve_pending_week("2026-W39"), 2)
        sql = cursor.execute.call_args.args[0]
        self.assertIn("supersedes IS NULL", sql)
        self.assertIn("status = 'pending'", sql)


class PreviewTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_replace_preview_expires_in_one_hour(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = {
            "id": "preview-1",
            "week": "2026-W39",
            "bullets": [{"id": "b1", "section": "new", "body": "Added a station"}],
            "created_at": None,
            "expires_at": None,
        }
        mock_connect.return_value = _make_conn(cursor)

        row = db.replace_preview(
            week="2026-W39",
            bullets=[{"id": "b1", "section": "new", "body": "  Added a station  "}],
        )

        self.assertEqual(row["week"], "2026-W39")
        delete_sql = cursor.execute.call_args_list[0].args[0]
        insert_sql, params = cursor.execute.call_args_list[1].args
        self.assertIn("DELETE FROM patchnote_previews", delete_sql)
        self.assertIn("interval '1 hour'", insert_sql)
        self.assertEqual(params[0], "2026-W39")
        self.assertEqual(params[1].adapted, [{"id": "b1", "section": "new", "body": "Added a station"}])

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_load_preview_deletes_expired_rows(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = None
        mock_connect.return_value = _make_conn(cursor)

        self.assertIsNone(db.load_preview())
        sql = cursor.execute.call_args_list[0].args[0]
        self.assertIn("expires_at <= now()", sql)


class InsertBulletTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_insert_stores_a_pending_bullet(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = {
            "id": "bullet-1",
            "week": "2026-W39",
            "section": "new",
            "body": "Added a station",
            "status": "pending",
            "deny_reason": None,
            "created_at": None,
            "reviewed_at": None,
        }
        mock_connect.return_value = _make_conn(cursor)

        row = db.insert_bullet(section="new", body="  Added a station  ", week="2026-W39")

        self.assertEqual(row["status"], "pending")
        sql, params = cursor.execute.call_args.args
        self.assertIn("'pending'", sql)
        self.assertEqual(params, ("2026-W39", "new", "Added a station"))

    def test_insert_rejects_unknown_section(self) -> None:
        with self.assertRaises(ValueError):
            db.insert_bullet(section="secret", body="nope", week="2026-W39")

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.current_week", return_value="2026-W39")
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_sourced_insert_writes_the_bullet_once(self, mock_connect, _week) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.side_effect = [
            {"source_key": "TF-Minecraft/Gathering@abc1234"},
            {
                "id": "bullet-1",
                "week": "2026-W39",
                "section": "new",
                "body": "Gathering: Added a node",
                "status": "pending",
            },
        ]
        mock_connect.return_value = _make_conn(cursor)

        row = db.insert_sourced_bullet(
            section="new",
            body="Gathering: Added a node",
            source_key="TF-Minecraft/Gathering@abc1234",
        )

        self.assertEqual(row["status"], "pending")
        source_sql, source_params = cursor.execute.call_args_list[0].args
        self.assertIn("ON CONFLICT (source_key) DO NOTHING", source_sql)
        self.assertEqual(source_params, ("TF-Minecraft/Gathering@abc1234",))
        _bullet_sql, bullet_params = cursor.execute.call_args_list[1].args
        self.assertEqual(bullet_params, ("2026-W39", "new", "Gathering: Added a node"))

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_sourced_insert_skips_a_duplicate(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = None
        mock_connect.return_value = _make_conn(cursor)

        row = db.insert_sourced_bullet(
            section="new",
            body="Gathering: Added a node",
            source_key="TF-Minecraft/Gathering@abc1234",
        )

        self.assertIsNone(row)
        self.assertEqual(cursor.execute.call_count, 1)


class ReviewTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_approve_updates_only_pending(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = {"id": "bullet-1", "status": "approved"}
        mock_connect.return_value = _make_conn(cursor)

        row = db.approve_bullet("bullet-1")

        self.assertEqual(row["status"], "approved")
        sql, params = cursor.execute.call_args.args
        self.assertIn("status = 'pending'", sql)
        self.assertEqual(params, ("approved", None, "bullet-1"))
        self.assertEqual(cursor.execute.call_count, 1)

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_deny_stores_the_reason(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = {
            "id": "bullet-1",
            "status": "denied",
            "deny_reason": "Spoilers",
        }
        mock_connect.return_value = _make_conn(cursor)

        row = db.deny_bullet("bullet-1", "  Spoilers  ")

        self.assertEqual(row["deny_reason"], "Spoilers")
        _sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ("denied", "Spoilers", "bullet-1"))

    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_deny_rejects_a_blank_reason(self, mock_connect) -> None:
        with self.assertRaises(ValueError):
            db.deny_bullet("bullet-1", "   ")
        mock_connect.assert_not_called()

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_missing_bullet(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.side_effect = [None, None]
        mock_connect.return_value = _make_conn(cursor)

        with self.assertRaises(db.BulletNotFound):
            db.approve_bullet("missing")

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_already_reviewed(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.side_effect = [None, {"status": "denied"}]
        mock_connect.return_value = _make_conn(cursor)

        with self.assertRaises(db.BulletNotPending) as caught:
            db.approve_bullet("bullet-1")
        self.assertEqual(caught.exception.status, "denied")


class ListTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_queue_is_pending_only(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = []
        mock_connect.return_value = _make_conn(cursor)

        db.list_pending("2026-W39")

        sql, params = cursor.execute.call_args.args
        self.assertIn("status = 'pending'", sql)
        self.assertEqual(params, ("2026-W39", "2026-W39"))

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_published_week_is_approved_only(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = []
        mock_connect.return_value = _make_conn(cursor)

        db.list_approved("2026-W39")

        sql, params = cursor.execute.call_args.args
        self.assertIn("status = 'approved'", sql)
        self.assertNotIn("deny_reason IS", sql)
        self.assertEqual(params, ("2026-W39",))

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_published_notes_are_one_approved_query(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchall.side_effect = [
            [("2026-W39",), ("2026-W38",), ("2026-W37",)],
            [
                {"week": "2026-W39", "id": "a"},
                {"week": "2026-W39", "id": "b"},
                {"week": "2026-W38", "id": "c"},
            ],
        ]
        mock_connect.return_value = _make_conn(cursor)

        notes, has_more = db.list_published_notes(limit=2, before="2026-W40")

        self.assertTrue(has_more)
        self.assertEqual(
            [(week["week"], [bullet["id"] for bullet in week["bullets"]]) for week in notes],
            [("2026-W39", ["a", "b"]), ("2026-W38", ["c"])],
        )
        key_sql, key_params = cursor.execute.call_args_list[0].args
        self.assertIn("LIMIT %s", key_sql)
        self.assertEqual(key_params, ("2026-W40", "2026-W40", 3))
        bullet_sql, bullet_params = cursor.execute.call_args_list[1].args
        self.assertIn("week = ANY(%s)", bullet_sql)
        self.assertEqual(bullet_params, (["2026-W39", "2026-W38"],))
        self.assertIn("status = 'approved'", bullet_sql)

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}, clear=True)
    @mock.patch("patchnotes.db.psycopg2.connect")
    def test_published_weeks_newest_first(self, mock_connect) -> None:
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = [("2026-W39",), ("2026-W38",)]
        mock_connect.return_value = _make_conn(cursor)

        weeks = db.list_published_weeks()

        self.assertEqual(weeks, ["2026-W39", "2026-W38"])
        sql = cursor.execute.call_args.args[0]
        self.assertIn("status = 'approved'", sql)
        self.assertIn("ORDER BY week DESC", sql)


class JobStorageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.cursor = mock.MagicMock()
        self.conn = _make_conn(self.cursor)
        patcher = mock.patch("patchnotes.db._connect", return_value=self.conn)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_create_job_expires_and_enforces_one_active_week(self) -> None:
        self.cursor.fetchone.return_value = {"id": "j", "status": "queued"}
        self.assertEqual(db.create_job("2026-W40", "feedback", "Shorten it.")["status"], "queued")
        calls = self.cursor.execute.call_args_list
        self.assertIn("interval '90 seconds'", calls[0].args[0])
        self.assertIn("interval '10 minutes'", calls[0].args[0])
        self.assertIn("The rewrite agent is not running.", calls[0].args[0])
        self.assertIn("The rewrite took too long.", calls[0].args[0])
        self.assertIn(
            "ON CONFLICT (week, (kind = 'compose')) WHERE status IN ('queued', 'running')",
            calls[1].args[0],
        )
        self.assertEqual(calls[1].args[1], ("2026-W40", "feedback", "Shorten it."))
        self.cursor.fetchone.return_value = None
        with self.assertRaises(db.JobActive):
            db.create_job("2026-W40", "sort", None)
        self.conn.close.assert_called()

    def test_claim_locks_oldest_and_stores_prompt_order(self) -> None:
        self.cursor.fetchone.side_effect = [
            {"id": "j", "week": "2026-W40"},
            {"id": "j", "week": "2026-W40", "status": "running", "line_ids": ["b", "a"]},
        ]
        self.cursor.fetchall.return_value = [{"id": "b"}, {"id": "a"}]
        job = db.claim_job()
        self.assertEqual(job["status"], "running")
        calls = self.cursor.execute.call_args_list
        self.assertIn("FOR UPDATE SKIP LOCKED", calls[1].args[0])
        self.assertIn("ORDER BY created_at ASC, id ASC", calls[2].args[0])
        self.assertIn("claimed_at = now()", calls[3].args[0])
        self.assertEqual(calls[3].args[1][0].adapted, ["b", "a"])

    def test_claim_empty_queue(self) -> None:
        self.cursor.fetchone.return_value = None
        self.assertIsNone(db.claim_job())

    def test_finish_success_and_failure_and_nonrunning(self) -> None:
        self.cursor.fetchone.return_value = {"id": "j", "status": "done"}
        db.finish_job("j", changed=3)
        sql, params = self.cursor.execute.call_args.args
        self.assertIn("status = 'running'", sql)
        self.assertEqual(params, ("done", 3, None, "j"))
        db.finish_job("j", error="x" * 500)
        self.assertEqual(self.cursor.execute.call_args.args[1], ("failed", None, "x" * 300, "j"))
        self.cursor.fetchone.return_value = None
        with self.assertRaises(db.JobNotRunning):
            db.finish_job("j", changed=1)

    def test_reads_expire_jobs_and_latest_orders_newest_first(self) -> None:
        self.cursor.fetchone.return_value = {"id": "j"}
        self.assertEqual(db.get_job("j"), {"id": "j"})
        self.assertIn("UPDATE patchnote_jobs", self.cursor.execute.call_args_list[0].args[0])
        self.assertEqual(self.cursor.execute.call_args.args[1], ("j",))
        self.cursor.reset_mock()
        self.cursor.fetchone.return_value = None
        self.assertIsNone(db.latest_job("2026-W40"))
        self.assertIn("UPDATE patchnote_jobs", self.cursor.execute.call_args_list[0].args[0])
        self.assertIn("ORDER BY created_at DESC", self.cursor.execute.call_args.args[0])

    def test_migration_adds_jobs_and_partial_unique_index(self) -> None:
        with mock.patch.dict("os.environ", {"SUPABASE_DB_URL": "postgres://x"}), mock.patch.object(db, "_MIGRATED", False):
            db.migrate()
        sql = " ".join(call.args[0] for call in self.cursor.execute.call_args_list)
        self.assertIn("CREATE TABLE IF NOT EXISTS patchnote_jobs", sql)
        self.assertIn("CHECK (kind IN ('feedback', 'sort'))", sql)
        self.assertIn("CHECK (status IN ('queued', 'running', 'done', 'failed'))", sql)
        # Line jobs and the weekly post job each get one active slot per week.
        self.assertIn("CHECK (kind IN ('feedback', 'sort', 'compose'))", sql)
        self.assertIn("DROP INDEX IF EXISTS patchnote_jobs_active_week_idx", sql)
        self.assertIn("ON patchnote_jobs (week, (kind = 'compose'))", sql)
        self.assertNotIn("CREATE UNIQUE INDEX IF NOT EXISTS patchnote_jobs_active_week_idx", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS patchnote_week_facts", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS patchnote_posts", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS patchnote_week_meta", sql)


class ReviewStorageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.cursor = mock.MagicMock()
        patcher = mock.patch("patchnotes.db._connect", return_value=_make_conn(self.cursor))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_patch_changes_only_requested_fields(self) -> None:
        self.cursor.fetchone.side_effect = [{"id": "b", "status": "approved"}, {"id": "b", "topic": None}]
        db.update_bullet("b", {"topic": None})
        sql, params = self.cursor.execute.call_args.args
        self.assertIn("SET topic = %s", sql)
        self.assertNotIn("body =", sql)
        self.assertEqual(params, (None, "b"))

    def test_patch_validation(self) -> None:
        for fields in ({"topic": "invalid"}, {"section": "invalid"}, {"body": " "},
                       {"highlight": 1}, {"status": "approved"}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                db.update_bullet("b", fields)

    def test_drop_and_restore_do_not_rewrite(self) -> None:
        for status in ("pending", "approved"):
            self.cursor.fetchone.side_effect = [{"status": status}, {"status": "denied"}]
            row = db.drop_bullet("b")
            self.assertEqual(row["status"], "denied")
            self.assertIn("Removed in review.", self.cursor.execute.call_args.args[1])
        self.cursor.fetchone.side_effect = [{"status": "denied"}, None, {"status": "pending"}]
        self.assertEqual(db.restore_bullet("b")["status"], "pending")
        self.assertEqual(self.cursor.execute.call_args.args[1], ("pending", None, None, "b"))

    def test_restore_is_refused_when_a_rewrite_replaced_the_line(self) -> None:
        self.cursor.fetchone.side_effect = [{"status": "denied"}, {"?column?": 1}]
        with self.assertRaises(db.BulletNotOpen):
            db.restore_bullet("b")

    def test_state_conflicts_and_missing_bullets(self) -> None:
        for operation, status in ((db.drop_bullet, "denied"), (db.restore_bullet, "approved")):
            self.cursor.fetchone.return_value = {"status": status}
            with self.assertRaises(db.BulletNotOpen):
                operation("b")
        self.cursor.fetchone.return_value = None
        for operation in (db.drop_bullet, db.restore_bullet):
            with self.assertRaises(db.BulletNotFound):
                operation("missing")
        self.cursor.fetchone.return_value = {"status": "denied"}
        with self.assertRaises(db.BulletNotOpen):
            db.update_bullet("b", {})

    def test_denied_and_review_week_selection(self) -> None:
        self.cursor.fetchall.return_value = []
        self.assertEqual(db.list_denied("2026-W40"), [])
        self.assertIn("status = 'denied'", self.cursor.execute.call_args.args[0])
        db.list_review_weeks()
        sql = self.cursor.execute.call_args.args[0]
        self.assertIn("pending > 0 OR week IN", sql)
        self.assertIn("LIMIT 4", sql)
        self.assertIn("ORDER BY week DESC", sql)
        self.assertIn("COALESCE(state.postponed, FALSE)", sql)

    def test_sort_is_one_transaction_and_keeps_wording(self) -> None:
        self.cursor.fetchall.side_effect = [[{"id": "unchanged"}], [{"id": "b", "section": "technical"}]]
        self.cursor.rowcount = 1
        result = db.apply_sort("2026-W40", [{"id": "b", "section": "technical", "topic": None, "highlight": False}])
        self.assertEqual(result["changed"], 1)
        calls = self.cursor.execute.call_args_list
        self.assertIn("SET highlight = FALSE", calls[1].args[0])
        self.assertEqual(calls[2].args[1], (["unchanged"],))
        sql, params = calls[3].args
        self.assertNotIn("body =", sql)
        self.assertNotIn("revision_note", sql)
        self.assertEqual(params, ("technical", None, False, "b", "2026-W40"))
