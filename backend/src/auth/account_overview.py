"""What the Account page shows about a player's own linked Minecraft account.

Each part is best effort: when CoreProtect, the LuckPerms copy or Mojang cannot
be read, that part is None and the rest of the page still loads.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import threading
import time
from urllib.parse import urlsplit

import httpx
from PIL import Image

from src.coreprotect import sessions
from src.coreprotect.reader import Budget, CoreProtectConfig, Reader, Unavailable
from src.luckperms import mirror
from src.skins.db import connect

from .players import _ids, canonical_uuid

logger = logging.getLogger("auth")

OVERVIEW_BUDGET_SECONDS = 2.0
PROFILE_URL = "https://sessionserver.mojang.com/session/minecraft/profile/{}"
SKIN_HOST = "textures.minecraft.net"
SKIN_MAX_BYTES = 256 * 1024
HEAD_SIZE = 64
HEAD_TTL_SECONDS = 6 * 3600
HEAD_MISS_TTL_SECONDS = 600
_HEAD_CACHE_MAX = 512

_HEADS_LOCK = threading.Lock()
_HEADS: dict[str, tuple[float, bytes | None]] = {}


def activity(player_uuid: str, config: CoreProtectConfig | None = None) -> dict | None:
    """First and last sight of the player on this site's server, from CoreProtect."""
    key = canonical_uuid(player_uuid)
    config = config or CoreProtectConfig.from_env()
    if key is None or not config.path:
        return None
    try:
        with Reader(config, Budget(OVERVIEW_BUDGET_SECONDS)) as reader:
            ids = [a["id"] for a in _ids(reader, key)]
            if not ids:
                return None
            event = sessions.last_event(reader, ids)
            first = [r["first"] for uid in ids for r in reader.rows(
                "SELECT MIN(time) AS first FROM co_session WHERE user = ?", (uid,)) if r["first"] is not None]
    except Unavailable as exc:
        logger.info("Account overview: CoreProtect unavailable code=%s", exc.code)
        return None
    return {
        "first_seen": min(first) if first else None,
        "last_seen": event["time"] if event else None,
        "online": sessions.is_fresh(event, int(time.time()), config.ping_seconds),
        "server_label": config.label or None,
    }


def rank(player_uuid: str) -> str | None:
    """The player's LuckPerms rank as a name players know, or None for the default group."""
    key = canonical_uuid(player_uuid)
    if key is None:
        return None
    try:
        with connect() as conn:
            if mirror.user_row(conn, key) is None:
                return None
            groups = mirror.load_groups(conn)
            name = mirror.rank_group(groups, mirror.user_nodes(conn, key), int(time.time()))
    except Exception:  # noqa: BLE001 - the mirror tables may be missing on a fresh site.
        logger.warning("Account overview: LuckPerms rank unavailable", exc_info=True)
        return None
    if not name or name == "default":
        return None
    shown = (groups[name].get("display_name") or "").strip()
    if shown:
        return shown
    # Staff groups come in _player and _inactive variants of the same rank.
    base = name.split("_", 1)[0]
    return base[:1].upper() + base[1:]


def _skin_url(http: httpx.Client, key: str) -> str | None:
    response = http.get(PROFILE_URL.format(key.replace("-", "")))
    if response.status_code != 200:
        return None
    for prop in response.json().get("properties") or []:
        if prop.get("name") != "textures":
            continue
        textures = json.loads(base64.b64decode(prop.get("value") or ""))
        url = ((textures.get("textures") or {}).get("SKIN") or {}).get("url")
        if isinstance(url, str) and urlsplit(url).hostname == SKIN_HOST:
            return "https://" + SKIN_HOST + urlsplit(url).path
    return None


def _render_head(skin_png: bytes) -> bytes:
    skin = Image.open(io.BytesIO(skin_png))
    if skin.size[0] != 64 or skin.size[1] not in (32, 64):
        raise ValueError("unexpected skin size")
    skin = skin.convert("RGBA")
    face = skin.crop((8, 8, 16, 16))
    face.alpha_composite(skin.crop((40, 8, 48, 16)))
    out = io.BytesIO()
    face.resize((HEAD_SIZE, HEAD_SIZE), Image.NEAREST).save(out, format="PNG")
    return out.getvalue()


def _fetch_head(key: str, http: httpx.Client) -> bytes | None:
    url = _skin_url(http, key)
    if url is None:
        return None
    response = http.get(url)
    if response.status_code != 200 or len(response.content) > SKIN_MAX_BYTES:
        return None
    return _render_head(response.content)


def head(player_uuid: str, http: httpx.Client | None = None) -> bytes | None:
    """The player's skin face (with its hat layer) as a 64x64 PNG, cached for a few hours."""
    key = canonical_uuid(player_uuid)
    if key is None:
        return None
    now = time.monotonic()
    with _HEADS_LOCK:
        cached = _HEADS.get(key)
        if cached and cached[0] > now:
            return cached[1]
    client = http or httpx.Client(timeout=5.0)
    try:
        png = _fetch_head(key, client)
    except (httpx.HTTPError, ValueError, OSError) as exc:
        logger.info("Account head fetch failed error=%s", type(exc).__name__)
        png = None
    finally:
        if http is None:
            client.close()
    with _HEADS_LOCK:
        if len(_HEADS) >= _HEAD_CACHE_MAX:
            _HEADS.clear()
        _HEADS[key] = (now + (HEAD_TTL_SECONDS if png else HEAD_MISS_TTL_SECONDS), png)
    return png


def clear_heads() -> None:
    with _HEADS_LOCK:
        _HEADS.clear()
