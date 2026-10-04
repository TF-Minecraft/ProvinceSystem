"""Generate the satellite map preview shown while tiles load."""

import os

from PIL import Image

from ..util.dirs import input_file, map_image, validate_map

# Low-resolution placeholder shown while the multi-MB base map downloads.
PREVIEW_FILENAME = "map_preview.webp"
PREVIEW_MAX_SIZE = 800
PREVIEW_QUALITY = 50  # 800x800 placeholder: q50 = ~78 KB on main, q70 = ~103 KB
PREVIEW_METHOD = 4


def map_preview_path(map_name: str) -> str:
    """Placeholder lives beside the other generated map images."""
    return os.path.join(os.path.dirname(map_image(map_name, "nation")), PREVIEW_FILENAME)


def create_map_preview(map_name: str) -> str | None:
    """Write an 800x800-max WebP placeholder from map.png. Returns the path."""
    validate_map(map_name)

    map_path = input_file(map_name, "map.png")
    if not os.path.exists(map_path):
        print(f"⚠️ Skipping map preview: map.png missing for '{map_name}'")
        return None

    out_path = map_preview_path(map_name)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    with Image.open(map_path) as source:
        preview = source.convert("RGB")
        preview.thumbnail(
            (PREVIEW_MAX_SIZE, PREVIEW_MAX_SIZE), Image.Resampling.LANCZOS
        )
        preview.save(
            out_path, "WEBP", quality=PREVIEW_QUALITY, method=PREVIEW_METHOD
        )

    size_kb = os.path.getsize(out_path) / 1024
    print(
        f"🖼️ [{map_name}] Map preview generated "
        f"→ {out_path} ({size_kb:.0f} KB)"
    )
    return out_path
