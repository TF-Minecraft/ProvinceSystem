"""Connection and computer checks for players at /diagnostic, and the reports they send to staff.

The page is public but unlisted: staff send players the link in a ticket.
"""
from __future__ import annotations

import os
import re
import threading
import time
from collections import defaultdict
from dataclasses import asdict
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from src.api.auth_routes import session_cookie
from src.api.request_body import read_json_body
from src.api.staff_access import require_staff_account
from src.auth import users
from src.auth.config import AuthConfig
from src.diagnostic import reports
from src.diagnostic.pack import PackMirror
from src.diagnostic.server_ping import ServerStatus, ping
from src.skins.db import DATA_DIR
from src.skins.discord_link import get_link_for_discord_id

diagnostic_router = APIRouter(prefix="/diagnostic", tags=["diagnostic"])

SERVER_ADDRESS = os.getenv("DIAGNOSTIC_SERVER_ADDRESS", "play.tfminecraft.net:25565")
GAME_VERSION = os.getenv("DIAGNOSTIC_GAME_VERSION", "1.21.10")
SPEED_TEST_BYTES = 8 << 20
REPORT_LIMIT = 64 * 1024
_MINECRAFT_NAME = re.compile(r"[A-Za-z0-9_]{3,16}")

pack_mirror = PackMirror(
    os.getenv("DIAGNOSTIC_PACK_URL", "http://188.40.119.246:9900/generated.zip"),
    DATA_DIR / "diagnostic",
)

_ping_lock = threading.Lock()
_ping_cache: tuple[float, ServerStatus] | None = None
_PING_MAX_AGE = 15.0

_speed_data: bytes | None = None

_RATE_BUCKETS: dict[tuple[str, str], list[float]] = defaultdict(list)
_RATES = {"speed": (20, 600.0), "report": (5, 600.0)}


def _client_ip(request: Request) -> str:
    # Behind Cloudflare and nginx the peer is the proxy; Cloudflare names the visitor.
    return (request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "")).strip() or "unknown"


def _check_rate(request: Request, kind: str) -> None:
    limit, window = _RATES[kind]
    now = time.monotonic()
    bucket = _RATE_BUCKETS[(kind, _client_ip(request))]
    bucket[:] = [t for t in bucket if t > now - window]
    if len(bucket) >= limit:
        raise HTTPException(429, detail="too_many_requests")
    bucket.append(now)


def _country(request: Request) -> str | None:
    country = (request.headers.get("cf-ipcountry") or "").strip().upper()
    return country if re.fullmatch(r"[A-Z]{2}", country) and country not in {"XX", "T1"} else None


def _server_status() -> ServerStatus:
    global _ping_cache
    with _ping_lock:
        if _ping_cache is None or time.monotonic() - _ping_cache[0] > _PING_MAX_AGE:
            host, _, port = SERVER_ADDRESS.rpartition(":")
            _ping_cache = (time.monotonic(), ping(host, int(port)))
        return _ping_cache[1]


def _signed_in_user(request: Request) -> dict | None:
    config = AuthConfig.from_env()
    if not (config.enabled or config.via_site) or config.problems():
        return None
    return users.session_user(request.cookies.get(session_cookie(config)))


@diagnostic_router.get("/status")
def status(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    pack = pack_mirror.current()
    return {
        "client": {"country": _country(request)},
        "server": asdict(_server_status()),
        "pack": None if pack is None else {
            "sha1": pack.sha1,
            "size": pack.size,
            "url": f"diagnostic/pack/{pack.sha1}.zip",
            "fetched_at": datetime.fromtimestamp(pack.fetched_at, timezone.utc).isoformat(),
            "stale": pack_mirror.error is not None,
        },
        "game_version": GAME_VERSION,
    }


@diagnostic_router.get("/server")
def server(response: Response):
    """Just the server ping, for the home page; it skips the pack check that /status runs."""
    response.headers["Cache-Control"] = "no-store"
    status = _server_status()
    return {
        "address": status.address,
        "online": status.online,
        "players_online": status.players_online,
        "players_max": status.players_max,
        "game_version": GAME_VERSION,
    }


@diagnostic_router.get("/speed")
def speed(request: Request):
    global _speed_data
    _check_rate(request, "speed")
    if _speed_data is None:
        # Random bytes, so no proxy on the way can compress them.
        _speed_data = os.urandom(SPEED_TEST_BYTES)
    return Response(_speed_data, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})


@diagnostic_router.get("/pack/{sha1}.zip")
def pack_file(sha1: str):
    path = pack_mirror.path_for(sha1)
    if path is None:
        raise HTTPException(404, detail="pack_not_found")
    # The name holds the hash, so Cloudflare may keep a copy near the player.
    return FileResponse(
        path,
        media_type="application/zip",
        filename="TFMC-resource-pack.zip",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@diagnostic_router.post("/reports")
async def send_report(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if request.headers.get("sec-fetch-site", "same-origin") not in {"same-origin", "same-site"}:
        raise HTTPException(403, detail="cross_site_request")
    _check_rate(request, "report")
    body = await read_json_body(request, REPORT_LIMIT)
    report = body.get("report") if isinstance(body, dict) else None
    if not isinstance(report, dict):
        raise HTTPException(400, detail="bad_report")
    name = str(body.get("minecraft_name") or "").strip()
    if name and not _MINECRAFT_NAME.fullmatch(name):
        raise HTTPException(400, detail="bad_minecraft_name")
    user = _signed_in_user(request)
    if user is not None:
        link = get_link_for_discord_id(str(user.get("discord_user_id") or ""))
        name = str((link or {}).get("minecraft_name") or "").strip() or name
    try:
        code = reports.save(report, minecraft_name=name or None, country=_country(request), user=user)
    except reports.BadReport:
        raise HTTPException(400, detail="bad_report") from None
    return {"code": code}


@diagnostic_router.get("/reports")
def list_reports(request: Request, response: Response):
    require_staff_account(request, "view_diagnostics")
    response.headers["Cache-Control"] = "no-store"
    return {"reports": reports.recent()}


@diagnostic_router.get("/reports/{code}")
def get_report(code: str, request: Request, response: Response):
    require_staff_account(request, "view_diagnostics")
    response.headers["Cache-Control"] = "no-store"
    found = reports.get(code)
    if found is None:
        raise HTTPException(404, detail="report_not_found")
    return found
