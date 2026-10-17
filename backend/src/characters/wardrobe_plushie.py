"""Generate static miniature textures without holding up plugin HTTP requests."""

import hashlib
import json
import logging
import time
from pathlib import Path

from src.characters import wardrobe
from src.characters.miniskin import miniature_png
from src.characters.wardrobe_sign import sign_wardrobe_skin
from src.scripts.util.atomic import _write_atomic
from src.scripts.util.maplock import MapLockBusy, map_lock

logger = logging.getLogger("characters.plushie")
CACHE_VERSION = "miniskin-v1"
RETRY_SECONDS = 30


def _cache_path(source: str) -> Path:
    return wardrobe.DATA_DIR / "plushies" / f"{source}.json"


def _cached(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
        if isinstance(data, dict):
            if all(isinstance(data.get(k), str) and data[k] for k in ("value", "signature")):
                return data
            if (isinstance(data.get("retry_at"), (int, float)) and data["retry_at"] > time.time()
                    and isinstance(data.get("error"), str) and data["error"]
                    and isinstance(data.get("status_code"), int) and 400 <= data["status_code"] < 600):
                return data
    except (OSError, ValueError):
        pass
    return {}


def prepare_plushie(player_uuid: str, character_id: str, slot: str, source: str | None = None) -> tuple[dict, bytes]:
    # Snapshot the PNG with its signed row, before any upload/compaction can
    # replace that filename. The slow MineSkin request never takes this guard.
    with wardrobe.assets.asset_guard():
        result = wardrobe.wardrobe_slot_texture(player_uuid, character_id, slot)
        if not result["value"] or not result["signature"]:
            raise wardrobe.WardrobeError("Wardrobe outfit has no ready skin", status_code=409)
        path = wardrobe.resolve_slot_texture_path(player_uuid, character_id, slot)
        try:
            png = miniature_png(path.read_bytes())
        except (OSError, ValueError) as exc:
            raise wardrobe.WardrobeError("Wardrobe outfit texture is invalid", status_code=409) from exc
    digest = hashlib.sha256(CACHE_VERSION.encode() + b"\0" + png).hexdigest()
    if source is not None and source != digest:
        raise wardrobe.WardrobeError("Wardrobe outfit changed while generating the plushie", status_code=409)
    cached = _cached(_cache_path(digest))
    if cached.get("error"):
        raise wardrobe.WardrobeError(cached["error"], status_code=int(cached["status_code"]))
    result.update(status="ready" if cached else "pending", source=digest,
                  value=cached.get("value"), signature=cached.get("signature"))
    return result, png


def generate_plushie(source: str, png: bytes) -> None:
    path = _cache_path(source)
    try:
        with map_lock(str(path.with_suffix(".lock")), blocking=False):
            if _cached(path):
                return
            try:
                value, signature = sign_wardrobe_skin(png, "classic")
                if not value or not signature:
                    raise wardrobe.WardrobeError("Skin signing returned incomplete data", status_code=502)
                data = {"value": value, "signature": signature}
            except Exception as exc:
                if isinstance(exc, wardrobe.WardrobeError):
                    message, status = str(exc), exc.status_code
                else:
                    logger.exception("Plushie generation failed")
                    message, status = "Plushie generation failed, try again shortly", 502
                data = {"error": message, "status_code": status, "retry_at": time.time() + RETRY_SECONDS}
            _write_atomic(str(path), json.dumps(data).encode(), prefix=".plushie-")
    except MapLockBusy:
        # Another thread or worker is already generating this same texture.
        return
