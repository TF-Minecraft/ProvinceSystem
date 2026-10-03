"""Patreon routes. Linking, the OAuth callback and the webhook live here too."""
from __future__ import annotations

import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from src.api.characters_routes import _profile_session_from_auth
from src.skins.auth import AuthError, is_secondary_plugin_key, require_plugin_key, require_staff_key
from src.patreon import linking, service
from src.patreon.config import Config


def require_enabled():
    if not Config.from_env().enabled:
        raise HTTPException(503, detail="patreon_disabled")


def require_staff(request: Request):
    try:
        require_staff_key(request.headers.get("X-Staff-Key"))
    except (AuthError, RuntimeError):
        raise HTTPException(401, detail="invalid_staff_key") from None


def require_plugin(request: Request):
    try:
        key = request.headers.get("X-Plugin-Key")
        require_plugin_key(key)
    except (AuthError, RuntimeError):
        raise HTTPException(401, detail="invalid_plugin_key") from None


def require_writer(request: Request):
    require_plugin(request)
    if is_secondary_plugin_key(request.headers.get("X-Plugin-Key")):
        raise HTTPException(403, detail="patreon_writer_required")


def caller_subject(request: Request, *, discord_user_id=None, player_uuid=None):
    """Reusable any-of-three auth helper for the future link/start route."""
    if request.headers.get("X-Staff-Key"):
        require_staff(request)
        if not discord_user_id:
            raise HTTPException(400, detail="discord_user_id_required")
        return {"discord_user_id": discord_user_id}
    if request.headers.get("X-Plugin-Key"):
        require_plugin(request)
        if not player_uuid:
            raise HTTPException(400, detail="player_uuid_required")
        return {"player_uuid": player_uuid}
    session = _profile_session_from_auth(request.headers.get("Authorization"))
    return {"player_uuid": session["player_uuid"]}


def invoke(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except service.ServiceError as exc:
        raise HTTPException(400, detail=str(exc)) from None


patreon_router = APIRouter(prefix="/patreon", tags=["patreon"], dependencies=[Depends(require_enabled)])
staff = APIRouter(prefix="/staff", dependencies=[Depends(require_staff)])
plugin = APIRouter(prefix="/plugin", dependencies=[Depends(require_writer)])


class SubjectBody(BaseModel):
    discord_user_id: str | None = None
    player_uuid: str | None = None


class StartBody(SubjectBody):
    discord_username: str | None = None
    minecraft_name: str | None = None


class ConfirmBody(BaseModel):
    token: str


class UnlinkBody(SubjectBody):
    patreon_user_id: str | None = None


class LinkBody(SubjectBody):
    patreon_email: str | None = None
    patreon_user_id: str | None = None
    force: bool = False


class AckBody(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=1000)


class ImportLink(BaseModel):
    player_uuid: str
    patreon_email: str


class ImportGrant(BaseModel):
    player_uuid: str
    tier_key: str


class ImportBody(BaseModel):
    links: list[ImportLink] = Field(default_factory=list, max_length=5000)
    grants: list[ImportGrant] = Field(default_factory=list, max_length=5000)
    dry_run: bool = True


@patreon_router.post("/link/start")
def link_start(request: Request, body: StartBody):
    subject = caller_subject(request, discord_user_id=body.discord_user_id, player_uuid=body.player_uuid)
    if not os.getenv("PATREON_CLIENT_ID", "").strip():
        raise HTTPException(503, detail="patreon_client_unconfigured")
    # A profile caller cannot choose the target's UUID or display name.
    profile = not request.headers.get("X-Staff-Key") and not request.headers.get("X-Plugin-Key")
    return invoke(linking.start_link, **subject, discord_username=body.discord_username,
                  minecraft_name=None if profile else body.minecraft_name)


@patreon_router.get("/oauth/callback")
def oauth_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    status, tier = linking.finish_callback(code, state, denied=error is not None)
    response = RedirectResponse(linking.redirect_url(status, tier), status_code=302)
    response.headers["Cache-Control"] = "no-store"
    return response


@patreon_router.post("/link/pending")
def link_pending(body: ConfirmBody, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return linking.pending_link(body.token)


@patreon_router.post("/link/confirm")
def link_confirm(body: ConfirmBody, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return linking.confirm_link(body.token)


@patreon_router.post("/link/cancel")
def link_cancel(body: ConfirmBody, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return linking.cancel_link(body.token)


@patreon_router.post("/webhook")
async def patreon_webhook(request: Request, background: BackgroundTasks):
    raw = await request.body()
    if len(raw) > 1_000_000:
        raise HTTPException(413, detail="invalid_webhook")
    secret = os.getenv("PATREON_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(503, detail="patreon_webhook_unconfigured")
    if not linking.signature_ok(raw, request.headers.get("X-Patreon-Signature"), secret):
        raise HTTPException(401, detail="invalid_signature")
    event = (request.headers.get("X-Patreon-Event") or "").strip().lower()
    if event not in linking.KNOWN_EVENTS:
        return {"ok": True}
    try:
        member_id = linking.member_id_from_webhook(raw)
    except ValueError:
        raise HTTPException(400, detail="invalid_webhook") from None
    linking.record_webhook_member(member_id)
    background.add_task(linking.refresh_webhook_member, member_id)
    return {"ok": True}


@patreon_router.get("/status")
def get_status(request: Request, discord_user_id: str | None = None, player_uuid: str | None = None):
    return invoke(service.status, **caller_subject(request, discord_user_id=discord_user_id, player_uuid=player_uuid))


@patreon_router.post("/link/unlink")
def post_unlink(request: Request, body: SubjectBody | None = None):
    return invoke(service.unlink, **caller_subject(request, **(body or SubjectBody()).model_dump()))


@staff.get("/role-changes")
def role_changes():
    return service.list_changes("discord")


@staff.post("/role-changes/ack")
def role_ack(body: AckBody):
    return service.ack_changes("discord", body.ids)


@staff.get("/roster")
def staff_roster():
    return service.roster("discord")


@plugin.get("/rank-changes")
def rank_changes():
    return service.list_changes("luckperms")


@plugin.post("/rank-changes/ack")
def rank_ack(body: AckBody):
    return service.ack_changes("luckperms", body.ids)


@plugin.get("/roster")
def plugin_roster():
    return service.roster("luckperms")


@staff.get("/lookup")
def lookup(discord_user_id: str | None = None, player_uuid: str | None = None, email: str | None = None, minecraft_name: str | None = None):
    if sum(bool(x) for x in (discord_user_id, player_uuid, email, minecraft_name)) != 1:
        raise HTTPException(400, detail="one_lookup_subject_required")
    return invoke(service.lookup, discord_user_id=discord_user_id, player_uuid=player_uuid, email=email, minecraft_name=minecraft_name)


@staff.post("/link")
def staff_link(body: LinkBody):
    if bool(body.patreon_email) == bool(body.patreon_user_id):
        raise HTTPException(400, detail="one_patreon_identity_required")
    return invoke(service.staff_link, **body.model_dump())


@staff.post("/unlink")
def staff_unlink(body: UnlinkBody):
    if sum(bool(x) for x in body.model_dump().values()) != 1:
        raise HTTPException(400, detail="one_unlink_subject_required")
    return invoke(service.unlink, **body.model_dump())


@staff.post("/resync")
def resync():
    return service.sync_now()


@staff.get("/unlinked")
def unlinked():
    return service.unlinked()


@staff.get("/health")
def health():
    return service.health()


@staff.post("/brake/release")
def brake_release():
    return service.release_brake()


@staff.get("/alerts")
def alerts():
    return service.alerts()


@staff.post("/alerts/ack")
def alerts_ack(body: AckBody):
    return service.ack_alerts(body.ids)


@staff.post("/import")
def import_links(body: ImportBody):
    return invoke(service.import_links, [r.model_dump() for r in body.links], [r.model_dump() for r in body.grants], dry_run=body.dry_run)


patreon_router.include_router(staff)
patreon_router.include_router(plugin)
