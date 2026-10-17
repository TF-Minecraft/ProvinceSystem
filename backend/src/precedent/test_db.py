"""Precedent storage and search against a real Postgres with pgvector."""

from __future__ import annotations

import math
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest

from src import database
from src.precedent import db


def _vec(*weights: float) -> list[float]:
    """A 1024-dimension embedding whose first few components are `weights`."""
    values = [0.0] * 1024
    values[: len(weights)] = weights
    return values


def _unit_at_angle(degrees: float) -> list[float]:
    """Cosine distance from _vec(1) is 1 - cos(degrees)."""
    radians = math.radians(degrees)
    return _vec(math.cos(radians), math.sin(radians))


@pytest.fixture
def precedent(postgres):
    db._MIGRATED = False
    db.migrate()
    yield db
    with database.connect() as conn:
        conn.execute("DROP TABLE IF EXISTS precedent_cases, precedent_audit")
    db._MIGRATED = False


def _insert(summary: str = "Did a thing", *, players=("Alice",), embedding=None, actor=None, **fields) -> str:
    return db.insert_case(
        logged_by=fields.get("logged_by", "Staffer"),
        players=list(players),
        summary=summary,
        rule=fields.get("rule", "1.1"),
        ruling=fields.get("ruling", "Warned"),
        punishment=fields.get("punishment", "warning"),
        embedding=embedding or _vec(1),
        actor=actor,
    )


def _audit_rows() -> list[dict]:
    with database.connect() as conn:
        return conn.execute("SELECT * FROM precedent_audit ORDER BY id").fetchall()


def test_migrate_skips_without_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(db, "_MIGRATED", False)
    db.migrate()
    assert db._MIGRATED is False


def test_migrate_runs_once_and_keeps_deletions_out_of_reach_of_cases(precedent):
    db.migrate()
    with database.connect() as conn:
        tables = {row["tablename"] for row in conn.execute(
            "SELECT tablename FROM pg_tables WHERE tablename LIKE 'precedent_%'")}
        foreign_keys = conn.execute(
            "SELECT 1 FROM information_schema.table_constraints "
            "WHERE table_name = 'precedent_audit' AND constraint_type = 'FOREIGN KEY'").fetchall()
    assert tables == {"precedent_cases", "precedent_audit"}
    # A foreign key would let deleting a case erase the proof it existed.
    assert foreign_keys == []


def test_insert_returns_the_id_as_text_and_records_who_created_it(precedent):
    actor = db.AuditActor(source="web", actor="SteveMC", actor_uuid="uuid-1")
    case_id = _insert("Did a thing", actor=actor)

    assert isinstance(case_id, str)
    uuid.UUID(case_id)
    [audit] = _audit_rows()
    assert (str(audit["case_id"]), audit["action"], audit["source"], audit["actor"], audit["actor_uuid"]) == (
        case_id, "create", "web", "SteveMC", "uuid-1")
    assert audit["before"] is None
    assert audit["after"] == {
        "logged_by": "Staffer", "players": ["Alice"], "summary": "Did a thing",
        "rule": "1.1", "ruling": "Warned", "punishment": "warning",
    }


def test_bot_writes_carry_no_verified_identity(precedent):
    _insert(actor=db.AuditActor(source="bot", actor="WrenPlays"))
    [audit] = _audit_rows()
    assert (audit["source"], audit["actor"], audit["actor_uuid"]) == ("bot", "WrenPlays", "")


def test_search_cuts_off_distant_cases_and_orders_by_distance(precedent):
    near = _insert("Near", embedding=_unit_at_angle(10))
    nearest = _insert("Nearest", embedding=_unit_at_angle(0))
    _insert("Off topic", embedding=_unit_at_angle(80))

    results = db.search_similar(_vec(1), limit=3)

    assert [row["id"] for row in results] == [nearest, near]
    assert results[0]["distance"] == pytest.approx(0.0, abs=1e-6)
    assert results[1]["distance"] == pytest.approx(1 - math.cos(math.radians(10)), abs=1e-6)
    assert all(row["distance"] < db.MAX_RELEVANT_DISTANCE for row in results)


def test_search_boosts_named_players_ignoring_case(precedent):
    _insert("Closer", players=["Bob"], embedding=_unit_at_angle(0))
    alice = _insert("Further", players=["ALICE"], embedding=_unit_at_angle(20))

    plain = db.search_similar(_vec(1), limit=1)
    boosted = db.search_similar(_vec(1), limit=1, players=["  alice ", ""])

    assert plain[0]["id"] != alice
    assert boosted[0]["id"] == alice


def test_search_boosts_cases_that_share_a_word_with_the_query(precedent):
    _insert("Griefed a farm", embedding=_unit_at_angle(0))
    xray = _insert("Xray", embedding=_unit_at_angle(20))

    # "a" and "to" are too short to be useful search words.
    results = db.search_similar(_vec(1), limit=1, query_text="player xray a to")

    assert results[0]["id"] == xray


def test_list_cases_pages_newest_first_with_a_total(precedent):
    ids = [_insert(f"Case {n}") for n in range(3)]
    with database.connect() as conn:
        for n, case_id in enumerate(ids):
            conn.execute("UPDATE precedent_cases SET created_at = %s WHERE id = %s",
                         (datetime(2026, 9, 1 + n, tzinfo=timezone.utc), case_id))

    rows, total = db.list_cases(limit=2, offset=1)

    assert total == 3
    assert [row["id"] for row in rows] == [ids[1], ids[0]]
    assert "embedding" not in rows[0]


def test_list_cases_needs_every_word_somewhere_in_the_case(precedent):
    in_summary_and_players = _insert("Used xray", players=["WrenPlays"])
    _insert("Used xray", players=["Bob"])
    in_logger_and_players = _insert("Griefed", players=["Wren"], logged_by="Xray")

    rows, total = db.list_cases(query="  XRAY  wren ")

    assert total == 2
    assert {row["id"] for row in rows} == {in_summary_and_players, in_logger_and_players}


def test_list_cases_matches_pattern_characters_literally(precedent):
    literal = _insert("Fined 100% of a_b")
    _insert("Fined 1000 of aXb")

    rows, total = db.list_cases(query="100% a_b")

    assert (total, [row["id"] for row in rows]) == (1, [literal])


def test_known_players_once_each_in_newest_spelling(precedent):
    first = _insert(players=["wrenplays", "Gvinno", " "])
    second = _insert(players=["WrenPlays"])
    with database.connect() as conn:
        conn.execute("UPDATE precedent_cases SET created_at = now() - interval '1 day' WHERE id = %s", (first,))
        conn.execute("UPDATE precedent_cases SET created_at = now() WHERE id = %s", (second,))

    assert db.known_players() == ["Gvinno", "WrenPlays"]


def test_update_replaces_text_and_embedding_and_records_both_sides(precedent):
    case_id = _insert("Old summary", embedding=_unit_at_angle(0))

    assert db.update_case(
        case_id, logged_by="New", players=["Bob"], summary="New summary", rule="2.2",
        ruling="Pardoned", punishment="none", embedding=_unit_at_angle(90),
        actor=db.AuditActor(source="web", actor="SteveMC"),
    )

    assert db.get_case(case_id)["summary"] == "New summary"
    # The stale vector is gone: the old direction no longer finds it.
    assert db.search_similar(_unit_at_angle(0)) == []
    assert db.search_similar(_unit_at_angle(90))[0]["id"] == case_id
    update = _audit_rows()[-1]
    assert update["action"] == "update"
    assert update["before"]["summary"] == "Old summary"
    assert update["after"]["players"] == ["Bob"]


def test_update_of_a_missing_case_changes_nothing(precedent):
    assert not db.update_case(
        str(uuid.uuid4()), logged_by="x", players=[], summary="x", rule="", ruling="",
        punishment="", embedding=_vec(1),
    )
    assert _audit_rows() == []


def test_delete_keeps_a_copy_and_restore_puts_it_back_under_its_id(precedent):
    case_id = _insert("Doomed case")
    with database.connect() as conn:
        conn.execute("UPDATE precedent_cases SET created_at = %s WHERE id = %s",
                     (datetime(2026, 8, 26, 10, 57, tzinfo=timezone.utc), case_id))

    assert db.delete_case(case_id, actor=db.AuditActor(source="web", actor="SteveMC"))
    assert db.get_case(case_id) is None
    [deleted] = db.list_deleted_cases()
    assert deleted["case_id"] == case_id
    assert deleted["before"]["summary"] == "Doomed case"
    assert deleted["before"]["created_at"] == "2026-08-26T10:57:00+00:00"

    assert db.restore_case(case_id, snapshot=deleted["before"], embedding=_vec(1))
    restored = db.get_case(case_id)
    assert restored["created_at"] == datetime(2026, 8, 26, 10, 57, tzinfo=timezone.utc)
    assert db.list_deleted_cases() == []
    # A second restore must not overwrite the live case.
    assert not db.restore_case(case_id, snapshot=deleted["before"], embedding=_vec(1))
    assert [row["action"] for row in _audit_rows()] == ["create", "delete", "restore"]


def test_deleting_a_missing_case_writes_no_audit_row(precedent):
    assert not db.delete_case(str(uuid.uuid4()))
    assert _audit_rows() == []


def test_list_deleted_cases_since_a_time(precedent):
    db.delete_case(_insert())
    assert len(db.list_deleted_cases(since="2000-01-01T00:00:00Z")) == 1
    assert db.list_deleted_cases(since="2999-01-01T00:00:00Z") == []


def test_audit_entries_filter_by_case_and_action(precedent):
    first = _insert("First")
    _insert("Second")
    db.delete_case(first)

    entries = db.list_audit_entries(case_id=first)
    assert [(entry["case_id"], entry["action"]) for entry in entries] == [(first, "delete"), (first, "create")]
    assert [entry["action"] for entry in db.list_audit_entries(action="create", limit=1)] == ["create"]


def test_ping(precedent):
    db.ping_db()


def test_missing_database_url_is_not_configured_even_with_the_pool_open(postgres, monkeypatch):
    monkeypatch.delenv("DATABASE_URL")
    with pytest.raises(db.PrecedentNotConfiguredError):
        db.ping_db()


def test_unreachable_database_is_a_precedent_error(monkeypatch):
    @contextmanager
    def refuse():
        raise database.OperationalError("connection refused")
        yield

    monkeypatch.setenv("DATABASE_URL", "postgresql://db.invalid/site")
    monkeypatch.setattr(database, "connect", refuse)
    with pytest.raises(db.PrecedentDBError, match="Could not connect"):
        db.ping_db()



def test_an_embedding_with_whole_numbers_is_stored(precedent):
    # JSON can give 0 for a zero component; psycopg will not send a list mixing int and float.
    mixed = [1, 0.0] + [0] * 1022
    case_id = _insert(embedding=mixed)
    assert db.search_similar(mixed)[0]["id"] == case_id
