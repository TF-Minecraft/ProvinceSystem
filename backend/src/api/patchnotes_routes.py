"""Staff review API for weekly patch note bullets.

Create and queue routes are staff-only. The public week routes return approved
bullets and never include a deny reason.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

import psycopg2
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from src.api.map_access import require_site_staff
from src.patchnotes.db import (
    BulletNotFound,
    BulletNotPending,
    PatchnotesConfigError,
    PatchnotesDBError,
    approve_bullet,
    deny_bullet,
    insert_bullet,
    list_approved,
    list_pending,
    list_published_notes,
    list_published_weeks,
    migrate,
    parse_week,
)
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


@patchnotes_router.get("")
def published_notes():
    """Every approved week in one response, newest first."""
    try:
        migrate()
        weeks = list_published_notes()
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
        ]
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


@patchnotes_router.post("/staff/bullets", dependencies=[Depends(_staff_guard)])
def staff_create_bullet(body: CreateBulletBody):
    try:
        migrate()
        row = insert_bullet(section=body.section, body=body.body, week=body.week)
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_create_bullet failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return _serialize(row, public=False)


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
