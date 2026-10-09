"""Same hidden-knowledge mark as the patch note API.

Lore items are hidden knowledge. Staff still approve or deny the line.
"""

from __future__ import annotations

import re

_LORE_ITEM = re.compile(r"\blore[\s-]?items?\b", re.IGNORECASE)

WARNING = "Lore items are hidden knowledge. Deny this line if it would reveal one."


def hidden_knowledge_warning(body: str) -> str | None:
    if _LORE_ITEM.search(body or ""):
        return WARNING
    return None
