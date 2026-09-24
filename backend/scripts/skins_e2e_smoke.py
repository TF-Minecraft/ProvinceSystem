"""Skins API E2E smoke — run from backend/: python scripts/skins_e2e_smoke.py

Uses FastAPI TestClient (no separate uvicorn). Requires SKINS_DEV=1 or real keys.

Step 11: submission ids are `{sanitized_ign}_{slugify(display_name)}` (no
player_key, no filename-derived identity). Armor submissions carry 1–6 tiers
in one row; upload filenames are freeform and ignored by the server.
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

from server import app
from src.skins.db import SKINS_DIR, connect, migrate
from src.skins.naming import ARMOR_FIELDS, build_submission_id, slugify_display_name

STAFF = "dev-staff-key"
PLUGIN = "dev-plugin-key"
DISCORD_ID = "999999999999999999"
IGN = "Smoke"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def make_png(w: int, h: int, fill: int = 0) -> bytes:
    """RGB PNG; `fill` (0–255) tints pixel bytes so fixtures can be distinct."""
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


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def armor_tier_files(
    tiers: list[str],
    *,
    distinct: bool = True,
    icon: bytes | None = None,
    layer: bytes | None = None,
) -> list[tuple]:
    """Multipart fields `{tier}_helmet` … `{tier}_layer_2`; filenames freeform.

    When distinct=True (default), every field gets unique PNG bytes.
    Pass icon/layer with distinct=False to reuse the same bytes (negative tests).
    """
    files: list[tuple] = []
    n = 0
    for tier in tiers:
        for field in ARMOR_FIELDS:
            if distinct:
                if field in ARMOR_FIELDS[:4]:
                    data = make_png(16, 16, fill=11 + n * 13)
                else:
                    data = make_png(64, 32, fill=37 + n * 17)
                n += 1
            else:
                if icon is None or layer is None:
                    raise ValueError("icon and layer required when distinct=False")
                data = icon if field in ARMOR_FIELDS[:4] else layer
            name = "art.png" if field in ARMOR_FIELDS[:4] else "layer.png"
            files.append((f"{tier}_{field}", (name, data, "image/png")))
    return files


def main() -> None:
    migrate()
    # Idempotent re-runs (Step 11+ assumes empty submissions)
    with connect() as conn:
        conn.execute("DELETE FROM submissions")
        try:
            conn.execute("DELETE FROM notifications")
        except Exception:
            pass
        conn.commit()

    client = TestClient(app)
    player = "00000000-0000-0000-0000-000000000208"
    unlinked_player = f"00000000-0000-0000-0000-{uuid.uuid4().hex[:12]}"

    # Mint without Discord link must fail
    r = client.post(
        "/skins/codes",
        json={"player_uuid": unlinked_player},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 400:
        fail(f"issue code without link expected 400, got {r.status_code} {r.text}")
    if "linkdiscord" not in r.text.lower() and "discord" not in r.text.lower():
        fail(f"issue code without link expected discord message: {r.text}")

    # Discord link required before mint
    r = client.post(
        "/skins/discord/link/start",
        json={"player_uuid": player, "minecraft_name": IGN},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"link start: {r.status_code} {r.text}")
    start_body = r.json()
    completed_link = not start_body.get("already_linked")
    if completed_link:
        if "code" not in start_body:
            fail(f"link start missing code: {start_body}")
        r = client.post(
            "/skins/discord/link/complete",
            json={
                "code": start_body["code"],
                "discord_user_id": DISCORD_ID,
                "discord_username": "smokediscord",
            },
            headers={"X-Staff-Key": STAFF},
        )
        if r.status_code != 200:
            fail(f"link complete: {r.status_code} {r.text}")

    # Already linked — no new code
    r = client.post(
        "/skins/discord/link/start",
        json={"player_uuid": player, "minecraft_name": IGN},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"link start already: {r.status_code} {r.text}")
    already = r.json()
    if not already.get("already_linked"):
        fail(f"expected already_linked: {already}")
    if completed_link and already.get("discord_username") != "smokediscord":
        fail(f"expected stored discord_username smokediscord: {already}")
    if "code" in already:
        fail(f"already linked should not return code: {already}")

    # Plugin notice from complete (optional if link already existed)
    r = client.get("/skins/plugin/notices", headers={"X-Plugin-Key": PLUGIN})
    if r.status_code != 200:
        fail(f"plugin notices: {r.status_code} {r.text}")
    notices = r.json().get("notices") or []
    match = [
        n
        for n in notices
        if n.get("player_uuid") == player and n.get("type") == "link_success"
    ]
    if match:
        notice_id = match[-1]["id"]
        if (
            completed_link
            and match[-1].get("payload", {}).get("discord_username") != "smokediscord"
        ):
            fail(f"notice payload should store username: {match[-1]}")
        r = client.post(
            "/skins/plugin/notices/ack",
            json={"ids": [notice_id]},
            headers={"X-Plugin-Key": PLUGIN},
        )
        if r.status_code != 200:
            fail(f"ack notices: {r.status_code} {r.text}")
        if notice_id not in (r.json().get("acked") or []):
            fail(f"ack missing notice id: {r.text}")
        r = client.get("/skins/plugin/notices", headers={"X-Plugin-Key": PLUGIN})
        if any(n.get("id") == notice_id for n in (r.json().get("notices") or [])):
            fail("acked notice still undelivered")

    # Issue + active list + redeem
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"issue code: {r.status_code} {r.text}")
    code = r.json()["code"]

    r = client.get("/skins/plugin/codes/active", headers={"X-Plugin-Key": PLUGIN})
    if r.status_code != 200:
        fail(f"list active codes: {r.status_code} {r.text}")
    active_codes = [c.get("code") for c in r.json().get("codes", [])]
    if code not in active_codes:
        fail(f"issued code missing from active list: {active_codes}")

    # Separate code for revoke path
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"issue revoke-target code: {r.status_code} {r.text}")
    revoke_target = r.json()["code"]
    r = client.post(
        "/skins/plugin/codes/revoke",
        json={"code": revoke_target},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200 or not r.json().get("ok"):
        fail(f"revoke code: {r.status_code} {r.text}")
    r = client.get("/skins/plugin/codes/active", headers={"X-Plugin-Key": PLUGIN})
    if revoke_target in [c.get("code") for c in r.json().get("codes", [])]:
        fail("revoked code still in active list")
    r = client.post("/skins/redeem", json={"code": revoke_target})
    if r.status_code != 400:
        fail(f"redeem revoked expected 400, got {r.status_code} {r.text}")

    r = client.post("/skins/redeem", json={"code": code})
    if r.status_code != 200:
        fail(f"redeem: {r.status_code} {r.text}")
    token = r.json()["session_token"]
    auth = {"Authorization": f"Bearer {token}"}

    # Unlink by UUID then re-link (guards + unlink path)
    r = client.post(
        "/skins/discord/link/unlink",
        json={"player_uuid": player},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200 or not r.json().get("ok"):
        fail(f"unlink by uuid: {r.status_code} {r.text}")
    r = client.post(
        "/skins/discord/link/unlink",
        json={"player_uuid": player},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 400:
        fail(f"unlink when not linked expected 400, got {r.status_code} {r.text}")

    r = client.post(
        "/skins/discord/link/start",
        json={"player_uuid": player, "minecraft_name": IGN},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"link start 2: {r.status_code} {r.text}")
    r = client.post(
        "/skins/discord/link/complete",
        json={
            "code": r.json()["code"],
            "discord_user_id": DISCORD_ID,
            "discord_username": "smokediscord",
        },
        headers={"X-Staff-Key": STAFF},
    )
    if r.status_code != 200:
        fail(f"link complete 2: {r.status_code} {r.text}")

    # Skins code can be re-entered until a submission is created
    r = client.post("/skins/redeem", json={"code": code})
    if r.status_code != 200:
        fail(f"second redeem before submit expected 200, got {r.status_code} {r.text}")
    token = r.json()["session_token"]
    auth = {"Authorization": f"Bearer {token}"}

    icon = make_png(16, 16)
    layer = make_png(64, 32)
    large_tex = make_png(32, 32)

    # kind=item is disabled regardless of Step 11 changes
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "item",
            "display_name": "Disabled Item",
            "base_set": "swords",
        },
        files=[("texture", ("art.png", icon, "image/png"))],
        headers=auth,
    )
    if r.status_code != 400:
        fail(f"kind=item expected 400, got {r.status_code} {r.text}")

    # Negative: armor with no tiers and no legacy unprefixed fields
    r = client.post(
        "/skins/submissions",
        data={"kind": "armor_set", "display_name": "Bad Armor No Tiers"},
        headers=auth,
    )
    if r.status_code != 400:
        fail(f"armor no tiers expected 400, got {r.status_code} {r.text}")

    # Negative: armor with an invalid tier name
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "armor_set",
            "display_name": "Bad Armor Tier",
            "tiers": json.dumps(["swords"]),
        },
        headers=auth,
    )
    if r.status_code != 400:
        fail(f"armor invalid tier expected 400, got {r.status_code} {r.text}")

    # Negative: armor with a duplicate tier
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "armor_set",
            "display_name": "Bad Armor Dup Tier",
            "tiers": json.dumps(["iron", "iron"]),
        },
        headers=auth,
    )
    if r.status_code != 400:
        fail(f"armor duplicate tier expected 400, got {r.status_code} {r.text}")

    # Negative: same PNG bytes for the same slot across tiers
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "armor_set",
            "display_name": "Bad Armor Dup Texture",
            "tiers": json.dumps(["iron", "steel"]),
        },
        files=armor_tier_files(
            ["iron", "steel"], distinct=False, icon=icon, layer=layer
        ),
        headers=auth,
    )
    if r.status_code != 400:
        fail(
            f"armor identical textures expected 400, got "
            f"{r.status_code} {r.text}"
        )
    detail = (r.json().get("detail") or r.text).lower()
    if "identical" not in detail and "unique" not in detail:
        fail(f"armor identical textures message unexpected: {r.text}")
    print("duplicate PNG bytes in submission rejected ok")

    # Multi-tier armor upload — colours without add_name; name_preview.png generated
    armor_tiers = ["iron", "steel"]
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "armor_set",
            "display_name": "Smoke Armor",
            "tiers": json.dumps(armor_tiers),
            "name_colours": '["#55ff55", "#5555ff"]',
            "name_styles": '["bold"]',
        },
        files=armor_tier_files(armor_tiers),
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"armor upload: {r.status_code} {r.text}")
    armor = r.json()
    armor_id = armor["id"]
    expected_armor_id = build_submission_id(IGN, "Smoke Armor")
    if armor_id != expected_armor_id:
        fail(f"armor id expected {expected_armor_id}, got {armor_id}")
    if armor.get("slug") != armor_id:
        fail(f"armor slug expected to equal id, got {armor.get('slug')}")
    if armor.get("tiers") != armor_tiers:
        fail(f"armor tiers expected {armor_tiers}, got {armor.get('tiers')}")
    if armor.get("base_set") is not None:
        fail(f"armor base_set expected null, got {armor.get('base_set')}")
    if armor.get("add_name") is not False:
        fail(f"armor add_name expected False, got {armor.get('add_name')}")
    if armor.get("name_colours") != ["#55ff55", "#5555ff"]:
        fail(f"armor name_colours unexpected: {armor.get('name_colours')}")
    if armor.get("name_styles") != ["bold"]:
        fail(f"armor name_styles unexpected: {armor.get('name_styles')}")
    if armor.get("discord_user_id") != DISCORD_ID:
        fail(
            f"armor discord_user_id expected {DISCORD_ID}, "
            f"got {armor.get('discord_user_id')}"
        )
    r = client.post("/skins/redeem", json={"code": code})
    if r.status_code != 400:
        fail(
            f"redeem after submit expected 400, got {r.status_code} {r.text}"
        )
    print(f"armor {armor_id} ok; code locked after submit")
    print(
        f"armor submission {armor_id} tiers={armor['tiers']} "
        f"colours without add_name ok"
    )

    staff_early = {"X-Staff-Key": STAFF}
    r = client.get(
        f"/skins/staff/submissions/{armor_id}/files/review_sheet.png",
        headers=staff_early,
    )
    if r.status_code != 200 or not r.content.startswith(PNG_MAGIC):
        fail(
            f"review_sheet.png missing after armor submit "
            f"(get={r.status_code})"
        )
    r = client.get(
        f"/skins/submissions/{armor_id}/review-sheet",
        headers=auth,
    )
    if r.status_code != 200 or not r.content.startswith(PNG_MAGIC):
        fail(
            f"owner review-sheet GET failed "
            f"(get={r.status_code})"
        )
    print("review_sheet.png ok (disk + owner GET)")

    # Conflict check: display_name only (no base_id) — active armor blocks a re-submit
    r = client.get(
        "/skins/submissions/check",
        params={"display_name": "Smoke Armor"},
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"check endpoint: {r.status_code} {r.text}")
    if r.json().get("ok") is not False:
        fail(f"check should conflict for Smoke Armor, got {r.json()}")
    print("armor conflict-check (display_name only) ok")

    # Backward-compat: legacy unprefixed armor fields + base_set select a single tier
    legacy_files = []
    for i, field in enumerate(ARMOR_FIELDS):
        if field in ARMOR_FIELDS[:4]:
            data = make_png(16, 16, fill=80 + i * 11)
            name = "art.png"
        else:
            data = make_png(64, 32, fill=120 + i * 9)
            name = "layer.png"
        legacy_files.append((field, (name, data, "image/png")))
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "armor_set",
            "display_name": "Smoke Armor Legacy",
            "base_set": "iron",
        },
        files=legacy_files,
        headers=auth,
    )
    if r.status_code != 200:
        fail(f"legacy armor upload: {r.status_code} {r.text}")
    legacy_armor = r.json()
    legacy_armor_id = legacy_armor["id"]
    if legacy_armor.get("tiers") != ["iron"]:
        fail(f"legacy armor tiers expected ['iron'], got {legacy_armor.get('tiers')}")
    if legacy_armor.get("base_set") is not None:
        fail(f"legacy armor base_set expected null, got {legacy_armor.get('base_set')}")
    print(f"legacy single-tier armor {legacy_armor_id} tiers={legacy_armor['tiers']} ok")

    staff = {"X-Staff-Key": STAFF}
    r = client.get("/skins/staff/notifications", headers=staff)
    if r.status_code != 200:
        fail(f"notifications: {r.status_code} {r.text}")
    notes = [
        n
        for n in r.json().get("notifications", [])
        if n.get("submission_id") == armor_id and n.get("type") == "submitted"
    ]
    if not notes:
        fail(f"no submitted notification for armor {armor_id}")
    nid = notes[0]["id"]
    if notes[0].get("discord_user_id") != DISCORD_ID:
        fail("submitted notification discord_user_id mismatch")
    r = client.post(f"/skins/staff/notifications/{nid}/ack", headers=staff)
    if r.status_code != 200:
        fail(f"notification ack: {r.status_code} {r.text}")
    r = client.get("/skins/staff/notifications", headers=staff)
    if any(n.get("id") == nid for n in r.json().get("notifications", [])):
        fail("notification still listed after ack")
    print(f"submitted notification {nid} ok")

    # New session for second submission (code already redeemed — issue another)
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"issue code 2: {r.status_code} {r.text}")
    r = client.post("/skins/redeem", json={"code": r.json()["code"]})
    if r.status_code != 200:
        fail(f"redeem 2: {r.status_code} {r.text}")
    auth2 = {"Authorization": f"Bearer {r.json()['session_token']}"}

    # handheld + wrong base_set (still validated for non-armor kinds)
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "handheld",
            "display_name": "Bad Hand",
            "base_set": "spears",
        },
        files=[("texture", ("whatever.png", icon, "image/png"))],
        headers=auth2,
    )
    if r.status_code != 400:
        fail(f"handheld+spears expected 400, got {r.status_code} {r.text}")

    # handheld upload — id from IGN + item name, freeform filename OK
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "handheld",
            "display_name": "Smoke Hand",
            "base_set": "swords",
            "add_name": "true",
            "name_colours": '["#9c001a", "&c"]',
            "name_styles": '["bold", "italic"]',
        },
        files=[("texture", ("my_cool_texture_v2.png", icon, "image/png"))],
        headers=auth2,
    )
    if r.status_code != 200:
        fail(f"handheld upload: {r.status_code} {r.text}")
    hand = r.json()
    hand_id = hand["id"]
    expected_hand_id = build_submission_id(IGN, "Smoke Hand")
    if hand_id != expected_hand_id:
        fail(f"hand id expected {expected_hand_id}, got {hand_id}")
    if hand.get("slug") != hand_id:
        fail(f"hand slug expected to equal id, got {hand.get('slug')}")
    if hand.get("base_set") != "swords":
        fail(f"handheld base_set expected swords, got {hand.get('base_set')}")
    if hand.get("add_name") is not True:
        fail(f"handheld add_name expected True, got {hand.get('add_name')}")
    if hand.get("name_colours") != ["#9c001a", "\u00a7c"]:
        fail(f"handheld name_colours unexpected: {hand.get('name_colours')}")
    if hand.get("name_styles") != ["bold", "italic"]:
        fail(f"handheld name_styles unexpected: {hand.get('name_styles')}")
    print(
        f"handheld submission {hand_id} base_set={hand['base_set']} "
        f"add_name colours/styles ok (freeform filename)"
    )

    # Deny purges row so the same item name/id can be reused
    reuse_tex = make_png(16, 16, fill=201)
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "handheld",
            "display_name": "Smoke Deny Reuse",
            "base_set": "swords",
        },
        files=[("texture", ("deny_reuse_a.png", reuse_tex, "image/png"))],
        headers=auth2,
    )
    if r.status_code != 200:
        fail(f"deny-reuse upload: {r.status_code} {r.text}")
    reuse_id = r.json()["id"]
    expected_reuse = build_submission_id(IGN, "Smoke Deny Reuse")
    if reuse_id != expected_reuse:
        fail(f"deny-reuse id expected {expected_reuse}, got {reuse_id}")
    r = client.post(
        f"/skins/submissions/{reuse_id}/deny",
        json={"reason": "Needs a cleaner silhouette"},
        headers=staff,
    )
    if r.status_code != 200:
        fail(f"deny-reuse deny: {r.status_code} {r.text}")
    if r.json().get("status") != "denied":
        fail(f"deny-reuse response status: {r.json()}")
    with connect() as conn:
        if conn.execute(
            "SELECT 1 FROM submissions WHERE id = ?", (reuse_id,)
        ).fetchone():
            fail(f"deny should purge submissions row: {reuse_id}")
    reuse_tex2 = make_png(16, 16, fill=202)
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "handheld",
            "display_name": "Smoke Deny Reuse",
            "base_set": "swords",
        },
        files=[("texture", ("deny_reuse_b.png", reuse_tex2, "image/png"))],
        headers=auth2,
    )
    if r.status_code != 200:
        fail(f"deny-reuse reupload: {r.status_code} {r.text}")
    if r.json().get("id") != reuse_id:
        fail(f"deny-reuse reupload id expected {reuse_id}, got {r.json().get('id')}")
    r = client.post(
        f"/skins/submissions/{reuse_id}/deny",
        json={"reason": "Cleanup after reuse check"},
        headers=staff,
    )
    if r.status_code != 200:
        fail(f"deny-reuse cleanup deny: {r.status_code} {r.text}")
    print("deny purge + same-id resubmit ok")

    # Third session for large
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"issue code 3: {r.status_code} {r.text}")
    r = client.post("/skins/redeem", json={"code": r.json()["code"]})
    if r.status_code != 200:
        fail(f"redeem 3: {r.status_code} {r.text}")
    auth3 = {"Authorization": f"Bearer {r.json()['session_token']}"}

    r = client.post(
        "/skins/submissions",
        data={
            "kind": "large_handheld",
            "display_name": "Smoke Large",
            "grip_preset": "2.5",
            "base_set": "spears",
        },
        files=[("texture", ("large-texture-final.png", large_tex, "image/png"))],
        headers=auth3,
    )
    if r.status_code != 200:
        fail(f"large upload: {r.status_code} {r.text}")
    large = r.json()
    large_id = large["id"]
    expected_large_id = build_submission_id(IGN, "Smoke Large")
    if large_id != expected_large_id:
        fail(f"large id expected {expected_large_id}, got {large_id}")
    if large.get("slug") != large_id:
        fail(f"large slug expected to equal id, got {large.get('slug')}")
    if large.get("grip_preset") != "2.5":
        fail(f"expected grip_preset=2.5, got {large.get('grip_preset')}")
    if large.get("base_set") != "spears":
        fail(f"large base_set expected spears, got {large.get('base_set')}")
    if large.get("discord_user_id") != DISCORD_ID:
        fail(
            f"large discord_user_id expected {DISCORD_ID}, "
            f"got {large.get('discord_user_id')}"
        )
    print(
        f"large submission {large_id} grip={large['grip_preset']} "
        f"base_set={large['base_set']} (freeform filename)"
    )

    # Book session (Step 28)
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"issue code book: {r.status_code} {r.text}")
    r = client.post("/skins/redeem", json={"code": r.json()["code"]})
    if r.status_code != 200:
        fail(f"redeem book: {r.status_code} {r.text}")
    auth_book = {"Authorization": f"Bearer {r.json()['session_token']}"}

    book_unsigned = make_png(16, 16, fill=71)
    book_signed = make_png(16, 16, fill=93)
    book_wrong = make_png(32, 32, fill=71)

    r = client.post(
        "/skins/submissions",
        data={
            "kind": "book",
            "display_name": "Smoke Book Missing",
            "base_set": "books",
        },
        files=[("unsigned", ("u.png", book_unsigned, "image/png"))],
        headers=auth_book,
    )
    if r.status_code != 400:
        fail(f"book missing signed expected 400, got {r.status_code} {r.text}")

    r = client.post(
        "/skins/submissions",
        data={
            "kind": "book",
            "display_name": "Smoke Book Size",
            "base_set": "books",
        },
        files=[
            ("unsigned", ("u.png", book_wrong, "image/png")),
            ("signed", ("s.png", book_signed, "image/png")),
        ],
        headers=auth_book,
    )
    if r.status_code != 400:
        fail(f"book wrong size expected 400, got {r.status_code} {r.text}")

    r = client.post(
        "/skins/submissions",
        data={
            "kind": "book",
            "display_name": "Smoke Book Bad Base",
            "base_set": "spears",
        },
        files=[
            ("unsigned", ("u.png", book_unsigned, "image/png")),
            ("signed", ("s.png", book_signed, "image/png")),
        ],
        headers=auth_book,
    )
    if r.status_code != 400:
        fail(f"book+spears expected 400, got {r.status_code} {r.text}")

    r = client.post(
        "/skins/submissions",
        data={
            "kind": "book",
            "display_name": "Smoke Book",
            "base_set": "books",
        },
        files=[
            ("unsigned", ("cover_u.png", book_unsigned, "image/png")),
            ("signed", ("cover_s.png", book_signed, "image/png")),
        ],
        headers=auth_book,
    )
    if r.status_code != 200:
        fail(f"book upload: {r.status_code} {r.text}")
    book = r.json()
    book_id = book["id"]
    expected_book_id = build_submission_id(IGN, "Smoke Book")
    if book_id != expected_book_id:
        fail(f"book id expected {expected_book_id}, got {book_id}")
    if book.get("base_set") != "books":
        fail(f"book base_set expected books, got {book.get('base_set')}")
    book_dir = SKINS_DIR / book_id
    if not (book_dir / f"{book_id}_unsigned.png").is_file():
        fail(f"book disk missing unsigned stem under {book_dir}")
    if not (book_dir / f"{book_id}_signed.png").is_file():
        fail(f"book disk missing signed stem under {book_dir}")
    print(f"book submission {book_id} base_set=books dual stems ok")

    for sid, label in (
        (armor_id, "armor"),
        (hand_id, "handheld"),
        (large_id, "large"),
        (book_id, "book"),
    ):
        r = client.get(f"/skins/submissions/{sid}/review-sheet", headers=staff)
        if r.status_code != 200:
            fail(f"review-sheet {label}: {r.status_code} {r.text}")
        if not r.content.startswith(PNG_MAGIC):
            fail(f"review-sheet {label}: not a PNG")
        render_err = r.headers.get("X-Sheet-Render-Error")
        if render_err:
            print(
                f"WARNING review-sheet {label}: 3D render failed "
                f"({render_err[:120]})"
            )
        print(f"review-sheet {label} ok ({len(r.content)} bytes)")

    r = client.get(f"/skins/submissions/{armor_id}/review-sheet")
    if r.status_code != 401:
        fail(f"review-sheet without key expected 401, got {r.status_code}")

    # Approve all (leave legacy_armor pending)
    for sid in (armor_id, hand_id, large_id, book_id):
        r = client.post(f"/skins/submissions/{sid}/approve", headers=staff)
        if r.status_code != 200:
            fail(f"approve {sid}: {r.status_code} {r.text}")

    plugin = {"X-Plugin-Key": PLUGIN}
    r = client.get("/skins/plugin/approved", headers=plugin)
    if r.status_code != 200:
        fail(f"plugin approved: {r.status_code} {r.text}")
    by_id = {s["id"]: s for s in r.json().get("submissions", [])}
    if armor_id not in by_id:
        fail("armor missing from plugin approved list")
    if hand_id not in by_id:
        fail("handheld missing from plugin approved list")
    if large_id not in by_id:
        fail("large missing from plugin approved list")
    if book_id not in by_id:
        fail("book missing from plugin approved list")
    if sorted(by_id[armor_id].get("tiers") or []) != sorted(armor_tiers):
        fail(
            f"armor tiers missing/incomplete on approved list: "
            f"{by_id[armor_id].get('tiers')}"
        )
    if "iron" not in by_id[armor_id].get("tiers", []):
        fail("armor approved tiers missing iron")
    if "steel" not in by_id[armor_id].get("tiers", []):
        fail("armor approved tiers missing steel")
    if by_id[armor_id].get("base_set") is not None:
        fail("armor base_set expected null on approved list")
    if by_id[armor_id].get("name_colours") != ["#55ff55", "#5555ff"]:
        fail(
            "armor name_colours missing on approved list: "
            f"{by_id[armor_id].get('name_colours')}"
        )
    if by_id[armor_id].get("add_name") is not False:
        fail("armor add_name expected false on approved list")
    if by_id[hand_id].get("base_set") != "swords":
        fail("handheld base_set missing on approved list")
    if by_id[large_id].get("grip_preset") != "2.5":
        fail("large grip_preset missing on approved list")
    if by_id[large_id].get("base_set") != "spears":
        fail("large base_set missing on approved list")
    large_files = by_id[large_id].get("files") or []
    if f"{large_id}.json" not in large_files:
        fail(f"large missing pack model JSON in files: {large_files}")
    if by_id[hand_id].get("add_name") is not True:
        fail("handheld add_name missing on approved list")
    if by_id[hand_id].get("name_colours") != ["#9c001a", "\u00a7c"]:
        fail(
            "handheld name_colours missing on approved list: "
            f"{by_id[hand_id].get('name_colours')}"
        )
    if by_id[hand_id].get("name_styles") != ["bold", "italic"]:
        fail(
            "handheld name_styles missing on approved list: "
            f"{by_id[hand_id].get('name_styles')}"
        )
    if by_id[book_id].get("base_set") != "books":
        fail("book base_set missing on approved list")
    approved_book_files = by_id[book_id].get("files") or []
    if f"{book_id}_unsigned.png" not in approved_book_files:
        fail(f"book approved missing unsigned: {approved_book_files}")
    if f"{book_id}_signed.png" not in approved_book_files:
        fail(f"book approved missing signed: {approved_book_files}")
    if by_id[armor_id].get("staff"):
        fail("player armor should not be staff on approved list")
    print(
        "plugin approved list ok "
        "(armor tiers, handheld, large, book dual stems)"
    )

    r = client.post(
        "/skins/plugin/applied",
        json={"submission_ids": [armor_id]},
        headers=plugin,
    )
    if r.status_code != 200:
        fail(f"applied: {r.status_code} {r.text}")
    if armor_id not in r.json().get("applied", []):
        fail("armor not in applied response")

    r = client.get("/skins/plugin/approved", headers=plugin)
    by_id = {s["id"]: s for s in r.json().get("submissions", [])}
    if armor_id in by_id:
        fail("armor still on approved list after applied")
    if large_id not in by_id:
        fail("large should still be on approved list")
    print("applied ack ok")

    # Deletable/tab-complete list uses human ids, not UUIDs
    r = client.get("/skins/plugin/submissions/deletable", headers=plugin)
    if r.status_code != 200:
        fail(f"deletable list: {r.status_code} {r.text}")
    deletable_ids = {s.get("id") for s in r.json().get("submissions", [])}
    for sid in (hand_id, large_id, legacy_armor_id):
        if sid not in deletable_ids:
            fail(f"deletable list missing {sid}: {deletable_ids}")
    for sid in deletable_ids:
        if not isinstance(sid, str) or "-" in sid:
            fail(f"deletable id looks like a UUID, expected human id: {sid}")
    print("deletable list ok (human ids, tab-complete ready)")

    # --- Step 18.02: staff token + auto-approve ---
    collision_name = "Staff Collision"
    collision_slug = slugify_display_name(collision_name)
    catalog_body = {
        "categories": [
            {
                "id": "a_medieval",
                "name": "Medieval",
                "is_item": False,
                "skin_sets": [collision_slug],
            },
            {
                "id": "i_weapons",
                "name": "Weapons",
                "is_item": True,
                "skin_sets": [],
            },
        ],
        "scrolls": [
            {"id": "m.loot.rare_item_skin_scroll", "label": "Rare item"},
            {"id": "m.loot.iron_armor_scroll", "label": "Iron armor"},
        ],
    }
    r = client.put(
        "/skins/plugin/catalog",
        json=catalog_body,
        headers=plugin,
    )
    if r.status_code != 200:
        fail(f"catalog put: {r.status_code} {r.text}")

    r = client.post(
        "/skins/codes",
        json={"player_uuid": player},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"issue player code (staff fields reject): {r.status_code} {r.text}")
    r = client.post("/skins/redeem", json={"code": r.json()["code"]})
    if r.status_code != 200:
        fail(f"redeem player (staff fields reject): {r.status_code} {r.text}")
    if r.json().get("staff") is not False:
        fail(f"player redeem staff expected false, got {r.json().get('staff')}")
    player_auth = {"Authorization": f"Bearer {r.json()['session_token']}"}
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "handheld",
            "display_name": "Player No Staff Fields",
            "base_set": "swords",
            "category": "i_weapons",
            "scroll": "m.loot.rare_item_skin_scroll",
        },
        files={"texture": ("t.png", icon, "image/png")},
        headers=player_auth,
    )
    if r.status_code != 400:
        fail(
            f"player category/scroll expected 400, got {r.status_code} {r.text}"
        )
    print("player reject staff fields ok")

    r = client.put(
        "/skins/plugin/catalog",
        json={"categories": [], "scrolls": []},
        headers=plugin,
    )
    if r.status_code != 200:
        fail(f"empty catalog put: {r.status_code} {r.text}")
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player, "scope": "skin_staff"},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"issue skin_staff (empty catalog): {r.status_code} {r.text}")
    r = client.post("/skins/redeem", json={"code": r.json()["code"]})
    if r.status_code != 200:
        fail(f"redeem skin_staff (empty catalog): {r.status_code} {r.text}")
    empty_auth = {"Authorization": f"Bearer {r.json()['session_token']}"}
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "handheld",
            "display_name": "Staff Empty Catalog",
            "base_set": "swords",
            "category": "i_weapons",
            "scroll": "m.loot.rare_item_skin_scroll",
        },
        files={"texture": ("t.png", icon, "image/png")},
        headers=empty_auth,
    )
    if r.status_code != 400 or "catalog not synced" not in (
        r.json().get("detail") or ""
    ):
        fail(f"empty catalog expected 400, got {r.status_code} {r.text}")
    r = client.put(
        "/skins/plugin/catalog",
        json=catalog_body,
        headers=plugin,
    )
    if r.status_code != 200:
        fail(f"catalog restore: {r.status_code} {r.text}")
    print("empty catalog reject ok")

    r = client.post(
        "/skins/codes",
        json={"player_uuid": player, "scope": "skin_staff"},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"issue skin_staff code: {r.status_code} {r.text}")
    r = client.post("/skins/redeem", json={"code": r.json()["code"]})
    if r.status_code != 200:
        fail(f"redeem skin_staff: {r.status_code} {r.text}")
    redeem_body = r.json()
    if redeem_body.get("scope") != "skin_staff" or redeem_body.get("staff") is not True:
        fail(f"skin_staff redeem flags wrong: {redeem_body}")
    staff_auth = {"Authorization": f"Bearer {redeem_body['session_token']}"}

    r = client.post(
        "/skins/submissions",
        data={
            "kind": "handheld",
            "display_name": collision_name,
            "base_set": "swords",
            "category": "a_medieval",
            "scroll": "m.loot.rare_item_skin_scroll",
        },
        files={"texture": ("t.png", icon, "image/png")},
        headers=staff_auth,
    )
    if r.status_code != 400 or "already exists" not in (r.json().get("detail") or ""):
        fail(f"staff collision expected 400, got {r.status_code} {r.text}")

    r = client.post(
        "/skins/submissions",
        data={
            "kind": "handheld",
            "display_name": "Staff Curated Blade",
            "base_set": "swords",
            "category": "nope",
            "scroll": "m.loot.rare_item_skin_scroll",
        },
        files={"texture": ("t.png", icon, "image/png")},
        headers=staff_auth,
    )
    if r.status_code != 400:
        fail(f"bad category expected 400, got {r.status_code} {r.text}")

    r = client.post(
        "/skins/submissions",
        data={
            "kind": "handheld",
            "display_name": "Staff Curated Blade",
            "base_set": "swords",
            "category": "i_weapons",
            "scroll": "m.loot.rare_item_skin_scroll",
        },
        files={"texture": ("t.png", icon, "image/png")},
        headers=staff_auth,
    )
    if r.status_code != 200:
        fail(f"staff handheld submit: {r.status_code} {r.text}")
    staff_hand = r.json()
    staff_hand_id = staff_hand["id"]
    expected_staff_hand_id = slugify_display_name("Staff Curated Blade")
    if staff_hand_id != expected_staff_hand_id:
        fail(
            f"staff id should be display-slug only "
            f"'{expected_staff_hand_id}', got '{staff_hand_id}'"
        )
    if "_" + IGN.lower() in staff_hand_id or staff_hand_id.startswith(IGN.lower() + "_"):
        fail(f"staff id must not include MC IGN: {staff_hand_id}")
    if staff_hand.get("status") != "approved":
        fail(f"staff handheld status expected approved, got {staff_hand.get('status')}")
    if staff_hand.get("staff") is not True:
        fail("staff handheld response missing staff=true")
    if staff_hand.get("category") != "i_weapons":
        fail(f"staff handheld category wrong: {staff_hand.get('category')}")
    if staff_hand.get("scroll") != "m.loot.rare_item_skin_scroll":
        fail(f"staff handheld scroll wrong: {staff_hand.get('scroll')}")

    r = client.get("/skins/staff/notifications", headers=staff)
    if r.status_code != 200:
        fail(f"staff notifications after staff submit: {r.status_code} {r.text}")
    if any(
        n.get("submission_id") == staff_hand_id and n.get("type") == "submitted"
        for n in r.json().get("notifications", [])
    ):
        fail("staff submit should not enqueue skin_notifications")

    r = client.get("/skins/plugin/approved", headers=plugin)
    if r.status_code != 200:
        fail(f"plugin approved after staff: {r.status_code} {r.text}")
    by_id = {s["id"]: s for s in r.json().get("submissions", [])}
    row = by_id.get(staff_hand_id)
    if not row:
        fail("staff handheld missing from plugin approved")
    if row.get("staff") is not True:
        fail("plugin approved staff flag missing")
    if row.get("category") != "i_weapons":
        fail(f"plugin approved category wrong: {row.get('category')}")
    if row.get("scroll") != "m.loot.rare_item_skin_scroll":
        fail(f"plugin approved scroll wrong: {row.get('scroll')}")
    if row.get("ia_namespace") != "tfmc_armorshop":
        fail(f"plugin approved ia_namespace wrong: {row.get('ia_namespace')}")
    print(f"staff handheld {staff_hand_id} auto-approved + plugin DTO ok")

    r = client.get(f"/skins/plugin/submissions/{staff_hand_id}", headers=plugin)
    if r.status_code != 200:
        fail(f"plugin get staff skin: {r.status_code} {r.text}")
    got = r.json()
    if got.get("staff") is not True:
        fail("plugin get missing staff=true")
    if got.get("category") != "i_weapons":
        fail(f"plugin get category wrong: {got.get('category')}")
    if got.get("ia_namespace") != "tfmc_armorshop":
        fail(f"plugin get ia_namespace wrong: {got.get('ia_namespace')}")

    r = client.get("/skins/plugin/submissions/deletable", headers=plugin)
    if r.status_code != 200:
        fail(f"player deletable after staff: {r.status_code} {r.text}")
    player_deletable = {s.get("id") for s in r.json().get("submissions", [])}
    if staff_hand_id in player_deletable:
        fail("staff skin must not appear on player deletable list")

    r = client.get("/skins/plugin/skins/deletable", headers=plugin)
    if r.status_code != 200:
        fail(f"staff skins deletable: {r.status_code} {r.text}")
    staff_deletable = {s.get("id") for s in r.json().get("skins", [])}
    if staff_hand_id not in staff_deletable:
        fail(f"staff deletable missing {staff_hand_id}: {staff_deletable}")
    print("staff vs player deletable lists ok")

    # New staff session for armor_set + tier_scrolls
    r = client.post(
        "/skins/codes",
        json={"player_uuid": player, "scope": "skin_staff"},
        headers={"X-Plugin-Key": PLUGIN},
    )
    if r.status_code != 200:
        fail(f"issue skin_staff code 2: {r.status_code} {r.text}")
    r = client.post("/skins/redeem", json={"code": r.json()["code"]})
    if r.status_code != 200:
        fail(f"redeem skin_staff 2: {r.status_code} {r.text}")
    staff_auth2 = {"Authorization": f"Bearer {r.json()['session_token']}"}
    staff_armor_tiers = ["iron"]
    r = client.post(
        "/skins/submissions",
        data={
            "kind": "armor_set",
            "display_name": "Staff Curated Plate",
            "tiers": json.dumps(staff_armor_tiers),
            "category": "a_medieval",
            "tier_scrolls": json.dumps(
                {"iron": "m.loot.iron_armor_scroll"}
            ),
        },
        files=armor_tier_files(staff_armor_tiers),
        headers=staff_auth2,
    )
    if r.status_code != 200:
        fail(f"staff armor submit: {r.status_code} {r.text}")
    staff_armor = r.json()
    if staff_armor.get("status") != "approved":
        fail(f"staff armor status expected approved, got {staff_armor.get('status')}")
    if staff_armor.get("tier_scrolls") != {"iron": "m.loot.iron_armor_scroll"}:
        fail(f"staff armor tier_scrolls wrong: {staff_armor.get('tier_scrolls')}")
    print(f"staff armor {staff_armor['id']} tier_scrolls ok")

    print("ALL OK — Step 11 + 18.02/18.07 smoke (staff token / display-slug / deletable)")
    sys.exit(0)


if __name__ == "__main__":
    main()
