"""Lore-item API smoke — run from backend/ with TEST_DATABASE_URL: python scripts/lore_items_smoke.py

Catalog + roster kit claimable → character session → list/customise + PNG bridge.
Granted → 403; pending-create UUID is a valid customise target before server ack.
"""

from __future__ import annotations

import json
import os
import struct
import sys
import uuid
import zlib
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

os.environ.setdefault("SKINS_DEV", "1")

from fastapi.testclient import TestClient

from smoke_support import isolated_smoke
from src.database import connect
from psycopg.types.json import Jsonb

PLUGIN = "dev-plugin-key"
STAFF = "dev-staff-key"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

CATALOG = {
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
            "kit_id": "starter",
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
    "kits": [
        {
            "id": "starter",
            "display_name": "Starter",
            "cooldown_hours": 48,
            "once_per_character": True,
            "items": [
                {
                    "path": "m.tools.IRON_HUNTING_KNIFE",
                    "amount": 1,
                    "editable": True,
                },
                {"path": "m.currency.GOLD_COIN", "amount": 32},
            ],
        }
    ],
}


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def make_png(w: int, h: int, fill: int = 160) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    pixel = bytes([fill & 0xFF]) * (w * 3)
    raw = b"".join(b"\x00" + pixel for _ in range(h))
    return (
        PNG_MAGIC
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def ensure_linked(client: TestClient, player: str, ign: str, discord_id: str) -> None:
    r = client.post(
        "/skins/discord/link/start",
        json={"player_uuid": player, "minecraft_name": ign},
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
            "discord_username": "LoreSmokeDiscord",
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


def redeem_skin_session(client: TestClient, player: str) -> str:
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player, "scope": "skin"},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"mint skin: {r.status_code} {r.text}")
    code = r.json()["code"]
    r = client.post("/skins/redeem", json={"code": code})
    if r.status_code != 200:
        fail(f"redeem skin: {r.status_code} {r.text}")
    token = r.json().get("session_token")
    if not token:
        fail(f"skin redeem missing session_token: {r.json()}")
    return token


@isolated_smoke
def main() -> None:
    from server import app
    from src.skins.db import SKINS_DIR

    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    player = f"00000000-0000-4000-8000-{uuid.uuid4().hex[:12]}"
    char_id = f"lore_smoke_{suffix}"
    ign = f"LoreSm{suffix[:6]}"
    discord_id = f"8{uuid.uuid4().int % 10**17:017d}"

    meta = client.put(
        "/characters/plugin/rpc-player-meta",
        json={"player_uuid": player, "skin_kinds": ["handheld", "armor_set", "misc"],
              "allow_armor_3d_helmet": True, "name_colour_stops": 8,
              "max_3d_pair_bytes": 1048576},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if meta.status_code != 200:
        fail(f"PUT upload entitlements: {meta.status_code} {meta.text}")

    r = client.put(
        "/characters/plugin/creation-catalog",
        json=CATALOG,
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"PUT catalog: {r.status_code} {r.text}")
    print("OK PUT creation catalog with editable_kit")

    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": player,
            "characters": [
                {
                    "id": char_id,
                    "name": "Lore Smoke",
                    "status": "ALIVE",
                    "kit_status": "eligible",
                }
            ],
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"PUT roster: {r.status_code} {r.text}")
    print("OK PUT roster kit_status=eligible")

    r = client.get(f"/characters/lore-items?character_id={char_id}")
    if r.status_code != 401:
        fail(f"GET without auth expected 401, got {r.status_code} {r.text}")
    print("OK GET lore-items without auth -> 401")

    ensure_linked(client, player, ign, discord_id)
    skin_token = redeem_skin_session(client, player)
    r = client.get(
        f"/characters/lore-items?character_id={char_id}",
        headers={"Authorization": f"Bearer {skin_token}"},
    )
    if r.status_code != 401:
        fail(f"GET with skin scope expected 401, got {r.status_code} {r.text}")
    print("OK GET lore-items with skin scope -> 401")

    token = redeem_character_session(client, player)
    auth = {"Authorization": f"Bearer {token}"}
    skin_auth = {
        **auth,
        "X-Skin-Session": f"Bearer {skin_token}",
    }

    r = client.get(
        f"/characters/lore-items?character_id={char_id}",
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"GET lore-items expected 200, got {r.status_code} {r.text}")
    body = r.json()
    items = body.get("items") or []
    if len(items) != 1:
        fail(f"expected 1 editable item, got: {body}")
    knife = items[0]
    if knife.get("kit_key") != "iron_hunting_knife":
        fail(f"kit_key mismatch: {knife}")
    if knife.get("base_set") != "knives" or knife.get("skin_png") != "knife_skin":
        fail(f"base_set/skin_png mismatch: {knife}")
    if "category" in knife:
        fail(f"must not include category: {knife}")
    print("OK GET lore-items -> knife editable")

    r = client.get(
        "/characters/lore-items?character_id=missing_char",
        headers=auth,
    )
    if r.status_code != 403:
        fail(f"missing character expected 403, got {r.status_code} {r.text}")
    print("OK GET missing character -> 403")

    # Historical ineligible is still claimable for customise
    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": player,
            "characters": [
                {
                    "id": char_id,
                    "name": "Lore Smoke",
                    "status": "ALIVE",
                    "kit_status": "ineligible",
                }
            ],
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"PUT roster ineligible: {r.status_code} {r.text}")
    r = client.get(
        f"/characters/lore-items?character_id={char_id}",
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"ineligible kit expected 200, got {r.status_code} {r.text}")
    print("OK GET kit_status=ineligible -> 200 (claimable)")

    # Granted blocks customise
    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": player,
            "characters": [
                {
                    "id": char_id,
                    "name": "Lore Smoke",
                    "status": "ALIVE",
                    "kit_status": "granted",
                }
            ],
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"PUT roster granted: {r.status_code} {r.text}")
    r = client.get(
        f"/characters/lore-items?character_id={char_id}",
        headers=auth,
    )
    if r.status_code != 403:
        fail(f"granted kit expected 403, got {r.status_code} {r.text}")
    print("OK GET kit_status=granted -> 403")

    r = client.delete(
        f"/characters/lore-items/iron_hunting_knife/customise"
        f"?character_id={char_id}&kit_id=starter",
        headers=auth,
    )
    if r.status_code != 403:
        fail(f"DELETE on granted kit expected 403, got {r.status_code} {r.text}")
    print("OK DELETE kit_status=granted -> 403")

    r = client.put(
        "/characters/plugin/roster",
        json={
            "player_uuid": player,
            "characters": [
                {
                    "id": char_id,
                    "name": "Lore Smoke",
                    "status": "ALIVE",
                    "kit_status": "eligible",
                }
            ],
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"PUT roster re-eligible: {r.status_code} {r.text}")

    # Pending create UUID is a valid customise target before server ack
    create_id = f"create_{suffix}"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO character_creation_requests (
                id, player_uuid, client_request_id, payload, status,
                character_id, error, created_at, applied_at
            ) VALUES (%s, %s, %s, %s, 'pending', NULL, NULL, %s, NULL)
            """,
            (
                create_id,
                player,
                str(uuid.uuid4()),
                Jsonb({"name": "Create Knife"}),
                "2026-01-01T00:00:00Z",
            ),
        )
    r = client.get(
        f"/characters/lore-items?character_id={create_id}",
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"GET lore-items for pending create expected 200, got {r.status_code} {r.text}")
    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={create_id}&kit_id=starter",
        json={"display_name": "Create Blade", "lore": ["From create."]},
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"POST customise on pending create expected 200, got {r.status_code} {r.text}")
    r = client.get(
        f"/characters/kits?character_id={create_id}",
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"GET kits for pending create expected 200, got {r.status_code} {r.text}")
    kits_body = r.json()
    starter = next(
        (k for k in (kits_body.get("kits") or []) if k.get("id") == "starter"),
        None,
    )
    if not starter or starter.get("status") != "eligible":
        fail(f"pending create starter kit not eligible: {starter}")
    print("OK pending-create customise and kits")

    r = client.get(
        f"/characters/kits?character_id={char_id}",
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"GET kits expected 200, got {r.status_code} {r.text}")
    kits_body = r.json()
    kits = kits_body.get("kits") or []
    if len(kits) != 1 or kits[0].get("id") != "starter":
        fail(f"expected starter kit in list: {kits_body}")
    if not kits[0].get("claimable"):
        fail(f"starter should be claimable: {kits[0]}")
    items = kits[0].get("items") or []
    if len(items) < 2:
        fail(f"expected all kit items, got: {items}")
    editable_items = [i for i in items if i.get("editable")]
    if len(editable_items) != 1 or editable_items[0].get("kit_key") != "iron_hunting_knife":
        fail(f"editable knife missing: {items}")
    print("OK GET /characters/kits")

    r = client.get(
        f"/characters/plugin/lore-items/claim-status?player_uuid={player}&character_id={char_id}",
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"claim-status expected 200, got {r.status_code} {r.text}")
    status_body = r.json()
    if status_body.get("pending_skin") is not False:
        fail(f"expected pending_skin false initially: {status_body}")
    if status_body.get("pending_pack") is not False:
        fail(f"expected pending_pack false initially: {status_body}")
    print("OK GET plugin lore-items claim-status")

    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        json={
            "display_name": "Trailblade §cHack",
            "lore": ["A custom line."],
        },
        headers=auth,
    )
    if r.status_code != 400:
        fail(f"bad charset expected 400, got {r.status_code} {r.text}")
    print("OK POST bad charset -> 400")

    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        json={
            "display_name": "Trailblade",
            "lore": ["A custom line."],
        },
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"POST name+lore expected 200, got {r.status_code} {r.text}")
    customise = r.json()
    if not customise.get("ok"):
        fail(f"customise missing ok: {customise}")
    preview = customise.get("preview") or {}
    if preview.get("display_name") != "Trailblade":
        fail(f"preview name overlay failed: {preview}")
    lore = preview.get("lore") or []
    if "A starter blade." not in lore and not any(
        "A starter blade." in str(x) for x in lore
    ):
        fail(f"preview lore merge failed (base): {lore}")
    if not any("A custom line." in str(x) for x in lore):
        fail(f"preview lore merge failed (custom): {lore}")
    draft = customise.get("draft") or {}
    if draft.get("display_name") != "Trailblade":
        fail(f"draft not stored: {draft}")
    print("OK POST name+lore stores + overlays preview")

    # Player delete one kit-item customise (keeps skins; idempotent)
    r = client.delete(
        f"/characters/lore-items/iron_hunting_knife/customise"
        f"?character_id={char_id}&kit_id=starter",
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"DELETE customise expected 200, got {r.status_code} {r.text}")
    deleted_body = r.json()
    if not deleted_body.get("ok") or int(deleted_body.get("deleted") or 0) < 1:
        fail(f"DELETE expected deleted>=1: {deleted_body}")
    with connect() as conn:
        row = conn.execute(
            """
            SELECT 1 FROM lore_item_customisations
            WHERE player_uuid = %s AND character_id = %s AND kit_key = %s
            """,
            (player, char_id, "iron_hunting_knife"),
        ).fetchone()
    if row is not None:
        fail("DELETE should remove lore_item_customisations row")
    r = client.get(
        f"/characters/lore-items?character_id={char_id}&kit_id=starter",
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"list after DELETE: {r.status_code} {r.text}")
    knife = next(
        (
            i
            for i in (r.json().get("items") or [])
            if i.get("kit_key") == "iron_hunting_knife"
        ),
        None,
    )
    if not knife:
        fail(f"knife missing after DELETE: {r.json()}")
    d = knife.get("draft") or {}
    if d.get("display_name") or d.get("state") not in (None, "", "draft"):
        # empty draft or default draft-only is fine; custom name must be gone
        if str(d.get("display_name") or "").strip() == "Trailblade":
            fail(f"draft should be cleared after DELETE: {d}")
    r = client.delete(
        f"/characters/lore-items/iron_hunting_knife/customise"
        f"?character_id={char_id}&kit_id=starter",
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"idempotent DELETE expected 200, got {r.status_code} {r.text}")
    if r.json().get("deleted") != 0:
        fail(f"idempotent DELETE expected deleted=0: {r.json()}")
    print("OK DELETE customise wipes row; second DELETE deleted=0")

    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        json={
            "display_name": "Trailblade",
            "lore": ["A custom line."],
        },
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"re-POST name+lore after DELETE expected 200, got {r.status_code} {r.text}")

    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        data={
            "display_name": "Trailblade",
            "lore": json.dumps(["A custom line."]),
        },
        files={"texture": ("bad.png", b"not-a-png", "image/png")},
        headers=auth,
    )
    if r.status_code != 400:
        fail(f"invalid PNG with profile auth expected 400, got {r.status_code} {r.text}")
    print("OK POST invalid PNG with profile auth -> 400")

    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        data={
            "display_name": "Trailblade",
            "lore": json.dumps(["A custom line."]),
        },
        files={"texture": ("bad.png", b"not-a-png", "image/png")},
        headers=skin_auth,
    )
    if r.status_code != 400:
        fail(f"invalid PNG expected 400, got {r.status_code} {r.text}")
    print("OK POST invalid PNG (optional skin header ignored) -> 400")

    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        data={
            "display_name": "Trailblade Skin",
            "lore": json.dumps(["A custom line."]),
        },
        files={"texture": ("knife.png", make_png(32, 32), "image/png")},
        headers=auth,
    )
    if r.status_code != 400:
        fail(f"oversized PNG expected 400, got {r.status_code} {r.text}")
    print("OK POST oversized PNG -> 400")

    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        data={
            "display_name": f"Trail Knife {suffix}",
            "lore": json.dumps(["Forged on the road."]),
        },
        files={"texture": ("knife.png", make_png(16, 16, fill=90), "image/png")},
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"POST valid PNG expected 200, got {r.status_code} {r.text}")
    uploaded = r.json()
    draft = uploaded.get("draft") or {}
    sub_id = draft.get("submission_id")
    if not sub_id:
        fail(f"expected submission_id after PNG upload: {uploaded}")
    if draft.get("submission_status") != "pending":
        fail(f"expected pending submission: {draft}")
    if draft.get("existing_skin_id") is not None:
        fail(f"existing_skin_id should clear on upload: {draft}")

    with connect() as conn:
        row = conn.execute(
            "SELECT base_set, staff, status, kind FROM skin_submissions WHERE id = %s",
            (sub_id,),
        ).fetchone()
    if row is None:
        fail(f"submission row missing for {sub_id}")
    if str(row["base_set"] or "") != "knives":
        fail(f"submission base_set expected knives, got {row['base_set']}")
    if int(row["staff"] or 0) != 0:
        fail(f"submission must not be staff: {dict(row)}")
    if str(row["status"]) != "pending":
        fail(f"submission status expected pending: {dict(row)}")
    if str(row["kind"]) != "handheld":
        fail(f"submission kind expected handheld: {dict(row)}")
    from src.skins.codes import ensure_lore_upload_code, get_session

    profile_sess = get_session(token)
    skin_sess = get_session(skin_token)
    if profile_sess is None or skin_sess is None:
        fail("expected profile and skin sessions")
    lore_code_id = ensure_lore_upload_code(player, "main")
    with connect() as conn:
        sub_row = conn.execute(
            "SELECT code_id FROM skin_submissions WHERE id = %s",
            (sub_id,),
        ).fetchone()
    if sub_row is None:
        fail(f"submission code_id missing for {sub_id}")
    if int(sub_row["code_id"]) != int(lore_code_id):
        fail(
            f"submission code_id must be lore upload slot "
            f"(got {sub_row['code_id']}, lore {lore_code_id})"
        )
    if int(sub_row["code_id"]) == int(profile_sess["code_id"]):
        fail("submission must not use profile session code_id")
    if int(sub_row["code_id"]) == int(skin_sess["code_id"]):
        fail("submission must not use skin mint code_id")
    with connect() as conn:
        lore_row = conn.execute(
            """
            SELECT state, submission_id FROM lore_item_customisations
            WHERE player_uuid = %s AND character_id = %s AND kit_key = %s
            """,
            (player, char_id, "iron_hunting_knife"),
        ).fetchone()
    if lore_row is None or str(lore_row["state"]) != "pending_skin":
        fail(f"expected pending_skin state after upload: {lore_row}")
    print(
        f"OK POST valid 16x16 PNG -> pending handheld knives submission id={sub_id}"
    )

    # Name/lore while skin still pending keeps pending_skin
    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        json={
            "display_name": "Ready Blade",
            "lore": ["Line one."],
        },
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"POST name+lore while pending expected 200, got {r.status_code} {r.text}")
    body = r.json()
    if body.get("state") != "pending_skin":
        fail(f"expected pending_skin while submission pending: {body}")
    print("OK POST name+lore while upload pending -> stays pending_skin")

    # Skin deny → purge submission; customise denied; name/lore kept; not claim-ready
    from src.skins.submissions import deny_submission

    denied = deny_submission(str(sub_id), "Needs a cleaner silhouette")
    if denied.get("status") != "denied":
        fail(f"deny_submission expected denied: {denied}")
    if "cleaner silhouette" not in str(denied.get("deny_reason") or ""):
        fail(f"deny response should include reason: {denied}")
    with connect() as conn:
        gone = conn.execute(
            "SELECT 1 FROM skin_submissions WHERE id = %s",
            (sub_id,),
        ).fetchone()
        lore_denied = conn.execute(
            """
            SELECT state, submission_id, display_name, lore,
                   ready_at, existing_skin_id, skin_slug, deny_reason
            FROM lore_item_customisations
            WHERE player_uuid = %s AND character_id = %s AND kit_key = %s
            """,
            (player, char_id, "iron_hunting_knife"),
        ).fetchone()
    if gone is not None:
        fail(f"deny should purge submissions row: {sub_id}")
    if lore_denied is None or str(lore_denied["state"]) != "denied":
        fail(f"expected denied customise state: {lore_denied}")
    if str(lore_denied["submission_id"] or "") != str(sub_id):
        fail(f"deny should keep submission_id: {lore_denied}")
    if str(lore_denied["display_name"] or "") != "Ready Blade":
        fail(f"deny should keep display_name: {lore_denied}")
    if "cleaner silhouette" not in str(lore_denied["deny_reason"] or ""):
        fail(f"deny should store deny_reason on lore row: {lore_denied}")
    if lore_denied["ready_at"] is not None:
        fail(f"deny should clear ready_at: {lore_denied}")
    if lore_denied["existing_skin_id"] is not None or lore_denied["skin_slug"] is not None:
        fail(f"deny should clear skin refs: {lore_denied}")
    r = client.get(
        f"/characters/plugin/lore-items/claim-status"
        f"?player_uuid={player}&character_id={char_id}&kit_id=starter",
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"claim-status after deny: {r.status_code} {r.text}")
    claim = r.json()
    if claim.get("pending_skin") or claim.get("pending_pack") or claim.get("ready"):
        fail(f"denied customise must not be pending/ready: {claim}")
    r = client.get(
        f"/characters/lore-items?character_id={char_id}&kit_id=starter",
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"list after deny: {r.status_code} {r.text}")
    knife = next(
        (
            i
            for i in (r.json().get("items") or [])
            if i.get("kit_key") == "iron_hunting_knife"
        ),
        None,
    )
    if not knife:
        fail(f"knife missing after deny: {r.json()}")
    d = knife.get("draft") or {}
    if d.get("state") != "denied" or d.get("submission_status") != "denied":
        fail(f"draft should show denied: {d}")
    if "cleaner silhouette" not in str(d.get("deny_reason") or ""):
        fail(f"expected deny_reason on draft: {d}")
    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        json={"display_name": "Ready Blade", "lore": ["Line one."]},
        headers=auth,
    )
    if r.status_code != 400:
        fail(f"denied resubmit without new skin expected 400, got {r.status_code} {r.text}")
    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        data={
            "display_name": "Ready Blade",
            "lore": json.dumps(["Line one."]),
        },
        files={"texture": ("knife.png", make_png(16, 16, fill=120), "image/png")},
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"denied resubmit with profile upload expected 200, got {r.status_code} {r.text}")
    retry_sub = (r.json().get("draft") or {}).get("submission_id")
    if not retry_sub:
        fail(f"expected submission_id after denied resubmit: {r.json()}")
    print(
        "OK deny skin -> purged; customise denied; name/lore kept; "
        "profile-only resubmit works"
    )

    # Clear denied row to exercise ready-without-skin path
    with connect() as conn:
        conn.execute(
            """
            UPDATE lore_item_customisations
            SET submission_id = NULL, state = 'draft', skin_slug = NULL,
                existing_skin_id = NULL, ready_at = NULL, deny_reason = NULL
            WHERE player_uuid = %s AND character_id = %s AND kit_key = %s
            """,
            (player, char_id, "iron_hunting_knife"),
        )

    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        json={
            "display_name": "Ready Blade",
            "lore": ["Line one."],
        },
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"POST name+lore ready expected 200, got {r.status_code} {r.text}")
    body = r.json()
    if body.get("state") != "ready":
        fail(f"expected state=ready after name/lore: {body}")
    print("OK POST name+lore -> state=ready")

    r = client.get(
        "/characters/plugin/lore-items/pending",
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"plugin pending lore expected 200, got {r.status_code} {r.text}")
    pending_items = r.json().get("items") or []
    match = [
        i
        for i in pending_items
        if i.get("character_id") == char_id
        and i.get("kit_key") == "iron_hunting_knife"
    ]
    if not match:
        fail(f"plugin pending missing ready row: {pending_items}")
    print("OK GET plugin lore-items pending includes ready row")

    # Existing applied skin → ready with skin_slug
    applied_id = f"{ign.lower()}_applied_knife_{suffix}"
    now = "2026-01-01T00:00:00Z"
    with connect() as conn:
        code_row = conn.execute(
            "SELECT id FROM login_codes WHERE player_uuid = %s ORDER BY id DESC LIMIT 1",
            (player,),
        ).fetchone()
        if code_row is None:
            fail("no codes row for smoke player")
        code_id = int(code_row["id"])
        conn.execute(
            """
            INSERT INTO skin_submissions (
                id, player_uuid, code_id, kind, slug, display_name,
                base_set, status, dir_path, created_at, applied_at, staff
            ) VALUES (%s, %s, %s, 'handheld', %s, 'Applied Knife', 'knives',
                      'applied', %s, %s, %s, false)
            """,
            (
                applied_id,
                player,
                code_id,
                applied_id,
                f"skins/{applied_id}",
                now,
                now,
            ),
        )

    applied_dir = SKINS_DIR / applied_id
    applied_dir.mkdir()
    (applied_dir / f"{applied_id}.png").write_bytes(make_png(16, 16, fill=140))

    r = client.post(
        f"/characters/lore-items/iron_hunting_knife/customise?character_id={char_id}",
        json={
            "display_name": "Picked Blade",
            "lore": ["Picked lore."],
            "existing_skin_id": applied_id,
        },
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"POST existing skin expected 200, got {r.status_code} {r.text}")
    picked = r.json()
    if picked.get("state") != "ready":
        fail(f"pick existing expected ready: {picked}")
    if picked.get("skin_slug") != applied_id:
        fail(f"skin_slug mismatch: {picked}")
    print("OK POST existing applied skin -> ready + skin_slug")

    # mark_applied promotion path: pending_skin -> ready
    with connect() as conn:
        conn.execute(
            """
            UPDATE lore_item_customisations
            SET state = 'pending_skin', submission_id = %s, skin_slug = NULL,
                existing_skin_id = NULL, ready_at = NULL
            WHERE player_uuid = %s AND character_id = %s AND kit_key = %s
            """,
            (retry_sub, player, char_id, "iron_hunting_knife"),
        )
        conn.execute(
            """
            UPDATE skin_submissions
            SET status = 'approved', applied_at = NULL, reviewed_at = %s
            WHERE id = %s
            """,
            (now, retry_sub),
        )

    r = client.get(
        f"/characters/plugin/lore-items/claim-status"
        f"?player_uuid={player}&character_id={char_id}&kit_id=starter",
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"claim-status after approve: {r.status_code} {r.text}")
    claim_approved = r.json()
    if claim_approved.get("pending_skin") is not False:
        fail(
            "approved-not-applied should not set pending_skin "
            f"(staff approval done): {claim_approved}"
        )
    if claim_approved.get("pending_pack") is not True:
        fail(
            "approved-not-applied should set pending_pack=true: "
            f"{claim_approved}"
        )
    print("OK claim-status pending_pack=true while submission approved")

    from src.skins.submissions import mark_applied

    applied = mark_applied([retry_sub])
    if retry_sub not in applied:
        fail(f"mark_applied did not apply {retry_sub}: {applied}")
    with connect() as conn:
        promoted = conn.execute(
            """
            SELECT state, skin_slug FROM lore_item_customisations
            WHERE player_uuid = %s AND character_id = %s AND kit_key = %s
            """,
            (player, char_id, "iron_hunting_knife"),
        ).fetchone()
    if promoted is None or str(promoted["state"]) != "ready":
        fail(f"mark_applied should promote customise to ready: {promoted}")
    if str(promoted["skin_slug"]) != retry_sub:
        fail(f"promoted skin_slug expected {retry_sub}: {promoted}")
    print("OK mark_applied promotes pending_skin -> ready")

    r = client.post(
        "/characters/plugin/lore-items/applied",
        json={
            "results": [
                {
                    "player_uuid": player,
                    "character_id": char_id,
                    "kit_key": "iron_hunting_knife",
                    "ok": True,
                }
            ]
        },
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"plugin applied lore expected 200, got {r.status_code} {r.text}")
    with connect() as conn:
        done = conn.execute(
            """
            SELECT state FROM lore_item_customisations
            WHERE player_uuid = %s AND character_id = %s AND kit_key = %s
            """,
            (player, char_id, "iron_hunting_knife"),
        ).fetchone()
    if done is None or str(done["state"]) != "applied":
        fail(f"expected applied state after plugin ack: {done}")
    print("OK POST plugin lore-items applied -> state=applied")
    print("lore_items_smoke: all checks passed")


if __name__ == "__main__":
    main()
