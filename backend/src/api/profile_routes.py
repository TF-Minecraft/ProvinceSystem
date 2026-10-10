"""Profile dashboard API (login session hub)."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from src.api.characters_routes import _profile_session_from_auth
from src.characters.creates import list_for_player
from src.characters.lore_items import list_player_custom_items
from src.skins.codes import SiteStartRefused, site_start_allowance, start_site_session
from src.skins.drinks import list_drink_submissions_for_player
from src.skins.submissions import list_submissions_for_player

profile_router = APIRouter(prefix="/profile", tags=["profile"])


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
