from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from .http_headers import add_revalidate

from .map_access import list_accessible_maps
from ..scripts.chronicle.chapter_identity import overlay_live_chapter
from ..scripts.chronicle.store import list_days

maps_router = APIRouter(tags=["maps"])


def _with_chronicle_day_flag(public: dict) -> dict:
    """Archived chapters advertise whether Review History has days. Live omits it."""
    out = overlay_live_chapter(public)
    if not out.get("archived"):
        out.pop("has_chronicle_days", None)
        return out
    map_id = str(out.get("id") or "")
    try:
        out["has_chronicle_days"] = bool(list_days(map_id))
    except Exception:
        out["has_chronicle_days"] = False
    return out


@maps_router.get("/maps/accessible")
async def get_accessible_maps(
    authorization: str | None = Header(default=None),
):
    return add_revalidate(JSONResponse({
        "maps": [
            _with_chronicle_day_flag(entry.to_public_dict())
            for entry in list_accessible_maps(authorization)
        ]
    }))
