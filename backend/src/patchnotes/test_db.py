"""Unit tests for patch note storage (psycopg2 fully mocked)."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
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


class CurrentWeekTest(unittest.TestCase):
    def test_zone_can_move_the_iso_week(self) -> None:
        # Monday 2026-01-05 00:30 UTC is still Sunday in New York.
        moment = datetime(2026, 1, 5, 0, 30, tzinfo=timezone.utc)
        with mock.patch.dict("os.environ", {"PATCHNOTES_TZ": "UTC"}):
            self.assertEqual(db.current_week(moment), "2026-W02")
        with mock.patch.dict("os.environ", {"PATCHNOTES_TZ": "America/New_York"}):
            self.assertEqual(db.current_week(moment), "2026-W01")

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
        self.assertIn("patchnote_bullets_deny_reason_chk", sql)
        self.assertIn("status = 'pending'", sql)
        self.assertTrue(db._MIGRATED)

        db.migrate()
        mock_connect.assert_called_once()


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
