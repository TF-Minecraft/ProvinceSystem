import os

# === Base ===
BASE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)
# BASE_DIR -> backend/src

# === High-level dirs ===
INPUT_DIR = os.path.join(BASE_DIR, "input")
DEFINES_DIR = os.path.join(BASE_DIR, "defines")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

# === Input ===
def input_file(map_name: str, filename: str) -> str:
    return os.path.join(INPUT_DIR, map_name, filename)

# === Defines ===
def defines_file(map_name: str, filename: str) -> str:
    return os.path.join(DEFINES_DIR, map_name, filename)

# === Output ===
def map_image(map_name: str, map_type: str) -> str:
    return os.path.join(OUTPUT_DIR, map_name, "maps", f"{map_type}_map.png")

def region_image(map_name: str, map_type: str, filename: str) -> str:
    return os.path.join(OUTPUT_DIR, map_name, "regions", map_type, filename)

def region_overlay_file(map_name: str, map_type: str) -> str:
    """Crop boxes for one mode's region PNGs, beside the PNGs themselves.

    Generated, not authored: the boxes describe where each cropped overlay sits
    on the full map, so they belong with the images rather than in the tier JSON
    under defines/. Not reachable through `get_region_file`, which appends
    `.png` to any name lacking it.
    """
    return os.path.join(OUTPUT_DIR, map_name, "regions", map_type, "overlays.json")

def banner_image(map_name: str, mode: str, filename: str) -> str:
    return os.path.join(OUTPUT_DIR, map_name, "banners", mode, filename)

def zoc_hatch_asset() -> str:
    return os.path.join(BASE_DIR, "assets", "map", "zoc_hatch.png")

def zoc_dir(map_name: str) -> str:
    return os.path.join(OUTPUT_DIR, map_name, "zoc")

def zoc_image(map_name: str, fort_id: str) -> str:
    return os.path.join(zoc_dir(map_name), f"{fort_id}.png")

def zoc_overlays_file(map_name: str) -> str:
    return defines_file(map_name, "zoc_overlays.json")

def validate_map(map_name: str):
    if not map_name.isalnum():
        raise ValueError("Invalid map name")