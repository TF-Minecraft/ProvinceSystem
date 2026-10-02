"""Production startup guard for dev bypass flags and missing API keys."""

from __future__ import annotations

import os

from src.skins.auth import _DEV_PLUGIN, _DEV_STAFF, get_secondary_plugin_keys


def is_production() -> bool:
    return os.environ.get("PS_PRODUCTION", "").strip() == "1"


def assert_production_safe() -> None:
    if not is_production():
        return

    errors: list[str] = []
    if os.environ.get("SKINS_DEV", "").strip() == "1":
        errors.append("SKINS_DEV must not be set when PS_PRODUCTION=1")
    if os.environ.get("CHARACTER_UI_DEV", "").strip() == "1":
        errors.append("CHARACTER_UI_DEV must not be set when PS_PRODUCTION=1")
    dev_keys = {_DEV_PLUGIN, _DEV_STAFF}
    for name in ("PLUGIN_KEY", "STAFF_KEY"):
        key = os.environ.get(name, "").strip()
        if not key:
            errors.append(f"{name} is required when PS_PRODUCTION=1")
        elif key in dev_keys:
            errors.append(f"{name} must not use a development default when PS_PRODUCTION=1")
    if any(key in dev_keys for key in get_secondary_plugin_keys()):
        errors.append("PLUGIN_KEYS_SECONDARY must not use development defaults when PS_PRODUCTION=1")
    if errors:
        raise RuntimeError("Production startup refused: " + "; ".join(errors))
