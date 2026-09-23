"""Headless 3D preview tiles for staff review sheets.

Fail-soft: missing Node/Chromium or a render error leaves the 2D sheet intact.
Callers receive an optional error string and may persist it; compose still proceeds.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from .storage import (
    BOOK_KIND,
    BOW_KINDS,
    CROSSBOW_KINDS,
    GUN_KIND,
    ITEM_KINDS,
    MODEL_3D_KINDS,
)

log = logging.getLogger("skins.preview_3d")

RENDER_DIR = Path(__file__).resolve().parents[2] / "render"
CLI = RENDER_DIR / "cli.mjs"
BUNDLE = RENDER_DIR / "dist" / "browser.js"
TIMEOUT_SEC = 90

PREVIEW_RENDER_ERROR_NAME = "preview_render_error.txt"
MAX_RENDER_ERROR_LEN = 500

PREVIEW_NAMES = {
    "model": "preview_model.png",
    "hat": "preview_hat.png",
    "carry": "preview_carry.png",
    "aim": "preview_aim.png",
    "reload": "preview_reload.png",
    "body": "preview_body.png",
    "book_unsigned": "preview_book_unsigned.png",
    "book_signed": "preview_book_signed.png",
}


def _truncate_error(message: str) -> str:
    text = (message or "").strip()
    if not text:
        return ""
    first_line = text.splitlines()[0].strip()
    if len(first_line) > MAX_RENDER_ERROR_LEN:
        return first_line[:MAX_RENDER_ERROR_LEN]
    return first_line


def write_preview_render_error(out_dir: Path, message: str) -> None:
    text = _truncate_error(message)
    if not text:
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / PREVIEW_RENDER_ERROR_NAME).write_text(text + "\n", encoding="utf-8")


def clear_preview_render_error(out_dir: Path) -> None:
    path = out_dir / PREVIEW_RENDER_ERROR_NAME
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def read_preview_render_error(out_dir: Path) -> str | None:
    path = out_dir / PREVIEW_RENDER_ERROR_NAME
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text or None


def _node_bin() -> str | None:
    env = (os.environ.get("SHEET_RENDER_NODE") or "").strip()
    if env:
        return env
    return shutil.which("node")


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _preview_inputs(files: dict[str, str]) -> list[Path]:
    """Model/texture paths plus the renderer bundle, so a rebuild refreshes tiles."""
    inputs = [Path(p) for p in files.values()]
    if isinstance(BUNDLE, Path):
        inputs.append(BUNDLE)
    return inputs


def _inputs_newer_than_outputs(inputs: list[Path], outputs: list[Path]) -> bool:
    if not outputs or any(not p.is_file() for p in outputs):
        return True
    newest_in = max((_mtime(p) for p in inputs if p.is_file()), default=0)
    oldest_out = min(_mtime(p) for p in outputs)
    return newest_in > oldest_out


def _existing_tiles(
    wanted: list[tuple[str, Path]],
) -> list[tuple[str, Path]]:
    return [(view, path) for view, path in wanted if path.is_file()]


def _incomplete_error(
    wanted: list[tuple[str, Path]],
    tiles: list[tuple[str, Path]],
) -> str | None:
    existing_views = {view for view, _ in tiles}
    missing = [view for view, _ in wanted if view not in existing_views]
    if not missing:
        return None
    expected = ", ".join(view for view, _ in wanted)
    missing_str = ", ".join(missing)
    return f"3D preview incomplete: expected {expected}; missing {missing_str}"


def _job_for_kind(kind: str, slug: str, out_dir: Path, tiers: list[str]) -> dict | None:
    files: dict[str, str] = {}
    views: list[str] = []

    if kind == BOOK_KIND:
        unsigned = out_dir / f"{slug}_unsigned.png"
        signed = out_dir / f"{slug}_signed.png"
        if unsigned.is_file():
            files["unsigned"] = str(unsigned)
            views.append("book_unsigned")
        if signed.is_file():
            files["signed"] = str(signed)
            views.append("book_signed")
        if not views:
            return None
        return {"kind": kind, "views": views, "files": files}

    if kind == "armor_set":
        tier = (tiers[0] if tiers else "").strip() or "iron"
        layer1 = out_dir / f"{tier}_layer_1.png"
        layer2 = out_dir / f"{tier}_layer_2.png"
        if not layer1.is_file() and not layer2.is_file():
            return None
        if layer1.is_file():
            files["layer1"] = str(layer1)
        if layer2.is_file():
            files["layer2"] = str(layer2)
        helm_tex = out_dir / f"{tier}_helmet_texture.png"
        helm_model = out_dir / f"{tier}_helmet_model.json"
        if helm_tex.is_file() and helm_model.is_file():
            files["helmet_texture"] = str(helm_tex)
            files["helmet_model"] = str(helm_model)
        return {"kind": kind, "views": ["body"], "files": files}

    tex = out_dir / f"{slug}.png"
    if tex.is_file():
        files["texture"] = str(tex)

    if kind in ITEM_KINDS or kind in BOW_KINDS or kind in CROSSBOW_KINDS:
        if "texture" not in files:
            return None
        return {"kind": kind, "views": ["model"], "files": files}

    if kind in MODEL_3D_KINDS:
        model = out_dir / f"{slug}.json"
        if model.is_file():
            files["model"] = str(model)
        if "texture" not in files:
            return None
        views = ["model"]
        if kind in ("helmet_3d", "mask"):
            views.append("hat")
        return {"kind": kind, "views": views, "files": files}

    if kind == GUN_KIND:
        if "texture" not in files:
            return None
        views = ["model"]
        for stem in ("carry", "reload", "aim"):
            path = out_dir / f"{slug}_{stem}.json"
            if path.is_file():
                files[stem] = str(path)
                views.append(stem)
        return {"kind": kind, "views": views, "files": files}

    return None


def ensure_preview_tiles(
    kind: str,
    slug: str,
    out_dir: Path,
    tiers: list[str] | None = None,
) -> tuple[list[tuple[str, Path]], str | None]:
    """Render missing 3D tiles. Returns (tiles, error)."""
    job = _job_for_kind(kind, slug, out_dir, tiers or [])
    if job is None:
        return [], None

    wanted = [
        (view, out_dir / PREVIEW_NAMES[view])
        for view in job["views"]
        if view in PREVIEW_NAMES
    ]
    outputs = [path for _, path in wanted]
    inputs = _preview_inputs(job["files"])

    if not _inputs_newer_than_outputs(inputs, outputs):
        tiles = _existing_tiles(wanted)
        return tiles, _incomplete_error(wanted, tiles)

    tiles = _existing_tiles(wanted)
    if os.environ.get("SHEET_RENDER_DISABLE", "").strip() in ("1", "true", "yes"):
        return tiles, "3D preview disabled (SHEET_RENDER_DISABLE=1)"

    node = _node_bin()
    if not node:
        log.warning("3D sheet renderer unavailable: node not found")
        return tiles, "3D renderer unavailable: node not found"

    if not CLI.is_file():
        log.warning("3D sheet renderer unavailable: backend/render/cli.mjs missing")
        return tiles, "3D renderer unavailable: backend/render/cli.mjs missing"

    if not BUNDLE.is_file():
        log.warning("3D sheet renderer unavailable: backend/render/dist/browser.js missing")
        return tiles, "3D renderer unavailable: run npm install in backend/render"

    payload = {
        "kind": job["kind"],
        "views": job["views"],
        "files": job["files"],
        "outDir": str(out_dir),
    }
    render_error: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        ) as tmp:
            json.dump(payload, tmp)
            tmp_path = tmp.name
        try:
            result = subprocess.run(
                [node, str(CLI), tmp_path],
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SEC,
                cwd=str(RENDER_DIR),
            )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "").strip()
            render_error = (
                _truncate_error(err)
                or f"3D renderer failed (exit {result.returncode})"
            )
            log.warning("3D sheet renderer failed: %s", render_error)
    except subprocess.TimeoutExpired:
        render_error = f"3D renderer timed out after {TIMEOUT_SEC}s"
        log.warning("3D sheet renderer error: %s", render_error)
    except OSError as e:
        render_error = _truncate_error(str(e)) or "3D renderer error"
        log.warning("3D sheet renderer error: %s", render_error)

    tiles = _existing_tiles(wanted)
    if render_error is not None:
        return tiles, render_error
    return tiles, _incomplete_error(wanted, tiles)
