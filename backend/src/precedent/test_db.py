"""Unit tests for precedent DB storage/search (psycopg2 fully mocked)."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

import precedent.db as db  # noqa: E402


def _make_conn(cursor):
    conn = mock.MagicMock()
    conn.__enter__.return_value = conn
    conn.__exit__.return_value = False
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn


class MigrateTest(unittest.TestCase):
    def setUp(self) -> None:
        db._MIGRATED = False

    def tearDown(self) -> None:
        db._MIGRATED = False

    @mock.patch.dict("os.environ", {}, clear=True)
    @mock.patch("precedent.db.psycopg2.connect")
    def test_migrate_skips_without_dsn(self, mock_connect) -> None:
        db.migrate()
        mock_connect.assert_not_called()
        self.assertFalse(db._MIGRATED)

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_migrate_creates_extension_and_table_once(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        db.migrate()

        sql_calls = [c.args[0] for c in cursor.execute.call_args_list]
        self.assertTrue(any("CREATE EXTENSION" in s for s in sql_calls))
        self.assertTrue(any("CREATE TABLE" in s for s in sql_calls))
        self.assertTrue(db._MIGRATED)
        conn.close.assert_called_once()

        db.migrate()
        mock_connect.assert_called_once()


class InsertCaseTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_insert_case_returns_id(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = ("case-uuid-1",)
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        case_id = db.insert_case(
            logged_by="Staffer",
            players=["Alice"],
            summary="Did a thing",
            rule="1.1",
            ruling="Warned",
            punishment="warning",
            embedding=[0.1, 0.2],
        )

        self.assertEqual(case_id, "case-uuid-1")
        conn.close.assert_called_once()


class SearchSimilarTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_search_applies_relevance_cutoff(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = [{"id": "1", "distance": 0.2}]
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        results = db.search_similar([0.1], limit=3)

        args = cursor.execute.call_args.args
        self.assertIn(db.MAX_RELEVANT_DISTANCE, args[1])
        self.assertEqual(results, [{"id": "1", "distance": 0.2}])
        conn.close.assert_called_once()

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_search_players_soft_boost_lowers_and_forwards_names(
        self, mock_connect, mock_register
    ) -> None:
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = []
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        db.search_similar([0.1], limit=3, players=["  Alice ", "", "BOB"])

        args = cursor.execute.call_args.args
        self.assertIn(["alice", "bob"], args[1])

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_search_no_players_degrades_to_pure_distance(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = []
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        db.search_similar([0.1], limit=3)

        args = cursor.execute.call_args.args
        self.assertIn([], args[1])

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_search_query_text_tokenized_for_lexical_boost(
        self, mock_connect, mock_register
    ) -> None:
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = []
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        db.search_similar([0.1], limit=3, query_text="Player Xraying! a to")

        args = cursor.execute.call_args.args
        # "a"/"to" are too short (<=2 chars) to be useful tsquery terms and are dropped.
        self.assertIn(["Player", "Xraying"], args[1])


class ListCasesTest(unittest.TestCase):
    def _list(self, mock_connect, **kwargs):
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = [{"id": "1", "summary": "s"}]
        cursor.fetchone.return_value = {"total": 7}
        conn = _make_conn(cursor)
        mock_connect.return_value = conn
        result = db.list_cases(**kwargs)
        return result, cursor, conn

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_list_cases_orders_newest_first_without_embedding(
        self, mock_connect, mock_register
    ) -> None:
        (rows, total), cursor, conn = self._list(mock_connect, limit=50, offset=10)

        (page_sql, page_params), (count_sql, count_params) = [c.args for c in cursor.execute.call_args_list]
        self.assertIn("ORDER BY created_at DESC", page_sql)
        # Browsing must stay a plain SELECT: no vector maths, no relevance cutoff.
        for sql in (page_sql, count_sql):
            self.assertNotIn("<=>", sql)
            self.assertNotIn("embedding", sql)
            self.assertIn("WHERE TRUE", sql)
        self.assertEqual((50, 10), page_params)
        self.assertEqual([], count_params)
        self.assertEqual(rows, [{"id": "1", "summary": "s"}])
        self.assertEqual(total, 7)
        # One connection serves the page and its count.
        mock_connect.assert_called_once()
        conn.close.assert_called_once()

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_list_cases_needs_every_word_somewhere(self, mock_connect, mock_register) -> None:
        _, cursor, _ = self._list(mock_connect, limit=25, offset=0, query="  xray  Wren ")

        (page_sql, page_params), (count_sql, count_params) = [c.args for c in cursor.execute.call_args_list]
        for sql in (page_sql, count_sql):
            self.assertEqual(2, sql.count("ILIKE %s"))
            self.assertIn("array_to_string(players", sql)
            self.assertIn("logged_by", sql)
        self.assertEqual(("%xray%", "%Wren%", 25, 0), page_params)
        self.assertEqual(["%xray%", "%Wren%"], count_params)

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_list_cases_matches_pattern_characters_literally(self, mock_connect, mock_register) -> None:
        _, cursor, _ = self._list(mock_connect, query="100% a_b c\\d")

        _, page_params = cursor.execute.call_args_list[0].args
        self.assertEqual(("%100\\%%", "%a\\_b%", "%c\\\\d%"), page_params[:3])


class KnownPlayersTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_known_players_once_each_in_newest_spelling(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = [("Gvinno",), ("WrenPlays",)]
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        self.assertEqual(["Gvinno", "WrenPlays"], db.known_players())

        sql = cursor.execute.call_args.args[0]
        self.assertIn("DISTINCT ON (lower(name))", sql)
        self.assertIn("created_at DESC", sql)
        self.assertIn("name <> ''", sql)
        conn.close.assert_called_once()


class UpdateCaseTest(unittest.TestCase):
    def _update(self, cursor):
        return db.update_case(
            "case-1",
            logged_by="Staffer",
            players=["Alice"],
            summary="Edited",
            rule="1.1",
            ruling="Upheld",
            punishment="warning",
            embedding=[0.5],
        )

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_update_case_found_persists_new_embedding(
        self, mock_connect, mock_register
    ) -> None:
        cursor = mock.MagicMock()
        # First fetch is the pre-update snapshot taken for the audit trail,
        # second is the UPDATE ... RETURNING id.
        cursor.fetchone.side_effect = [
            {
                "logged_by": "Old",
                "players": [],
                "summary": "Old",
                "rule": "",
                "ruling": "",
                "punishment": "",
            },
            {"id": "case-1"},
        ]
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        self.assertTrue(self._update(cursor))

        update_sql, params = next(
            c.args
            for c in cursor.execute.call_args_list
            if "UPDATE precedent_cases" in c.args[0]
        )
        self.assertIn("embedding = %s", update_sql)
        self.assertIn([0.5], params)
        conn.close.assert_called_once()

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_update_case_not_found(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = None
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        self.assertFalse(self._update(cursor))


def _audit_calls(cursor):
    """Every execute() that wrote to the audit table, with its params."""
    return [
        c.args
        for c in cursor.execute.call_args_list
        if "INSERT INTO precedent_audit" in c.args[0]
    ]


class AuditTrailTest(unittest.TestCase):
    """The audit row is written inside the caller's transaction, so a case can
    never be changed without a record of the change."""

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_insert_records_create_with_actor(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = ("case-uuid-1",)
        mock_connect.return_value = _make_conn(cursor)

        db.insert_case(
            logged_by="SteveMC",
            players=["Alice"],
            summary="Did a thing",
            rule="1.1",
            ruling="Upheld",
            punishment="warning",
            embedding=[0.1],
            actor=db.AuditActor(source="web", actor="SteveMC", actor_uuid="uuid-1"),
        )

        calls = _audit_calls(cursor)
        self.assertEqual(1, len(calls))
        params = calls[0][1]
        self.assertEqual("case-uuid-1", params[0])
        self.assertEqual("create", params[1])
        self.assertEqual("web", params[2])
        self.assertEqual("SteveMC", params[3])
        self.assertEqual("uuid-1", params[4])
        self.assertIsNone(params[5])  # nothing existed before

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_update_records_before_and_after(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.side_effect = [
            {
                "logged_by": "Old",
                "players": ["Alice"],
                "summary": "Old summary",
                "rule": "1.1",
                "ruling": "Upheld",
                "punishment": "warning",
            },
            {"id": "case-1"},
        ]
        mock_connect.return_value = _make_conn(cursor)

        self.assertTrue(
            db.update_case(
                "case-1",
                logged_by="New",
                players=["Bob"],
                summary="New summary",
                rule="2.2",
                ruling="Pardoned",
                punishment="none",
                embedding=[0.5],
                actor=db.AuditActor(source="web", actor="SteveMC"),
            )
        )

        # The pre-update row is locked so a concurrent edit cannot slip between
        # the snapshot and the write.
        self.assertTrue(
            any("FOR UPDATE" in c.args[0] for c in cursor.execute.call_args_list)
        )
        params = _audit_calls(cursor)[0][1]
        self.assertEqual("update", params[1])
        self.assertEqual("Old summary", params[5].adapted["summary"])
        self.assertEqual("New summary", params[6].adapted["summary"])

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_delete_keeps_a_copy_of_what_was_destroyed(
        self, mock_connect, mock_register
    ) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = {
            "logged_by": "Staffer",
            "players": ["Alice"],
            "summary": "Doomed case",
            "rule": "1.1",
            "ruling": "Upheld",
            "punishment": "10y",
            "created_at": datetime(2026, 8, 26, 10, 57, tzinfo=timezone.utc),
        }
        mock_connect.return_value = _make_conn(cursor)

        self.assertTrue(
            db.delete_case("case-1", actor=db.AuditActor(source="web", actor="SteveMC"))
        )

        params = _audit_calls(cursor)[0][1]
        self.assertEqual("delete", params[1])
        # The audit row is the only surviving copy once the case is gone.
        self.assertEqual("Doomed case", params[5].adapted["summary"])
        # created_at too, or a restored case would be stamped with today's date.
        self.assertEqual("2026-08-26T10:57:00+00:00", params[5].adapted["created_at"])
        self.assertIsNone(params[6])

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_delete_survives_a_row_without_created_at(
        self, mock_connect, mock_register
    ) -> None:
        """A missing timestamp must not turn a delete into a 502."""
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = {
            "logged_by": "Staffer",
            "players": [],
            "summary": "s",
            "rule": "",
            "ruling": "",
            "punishment": "",
            "created_at": None,
        }
        mock_connect.return_value = _make_conn(cursor)

        self.assertTrue(db.delete_case("case-1", actor=db.AuditActor(source="web")))
        self.assertNotIn("created_at", _audit_calls(cursor)[0][1][5].adapted)

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_no_audit_row_when_nothing_changed(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = None
        mock_connect.return_value = _make_conn(cursor)

        self.assertFalse(db.delete_case("missing", actor=db.AuditActor(source="web")))
        self.assertEqual([], _audit_calls(cursor))

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_bot_writes_are_marked_as_unverified_source(
        self, mock_connect, mock_register
    ) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = ("case-uuid-1",)
        mock_connect.return_value = _make_conn(cursor)

        db.insert_case(
            logged_by="WrenPlays",
            players=[],
            summary="s",
            rule="",
            ruling="",
            punishment="",
            embedding=[0.1],
            actor=db.AuditActor(source="bot", actor="WrenPlays"),
        )

        params = _audit_calls(cursor)[0][1]
        self.assertEqual("bot", params[2])
        self.assertEqual("", params[4])  # shared key carries no verified uuid


class MigrateAuditTableTest(unittest.TestCase):
    def setUp(self) -> None:
        db._MIGRATED = False

    def tearDown(self) -> None:
        db._MIGRATED = False

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_migrate_creates_audit_table_without_a_cascading_fk(
        self, mock_connect, mock_register
    ) -> None:
        cursor = mock.MagicMock()
        mock_connect.return_value = _make_conn(cursor)

        db.migrate()

        sql = " ".join(c.args[0] for c in cursor.execute.call_args_list)
        self.assertIn("CREATE TABLE IF NOT EXISTS precedent_audit", sql)
        # A foreign key would let deleting a case erase the proof it existed.
        audit_ddl = next(
            c.args[0]
            for c in cursor.execute.call_args_list
            if "precedent_audit" in c.args[0] and "CREATE TABLE" in c.args[0]
        )
        self.assertNotIn("REFERENCES", audit_ddl)


class DeleteCaseTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_delete_case_found(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        # DELETE ... RETURNING hands back the row it removed.
        cursor.fetchone.return_value = {
            "logged_by": "Staffer",
            "players": [],
            "summary": "s",
            "rule": "",
            "ruling": "",
            "punishment": "",
            "created_at": datetime(2026, 8, 26, tzinfo=timezone.utc),
        }
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        self.assertTrue(db.delete_case("some-id"))
        conn.close.assert_called_once()

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_delete_case_not_found(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = None
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        self.assertFalse(db.delete_case("missing-id"))


class GetCaseTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_get_case_found(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = {"id": "1", "summary": "s"}
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        self.assertEqual(db.get_case("1"), {"id": "1", "summary": "s"})

    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_get_case_not_found(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = None
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        self.assertIsNone(db.get_case("missing"))


class PingDbTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {"DATABASE_URL": "postgres://x"}, clear=True)
    @mock.patch("precedent.db.register_vector")
    @mock.patch("precedent.db.psycopg2.connect")
    def test_ping_db_runs_select_1(self, mock_connect, mock_register) -> None:
        cursor = mock.MagicMock()
        conn = _make_conn(cursor)
        mock_connect.return_value = conn

        db.ping_db()

        cursor.execute.assert_called_once_with("SELECT 1")
        conn.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
