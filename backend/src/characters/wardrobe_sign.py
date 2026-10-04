"""MineSkin v2 signing for character wardrobe skins."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

logger = logging.getLogger("wardrobe.mineskin")

MINESKIN_QUEUE_URL = "https://api.mineskin.org/v2/queue"
USER_AGENT = "TFMC-ProvinceSystem/wardrobe"
POLL_INTERVAL_SEC = 1.5
POLL_MAX_SEC = 60.0
# Free tier: private visibility may 403; unlisted keeps skins out of public gallery listing intent.
DEFAULT_VISIBILITY = "unlisted"


def _api_key() -> str:
    return (os.environ.get("MINESKIN_API_KEY") or "").strip()


def _multipart_body(
    png_bytes: bytes, variant: str, visibility: str
) -> tuple[bytes, str]:
    boundary = f"----tfmcwardrobe{uuid.uuid4().hex}"
    lines: list[bytes] = []

    def field(name: str, value: str) -> None:
        lines.append(f"--{boundary}\r\n".encode())
        lines.append(
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        )
        lines.append(value.encode() + b"\r\n")

    field("variant", variant)
    field("visibility", visibility)

    lines.append(f"--{boundary}\r\n".encode())
    lines.append(
        b'Content-Disposition: form-data; name="file"; '
        b'filename="skin.png"\r\n'
    )
    lines.append(b"Content-Type: image/png\r\n\r\n")
    lines.append(png_bytes)
    lines.append(b"\r\n")
    lines.append(f"--{boundary}--\r\n".encode())
    return b"".join(lines), boundary


def _headers(api_key: str, content_type: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": USER_AGENT,
        "MineSkin-User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _friendly_mineskin_detail(raw: str, status: int) -> str:
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        data = {}
    if isinstance(data, dict):
        err = data.get("error") or data.get("message") or data.get("detail")
        if isinstance(err, dict):
            err = err.get("message") or err.get("code")
        if isinstance(err, str) and err.strip():
            return err.strip()[:200]
    return f"Skin signing failed (HTTP {status})"


def _http_json(
    method: str,
    url: str,
    api_key: str,
    body: bytes | None = None,
    content_type: str | None = None,
) -> tuple[int, dict]:
    req = urllib.request.Request(
        url,
        data=body,
        headers=_headers(api_key, content_type),
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = resp.getcode() or 200
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        status = int(e.code)
        detail = _friendly_mineskin_detail(raw, status)
        if status == 429:
            from src.characters.wardrobe import WardrobeError

            raise WardrobeError(
                "Too many skin requests, try again shortly",
                status_code=429,
            ) from e
        logger.warning(
            "[mineskin] HTTP %s %s detail=%s",
            status,
            url.split("?")[0],
            detail,
        )
        from src.characters.wardrobe import WardrobeError

        raise WardrobeError(
            detail if status < 500 else "Skin signing failed, try again later",
            status_code=502 if status >= 500 or status == 403 else status,
        ) from e
    except urllib.error.URLError as e:
        logger.warning("[mineskin] network error: %s", type(e).__name__)
        from src.characters.wardrobe import WardrobeError

        raise WardrobeError(
            "Skin signing unavailable, try again later",
            status_code=502,
        ) from e

    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        logger.warning("[mineskin] invalid JSON status=%s", status)
        from src.characters.wardrobe import WardrobeError

        raise WardrobeError(
            "Skin signing returned invalid data",
            status_code=502,
        ) from e
    if not isinstance(data, dict):
        from src.characters.wardrobe import WardrobeError

        raise WardrobeError(
            "Skin signing returned invalid data",
            status_code=502,
        )
    return status, data


def _extract_texture(payload: dict) -> tuple[str, str] | None:
    """Pull value+signature from V2 job/skin payload shapes."""
    skin = payload.get("skin")
    if not isinstance(skin, dict):
        # Sometimes nested under data
        data = payload.get("data")
        if isinstance(data, dict):
            skin = data.get("skin") if isinstance(data.get("skin"), dict) else data
    if not isinstance(skin, dict):
        return None
    texture = skin.get("texture")
    if not isinstance(texture, dict):
        return None
    data = texture.get("data")
    if not isinstance(data, dict):
        # The texture may carry value and signature directly.
        value = texture.get("value")
        signature = texture.get("signature")
        if isinstance(value, str) and isinstance(signature, str) and value and signature:
            return value, signature
        return None
    value = data.get("value")
    signature = data.get("signature")
    if isinstance(value, str) and isinstance(signature, str) and value and signature:
        return value, signature
    return None


def _job_id(payload: dict) -> str | None:
    job = payload.get("job")
    if isinstance(job, dict):
        jid = job.get("id") or job.get("uuid")
        if jid:
            return str(jid)
    for key in ("jobId", "job_id", "id"):
        if payload.get(key):
            # Avoid treating skin id as job id when skin already present
            if key == "id" and _extract_texture(payload):
                continue
            return str(payload[key])
    return None


def _job_status(payload: dict) -> str:
    job = payload.get("job")
    if isinstance(job, dict) and job.get("status"):
        return str(job["status"]).strip().lower()
    if payload.get("status"):
        return str(payload["status"]).strip().lower()
    return ""


def sign_wardrobe_skin(png_bytes: bytes, model: str) -> tuple[str, str]:
    """Queue PNG with MineSkin and return (texture_value, texture_signature).

    Raises WardrobeError on missing key, rate limit, or MineSkin failure.
    """
    from src.characters.wardrobe import WardrobeError

    api_key = _api_key()
    if not api_key:
        logger.warning("[mineskin] MINESKIN_API_KEY is not set")
        raise WardrobeError(
            "Skin signing is not configured",
            status_code=503,
        )

    variant = (model or "classic").strip().lower()
    if variant not in ("classic", "slim"):
        variant = "classic"

    body, boundary = _multipart_body(png_bytes, variant, DEFAULT_VISIBILITY)
    status, payload = _http_json(
        "POST",
        MINESKIN_QUEUE_URL,
        api_key,
        body=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )

    pair = _extract_texture(payload)
    if pair:
        return pair

    job_id = _job_id(payload)
    if not job_id:
        logger.warning(
            "[mineskin] queue response missing job/skin status=%s keys=%s",
            status,
            list(payload.keys())[:12],
        )
        raise WardrobeError(
            "Skin signing failed, try again later",
            status_code=502,
        )

    deadline = time.monotonic() + POLL_MAX_SEC
    while time.monotonic() < deadline:
        time.sleep(POLL_INTERVAL_SEC)
        _, job_payload = _http_json(
            "GET",
            f"{MINESKIN_QUEUE_URL}/{job_id}",
            api_key,
        )
        st = _job_status(job_payload)
        pair = _extract_texture(job_payload)
        if pair:
            return pair
        if st in ("failed", "error", "cancelled", "canceled"):
            logger.warning("[mineskin] job %s status=%s", job_id, st)
            raise WardrobeError(
                "Skin signing failed, try again later",
                status_code=502,
            )
        if st in ("completed", "done", "success") and not pair:
            logger.warning(
                "[mineskin] job %s completed without texture keys=%s",
                job_id,
                list(job_payload.keys())[:12],
            )
            raise WardrobeError(
                "Skin signing returned incomplete data",
                status_code=502,
            )

    logger.warning("[mineskin] job %s timed out after %ss", job_id, int(POLL_MAX_SEC))
    raise WardrobeError(
        "Skin signing timed out, try again later",
        status_code=502,
    )
