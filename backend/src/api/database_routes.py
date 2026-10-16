"""Root's database studio. Every browse, query and edit is audited with its SQL."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, StrictBool

from src.api.auth_routes import _no_store
from src.api.staff_access import require_staff_account
from src.auth import audit
from src.dbstudio import studio
from src.skins.db import connect

database_router = APIRouter(prefix="/admin/database", tags=["admin"])

# Enough to read back what ran; very long statements are cut.
AUDIT_SQL = 2000


class QueryBody(BaseModel):
    sql: str = Field(..., max_length=studio.MAX_SQL)
    write: StrictBool = False


class BrowseBody(BaseModel):
    table: str = Field(..., max_length=200)
    offset: int = Field(0, ge=0, le=10**12)
    limit: int = Field(100, ge=1, le=studio.MAX_PAGE)
    order: str | None = Field(None, max_length=200)
    descending: StrictBool = False
    where: str = Field("", max_length=4000)


def _refuse(exc: studio.StudioError):
    raise HTTPException(exc.status, detail=exc.message or exc.code)


def _audited(actor: dict, source_id: str, sql: str, write: bool, run, action: str | None = None):
    detail = {"database": source_id, "sql": sql[:AUDIT_SQL]}
    action = action or ("database.write" if write else "database.read")
    if write:
        # Logged before the edit runs: if the audit log can't be written, nothing changes.
        audit.record_refusal(actor=actor, action=action, outcome="requested", detail=detail)
    try:
        result = run()
    except studio.StudioError as exc:
        audit.record_refusal(actor=actor, action=action, outcome="failed", detail={**detail, "error": exc.code})
        _refuse(exc)
    rows = result.get("rows")
    audit.record_refusal(actor=actor, action=action, outcome="ok",
                         detail={**detail, **({"rows": len(rows), "changes": result.get("changes")} if rows is not None else {})})
    return result


@database_router.get("")
def database_overview(request: Request, response: Response):
    actor = require_staff_account(request, "use_database")
    _no_store(response)
    with connect() as conn:
        counts = dict(conn.execute(
            "SELECT json_extract(detail_json, '$.database'), count(*) FROM admin_audit "
            "WHERE action IN ('database.read', 'database.write') AND outcome IN ('ok', 'failed') "
            "GROUP BY 1").fetchall())
    return _audited(actor, "*", "list databases", False, lambda: studio.overview(counts), "database.list")


@database_router.get("/{source_id}/schema")
def database_schema(source_id: str, request: Request, response: Response):
    actor = require_staff_account(request, "use_database")
    _no_store(response)
    return _audited(actor, source_id, "schema", False,
                    lambda: {**studio.schema(source_id), "database": _describe(source_id)}, "database.schema")


@database_router.post("/{source_id}/browse")
def database_browse(source_id: str, body: BrowseBody, request: Request, response: Response):
    actor = require_staff_account(request, "use_database", write=True)
    _no_store(response)
    where = f" WHERE {body.where.strip()}" if body.where.strip() else ""
    return _audited(actor, source_id, f"browse {body.table}{where}", False, lambda: studio.browse(
        source_id, body.table, offset=body.offset, limit=body.limit, order=body.order,
        descending=body.descending, where=body.where))


@database_router.post("/{source_id}/query")
def database_query(source_id: str, body: QueryBody, request: Request, response: Response):
    actor = require_staff_account(request, "use_database", write=True)
    _no_store(response)
    return _audited(actor, source_id, body.sql.strip(), body.write,
                    lambda: studio.run(source_id, body.sql, write=body.write).json())


def _describe(source_id: str) -> dict:
    item = studio.source(source_id)
    return {"id": item.id, "name": item.name, "engine": item.engine, "writable": item.writable, "detail": item.detail}
