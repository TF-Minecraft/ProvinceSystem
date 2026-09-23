"""Lazy-regenerate pack model JSON for legacy submissions missing artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..db import SKINS_DIR
from ..display import DisplayError, parse_and_merge_model
from .gun import build_gun_models
from .large_bow import BOW_STEMS, bow_file_suffix, build_large_bow_models
from .large_handheld import build_large_handheld_model, parse_grip_preset
from .shield import build_shield_models
from .textures import model_to_bytes, normalize_textures


def _read_meta(out_dir: Path) -> dict[str, Any] | None:
    meta_path = out_dir / "meta.json"
    if not meta_path.is_file():
        return None
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def ensure_pack_models(submission_id: str) -> None:
    """
    Ensure pack-ready model JSON exists on disk for this submission.
    Safe no-op when already complete or kind needs no extra models.
    """
    out_dir = SKINS_DIR / submission_id
    if not out_dir.is_dir():
        return
    meta = _read_meta(out_dir)
    if meta is None:
        return
    slug = str(meta.get("slug") or "").strip()
    kind = str(meta.get("kind") or "").strip()
    if not slug or not kind:
        return

    try:
        if kind == "shield":
            _ensure_shield(out_dir, slug)
        elif kind == "large_handheld":
            _ensure_large_handheld(out_dir, slug, meta.get("grip_preset"))
        elif kind == "large_bow":
            _ensure_large_bow(out_dir, slug)
        elif kind in ("item_3d", "helmet_3d", "mask"):
            _ensure_normalized_3d(out_dir, slug)
        elif kind == "gun":
            _ensure_gun(out_dir, slug)
        elif kind == "armor_set":
            _ensure_armor_helmets(out_dir, submission_id, meta)
    except (DisplayError, ValueError, OSError, KeyError):
        # Best-effort: leave disk as-is; apply will fail clearly if still incomplete.
        return


def _ensure_shield(out_dir: Path, slug: str) -> None:
    idle_path = out_dir / f"{slug}.json"
    blocking_path = out_dir / f"{slug}_blocking.json"
    if blocking_path.is_file() and idle_path.is_file():
        idle = _load_json(idle_path)
        if isinstance(idle, dict) and idle.get("overrides"):
            return
    idle_raw = _load_json(idle_path)
    if idle_raw is None:
        return
    # Re-merge display if this is a raw donor; tolerant of already-merged.
    try:
        merged = parse_and_merge_model(
            json.dumps(idle_raw).encode("utf-8"), "shield"
        )
    except DisplayError:
        merged = idle_raw
    idle, blocking = build_shield_models(merged, slug)
    idle_path.write_bytes(model_to_bytes(idle))
    blocking_path.write_bytes(model_to_bytes(blocking))


def _ensure_large_handheld(
    out_dir: Path, slug: str, grip_preset: Any
) -> None:
    model_path = out_dir / f"{slug}.json"
    if model_path.is_file():
        return
    if not (out_dir / f"{slug}.png").is_file():
        return
    grip = parse_grip_preset(
        str(grip_preset) if grip_preset is not None else None
    )
    model_path.write_bytes(
        model_to_bytes(build_large_handheld_model(slug, grip))
    )


def _ensure_large_bow(out_dir: Path, slug: str) -> None:
    models = build_large_bow_models(slug)
    for stem, model in models.items():
        path = out_dir / f"{slug}{bow_file_suffix(stem)}.json"
        if path.is_file():
            continue
        png = out_dir / f"{slug}{bow_file_suffix(stem)}.png"
        if not png.is_file():
            continue
        path.write_bytes(model_to_bytes(model))


def _ensure_normalized_3d(out_dir: Path, slug: str) -> None:
    path = out_dir / f"{slug}.json"
    model = _load_json(path)
    if model is None:
        return
    textures = model.get("textures")
    needle = f"tfmc_submissions:item/{slug}"
    if isinstance(textures, dict) and any(
        isinstance(v, str) and v == needle for v in textures.values()
    ):
        return
    path.write_bytes(model_to_bytes(normalize_textures(model, slug)))


def _ensure_gun(out_dir: Path, slug: str) -> None:
    charged = out_dir / f"{slug}_aim_charged.json"
    stems = ("carry", "reload", "aim")
    loaded: dict[str, dict[str, Any]] = {}
    for stem in stems:
        raw = _load_json(out_dir / f"{slug}_{stem}.json")
        if raw is None:
            return
        loaded[stem] = raw
    need = not charged.is_file()
    needle = f"tfmc_submissions:item/{slug}"
    for stem, model in loaded.items():
        textures = model.get("textures")
        if not (
            isinstance(textures, dict)
            and any(isinstance(v, str) and v == needle for v in textures.values())
        ):
            need = True
            break
    if not need:
        return
    built = build_gun_models(loaded, slug)
    for stem, model in built.items():
        name = f"{slug}_{stem}.json"
        (out_dir / name).write_bytes(model_to_bytes(model))


def _ensure_armor_helmets(
    out_dir: Path, submission_id: str, meta: dict[str, Any]
) -> None:
    h3d = meta.get("helmet_3d_tiers") or []
    if not isinstance(h3d, list):
        return
    for tier in h3d:
        tier_s = str(tier).strip()
        if not tier_s:
            continue
        path = out_dir / f"{tier_s}_helmet_model.json"
        model = _load_json(path)
        if model is None:
            continue
        texture_id = f"{submission_id}_{tier_s}_helmet"
        needle = f"tfmc_submissions:item/{texture_id}"
        textures = model.get("textures")
        if isinstance(textures, dict) and any(
            isinstance(v, str) and v == needle for v in textures.values()
        ):
            continue
        path.write_bytes(model_to_bytes(normalize_textures(model, texture_id)))
