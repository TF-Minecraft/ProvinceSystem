"""Profile's dashboard says what each character that opens there wears."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import src.api.profile_routes as routes
from src.characters.wardrobe import WardrobeError


def test_only_living_and_pending_characters_get_a_worn_skin():
    characters = [
        {"id": "alive", "status": "ALIVE"},
        {"id": "new", "status": "pending"},
        {"id": "gone", "status": "DEAD"},
        {"id": "lost", "status": "ALIVE"},
    ]

    def worn(_uuid: str, cid: str) -> str | None:
        if cid == "lost":
            raise WardrobeError("Character not found on roster", status_code=403)
        return "Base" if cid == "alive" else None

    with mock.patch.object(routes, "worn_skin_name", side_effect=worn) as called:
        routes._add_worn_skins("p-1", characters)

    assert [c.get("worn_skin", "absent") for c in characters] == ["Base", None, "absent", "absent"]
    assert [c.args for c in called.call_args_list] == [("p-1", "alive"), ("p-1", "new"), ("p-1", "lost")]
