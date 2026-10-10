"""One picture of a submitted skin for its owner's Profile wardrobe."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image

from .db import SKINS_DIR
from .preview_3d import PREVIEW_NAMES

# Best view first. The hat view puts headwear on a bare head, so the model reads better.
_PREVIEW_ORDER = ("model", "body", "book_unsigned", "hat")
# render/src/scene.ts paints previews on this colour; the wardrobe has its own.
_RENDER_BACKDROP = (0x20, 0x20, 0x24)


def _without_backdrop(path: Path) -> bytes:
    with Image.open(path) as im:
        pixels = np.array(im.convert("RGBA"))
    backdrop = np.all(pixels[:, :, :3] == _RENDER_BACKDROP, axis=2)
    pixels[backdrop, 3] = 0
    buf = io.BytesIO()
    Image.fromarray(pixels, "RGBA").save(buf, format="PNG")
    return buf.getvalue()


def skin_thumbnail(submission_id: str, slug: str) -> bytes | None:
    """A rendered preview without its backdrop, else the flat texture, else None.

    Only reads files the review sheet already made; it never starts a render.
    """
    out_dir = SKINS_DIR / submission_id
    for view in _PREVIEW_ORDER:
        path = out_dir / PREVIEW_NAMES[view]
        if path.is_file():
            return _without_backdrop(path)
    for name in (f"{slug}.png", f"{slug}_unsigned.png"):
        path = out_dir / name
        if path.is_file():
            return path.read_bytes()
    return None
