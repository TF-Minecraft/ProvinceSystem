from __future__ import annotations

import json
import logging
import time
from collections import defaultdict

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from src.api.map_access import get_skin_session, require_site_staff
from src.api.path_safety import is_safe_filename, is_safe_segment, resolve_within
from src.skins.auth import (
    AuthError,
    HEADER_PLUGIN_KEY,
    HEADER_STAFF_KEY,
    is_secondary_plugin_key,
    require_plugin_key,
    require_staff_key,
)
from src.skins.codes import (
    CodeError,
    get_cosmetic_mint_status,
    get_session,
    inspect_code,
    issue_code,
    list_active_codes,
    redeem_profile_code,
    redeem_code,
    reset_cosmetic_mint_cooldowns,
    revoke_code,
)
from src.skins.discord_link import (
    LinkError,
    complete_link,
    get_identity_status,
    remember_discord_usernames,
    record_guild_joined,
    record_guild_left,
    start_link,
    unlink_by_discord_id,
    unlink_by_uuid,
)
from src.skins.plugin_notices import (
    ack_plugin_notices,
    list_undelivered_plugin_notices,
)
from src.skins.moderation import (
    ModerationError,
    ack_moderation,
    enqueue_ban_event,
    enqueue_bird_mail,
    list_undelivered_moderation,
    record_warning,
)
from src.skins.catalog import CatalogError, get_catalog, replace_catalog
from src.skins.entitlements import PlayerMetaError, upsert_player_meta
from src.skins.naming import ARMOR_FIELDS, SlugError
from src.skins.notifications import (
    NotificationError,
    ack_notification,
    list_undelivered,
)
from src.skins import db as skins_db
from src.skins.db import SKINS_DIR
from src.skins.preview_3d import read_preview_render_error
from src.skins.review_sheet import ReviewSheetError, build_review_sheet
from src.skins.storage import StorageError
from src.skins.submissions import (
    SlugConflictError,
    SubmissionError,
    approve_submission,
    check_player_conflicts,
    create_submission,
    deny_submission,
    get_submission_for_owner,
    get_submission_for_plugin,
    list_approved_pending_apply,
    list_deletable_staff_skins,
    list_deletable_submissions,
    list_pending,
    mark_applied,
    resolve_submission_file,
    revoke_submission,
)

logger = logging.getLogger("skins.routes")

SHEET_RENDER_ERROR_HEADER = "X-Sheet-Render-Error"

skins_router = APIRouter(prefix="/skins", tags=["skins"])

_INSPECT_RATE_BUCKETS: dict[str, list[float]] = defaultdict(list)
_INSPECT_RATE_LIMIT = 10
_INSPECT_RATE_WINDOW_SEC = 60.0


def _check_inspect_rate(client_ip: str) -> None:
    """Light rate limit for unauthenticated code inspect (dev tooling)."""
    now = time.monotonic()
    key = (client_ip or "").strip() or "unknown"
    bucket = _INSPECT_RATE_BUCKETS[key]
    cutoff = now - _INSPECT_RATE_WINDOW_SEC
    bucket[:] = [t for t in bucket if t > cutoff]
    if len(bucket) >= _INSPECT_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many inspect requests")
    bucket.append(now)


class IssueCodeBody(BaseModel):
    player_uuid: str = Field(..., min_length=1)
    scope: str | None = "skin"
    realm_id: str | None = None


class RedeemBody(BaseModel):
    code: str = Field(..., min_length=1)


class InspectCodeBody(BaseModel):
    code: str = Field(..., min_length=1)


class ProfileRedeemBody(BaseModel):
    code: str = Field(..., min_length=1)
    remember_me: bool = False


class DenyBody(BaseModel):
    reason: str = Field(..., min_length=1)


class AppliedBody(BaseModel):
    submission_ids: list[str]


class RevokeCodeBody(BaseModel):
    code: str = Field(..., min_length=1)


class CosmeticMintResetBody(BaseModel):
    player_uuid: str = Field(..., min_length=1)
    staff_uuid: str | None = None


class LinkStartBody(BaseModel):
    player_uuid: str = Field(..., min_length=1)
    minecraft_name: str | None = None


class LinkCompleteBody(BaseModel):
    code: str = Field(..., min_length=1)
    discord_user_id: str = Field(..., min_length=1)
    # Optional account username for staff lookup. Display names are dropped.
    discord_username: str | None = None


class DiscordUsernameUpdate(BaseModel):
    discord_user_id: str = Field(..., min_length=1, max_length=32)
    discord_username: str | None = Field(default=None, max_length=80)


class DiscordUsernamesBody(BaseModel):
    updates: list[DiscordUsernameUpdate] = Field(default_factory=list)
    overwrite: bool = False


class PluginNoticesAckBody(BaseModel):
    ids: list[int] = Field(default_factory=list)


class LinkUnlinkUuidBody(BaseModel):
    player_uuid: str = Field(..., min_length=1)


class LinkUnlinkDiscordBody(BaseModel):
    discord_user_id: str = Field(..., min_length=1)


class GuildDiscordBody(BaseModel):
    discord_user_id: str = Field(..., min_length=1)


class WarningBody(BaseModel):
    player_uuid: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=1)
    staff_uuid: str | None = None
    staff_name: str | None = None
    discord_user_id: str | None = None
    minecraft_name: str | None = None


class BanEventBody(BaseModel):
    event: str = Field(..., min_length=1)
    player_uuid: str | None = None
    discord_user_id: str | None = None
    minecraft_name: str | None = None
    reason: str | None = None
    duration: str | None = None
    staff_name: str | None = None


class BirdMailBody(BaseModel):
    player_uuid: str | None = None
    discord_user_id: str | None = None
    addressee_character: str = Field(..., min_length=1)
    sender_minecraft_name: str | None = None
    contents_preview: str | None = None


class ModerationAckBody(BaseModel):
    ids: list[int] = Field(default_factory=list)


def _session_from_auth(authorization: str | None):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization Bearer token")
    token = authorization[7:].strip()
    row = get_session(token)
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return row


def _skin_session_from_auth(authorization: str | None):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization Bearer token",
        )
    row = get_skin_session(authorization)
    if row is None:
        raise HTTPException(
            status_code=403,
            detail="Skin session required (scope=skin or skin_staff)",
        )
    return row


def _require_plugin(x_plugin_key: str | None) -> None:
    try:
        require_plugin_key(x_plugin_key)
    except AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e


def _require_staff(x_staff_key: str | None) -> None:
    try:
        require_staff_key(x_staff_key)
    except AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e


@skins_router.post("/codes")
def post_codes(
    body: IssueCodeBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return issue_code(body.player_uuid, body.scope, body.realm_id)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.get("/plugin/cosmetic-mint-status")
def plugin_cosmetic_mint_status(
    player_uuid: str,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Last skin/drink mint timestamp for TFMCWeb shared cooldown."""
    _require_plugin(x_plugin_key)
    try:
        return get_cosmetic_mint_status(player_uuid)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/plugin/cosmetic-mint-reset")
def plugin_cosmetic_mint_reset(
    body: CosmeticMintResetBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Staff clear of shared skin+drink mint cooldown (TFMCWeb /token resetcooldowns)."""
    _require_plugin(x_plugin_key)
    try:
        return reset_cosmetic_mint_cooldowns(body.player_uuid, body.staff_uuid)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.get("/plugin/codes/active")
def plugin_codes_active(
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    return {"codes": list_active_codes()}


@skins_router.post("/plugin/codes/revoke")
def plugin_codes_revoke(
    body: RevokeCodeBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return revoke_code(body.code)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/codes/inspect")
def post_codes_inspect(
    body: InspectCodeBody,
    request: Request,
    authorization: str | None = Header(default=None),
):
    """Read-only code lookup for dev gate tooling. Does not redeem or consume codes."""
    client_ip = request.client.host if request.client else ""
    _check_inspect_rate(client_ip)
    require_site_staff(authorization)
    try:
        return inspect_code(body.code)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/profile/redeem")
def post_profile_redeem(body: ProfileRedeemBody):
    """Redeem a profile-scoped code into a Bearer session (optional Remember me)."""
    try:
        return redeem_profile_code(body.code, remember_me=body.remember_me)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/discord/link/start")
def post_discord_link_start(
    body: LinkStartBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return start_link(body.player_uuid, body.minecraft_name)
    except LinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/discord/link/complete")
def post_discord_link_complete(
    body: LinkCompleteBody,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        return complete_link(
            body.code,
            body.discord_user_id,
            discord_username=body.discord_username,
        )
    except LinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/discord/usernames")
def post_discord_usernames(
    body: DiscordUsernamesBody,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    """Store Discord account usernames on existing links for staff lookup."""
    _require_staff(x_staff_key)
    try:
        return remember_discord_usernames(
            [
                {
                    "discord_user_id": item.discord_user_id,
                    "discord_username": item.discord_username,
                }
                for item in body.updates
            ],
            overwrite=body.overwrite,
        )
    except LinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.get("/plugin/notices")
def plugin_notices_list(
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    return {"notices": list_undelivered_plugin_notices()}


@skins_router.post("/plugin/notices/ack")
def plugin_notices_ack(
    body: PluginNoticesAckBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    return ack_plugin_notices(body.ids)


@skins_router.post("/discord/link/unlink")
def post_discord_link_unlink(
    body: LinkUnlinkUuidBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return unlink_by_uuid(body.player_uuid)
    except LinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/discord/link/unlink-discord")
def post_discord_link_unlink_discord(
    body: LinkUnlinkDiscordBody,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        return unlink_by_discord_id(body.discord_user_id)
    except LinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/discord/guild/left")
def post_discord_guild_left(
    body: GuildDiscordBody,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        return record_guild_left(body.discord_user_id)
    except LinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/discord/guild/joined")
def post_discord_guild_joined(
    body: GuildDiscordBody,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        return record_guild_joined(body.discord_user_id)
    except LinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.get("/discord/status/{player_uuid}")
def get_discord_status(
    player_uuid: str,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return get_identity_status(player_uuid)
    except LinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/moderation/warnings")
def post_moderation_warning(
    body: WarningBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return record_warning(
            body.player_uuid,
            body.reason,
            staff_uuid=body.staff_uuid,
            staff_name=body.staff_name,
            discord_user_id=body.discord_user_id,
            minecraft_name=body.minecraft_name,
        )
    except ModerationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/moderation/ban-events")
def post_moderation_ban_event(
    body: BanEventBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return enqueue_ban_event(
            body.event,
            player_uuid=body.player_uuid,
            discord_user_id=body.discord_user_id,
            minecraft_name=body.minecraft_name,
            reason=body.reason,
            duration=body.duration,
            staff_name=body.staff_name,
        )
    except ModerationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.post("/moderation/bird-mail")
def post_moderation_bird_mail(
    body: BirdMailBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return enqueue_bird_mail(
            player_uuid=body.player_uuid,
            discord_user_id=body.discord_user_id,
            addressee_character=body.addressee_character,
            sender_minecraft_name=body.sender_minecraft_name,
            contents_preview=body.contents_preview,
        )
    except ModerationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.get("/moderation/notifications")
def get_moderation_notifications(
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    return {"notifications": list_undelivered_moderation()}


@skins_router.post("/moderation/notifications/ack")
def post_moderation_notifications_ack(
    body: ModerationAckBody,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    return ack_moderation(body.ids)


@skins_router.post("/redeem")
def post_redeem(body: RedeemBody):
    try:
        return redeem_code(body.code)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.get("/submissions/check")
def get_submissions_check(
    authorization: str | None = Header(default=None),
    display_name: str | None = None,
    submission_id: str | None = None,
):
    session = _skin_session_from_auth(authorization)
    return check_player_conflicts(
        session["player_uuid"],
        display_name=display_name,
        submission_id=submission_id,
    )


@skins_router.post("/submissions")
async def post_submissions(
    request: Request,
    authorization: str | None = Header(default=None),
):
    session = _skin_session_from_auth(authorization)
    form = await request.form()

    kind = str(form.get("kind") or "")
    display_name = str(form.get("display_name") or "")
    base_set_raw = form.get("base_set")
    base_set = str(base_set_raw).strip() if base_set_raw else None
    grip_preset_raw = form.get("grip_preset")
    grip_preset = str(grip_preset_raw).strip() if grip_preset_raw else None
    add_name_raw = form.get("add_name")
    name_colours_raw = form.get("name_colours")
    name_styles_raw = form.get("name_styles")
    tiers_raw = form.get("tiers")
    tier_aliases_raw = form.get("tier_aliases")
    helmet_3d_tiers_raw = form.get("helmet_3d_tiers")

    tiers_list: list[str] | None = None
    if tiers_raw:
        try:
            parsed = json.loads(str(tiers_raw))
            if not isinstance(parsed, list):
                raise ValueError("not a list")
            tiers_list = [str(x) for x in parsed]
        except Exception as e:
            raise HTTPException(
                status_code=400, detail="tiers must be a JSON array"
            ) from e

    tier_aliases_map: dict[str, str] | None = None
    if tier_aliases_raw and str(tier_aliases_raw).strip():
        try:
            parsed = json.loads(str(tier_aliases_raw))
            if not isinstance(parsed, dict):
                raise ValueError("not an object")
            tier_aliases_map = {str(k): str(v) for k, v in parsed.items()}
        except Exception as e:
            raise HTTPException(
                status_code=400, detail="tier_aliases must be a JSON object"
            ) from e

    helmet_3d_list: list[str] | None = None
    if helmet_3d_tiers_raw and str(helmet_3d_tiers_raw).strip():
        try:
            parsed = json.loads(str(helmet_3d_tiers_raw))
            if not isinstance(parsed, list):
                raise ValueError("not a list")
            helmet_3d_list = [str(x) for x in parsed]
        except Exception as e:
            raise HTTPException(
                status_code=400, detail="helmet_3d_tiers must be a JSON array"
            ) from e

    files_bytes: dict[str, bytes] = {}
    filenames: dict[str, str | None] = {}
    for key, value in form.multi_items():
        if hasattr(value, "read") and hasattr(value, "filename"):
            files_bytes[str(key)] = await value.read()
            filenames[str(key)] = value.filename

    if kind == "armor_set" and not tiers_list:
        has_unprefixed = any(field in files_bytes for field in ARMOR_FIELDS)
        if has_unprefixed:
            tier = (base_set or "iron").strip().lower()
            tiers_list = [tier]
            remapped: dict[str, bytes] = {}
            remapped_names: dict[str, str | None] = {}
            for field in ARMOR_FIELDS:
                if field in files_bytes:
                    tier_key = f"{tier}_{field}"
                    remapped[tier_key] = files_bytes[field]
                    remapped_names[tier_key] = filenames.get(field)
            files_bytes = {
                k: v for k, v in files_bytes.items() if k not in ARMOR_FIELDS
            }
            filenames = {
                k: v for k, v in filenames.items() if k not in ARMOR_FIELDS
            }
            files_bytes.update(remapped)
            filenames.update(remapped_names)

    want_add = str(add_name_raw or "").strip().lower() in ("1", "true", "yes", "on")
    colours_list: list[str] | None = None
    styles_list: list[str] | None = None
    if name_colours_raw and str(name_colours_raw).strip():
        try:
            parsed = json.loads(str(name_colours_raw))
            if isinstance(parsed, list):
                colours_list = [str(x) for x in parsed]
            else:
                raise ValueError("not a list")
        except Exception as e:
            raise HTTPException(
                status_code=400, detail="name_colours must be a JSON array"
            ) from e
    if name_styles_raw and str(name_styles_raw).strip():
        try:
            parsed = json.loads(str(name_styles_raw))
            if isinstance(parsed, list):
                styles_list = [str(x) for x in parsed]
            else:
                raise ValueError("not a list")
        except Exception as e:
            raise HTTPException(
                status_code=400, detail="name_styles must be a JSON array"
            ) from e

    category_raw = form.get("category")
    category = str(category_raw).strip() if category_raw else None
    scroll_raw = form.get("scroll")
    scroll = str(scroll_raw).strip() if scroll_raw else None
    tier_scrolls_raw = form.get("tier_scrolls")
    tier_scrolls_map: dict[str, str] | None = None
    if tier_scrolls_raw and str(tier_scrolls_raw).strip():
        try:
            parsed = json.loads(str(tier_scrolls_raw))
            if not isinstance(parsed, dict):
                raise ValueError("not an object")
            tier_scrolls_map = {str(k): str(v) for k, v in parsed.items()}
        except Exception as e:
            raise HTTPException(
                status_code=400, detail="tier_scrolls must be a JSON object"
            ) from e

    try:
        return create_submission(
            session,
            kind,
            display_name,
            files_bytes,
            grip_preset=grip_preset or None,
            base_set=base_set or None,
            tiers=tiers_list,
            tier_aliases=tier_aliases_map,
            helmet_3d_tiers=helmet_3d_list,
            filenames=filenames,
            add_name=want_add,
            name_colours=colours_list,
            name_styles=styles_list,
            category=category,
            scroll=scroll,
            tier_scrolls=tier_scrolls_map,
        )
    except SlugConflictError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except (SlugError, StorageError, SubmissionError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.get("/submissions/{submission_id}")
def get_submission(
    submission_id: str,
    authorization: str | None = Header(default=None),
):
    session = _session_from_auth(authorization)
    row = get_submission_for_owner(submission_id, session["player_uuid"])
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return row


@skins_router.get("/submissions/{submission_id}/review-sheet")
def get_review_sheet(
    submission_id: str,
    authorization: str | None = Header(default=None),
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    """Staff key or owning player session may fetch the composite sheet."""
    staff_ok = False
    if x_staff_key:
        try:
            require_staff_key(x_staff_key)
            staff_ok = True
        except AuthError:
            staff_ok = False

    if not staff_ok:
        session = _session_from_auth(authorization)
        row = get_submission_for_owner(submission_id, session["player_uuid"])
        if row is None:
            raise HTTPException(status_code=404, detail="Submission not found")

    try:
        data = build_review_sheet(submission_id)
    except ReviewSheetError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    if data is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    headers: dict[str, str] = {}
    if staff_ok:
        render_err = read_preview_render_error(SKINS_DIR / submission_id)
        if render_err:
            headers[SHEET_RENDER_ERROR_HEADER] = render_err
    return Response(content=data, media_type="image/png", headers=headers)


@skins_router.post("/submissions/{submission_id}/approve")
def post_approve(
    submission_id: str,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        result = approve_submission(submission_id)
    except SubmissionError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e)) from e
    logger.info("would notify discord submission=%s action=approve", submission_id)
    return result


@skins_router.post("/submissions/{submission_id}/deny")
def post_deny(
    submission_id: str,
    body: DenyBody,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        result = deny_submission(submission_id, body.reason)
    except SubmissionError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e)) from e
    logger.info("would notify discord submission=%s action=deny", submission_id)
    return result


@skins_router.get("/staff/pending")
def staff_pending(
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    return {"submissions": list_pending()}


@skins_router.get("/staff/notifications")
def staff_notifications(
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    return {"notifications": list_undelivered()}


@skins_router.post("/staff/notifications/{notification_id}/ack")
def staff_notification_ack(
    notification_id: int,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        return ack_notification(notification_id)
    except NotificationError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


def _resolve_submission_file_safely(submission_id: str, filename: str):
    """resolve_submission_file behind the shared path-parameter guards.

    The submission id becomes a directory under SKINS_DIR, and a Windows `%5C`
    in it would otherwise walk out of that tree before any row is looked up.
    """
    if not is_safe_segment(submission_id) or not is_safe_filename(filename):
        return None
    path = resolve_submission_file(submission_id, filename)
    if path is None:
        return None
    return resolve_within(skins_db.SKINS_DIR / submission_id, path)


@skins_router.get("/staff/submissions/{submission_id}/files/{filename}")
def staff_file(
    submission_id: str,
    filename: str,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    path = _resolve_submission_file_safely(submission_id, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="File not found")
    media = (
        "image/png"
        if filename.lower().endswith(".png")
        else "application/json"
        if filename.lower().endswith(".json")
        else "application/octet-stream"
    )
    return FileResponse(path, media_type=media, filename=filename)


@skins_router.get("/plugin/approved")
def plugin_approved(
    since: str | None = None,
    realm_id: str | None = None,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    return {"submissions": list_approved_pending_apply(since, realm_id)}


@skins_router.get("/plugin/submissions/deletable")
def plugin_submissions_deletable(
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Player-lane ids for /armourshop submission delete tab-complete."""
    _require_plugin(x_plugin_key)
    return {"submissions": list_deletable_submissions()}


@skins_router.get("/plugin/skins/deletable")
def plugin_skins_deletable(
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Staff-lane ids for /armourshop skin delete tab-complete."""
    _require_plugin(x_plugin_key)
    return {"skins": list_deletable_staff_skins()}


@skins_router.get("/plugin/submissions/{submission_id}")
def plugin_submission_get(
    submission_id: str,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    row = get_submission_for_plugin(submission_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return row


@skins_router.post("/plugin/submissions/{submission_id}/revoke")
def plugin_submission_revoke(
    submission_id: str,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return revoke_submission(submission_id)
    except SubmissionError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e)) from e


@skins_router.get("/plugin/submissions/{submission_id}/files/{filename}")
def plugin_file(
    submission_id: str,
    filename: str,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    path = _resolve_submission_file_safely(submission_id, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="File not found")
    media = (
        "image/png"
        if filename.lower().endswith(".png")
        else "application/json"
        if filename.lower().endswith(".json")
        else "application/octet-stream"
    )
    return FileResponse(path, media_type=media, filename=filename)


@skins_router.post("/plugin/applied")
def plugin_applied(
    body: AppliedBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    applied = mark_applied(body.submission_ids)
    return {"applied": applied}


class CatalogBody(BaseModel):
    categories: list[dict] = Field(default_factory=list)
    scrolls: list[dict] = Field(default_factory=list)
    entitlements: dict | None = None


class PlayerMetaBody(BaseModel):
    player_uuid: str = Field(..., min_length=1)
    name_colour_stops: int = 0
    max_3d_pair_bytes: int = 0
    skin_token_cooldown_days: int = -1
    skin_kinds: list[str] = Field(default_factory=list)
    allow_armor_3d_helmet: bool = False


@skins_router.put("/plugin/catalog")
def plugin_put_catalog(
    body: CatalogBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """ArmourShop full-replace catalog snapshot (categories + scrolls)."""
    _require_plugin(x_plugin_key)
    if is_secondary_plugin_key(x_plugin_key):
        # Dev/tutorial servers push on every start; only the primary server's copy is kept.
        current = get_catalog()
        return {
            "ok": True,
            "ignored": True,
            "categories": len(current["categories"]),
            "skin_sets": sum(
                len(c.get("skin_sets") or [])
                for c in current["categories"]
                if isinstance(c, dict)
            ),
            "scrolls": len(current["scrolls"]),
            "updated_at": current["updated_at"],
        }
    try:
        result = replace_catalog(body.model_dump())
    except CatalogError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "categories": result["categories_count"],
        "skin_sets": result["skin_sets_count"],
        "scrolls": result["scrolls_count"],
        "updated_at": result["updated_at"],
    }


@skins_router.put("/plugin/player-meta")
def plugin_put_player_meta(
    body: PlayerMetaBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Deprecated: prefer TFMCWeb PUT /characters/plugin/rpc-player-meta."""
    import logging

    logging.getLogger("uvicorn.error").warning(
        "DEPRECATED PUT /skins/plugin/player-meta — use TFMCWeb rpc-player-meta"
    )
    _require_plugin(x_plugin_key)
    try:
        return upsert_player_meta(body.model_dump())
    except PlayerMetaError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@skins_router.get("/catalog")
def skins_get_catalog():
    """Public catalog for website dropdowns / collision checks."""
    return get_catalog()
