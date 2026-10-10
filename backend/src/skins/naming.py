"""Submission id helpers (IGN + display name) and armor field constants.

Upload filenames are ignored for identity — the API assigns stems.
See docs/cosmetics/naming.md.
"""

from __future__ import annotations

import re

SLUG_RE = re.compile(r"^[a-z][a-z0-9_]{1,47}$")

RESERVED = frozenset(
    {
        "test",
        "texture",
        "null",
        "undefined",
        "admin",
        "tfmc",
    }
)

# One armour submission is one metal line: up to one set of each type, all the
# same metal. Each set's tier id is ``{type}_{metal}`` (slug-safe: it is part of
# the shop key and IA ids) and its ArmourShop base set is ``{type} {metal}``.
ARMOR_TYPES = ("light", "medium", "heavy", "infantry", "mage")
ARMOR_METALS = ("iron", "steel", "bronze", "abyssalite", "mythril")
MAX_ARMOR_SETS = len(ARMOR_TYPES)


def parse_armor_tier(tier: str) -> tuple[str, str] | None:
    """``light_iron`` → ``("light", "iron")``; None for anything else."""
    armor_type, _, metal = (tier or "").partition("_")
    if armor_type in ARMOR_TYPES and metal in ARMOR_METALS:
        return armor_type, metal
    return None


def armor_tier_base_set(tier: str) -> str:
    """ArmourShop base set for a tier. Older bare tiers (``iron``, ``mage``) are their own set."""
    parsed = parse_armor_tier(tier)
    return f"{parsed[0]} {parsed[1]}" if parsed else tier


def armor_tier_label(tier: str) -> str:
    """Default display suffix: ``Light Iron`` (matches shop YAML like "Osenic Iron")."""
    return " ".join(part.capitalize() for part in armor_tier_base_set(tier).split())


MAX_TIER_ALIAS_LEN = 32

ARMOR_ICON_FIELDS = ("helmet", "chestplate", "leggings", "boots")
ARMOR_LAYER_FIELDS = ("layer_1", "layer_2")
ARMOR_FIELDS = ARMOR_ICON_FIELDS + ARMOR_LAYER_FIELDS

BOW_PULL_FIELDS = ("pull_0", "pull_1", "pull_2")
BOW_FRAME_FIELDS = ("texture",) + BOW_PULL_FIELDS
CROSSBOW_FRAME_FIELDS = BOW_FRAME_FIELDS + ("charged",)
BOOK_FIELDS = ("unsigned", "signed")


class SlugError(ValueError):
    """Raised when a skin / submission id fails validation."""


def assert_slug(slug: str) -> str:
    """Validate technical id; return unchanged if valid."""
    if not isinstance(slug, str) or slug == "":
        raise SlugError(
            "Id must use lowercase letters, numbers, and underscores."
        )
    if not SLUG_RE.fullmatch(slug):
        raise SlugError(
            "Id must be 2–48 characters, start with a letter, "
            "and use only lowercase a-z, 0-9, and underscores."
        )
    if "__" in slug:
        raise SlugError("Id cannot contain double underscores (__).")
    if slug in RESERVED:
        raise SlugError(f"The id '{slug}' is reserved.")
    return slug


def sanitize_ign(minecraft_name: str | None) -> str:
    """Sanitize Minecraft IGN to slug fragment (a-z0-9_)."""
    s = (minecraft_name or "").lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        s = "player"
    if s[0].isdigit():
        s = f"p_{s}"
    if len(s) > 16:
        s = s[:16].rstrip("_")
    if not s or s[0].isdigit():
        s = "player"
    return s


def slugify_display_name(display_name: str, *, max_len: int = 48) -> str:
    """Slugify item name for use in submission ids."""
    s = (display_name or "").lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        raise SlugError("Item name must include letters or numbers")
    if s[0].isdigit():
        s = f"skin_{s}"
    if len(s) > max_len:
        s = s[:max_len].rstrip("_")
    if not s:
        raise SlugError("Item name is too short after cleaning")
    return s


def build_submission_id(minecraft_name: str | None, display_name: str) -> str:
    """
    `{sanitized_ign}_{slugify(display_name)}` — player API id, pack family, delete key.
    """
    ign = sanitize_ign(minecraft_name)
    # Reserve room for ign + underscore within 48 chars
    max_name = max(8, 48 - len(ign) - 1)
    name_part = slugify_display_name(display_name, max_len=max_name)
    full = f"{ign}_{name_part}"
    try:
        return assert_slug(full)
    except SlugError as e:
        raise SlugError(
            "Could not build a valid skin id from your Minecraft name "
            "and item name. Shorten the item name and try again."
        ) from e


def _realm_id_slug_fragment(realm_id: str | None) -> str:
    """Normalize realm for submission-id prefix (hyphens → underscores)."""
    raw = (realm_id or "").strip().lower()
    if not raw or raw == "main":
        return ""
    frag = re.sub(r"[^a-z0-9_]+", "_", raw.replace("-", "_"))
    frag = re.sub(r"_+", "_", frag).strip("_")
    if not frag:
        return ""
    if frag[0].isdigit():
        frag = f"r_{frag}"
    return frag


def build_submission_id_for_realm(
    minecraft_name: str | None,
    display_name: str,
    realm_id: str | None = None,
) -> str:
    """
    Like build_submission_id, but prefixes `{realm}_` when realm is not main.
    """
    realm_frag = _realm_id_slug_fragment(realm_id)
    if not realm_frag:
        return build_submission_id(minecraft_name, display_name)
    ign = sanitize_ign(minecraft_name)
    prefix = f"{realm_frag}_"
    # Reserve room for prefix + ign + underscore within 48 chars
    max_name = max(4, 48 - len(prefix) - len(ign) - 1)
    name_part = slugify_display_name(display_name, max_len=max_name)
    full = f"{prefix}{ign}_{name_part}"
    try:
        return assert_slug(full)
    except SlugError as e:
        raise SlugError(
            "Could not build a valid skin id from your Minecraft name "
            "and item name. Shorten the item name and try again."
        ) from e


def build_staff_submission_id(
    display_name: str,
    realm_id: str | None = None,
) -> str:
    """
    Display-slug only — staff curated skins land in real shop categories without an IGN prefix.
    Prefixes `{realm}_` when realm is not main.
    """
    realm_frag = _realm_id_slug_fragment(realm_id)
    try:
        if not realm_frag:
            return assert_slug(slugify_display_name(display_name))
        prefix = f"{realm_frag}_"
        max_name = max(4, 48 - len(prefix))
        name_part = slugify_display_name(display_name, max_len=max_name)
        return assert_slug(f"{prefix}{name_part}")
    except SlugError as e:
        raise SlugError(
            "Could not build a valid skin set key from the item name. "
            "Use letters/numbers, shorten it, and try again."
        ) from e
