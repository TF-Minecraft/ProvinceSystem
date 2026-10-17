import json

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src import database
from src.api import admin_routes, auth_routes
from src.auth import admin, admin_cli, audit, roles, testing, users
from src.skins.testing import link

SITE = "https://www.tfminecraft.net"
ORIGIN = {"Origin": SITE}
SESSION = "__Host-tfmc_session"


@pytest.fixture
def env(database, postgres, monkeypatch):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", SITE)
    monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    return database


@pytest.fixture
def app(env):
    app = FastAPI()
    app.include_router(auth_routes.auth_router)
    admin_routes.install(app)
    return app


def account(db, name, role="player"):
    """Create a signed-in account; return (user_id, session token)."""
    discord_id = str(100000000000000000 + abs(hash(name)) % 10**15)
    token = users.sign_in(
        {"discord_user_id": discord_id, "discord_username": name, "discord_global_name": name.title(),
         "discord_avatar": None},
        guild_member=True,
    )
    return testing.set_role(discord_id, role), token


def discord_id_of(name):
    return str(100000000000000000 + abs(hash(name)) % 10**15)


def client(app, token=None):
    c = TestClient(app, base_url="https://testserver")
    if token:
        c.cookies.set(SESSION, token, domain="testserver.local")
    return c


def role_of(db, user_id):
    return testing.value("SELECT role FROM users WHERE id = %s", (user_id,))


def audit_rows(db=None):
    """The audit log, oldest first; detail_json is the parsed object."""
    return testing.audit_rows()


def sessions_of(db, user_id):
    return testing.value("SELECT COUNT(*) FROM user_sessions WHERE user_id = %s", (user_id,))


# --------------------
# Roles
# --------------------

def test_role_rules():
    assert roles.assignable_roles("root") == ["player", "mod", "admin", "root"]
    assert roles.assignable_roles("admin") == ["player", "mod"]
    assert roles.assignable_roles("mod") == []
    assert roles.assignable_roles("player") == []
    assert roles.outranks("admin", "mod") and not roles.outranks("admin", "admin")
    assert not roles.outranks("root", "unknown") and not roles.outranks("unknown", "player")
    # Roots may act on other roots; cannot_act_on_self still covers their own account.
    assert roles.outranks("root", "root") and not roles.outranks("admin", "root")
    assert not roles.is_staff("player") and not roles.is_staff("wizard") and roles.is_staff("mod")
    assert roles.capabilities("mod") == ["view_admin", "view_players", "revoke_sessions", "view_luckperms",
                                        "use_precedent", "inspect_codes", "view_diagnostics"]
    assert roles.capabilities("bogus") == []


# --------------------
# Migration
# --------------------



def test_fresh_database_rejects_unknown_roles(env):
    account(env, "alice")
    with pytest.raises(database.CheckViolation):
        testing.execute("UPDATE users SET role = 'owner'")


# --------------------
# Audit log
# --------------------

def test_audit_rows_cannot_change(env):
    with database.connect() as conn:
        audit.record(conn, actor=None, action="test", outcome="ok", detail={"b": 1, "a": [2]})
    row_id = audit_rows(env)[0]["id"]
    for statement in ("UPDATE admin_audit SET outcome = 'x'", "DELETE FROM admin_audit",
                      "INSERT INTO admin_audit (id, created_at, actor_type, action, outcome) "
                      f"VALUES ({row_id}, now(), 'system', 'forged', 'ok') ON CONFLICT (id) DO UPDATE SET outcome = 'x'"):
        with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
            testing.execute(statement)
    [row] = audit_rows(env)
    assert (row["action"], row["actor_name"], row["detail_json"]) == ("test", "operator", {"a": [2], "b": 1})


# --------------------
# Access to the panel
# --------------------

def test_panel_reads_need_staff(app, env):
    assert client(app).get("/admin/me").status_code == 401
    _, player = account(env, "pat")
    for path in ("/admin/me", "/admin/staff", "/admin/accounts/lookup?q=pat"):
        assert client(app, player).get(path).status_code == 403
    _, mod = account(env, "mona", "mod")
    me = client(app, mod).get("/admin/me")
    assert me.status_code == 200 and me.headers["cache-control"] == "no-store"
    assert me.json()["capabilities"] == roles.capabilities("mod")
    assert me.json()["assignable_roles"] == []


def test_account_reports_role(app, env):
    _, token = account(env, "ada", "admin")
    assert client(app, token).get("/account").json()["user"]["role"] == "admin"


def test_staff_list_and_lookup(app, env):
    root_id, root = account(env, "rory", "root")
    account(env, "mona", "mod")
    account(env, "adam", "admin")
    pat_id, _ = account(env, "pat")
    link("u-pat", discord_id_of("pat"), "PatMC")
    c = client(app, root)
    staff = c.get("/admin/staff").json()["staff"]
    assert [s["discord_username"] for s in staff] == ["rory", "adam", "mona"]
    # Times keep the API form the panel has always had.
    assert all(len(s["created_at"]) == 20 and s["created_at"].endswith("Z") for s in staff)
    assert staff[0]["last_login_at"] == users._iso(users._parse_iso(staff[0]["last_login_at"]))
    found = c.get("/admin/accounts/lookup", params={"q": "@PAT"}).json()["accounts"]
    assert [(a["user_id"], a["minecraft_name"], a["role"]) for a in found] == [(pat_id, "PatMC", "player")]
    assert c.get("/admin/accounts/lookup", params={"q": "pa"}).json()["accounts"] == []
    assert c.get("/admin/accounts/lookup", params={"q": "x" * 100}).json()["accounts"] == []


# --------------------
# Role changes
# --------------------

def change(app, token, target_id, role, reason="Promoted for events", headers=ORIGIN):
    return client(app, token).post(f"/admin/accounts/{target_id}/role", json={"role": role, "reason": reason},
                                   headers=headers)


def test_root_can_make_admins_and_target_is_signed_out(app, env):
    root_id, root = account(env, "rory", "root")
    pat_id, _ = account(env, "pat")
    response = change(app, root, pat_id, "admin")
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "before": "player", "after": "admin", "sessions_revoked": 1}
    assert role_of(env, pat_id) == "admin" and sessions_of(env, pat_id) == 0
    row = audit_rows(env)[-1]
    assert (row["action"], row["outcome"], row["actor_user_id"], row["actor_role"], row["target_user_id"]) == (
        "account.role.change", "ok", root_id, "root", pat_id)
    assert row["reason"] == "Promoted for events" and row["target_name"] == "pat"
    assert row["detail_json"] == {"after": "admin", "before": "player", "sessions_revoked": 1}


@pytest.mark.parametrize("actor_role,target_role,new_role,status,code", [
    ("admin", "player", "mod", 200, None),
    ("admin", "mod", "player", 200, None),
    ("admin", "player", "admin", 403, "role_not_assignable"),
    ("admin", "admin", "mod", 403, "target_outranks_you"),
    ("admin", "root", "player", 403, "target_outranks_you"),
    ("root", "admin", "player", 200, None),
    ("root", "player", "root", 200, None),
    ("root", "root", "admin", 200, None),
    ("admin", "player", "root", 403, "role_not_assignable"),
    ("mod", "player", "mod", 403, "forbidden"),
    ("player", "player", "mod", 403, "forbidden"),
    ("admin", "player", "player", 409, "role_unchanged"),
    ("admin", "player", "wizard", 403, "role_not_assignable"),
])
def test_role_change_rules(app, env, actor_role, target_role, new_role, status, code):
    _, actor = account(env, "actor", actor_role)
    target_id, _ = account(env, "target", target_role)
    response = change(app, actor, target_id, new_role)
    assert response.status_code == status, response.text
    row = audit_rows(env)[-1]
    if code:
        assert response.json()["detail"] == code
        assert role_of(env, target_id) == target_role
        assert (row["outcome"], row["detail_json"]["error"]) in {
            ("denied", code), ("conflict", code)}
        assert row["actor_role"] == actor_role
    else:
        assert role_of(env, target_id) == new_role and row["outcome"] == "ok"


def test_cannot_change_own_role(app, env):
    root_id, root = account(env, "rory", "root")
    response = change(app, root, root_id, "admin")
    assert response.status_code == 403 and response.json()["detail"] == "cannot_act_on_self"
    assert role_of(env, root_id) == "root"


@pytest.mark.parametrize("reason", ["", "  a ", "x" * 501])
def test_role_change_needs_a_reason(app, env, reason):
    _, root = account(env, "rory", "root")
    pat_id, _ = account(env, "pat")
    response = change(app, root, pat_id, "mod", reason=reason)
    assert response.status_code in (400, 422)
    assert role_of(env, pat_id) == "player"


def test_unknown_target(app, env):
    _, root = account(env, "rory", "root")
    response = change(app, root, 9999, "mod")
    assert response.status_code == 404
    assert audit_rows(env)[-1]["outcome"] == "not_found"
    # Past bigint: no account, not a database error.
    assert change(app, root, 2**70, "mod").status_code == 404


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://evil.example"}, {"Origin": "https://dev.tfminecraft.net"}])
def test_cross_site_writes_are_refused_and_audited(app, env, headers):
    _, root = account(env, "rory", "root")
    pat_id, _ = account(env, "pat")
    response = change(app, root, pat_id, "mod", headers=headers)
    assert response.status_code == 403
    assert role_of(env, pat_id) == "player"
    row = audit_rows(env)[-1]
    assert (row["action"], row["outcome"], row["actor_role"]) == ("account.role.change", "denied", "root")


def test_signed_out_writes_are_refused_without_audit(app, env):
    pat_id, _ = account(env, "pat")
    assert change(app, None, pat_id, "mod").status_code == 401
    assert audit_rows(env) == []


def test_demotion_that_lands_first_wins(app, env):
    """The actor's role is read inside the write, not from an earlier check."""
    adam_id, adam = account(env, "adam", "admin")
    pat_id, _ = account(env, "pat")
    testing.execute("UPDATE users SET role = 'mod' WHERE id = %s", (adam_id,))
    response = change(app, adam, pat_id, "mod")
    assert response.status_code == 403 and role_of(env, pat_id) == "player"


def test_revoked_actor_session_cannot_write(app, env):
    adam_id, adam = account(env, "adam", "admin")
    pat_id, _ = account(env, "pat")
    testing.execute("DELETE FROM user_sessions WHERE user_id = %s", (adam_id,))
    assert change(app, adam, pat_id, "mod").status_code == 401
    assert role_of(env, pat_id) == "player"


def test_failed_audit_rolls_back_the_change(app, env, monkeypatch):
    _, root = account(env, "rory", "root")
    pat_id, _ = account(env, "pat")

    def broken(conn, **kwargs):
        raise database.OperationalError("disk I/O error")

    monkeypatch.setattr(admin.audit, "record", broken)
    with pytest.raises(database.OperationalError):
        admin.change_role(client(app, root).cookies.get(SESSION), pat_id, "mod", "Promoted for events")
    assert role_of(env, pat_id) == "player" and sessions_of(env, pat_id) == 1


# --------------------
# Session revocation
# --------------------

def test_mod_can_sign_out_a_player_everywhere(app, env):
    _, mod = account(env, "mona", "mod")
    pat_id, _ = account(env, "pat")
    users.sign_in({"discord_user_id": discord_id_of("pat"), "discord_username": "pat",
                   "discord_global_name": None, "discord_avatar": None}, guild_member=True)
    response = client(app, mod).post(f"/admin/accounts/{pat_id}/sessions/revoke",
                                     json={"reason": "Reported shared login"}, headers=ORIGIN)
    assert response.status_code == 200 and response.json()["sessions_revoked"] == 2
    assert sessions_of(env, pat_id) == 0
    assert audit_rows(env)[-1]["action"] == "account.sessions.revoke"


def test_mod_cannot_sign_out_another_mod(app, env):
    _, mod = account(env, "mona", "mod")
    other_id, _ = account(env, "milo", "mod")
    response = client(app, mod).post(f"/admin/accounts/{other_id}/sessions/revoke",
                                     json={"reason": "Testing the rules"}, headers=ORIGIN)
    assert response.status_code == 403 and sessions_of(env, other_id) == 1


# --------------------
# Operator commands
# --------------------

def test_cli_grants_and_removes_root(env, capsys):
    rory_id, _ = account(env, "rory")
    sam_id, _ = account(env, "sam")
    rory_discord = discord_id_of("rory")
    sam_discord = discord_id_of("sam")

    assert admin_cli.main(["grant-root", "--discord-id", rory_discord, "--reason", "First owner"]) == 0
    assert role_of(env, rory_id) == "root" and sessions_of(env, rory_id) == 0
    row = audit_rows(env)[-1]
    assert (row["actor_type"], row["actor_name"], row["outcome"], row["target_user_id"]) == (
        "system", "operator", "ok", rory_id)

    with pytest.raises(SystemExit, match="last root"):
        admin_cli.main(["revoke-root", "--discord-id", rory_discord, "--reason", "Stepping down"])
    admin_cli.main(["grant-root", "--discord-id", sam_discord, "--reason", "Second owner"])
    admin_cli.main(["revoke-root", "--discord-id", rory_discord, "--reason", "Stepping down", "--to", "admin"])
    assert role_of(env, rory_id) == "admin" and role_of(env, sam_id) == "root"

    with pytest.raises(SystemExit, match="already root"):
        admin_cli.main(["grant-root", "--discord-id", sam_discord, "--reason", "Again"])
    with pytest.raises(SystemExit, match="sign in"):
        admin_cli.main(["grant-root", "--discord-id", "1", "--reason", "Nobody"])
    with pytest.raises(SystemExit, match="Refused"):
        admin_cli.main(["grant-root", "--discord-id", rory_discord, "--reason", "x"])
    admin_cli.main(["list-staff"])
    assert "root" in capsys.readouterr().out


@pytest.mark.parametrize("body,fields", [
    ({"reason": "Promoted for events"}, ["role"]),
    ({"role": "mod"}, ["reason"]),
    ({"role": "mod", "reason": "x" * 1001}, ["reason"]),
])
def test_malformed_writes_are_audited_without_values(app, env, body, fields):
    _, root = account(env, "rory", "root")
    pat_id, _ = account(env, "pat")
    response = client(app, root).post(f"/admin/accounts/{pat_id}/role", json=body, headers=ORIGIN)
    assert response.status_code == 422
    row = audit_rows(env)[-1]
    assert (row["action"], row["outcome"], row["actor_role"]) == ("account.role.change", "invalid", "root")
    assert row["detail_json"] == {"error": "invalid_request", "fields": fields, "target_user_id": pat_id}
    assert "x" * 50 not in json.dumps(row["detail_json"]) and row["reason"] is None


def test_malformed_writes_by_strangers_are_not_audited(app, env):
    assert client(app).post("/admin/accounts/1/role", json={}, headers=ORIGIN).status_code == 422
    assert client(app).post("/admin/accounts/abc/sessions/revoke", json={}, headers=ORIGIN).status_code == 422
    assert audit_rows(env) == []


def test_non_numeric_target_is_audited_without_an_id(app, env):
    _, root = account(env, "rory", "root")
    assert client(app, root).post("/admin/accounts/abc/sessions/revoke", json={"reason": "abc"},
                                  headers=ORIGIN).status_code == 422
    assert audit_rows(env)[-1]["detail_json"]["target_user_id"] is None


def test_staff_writes_without_an_accounts_database_are_503_and_change_nothing(app, env, monkeypatch):
    from src.servers import control

    monkeypatch.setattr(control, "request", lambda *a, **k: pytest.fail("server helper called"))
    _, root = account(env, "rory", "root")
    pat_id, _ = account(env, "pat")
    c = client(app, root)
    staff_only = client(app)
    staff_only.cookies.set("__Host-tfmc_staff_session", root, domain="testserver.local")
    with testing.no_accounts_database():
        responses = {
            "role": change(app, root, pat_id, "mod"),
            "revoke": c.post(f"/admin/accounts/{pat_id}/sessions/revoke", json={"reason": "Shared login"},
                             headers=ORIGIN),
            "server": c.post("/admin/servers/dev/cancel", json={"id": "d" * 32, "reason": "scheduled restart"},
                             headers=ORIGIN),
            "view-as": c.post("/admin/players/0f6c5a52-3b7e-4c39-9d1d-2a8f0e7b9c11/view-as", headers=ORIGIN),
            # The view cookie has lapsed; only the admin's own session is left to restore.
            "account": staff_only.get("/account"),
            "stop": staff_only.post("/auth/view-as/stop", headers=ORIGIN),
        }
    assert {name: (r.status_code, r.json()["detail"]) for name, r in responses.items()} == {
        name: (503, "accounts_unavailable") for name in responses}
    assert role_of(env, pat_id) == "player" and sessions_of(env, pat_id) == 1
    assert audit_rows(env) == []
    assert users.session_user(root)["role"] == "root"
