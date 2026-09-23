"""Display autofill + validation for 3D skin model JSON.

Player-submitted display tabs win; defaults fill missing keys.
See docs/cosmetics/skins.md.
"""

from __future__ import annotations

import copy
import json
from typing import Any

HAND_TABS = (
    "thirdperson_righthand",
    "thirdperson_lefthand",
    "firstperson_righthand",
    "firstperson_lefthand",
)
COMMON_TABS = HAND_TABS + ("ground", "gui", "fixed")
HEAD_TAB = "head"

# Sensible Blockbench-style defaults (player values override).
# thirdperson matches Blockbench Display Mode → Item preset.
_DEFAULT_TAB: dict[str, Any] = {
    "thirdperson_righthand": {
        "rotation": [0, 0, 0],
        "translation": [0, 3, 1],
        "scale": [0.55, 0.55, 0.55],
    },
    "thirdperson_lefthand": {
        "rotation": [0, 0, 0],
        "translation": [0, 3, 1],
        "scale": [0.55, 0.55, 0.55],
    },
    "firstperson_righthand": {
        "rotation": [0, -90, 25],
        "translation": [1.13, 3.2, 1.13],
        "scale": [0.68, 0.68, 0.68],
    },
    "firstperson_lefthand": {
        "rotation": [0, -90, 25],
        "translation": [1.13, 3.2, 1.13],
        "scale": [0.68, 0.68, 0.68],
    },
    "ground": {
        "rotation": [0, 0, 0],
        "translation": [0, 2, 0],
        "scale": [0.5, 0.5, 0.5],
    },
    "gui": {
        "rotation": [30, 225, 0],
        "translation": [0, 0, 0],
        "scale": [0.8, 0.8, 0.8],
    },
    "fixed": {
        "rotation": [0, 180, 0],
        "translation": [0, 0, 0],
        "scale": [1, 1, 1],
    },
    "head": {
        "rotation": [0, 180, 0],
        "translation": [0, -4, 0],
        "scale": [1, 1, 1],
    },
}

# Round-shield-ish defaults for shield idle (autofill holes only).
_SHIELD_DEFAULTS: dict[str, Any] = {
    **copy.deepcopy(_DEFAULT_TAB),
    "thirdperson_righthand": {
        "rotation": [0, -90, 0],
        "translation": [2, -2, 1],
        "scale": [1.01, 1.01, 1.01],
    },
    "thirdperson_lefthand": {
        "rotation": [0, -90, 0],
        "translation": [2, -2, 2],
        "scale": [1.01, 1.01, 1.01],
    },
    "firstperson_righthand": {
        "translation": [-3, 0, 4],
        "scale": [0.78, 0.78, 0.78],
    },
    "firstperson_lefthand": {
        "translation": [-3, 0, 4],
        "scale": [0.78, 0.78, 0.78],
    },
    "gui": {"rotation": [0, -180, 0]},
    "head": {"translation": [0, 6, -7]},
    "fixed": {"scale": [2.5, 2.5, 2.5]},
}


class DisplayError(ValueError):
    """Invalid or incomplete model display after merge."""


EXPORT_HINT = "Export in Blockbench as Java Block/Item (not Java Item)."
ROTATION_ERROR = (
    "Cubes may only rotate on one axis by 22.5° or 45°. " + EXPORT_HINT
)
NO_ELEMENTS_ERROR = "Model has no elements. " + EXPORT_HINT
ITEM_WRAPPER_ERROR = (
    "This looks like a Minecraft item definition, not a Java Block/Item model. "
    + EXPORT_HINT
)
PROJECT_FILE_ERROR = "This looks like a Blockbench project file. " + EXPORT_HINT
BOUNDS_ERROR = "Cube coordinates must be between -16 and 32."
TEXTURES_ERROR = "Model textures must be a map of texture ids to paths."
CUBE_ERROR = "Each cube needs from and to as three numbers."

_ALLOWED_AXES = frozenset({"x", "y", "z"})
_ALLOWED_ANGLES = (-45.0, -22.5, 0.0, 22.5, 45.0)
_COORD_MIN = -16.0
_COORD_MAX = 32.0


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _angle_allowed(value: Any) -> bool:
    if not _is_number(value):
        return False
    return any(abs(float(value) - allowed) < 1e-6 for allowed in _ALLOWED_ANGLES)


def _vec3(value: Any) -> bool:
    if not isinstance(value, list) or len(value) != 3:
        return False
    return all(_is_number(n) for n in value)


def _coords_in_bounds(vec: list) -> bool:
    return all(_COORD_MIN <= float(n) <= _COORD_MAX for n in vec)


def validate_java_block_model(model: dict[str, Any]) -> None:
    """Reject JSON Minecraft cannot load as a Java Block/Item model."""
    nested = model.get("model")
    if isinstance(nested, dict) and "type" in nested:
        raise DisplayError(ITEM_WRAPPER_ERROR)
    if "meta" in model:
        raise DisplayError(PROJECT_FILE_ERROR)

    textures = model.get("textures")
    if textures is not None:
        if isinstance(textures, list):
            raise DisplayError(PROJECT_FILE_ERROR)
        if not isinstance(textures, dict):
            raise DisplayError(TEXTURES_ERROR)
        if any(not isinstance(v, str) for v in textures.values()):
            raise DisplayError(TEXTURES_ERROR)

    elements = model.get("elements")
    if not isinstance(elements, list) or len(elements) == 0:
        raise DisplayError(NO_ELEMENTS_ERROR)

    for el in elements:
        if not isinstance(el, dict):
            raise DisplayError(CUBE_ERROR)
        from_v = el.get("from")
        to_v = el.get("to")
        if not _vec3(from_v) or not _vec3(to_v):
            raise DisplayError(CUBE_ERROR)
        if not _coords_in_bounds(from_v) or not _coords_in_bounds(to_v):
            raise DisplayError(BOUNDS_ERROR)
        rot = el.get("rotation")
        if rot is None:
            continue
        if isinstance(rot, list) or not isinstance(rot, dict):
            raise DisplayError(ROTATION_ERROR)
        if any(k in rot for k in ("x", "y", "z")) and "axis" not in rot:
            raise DisplayError(ROTATION_ERROR)
        axis = rot.get("axis")
        if axis not in _ALLOWED_AXES or not _angle_allowed(rot.get("angle")):
            raise DisplayError(ROTATION_ERROR)
        if not _vec3(rot.get("origin")):
            raise DisplayError(ROTATION_ERROR)


def required_tabs(kind: str) -> tuple[str, ...]:
    if kind in ("shield", "helmet_3d", "armor_helmet_3d", "mask"):
        return COMMON_TABS + (HEAD_TAB,)
    if kind in ("item_3d", "gun"):
        return COMMON_TABS
    raise DisplayError(f"Unknown 3D kind for display: {kind}")


def defaults_for_kind(kind: str) -> dict[str, Any]:
    if kind == "shield":
        return copy.deepcopy(_SHIELD_DEFAULTS)
    return copy.deepcopy(_DEFAULT_TAB)


def merge_display(
    submitted: dict[str, Any] | None, kind: str
) -> dict[str, Any]:
    """Merge defaults under submitted display (submitted wins per tab)."""
    defaults = defaults_for_kind(kind)
    out = copy.deepcopy(defaults)
    if isinstance(submitted, dict):
        for key, value in submitted.items():
            if isinstance(value, dict):
                out[key] = copy.deepcopy(value)
    # Drop head from item_3d/gun defaults unless player supplied it.
    if kind in ("item_3d", "gun") and HEAD_TAB not in (submitted or {}):
        out.pop(HEAD_TAB, None)
    return out


def validate_display(display: dict[str, Any], kind: str) -> None:
    needed = required_tabs(kind)
    missing = [t for t in needed if t not in display or not isinstance(display[t], dict)]
    if missing:
        raise DisplayError(
            "Model display missing required tabs after autofill: "
            + ", ".join(missing)
        )


def parse_and_merge_model(raw: bytes, kind: str) -> dict[str, Any]:
    """Parse Blockbench JSON, merge display, validate; return full model dict."""
    if not raw:
        raise DisplayError("Empty model JSON")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise DisplayError("Model JSON must be UTF-8") from e
    try:
        model = json.loads(text)
    except json.JSONDecodeError as e:
        raise DisplayError(f"Invalid model JSON: {e}") from e
    if not isinstance(model, dict):
        raise DisplayError("Model JSON must be an object")
    validate_java_block_model(model)
    submitted = model.get("display")
    if submitted is not None and not isinstance(submitted, dict):
        raise DisplayError("Model display must be an object")
    merged = merge_display(submitted, kind)
    validate_display(merged, kind)
    model["display"] = merged
    return model


def model_to_bytes(model: dict[str, Any]) -> bytes:
    return (json.dumps(model, indent=2) + "\n").encode("utf-8")
