"""Compose staff review contact-sheet PNGs for 2D submissions.

One NN-upscaled composite per submission: coloured display name + textures.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from src import database

from .db import SKINS_DIR
from .name_preview import render_name_preview_png
from .naming import ARMOR_FIELDS
from .preview_3d import (
    PREVIEW_NAMES,
    _inputs_newer_than_outputs,
    _job_for_kind,
    _preview_inputs,
    clear_preview_render_error,
    ensure_preview_tiles,
    read_preview_render_error,
    write_preview_render_error,
)
from .storage import (
    BOOK_KIND,
    BOW_KINDS,
    CROSSBOW_KINDS,
    GUN_KIND,
    ITEM_KINDS,
    MODEL_3D_KINDS,
)

TILE_DISPLAY = 128
ITEM_DISPLAY = 256
BOW_DISPLAY = 128
PREVIEW_DISPLAY = 192
PAD = 12
LABEL_H = 18
TIER_CAPTION_H = 28
HEADER_PAD = 16
CAPTION_H = 22
BG = (32, 32, 36)
LABEL_COLOR = (220, 220, 220)
CAPTION_COLOR = (200, 200, 210)
TIER_COLOR = (160, 200, 255)

REVIEW_SHEET_NAME = "review_sheet.png"


class ReviewSheetError(ValueError):
    """Could not build sheet for an existing submission."""


def _font(size: int = 14) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        try:
            return ImageFont.truetype("DejaVuSans.ttf", size)
        except OSError:
            return ImageFont.load_default()


def _load_rgba(path: Path) -> Image.Image:
    try:
        img = Image.open(path)
        img.load()
        return img.convert("RGBA")
    except OSError as e:
        raise ReviewSheetError(f"Cannot read image: {path.name}") from e


def _scale_nn(img: Image.Image, max_side: int) -> Image.Image:
    w, h = img.size
    if w <= 0 or h <= 0:
        return img
    scale = max_side / max(w, h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return img.resize((nw, nh), Image.Resampling.NEAREST)


def _paste_centered(
    canvas: Image.Image, tile: Image.Image, box: tuple[int, int, int, int]
) -> None:
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    tw, th = tile.size
    px = x0 + (bw - tw) // 2
    py = y0 + (bh - th) // 2
    canvas.paste(tile, (px, py), tile if tile.mode == "RGBA" else None)


def _parse_tiers_json(raw) -> list[str]:
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw if x is not None and str(x).strip()]
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    return [str(x) for x in data if x is not None and str(x).strip()]


def _row_json_list(row, key: str) -> list[str]:
    if key not in row.keys():
        return []
    raw = row[key]
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    return [str(x) for x in data]


def _row_add_name(row) -> bool:
    if "add_name" not in row.keys():
        return False
    return bool(row["add_name"])


def _build_header(
    width: int,
    *,
    display_name: str,
    name_colours: list[str],
    name_styles: list[str],
    caption: str,
) -> Image.Image:
    name_png = render_name_preview_png(display_name, name_colours, name_styles)
    name_img = Image.open(io.BytesIO(name_png)).convert("RGBA")

    font = _font(14)
    draw_tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    cb = draw_tmp.textbbox((0, 0), caption, font=font)
    caption_h = max(CAPTION_H, cb[3] - cb[1] + 4)

    header_w = max(width, name_img.width + HEADER_PAD * 2, cb[2] - cb[0] + HEADER_PAD * 2)
    header_h = HEADER_PAD + name_img.height + 8 + caption_h + HEADER_PAD
    canvas = Image.new("RGB", (header_w, header_h), BG)
    draw = ImageDraw.Draw(canvas)

    nx = (header_w - name_img.width) // 2
    canvas.paste(name_img, (nx, HEADER_PAD), name_img)
    cy = HEADER_PAD + name_img.height + 8
    draw.text(
        ((header_w - (cb[2] - cb[0])) // 2, cy),
        caption,
        fill=CAPTION_COLOR,
        font=font,
    )
    return canvas


def _stack_vertical(parts: list[Image.Image], *, min_width: int = 0) -> Image.Image:
    if not parts:
        raise ReviewSheetError("empty sheet")
    width = max(min_width, max(p.width for p in parts))
    height = sum(p.height for p in parts)
    canvas = Image.new("RGB", (width, height), BG)
    y = 0
    for part in parts:
        canvas.paste(part, ((width - part.width) // 2, y))
        y += part.height
    return canvas


def _armor_tier_strip(tier: str, out_dir: Path) -> Image.Image:
    cols, rows = 3, 2
    cell_w = TILE_DISPLAY + PAD * 2
    cell_h = TILE_DISPLAY + LABEL_H + PAD * 2
    width = cols * cell_w
    height = rows * cell_h
    canvas = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(canvas)
    font = _font(12)

    for i, field in enumerate(ARMOR_FIELDS):
        if field == "helmet":
            path = out_dir / f"{tier}_helmet.png"
            if not path.is_file():
                path = out_dir / f"{tier}_helmet_texture.png"
        else:
            path = out_dir / f"{tier}_{field}.png"
        if not path.is_file():
            raise ReviewSheetError(f"Missing file: {path.name}")
        col, row = i % cols, i // cols
        x0 = col * cell_w + PAD
        y0 = row * cell_h + PAD
        tile = _scale_nn(_load_rgba(path), TILE_DISPLAY)
        _paste_centered(
            canvas, tile, (x0, y0, x0 + TILE_DISPLAY, y0 + TILE_DISPLAY)
        )
        label = "helmet_3d" if field == "helmet" and path.name.endswith(
            "_helmet_texture.png"
        ) else field
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(
            (x0 + (TILE_DISPLAY - tw) // 2, y0 + TILE_DISPLAY + 2),
            label,
            fill=LABEL_COLOR,
            font=font,
        )

    return canvas


def _armor_body(tiers: list[str], out_dir: Path) -> Image.Image:
    if not tiers:
        raise ReviewSheetError("armor_set has no tiers")

    strips: list[tuple[str, Image.Image]] = []
    for tier in tiers:
        strips.append((tier, _armor_tier_strip(tier, out_dir)))

    width = max(strip.width for _, strip in strips)
    strip_h = strips[0][1].height
    height = len(strips) * (TIER_CAPTION_H + strip_h)
    canvas = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(canvas)
    tier_font = _font(16)

    y = 0
    for tier, strip in strips:
        caption = tier
        cb = draw.textbbox((0, 0), caption, font=tier_font)
        cw = cb[2] - cb[0]
        draw.text(
            ((width - cw) // 2, y + (TIER_CAPTION_H - (cb[3] - cb[1])) // 2),
            caption,
            fill=TIER_COLOR,
            font=tier_font,
        )
        y += TIER_CAPTION_H
        canvas.paste(strip, ((width - strip.width) // 2, y))
        y += strip.height

    return canvas


def _single_texture_body(
    slug: str,
    kind: str,
    grip_preset: str | None,
    base_set: str | None,
    out_dir: Path,
) -> Image.Image:
    path = out_dir / f"{slug}.png"
    if not path.is_file():
        raise ReviewSheetError(f"Missing file: {path.name}")

    display = ITEM_DISPLAY
    caption = f"kind={kind}"
    if base_set:
        caption += f"  base={base_set}"
    if grip_preset:
        caption += f"  grip={grip_preset}"

    font = _font(16)
    draw_tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    cb = draw_tmp.textbbox((0, 0), caption, font=font)
    caption_w = cb[2] - cb[0]
    caption_h = cb[3] - cb[1]

    width = max(display + PAD * 2, caption_w + PAD * 2)
    height = display + PAD * 3 + caption_h
    canvas = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(canvas)

    tile = _scale_nn(_load_rgba(path), display)
    _paste_centered(
        canvas,
        tile,
        (PAD, PAD, width - PAD, PAD + display),
    )
    draw.text(
        ((width - caption_w) // 2, PAD + display + PAD),
        caption,
        fill=CAPTION_COLOR,
        font=font,
    )
    return canvas


def _bow_frame_paths(slug: str, kind: str, out_dir: Path) -> list[tuple[str, Path]]:
    frames: list[tuple[str, Path]] = [
        ("standby", out_dir / f"{slug}.png"),
        ("pull 0", out_dir / f"{slug}_0.png"),
        ("pull 1", out_dir / f"{slug}_1.png"),
        ("pull 2", out_dir / f"{slug}_2.png"),
    ]
    if kind == "crossbow":
        frames.append(("charged", out_dir / f"{slug}_charged.png"))
    return frames


def _bow_body(
    slug: str,
    kind: str,
    base_set: str | None,
    out_dir: Path,
) -> Image.Image:
    frames = _bow_frame_paths(slug, kind, out_dir)
    for label, path in frames:
        if not path.is_file():
            raise ReviewSheetError(f"Missing file: {path.name}")

    n = len(frames)
    cols = min(n, 4)
    rows = (n + cols - 1) // cols
    cell_w = BOW_DISPLAY + PAD * 2
    cell_h = BOW_DISPLAY + LABEL_H + PAD * 2
    width = cols * cell_w
    height = rows * cell_h + PAD
    canvas = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(canvas)
    font = _font(12)

    for i, (label, path) in enumerate(frames):
        col, row = i % cols, i // cols
        x0 = col * cell_w + PAD
        y0 = row * cell_h + PAD
        tile = _scale_nn(_load_rgba(path), BOW_DISPLAY)
        _paste_centered(
            canvas, tile, (x0, y0, x0 + BOW_DISPLAY, y0 + BOW_DISPLAY)
        )
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(
            (x0 + (BOW_DISPLAY - tw) // 2, y0 + BOW_DISPLAY + 2),
            label,
            fill=LABEL_COLOR,
            font=font,
        )

    # footer caption
    caption = f"kind={kind}"
    if base_set:
        caption += f"  base={base_set}"
    cf = _font(14)
    cb = draw.textbbox((0, 0), caption, font=cf)
    # extend canvas for caption
    extra = PAD + (cb[3] - cb[1]) + PAD
    out = Image.new("RGB", (width, height + extra), BG)
    out.paste(canvas, (0, 0))
    draw2 = ImageDraw.Draw(out)
    draw2.text(
        ((width - (cb[2] - cb[0])) // 2, height + PAD // 2),
        caption,
        fill=CAPTION_COLOR,
        font=cf,
    )
    return out


def _book_body(
    slug: str,
    base_set: str | None,
    out_dir: Path,
) -> Image.Image:
    frames: list[tuple[str, Path]] = [
        ("unsigned", out_dir / f"{slug}_unsigned.png"),
        ("signed", out_dir / f"{slug}_signed.png"),
    ]
    for label, path in frames:
        if not path.is_file():
            raise ReviewSheetError(f"Missing file: {path.name}")

    n = len(frames)
    cols = n
    rows = 1
    cell_w = BOW_DISPLAY + PAD * 2
    cell_h = BOW_DISPLAY + LABEL_H + PAD * 2
    width = cols * cell_w
    height = rows * cell_h + PAD
    canvas = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(canvas)
    font = _font(12)

    for i, (label, path) in enumerate(frames):
        col, row = i % cols, i // cols
        x0 = col * cell_w + PAD
        y0 = row * cell_h + PAD
        tile = _scale_nn(_load_rgba(path), BOW_DISPLAY)
        _paste_centered(
            canvas, tile, (x0, y0, x0 + BOW_DISPLAY, y0 + BOW_DISPLAY)
        )
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(
            (x0 + (BOW_DISPLAY - tw) // 2, y0 + BOW_DISPLAY + 2),
            label,
            fill=LABEL_COLOR,
            font=font,
        )

    caption = "kind=book"
    if base_set:
        caption += f"  base={base_set}"
    cf = _font(14)
    cb = draw.textbbox((0, 0), caption, font=cf)
    extra = PAD + (cb[3] - cb[1]) + PAD
    out = Image.new("RGB", (width, height + extra), BG)
    out.paste(canvas, (0, 0))
    draw2 = ImageDraw.Draw(out)
    draw2.text(
        ((width - (cb[2] - cb[0])) // 2, height + PAD // 2),
        caption,
        fill=CAPTION_COLOR,
        font=cf,
    )
    return out


_PREVIEW_LABELS = {
    "model": "3D model",
    "hat": "hat",
    "carry": "carry",
    "aim": "aim",
    "reload": "reload",
    "body": "full body",
    "book_unsigned": "3D unsigned",
    "book_signed": "3D signed",
}


def _preview_tiles_row(tiles: list[tuple[str, Path]]) -> Image.Image | None:
    if not tiles:
        return None
    n = len(tiles)
    cols = min(n, 4)
    rows = (n + cols - 1) // cols
    cell_w = PREVIEW_DISPLAY + PAD * 2
    cell_h = PREVIEW_DISPLAY + LABEL_H + PAD * 2
    width = cols * cell_w
    height = rows * cell_h + PAD
    canvas = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(canvas)
    font = _font(12)
    for i, (view, path) in enumerate(tiles):
        col, row = i % cols, i // cols
        x0 = col * cell_w + PAD
        y0 = row * cell_h + PAD
        tile = _scale_nn(_load_rgba(path), PREVIEW_DISPLAY)
        _paste_centered(
            canvas, tile, (x0, y0, x0 + PREVIEW_DISPLAY, y0 + PREVIEW_DISPLAY)
        )
        label = _PREVIEW_LABELS.get(view, view)
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(
            (x0 + (PREVIEW_DISPLAY - tw) // 2, y0 + PREVIEW_DISPLAY + 2),
            label,
            fill=LABEL_COLOR,
            font=font,
        )
    return canvas


def _compose_full_sheet(row, out_dir: Path) -> Image.Image:
    kind = row["kind"]
    slug = row["slug"]
    display_name = str(row["display_name"] or slug)
    grip = row["grip_preset"]
    base_set = row["base_set"] if "base_set" in row.keys() else None
    colours = _row_json_list(row, "name_colours")
    styles = _row_json_list(row, "name_styles")
    add_name = _row_add_name(row)
    sid = str(row["id"])

    caption_bits = [f"id={sid}", f"kind={kind}"]
    if kind == "armor_set":
        tiers = _parse_tiers_json(row["tiers"] if "tiers" in row.keys() else None)
        if not tiers:
            fallback = (base_set or "").strip()
            tiers = [fallback] if fallback else ["iron"]
        caption_bits.append("tiers=" + ",".join(tiers))
        body = _armor_body(tiers, out_dir)
    elif kind in BOW_KINDS or kind in CROSSBOW_KINDS:
        if base_set:
            caption_bits.append(f"base={base_set}")
        body = _bow_body(slug, kind, base_set, out_dir)
    elif kind == BOOK_KIND:
        if base_set:
            caption_bits.append(f"base={base_set}")
        body = _book_body(slug, base_set, out_dir)
    elif kind in ITEM_KINDS or kind in MODEL_3D_KINDS or kind == GUN_KIND:
        if base_set:
            caption_bits.append(f"base={base_set}")
        if grip:
            caption_bits.append(f"grip={grip}")
        body = _single_texture_body(slug, kind, grip, base_set, out_dir)
    else:
        raise ReviewSheetError(f"Unsupported kind for review sheet: {kind}")

    caption_bits.append(f"apply_name={'yes' if add_name else 'no'}")
    caption = "  ·  ".join(caption_bits)

    header = _build_header(
        body.width,
        display_name=display_name,
        name_colours=colours,
        name_styles=styles,
        caption=caption,
    )
    parts = [header, body]
    preview_tiles, render_error = ensure_preview_tiles(
        kind,
        slug,
        out_dir,
        tiers=_parse_tiers_json(row["tiers"] if "tiers" in row.keys() else None)
        if kind == "armor_set"
        else [],
    )
    if render_error:
        write_preview_render_error(out_dir, render_error)
    else:
        clear_preview_render_error(out_dir)
    preview_row = _preview_tiles_row(preview_tiles)
    if preview_row is not None:
        parts.append(preview_row)
    return _stack_vertical(parts, min_width=header.width)


def _review_sheet_cache_stale(row, out_dir: Path) -> bool:
    cached = out_dir / REVIEW_SHEET_NAME
    if not cached.is_file() or cached.stat().st_size == 0:
        return True

    if read_preview_render_error(out_dir):
        return True

    kind = row["kind"]
    slug = row["slug"]
    tiers = (
        _parse_tiers_json(row["tiers"] if "tiers" in row.keys() else None)
        if kind == "armor_set"
        else []
    )
    job = _job_for_kind(kind, slug, out_dir, tiers)
    if job is None:
        return False

    wanted = [
        (view, out_dir / PREVIEW_NAMES[view])
        for view in job["views"]
        if view in PREVIEW_NAMES
    ]
    if any(not path.is_file() for _, path in wanted):
        return True

    inputs = _preview_inputs(job["files"])
    outputs = [path for _, path in wanted]
    if _inputs_newer_than_outputs(inputs, outputs):
        return True

    sheet_mtime = cached.stat().st_mtime
    for _, path in wanted:
        if path.is_file() and path.stat().st_mtime > sheet_mtime:
            return True

    return False


def build_review_sheet(submission_id: str) -> bytes | None:
    """
    Build a contact-sheet PNG for staff review.
    Returns None if the submission row does not exist.
    Raises ReviewSheetError if expected files are missing/unreadable.
    """
    with database.connect() as conn:
        row = conn.execute(
            "SELECT * FROM skin_submissions WHERE id = %s",
            (submission_id,),
        ).fetchone()
    if row is None:
        return None

    out_dir = SKINS_DIR / submission_id
    if not out_dir.is_dir():
        raise ReviewSheetError("Submission files directory missing")

    # Prefer cached file when present, non-empty, and still valid for 3D previews.
    cached = out_dir / REVIEW_SHEET_NAME
    if (
        cached.is_file()
        and cached.stat().st_size > 0
        and not _review_sheet_cache_stale(row, out_dir)
    ):
        return cached.read_bytes()

    canvas = _compose_full_sheet(row, out_dir)
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    data = buf.getvalue()
    try:
        cached.write_bytes(data)
    except OSError:
        pass
    return data


def write_review_sheet(submission_id: str) -> Path:
    """Compose and write review_sheet.png under the submission directory."""
    with database.connect() as conn:
        row = conn.execute(
            "SELECT * FROM skin_submissions WHERE id = %s",
            (submission_id,),
        ).fetchone()
    if row is None:
        raise ReviewSheetError("Submission not found")

    out_dir = SKINS_DIR / submission_id
    if not out_dir.is_dir():
        raise ReviewSheetError("Submission files directory missing")

    canvas = _compose_full_sheet(row, out_dir)
    path = out_dir / REVIEW_SHEET_NAME
    canvas.save(path, format="PNG")
    return path
