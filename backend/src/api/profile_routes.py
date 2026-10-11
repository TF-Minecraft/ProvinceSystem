"""Profile dashboard API (login session hub)."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from src.api.characters_routes import _bearer_token, _profile_session_from_auth
from src.characters.creates import list_for_player
from src.characters.lore_items import list_player_custom_items
from src.skins.codes import (
    REDEEMABLE_SKIN_SCOPES,
    CodeError,
    SiteStartRefused,
    code_session_open,
    get_session,
    redeem_sign_in_code,
    site_start_allowance,
    start_site_session,
)
from src.skins.drinks import list_drink_submissions_for_player
from src.skins.submissions import list_submissions_for_player

profile_router = APIRouter(prefix="/profile", tags=["profile"])


class SignInCodeBody(BaseModel):
    code: str = Field(..., min_length=1)
    remember_me: bool = False


@profile_router.get("")
@profile_router.get("/")
def get_profile_dashboard(
    authorization: str | None = Header(default=None),
):
    """Aggregated account view: characters, submissions, custom kit items."""
    session = _profile_session_from_auth(authorization)
    uuid = session["player_uuid"]
    realm = session.get("realm_id")
    roster = list_for_player(uuid, realm)
    return {
        **roster,
        "skins": list_submissions_for_player(uuid, realm),
        "drinks": list_drink_submissions_for_player(uuid, realm),
        "custom_items": list_player_custom_items(uuid, realm),
        "can_start": site_start_allowance(uuid, realm),
    }


def _start(authorization: str | None, scope: str) -> dict:
    session = _profile_session_from_auth(authorization)
    try:
        return start_site_session(session["player_uuid"], session.get("realm_id"), scope)
    except SiteStartRefused as e:
        raise HTTPException(
            status_code=409, detail={"reason": e.reason, "next_at": e.next_at}
        ) from e


@profile_router.post("/skins/start")
def post_start_skin(authorization: str | None = Header(default=None)):
    """A skin upload session without an in-game code, under the same rank cooldown."""
    return _start(authorization, "skin")


@profile_router.post("/drinks/start")
def post_start_drink(authorization: str | None = Header(default=None)):
    """A drink upload session without an in-game code, under the same rank cooldown."""
    return _start(authorization, "drink")


@profile_router.post("/redeem")
def post_redeem(body: SignInCodeBody):
    """Sign in with a /token create profile, skin or drink code."""
    try:
        return redeem_sign_in_code(body.code, remember_me=body.remember_me)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@profile_router.get("/wardrobe")
def get_code_wardrobe(authorization: str | None = Header(default=None)):
    """What a skin or drink code shows in Profile: that wardrobe, and whether the code is unused.

    The owner pages already show each of these items to the same session.
    """
    session = get_session(_bearer_token(authorization))
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    uuid = session["player_uuid"]
    realm = session.get("realm_id")
    if session["scope"] in REDEEMABLE_SKIN_SCOPES:
        kind, items = "skin", list_submissions_for_player(uuid, realm)
    elif session["scope"] == "drink":
        kind, items = "drink", list_drink_submissions_for_player(uuid, realm)
    else:
        raise HTTPException(status_code=403, detail="Skin or drink session required")
    open_ = code_session_open(session)
    return {
        "kind": kind,
        "items": items,
        "can_start": {"can_start": open_, "reason": None if open_ else "used", "next_at": None},
    }
