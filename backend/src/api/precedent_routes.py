"""Precedent lookup API: staff log past cases, search for precedent on a new case."""

from __future__ import annotations

import logging
import time
from collections import defaultdict

import psycopg2
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from src.api.staff_access import require_staff_account, staff_name
from src.precedent.db import (
    MAX_RELEVANT_DISTANCE,
    AuditActor,
    PrecedentDBError,
    PrecedentNotConfiguredError,
    count_cases,
    delete_case,
    get_case,
    insert_case,
    list_cases,
    migrate,
    ping_db,
    search_similar,
    update_case,
)
from src.precedent.embeddings import EmbeddingError, embed
from src.precedent.synthesis import SynthesisError, synthesize
from src.skins.auth import HEADER_STAFF_KEY, require_staff_key

logger = logging.getLogger("precedent.routes")

precedent_router = APIRouter(prefix="/precedent", tags=["precedent"])

_SEARCH_RATE_BUCKETS: dict[str, list[float]] = defaultdict(list)
_SEARCH_RATE_LIMIT = 10
_SEARCH_RATE_WINDOW_SEC = 60.0


def _check_search_rate(client_ip: str) -> None:
    """Light rate limit: each search costs a Voyage embed + a Claude call."""
    now = time.monotonic()
    key = (client_ip or "").strip() or "unknown"
    bucket = _SEARCH_RATE_BUCKETS[key]
    cutoff = now - _SEARCH_RATE_WINDOW_SEC
    bucket[:] = [t for t in bucket if t > cutoff]
    if len(bucket) >= _SEARCH_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many precedent search requests")
    bucket.append(now)


def _client_detail(e: Exception) -> str:
    """Generic, non-leaky detail for the caller. Full exception is logged server-side."""
    if isinstance(e, PrecedentNotConfiguredError):
        return "Precedent isn't set up on this site."
    if isinstance(e, PrecedentDBError):
        return "Precedent database is unavailable. Check server logs."
    if isinstance(e, EmbeddingError):
        return "Embedding service is unavailable. Check server logs."
    if isinstance(e, SynthesisError):
        return "Synthesis service is unavailable. Check server logs."
    return "Precedent request failed. Check server logs."


def _unavailable(e: Exception) -> HTTPException:
    # 503, not 502: Cloudflare replaces an origin 502 with its own error, hiding the detail.
    return HTTPException(status_code=503, detail=_client_detail(e))


def _require_staff(x_staff_key: str | None) -> None:
    try:
        require_staff_key(x_staff_key)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid or missing staff key") from e


def _require_staff_or_account(
    request: Request,
    x_staff_key: str | None,
    *,
    write: bool = False,
) -> dict | None:
    """Accept either the shared bot key or a staff panel account.

    Two clients reach these routes: the Discord bot / plugins, which hold the
    shared STAFF_KEY, and the staff panel, which must never ship that secret to a
    browser and instead authenticates the individual staff member by their
    website role. Returns the account for the panel path, None for the key path
    (which has no identity).
    """
    if x_staff_key is not None:
        _require_staff(x_staff_key)
        return None
    # No key at all: fall through to the account path, which raises 401/403 itself.
    return require_staff_account(request, "use_precedent", write=write)


def _audit_actor(user: dict | None, fallback: str) -> AuditActor:
    """Who to record for a write.

    Panel writes carry a verified staff account, so the audit trail names them.
    Bot writes authenticate with the shared STAFF_KEY, which proves only that
    the caller holds the key -- the name recorded there is caller-supplied and
    marked `source='bot'` so it is not mistaken for proof.
    """
    if user is None:
        return AuditActor(source="bot", actor=fallback)
    name, uuid = staff_name(user)
    return AuditActor(source="web", actor=name, actor_uuid=uuid)


def _logged_by(user: dict | None, fallback: str) -> str:
    """Panel callers get an authenticated logged_by; the bot keeps its own value.

    Prevents a signed-in staff member from attributing a case to someone else.
    """
    if user is None:
        return fallback
    return staff_name(user)[0]


class LogCaseBody(BaseModel):
    logged_by: str = Field(..., min_length=1, max_length=200)
    players: list[str] = Field(default_factory=list, max_length=20)
    summary: str = Field(..., min_length=1, max_length=1000)
    rule: str = Field(default="", max_length=200)
    ruling: str = Field(default="", max_length=500)
    punishment: str = Field(default="", max_length=200)

    @field_validator("players")
    @classmethod
    def _cap_player_len(cls, v: list[str]) -> list[str]:
        for p in v:
            if len(p) > 200:
                raise ValueError("player name too long (max 200 chars)")
        return v


class SearchBody(BaseModel):
    query: str = Field(..., min_length=1)
    players: list[str] = Field(default_factory=list)


def _case_text(body: LogCaseBody) -> str:
    """Text that gets embedded: the incident description only.

    Deliberately excludes rule/ruling/punishment. A search query is always a
    description of what happened -- staff cannot cite the rule number from
    memory, and the ruling and punishment are precisely what they are asking
    for. Embedding them put half the stored vector's content beyond anything a
    query could ever match, which held even exact-wording matches well away
    from the top of the scale.

    Changing this invalidates every stored embedding: re-embed the corpus
    (backfill_embeddings.py) rather than letting old and new rows coexist.
    """
    return body.summary


def _serialize_match(row: dict) -> dict:
    row = dict(row)
    row.pop("embedding", None)
    row["id"] = str(row["id"])
    if row.get("created_at") is not None:
        row["created_at"] = row["created_at"].isoformat()
    return row


@precedent_router.post("/staff/log")
def staff_log_case(
    body: LogCaseBody,
    request: Request,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    user = _require_staff_or_account(request, x_staff_key, write=True)
    try:
        migrate()
        vector = embed(_case_text(body))
        case_id = insert_case(
            logged_by=_logged_by(user, body.logged_by),
            players=body.players,
            summary=body.summary,
            rule=body.rule,
            ruling=body.ruling,
            punishment=body.punishment,
            embedding=vector,
            actor=_audit_actor(user, body.logged_by),
        )
    except (PrecedentDBError, EmbeddingError) as e:
        logger.exception("staff_log_case failed")
        raise _unavailable(e) from e
    return {"id": case_id}


@precedent_router.post("/staff/search")
def staff_search_precedent(
    body: SearchBody,
    request: Request,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    user = _require_staff_or_account(request, x_staff_key, write=True)
    # Bucket panel callers per staff member: behind a reverse proxy every browser
    # shares one client IP and would otherwise contend for a single 10/60s budget.
    if user is not None:
        _check_search_rate(f"account:{user['user_id']}")
    else:
        _check_search_rate(request.client.host if request.client else "")
    try:
        migrate()
        vector = embed(body.query)
        matches = search_similar(vector, limit=3, players=body.players, query_text=body.query)
        synthesis = synthesize(body.query, matches)
    except (PrecedentDBError, EmbeddingError, SynthesisError) as e:
        logger.exception("staff_search_precedent failed")
        raise _unavailable(e) from e
    return {
        "matches": [_serialize_match(m) for m in matches],
        "synthesis": synthesis,
        "max_distance": MAX_RELEVANT_DISTANCE,
    }


@precedent_router.get("/staff/cases")
def staff_list_cases(
    request: Request,
    limit: int = 500,
    offset: int = 0,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    """Browse the corpus. Plain SELECT — no Voyage embed, no Claude call."""
    _require_staff_or_account(request, x_staff_key)
    limit = max(1, min(int(limit), 1000))
    offset = max(0, int(offset))
    try:
        migrate()
        cases = list_cases(limit=limit, offset=offset)
        total = count_cases()
    except PrecedentDBError as e:
        logger.exception("staff_list_cases failed")
        raise _unavailable(e) from e
    return {"cases": [_serialize_match(c) for c in cases], "total": total}


@precedent_router.put("/staff/case/{case_id}")
def staff_update_case(
    case_id: str,
    body: LogCaseBody,
    request: Request,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    """Full-row edit. Re-embeds so the stored vector matches the new text."""
    user = _require_staff_or_account(request, x_staff_key, write=True)
    try:
        migrate()
        vector = embed(_case_text(body))
        updated = update_case(
            case_id,
            logged_by=_logged_by(user, body.logged_by),
            players=body.players,
            summary=body.summary,
            rule=body.rule,
            ruling=body.ruling,
            punishment=body.punishment,
            embedding=vector,
            actor=_audit_actor(user, body.logged_by),
        )
    except psycopg2.Error:
        raise HTTPException(status_code=400, detail="Invalid case id")
    except (PrecedentDBError, EmbeddingError) as e:
        logger.exception("staff_update_case failed")
        raise _unavailable(e) from e
    if not updated:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"updated": True, "id": case_id}


@precedent_router.get("/staff/case/{case_id}")
def staff_get_case(
    case_id: str,
    request: Request,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff_or_account(request, x_staff_key)
    try:
        migrate()
        case = get_case(case_id)
    except psycopg2.Error:
        raise HTTPException(status_code=400, detail="Invalid case id")
    except PrecedentDBError as e:
        logger.exception("staff_get_case failed")
        raise _unavailable(e) from e
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return _serialize_match(case)


@precedent_router.delete("/staff/case/{case_id}")
def staff_delete_case(
    case_id: str,
    request: Request,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    user = _require_staff_or_account(request, x_staff_key, write=True)
    try:
        migrate()
        deleted = delete_case(case_id, actor=_audit_actor(user, ""))
    except psycopg2.Error:
        raise HTTPException(status_code=400, detail="Invalid case id")
    except PrecedentDBError as e:
        logger.exception("staff_delete_case failed")
        raise _unavailable(e) from e
    if not deleted:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"deleted": True, "id": case_id}


@precedent_router.get("/staff/ping")
def staff_ping(
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        ping_db()
    except PrecedentDBError as e:
        logger.exception("staff_ping failed")
        raise _unavailable(e) from e
    return {"ok": True}
