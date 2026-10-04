"""Large handheld thin model (parent handheld + grip display)."""

from __future__ import annotations

from typing import Any

from .constants import load_constants
from .textures import texture_path


def clamp_grip_y(y: float) -> float:
    consts = load_constants()["large_handheld"]
    lo = float(consts["grip_y_min"])
    hi = float(consts["grip_y_max"])
    default = float(consts["grip_y_default"])
    if y != y:  # NaN
        return default
    return max(lo, min(hi, float(y)))


def first_person_y(third_person_y: float) -> float:
    consts = load_constants()["large_handheld"]["fp_map"]
    y = clamp_grip_y(third_person_y)
    tp_low = float(consts["legacy_tp_low"])
    fp_low = float(consts["legacy_fp_low"])
    tp_span = float(consts["legacy_tp_span"])
    fp_span = float(consts["legacy_fp_span"])
    return fp_low + (y - tp_low) * (fp_span / tp_span)


def _format_num(v: float) -> float:
    """Keep JSON numbers tidy (match Java format intent)."""
    if abs(v - round(v)) < 1e-9:
        return float(f"{v:.1f}")
    return float(f"{v:.2f}")


def parse_grip_preset(raw: str | None) -> float:
    if raw is None or not str(raw).strip():
        raise ValueError("grip_preset is required")
    text = str(raw).strip()
    try:
        value = float(text)
    except ValueError as e:
        raise ValueError(f"Unknown grip_preset: {raw}") from e
    consts = load_constants()["large_handheld"]
    lo = float(consts["grip_y_min"])
    hi = float(consts["grip_y_max"])
    if value < lo or value > hi or value != value:
        raise ValueError(f"grip_preset must be between {lo} and {hi}: {raw}")
    return value


def build_large_handheld_model(slug: str, grip_y: float) -> dict[str, Any]:
    consts = load_constants()["large_handheld"]
    y = _format_num(clamp_grip_y(grip_y))
    fp_y = _format_num(first_person_y(y))

    def hand_tab(key: str, y_val: float) -> dict[str, Any]:
        tab = consts[key]
        xz = tab["translation_xz"]
        return {
            "rotation": list(tab["rotation"]),
            "translation": [xz[0], y_val, xz[1]],
            "scale": list(tab["scale"]),
        }

    return {
        "parent": consts["parent"],
        "textures": {"layer0": texture_path(slug)},
        "display": {
            "thirdperson_righthand": hand_tab("thirdperson_righthand", y),
            "thirdperson_lefthand": hand_tab("thirdperson_lefthand", y),
            "firstperson_righthand": hand_tab("firstperson_righthand", fp_y),
            "firstperson_lefthand": hand_tab("firstperson_lefthand", fp_y),
            "gui": copy_tab(consts["gui"]),
            "ground": copy_tab(consts["ground"]),
            "fixed": copy_tab(consts["fixed"]),
        },
    }


def copy_tab(tab: dict[str, Any]) -> dict[str, Any]:
    return {
        "rotation": list(tab["rotation"]),
        "translation": list(tab["translation"]),
        "scale": list(tab["scale"]),
    }
