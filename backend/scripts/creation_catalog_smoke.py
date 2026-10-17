"""Creation catalog E2E smoke — run from backend/ with TEST_DATABASE_URL: python scripts/creation_catalog_smoke.py

PUT fixture → GET 401 without session → redeem character code → GET 200 with formula.
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

from smoke_support import isolated_smoke

PLUGIN = "dev-plugin-key"
STAFF = "dev-staff-key"
IGN = "CatalogSmoke"

FIXTURE = {
    "stages": [
        {"id": "info_welcome", "type": "info", "order": 0, "messages": ["Welcome"]},
        {
            "id": "attributes_selection_stage",
            "type": "attributes",
            "order": 1,
            "points": 12,
            "max_rank": 2,
            "key": "attributes",
        },
    ],
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
        "abbreviations": {
            "strength": "str",
            "dexterity": "dex",
            "constitution": "con",
            "intelligence": "int",
            "wisdom": "wis",
            "charisma": "cha",
        },
    },
    "races": [{"id": "human", "name": "Human", "key": "race"}],
    "traits": [{"id": "str1", "name": "Strength +1", "key": "attributes", "cost": 0}],
    "classes": [{"id": "warrior", "name": "Warrior", "display_order": 1}],
    "validation": {"name_max": 24, "age_min": 16},
    "slot_limits": {"hard_cap": 10, "default": 1},
    "editable_kit": [
        {
            "kit_key": "iron_hunting_knife",
            "path": "m.tools.IRON_HUNTING_KNIFE",
            "amount": 1,
            "skin_png": "knife_skin",
            "base_set": "knives",
            "preview": {
                "display_name": "Iron Hunting Knife",
                "lore": ["A starter blade."],
                "material": "IRON_SWORD",
                "custom_model_data": 1001,
            },
        }
    ],
}


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def ensure_linked(client: TestClient, player: str, discord_id: str) -> None:
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
    r = client.post(
        "/skins/discord/link/complete",
        json={
            "code": body["code"],
            "discord_user_id": discord_id,
            "discord_username": "CatalogSmokeDiscord",
        },
        headers={"X-Staff-Key": STAFF},
    )
    if r.status_code != 200:
        fail(f"link complete: {r.status_code} {r.text}")


def redeem_character_session(client: TestClient, player: str) -> str:
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player, "scope": "profile"},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"mint character: {r.status_code} {r.text}")
    code = r.json()["code"]
    r = client.post("/skins/profile/redeem", json={"code": code})
    if r.status_code != 200:
        fail(f"redeem character: {r.status_code} {r.text}")
    token = r.json().get("session_token")
    if not token:
        fail(f"redeem missing session_token: {r.json()}")
    return token


@isolated_smoke
def main() -> None:
    from server import app
    client = TestClient(app)
    player = f"00000000-0000-4000-8000-{uuid.uuid4().hex[:12]}"

    r = client.put(
        "/characters/plugin/creation-catalog",
        json=FIXTURE,
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"PUT expected 200, got {r.status_code} {r.text}")
    body = r.json()
    if not body.get("ok"):
        fail(f"PUT expected ok: {body}")
    if body.get("stages") != 2:
        fail(f"PUT stages_count expected 2, got {body}")
    if not body.get("updated_at"):
        fail(f"PUT missing updated_at: {body}")
    print(f"OK PUT catalog updated_at={body['updated_at']}")

    r = client.get("/characters/creation-catalog")
    if r.status_code != 401:
        fail(f"GET without auth expected 401, got {r.status_code} {r.text}")
    print("OK GET without auth -> 401")

    r = client.get(
        "/characters/creation-catalog",
        headers={"Authorization": "Bearer not-a-real-session"},
    )
    if r.status_code != 401:
        fail(f"GET bad bearer expected 401, got {r.status_code} {r.text}")
    print("OK GET bad bearer -> 401")

    ensure_linked(client, player, discord_id=f"9{uuid.uuid4().int % 10**17:017d}")
    token = redeem_character_session(client, player)
    r = client.get(
        "/characters/creation-catalog",
        headers={"Authorization": f"Bearer {token}"},
    )
    if r.status_code != 200:
        fail(f"GET with character session expected 200, got {r.status_code} {r.text}")
    catalog = r.json()
    apb = catalog.get("attribute_point_buy") or {}
    if apb.get("pool") != 12 or apb.get("max_rank") != 2:
        fail(f"attribute_point_buy pool/max_rank mismatch: {apb}")
    if apb.get("cost_for_rank") != [1, 2]:
        fail(f"cost_for_rank expected [1,2], got {apb.get('cost_for_rank')}")
    if len(catalog.get("stages") or []) < 1:
        fail(f"stages empty: {catalog}")
    if catalog.get("updated_at") is None:
        fail("updated_at is null after sync")
    editable = catalog.get("editable_kit") or []
    if not isinstance(editable, list) or len(editable) != 1:
        fail(f"editable_kit expected 1 row, got: {editable}")
    knife = editable[0]
    if knife.get("kit_key") != "iron_hunting_knife":
        fail(f"kit_key mismatch: {knife}")
    if knife.get("base_set") != "knives" or knife.get("skin_png") != "knife_skin":
        fail(f"base_set/skin_png mismatch: {knife}")
    if "category" in knife:
        fail(f"editable_kit must not include category: {knife}")
    preview = knife.get("preview") or {}
    if preview.get("display_name") != "Iron Hunting Knife":
        fail(f"preview.display_name mismatch: {preview}")
    print(
        "OK GET with character session -> 200 "
        f"(stages={len(catalog['stages'])} pool={apb['pool']} formula={[1, 2]} "
        f"editable_kit={len(editable)})"
    )
    print("creation_catalog_smoke: all checks passed")


if __name__ == "__main__":
    main()
