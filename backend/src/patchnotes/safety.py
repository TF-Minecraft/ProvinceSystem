"""Player-facing notes must not teach hidden knowledge.

Lore items are hidden knowledge. A line may say that something was fixed, but
it must not name a lore item or describe how to find one. Staff still choose
Approve or Deny. This only marks the line for them.
"""

from __future__ import annotations

import re

_LORE_ITEM = re.compile(r"\blore[\s-]?items?\b", re.IGNORECASE)

_WARNING = "Lore items are hidden knowledge. Deny this line if it would reveal one."


def hidden_knowledge_warning(body: str) -> str | None:
    """Return a staff warning when the line mentions a lore item."""
    if _LORE_ITEM.search(body or ""):
        return _WARNING
    return None
