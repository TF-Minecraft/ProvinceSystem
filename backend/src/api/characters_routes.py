"""Characters API routes (catalog, session, create/list, plugin ingest)."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from src.characters.rpc_player_meta import (
    RpcPlayerMetaError,
    resolve_web_entitlements,
    upsert_rpc_player_meta,
)
from src.characters.creation_catalog import (
    CreationCatalogError,
    get_catalog,
    replace_catalog,
)
from src.characters.creates import (
    CreateError,
    create_character,
    delete_pending_create,
    list_for_player,
    list_pending,
    mark_applied_results,
)
from src.characters.lore_items import (
    LoreItemError,
    claim_status,
    clear_customisations_for_kit,
    customise_lore_item,
    delete_lore_item_customise,
    list_character_kits,
    list_lore_items,
    list_pending_for_plugin,
    mark_lore_items_applied,
    resolve_default_kit_texture,
    resolve_pickable_model,
    resolve_pickable_texture,
    store_plugin_kit_skin,
)
from src.characters.realm_wipe import (
    delete_characters_for_realm,
    wipe_realm_character_data,
)
from src.characters.roster import RosterError, replace_roster
from src.characters.wardrobe import (
    WardrobeError,
    ack_wardrobe_slots,
    clear_pending_create_wardrobe,
    clear_slot,
    get_wardrobe,
    get_wardrobe_for_plugin,
    resolve_masked_template_path,
    resolve_slot_texture_path,
    set_active_slot,
    set_active_slot_for_plugin,
    set_slot_display_name,
    store_masked_template,
    upload_pending_create_wardrobe,
    upload_slot,
)
from src.skins.auth import (
    HEADER_PLUGIN_KEY,
    AuthError,
    is_secondary_plugin_key,
    require_plugin_key,
)
from src.skins.codes import CodeError, get_session, revoke_session

characters_router = APIRouter(prefix="/characters", tags=["characters"])

_wardrobe_log = logging.getLogger("characters.wardrobe")
_catalog_log = logging.getLogger("characters.creation_catalog")


class AppliedResultsBody(BaseModel):
    results: list[dict] = Field(default_factory=list)


class RosterBody(BaseModel):
    player_uuid: str = Field(..., min_length=1)
    characters: list[dict] = Field(default_factory=list)
    max_alive_characters: int | None = None
    eighteen: bool | None = None
    real_age_set: bool | None = None
    account_created_at_epoch: int | None = None
    name_colour_stops: int | None = None
    wardrobe_skin_slots: int | None = None
    kit_cooldown_seconds_remaining: int | None = None
    kit_cooldown_hours: int | None = None
    kit_cooldowns: dict | None = None
    realm_id: str | None = None


class WardrobeActiveBody(BaseModel):
    """PATCH body for wardrobe active slot. null clears auto-apply."""

    slot: str | None = None


class WardrobeNameBody(BaseModel):
    """PATCH body for wardrobe slot display name. null clears to default."""

    display_name: str | None = None


class WardrobeAckBody(BaseModel):
    """Plugin ack after pull+apply for pending wardrobe slots."""

    slots: list[str] = Field(default_factory=list)


def _require_plugin(x_plugin_key: str | None) -> None:
    try:
        require_plugin_key(x_plugin_key)
    except AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization Bearer token",
        )
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization Bearer token",
        )
    return token


def _profile_session_from_auth(authorization: str | None) -> dict:
    token = _bearer_token(authorization)
    row = get_session(token)
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    scope = str(row.get("scope") or "").strip().lower()
    if scope != "profile":
        raise HTTPException(
            status_code=401,
            detail="Profile session required (scope=profile)",
        )
    return row


_FEATURE_SCOPES = frozenset({"skin", "skin_staff", "drink", "profile"})


def _feature_session_from_auth(authorization: str | None) -> dict:
    """Any skins/drinks/character Bearer session (for shared player-meta)."""
    token = _bearer_token(authorization)
    row = get_session(token)
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    scope = str(row.get("scope") or "").strip().lower()
    if scope not in _FEATURE_SCOPES:
        raise HTTPException(status_code=401, detail="Feature session required")
    return row


class RpcPlayerMetaBody(BaseModel):
    player_uuid: str = Field(..., min_length=1)
    realm_id: str | None = None
    name_colour_stops: int = 0
    allow_drink_texture: bool = False
    allow_drink_message: bool = False
    max_alive_characters: int | None = None
    wardrobe_skin_slots: int = 1
    max_3d_pair_bytes: int = 0
    skin_token_cooldown_days: int = -1
    skin_kinds: list[str] = Field(default_factory=list)
    allow_armor_3d_helmet: bool = False
    permission_flags: dict[str, bool] = Field(default_factory=dict)
    donator_tier: int = 0

def _lore_http(exc: LoreItemError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _wardrobe_http(exc: WardrobeError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _create_http(exc: CreateError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@characters_router.put("/plugin/creation-catalog")
async def plugin_put_creation_catalog(
    request: Request,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """RPCharacters full-replace creation catalog snapshot."""
    _require_plugin(x_plugin_key)
    if is_secondary_plugin_key(x_plugin_key):
        # Dev/tutorial servers push on every start; only the primary server's copy is kept.
        current = get_catalog()
        _catalog_log.info("creation catalog push ignored (secondary plugin key)")
        return {
            "ok": True,
            "ignored": True,
            "stages": len(current["stages"]),
            "races": len(current["races"]),
            "traits": len(current["traits"]),
            "classes": len(current["classes"]),
            "updated_at": current["updated_at"],
        }
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail="body must be JSON") from e
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    try:
        result = replace_catalog(body)
    except CreationCatalogError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "stages": result["stages_count"],
        "races": result["races_count"],
        "traits": result["traits_count"],
        "classes": result["classes_count"],
        "updated_at": result["updated_at"],
    }


@characters_router.put("/plugin/kit-skins/{name}")
async def plugin_put_kit_skin(
    name: str,
    request: Request,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """RPCharacters uploads default editable-kit PNG (assets/{name}.png)."""
    _require_plugin(x_plugin_key)
    if is_secondary_plugin_key(x_plugin_key):
        return {"ok": True, "ignored": True, "name": name}
    data = await request.body()
    try:
        return store_plugin_kit_skin(name, data)
    except LoreItemError as e:
        raise _lore_http(e) from e


@characters_router.put("/plugin/wardrobe-templates/masked")
async def plugin_put_wardrobe_masked_template(
    request: Request,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """RPCharacters uploads assets/masked.png for auto-masked compose."""
    _require_plugin(x_plugin_key)
    if is_secondary_plugin_key(x_plugin_key):
        return {"ok": True, "ignored": True}
    data = await request.body()
    try:
        return store_masked_template(data)
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.get("/wardrobe-template/masked")
def get_wardrobe_masked_template(
    authorization: str | None = Header(default=None),
):
    """Session-gated masked body template for preview / client compose."""
    from fastapi.responses import FileResponse

    _profile_session_from_auth(authorization)
    try:
        path = resolve_masked_template_path()
    except WardrobeError as e:
        raise _wardrobe_http(e) from e
    return FileResponse(path, media_type="image/png", filename="masked.png")


@characters_router.get("/creation-catalog")
def get_creation_catalog(
    authorization: str | None = Header(default=None),
):
    """Session-gated creation catalog for the website wizard."""
    _profile_session_from_auth(authorization)
    return get_catalog()


@characters_router.get("/player-meta")
def get_player_meta_for_session(
    authorization: str | None = Header(default=None),
):
    """Web entitlements for the session player (skin/drink/character Bearer)."""
    session = _feature_session_from_auth(authorization)
    return resolve_web_entitlements(
        session["player_uuid"],
        realm_id=session.get("realm_id"),
    )


@characters_router.put("/plugin/rpc-player-meta")
def plugin_put_rpc_player_meta(
    body: RpcPlayerMetaBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """TFMCWeb upsert of resolved web entitlements for a player."""
    _require_plugin(x_plugin_key)
    try:
        return upsert_rpc_player_meta(body.model_dump())
    except RpcPlayerMetaError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@characters_router.get("/kits")
def get_character_kits(
    character_id: str | None = None,
    authorization: str | None = Header(default=None),
):
    """All kits + items + claimability for a roster character."""
    session = _profile_session_from_auth(authorization)
    try:
        return list_character_kits(session["player_uuid"], character_id)
    except LoreItemError as e:
        raise _lore_http(e) from e

@characters_router.get("/lore-items")
def get_lore_items(
    character_id: str | None = None,
    kit_id: str | None = None,
    authorization: str | None = Header(default=None),
):
    """Editable kit parts + customise drafts for a claimable kit."""
    session = _profile_session_from_auth(authorization)
    try:
        return list_lore_items(session["player_uuid"], character_id, kit_id)
    except LoreItemError as e:
        raise _lore_http(e) from e


@characters_router.get("/lore-items/skins/{submission_id}/texture")
def get_lore_item_skin_texture(
    submission_id: str,
    base_set: str | None = None,
    variant: str | None = None,
    authorization: str | None = Header(default=None),
):
    """PNG preview for a pickable skin (own applied or staff i_tools)."""
    from fastapi.responses import FileResponse

    session = _profile_session_from_auth(authorization)
    want_signed = (variant or "").strip().lower() == "signed"
    try:
        path = resolve_pickable_texture(
            session["player_uuid"], submission_id, base_set, variant
        )
    except LoreItemError as e:
        raise _lore_http(e) from e
    filename = (
        f"{submission_id}_signed.png"
        if want_signed
        else f"{submission_id}.png"
    )
    return FileResponse(
        path,
        media_type="image/png",
        filename=filename,
    )


@characters_router.get("/lore-items/skins/{submission_id}/model")
def get_lore_item_skin_model(
    submission_id: str,
    base_set: str | None = None,
    authorization: str | None = Header(default=None),
):
    """Java model JSON preview for a pickable 3D skin."""
    from fastapi.responses import FileResponse

    session = _profile_session_from_auth(authorization)
    try:
        path = resolve_pickable_model(
            session["player_uuid"], submission_id, base_set
        )
    except LoreItemError as e:
        raise _lore_http(e) from e
    sid = (submission_id or "").strip()
    return FileResponse(
        path,
        media_type="application/json",
        filename=f"{sid}.json",
    )


@characters_router.get("/lore-items/{kit_key}/default-texture")
def get_lore_item_default_texture(
    kit_key: str,
    variant: str | None = None,
    authorization: str | None = Header(default=None),
):
    """PNG for the catalog default skin (e.g. knife_skin) used in the editor preview."""
    from fastapi.responses import FileResponse

    _profile_session_from_auth(authorization)
    try:
        path = resolve_default_kit_texture(kit_key, variant)
    except LoreItemError as e:
        raise _lore_http(e) from e
    return FileResponse(
        path,
        media_type="image/png",
        filename=path.name,
    )


@characters_router.post("/lore-items/{kit_key}/customise")
async def post_lore_item_customise(
    kit_key: str,
    request: Request,
    character_id: str | None = None,
    kit_id: str | None = None,
    authorization: str | None = Header(default=None),
):
    """Store name/lore draft; optional existing skin or new handheld PNG upload."""
    session = _profile_session_from_auth(authorization)
    content_type = (request.headers.get("content-type") or "").lower()

    display_name: str | None = None
    lore: list[str] | None = None
    existing_skin_id = None
    existing_provided = False
    texture_bytes: bytes | None = None
    unsigned_bytes: bytes | None = None
    signed_bytes: bytes | None = None
    model_bytes: bytes | None = None
    use_3d = False
    name_colours: list[str] | None = None
    name_styles: list[str] | None = None

    if "multipart/form-data" in content_type:
        form = await request.form()
        display_name = str(form.get("display_name") or "")
        lore_raw = form.get("lore")
        if lore_raw is not None and str(lore_raw).strip() != "":
            try:
                parsed = json.loads(str(lore_raw))
                if not isinstance(parsed, list):
                    raise ValueError("not a list")
                lore = [str(x) for x in parsed]
            except Exception as e:
                raise HTTPException(
                    status_code=400, detail="lore must be a JSON array"
                ) from e
        else:
            lore = []
        if "existing_skin_id" in form:
            existing_provided = True
            raw_skin = form.get("existing_skin_id")
            if raw_skin is None or str(raw_skin).strip() == "":
                existing_skin_id = None
            else:
                existing_skin_id = str(raw_skin).strip()
        texture = form.get("texture")
        if texture is not None and hasattr(texture, "read"):
            texture_bytes = await texture.read()
        unsigned = form.get("unsigned")
        if unsigned is not None and hasattr(unsigned, "read"):
            unsigned_bytes = await unsigned.read()
        signed = form.get("signed")
        if signed is not None and hasattr(signed, "read"):
            signed_bytes = await signed.read()
        model = form.get("model")
        if model is not None and hasattr(model, "read"):
            model_bytes = await model.read()
        use_3d = str(form.get("use_3d") or "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        colours_raw = form.get("name_colours")
        if colours_raw is not None and str(colours_raw).strip() != "":
            try:
                parsed_c = json.loads(str(colours_raw))
                if not isinstance(parsed_c, list):
                    raise ValueError("not a list")
                name_colours = [str(x) for x in parsed_c]
            except Exception as e:
                raise HTTPException(
                    status_code=400, detail="name_colours must be a JSON array"
                ) from e
        styles_raw = form.get("name_styles")
        if styles_raw is not None and str(styles_raw).strip() != "":
            try:
                parsed_s = json.loads(str(styles_raw))
                if not isinstance(parsed_s, list):
                    raise ValueError("not a list")
                name_styles = [str(x) for x in parsed_s]
            except Exception as e:
                raise HTTPException(
                    status_code=400, detail="name_styles must be a JSON array"
                ) from e
    else:
        try:
            body = await request.json()
        except Exception as e:
            raise HTTPException(status_code=400, detail="body must be JSON") from e
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body must be a JSON object")
        display_name = str(body.get("display_name") or "")
        lore_raw = body.get("lore")
        if lore_raw is None:
            lore = []
        elif isinstance(lore_raw, list):
            lore = [str(x) for x in lore_raw]
        else:
            raise HTTPException(status_code=400, detail="lore must be a list")
        if "existing_skin_id" in body:
            existing_provided = True
            existing_skin_id = body.get("existing_skin_id")
        use_3d = bool(body.get("use_3d"))
        colours_body = body.get("name_colours")
        if isinstance(colours_body, list):
            name_colours = [str(x) for x in colours_body]
        styles_body = body.get("name_styles")
        if isinstance(styles_body, list):
            name_styles = [str(x) for x in styles_body]

    has_upload = (
        texture_bytes is not None
        or unsigned_bytes is not None
        or signed_bytes is not None
        or model_bytes is not None
    )

    try:
        kwargs = dict(
            display_name=display_name,
            lore=lore,
            texture_bytes=texture_bytes,
            unsigned_bytes=unsigned_bytes,
            signed_bytes=signed_bytes,
            model_bytes=model_bytes,
            use_3d=use_3d,
            name_colours=name_colours,
            name_styles=name_styles,
            kit_id=kit_id,
        )
        if existing_provided:
            return customise_lore_item(
                session,
                character_id,
                kit_key,
                existing_skin_id=existing_skin_id,
                **kwargs,
            )
        return customise_lore_item(
            session,
            character_id,
            kit_key,
            **kwargs,
        )
    except LoreItemError as e:
        raise _lore_http(e) from e


@characters_router.delete("/lore-items/{kit_key}/customise")
def delete_lore_item_customise_route(
    kit_key: str,
    character_id: str | None = None,
    kit_id: str | None = None,
    authorization: str | None = Header(default=None),
):
    """Wipe one kit-item customise draft (player). Does not delete skins."""
    session = _profile_session_from_auth(authorization)
    try:
        return delete_lore_item_customise(
            session["player_uuid"],
            character_id,
            kit_key,
            kit_id=kit_id,
        )
    except LoreItemError as e:
        raise _lore_http(e) from e


@characters_router.get("/{character_id}/wardrobe")
def get_character_wardrobe(
    character_id: str,
    authorization: str | None = Header(default=None),
):
    """List wardrobe slots + active for a roster character."""
    session = _profile_session_from_auth(authorization)
    try:
        return get_wardrobe(session["player_uuid"], character_id)
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.patch("/{character_id}/wardrobe/active")
def patch_character_wardrobe_active(
    character_id: str,
    body: WardrobeActiveBody,
    authorization: str | None = Header(default=None),
):
    """Set or clear the active swappable wardrobe slot."""
    session = _profile_session_from_auth(authorization)
    try:
        return set_active_slot(session["player_uuid"], character_id, body.slot)
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.get("/{character_id}/wardrobe/{slot}/texture")
def get_character_wardrobe_texture(
    character_id: str,
    slot: str,
    authorization: str | None = Header(default=None),
):
    """Serve uploaded wardrobe PNG for preview (owner only)."""
    from fastapi.responses import FileResponse

    session = _profile_session_from_auth(authorization)
    try:
        path = resolve_slot_texture_path(
            session["player_uuid"], character_id, slot
        )
    except WardrobeError as e:
        raise _wardrobe_http(e) from e
    response = FileResponse(
        path,
        media_type="image/png",
        filename=f"{slot}.png",
    )
    # Same path is reused on re-upload; never let browsers keep an old PNG.
    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, max-age=0"
    )
    response.headers["Pragma"] = "no-cache"
    return response


@characters_router.post("/{character_id}/wardrobe/{slot}")
async def post_character_wardrobe_slot(
    character_id: str,
    slot: str,
    request: Request,
    authorization: str | None = Header(default=None),
):
    """Upload a 64x64 PNG into a wardrobe slot (MineSkin sign in 30.03)."""
    session = _profile_session_from_auth(authorization)
    form = await request.form()
    file = form.get("texture") or form.get("file")
    if file is None or not hasattr(file, "read"):
        _wardrobe_log.warning(
            "[wardrobe] upload missing file character_id=%s slot=%s",
            character_id,
            slot,
        )
        raise HTTPException(
            status_code=400,
            detail="Missing multipart file field 'texture' (or 'file')",
        )
    png_bytes = await file.read()
    display_name = form.get("display_name")
    if display_name is not None and not isinstance(display_name, str):
        display_name = str(display_name)
    create_masked_raw = form.get("create_masked")
    create_masked = str(create_masked_raw or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    model_raw = form.get("model")
    model_override = (
        str(model_raw).strip() if model_raw is not None else None
    ) or None
    try:
        return upload_slot(
            session["player_uuid"],
            character_id,
            slot,
            png_bytes,
            display_name=display_name,
            create_masked=create_masked,
            model_override=model_override,
        )
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.patch("/{character_id}/wardrobe/{slot}/name")
def patch_character_wardrobe_slot_name(
    character_id: str,
    slot: str,
    body: WardrobeNameBody,
    authorization: str | None = Header(default=None),
):
    """Rename a filled wardrobe slot (no re-sign; does not set apply pending)."""
    session = _profile_session_from_auth(authorization)
    try:
        return set_slot_display_name(
            session["player_uuid"],
            character_id,
            slot,
            body.display_name,
        )
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.delete("/{character_id}/wardrobe/{slot}")
def delete_character_wardrobe_slot(
    character_id: str,
    slot: str,
    authorization: str | None = Header(default=None),
):
    """Clear one wardrobe slot (and PNG)."""
    session = _profile_session_from_auth(authorization)
    try:
        return clear_slot(session["player_uuid"], character_id, slot)
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.post("/logout")
def post_logout(
    authorization: str | None = Header(default=None),
):
    """Revoke the current Bearer session (idempotent)."""
    token = _bearer_token(authorization)
    return revoke_session(token)


@characters_router.post("")
@characters_router.post("/")
async def post_character(
    request: Request,
    authorization: str | None = Header(default=None),
):
    """Queue a web character create (validated against synced catalog)."""
    session = _profile_session_from_auth(authorization)
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail="body must be JSON") from e
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    try:
        row = create_character(
            session["player_uuid"],
            body,
            realm_id=session.get("realm_id"),
        )
    except CreateError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "id": row["id"],
        "status": row["status"],
        "client_request_id": row["client_request_id"],
        "created_at": row["created_at"],
        "realm_id": row.get("realm_id"),
        "payload": row["payload"],
    }


@characters_router.post("/creates/{create_id}/wardrobe/{slot}")
async def post_pending_create_wardrobe(
    create_id: str,
    slot: str,
    request: Request,
    authorization: str | None = Header(default=None),
):
    """Upload a signed wardrobe slot for a pending web create."""
    session = _profile_session_from_auth(authorization)
    form = await request.form()
    file = form.get("texture") or form.get("file")
    if file is None or not hasattr(file, "read"):
        _wardrobe_log.warning(
            "[wardrobe] upload missing file create_id=%s slot=%s",
            create_id,
            slot,
        )
        raise HTTPException(
            status_code=400,
            detail="Missing multipart file field 'texture' (or 'file')",
        )
    png_bytes = await file.read()
    display_name = form.get("display_name")
    if display_name is not None and not isinstance(display_name, str):
        display_name = str(display_name)
    create_masked_raw = form.get("create_masked")
    create_masked = str(create_masked_raw or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    model_raw = form.get("model")
    model_override = (
        str(model_raw).strip() if model_raw is not None else None
    ) or None
    try:
        return upload_pending_create_wardrobe(
            session["player_uuid"],
            create_id,
            slot,
            png_bytes,
            display_name=display_name,
            create_masked=create_masked,
            model_override=model_override,
        )
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.delete("/creates/{create_id}/wardrobe/{slot}")
def delete_pending_create_wardrobe(
    create_id: str,
    slot: str,
    authorization: str | None = Header(default=None),
):
    """Clear a pending-create wardrobe slot draft."""
    session = _profile_session_from_auth(authorization)
    try:
        return clear_pending_create_wardrobe(
            session["player_uuid"], create_id, slot
        )
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.delete("/creates/{create_id}")
def delete_pending_create_route(
    create_id: str,
    authorization: str | None = Header(default=None),
):
    """Cancel a pending web character create (wardrobe, kit drafts, create row)."""
    session = _profile_session_from_auth(authorization)
    try:
        return delete_pending_create(session["player_uuid"], create_id)
    except CreateError as e:
        raise _create_http(e) from e


@characters_router.get("")
@characters_router.get("/")
def get_characters(
    authorization: str | None = Header(default=None),
):
    """List roster mirror + pending creates for the session player."""
    session = _profile_session_from_auth(authorization)
    return list_for_player(session["player_uuid"], session.get("realm_id"))


@characters_router.get("/plugin/pending")
def plugin_pending_creates(
    realm_id: str | None = None,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    return {"creates": list_pending(realm_id)}


@characters_router.get("/plugin/lore-items/pending")
def plugin_pending_lore_items(
    realm_id: str | None = None,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    return {"items": list_pending_for_plugin(realm_id)}


@characters_router.get("/plugin/lore-items/claim-status")
def plugin_lore_item_claim_status(
    player_uuid: str | None = None,
    character_id: str | None = None,
    kit_id: str | None = None,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Whether kit claim should wait on pending_skin for this character/kit."""
    _require_plugin(x_plugin_key)
    uuid = (player_uuid or "").strip()
    cid = (character_id or "").strip()
    if not uuid or not cid:
        raise HTTPException(
            status_code=400, detail="player_uuid and character_id are required"
        )
    return claim_status(uuid, cid, kit_id)


@characters_router.delete("/plugin/lore-items/customisations")
def plugin_clear_lore_item_customisations(
    player_uuid: str | None = None,
    character_id: str | None = None,
    kit_id: str | None = None,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Staff resetkit: wipe customise drafts for one character + kit."""
    _require_plugin(x_plugin_key)
    try:
        return clear_customisations_for_kit(player_uuid or "", character_id or "", kit_id)
    except LoreItemError as e:
        raise _lore_http(e) from e


class LoreItemsAppliedBody(BaseModel):
    results: list[dict] = Field(default_factory=list)


@characters_router.post("/plugin/lore-items/applied")
def plugin_applied_lore_items(
    body: LoreItemsAppliedBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return mark_lore_items_applied(body.results)
    except LoreItemError as e:
        raise _lore_http(e) from e


@characters_router.post("/plugin/applied")
def plugin_applied_creates(
    body: AppliedResultsBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return mark_applied_results(body.results)
    except CreateError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@characters_router.put("/plugin/roster")
def plugin_put_roster(
    body: RosterBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return replace_roster(
            body.player_uuid,
            body.characters,
            body.max_alive_characters,
            body.eighteen,
            body.real_age_set,
            body.account_created_at_epoch,
            body.name_colour_stops,
            body.wardrobe_skin_slots,
            body.kit_cooldown_seconds_remaining,
            body.kit_cooldown_hours,
            body.kit_cooldowns,
            body.realm_id,
        )
    except RosterError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@characters_router.delete("/plugin/realm-data")
def plugin_wipe_realm_data(
    realm_id: str | None = None,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Staff wipe of one realm's site character data. Player meta stays."""
    _require_plugin(x_plugin_key)
    try:
        return wipe_realm_character_data(realm_id)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class PluginCharacterDeleteBody(BaseModel):
    character_ids: list[str] = Field(default_factory=list)
    realm_id: str | None = None


@characters_router.post("/plugin/characters/delete")
def plugin_delete_characters(
    body: PluginCharacterDeleteBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Tagged wipe cleanup: drop site rows for ids deleted in-game. Creates stay."""
    _require_plugin(x_plugin_key)
    try:
        return delete_characters_for_realm(body.realm_id, body.character_ids)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@characters_router.get("/plugin/wardrobe/{player_uuid}/{character_id}")
def plugin_get_wardrobe(
    player_uuid: str,
    character_id: str,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Pull signed wardrobe for RPC apply (includes texture value/signature)."""
    _require_plugin(x_plugin_key)
    try:
        return get_wardrobe_for_plugin(player_uuid, character_id)
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.post("/plugin/wardrobe/{player_uuid}/{character_id}/ack")
def plugin_ack_wardrobe(
    player_uuid: str,
    character_id: str,
    body: WardrobeAckBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Clear apply_pending after plugin pull + apply."""
    _require_plugin(x_plugin_key)
    try:
        return ack_wardrobe_slots(player_uuid, character_id, body.slots)
    except WardrobeError as e:
        raise _wardrobe_http(e) from e


@characters_router.post("/plugin/wardrobe/{player_uuid}/{character_id}/active")
def plugin_post_wardrobe_active(
    player_uuid: str,
    character_id: str,
    body: WardrobeActiveBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """Set active swappable slot from in-game wardrobe command."""
    _require_plugin(x_plugin_key)
    try:
        return set_active_slot_for_plugin(player_uuid, character_id, body.slot)
    except WardrobeError as e:
        raise _wardrobe_http(e) from e
