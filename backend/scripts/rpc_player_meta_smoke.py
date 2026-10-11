"""Smoke: PUT rpc-player-meta + GET /characters/player-meta.

Run from backend/: python scripts/rpc_player_meta_smoke.py
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

os.environ.setdefault("SKINS_DEV", "1")

from fastapi.testclient import TestClient

from server import app
from src.skins.db import migrate

PLUGIN = "dev-plugin-key"
STAFF = "dev-staff-key"
IGN = "MetaSmoke"
PLAYER = str(uuid.uuid4())
DISCORD_ID = str(int(uuid.uuid4().hex[:16], 16) % (10**18))


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def ensure_linked(client: TestClient, player: str) -> None:
    r = client.post(
        "/skins/discord/link/start",
        json={"player_uuid": player, "minecraft_name": IGN},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"link start: {r.status_code} {r.text}")
    body = r.json()
    if body.get("already_linked"):
        return
    code = body.get("code")
    if not code:
        fail(f"link start missing code: {body}")
    r = client.post(
        "/skins/discord/link/complete",
        json={
            "code": code,
            "discord_user_id": DISCORD_ID,
            "discord_username": IGN,
        },
        headers={"X-Staff-Key": STAFF},
    )
    if r.status_code != 200:
        fail(f"link complete: {r.status_code} {r.text}")


def main() -> None:
    migrate()
    client = TestClient(app)
    ensure_linked(client, PLAYER)

    put = client.put(
        "/characters/plugin/rpc-player-meta",
        headers={"X-Plugin-Key": PLUGIN},
        json={
            "player_uuid": PLAYER,
            "name_colour_stops": 20,
            "allow_drink_texture": True,
            "allow_drink_message": True,
            "max_alive_characters": 4,
            "wardrobe_skin_slots": 2,
            "max_3d_pair_bytes": 40960,
            "skin_token_cooldown_days": 21,
                "skin_kinds": ["handheld", "armor_set"],
                "allow_armor_3d_helmet": True,
                "permission_flags": {"rulequiz.completed": True},
            },
        )
        if put.status_code != 200:
            fail(f"PUT meta: {put.status_code} {put.text}")
        body = put.json()
        if body.get("name_colour_stops") != 8:
            fail(f"expected colour cap 8, got {body.get('name_colour_stops')}")

    mint = client.post(
        "/skins/codes",
        headers={"X-Plugin-Key": PLUGIN},
        json={"player_uuid": PLAYER, "scope": "drink"},
    )
    if mint.status_code != 200:
        fail(f"mint drink code: {mint.status_code} {mint.text}")
    code = mint.json().get("code")
    if not code:
        fail(f"mint missing code: {mint.json()}")

    redeem = client.post("/drinks/redeem", json={"code": code})
    if redeem.status_code != 200:
        fail(f"redeem: {redeem.status_code} {redeem.text}")
    token = redeem.json().get("session_token")
    if not token:
        fail(f"redeem missing session_token: {redeem.json()}")

    meta = client.get(
        "/characters/player-meta",
        headers={"Authorization": f"Bearer {token}"},
    )
    if meta.status_code != 200:
        fail(f"GET player-meta: {meta.status_code} {meta.text}")
    row = meta.json()
    if row.get("name_colour_stops") != 8:
        fail(f"GET stops: {row.get('name_colour_stops')}")
    if row.get("allow_drink_texture") is not True:
        fail(f"GET allow_drink_texture: {row.get('allow_drink_texture')}")
    if row.get("allow_drink_message") is not True:
        fail(f"GET allow_drink_message: {row.get('allow_drink_message')}")
    if row.get("meta_synced") is not True:
        fail(f"GET meta_synced: {row.get('meta_synced')}")
    flags = row.get("permission_flags") or {}
    if flags.get("rulequiz.completed") is not True:
        fail(f"GET permission_flags: {flags}")

    print("OK rpc_player_meta smoke")
    print(f"  player={PLAYER}")
    print(f"  stops={row.get('name_colour_stops')} texture={row.get('allow_drink_texture')} message={row.get('allow_drink_message')}")


if __name__ == "__main__":
    main()
