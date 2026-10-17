"""The linking, skins, drinks and codes locking recipes, raced on two connections against Postgres.

The method is src/auth/test_locking.py's: one transaction holds a lock, by hand on
its own connection or through a Gate that pauses a path just after a chosen
statement, while the competing path runs on another thread. The test sees that
thread's backend wait in pg_stat_activity (`advisory`, or a row lock), lets the
holder commit, and checks the waiter acted on the holder's result.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

import pytest

from src import database
from src.auth import microsoft_link, testing, users, view_as
from src.auth.microsoft import MicrosoftConfig
from src.auth.test_locking import ADVISORY, ROW, Gate, Run, held, lock_wait
from src.skins import codes, db, discord_link, drinks, submissions
from src.skins.testing import link
from src.wars import declare_codes

PLAYER = "0f6c5a52-3b7e-4c39-9d1d-2a8f0e7b9c11"
OTHER_PLAYER = "6b1f8c3e-2d4a-4f5b-8c7d-9e0f1a2b3c4d"
DISCORD_ID = "323456789012345678"
OTHER_DISCORD_ID = "423456789012345678"
TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
)
ENTITLEMENTS = {
    "name_colour_stops": 2,
    "max_3d_pair_bytes": 30720,
    "skin_token_cooldown_days": 21,
    "skin_kinds": ["handheld"],
    "allow_armor_3d_helmet": False,
    "allow_drink_texture": True,
    "allow_drink_message": False,
    "meta_synced": True,
}
MICROSOFT = MicrosoftConfig(enabled=True, client_id="client", client_secret="secret",
                            redirect_uri="https://tfminecraft.test/api/auth/microsoft/callback",
                            site_url="https://tfminecraft.test")


@pytest.fixture
def env(postgres, tmp_path, monkeypatch):
    """Upload files in a temporary directory and fixed rank perks (they are Characters' to work out)."""
    for name in ("DATA_DIR", "SKINS_DIR", "DRINKS_DIR", "WARDROBE_DIR"):
        monkeypatch.setattr(db, name, tmp_path / name.lower())
    monkeypatch.setattr(submissions, "SKINS_DIR", tmp_path / "skins")
    monkeypatch.setattr(submissions, "write_submission_files", lambda *args, **kwargs: None)
    monkeypatch.setattr(submissions, "write_name_preview", lambda *args, **kwargs: None)
    monkeypatch.setattr(submissions, "resolve_web_entitlements", lambda *args, **kwargs: dict(ENTITLEMENTS))
    monkeypatch.setattr("src.characters.web_entitlements.resolve_web_entitlements",
                        lambda *args, **kwargs: dict(ENTITLEMENTS))
    link(PLAYER, DISCORD_ID, "Steve", "steve")


def session_for(scope: str) -> dict:
    issued = codes.issue_code(PLAYER, scope)
    redeem = codes.redeem_drink_code if scope == "drink" else codes.redeem_code
    return codes.get_session(redeem(issued["code"])["session_token"])


def submit_skin(session: dict, name: str):
    return lambda: submissions.create_submission(session, "handheld", name, {"texture": TINY_PNG},
                                                 base_set="swords")


def submit_drink(session: dict, name: str):
    recipe = {"name": name, "ingredients": [{"id": "grape", "amount": 1}], "effects": [], "color": "#AABBCC"}
    return lambda: drinks.create_drink_submission(session, recipe)


def drink_catalog() -> None:
    drinks.replace_drink_catalog({"ingredients": [{"id": "grape", "label": "Grape", "category": "produce"}],
                                  "version": 1})


def outcome(*runs):
    """(values that came back, errors raised), in no particular order."""
    return [run.value for run in runs if run.error is None], [run.error for run in runs if run.error is not None]


def notices(kind: str) -> int:
    return testing.value("SELECT COUNT(*) FROM plugin_notices WHERE type = %s", (kind,))


def race(gate, first, second, kinds):
    """Release and join both workers even when a missing lock makes the assertion fail."""
    one = Run(first)
    two = None
    try:
        assert gate.reached.wait(10), one.error
        two = Run(second)
        lock_wait(two, kinds)
    finally:
        gate.release.set()
        one.join()
        if two is not None:
            two.join()
    return one, two


# --------------------
# A: a submission locks its code
# --------------------

def test_a_skin_code_is_consumed_by_one_submission(env, monkeypatch):
    """Two uploads on one code session: the second waits on the code row, then sees it used."""
    session = session_for("skin")
    gate = Gate(monkeypatch, "INSERT INTO skin_submissions")
    one, two = race(gate, submit_skin(session, "Test Sword"), submit_skin(session, "Other Blade"), ROW)
    made, errors = outcome(one, two)
    assert len(made) == 1 and [str(e) for e in errors] == ["This code already has an active submission"]
    assert testing.value("SELECT COUNT(*) FROM skin_submissions") == 1
    assert testing.value("SELECT redeemed_at IS NOT NULL FROM login_codes WHERE id = %s", (session["code_id"],))


def test_a_drink_code_is_consumed_by_one_submission(env, monkeypatch):
    drink_catalog()
    session = session_for("drink")
    gate = Gate(monkeypatch, "INSERT INTO drink_submissions")
    one, two = race(gate, submit_drink(session, "First Brew"), submit_drink(session, "Second Brew"), ROW)
    made, errors = outcome(one, two)
    assert len(made) == 1 and [str(e) for e in errors] == ["Code has already been used"]
    assert testing.value("SELECT COUNT(*) FROM drink_submissions") == 1


def test_a_submission_waits_for_a_revoke_of_its_code(env):
    """The code row is locked before it is checked, so a revoke landing meanwhile refuses the upload."""
    session = session_for("skin")
    run = held(
        lambda conn: conn.execute("UPDATE login_codes SET revoked = true WHERE id = %s", (session["code_id"],)),
        submit_skin(session, "Test Sword"),
        ROW,
    )
    assert isinstance(run.error, submissions.SubmissionError) and str(run.error) == "Code has been revoked"
    assert testing.value("SELECT COUNT(*) FROM skin_submissions") == 0


@pytest.mark.parametrize("scope", ["skin", "drink"])
def test_a_submission_rechecks_expiry_after_its_code_lock_wait(env, scope):
    drink_catalog()
    session = session_for(scope)
    submit = submit_drink(session, "Expired Brew") if scope == "drink" else submit_skin(session, "Expired Sword")
    run = held(
        lambda conn: conn.execute("UPDATE login_codes SET expires_at = now() - interval '1 second' WHERE id = %s",
                                  (session["code_id"],)),
        submit,
        ROW,
    )
    error = drinks.DrinkError if scope == "drink" else submissions.SubmissionError
    table = "drink_submissions" if scope == "drink" else "skin_submissions"
    assert isinstance(run.error, error) and str(run.error) == "Code has expired"
    assert testing.value(f"SELECT COUNT(*) FROM {table}") == 0
    assert testing.value("SELECT redeemed_at FROM login_codes WHERE id = %s", (session["code_id"],)) is None


# --------------------
# D: the shared skin and drink mint clock
# --------------------

def test_a_site_start_waits_for_a_tfmcweb_mint(env):
    """A Profile start checks the cooldown under cosmetic_mint:<uuid>; a mint holding it is seen."""
    def mint(conn):
        database.advisory_lock(conn, codes.cosmetic_mint_lock(PLAYER.upper()))
        conn.execute(
            "INSERT INTO login_codes (code_hash, player_uuid, scope, created_at, expires_at) "
            "VALUES ('tfmcweb', %s, 'drink', now(), now() + interval '2 days')", (PLAYER,))

    run = held(mint, lambda: codes.start_site_session(PLAYER, "main", "skin"), ADVISORY)
    assert isinstance(run.error, codes.SiteStartRefused) and run.error.reason == "cooldown"
    assert testing.value("SELECT COUNT(*) FROM login_codes WHERE scope = 'skin'") == 0


def test_two_site_starts_mint_one_code(env, monkeypatch):
    gate = Gate(monkeypatch, "INSERT INTO login_codes")
    start = lambda: codes.start_site_session(PLAYER, "main", "skin")  # noqa: E731
    one, two = race(gate, start, start, ADVISORY)
    assert one.error is None and two.error is None
    assert testing.value("SELECT COUNT(*) FROM login_codes") == 1


def test_every_mint_path_takes_the_cosmetic_mint_lock(env):
    def under_lock(fn):
        run = held(lambda conn: database.advisory_lock(conn, codes.cosmetic_mint_lock(PLAYER)), fn, ADVISORY)
        assert run.error is None, run.error
        return run.value

    assert under_lock(lambda: codes.issue_code(PLAYER, "skin"))["scope"] == "skin"
    under_lock(lambda: codes.reset_cosmetic_mint_cooldowns(PLAYER))
    assert under_lock(lambda: codes.start_site_session(PLAYER, "main", "drink"))["scope"] == "drink"


# --------------------
# C: one kit upload code per player
# --------------------

def test_two_first_kit_uploads_share_one_code(env):
    identity = codes.hash_secret(f"lore-upload:{PLAYER}")
    run = held(
        lambda conn: conn.execute(
            "INSERT INTO login_codes (id, code_hash, player_uuid, scope, created_at, expires_at) "
            "VALUES (77, %s, %s, 'lore_upload', now(), now() + interval '1 day')", (identity, PLAYER.upper())),
        lambda: codes.ensure_lore_upload_code(PLAYER, "main"),
        ROW,
    )
    assert run.error is None and run.value == 77
    assert testing.value("SELECT COUNT(*) FROM login_codes") == 1


# --------------------
# B: single-use codes and states
# --------------------

def test_a_profile_code_is_redeemed_once(env, monkeypatch):
    plaintext = codes.issue_code(PLAYER, "profile")["code"]
    gate = Gate(monkeypatch, "UPDATE login_codes SET redeemed_at")
    redeem = lambda: codes.redeem_profile_code(plaintext)  # noqa: E731
    made, errors = outcome(*race(gate, redeem, redeem, ROW))
    assert len(made) == 1 and [str(e) for e in errors] == ["Code has already been redeemed"]
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 1


def test_a_link_code_is_spent_once(env, monkeypatch):
    plaintext = discord_link.start_link(OTHER_PLAYER, "Alex")["code"]
    gate = Gate(monkeypatch, "UPDATE discord_link_codes SET used_at")
    made, errors = outcome(*race(
        gate,
        lambda: discord_link.complete_link(plaintext, "523456789012345678", "alex"),
        lambda: discord_link.complete_link(plaintext, "623456789012345678", "mallory"),
        ADVISORY,
    ))
    assert len(made) == 1 and [str(e) for e in errors] == ["Link code has already been used"]
    assert testing.rows("SELECT discord_user_id FROM discord_links WHERE player_uuid = %s", (OTHER_PLAYER,)) == [
        {"discord_user_id": made[0]["discord_user_id"]}]
    assert notices("link_success") == 1


def test_two_sibling_link_codes_do_not_deadlock(env, monkeypatch):
    first = discord_link.start_link(OTHER_PLAYER, "Alex")["code"]
    second = discord_link.start_link(OTHER_PLAYER, "Alex")["code"]
    gate = Gate(monkeypatch, "UPDATE discord_link_codes SET used_at")
    made, errors = outcome(*race(
        gate,
        lambda: discord_link.complete_link(first, OTHER_DISCORD_ID, "alex"),
        lambda: discord_link.complete_link(second, "623456789012345678", "mallory"),
        ADVISORY,
    ))
    assert len(made) == 1
    assert len(errors) == 1 and isinstance(errors[0], discord_link.LinkError)
    assert notices("link_success") == 1


def test_link_redemption_rechecks_a_code_spent_while_waiting(env):
    plaintext = discord_link.start_link(OTHER_PLAYER, "Alex")["code"]
    run = held(
        lambda conn: conn.execute("UPDATE discord_link_codes SET used_at = now() WHERE code_hash = %s",
                                  (codes.hash_secret(plaintext),)),
        lambda: discord_link.complete_link(plaintext, OTHER_DISCORD_ID, "alex"),
        ROW,
    )
    assert isinstance(run.error, discord_link.LinkError) and str(run.error) == "Link code has already been used"
    assert notices("link_success") == 0


def test_a_microsoft_state_is_spent_once(env, monkeypatch):
    user = signed_in()
    state, _ = microsoft_link.start(MICROSOFT, user)
    gate = Gate(monkeypatch, "UPDATE microsoft_link_states SET used_at")
    spend = lambda: microsoft_link.consume(state)  # noqa: E731
    one, two = race(gate, spend, spend, ROW)
    assert sorted([one.value is None, two.value is None]) == [False, True]


def test_two_grace_expiries_notice_once(env, monkeypatch):
    with database.connect() as conn:
        conn.execute("UPDATE discord_links SET grace_until = now() - interval '1 minute'")
    gate = Gate(monkeypatch, "DELETE FROM discord_links")
    one, two = race(gate, discord_link.expire_due_graces, discord_link.expire_due_graces, ADVISORY)
    assert sorted([one.value, two.value]) == [0, 1]
    assert notices("grace_expired") == 1


def test_a_grace_expiry_does_not_remove_a_rejoined_player(env):
    testing.execute("UPDATE discord_links SET grace_until = now() - interval '1 minute'")
    run = held(lambda conn: conn.execute("UPDATE discord_links SET grace_until = NULL"),
               discord_link.expire_due_graces, ROW)
    assert run.error is None and run.value == 0
    assert notices("grace_expired") == 0
    assert testing.value("SELECT COUNT(*) FROM discord_links") == 1


def test_a_war_code_redeemed_meanwhile_is_not_revoked(env, monkeypatch):
    minted = declare_codes.mint("attackers", "defenders", "war")
    gate = Gate(monkeypatch, "UPDATE war_declaration_codes")
    one, two = race(gate, lambda: declare_codes.redeem(minted["code"], "attackers", "defenders", war_id="9"),
                    lambda: declare_codes.revoke(minted["id"]), ROW)
    assert one.error is None
    assert isinstance(two.error, declare_codes.WarDeclareCodeError) and str(two.error) == "This code has already been used"
    assert testing.value("SELECT revoked FROM war_declaration_codes") is False


def test_a_war_code_is_redeemed_once(env, monkeypatch):
    minted = declare_codes.mint("attackers", "defenders", "war")
    gate = Gate(monkeypatch, "UPDATE war_declaration_codes")
    redeem = lambda: declare_codes.redeem(minted["code"], "attackers", "defenders")  # noqa: E731
    made, errors = outcome(*race(gate, redeem, redeem, ROW))
    assert len(made) == 1 and [str(e) for e in errors] == ["This code has already been used"]


def test_a_denial_never_undoes_an_approval(env, monkeypatch):
    created = submit_skin(session_for("skin"), "Test Sword")()
    gate = Gate(monkeypatch, "SET status = 'approved'")
    one, two = race(gate, lambda: submissions.approve_submission(created["id"]),
                    lambda: submissions.deny_submission(created["id"], "Not today"), ROW)
    assert one.error is None
    assert str(two.error) == "Only pending submissions can be denied"
    assert testing.value("SELECT status FROM skin_submissions") == "approved"


def test_two_releases_of_a_shared_drink_texture_both_count(env, monkeypatch):
    with database.connect() as conn:
        conn.execute("INSERT INTO drink_textures (id, owner_uuid, custom_model_data, png_path, refcount, created_at) "
                     "VALUES ('tex_1', %s, 7, 'textures/tex_1.png', 2, now())", (PLAYER,))
    gate = Gate(monkeypatch, "UPDATE drink_textures")
    release = lambda: drinks._release_texture("tex_1")  # noqa: E731
    one, two = race(gate, release, release, ROW)
    assert sorted([one.value["refcount"], two.value["refcount"]]) == [0, 1]
    assert testing.value("SELECT COUNT(*) FROM drink_textures") == 0


# --------------------
# A: a link guild leave
# --------------------

def test_two_guild_leaves_start_one_grace(env, monkeypatch):
    gate = Gate(monkeypatch, "FOR UPDATE")
    leave = lambda: discord_link.record_guild_left(DISCORD_ID)  # noqa: E731
    one, two = race(gate, leave, leave, ROW)
    assert one.error is None and two.error is None
    assert notices("guild_left_grace") == 1


# --------------------
# C: a link never replaces another
# --------------------

def test_a_link_waits_for_a_link_being_made_of_the_same_discord_account(env):
    plaintext = discord_link.start_link(OTHER_PLAYER, "Alex")["code"]
    run = held(
        lambda conn: conn.execute(
            "INSERT INTO discord_links (player_uuid, discord_user_id, linked_at) VALUES (%s, %s, now())",
            ("7c2e9d4f-3e5b-4a6c-9d8e-0f1a2b3c4d5e", OTHER_DISCORD_ID)),
        lambda: discord_link.complete_link(plaintext, OTHER_DISCORD_ID, "alex"),
        ROW,
    )
    assert isinstance(run.error, discord_link.LinkError)
    assert str(run.error) == "This Discord account is already linked to a different Minecraft player"
    # Refused, so the code is not spent.
    assert testing.value("SELECT used_at FROM discord_link_codes") is None


def test_a_link_waits_for_a_link_being_made_of_the_same_player(env):
    plaintext = discord_link.start_link(OTHER_PLAYER, "Alex")["code"]
    run = held(
        lambda conn: conn.execute(
            "INSERT INTO discord_links (player_uuid, discord_user_id, linked_at) VALUES (%s, %s, now())",
            (OTHER_PLAYER, "723456789012345678")),
        lambda: discord_link.complete_link(plaintext, OTHER_DISCORD_ID, "alex"),
        ROW,
    )
    assert isinstance(run.error, discord_link.LinkError)
    assert str(run.error) == "This Minecraft account is already linked to a different Discord account"


# --------------------
# Microsoft link attempts
# --------------------

def signed_in(name: str = "alex") -> dict:
    """The session user, with its token."""
    token = users.sign_in({"discord_user_id": OTHER_DISCORD_ID, "discord_username": name,
                           "discord_global_name": None, "discord_avatar": None}, guild_member=True)
    return {**users.session_user(token), "token": token}


def link_profile(saved: dict):
    return lambda: discord_link.link_verified_profile(
        OTHER_PLAYER, "Alex", OTHER_DISCORD_ID, "alex",
        still_allowed=lambda conn: microsoft_link.still_valid(conn, saved))


def test_two_microsoft_starts_keep_one_attempt(env):
    """C on the user's attempt: a start waits for another being made, then replaces it."""
    user = signed_in()
    run = held(
        lambda conn: conn.execute(
            "INSERT INTO microsoft_link_states (state_hash, session_id, user_id, code_verifier, expires_at) "
            "VALUES ('other', %s, %s, 'verifier', now() + interval '5 minutes')", (user["session_id"], user["user_id"])),
        lambda: microsoft_link.start(MICROSOFT, user),
        ROW,
    )
    assert run.error is None
    state, _ = run.value
    assert testing.rows("SELECT state_hash FROM microsoft_link_states") == [{"state_hash": codes.hash_secret(state)}]


def test_signing_out_mid_attempt_stops_the_microsoft_link(env):
    """A in still_valid: the session row is read FOR SHARE, so a sign-out landing first is seen."""
    user = signed_in()
    saved = microsoft_link.consume(microsoft_link.start(MICROSOFT, user)[0])
    run = held(lambda conn: conn.execute("DELETE FROM user_sessions WHERE id = %s", (user["session_id"],)),
               link_profile(saved), ROW)
    assert isinstance(run.error, discord_link.LinkError) and str(run.error) == "This link attempt is no longer valid"
    assert testing.value("SELECT COUNT(*) FROM discord_links WHERE player_uuid = %s", (OTHER_PLAYER,)) == 0


def test_unlinking_mid_attempt_stops_the_microsoft_link(env):
    """A in still_valid: the attempt's row is read FOR SHARE, so its cancellation landing first is seen."""
    user = signed_in()
    saved = microsoft_link.consume(microsoft_link.start(MICROSOFT, user)[0])
    run = held(lambda conn: discord_link._cancel_microsoft_attempts(conn, OTHER_DISCORD_ID), link_profile(saved), ROW)
    assert isinstance(run.error, discord_link.LinkError)
    assert testing.value("SELECT COUNT(*) FROM discord_links WHERE player_uuid = %s", (OTHER_PLAYER,)) == 0


def test_a_sign_out_waits_for_a_microsoft_link_being_written(env, monkeypatch):
    user = signed_in()
    saved = microsoft_link.consume(microsoft_link.start(MICROSOFT, user)[0])
    gate = Gate(monkeypatch, "FOR SHARE OF m, s")
    one, two = race(gate, link_profile(saved), lambda: users.revoke_session(user["token"]), ROW)
    assert one.error is None and two.error is None
    assert testing.value("SELECT COUNT(*) FROM discord_links WHERE player_uuid = %s", (OTHER_PLAYER,)) == 1


@pytest.mark.parametrize("by_uuid", [False, True])
def test_unlink_waits_for_a_microsoft_refresh_of_the_same_pair(env, monkeypatch, by_uuid):
    link(OTHER_PLAYER, OTHER_DISCORD_ID, "Alex", "alex")
    user = signed_in()
    saved = microsoft_link.consume(microsoft_link.start(MICROSOFT, user)[0])
    gate = Gate(monkeypatch, "FOR SHARE OF m, s")
    unlink = lambda: (discord_link.unlink_by_uuid(OTHER_PLAYER) if by_uuid else
                      discord_link.unlink_by_discord_id(OTHER_DISCORD_ID))
    one, two = race(gate, link_profile(saved), unlink, ADVISORY)
    assert one.error is None and two.error is None
    assert testing.value("SELECT COUNT(*) FROM discord_links WHERE player_uuid = %s", (OTHER_PLAYER,)) == 0
    assert testing.value("SELECT COUNT(*) FROM microsoft_link_states") == 0


# --------------------
# A: a Profile session opened during a view
# --------------------

def test_ending_a_view_waits_for_its_profile_session_and_removes_it(env, monkeypatch):
    """view_still_open holds the view FOR SHARE while start_linked_profile_session writes, so ending the
    view waits for that session and then deletes it with the view."""
    token = users.sign_in({"discord_user_id": "823456789012345678", "discord_username": "boss",
                           "discord_global_name": None, "discord_avatar": None}, guild_member=True)
    testing.set_role("823456789012345678", "admin")
    view_token = view_as.start(token, PLAYER)["token"]
    view = users.session_user(view_token)
    gate = Gate(monkeypatch, "acting_user_id IS NOT NULL FOR SHARE")
    opening, ending = race(
        gate,
        lambda: codes.start_linked_profile_session(PLAYER, minted_via=view_as.profile_minted_via(view),
                                                   expires_at=view["expires_at"],
                                                   still_allowed=view_as.view_still_open(view["session_id"])),
        lambda: view_as.end(view_token),
        ROW,
    )
    assert opening.error is None and ending.error is None
    assert codes.get_session(opening.value["session_token"]) is None
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 0


def test_a_profile_session_is_refused_once_its_view_ended(env):
    token = users.sign_in({"discord_user_id": "823456789012345678", "discord_username": "boss",
                           "discord_global_name": None, "discord_avatar": None}, guild_member=True)
    testing.set_role("823456789012345678", "admin")
    view_token = view_as.start(token, PLAYER)["token"]
    view = users.session_user(view_token)
    view_as.end(view_token)
    with pytest.raises(codes.CodeError, match="session_ended"):
        codes.start_linked_profile_session(PLAYER, still_allowed=view_as.view_still_open(view["session_id"]))
    assert testing.value("SELECT COUNT(*) FROM login_codes") == 0


def test_times_leave_in_the_api_form(env):
    """Stored times are timestamptz; every one a client reads keeps the `…Z` form, to the second."""
    issued = codes.issue_code(PLAYER, "skin")
    assert issued["expires_at"].endswith("Z") and len(issued["expires_at"]) == 20
    session = codes.get_session(codes.redeem_code(issued["code"])["session_token"])
    status = discord_link.get_identity_status(PLAYER)
    for value in (session["expires_at"], session["created_at"], status["linked_at"],
                  codes.get_cosmetic_mint_status(PLAYER)["last_mint_at"]):
        assert datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ") <= datetime.now() + timedelta(days=1)
    assert status["linked_at"] == "2026-01-01T00:00:00Z"
    left = discord_link.record_guild_left(DISCORD_ID)
    assert left["grace_until"] == testing.rows("SELECT payload FROM plugin_notices WHERE type = 'guild_left_grace'")[
        0]["payload"]["grace_until"]
    assert datetime.strptime(left["grace_until"], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc) > datetime.now(timezone.utc)


# Independent review round 1: expiry after lock waits and reuse lock order.

def after_expiry_wait(monkeypatch, module, expiry, hold, fn):
    """Advance a controlled UTC clock only after observing a real Postgres row wait."""
    clock = [expiry - timedelta(seconds=1)]
    monkeypatch.setattr(module, "_utcnow", lambda: clock[0])
    run = None
    try:
        with database.connect() as conn:
            hold(conn)
            run = Run(fn)
            lock_wait(run, ROW)
            clock[0] = expiry + timedelta(seconds=1)
    finally:
        if run is not None:
            run.join()
    return run


@pytest.mark.parametrize("expiring", ["session", "state"])
def test_round1_microsoft_link_rechecks_expiry_after_wait(env, monkeypatch, expiring):
    user = signed_in()
    saved = microsoft_link.consume(microsoft_link.start(MICROSOFT, user)[0])
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    testing.execute("UPDATE user_sessions SET expires_at = %s", (expiry + timedelta(hours=1),))
    testing.execute("UPDATE microsoft_link_states SET expires_at = %s", (expiry + timedelta(hours=1),))
    table = "user_sessions" if expiring == "session" else "microsoft_link_states"
    testing.execute(f"UPDATE {table} SET expires_at = %s", (expiry,))
    run = after_expiry_wait(monkeypatch, microsoft_link, expiry,
                            lambda conn: conn.execute(f"SELECT * FROM {table} FOR UPDATE"), link_profile(saved))
    assert isinstance(run.error, discord_link.LinkError) and str(run.error) == "This link attempt is no longer valid"
    assert testing.value("SELECT COUNT(*) FROM discord_links WHERE player_uuid = %s", (OTHER_PLAYER,)) == 0


def test_round1_microsoft_consume_rechecks_expiry_after_wait(env, monkeypatch):
    state, _ = microsoft_link.start(MICROSOFT, signed_in())
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    testing.execute("UPDATE microsoft_link_states SET expires_at = %s", (expiry,))
    run = after_expiry_wait(monkeypatch, microsoft_link, expiry,
                            lambda conn: conn.execute("SELECT * FROM microsoft_link_states FOR UPDATE"),
                            lambda: microsoft_link.consume(state))
    assert run.error is None and run.value is None
    assert testing.value("SELECT used_at FROM microsoft_link_states") is None


@pytest.mark.parametrize("scope", ["profile", "skin", "drink"])
def test_round1_redemption_rechecks_expiry_after_wait(env, monkeypatch, scope):
    issued = codes.issue_code(PLAYER, scope)
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    testing.execute("UPDATE login_codes SET expires_at = %s", (expiry,))
    redeem = {"profile": lambda: codes.redeem_profile_code(issued["code"], remember_me=True),
              "skin": lambda: codes.redeem_code(issued["code"]),
              "drink": lambda: codes.redeem_drink_code(issued["code"])}[scope]
    run = after_expiry_wait(monkeypatch, codes, expiry,
                            lambda conn: conn.execute("SELECT * FROM login_codes FOR UPDATE"), redeem)
    assert isinstance(run.error, codes.CodeError) and str(run.error) == "Code has expired"
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 0
    assert testing.value("SELECT redeemed_at FROM login_codes") is None


def test_round1_revocation_rechecks_expiry_after_wait(env, monkeypatch):
    issued = codes.issue_code(PLAYER, "skin")
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    testing.execute("UPDATE login_codes SET expires_at = %s", (expiry,))
    run = after_expiry_wait(monkeypatch, codes, expiry,
                            lambda conn: conn.execute("SELECT * FROM login_codes FOR UPDATE"),
                            lambda: codes.revoke_code(issued["code"]))
    assert isinstance(run.error, codes.CodeError) and str(run.error) == "Code has expired"
    assert testing.value("SELECT revoked FROM login_codes") is False


@pytest.mark.parametrize("scope", ["skin", "drink"])
def test_round1_site_reuse_rechecks_expiry_after_wait(env, monkeypatch, scope):
    codes.issue_code(PLAYER, scope)
    old_id = testing.value("SELECT id FROM login_codes")
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    testing.execute("UPDATE login_codes SET expires_at = %s", (expiry,))
    run = after_expiry_wait(monkeypatch, codes, expiry,
                            lambda conn: conn.execute("SELECT * FROM login_codes FOR UPDATE"),
                            lambda: codes.start_site_session(PLAYER, "main", scope))
    # Expired unused codes no longer reserve cooldown (main #261). Recheck
    # after the wait, then mint a fresh code instead of reusing the expired one.
    assert run.error is None
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 1
    assert testing.value("SELECT code_id FROM code_sessions") != old_id
    assert testing.value("SELECT redeemed_at FROM login_codes WHERE id=%s", (old_id,)) is None
    assert testing.value("SELECT created_at FROM login_codes WHERE id<>%s", (old_id,)) > expiry


@pytest.mark.parametrize("scope", ["skin", "drink"])
@pytest.mark.parametrize("change", ["revoked", "consumed"])
def test_round1_site_reuse_revalidates_selected_code(env, monkeypatch, scope, change):
    codes.issue_code(PLAYER, scope)
    code_id = testing.value("SELECT id FROM login_codes")
    selected, release = threading.Event(), threading.Event()
    original = codes._open_code

    def pause_after_selection(*args):
        row = original(*args)
        selected.set()
        assert release.wait(10), "candidate selection was never released"
        return row

    monkeypatch.setattr(codes, "_open_code", pause_after_selection)
    run = Run(lambda: codes.start_site_session(PLAYER, "main", scope))
    try:
        assert selected.wait(10), run.error
        with database.connect() as conn:
            if change == "revoked":
                conn.execute("UPDATE login_codes SET revoked = true WHERE id = %s", (code_id,))
            else:
                if scope == "skin":
                    conn.execute("INSERT INTO skin_submissions (id, player_uuid, code_id, kind, slug, display_name, "
                                 "status, dir_path, created_at) VALUES ('used', %s, %s, 'handheld', 'used', 'Used', "
                                 "'pending', 'skins/used', now())", (PLAYER, code_id))
                else:
                    conn.execute("INSERT INTO drink_submissions (id, player_uuid, code_id, slug, display_name, "
                                 "recipe, status, dir_path, created_at) VALUES ('used', %s, %s, 'used', 'Used', "
                                 "'{}', 'pending', 'drinks/used', now())", (PLAYER, code_id))
                conn.execute("UPDATE login_codes SET redeemed_at = now() WHERE id = %s", (code_id,))
            release.set()
            lock_wait(run, ROW)
    finally:
        release.set()
        run.join()
    assert isinstance(run.error, codes.SiteStartRefused) and run.error.reason == "cooldown"
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 0
    if change == "consumed":
        assert testing.value("SELECT redeemed_at FROM login_codes") is not None


@pytest.mark.parametrize("scope", ["skin", "drink"])
def test_round1_site_reuse_and_redemption_share_lock_order(env, monkeypatch, scope):
    issued = codes.issue_code(PLAYER, scope)
    redeem = codes.redeem_drink_code if scope == "drink" else codes.redeem_code
    initial = redeem(issued["code"])
    gate = Gate(monkeypatch, "SELECT * FROM login_codes WHERE code_hash = %s FOR UPDATE")
    redemption, site = race(gate, lambda: redeem(issued["code"]),
                            lambda: codes.start_site_session(PLAYER, "main", scope), ROW)
    assert redemption.error is None and site.error is None
    assert codes.get_session(initial["session_token"]) is None
    assert codes.get_session(redemption.value["session_token"]) is None
    assert codes.get_session(site.value["session_token"]) is not None
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 1
