"""Character session E2E smoke — run from backend/ with TEST_DATABASE_URL: python scripts/character_session_smoke.py

Redeem TTLs, single-use, skin rejection, catalog access, logout revoke.
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

os.environ.setdefault("SKINS_DEV", "1")

from fastapi.testclient import TestClient

from smoke_support import isolated_smoke

PLUGIN = "dev-plugin-key"
STAFF = "dev-staff-key"
DISCORD_ID = "888888888888888888"
IGN = "CharSmoke"

MINI_CATALOG = {
    "stages": [{"id": "info", "type": "info", "order": 0, "messages": ["hi"]}],
    "attribute_point_buy": {
        "pool": 12,
        "max_rank": 2,
        "cost_for_rank": [1, 2],
        "attributes": [
            "strength",
            "dexterity",
            "constitution",
            "intelligence",
            "wisdom",
            "charisma",
        ],
    },
    "races": [{"id": "human"}],
    "traits": [{"id": "str1"}],
    "classes": [{"id": "warrior"}],
    "validation": {},
    "slot_limits": {},
}


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def _parse_iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


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
    if "code" not in body:
        fail(f"link start missing code: {body}")
    r = client.post(
        "/skins/discord/link/complete",
        json={
            "code": body["code"],
            "discord_user_id": DISCORD_ID,
            "discord_username": "CharSmokeDiscord",
        },
        headers={"X-Staff-Key": STAFF},
    )
    if r.status_code != 200:
        fail(f"link complete: {r.status_code} {r.text}")


def mint(client: TestClient, player: str, scope: str) -> str:
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player, "scope": scope},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"mint {scope}: {r.status_code} {r.text}")
    code = r.json().get("code")
    if not code:
        fail(f"mint missing code: {r.json()}")
    return code


@isolated_smoke
def main() -> None:
    from server import app
    from src.characters.creation_catalog import replace_catalog

    replace_catalog(MINI_CATALOG)
    client = TestClient(app)
    player = f"00000000-0000-4000-8000-{uuid.uuid4().hex[:12]}"
    ensure_linked(client, player)
    now = datetime.now(timezone.utc)

    code1 = mint(client, player, "profile")
    r = client.post("/skins/profile/redeem", json={"code": code1})
    if r.status_code != 200:
        fail(f"redeem default: {r.status_code} {r.text}")
    body = r.json()
    if body.get("scope") != "profile" or body.get("remember_me") is not False:
        fail(f"redeem default body: {body}")
    token1 = body["session_token"]
    exp1 = _parse_iso(body["expires_at"])
    delta1 = exp1 - now
    if not (timedelta(hours=7) < delta1 < timedelta(hours=9)):
        fail(f"default TTL expected ~8h, got {delta1} expires_at={body['expires_at']}")
    print(f"OK redeem without remember_me -> ~8h ({delta1})")

    r = client.post("/skins/profile/redeem", json={"code": code1})
    if r.status_code != 400:
        fail(f"second redeem expected 400, got {r.status_code} {r.text}")
    print("OK second redeem of same code -> 400")

    skin_code = mint(client, player, "skin")
    r = client.post("/skins/profile/redeem", json={"code": skin_code})
    if r.status_code != 400:
        fail(f"skin on character redeem expected 400, got {r.status_code} {r.text}")
    print("OK skin-scope code on profile redeem -> 400")

    code2 = mint(client, player, "profile")
    r = client.post(
        "/skins/profile/redeem",
        json={"code": code2, "remember_me": True},
    )
    if r.status_code != 200:
        fail(f"redeem remember_me: {r.status_code} {r.text}")
    body2 = r.json()
    if body2.get("remember_me") is not True:
        fail(f"remember_me flag missing: {body2}")
    exp30 = _parse_iso(body2["expires_at"])
    delta30 = exp30 - now
    if not (timedelta(days=29) < delta30 < timedelta(days=31)):
        fail(f"remember_me TTL expected ~30d, got {delta30}")
    token30 = body2["session_token"]
    print(f"OK redeem with remember_me -> ~30d ({delta30})")

    r = client.get(
        "/characters/creation-catalog",
        headers={"Authorization": f"Bearer {token1}"},
    )
    if r.status_code != 200:
        fail(f"catalog with session expected 200, got {r.status_code} {r.text}")
    print("OK GET catalog with character session -> 200")

    r = client.post(
        "/characters/logout",
        headers={"Authorization": f"Bearer {token1}"},
    )
    if r.status_code != 200 or not r.json().get("ok"):
        fail(f"logout: {r.status_code} {r.text}")
    print("OK logout -> 200")

    r = client.get(
        "/characters/creation-catalog",
        headers={"Authorization": f"Bearer {token1}"},
    )
    if r.status_code != 401:
        fail(f"catalog after logout expected 401, got {r.status_code} {r.text}")
    print("OK GET catalog after logout -> 401")

    r = client.post(
        "/characters/logout",
        headers={"Authorization": f"Bearer {token1}"},
    )
    if r.status_code != 200 or not r.json().get("ok"):
        fail(f"idempotent logout: {r.status_code} {r.text}")
    print("OK logout again (idempotent) -> 200")

    # remembered session still valid
    r = client.get(
        "/characters/creation-catalog",
        headers={"Authorization": f"Bearer {token30}"},
    )
    if r.status_code != 200:
        fail(f"remembered session catalog expected 200, got {r.status_code} {r.text}")
    print("OK remembered session still valid")

    print("character_session_smoke: all checks passed")


if __name__ == "__main__":
    main()
