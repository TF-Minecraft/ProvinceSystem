"""Expiry must survive the whole write, including waits after the first row lock.

These use the real UTC clock: observe the blocked backend, keep its blocker until
the stored deadline passes, then release it. No clock or database call is mocked.
"""
import time
from datetime import datetime, timedelta, timezone

import pytest

from src import database
from src.auth import microsoft_link, testing, users, view_as
from src.auth.test_locking import ROW, Run, lock_wait
from src.skins import codes, discord_link, drinks, submissions
from src.skins.test_locking import (  # noqa: F401 - shared Postgres fixture
    DISCORD_ID, MICROSOFT, OTHER_DISCORD_ID, OTHER_PLAYER, PLAYER, drink_catalog,
    env, link_profile, notices, session_for, signed_in, submit_drink, submit_skin,
)
from src.wars import declare_codes


def deadline(table, where="true", params=()):
    expiry = datetime.now(timezone.utc) + timedelta(seconds=2)
    testing.execute(f"UPDATE {table} SET expires_at = %s WHERE {where}", (expiry, *params))
    return expiry


def expires_while_blocked(expiry, hold, fn, kinds=ROW):
    run = None
    try:
        with database.connect() as conn:
            hold(conn)
            run = Run(fn)
            lock_wait(run, kinds)
            assert datetime.now(timezone.utc) < expiry, "the waiter must start before expiry"
            time.sleep(max(0, (expiry - datetime.now(timezone.utc)).total_seconds()) + 0.02)
    finally:
        if run is not None:
            run.join()
    return run


@pytest.mark.parametrize("scope", ["skin", "drink"])
@pytest.mark.parametrize("path", ["redeem", "site"])
def test_session_replacement_rechecks_expiry_after_deletion_wait(env, scope, path):
    issued = codes.issue_code(PLAYER, scope)
    redeem = codes.redeem_drink_code if scope == "drink" else codes.redeem_code
    old = redeem(issued["code"])
    # Refusing the replacement must preserve both the old bearer and redemption metadata.
    testing.execute("UPDATE login_codes SET redeemed_at = now() WHERE id = %s", (old["code_id"],))
    old_redeemed = testing.value("SELECT redeemed_at FROM login_codes")
    expiry = deadline("login_codes")
    fn = (lambda: codes.start_site_session(PLAYER, "main", scope)) if path == "site" else (
        lambda: redeem(issued["code"]))
    run = expires_while_blocked(expiry, lambda c: c.execute("SELECT id FROM code_sessions FOR UPDATE"), fn)
    if path == "site":
        assert isinstance(run.error, codes.SiteStartRefused) and run.error.reason == "cooldown"
        assert run.error.next_at is not None
    else:
        assert isinstance(run.error, codes.CodeError) and str(run.error) == "Code has expired"
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 1
    assert codes.get_session(old["session_token"]) is not None
    assert testing.value("SELECT redeemed_at FROM login_codes") == old_redeemed


@pytest.mark.parametrize("scope,route", [("skin", "skins"), ("drink", "drinks")])
def test_site_expiry_returns_existing_409_bytes_after_session_wait(env, scope, route):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.api.profile_routes import profile_router
    from src.skins.test_api_formats import body

    issued = codes.issue_code(PLAYER, scope)
    redeem = codes.redeem_drink_code if scope == "drink" else codes.redeem_code
    old = redeem(issued["code"])
    profile = codes.start_linked_profile_session(PLAYER)
    expiry = deadline("login_codes", "id = %s", (old["code_id"],))
    app = FastAPI()
    app.include_router(profile_router)
    client = TestClient(app)
    run = expires_while_blocked(expiry, lambda c: c.execute(
        "SELECT id FROM code_sessions WHERE code_id = %s FOR UPDATE", (old["code_id"],)),
        lambda: client.post(f"/profile/{route}/start", headers={
            "Authorization": "Bearer " + profile["session_token"]}))
    assert run.error is None
    assert run.value.status_code == 409
    next_at = codes._iso(testing.value("SELECT created_at FROM login_codes WHERE id = %s", (old["code_id"],))
                         + timedelta(days=21))
    assert run.value.content == body({"detail": {"reason": "cooldown", "next_at": next_at}})
    assert codes.get_session(old["session_token"]) is not None
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 2


def test_profile_redemption_rechecks_expiry_after_session_insert_wait(env):
    issued = codes.issue_code(PLAYER, "profile")
    expiry = deadline("login_codes")
    run = expires_while_blocked(expiry, lambda c: c.execute("LOCK TABLE code_sessions IN SHARE MODE"),
                               lambda: codes.redeem_profile_code(issued["code"], remember_me=True), {"relation"})
    assert isinstance(run.error, codes.CodeError) and str(run.error) == "Code has expired"
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 0
    assert testing.value("SELECT redeemed_at FROM login_codes") is None


@pytest.mark.parametrize("wait_on", ["code", "link", "sibling"])
def test_complete_link_rechecks_expiry_after_every_wait(env, wait_on):
    issued = discord_link.start_link(OTHER_PLAYER, "Alex")
    sibling = discord_link.start_link(OTHER_PLAYER, "Alex")
    digest = codes.hash_secret(issued["code"])
    expiry = deadline("discord_link_codes", "code_hash = %s", (digest,))
    if wait_on == "link":
        hold = lambda c: c.execute("LOCK TABLE discord_links IN SHARE MODE")
        kinds = {"relation"}
    else:
        held_hash = digest if wait_on == "code" else codes.hash_secret(sibling["code"])
        hold = lambda c: c.execute("SELECT id FROM discord_link_codes WHERE code_hash = %s FOR UPDATE",
                                   (held_hash,))
        kinds = ROW
    run = expires_while_blocked(expiry, hold,
                               lambda: discord_link.complete_link(issued["code"], OTHER_DISCORD_ID, "alex"), kinds)
    assert isinstance(run.error, discord_link.LinkError) and str(run.error) == "Link code has expired"
    assert testing.value("SELECT COUNT(*) FROM discord_links WHERE player_uuid = %s", (OTHER_PLAYER,)) == 0
    assert testing.value("SELECT COUNT(*) FROM discord_link_codes WHERE used_at IS NOT NULL") == 0
    assert notices("link_success") == 0


@pytest.mark.parametrize("expiring", ["session", "state"])
def test_microsoft_link_rechecks_expiry_after_later_binding_wait(env, expiring):
    user = signed_in()
    state, _ = microsoft_link.start(MICROSOFT, user)
    saved = microsoft_link.consume(state)
    expiry = deadline("user_sessions" if expiring == "session" else "microsoft_link_states")
    run = expires_while_blocked(expiry, lambda c: c.execute("LOCK TABLE discord_links IN SHARE MODE"),
                               link_profile(saved), {"relation"})
    assert isinstance(run.error, discord_link.LinkError) and str(run.error) == "This link attempt is no longer valid"
    assert testing.value("SELECT COUNT(*) FROM discord_links WHERE player_uuid = %s", (OTHER_PLAYER,)) == 0
    assert notices("link_success") == 0


def viewed_profile():
    token = users.sign_in({"discord_user_id": "823456789012345678", "discord_username": "boss",
                           "discord_global_name": None, "discord_avatar": None}, guild_member=True)
    testing.set_role("823456789012345678", "admin")
    return users.session_user(view_as.start(token, PLAYER)["token"])


@pytest.mark.parametrize("wait_on", ["view", "insert"])
def test_view_profile_rechecks_expiry_after_every_wait(env, wait_on):
    view = viewed_profile()
    expiry = deadline("user_sessions", "id = %s", (view["session_id"],))
    if wait_on == "view":
        hold = lambda c: c.execute("SELECT id FROM user_sessions WHERE id = %s FOR UPDATE", (view["session_id"],))
        kinds = ROW
    else:
        hold = lambda c: c.execute("LOCK TABLE code_sessions IN SHARE MODE")
        kinds = {"relation"}
    run = expires_while_blocked(expiry, hold, lambda: codes.start_linked_profile_session(
        PLAYER, minted_via=view_as.profile_minted_via(view), expires_at=codes._iso(expiry),
        still_allowed=view_as.view_still_open(view["session_id"])), kinds)
    assert isinstance(run.error, codes.CodeError) and str(run.error) == "session_ended"
    assert testing.value("SELECT COUNT(*) FROM code_sessions") == 0
    assert testing.value("SELECT COUNT(*) FROM login_codes") == 0


@pytest.mark.parametrize("scope", ["skin", "drink"])
def test_submission_rechecks_expiry_after_insert_wait(env, scope):
    drink_catalog()
    session = session_for(scope)
    expiry = deadline("login_codes")
    table = "drink_submissions" if scope == "drink" else "skin_submissions"
    fn = submit_drink(session, "Late Brew") if scope == "drink" else submit_skin(session, "Late Sword")
    run = expires_while_blocked(expiry, lambda c: c.execute(f"LOCK TABLE {table} IN SHARE MODE"), fn, {"relation"})
    error = drinks.DrinkError if scope == "drink" else submissions.SubmissionError
    assert isinstance(run.error, error) and str(run.error) == "Code has expired"
    assert testing.value(f"SELECT COUNT(*) FROM {table}") == 0
    assert testing.value("SELECT redeemed_at FROM login_codes") is None


def test_drink_rechecks_expiry_after_texture_row_wait(env):
    drink_catalog()
    session = session_for("drink")
    testing.execute("INSERT INTO drink_textures (id, owner_uuid, custom_model_data, png_path, refcount, created_at) "
                    "VALUES ('tex_old', %s, 7, 'textures/tex_old.png', 2, now())", (PLAYER,))
    expiry = deadline("login_codes")
    recipe = {"name": "Late Brew", "ingredients": [{"id": "grape", "amount": 1}], "effects": []}
    run = expires_while_blocked(expiry, lambda c: c.execute("SELECT id FROM drink_textures FOR UPDATE"),
                               lambda: drinks.create_drink_submission(session, recipe, existing_texture_id="tex_old"))
    assert isinstance(run.error, drinks.DrinkError) and str(run.error) == "Code has expired"
    assert testing.value("SELECT COUNT(*) FROM drink_submissions") == 0
    assert testing.value("SELECT refcount FROM drink_textures") == 2
    assert testing.value("SELECT redeemed_at FROM login_codes") is None


@pytest.mark.parametrize("wait_on", ["row", "update"])
def test_war_redemption_rechecks_expiry_after_every_wait(env, wait_on):
    issued = declare_codes.mint("attack", "defend", "war")
    expiry = deadline("war_declaration_codes")
    hold = lambda c: c.execute("SELECT id FROM war_declaration_codes FOR UPDATE" if wait_on == "row" else
                               "LOCK TABLE war_declaration_codes IN SHARE MODE")
    run = expires_while_blocked(expiry, hold,
                               lambda: declare_codes.redeem(issued["code"], "attack", "defend", war_id="war"),
                               ROW if wait_on == "row" else {"relation"})
    assert isinstance(run.error, declare_codes.WarDeclareCodeError) and str(run.error) == "This code has expired"
    assert testing.value("SELECT redeemed_at FROM war_declaration_codes") is None
    assert testing.value("SELECT redeemed_war_id FROM war_declaration_codes") is None


def test_microsoft_consume_rechecks_expiry_after_update_wait(env):
    state, _ = microsoft_link.start(MICROSOFT, signed_in())
    expiry = deadline("microsoft_link_states")
    run = expires_while_blocked(expiry, lambda c: c.execute("LOCK TABLE microsoft_link_states IN SHARE MODE"),
                               lambda: microsoft_link.consume(state), {"relation"})
    assert run.error is None and run.value is None
    assert testing.value("SELECT used_at FROM microsoft_link_states") is None


def test_revocation_rechecks_expiry_after_update_wait(env):
    issued = codes.issue_code(PLAYER, "skin")
    expiry = deadline("login_codes")
    run = expires_while_blocked(expiry, lambda c: c.execute("LOCK TABLE login_codes IN SHARE MODE"),
                               lambda: codes.revoke_code(issued["code"]), {"relation"})
    assert isinstance(run.error, codes.CodeError) and str(run.error) == "Code has expired"
    assert testing.value("SELECT revoked FROM login_codes") is False


def test_guild_leave_checks_grace_after_link_row_wait(env):
    expiry = datetime.now(timezone.utc) + timedelta(seconds=2)
    testing.execute("UPDATE discord_links SET left_guild_at = now(), grace_until = %s", (expiry,))
    run = expires_while_blocked(expiry, lambda c: c.execute("SELECT player_uuid FROM discord_links FOR UPDATE"),
                               lambda: discord_link.record_guild_left(DISCORD_ID))
    assert run.error is None and run.value["in_grace"] is True
    assert codes.as_time(run.value["grace_until"]) > expiry
    assert notices("guild_left_grace") == 1
