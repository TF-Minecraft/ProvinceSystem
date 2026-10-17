"""Patch note storage: week arithmetic, and every query against a real Postgres."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest import mock
from zoneinfo import ZoneInfo

import pytest

from src import database
from src.patchnotes import db

WEEK = "2026-W39"
NEXT = "2026-W40"
TABLES = (
    "patchnote_bullets, patchnote_sources, patchnote_previews, patchnote_folders, "
    "patchnote_week_status, patchnote_jobs, patchnote_sync_tasks, patchnote_week_facts, "
    "patchnote_posts, patchnote_week_meta"
)


@pytest.fixture
def notes(postgres):
    db._MIGRATED = False
    db.migrate()
    yield db
    with database.connect() as conn:
        conn.execute(f"DROP TABLE IF EXISTS {TABLES}")
    db._MIGRATED = False


def _sql(query: str, params: tuple | None = None) -> list[dict]:
    with database.connect() as conn:
        cur = conn.execute(query, params)
        return cur.fetchall() if cur.description else []


def _bullet(body: str = "Added a station", *, section: str = "new", week: str = WEEK) -> dict:
    return db.insert_bullet(section=section, body=body, week=week)


# Week arithmetic


def test_parse_week_is_canonical_and_strict():
    assert db.parse_week("2026-W39") == "2026-W39"
    for bad in ("2026-W3", "2026-W54"):
        with pytest.raises(ValueError):
            db.parse_week(bad)


def test_next_week_steps_into_the_next_iso_week():
    assert db.next_week("2026-W39") == "2026-W40"
    assert db.next_week("2026-W52") == "2026-W53"


def test_zone_can_move_the_friday_cutoff(monkeypatch):
    # Friday 2026-09-25 10:30 UTC is still morning in UTC and past noon in Berlin.
    moment = datetime(2026, 9, 25, 10, 30, tzinfo=timezone.utc)
    monkeypatch.setenv("PATCHNOTES_TZ", "UTC")
    assert db.current_week(moment) == "2026-W39"
    monkeypatch.setenv("PATCHNOTES_TZ", "Europe/Berlin")
    assert db.current_week(moment) == "2026-W40"


def test_friday_noon_closes_the_week(monkeypatch):
    berlin = ZoneInfo("Europe/Berlin")
    monkeypatch.setenv("PATCHNOTES_TZ", "Europe/Berlin")
    assert db.current_week(datetime(2026, 9, 25, 11, 59, tzinfo=berlin)) == "2026-W39"
    assert db.current_week(datetime(2026, 9, 25, 12, 0, tzinfo=berlin)) == "2026-W40"
    assert db.current_week(datetime(2026, 9, 26, 9, 0, tzinfo=berlin)) == "2026-W40"


def test_unknown_zone_is_a_config_error(monkeypatch):
    monkeypatch.setenv("PATCHNOTES_TZ", "Not/AZone")
    with pytest.raises(db.PatchnotesConfigError):
        db.current_week()


# Connection


def test_migrate_skips_without_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(db, "_MIGRATED", False)
    db.migrate()
    assert db._MIGRATED is False


def test_migrate_twice_is_harmless(notes):
    db._MIGRATED = False
    db.migrate()
    assert _sql("SELECT count(*) AS n FROM pg_tables WHERE tablename LIKE 'patchnote_%'")[0]["n"] == 10


def test_unreachable_database_is_a_patch_notes_error(monkeypatch):
    @contextmanager
    def refuse():
        raise database.OperationalError("connection refused")
        yield

    monkeypatch.setenv("DATABASE_URL", "postgresql://db.invalid/site")
    monkeypatch.setattr(database, "connect", refuse)
    with pytest.raises(db.PatchnotesDBError, match="Could not connect"):
        db.list_published_weeks()


# Bullets


def test_insert_stores_a_trimmed_pending_bullet_with_a_text_id(notes):
    row = _bullet("  Added a station  ")
    assert isinstance(row["id"], str)
    uuid.UUID(row["id"])
    assert (row["week"], row["section"], row["body"], row["status"], row["highlight"]) == (
        WEEK, "new", "Added a station", "pending", False)
    assert row["created_at"].tzinfo is not None


def test_insert_rejects_unknown_section():
    with pytest.raises(ValueError):
        db.insert_bullet(section="secret", body="nope", week=WEEK)


def test_sourced_insert_writes_each_source_once(notes):
    with mock.patch.object(db, "current_week", return_value=WEEK):
        first = db.insert_sourced_bullet(section="new", body="Gathering: Added a node",
                                         source_key="TF-Minecraft/Gathering@abc1234")
        again = db.insert_sourced_bullet(section="new", body="Gathering: Added a node",
                                         source_key="TF-Minecraft/Gathering@abc1234")
    assert first["week"] == WEEK
    assert again is None
    assert len(db.list_pending()) == 1


def test_review_approves_or_denies_only_pending_bullets(notes):
    approved = db.approve_bullet(_bullet()["id"])
    assert approved["status"] == "approved"
    assert approved["reviewed_at"] is not None

    denied = db.deny_bullet(_bullet("Spoiler")["id"], "  Spoilers  ")
    assert (denied["status"], denied["deny_reason"]) == ("denied", "Spoilers")

    with pytest.raises(db.BulletNotPending) as caught:
        db.approve_bullet(denied["id"])
    assert caught.value.status == "denied"
    with pytest.raises(db.BulletNotFound):
        db.approve_bullet(str(uuid.uuid4()))


def test_deny_rejects_a_blank_reason():
    with pytest.raises(ValueError):
        db.deny_bullet("bullet-1", "   ")


def test_pending_queue_and_approved_week_keep_their_order(notes):
    technical = _bullet("Tidied logs", section="technical")
    fixed = _bullet("Fixed a crash", section="fixed")
    other_week = _bullet("Later", week=NEXT)
    for row in (technical, fixed):
        db.approve_bullet(row["id"])
    waiting = _bullet("Still waiting")

    assert [row["id"] for row in db.list_pending(WEEK)] == [waiting["id"]]
    assert [row["id"] for row in db.list_pending()] == [other_week["id"], waiting["id"]]
    # Section order, not insertion order.
    assert [row["id"] for row in db.list_approved(WEEK)] == [fixed["id"], technical["id"]]


def test_published_notes_page_newest_week_first_and_hide_held_weeks(notes):
    for week in ("2026-W37", "2026-W38", "2026-W39"):
        db.approve_bullet(_bullet(f"Note {week}", week=week)["id"])
    db.approve_bullet(_bullet("Second W39", section="fixed", week="2026-W39")["id"])
    db.approve_bullet(_bullet("Held", week="2026-W41")["id"])
    db.postpone_week("2026-W41")

    notes_page, has_more = db.list_published_notes(limit=2, before="2026-W42")
    assert has_more
    assert [(note["week"], [b["body"] for b in note["bullets"]]) for note in notes_page] == [
        ("2026-W39", ["Note 2026-W39", "Second W39"]),
        ("2026-W38", ["Note 2026-W38"]),
    ]
    older, has_more = db.list_published_notes(limit=5, before="2026-W38")
    assert ([note["week"] for note in older], has_more) == (["2026-W37"], False)
    assert db.list_published_notes(limit=5, before="2026-W37") == ([], False)
    assert db.list_published_weeks() == ["2026-W39", "2026-W38", "2026-W37"]
    with pytest.raises(ValueError):
        db.list_published_notes(limit=0)


def test_patch_label_counts_published_weeks_in_the_season(notes, monkeypatch):
    monkeypatch.setenv("PATCHNOTES_SEASON", "5")
    monkeypatch.setenv("PATCHNOTES_SEASON_START", "2026-W39")
    db.approve_bullet(_bullet(week="2026-W39")["id"])
    assert db.patch_label("2026-W41") == "5.2"


# Preview


def test_preview_replaces_the_last_and_expires_in_an_hour(notes):
    db.replace_preview(week=WEEK, bullets=[{"id": "old", "section": "new", "body": "Old"}])
    row = db.replace_preview(week=WEEK, bullets=[
        {"id": "b1", "section": "new", "body": "  Added a station  ", "topic": "Combat", "highlight": True},
    ])

    assert row["bullets"] == [
        {"id": "b1", "section": "new", "body": "Added a station", "topic": "combat", "highlight": True}]
    assert (row["expires_at"] - row["created_at"]).total_seconds() == pytest.approx(3600, abs=5)
    assert db.load_preview()["id"] == row["id"]

    _sql("UPDATE patchnote_previews SET expires_at = now() - interval '1 second'")
    assert db.load_preview() is None
    assert _sql("SELECT * FROM patchnote_previews") == []


# Folders and sync tasks


def test_folders_are_added_observed_given_rules_and_removed(notes):
    repo = db.ensure_folder(name="Gathering", origin="repo", repo="TF-Minecraft/Gathering",
                            dangerous=False, rules=["config/**"])
    assert (repo["status"], repo["rules"]) == ("pending", ["config/**"])
    # An existing row is left as staff set it.
    assert db.ensure_folder(name="Gathering", origin="repo", repo=None, dangerous=True)["dangerous"] is False

    added = db.request_added_folder("Cooking")
    assert added["origin"] == "added"
    with pytest.raises(ValueError):
        db.request_added_folder("Cooking")

    observed = db.observe_folder(name="Cooking", status="active", rules=None,
                                 unclassified=["odd.yml"], reject_reason=None, dangerous=True)
    assert (observed["status"], observed["rules"], observed["unclassified"], observed["dangerous"]) == (
        "active", [], ["odd.yml"], True)
    assert observed["verified_at"] is not None
    assert db.add_folder_rule("Cooking", "recipes/*.yml")["rules"] == ["recipes/*.yml"]
    assert db.add_folder_rule("Cooking", "recipes/*.yml")["rules"] == ["recipes/*.yml"]
    with pytest.raises(ValueError):
        db.add_folder_rule("Gathering", "x")

    assert [row["name"] for row in db.list_folders()] == ["Cooking", "Gathering"]
    with pytest.raises(ValueError):
        db.remove_added_folder("Gathering")
    db.remove_added_folder("Cooking")
    assert db.get_folder("Cooking") is None
    with pytest.raises(db.BulletNotFound):
        db.observe_folder(name="Cooking", status="active", rules=None, unclassified=[], reject_reason=None)


def test_one_sync_task_per_folder_per_week(notes):
    assert db.queue_sync_task(folder_name="Gathering", repo="TF-Minecraft/Gathering", week=WEEK)
    assert not db.queue_sync_task(folder_name="Gathering", repo="TF-Minecraft/Gathering", week=WEEK)
    assert db.queue_sync_task(folder_name="Archaeo", repo="TF-Minecraft/Archaeo", week=WEEK)
    assert db.list_sync_tasks(WEEK) == ["Archaeo", "Gathering"]


# Rewrites, feedback and review edits


def test_a_denial_is_rewritten_at_most_three_times(notes):
    row = db.deny_bullet(_bullet("Original")["id"], "Too vague")
    with mock.patch.object(db, "rewrite", return_value=None):
        assert db.revise_denied_bullet(row, "Too vague") is None
    with mock.patch.object(db, "rewrite", return_value=("fixed", "Clearer line")):
        for _ in range(3):
            row = db.revise_denied_bullet(row, "Again")
            assert (row["status"], row["section"], row["body"]) == ("pending", "fixed", "Clearer line")
            row = db.deny_bullet(row["id"], "Again")
        assert db.revise_denied_bullet(row, "Again") is None


def test_feedback_adds_rewrites_and_drops_lines_in_one_transaction(notes):
    keep = _bullet("Keep me")
    rewrite = _bullet("Rewrite me")
    drop = _bullet("Drop me")

    result = db.apply_feedback(WEEK, "Tighten the note", [
        {"action": "add", "section": "fixed", "body": "New line", "topic": "combat", "highlight": True},
        {"action": "rewrite", "id": rewrite["id"], "section": "adjusted", "body": "Rewritten"},
        {"action": "drop", "id": drop["id"]},
        {"action": "drop"},
    ])

    assert result["changed"] == 3
    assert [b["body"] for b in result["bullets"]] == ["Keep me", "Rewritten", "New line"]
    assert result["bullets"][1]["revision_note"] == "Tighten the note"
    assert db.get_bullet(drop["id"])["deny_reason"] == "Tighten the note"
    assert [b["id"] for b in db.list_open_bullets(WEEK)][0] == keep["id"]
    with pytest.raises(ValueError):
        db.apply_feedback(WEEK, " ", [])


def test_reset_week_drops_rewrites_and_restores_denials(notes):
    denied = db.deny_bullet(_bullet("Original")["id"], "Too vague")
    with mock.patch.object(db, "rewrite", return_value=("new", "Rewrite")):
        db.revise_denied_bullet(denied, "Too vague")
    db.replace_preview(week=WEEK, bullets=[])

    assert db.reset_week(WEEK) == {"week": WEEK, "removed": 1, "restored": 1}
    assert [(b["body"], b["status"]) for b in db.list_open_bullets(WEEK)] == [("Original", "pending")]
    assert db.load_preview() is None


def test_review_edits_change_only_the_named_fields(notes):
    row = _bullet("Wording stays")
    db.approve_bullet(row["id"])
    edited = db.update_bullet(row["id"], {"topic": "combat", "highlight": True})
    assert (edited["body"], edited["topic"], edited["highlight"], edited["status"]) == (
        "Wording stays", "combat", True, "approved")
    for fields in ({"topic": "invalid"}, {"section": "invalid"}, {"body": " "},
                   {"highlight": 1}, {"status": "approved"}):
        with pytest.raises(ValueError):
            db.update_bullet(row["id"], fields)


def test_drop_and_restore_without_rewriting(notes):
    row = _bullet()
    dropped = db.drop_bullet(row["id"])
    assert (dropped["status"], dropped["deny_reason"]) == ("denied", "Removed in review.")
    assert [b["id"] for b in db.list_denied(WEEK)] == [row["id"]]
    with pytest.raises(db.BulletNotOpen):
        db.drop_bullet(row["id"])
    with pytest.raises(db.BulletNotOpen):
        db.update_bullet(row["id"], {})

    restored = db.restore_bullet(row["id"])
    assert (restored["status"], restored["deny_reason"], restored["reviewed_at"]) == ("pending", None, None)
    with pytest.raises(db.BulletNotOpen):
        db.restore_bullet(row["id"])
    for operation in (db.drop_bullet, db.restore_bullet):
        with pytest.raises(db.BulletNotFound):
            operation(str(uuid.uuid4()))


def test_restore_is_refused_when_a_rewrite_replaced_the_line(notes):
    denied = db.deny_bullet(_bullet()["id"], "Too vague")
    with mock.patch.object(db, "rewrite", return_value=("new", "Rewrite")):
        db.revise_denied_bullet(denied, "Too vague")
    with pytest.raises(db.BulletNotOpen):
        db.restore_bullet(denied["id"])


def test_sort_moves_sections_and_highlights_without_touching_wording(notes):
    starred = _bullet("Starred")
    db.update_bullet(starred["id"], {"highlight": True})
    moved = _bullet("Move me")

    result = db.apply_sort(WEEK, [{"id": moved["id"], "section": "technical", "topic": "magic", "highlight": True}])

    assert result["changed"] == 1
    by_body = {b["body"]: b for b in result["bullets"]}
    # A line the sort did not mention keeps its highlight.
    assert by_body["Starred"]["highlight"] is True
    assert (by_body["Move me"]["section"], by_body["Move me"]["topic"], by_body["Move me"]["highlight"]) == (
        "technical", "magic", True)


def test_review_weeks_list_pending_weeks_and_the_latest_four(notes):
    for week in ("2026-W30", "2026-W36", "2026-W37", "2026-W38", "2026-W39"):
        db.approve_bullet(_bullet(week=week)["id"])
    _bullet(week="2026-W30")
    db.postpone_week("2026-W39")

    weeks = db.list_review_weeks()
    assert [row["week"] for row in weeks] == ["2026-W39", "2026-W38", "2026-W37", "2026-W36", "2026-W30"]
    assert weeks[0]["postponed"] is True
    assert (weeks[-1]["pending"], weeks[-1]["approved"]) == (1, 1)


# Week status


def test_postpone_defer_and_undo_carry_lines_and_their_review_state(notes):
    approved = db.approve_bullet(_bullet("Approved")["id"])
    pending = _bullet("Pending")

    assert db.get_week_status(WEEK) == {"week": WEEK, "postponed": False, "deferred_to": None}
    with pytest.raises(db.WeekNotPostponed):
        db.defer_postponed_week(WEEK)
    assert db.postpone_week(WEEK)["postponed"] is True
    with pytest.raises(db.WeekPostponed):
        db.approve_pending_week(WEEK)

    assert db.defer_postponed_week(WEEK)["deferred_to"] == NEXT
    assert db.defer_postponed_week(WEEK)["deferred_to"] == NEXT
    carried = {b["body"]: b for b in db.list_open_bullets(NEXT)}
    assert carried["Approved"]["status"] == "pending"

    assert db.undo_postpone(WEEK) == {"week": WEEK, "postponed": False, "deferred_to": None}
    back = {b["id"]: b["status"] for b in db.list_open_bullets(WEEK)}
    assert back == {approved["id"]: "approved", pending["id"]: "pending"}


def test_approve_pending_week_leaves_rewrites_for_staff(notes):
    _bullet("Plain")
    denied = db.deny_bullet(_bullet("Original")["id"], "Too vague")
    with mock.patch.object(db, "rewrite", return_value=("new", "Rewrite")):
        rewrite = db.revise_denied_bullet(denied, "Too vague")

    assert db.approve_pending_week(WEEK) == 1
    assert db.get_bullet(rewrite["id"])["status"] == "pending"


# Jobs


def test_one_active_line_job_and_one_post_job_per_week(notes):
    job = db.create_job(WEEK, "feedback", "Shorten it.")
    assert (job["status"], job["kind"], job["feedback"]) == ("queued", "feedback", "Shorten it.")
    with pytest.raises(db.JobActive):
        db.create_job(WEEK, "sort")
    assert db.create_job(WEEK, "compose")["kind"] == "compose"
    assert db.create_job(NEXT, "sort")["week"] == NEXT
    with pytest.raises(ValueError):
        db.create_job(WEEK, "nonsense")


def test_claim_takes_the_oldest_job_and_stores_the_line_order(notes):
    first = _bullet("First")
    second = _bullet("Second")
    job = db.create_job(WEEK, "feedback", "x")

    claimed = db.claim_job()

    assert (claimed["id"], claimed["status"]) == (job["id"], "running")
    assert claimed["line_ids"] == [first["id"], second["id"]]
    assert db.claim_job() is None


def test_finish_records_success_or_a_short_error(notes):
    db.create_job(WEEK, "feedback", "x")
    job = db.claim_job()
    done = db.finish_job(job["id"], changed=3)
    assert (done["status"], done["changed"], done["error"]) == ("done", 3, None)
    with pytest.raises(db.JobNotRunning):
        db.finish_job(job["id"], changed=1)

    db.create_job(WEEK, "sort")
    job = db.claim_job()
    failed = db.finish_job(job["id"], error="x" * 500)
    assert (failed["status"], failed["error"]) == ("failed", "x" * 300)


def test_stale_jobs_expire_and_the_expiry_sticks_when_a_new_job_is_refused(notes):
    queued = db.create_job(WEEK, "feedback", "x")
    _sql("UPDATE patchnote_jobs SET created_at = now() - interval '2 minutes'")
    assert db.get_job(queued["id"])["error"] == "The rewrite agent is not running."

    db.create_job(WEEK, "feedback", "y")
    running = db.claim_job()
    db.create_job(WEEK, "compose")
    _sql("UPDATE patchnote_jobs SET claimed_at = now() - interval '11 minutes' WHERE id = %s", (running["id"],))
    with pytest.raises(db.JobActive):
        db.create_job(WEEK, "compose")
    # The refused create still commits the expiry it found.
    [row] = _sql("SELECT status, error FROM patchnote_jobs WHERE id = %s", (running["id"],))
    assert (row["status"], row["error"]) == ("failed", "The rewrite took too long.")


def test_latest_job_tracks_line_and_post_jobs_apart(notes):
    line = db.create_job(WEEK, "feedback", "x")
    post = db.create_job(WEEK, "compose")
    assert db.latest_job(WEEK)["id"] == line["id"]
    assert db.latest_job(WEEK, db.POST_JOB_KINDS)["id"] == post["id"]
    assert db.latest_job(NEXT) is None
    assert db.get_job(str(uuid.uuid4())) is None


# Weekly post


def test_facts_post_and_act_are_stored_per_week(notes):
    assert db.get_facts(WEEK) is None
    db.save_facts(WEEK, {"players": 12})
    db.save_facts(WEEK, {"players": 14})
    assert db.get_facts(WEEK)["facts"] == {"players": 14}

    assert not db.approve_post(WEEK)
    db.save_post(WEEK, ["Hello"], "writer")
    assert db.approve_post(WEEK)
    redrafted = db.save_post(WEEK, ["Hello", "again"], "fallback")
    assert (redrafted["messages"], redrafted["source"], redrafted["status"]) == (
        ["Hello", "again"], "fallback", "draft")
    assert db.get_post(WEEK)["messages"] == ["Hello", "again"]
    assert db.get_post(NEXT) is None
    with pytest.raises(ValueError):
        db.save_post(WEEK, [], "someone")

    assert db.get_act(WEEK) is None
    db.set_act(WEEK, "  Act II  ")
    assert db.get_act(WEEK) == "Act II"
    db.set_act(WEEK, " ")
    assert db.get_act(WEEK) is None
    with pytest.raises(ValueError):
        db.set_act(WEEK, "x" * 61)
