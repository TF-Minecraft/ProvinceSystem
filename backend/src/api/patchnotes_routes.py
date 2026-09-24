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
    WeekNotPostponed,
    WeekPostponed,
    approve_bullet,
    approve_pending_week,
    add_folder_rule,
    current_week,
    defer_postponed_week,
    deny_bullet,
    ensure_folder,
    get_bullet,
    get_folder,
    get_week_status,
    apply_feedback,
    insert_bullet,
    insert_sourced_bullet,
    list_approved,
    list_folders,
    list_open_bullets,
    list_pending,
    list_published_notes,
    list_published_weeks,
    list_sync_tasks,
    load_preview,
    migrate,
    observe_folder,
    parse_week,
    postpone_week,
    queue_sync_task,
    remove_added_folder,
    replace_preview,
    request_added_folder,
    reset_week,
    revise_denied_bullet,
    undo_postpone,
)
from src.patchnotes.feedback import FeedbackError, interpret_feedback
from src.patchnotes.folders import catalog_entries, clean_folder_name, safe_rule
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
        "highlight": bool(row.get("highlight")),
    }
    topic = str(row.get("topic") or "").strip()
    if topic:
        payload["topic"] = topic
    if public:
        return payload
    payload["status"] = row["status"]
    payload["deny_reason"] = row.get("deny_reason")
    payload["reviewed_at"] = _iso(row.get("reviewed_at"))
    warning = hidden_knowledge_warning(str(row.get("body") or ""))
    if warning:
        payload["warning"] = warning
    note = str(row.get("revision_note") or "").strip()
    if note:
        payload["revision_note"] = note
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


class FeedbackBody(BaseModel):
    feedback: str = Field(..., min_length=1, max_length=1000)

    @field_validator("feedback")
    @classmethod
    def _strip_feedback(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("feedback is required")
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
            source_key = body.source_key
            # One server-edit note per plugin per week. The watcher omits the week.
            if source_key.startswith("watch:") and source_key.count(":") == 1:
                source_key = f"{source_key}:{current_week()}"
            row = insert_sourced_bullet(
                section=body.section,
                body=body.body,
                source_key=source_key,
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


def _folder_payload(row: dict[str, Any], syncing: set[str]) -> dict[str, Any]:
    rules = row.get("rules") if isinstance(row.get("rules"), list) else []
    unclassified = row.get("unclassified") if isinstance(row.get("unclassified"), list) else []
    return {
        "name": row["name"],
        "origin": row["origin"],
        "repo": row.get("repo"),
        "status": row["status"],
        "dangerous": bool(row.get("dangerous")),
        "reject_reason": row.get("reject_reason"),
        "rules": rules,
        "unclassified": unclassified,
        "sync_task": row["name"] in syncing,
    }


class FolderNameBody(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return clean_folder_name(value)


class FolderCatalogBody(BaseModel):
    present: list[str] = Field(default_factory=list)

    @field_validator("present")
    @classmethod
    def _check_present(cls, value: list[str]) -> list[str]:
        return [clean_folder_name(item) for item in value]


class FolderObservationBody(BaseModel):
    status: Literal["pending", "active", "rejected"]
    rules: list[str] | None = None
    unclassified: list[str] = Field(default_factory=list)
    reject_reason: str | None = None
    dangerous: bool | None = None

    @field_validator("rules")
    @classmethod
    def _check_rules(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return [safe_rule(item) for item in value]

    @field_validator("reject_reason")
    @classmethod
    def _check_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        return text[:300] or None


class FolderTrackBody(BaseModel):
    glob: str

    @field_validator("glob")
    @classmethod
    def _check_glob(cls, value: str) -> str:
        return safe_rule(value)


class SyncTaskBody(BaseModel):
    folder: str

    @field_validator("folder")
    @classmethod
    def _check_folder(cls, value: str) -> str:
        return clean_folder_name(value)


@patchnotes_router.get("/staff/folders", dependencies=[Depends(_staff_guard)])
def staff_list_folders():
    """Repo plugins, content packs, and folders staff added."""
    try:
        migrate()
        rows = list_folders()
        syncing = set(list_sync_tasks(current_week()))
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_list_folders failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return {"folders": [_folder_payload(row, syncing) for row in rows]}


@patchnotes_router.post("/staff/folders", dependencies=[Depends(_staff_guard)])
def staff_add_folder(body: FolderNameBody):
    """Ask the host watcher to verify a plugin folder on TFMCMain."""
    try:
        migrate()
        row = request_added_folder(body.name)
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_add_folder failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return _folder_payload(row, set())


@patchnotes_router.delete("/staff/folders/{name}", dependencies=[Depends(_staff_guard)])
def staff_remove_folder(name: str):
    try:
        folder_name = clean_folder_name(name)
        migrate()
        remove_added_folder(folder_name)
    except BulletNotFound as e:
        raise HTTPException(status_code=404, detail="Folder not found") from e
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_remove_folder failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return {"removed": folder_name}


@patchnotes_router.post("/staff/folders/catalog", dependencies=[Depends(_staff_guard)])
def staff_ensure_catalog(body: FolderCatalogBody):
    """Keep repo plugins and content packs that exist on TFMCMain."""
    present = set(body.present)
    try:
        migrate()
        kept = []
        for entry in catalog_entries():
            if entry["name"] not in present:
                continue
            row = ensure_folder(
                name=entry["name"],
                origin=entry["origin"],
                repo=entry["repo"],
                dangerous=entry["dangerous"],
                rules=entry["rules"],
            )
            kept.append(row["name"])
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_ensure_catalog failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return {"ensured": kept}


@patchnotes_router.post("/staff/folders/{name}/observation", dependencies=[Depends(_staff_guard)])
def staff_observe_folder(name: str, body: FolderObservationBody):
    try:
        folder_name = clean_folder_name(name)
        migrate()
        row = observe_folder(
            name=folder_name,
            status=body.status,
            rules=body.rules,
            unclassified=body.unclassified,
            reject_reason=body.reject_reason,
            dangerous=body.dangerous,
        )
    except BulletNotFound as e:
        raise HTTPException(status_code=404, detail="Folder not found") from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_observe_folder failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return _folder_payload(row, set())


@patchnotes_router.post("/staff/folders/{name}/track", dependencies=[Depends(_staff_guard)])
def staff_track_rule(name: str, body: FolderTrackBody):
    """Extend a folder's rules so a new kind of file can be watched."""
    try:
        folder_name = clean_folder_name(name)
        migrate()
        row = add_folder_rule(folder_name, body.glob)
    except BulletNotFound as e:
        raise HTTPException(status_code=404, detail="Folder not found") from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_track_rule failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return _folder_payload(row, set())


@patchnotes_router.post("/staff/sync-tasks", dependencies=[Depends(_staff_guard)])
def staff_queue_sync_task(body: SyncTaskBody):
    """Queue one Friday task to update GitHub from the main-server files."""
    try:
        migrate()
        row = get_folder(body.folder)
        if row is None or row["origin"] != "repo" or not row.get("repo"):
            raise HTTPException(status_code=404, detail="Folder is not a GitHub plugin")
        created = queue_sync_task(
            folder_name=body.folder,
            repo=str(row["repo"]),
            week=current_week(),
        )
    except HTTPException:
        raise
    except (PatchnotesDBError, PatchnotesConfigError) as e:
        logger.exception("staff_queue_sync_task failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return {"folder": body.folder, "created": created}


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
    try:
        revision = revise_denied_bullet(row, body.reason)
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error, ValueError):
        logger.exception("staff_deny_bullet rewrite failed")
        revision = None
    payload = _serialize(row, public=False)
    payload["revision"] = _serialize(revision, public=False) if revision else None
    return payload


@patchnotes_router.get("/staff/bullets/{bullet_id}", dependencies=[Depends(_staff_guard)])
def staff_get_bullet(bullet_id: str):
    bullet_id = _bullet_id_or_404(bullet_id)
    try:
        migrate()
        row = get_bullet(bullet_id)
    except BulletNotFound as e:
        raise _review_http(e) from e
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_get_bullet failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return _serialize(row, public=False)


def _week_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "week": row["week"],
        "postponed": bool(row.get("postponed")),
        "deferred_to": row.get("deferred_to"),
    }


@patchnotes_router.get("/staff/weeks/{week}", dependencies=[Depends(_staff_guard)])
def staff_week_status(week: str):
    week_key = _week_or_400(week)
    try:
        migrate()
        row = get_week_status(week_key)
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_week_status failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return _week_payload(row)


@patchnotes_router.post("/staff/weeks/{week}/postpone", dependencies=[Depends(_staff_guard)])
def staff_postpone_week(week: str):
    week_key = _week_or_400(week)
    try:
        migrate()
        row = postpone_week(week_key)
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_postpone_week failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return _week_payload(row)


@patchnotes_router.post("/staff/weeks/{week}/undo-postpone", dependencies=[Depends(_staff_guard)])
def staff_undo_postpone(week: str):
    week_key = _week_or_400(week)
    try:
        migrate()
        row = undo_postpone(week_key)
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_undo_postpone failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return _week_payload(row)


@patchnotes_router.post("/staff/weeks/{week}/defer", dependencies=[Depends(_staff_guard)])
def staff_defer_week(week: str):
    week_key = _week_or_400(week)
    try:
        migrate()
        row = defer_postponed_week(week_key)
    except WeekNotPostponed as e:
        raise HTTPException(status_code=409, detail="Week is not postponed") from e
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_defer_week failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return _week_payload(row)


@patchnotes_router.post("/staff/weeks/{week}/auto-approve", dependencies=[Depends(_staff_guard)])
def staff_auto_approve_week(week: str):
    """Approve every line still waiting, except rewrites."""
    week_key = _week_or_400(week)
    try:
        migrate()
        approved = approve_pending_week(week_key)
    except WeekPostponed as e:
        raise HTTPException(status_code=409, detail="Week is postponed") from e
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_auto_approve_week failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return {"week": week_key, "approved": approved}


@patchnotes_router.post("/staff/weeks/{week}/feedback", dependencies=[Depends(_staff_guard)])
def staff_week_feedback(week: str, body: FeedbackBody):
    """Rewrite this week's note from staff feedback. The feedback is not the new text."""
    week_key = _week_or_400(week)
    try:
        migrate()
        current = list_open_bullets(week_key)
        edits = interpret_feedback(current, body.feedback)
        result = apply_feedback(week_key, body.feedback, edits)
    except FeedbackError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_week_feedback failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return {
        "week": week_key,
        "changed": result["changed"],
        "bullets": [_serialize(row, public=False) for row in result["bullets"]],
    }


@patchnotes_router.post("/staff/weeks/{week}/reset", dependencies=[Depends(_staff_guard)])
def staff_reset_week(week: str):
    """Remove every note for a week."""
    week_key = _week_or_400(week)
    try:
        migrate()
        result = reset_week(week_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except (PatchnotesDBError, PatchnotesConfigError, psycopg2.Error) as e:
        logger.exception("staff_reset_week failed")
        raise HTTPException(status_code=502, detail=_client_detail(e)) from e
    return result
