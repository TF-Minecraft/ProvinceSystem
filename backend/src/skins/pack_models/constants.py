"""Load shared pack model constants (ProvinceSystem/shared/skins/…)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

# backend/src/skins/pack_models → ProvinceSystem/
_PROVINCE_ROOT = Path(__file__).resolve().parents[4]
_CONSTANTS_PATH = _PROVINCE_ROOT / "shared" / "skins" / "pack_model_constants.json"


@lru_cache(maxsize=1)
def load_constants() -> dict[str, Any]:
    with _CONSTANTS_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise RuntimeError(f"Invalid constants at {_CONSTANTS_PATH}")
    return data


def namespace() -> str:
    """ItemsAdder namespace for generated pack models.

    All realms use the shared main namespace (tfmc_submissions); generated
    texture paths do not select a separate namespace by realm.
    """
    return str(load_constants()["namespace"])
