"""Character create/list ingest smoke — run from backend/ with TEST_DATABASE_URL: python scripts/character_ingest_smoke.py
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
IGN = "IngestSmoke"

ATTRS = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
]

# Spend exactly 12: three stats at +2 (3 each) = 9, three at +1 = 3 → 12
VALID_RANKS = {
    "strength": 2,
    "dexterity": 2,
    "constitution": 2,
    "intelligence": 1,
    "wisdom": 1,
    "charisma": 1,
}

CATALOG = {
    "stages": [
        {"id": "info", "type": "info", "order": 0, "messages": ["hi"]},
        {
            "id": "age_stage",
            "type": "info",
            "order": 1,
            "messages": ["Age verification"],
        },
        {
            "id": "creation_age_set_stage",
            "type": "setter",
            "target": "real_age",
            "order": 2,
        },
        {
            "id": "attributes_selection_stage",
            "type": "attributes",
            "order": 3,
            "points": 12,
            "max_rank": 2,
            "key": "attributes",
        },
        {
            "id": "personality_selection_stage",
            "type": "selection",
            "order": 4,
            "target": "trait",
            "key": "personality",
            "min_select": 0,
            "max_select": 1,
        },
    ],
    "attribute_point_buy": {
        "pool": 12,
        "max_rank": 2,
        "cost_for_rank": [1, 2],
        "attributes": ATTRS,
        "abbreviations": {
            "strength": "str",
            "dexterity": "dex",
            "constitution": "con",
            "intelligence": "int",
            "wisdom": "wis",
            "charisma": "cha",
        },
        "trait_id_pattern": "{abbr}{rank}",
    },
    "races": [
        {
            "id": "human",
            "name": "Human",
            "attribute_modifiers": [{"type": "charisma", "amount": 1}],
        }
    ],
    "classes": [{"id": "warrior", "name": "Warrior"}],
    "traits": [
        {
            "id": "str1",
            "key": "attributes",
            "attribute_modifiers": [{"type": "strength", "amount": 1}],
        },
        {
            "id": "str2",
            "key": "attributes",
            "attribute_modifiers": [{"type": "strength", "amount": 1}],
        },
        {"id": "dex1", "key": "attributes"},
        {"id": "dex2", "key": "attributes"},
        {"id": "con1", "key": "attributes"},
        {"id": "con2", "key": "attributes"},
        {"id": "int1", "key": "attributes"},
        {"id": "int2", "key": "attributes"},
        {"id": "wis1", "key": "attributes"},
        {"id": "wis2", "key": "attributes"},
        {"id": "cha1", "key": "attributes"},
        {"id": "cha2", "key": "attributes"},
        {
            "id": "kind",
            "name": "Kind",
            "key": "personality",
            "attribute_modifiers": [{"type": "wisdom", "amount": 1}],
        },
    ],
    "validation": {
        "name": {"min_length": 2, "max_length": 24},
        "age": {"minimum": 16},
        "description": {"min_length": 5, "max_length": 500},
        "clues": {
            "default_required": 1,
            "min_length": 3,
            "max_length": 100,
            "max_clues": 5,
        },
    },
    "slot_limits": {"hard_cap": 10, "defaults": {"max_alive_characters": 3}},
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
            "discord_username": "IngestSmokeDiscord",
        },
        headers={"X-Staff-Key": STAFF},
    )
    if r.status_code != 200:
        fail(f"link complete: {r.status_code} {r.text}")


def redeem_scope(client: TestClient, player: str, scope: str) -> str:
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player, "scope": scope},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"mint {scope}: {r.status_code} {r.text}")
    code = r.json()["code"]
    if scope == "profile":
        r = client.post("/skins/profile/redeem", json={"code": code})
    else:
        r = client.post("/skins/redeem", json={"code": code})
    if r.status_code != 200:
        fail(f"redeem {scope}: {r.status_code} {r.text}")
    return r.json()["session_token"]


def valid_body(**overrides):
    body = {
        "name": "Smoke Hero",
        "age": 20,
        "eighteen": True,
        "description": "A test character for ingest smoke.",
        "gender": "unspecified",
        "race_id": "human",
        "class_id": "warrior",
        "attributes": dict(VALID_RANKS),
        "traits": [],
        "clues": ["found a rusty key"],
    }
    body.update(overrides)
    return body


@isolated_smoke
def main() -> None:
    from server import app
    client = TestClient(app)
    player = f"00000000-0000-4000-8000-{uuid.uuid4().hex[:12]}"
    discord_id = str(700000000000000000 + (uuid.uuid4().int % 99999999999999))

    r = client.put(
        "/characters/plugin/creation-catalog",
        json=CATALOG,
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"catalog put: {r.status_code} {r.text}")

    ensure_linked(client, player, discord_id)
    token = redeem_scope(client, player, "profile")
    auth = {"Authorization": f"Bearer {token}"}

    bad = valid_body(attributes={a: 0 for a in ATTRS})
    r = client.post("/characters", json=bad, headers=auth)
    if r.status_code != 400:
        fail(f"bad attribute spend expected 400, got {r.status_code} {r.text}")
    print("OK invalid attribute spend -> 400")

    skin_token = redeem_scope(client, player, "skin")
    r = client.post(
        "/characters",
        json=valid_body(),
        headers={"Authorization": f"Bearer {skin_token}"},
    )
    if r.status_code != 401:
        fail(f"skin session create expected 401, got {r.status_code} {r.text}")
    print("OK skin session cannot POST /characters -> 401")

    req_id = str(uuid.uuid4())
    r = client.post(
        "/characters",
        json=valid_body(client_request_id=req_id, traits=["kind"]),
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"valid create: {r.status_code} {r.text}")
    create = r.json()
    create_id = create.get("id")
    if create.get("status") != "pending" or not create_id:
        fail(f"expected pending create: {create}")
    print(f"OK valid create -> pending id={create_id}")

    r = client.get("/characters", headers=auth)
    if r.status_code != 200:
        fail(f"list after create: {r.status_code} {r.text}")
    pending_row = next(
        (
            c
            for c in (r.json().get("characters") or [])
            if c.get("id") == create_id and str(c.get("status")).lower() == "pending"
        ),
        None,
    )
    if pending_row is None:
        fail(f"pending row missing from list: {r.json()}")
    attrs = pending_row.get("attributes") or {}
    if attrs.get("strength") != 2:
        fail(f"pending attributes.strength expected 2 (str1+str2), got {attrs}")
    if attrs.get("charisma") != 1:
        fail(f"pending attributes.charisma expected 1 (human), got {attrs}")
    traits = pending_row.get("traits") or []
    if not traits or traits[0].get("key") != "personality":
        fail(f"pending traits not enriched: {traits}")
    if pending_row.get("race_name") != "Human":
        fail(f"pending race_name: {pending_row.get('race_name')}")
    print("OK pending list row has enriched sheet fields")

    r = client.delete(f"/characters/creates/{create_id}", headers=auth)
    if r.status_code != 200 or r.json().get("deleted") != create_id:
        fail(f"delete pending create: {r.status_code} {r.text}")
    print("OK delete pending create -> 200")

    r = client.get("/characters", headers=auth)
    if r.status_code != 200:
        fail(f"list after delete: {r.status_code} {r.text}")
    if any(c.get("id") == create_id for c in (r.json().get("characters") or [])):
        fail(f"pending row still in list after delete: {r.json()}")
    print("OK pending row gone from list")

    r = client.delete(f"/characters/creates/{create_id}", headers=auth)
    if r.status_code != 404:
        fail(f"second delete expected 404, got {r.status_code} {r.text}")
    print("OK second delete -> 404")

    req_id = str(uuid.uuid4())
    r = client.post(
        "/characters",
        json=valid_body(client_request_id=req_id, traits=["kind"]),
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"recreate after delete: {r.status_code} {r.text}")
    create = r.json()
    create_id = create.get("id")
    if create.get("status") != "pending" or not create_id:
        fail(f"expected pending create after delete: {create}")
    print(f"OK recreated pending id={create_id}")

    r = client.post(
        "/characters",
        json=valid_body(client_request_id=req_id, name="Other Name"),
        headers=auth,
    )
    if r.status_code != 200 or r.json().get("id") != create_id:
        fail(f"idempotent retry expected same id: {r.status_code} {r.text}")
    print("OK client_request_id idempotent")

    r = client.get("/characters/plugin/pending", headers={"X-Plugin-Key": PLUGIN})
    if r.status_code != 200:
        fail(f"plugin pending: {r.status_code} {r.text}")
    pending = r.json().get("creates") or []
    if not any(c.get("id") == create_id for c in pending):
        fail(f"create not in pending: {pending}")
    print("OK plugin pending contains create")

    r = client.post(
        "/characters/plugin/applied",
        json={
            "results": [
                {"id": create_id, "ok": True, "character_id": create_id},
            ]
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200 or create_id not in (r.json().get("applied") or []):
        fail(f"applied ack: {r.status_code} {r.text}")
    print("OK plugin applied ack")

    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": player,
            "characters": [
                {
                    "id": create_id,
                    "name": "Smoke Hero",
                    "status": "ALIVE",
                    "race": "human",
                    "class": "warrior",
                    "created_at": "100",
                }
            ],
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"roster put: {r.status_code} {r.text}")

    r = client.get("/characters", headers=auth)
    if r.status_code != 200:
        fail(f"list: {r.status_code} {r.text}")
    listed = r.json()
    chars = listed.get("characters") or []
    if not any(c.get("id") == create_id and c.get("status") == "ALIVE" for c in chars):
        fail(f"list missing applied character: {chars}")
    # Without max_alive on roster, list falls back to catalog default (3)
    if listed.get("max_alive_characters") != 3:
        fail(
            f"list max_alive expected catalog default 3, got {listed.get('max_alive_characters')}"
        )
    print("OK list shows applied roster character")

    # Per-player entitlement from TFMCWeb (LP max while online)
    r = client.put(
        "/characters/plugin/rpc-player-meta",
        json={"player_uuid": player, "max_alive_characters": 5},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"entitlements put with max: {r.status_code} {r.text}")
    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": player,
            "characters": [
                {
                    "id": create_id,
                    "name": "Smoke Hero",
                    "status": "ALIVE",
                    "race": "human",
                    "class": "warrior",
                    "created_at": "100",
                }
            ],
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"roster put with max: {r.status_code} {r.text}")

    r = client.get("/characters", headers=auth)
    if r.status_code != 200:
        fail(f"list after max: {r.status_code} {r.text}")
    listed = r.json()
    if listed.get("max_alive_characters") != 5:
        fail(f"list max_alive expected 5, got {listed.get('max_alive_characters')}")
    print("OK entitlement max_alive_characters=5 -> list returns 5")

    # Fill soft slot limit using player entitlement (5 alive)
    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": player,
            "characters": [
                {
                    "id": f"slot-{i}",
                    "name": f"Slot {i}",
                    "status": "ALIVE",
                    "race": "human",
                    "class": "warrior",
                }
                for i in range(5)
            ],
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"full roster put: {r.status_code} {r.text}")

    r = client.post("/characters", json=valid_body(), headers=auth)
    if r.status_code != 400 or "slot" not in r.text.lower():
        fail(f"over slot expected 400 slot, got {r.status_code} {r.text}")
    print("OK over soft slot limit (5) -> 400")

    # A later roster push leaves TFMCWeb's entitlement alone
    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": player,
            "characters": [
                {
                    "id": "slot-0",
                    "name": "Slot 0",
                    "status": "ALIVE",
                    "race": "human",
                    "class": "warrior",
                }
            ],
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"roster omit max: {r.status_code} {r.text}")
    r = client.get("/characters", headers=auth)
    if r.status_code != 200 or r.json().get("max_alive_characters") != 5:
        fail(f"omit max should keep 5: {r.status_code} {r.text}")
    print("OK roster push keeps the TFMCWeb entitlement")

    # Clear alive slots so create soft-check passes again
    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": player,
            "characters": [],
            "real_age_set": False,
            "eighteen": False,
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"roster clear age: {r.status_code} {r.text}")

    # Require eighteen when catalog has real_age stage and not yet set
    no_age = valid_body()
    no_age.pop("eighteen", None)
    r = client.post("/characters", json=no_age, headers=auth)
    if r.status_code != 400 or "eighteen" not in r.text.lower():
        fail(f"missing eighteen expected 400, got {r.status_code} {r.text}")
    print("OK create without eighteen -> 400")

    r = client.post("/characters", json=valid_body(eighteen=True), headers=auth)
    if r.status_code != 200:
        fail(f"create with eighteen: {r.status_code} {r.text}")
    print("OK create with eighteen")

    r = client.get("/characters", headers=auth)
    if r.status_code != 200:
        fail(f"list after age: {r.status_code} {r.text}")
    listed = r.json()
    if not listed.get("real_age_set"):
        fail(f"expected real_age_set after create: {listed}")
    if listed.get("eighteen") is not True:
        fail(f"expected eighteen true: {listed}")
    print("OK list returns real_age_set + eighteen")

    # Subsequent create may omit eighteen once attested
    r = client.put(
        "/characters/plugin/roster",
        json={"player_uuid": player, "characters": []},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"roster clear for second create: {r.status_code} {r.text}")
    omit = valid_body(name="Smoke Two", client_request_id=str(uuid.uuid4()))
    omit.pop("eighteen", None)
    r = client.post("/characters", json=omit, headers=auth)
    if r.status_code != 200:
        fail(f"create omit eighteen after set: {r.status_code} {r.text}")
    print("OK create omits eighteen after real_age_set")

    # Roster sync from plugin can set attestation without create
    other = f"00000000-0000-4000-8000-{uuid.uuid4().hex[:12]}"
    other_discord = str(700000000000000000 + (uuid.uuid4().int % 99999999999999))
    ensure_linked(client, other, other_discord)
    other_token = redeem_scope(client, other, "profile")
    other_auth = {"Authorization": f"Bearer {other_token}"}
    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": other,
            "characters": [],
            "real_age_set": True,
            "eighteen": False,
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"roster age sync: {r.status_code} {r.text}")
    r = client.get("/characters", headers=other_auth)
    if r.status_code != 200:
        fail(f"other list: {r.status_code} {r.text}")
    listed = r.json()
    if not listed.get("real_age_set") or listed.get("eighteen") is not False:
        fail(f"roster age sync list: {listed}")
    print("OK roster push real_age_set + eighteen=false")

    # 22.01 — sheet fields on roster → GET /characters flatten
    sheet_char = {
        "id": "sheet-smoke-1",
        "name": "Sheet Hero",
        "status": "ALIVE",
        "race": "human",
        "class": "warrior",
        "created_at": "200",
        "race_name": "Human",
        "class_name": "Warrior",
        "age": "24",
        "birthday": "1203-04-15",
        "gender": "female",
        "description": "A quiet scout from the borderlands.",
        "background": "Born under a red moon.\nTrained among border scouts.",
        "attributes": {"strength": 2, "dexterity": 3, "constitution": 1, "intelligence": 0},
        "experience_modifiers": [
            {"profession": "miner", "alias": "Miner Experience", "amount": -10},
            {"profession": "forester", "alias": "Forester Experience", "amount": 5},
        ],
        "traits": [
            {"id": "cheerful", "name": "Cheerful", "key": "personality"},
            {"id": "cruel", "name": "Cruel", "key": "evil"},
        ],
        "clues": ["Saw a red banner at dusk", "Heard wolves near the mill"],
    }
    r = client.put(
        "/characters/plugin/roster",
        json={"player_uuid": player, "characters": [sheet_char]},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"sheet roster put: {r.status_code} {r.text}")
    r = client.get("/characters", headers=auth)
    if r.status_code != 200:
        fail(f"sheet list: {r.status_code} {r.text}")
    sheet_row = next(
        (c for c in (r.json().get("characters") or []) if c.get("id") == "sheet-smoke-1"),
        None,
    )
    if not sheet_row:
        fail(f"sheet list missing character: {r.json()}")
    if sheet_row.get("race_name") != "Human":
        fail(f"race_name: {sheet_row.get('race_name')}")
    if sheet_row.get("description") != sheet_char["description"]:
        fail(f"description: {sheet_row.get('description')}")
    if sheet_row.get("background") != sheet_char["background"]:
        fail(f"background: {sheet_row.get('background')}")
    if sheet_row.get("attributes") != sheet_char["attributes"]:
        fail(f"attributes: {sheet_row.get('attributes')}")
    if sheet_row.get("experience_modifiers") != sheet_char["experience_modifiers"]:
        fail(f"experience_modifiers: {sheet_row.get('experience_modifiers')}")
    if not isinstance(sheet_row.get("traits"), list) or len(sheet_row["traits"]) != 2:
        fail(f"traits: {sheet_row.get('traits')}")
    if sheet_row.get("clues") != sheet_char["clues"]:
        fail(f"clues: {sheet_row.get('clues')}")
    print("OK roster sheet fields flatten onto GET /characters")

    print("character_ingest_smoke: all checks passed")


if __name__ == "__main__":
    main()
