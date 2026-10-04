"""Compose staff review PNGs for drink submissions.

Texture submissions: NN-upscaled texture.png.
Color-only: tinted potion_overlay + untinted glass_bottle + hex caption.
Assets are synced from DrinkBuilder into data/drinks/assets/.
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from . import db
from .db import connect

REVIEW_SHEET_NAME = "review_sheet.png"
TILE_DISPLAY = 128
PAD = 16
CAPTION_H = 28
BG = (32, 32, 36, 255)
CAPTION_COLOR = (220, 220, 220, 255)
COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

_OVERLAY_NAME = "potion_overlay.png"
_BOTTLE_NAME = "glass_bottle.png"


class DrinkReviewSheetError(ValueError):
    """Could not build a drink review sheet."""


def _font(size: int = 14) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        try:
            return ImageFont.truetype("DejaVuSans.ttf", size)
        except OSError:
            return ImageFont.load_default()


def _scale_nn(img: Image.Image, max_side: int) -> Image.Image:
    w, h = img.size
    if w <= 0 or h <= 0:
        return img
    scale = max_side / max(w, h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return img.resize((nw, nh), Image.Resampling.NEAREST)


def _submissions_root() -> Path:
    path = db.DRINKS_DIR / "submissions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _assets_dir() -> Path:
    path = db.DRINKS_DIR / "assets"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _load_rgba(name: str) -> Image.Image | None:
    path = _assets_dir() / name
    if not path.is_file():
        return None
    try:
        img = Image.open(path)
        img.load()
        return img.convert("RGBA")
    except OSError as e:
        raise DrinkReviewSheetError(f"Cannot read asset: {name}") from e


def _procedural_overlay() -> Image.Image:
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((4, 5, 11, 14), fill=(180, 180, 180, 255))
    draw.rectangle((5, 7, 10, 13), fill=(180, 180, 180, 255))
    return img


def _procedural_bottle() -> Image.Image:
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle((6, 1, 9, 3), fill=(220, 220, 230, 200))
    draw.rectangle((5, 3, 10, 4), fill=(220, 220, 230, 220))
    draw.ellipse((3, 4, 12, 15), outline=(200, 200, 210, 255))
    return img


def _parse_hex_color(color: str) -> tuple[int, int, int]:
    text = (color or "").strip()
    if not COLOR_RE.match(text):
        raise DrinkReviewSheetError("color must be #RRGGBB")
    return int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16)


def _tint_overlay(overlay: Image.Image, color: str) -> Image.Image:
    r, g, b = _parse_hex_color(color)
    out = overlay.copy()
    pixels = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            pr, pg, pb, pa = pixels[x, y]
            if pa == 0:
                continue
            pixels[x, y] = (
                (pr * r) // 255,
                (pg * g) // 255,
                (pb * b) // 255,
                pa,
            )
    return out


def _compose_colored_potion(color: str) -> Image.Image:
    """Tint overlay (liquid), composite glass bottle on top."""
    overlay = _load_rgba(_OVERLAY_NAME)
    bottle = _load_rgba(_BOTTLE_NAME)
    if overlay is None:
        overlay = _procedural_overlay()
    if bottle is None:
        bottle = _procedural_bottle()

    if bottle.size != overlay.size:
        bottle = bottle.resize(overlay.size, Image.Resampling.NEAREST)

    tinted = _tint_overlay(overlay, color)
    canvas = Image.new("RGBA", tinted.size, (0, 0, 0, 0))
    canvas.paste(tinted, (0, 0), tinted)
    canvas.paste(bottle, (0, 0), bottle)
    return canvas


def _compose_sheet(tile: Image.Image, caption: str) -> Image.Image:
    scaled = _scale_nn(tile, TILE_DISPLAY)
    width = max(scaled.width, 160) + PAD * 2
    height = scaled.height + PAD * 2 + CAPTION_H
    canvas = Image.new("RGBA", (width, height), BG)
    ox = (width - scaled.width) // 2
    canvas.paste(scaled, (ox, PAD), scaled)
    draw = ImageDraw.Draw(canvas)
    font = _font(14)
    draw.text(
        (PAD, PAD + scaled.height + 6),
        caption[:80],
        fill=CAPTION_COLOR,
        font=font,
    )
    return canvas


def build_drink_review_sheet(submission_id: str) -> bytes | None:
    """
    Build a review PNG for a drink submission.
    Returns None if the submission row does not exist.
    Raises DrinkReviewSheetError if appearance files/color are missing.
    """
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM drink_submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
    if row is None:
        return None

    out_dir = _submissions_root() / submission_id
    if not out_dir.is_dir():
        dir_path = str(row["dir_path"] or "").strip()
        if dir_path:
            out_dir = Path(dir_path)
    if not out_dir.is_dir():
        raise DrinkReviewSheetError("Submission files directory missing")

    cached = out_dir / REVIEW_SHEET_NAME
    if cached.is_file() and cached.stat().st_size > 0:
        return cached.read_bytes()

    try:
        recipe = json.loads(row["recipe_json"])
    except (json.JSONDecodeError, TypeError, KeyError):
        recipe = {}
    if not isinstance(recipe, dict):
        recipe = {}

    texture_path = out_dir / "texture.png"
    color = str(recipe.get("color") or "").strip() or None

    if texture_path.is_file():
        try:
            tex = Image.open(texture_path)
            tex.load()
            tile = tex.convert("RGBA")
        except OSError as e:
            raise DrinkReviewSheetError("Cannot read texture.png") from e
        caption = "custom texture"
        if row["texture_id"] and not int(row["new_texture"] or 0):
            caption = f"reuse {row['texture_id']}"
        elif row["texture_id"]:
            caption = f"new texture {row['texture_id']}"
        canvas = _compose_sheet(tile, caption)
    elif color:
        tile = _compose_colored_potion(color)
        canvas = _compose_sheet(tile, f"color {color.upper()}")
    else:
        raise DrinkReviewSheetError(
            "Submission has neither texture.png nor recipe.color"
        )

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    data = buf.getvalue()
    try:
        cached.write_bytes(data)
    except OSError:
        pass
    return data
