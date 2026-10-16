"""The exact JSON that TFMCWeb, ArmourShop, DrinkBuilder, SimpleFactions and the bot parse.

Stored times are timestamptz and flags boolean now; these responses must still be
byte for byte what the SQLite site sent: times as `YYYY-MM-DDTHH:MM:SSZ`, the same
keys in the same order.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.drinks_routes import drinks_router
from src.api.skins_routes import skins_router
from src.api.wars_routes import wars_router
from src.auth import testing
from src.skins import db
from src.skins.codes import hash_secret
from src.skins.testing import link

PLAYER = "0f6c5a52-3b7e-4c39-9d1d-2a8f0e7b9c11"
PLUGIN = {"X-Plugin-Key": "plugin-key"}
STAFF = {"X-Staff-Key": "staff-key"}
ENTITLEMENTS = {
    "name_colour_stops": 2, "max_3d_pair_bytes": 30720, "skin_token_cooldown_days": 21, "skin_kinds": ["handheld"],
    "allow_armor_3d_helmet": False, "allow_drink_texture": False, "allow_drink_message": False, "meta_synced": True,
    "permission_flags": {},
}


@pytest.fixture
def api(postgres, tmp_path, monkeypatch):
    monkeypatch.setenv("PLUGIN_KEY", "plugin-key")
    monkeypatch.setenv("STAFF_KEY", "staff-key")
    for name in ("DATA_DIR", "SKINS_DIR", "DRINKS_DIR", "WARDROBE_DIR"):
        monkeypatch.setattr(db, name, tmp_path / name.lower())
    # Rank perks and map staff rights are Characters' to work out.
    monkeypatch.setattr("src.characters.rpc_player_meta.resolve_web_entitlements",
                        lambda *args, **kwargs: dict(ENTITLEMENTS))
    monkeypatch.setattr("src.characters.rpc_player_meta.has_map_staff_access", lambda *args, **kwargs: False)
    app = FastAPI()
    for router in (skins_router, drinks_router, wars_router):
        app.include_router(router)
    return TestClient(app)


def body(value) -> bytes:
    """The bytes FastAPI sends for `value`."""
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def code(scope: str, plaintext: str | None = "ABCD-EFGH-IJKL", **columns) -> int:
    values = {"code_hash": hash_secret(plaintext or scope), "code_plaintext": plaintext, "player_uuid": PLAYER,
              "scope": scope, "created_at": "2026-01-15T12:00:00Z", "expires_at": "2099-01-17T12:00:00Z", **columns}
    return testing.rows(f"INSERT INTO codes ({', '.join(values)}) VALUES ({', '.join(['%s'] * len(values))}) "
                        "RETURNING id", tuple(values.values()))[0]["id"]


def test_identity_status(api):
    link(PLAYER, "323456789012345678", "Steve", "steve", linked_at="2026-01-02T03:04:05.678901Z",
         left_guild_at="2026-10-16T09:00:00Z", grace_until="2099-01-01T00:00:00Z", link_method="code")
    response = api.get(f"/skins/discord/status/{PLAYER}", headers=PLUGIN)
    assert response.content == body({
        "linked": True, "eligible": True, "in_grace": True, "player_uuid": PLAYER,
        "discord_user_id": "323456789012345678", "discord_username": "steve", "minecraft_name": "Steve",
        "linked_at": "2026-01-02T03:04:05Z", "left_guild_at": "2026-10-16T09:00:00Z",
        "grace_until": "2099-01-01T00:00:00Z", "link_method": "code",
    })


def test_cosmetic_mint_status(api):
    code("drink", created_at="2026-01-15T12:00:00.250Z")
    code("profile", "PROF-0000-0000", created_at="2026-02-15T12:00:00Z")
    response = api.get("/skins/plugin/cosmetic-mint-status", params={"player_uuid": PLAYER}, headers=PLUGIN)
    assert response.content == body({"last_mint_at": "2026-01-15T12:00:00Z", "player_uuid": PLAYER})


def test_active_codes(api):
    code("skin")
    response = api.get("/skins/plugin/codes/active", headers=PLUGIN)
    assert response.content == body({"codes": [{
        "code": "ABCD-EFGH-IJKL", "player_uuid": PLAYER, "scope": "skin", "minecraft_name": None,
        "created_at": "2026-01-15T12:00:00Z", "expires_at": "2099-01-17T12:00:00Z",
    }]})


def test_code_inspection(api):
    """The staff panel's lookup (behind a staff session, so called directly; the route returns this dict)."""
    from src.skins.codes import inspect_code

    code("skin_staff")
    assert body(inspect_code("ABCD-EFGH-IJKL")) == body({
        "valid": True, "status": "active", "scope": "skin_staff", "realm_id": "main", "staff": True,
        "created_at": "2026-01-15T12:00:00Z", "expires_at": "2099-01-17T12:00:00Z", "revoked": False,
        "consumed": False, "expired": False, "player_uuid_masked": "0f6c5a52...", "site_staff_access": False,
        "staff_token_perms": {"tfmcweb.token.create": False, "tfmcweb.token.create.staff": False},
        "entitlements": {"meta_synced": True, "max_3d_pair_bytes": 30720, "skin_kinds": ["handheld"],
                         "name_colour_stops": 2, "allow_armor_3d_helmet": False},
    })


def test_plugin_notices(api):
    testing.execute("INSERT INTO plugin_notices (type, player_uuid, payload, created_at) "
                    "VALUES ('link_success', %s, '{\"discord_username\": \"steve\"}', '2026-03-01T10:00:00Z')",
                    (PLAYER,))
    response = api.get("/skins/plugin/notices", headers=PLUGIN)
    assert response.content == body({"notices": [{
        "id": 1, "type": "link_success", "player_uuid": PLAYER, "payload": {"discord_username": "steve"},
        "created_at": "2026-03-01T10:00:00Z",
    }]})
    acked = api.post("/skins/plugin/notices/ack", json={"ids": [1, 1, 99]}, headers=PLUGIN).json()
    assert acked["acked"] == [1, 1] and acked["delivered_at"].endswith("Z") and len(acked["delivered_at"]) == 20


@pytest.mark.parametrize("kind,payload", [
    ("guild_left_grace", {"discord_user_id": "323456789012345678", "grace_until": "2099-03-08T10:00:00Z",
                          "left_guild_at": "2026-03-01T10:00:00Z"}),
    ("grace_expired", {"discord_user_id": "323456789012345678", "grace_until": "2026-03-01T10:00:00Z"}),
    ("guild_rejoined", {"discord_user_id": "323456789012345678"}),
])
def test_known_plugin_notice_payload_bytes(api, kind, payload):
    from src import database
    testing.execute("INSERT INTO plugin_notices (type, player_uuid, payload, created_at) "
                    "VALUES (%s, %s, %s, '2026-03-01T10:00:00Z')", (kind, PLAYER, database.Jsonb(payload)))
    assert api.get("/skins/plugin/notices", headers=PLUGIN).content == body({"notices": [{
        "id": 1, "type": kind, "player_uuid": PLAYER, "payload": payload, "created_at": "2026-03-01T10:00:00Z",
    }]})


def test_link_completion_and_single_use_bytes(api, monkeypatch):
    from src.skins import discord_link
    monkeypatch.setattr(discord_link, "_utcnow", lambda: datetime(2099, 3, 1, 10, tzinfo=timezone.utc))
    issued = discord_link.start_link(PLAYER, "Steve")
    request = {"code": issued["code"], "discord_user_id": "323456789012345678", "discord_username": "steve"}
    response = api.post("/skins/discord/link/complete", json=request, headers=STAFF)
    assert response.content == body({"player_uuid": PLAYER, "discord_user_id": "323456789012345678",
                                     "discord_username": "steve", "minecraft_name": "Steve",
                                     "linked_at": "2099-03-01T10:00:00Z"})
    again = api.post("/skins/discord/link/complete", json=request, headers=STAFF)
    assert again.status_code == 400
    assert again.content == body({"detail": "Link code has already been used"})


def test_war_redemption_and_single_use_bytes(api, monkeypatch):
    from src.wars import declare_codes
    monkeypatch.setattr(declare_codes, "_utcnow", lambda: datetime(2099, 3, 1, 10, tzinfo=timezone.utc))
    issued = declare_codes.mint("attack", "defend", "war")
    request = {"code": issued["code"], "attacker_faction_id": "attack", "defender_faction_id": "defend",
               "realm_id": "main", "war_id": "war-1"}
    response = api.post("/wars/declare-codes/redeem", json=request, headers=PLUGIN)
    assert response.content == body({"ok": True, "id": issued["id"], "goal": "war", "realm_id": "main",
                                     "redeemed_at": "2099-03-01T10:00:00Z", "war_id": "war-1"})
    again = api.post("/wars/declare-codes/redeem", json=request, headers=PLUGIN)
    assert again.status_code == 400
    assert again.content == body({"detail": "This code has already been used"})


def test_approved_skins_for_the_plugin(api):
    link(PLAYER, "323456789012345678", "Steve", "steve")
    code_id = code("skin")
    testing.execute(
        """
        INSERT INTO submissions (id, player_uuid, code_id, kind, slug, display_name, base_set, tiers, add_name,
                                 status, dir_path, created_at, reviewed_at, staff, realm_id)
        VALUES ('steve_sword', %s, %s, 'handheld', 'steve_sword', 'Sword', 'swords', NULL, true,
                'approved', 'skins/steve_sword', '2026-03-01T10:00:00Z', '2026-03-02T11:00:00.5Z', false, 'main')
        """,
        (PLAYER, code_id),
    )
    expected = {"submissions": [{
        "id": "steve_sword", "player_uuid": PLAYER, "slug": "steve_sword", "kind": "handheld",
        "display_name": "Sword", "grip_preset": None, "base_set": "swords", "tiers": [], "helmet_3d_tiers": [],
        "tier_aliases": {}, "tier_sets": {}, "add_name": True, "name_colours": [], "name_styles": [],
        "reviewed_at": "2026-03-02T11:00:00Z", "minecraft_name": "Steve", "discord_username": "steve",
        "files": [], "staff": False, "realm_id": "main",
    }]}
    assert api.get("/skins/plugin/approved", headers=PLUGIN).content == body(expected)
    since = api.get("/skins/plugin/approved", params={"since": "2026-03-02T11:00:00Z"}, headers=PLUGIN)
    assert since.content == body(expected)
    later = api.get("/skins/plugin/approved", params={"since": "2026-03-02T11:00:01Z"}, headers=PLUGIN)
    assert later.json() == {"submissions": []}
    assert api.get("/skins/plugin/approved", params={"since": "yesterday"}, headers=PLUGIN).status_code == 400


def test_drinks_pending_apply(api):
    link(PLAYER, "323456789012345678", "Steve", "steve")
    code_id = code("drink")
    testing.execute(
        """
        INSERT INTO drink_submissions (id, player_uuid, code_id, slug, display_name, recipe_json, status,
                                       new_texture, dir_path, discord_user_id, created_at, reviewed_at)
        VALUES ('steve_ale', %s, %s, 'ale', 'Ale', '{"name": "Ale"}', 'approved', false, '/tmp/x',
                '323456789012345678', '2026-03-01T10:00:00Z', '2026-03-02T11:00:00Z')
        """,
        (PLAYER, code_id),
    )
    response = api.get("/drinks/plugin/pending-apply", headers=PLUGIN)
    assert response.content == body({"submissions": [{
        "id": "steve_ale", "player_uuid": PLAYER, "code_id": code_id, "slug": "ale", "display_name": "Ale",
        "recipe": {"name": "Ale"}, "status": "approved", "deny_reason": None, "texture_id": None,
        "new_texture": False, "discord_user_id": "323456789012345678", "created_at": "2026-03-01T10:00:00Z",
        "reviewed_at": "2026-03-02T11:00:00Z", "applied_at": None, "minecraft_name": "Steve",
        "discord_username": "steve", "files": [], "realm_id": "main", "texture": None,
    }]})


def test_war_codes_for_staff(api):
    minted = api.post("/wars/declare-codes", json={"attacker_faction_id": "a", "defender_faction_id": "d",
                                                   "goal": "war"}, headers=STAFF).json()
    testing.execute("UPDATE war_declare_codes SET created_at = '2026-03-01T10:00:00.9Z', "
                    "expires_at = '2099-03-03T10:00:00Z'")
    response = api.get("/wars/declare-codes", headers=STAFF)
    assert response.content == body({"codes": [{
        "id": minted["id"], "realm_id": "main", "attacker_faction_id": "a", "defender_faction_id": "d",
        "goal": "war", "created_by_discord_id": None, "created_at": "2026-03-01T10:00:00Z",
        "expires_at": "2099-03-03T10:00:00Z",
    }]})
