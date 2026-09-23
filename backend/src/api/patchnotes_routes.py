"""Staff review API for weekly patch note bullets.

Create and queue routes are staff-only. The public week routes return approved
bullets and never include a deny reason.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

import psycopg2
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from src.api.map_access import require_site_staff
from src.patchnotes.db import (
    BulletNotFound,
    BulletNotPending,
    PatchnotesConfigError,
    PatchnotesDBError,
    approve_bullet,
    current_week,
    deny_bullet,
    insert_bullet,
    insert_sourced_bullet,
    list_approved,
    list_pending,
    list_published_notes,
    list_published_weeks,
    load_preview,
    migrate,
    parse_week,
    replace_preview,
)
from src.patchnotes.safety import hidden_knowledge_warning
from src.patchnotes.summarize import signature_ok, summarize_push
from src.skins.auth import HEADER_STAFF_KEY, require_staff_key

logger = logging.getLogger("patchnotes.routes")

patchnotes_router = APIRouter(prefix="/patchnotes", tags=["patchnotes"])

SectionName = Literal["new", "fixed", "adjusted", "technical"]


def _require_staff(x_staff_key: str | None) -> None:
    try:
        require_staff_key(x_staff_key)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid or missing staff key") from e


def _require_staff_or_session(
    x_staff_key: str | None,
    authorization: str | None,
) -> None:
    """Accept the shared bot key or a site-staff Bearer session."""
    if x_staff_key is not None:
        _require_staff(x_staff_key)
        return
    require_site_staff(authorization)


def _staff_guard(
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
    authorization: str | None = Header(default=None),
) -> None:
    """Run before body validation so a missing key is 401, not 422."""
    _require_staff_or_session(x_staff_key, authorization)


def _client_detail(exc: Exception) -> str:
    if isinstance(exc, PatchnotesDBError):
        return "Patch notes database is unavailable. Check server logs."
    if isinstance(exc, PatchnotesConfigError):
        return "Patch notes are misconfigured. Check server logs."
    return "Patch notes request failed. Check server logs."


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def _serialize(row: dict[str, Any], *, public: bool) -> dict[str, Any]:
    payload = {
        "id": str(row["id"]),
        "week": row["week"],
        "section": row["section"],
        "body": row["body"],
        "created_at": _iso(row.get("created_at")),
    }
    if public:
        return payload
    payload["status"] = row["status"]
    payload["deny_reason"] = row.get("deny_reason")
    payload["reviewed_at"] = _iso(row.get("reviewed_at"))
    warning = hidden_knowledge_warning(str(row.get("body") or ""))
    if warning:
        payload["warning"] = warning
    return payload


def _week_or_400(week: str) -> str:
    try:
        return parse_week(week)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid week") from e


class CreateBulletBody(BaseModel):
    section: SectionName
    body: str = Field(..., min_length=1, max_length=1000)
    week: str | None = None
    source_key: str | None = None

    @field_validator("body")
    @classmethod
    def _strip_body(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("body is required")
        return text

    @field_validator("week")
    @classmethod
    def _check_week(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return parse_week(value)

    @field_validator("source_key")
    @classmethod
    def _check_source(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text or len(text) > 200:
            raise ValueError("source_key is invalid")
        return text


class DenyBulletBody(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def _strip_reason(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("reason is required")
        return text


def _bullet_id_or_404(bullet_id: str) -> str:
    """A non-UUID never reaches Postgres, so a bad id is the same as a missing row."""
    try:
        return str(uuid.UUID(bullet_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail="Bullet not found") from e


def _review_http(exc: Exception) -> HTTPException:
    if isinstance(exc, BulletNotFound):
        return HTTPException(status_code=404, detail="Bullet not found")
    if isinstance(exc, BulletNotPending):
        return HTTPException(status_code=409, detail="Bullet is not pending")
    if isinstance(exc, ValueError):
        return HTTPException(status_code=422, detail=str(exc))
    raise exc


_PUBLISHED_PAGE_LIMIT = 52


@patchnotes_router.get("")
def published_notes(limit: int = 8, before: str | None = None):
    """A bounded page of approved weeks, newest first.

    `before` is an exclusive week cursor. `has_more` is true when an older week
    exists past this page.
    """
    if limit < 1 or limit > _PUBLISHED_PAGE_LIMIT:
        raise HTTPException(status_code=400, detail="limit must be from 1 to 52")
    before_key = _week_or_400(before) if before else None
    try:
        migrate()
        weeks, has_more = list_published_notes(limit=limit, before=before_key)
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("published_notes failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return {
        "weeks": [
            {
                "week": week["week"],
                "bullets": [_serialize(row, public=True) for row in week["bullets"]],
            }
            for week in weeks
        ],
        "has_more": has_more,
    }


@patchnotes_router.get("/weeks")
def published_weeks():
    """Weeks that have at least one approved bullet, newest first."""
    try:
        migrate()
        weeks = list_published_weeks()
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("published_weeks failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return {"weeks": weeks}


@patchnotes_router.get("/weeks/{week}")
def published_week(week: str):
    """Approved bullets for one week. Pending and denied rows are omitted."""
    week_key = _week_or_400(week)
    try:
        migrate()
        bullets = list_approved(week_key)
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("published_week failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return {"week": week_key, "bullets": [_serialize(row, public=True) for row in bullets]}


_WEBHOOK_MAX_BYTES = 1_000_000


@patchnotes_router.post("/github")
async def github_push(request: Request):
    """Create pending bullets from a signed push to the default branch.

    Set GITHUB_WEBHOOK_SECRET and point the TF-Minecraft webhook at this route.
    Nothing here is published. Staff still approve or deny each line.
    """
    raw = await request.body()
    if len(raw) > _WEBHOOK_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")
    secret = os.environ.get("GITHUB_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="GitHub webhook is not configured")
    if not signature_ok(raw, request.headers.get("X-Hub-Signature-256"), secret):
        raise HTTPException(status_code=401, detail="Invalid signature")
    event = (request.headers.get("X-GitHub-Event") or "").strip().lower()
    if event == "ping":
        return {"ok": True}
    if event != "push":
        return {"ok": True, "ignored": True}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail="Invalid JSON") from e
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON")
    notes = summarize_push(payload)
    if not notes.accepted:
        return {"ok": True, "ignored": True, "created": 0}
    created = 0
    duplicates = 0
    try:
        migrate()
        for draft in notes.drafts:
            try:
                row = insert_sourced_bullet(
                    section=draft.section,
                    body=draft.body,
                    source_key=draft.source_key,
                )
            except ValueError:
                logger.exception("Skipping a patch note draft that failed validation")
                continue
            if row is None:
                duplicates += 1
            else:
                created += 1
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("github_push failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    if notes.withheld:
        logger.warning("Withheld %s patch note line(s) from a GitHub push", notes.withheld)
    return {
        "ok": True,
        "created": created,
        "duplicates": duplicates,
        "withheld": notes.withheld,
    }


@patchnotes_router.post("/staff/bullets", dependencies=[Depends(_staff_guard)])
def staff_create_bullet(body: CreateBulletBody):
    try:
        migrate()
        if body.source_key:
            row = insert_sourced_bullet(
                section=body.section,
                body=body.body,
                source_key=body.source_key,
            )
            if row is None:
                return {"duplicate": True, "source_key": body.source_key}
        else:
            row = insert_bullet(section=body.section, body=body.body, week=body.week)
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_create_bullet failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return _serialize(row, public=False)


class PreviewBody(BaseModel):
    week: str | None = None

    @field_validator("week")
    @classmethod
    def _check_week(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return parse_week(value)


def _preview_snapshot(week: str) -> list[dict[str, str]]:
    """Approved lines plus anything still waiting, without review fields."""
    approved = list_approved(week)
    seen = {str(row["id"]) for row in approved}
    pending = [row for row in list_pending(week) if str(row["id"]) not in seen]
    return [
        {"id": str(row["id"]), "section": str(row["section"]), "body": str(row["body"])}
        for row in approved + pending
    ]


def _preview_payload(row: dict[str, Any]) -> dict[str, Any]:
    bullets = row.get("bullets") if isinstance(row.get("bullets"), list) else []
    clean = []
    for bullet in bullets:
        if not isinstance(bullet, dict):
            continue
        clean.append(
            {
                "id": str(bullet.get("id") or ""),
                "section": bullet.get("section"),
                "body": bullet.get("body"),
            }
        )
    return {
        "week": row["week"],
        "expires_at": _iso(row.get("expires_at")),
        "bullets": clean,
    }


@patchnotes_router.post("/staff/preview", dependencies=[Depends(_staff_guard)])
def staff_create_preview(body: PreviewBody):
    """Save this week's notes as a staff-only page that expires in one hour."""
    week_key = body.week or current_week()
    try:
        migrate()
        row = replace_preview(week=week_key, bullets=_preview_snapshot(week_key))
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_create_preview failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return _preview_payload(row)


@patchnotes_router.get("/staff/preview", dependencies=[Depends(_staff_guard)])
def staff_read_preview():
    """The test note, if it has not expired. Missing and expired both 404."""
    try:
        migrate()
        row = load_preview()
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_read_preview failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    if row is None:
        raise HTTPException(status_code=404, detail="No test preview")
    return _preview_payload(row)


@patchnotes_router.get("/staff/queue", dependencies=[Depends(_staff_guard)])
def staff_queue(week: str | None = None):
    """Pending bullets, oldest first."""
    week_key = _week_or_400(week) if week is not None else None
    try:
        migrate()
        rows = list_pending(week_key)
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_queue failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return {"bullets": [_serialize(row, public=False) for row in rows]}


@patchnotes_router.post("/staff/bullets/{bullet_id}/approve", dependencies=[Depends(_staff_guard)])
def staff_approve_bullet(bullet_id: str):
    bullet_id = _bullet_id_or_404(bullet_id)
    try:
        migrate()
        row = approve_bullet(bullet_id)
    except (BulletNotFound, BulletNotPending, ValueError) as e:
        raise _review_http(e) from e
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_approve_bullet failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return _serialize(row, public=False)


@patchnotes_router.post("/staff/bullets/{bullet_id}/deny", dependencies=[Depends(_staff_guard)])
def staff_deny_bullet(bullet_id: str, body: DenyBulletBody):
    bullet_id = _bullet_id_or_404(bullet_id)
    try:
        migrate()
        row = deny_bullet(bullet_id, body.reason)
    except (BulletNotFound, BulletNotPending, ValueError) as e:
        raise _review_http(e) from e
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_deny_bullet failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return _serialize(row, public=False)
