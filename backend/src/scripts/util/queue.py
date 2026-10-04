import os
import json

# === Paths ===
BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "..")

INPUT_DIR = os.path.join(BASE_DIR, "input")
DEFINES_DIR = os.path.join(BASE_DIR, "defines")

def raw_queue_path(map_name: str) -> str:
    return os.path.join(INPUT_DIR, map_name, "queue.json")

def compiled_queue_path(map_name: str) -> str:
    return os.path.join(DEFINES_DIR, map_name, "queue.json")

# === Compiler ===
def compile_queue(map_name: str):
    raw_path = raw_queue_path(map_name)
    compiled_path = compiled_queue_path(map_name)

    if not os.path.exists(raw_path):
        print(f"No raw queue.json found for map '{map_name}'")
        return


    with open(raw_path, "r", encoding="utf-8") as f:
        raw_queue = json.load(f)

    compiled_queue = {}

    for mode in list(raw_queue.keys()):
        data_path = os.path.join(DEFINES_DIR, map_name, f"{mode}.json")

        if not os.path.exists(data_path):
            print(f"❌ Skipping {mode}: no defines/{mode}.json")
            continue

        with open(data_path, "r", encoding="utf-8") as f:
            region_data = json.load(f)

        # Build rgb -> region_id mapping
        rgb_to_id = {}
        for region_id, info in region_data.items():
            rgb = info.get("rgb")
            if rgb:
                rgb_to_id[rgb] = region_id

        expanded_ids = set()

        def expand(region_id):
            if region_id not in region_data:
                return
            if region_id in expanded_ids:
                return
            expanded_ids.add(region_id)

            for subject in region_data[region_id].get("subjects", []):
                expand(subject)

            overlord = region_data[region_id].get("overlord")
            if overlord:
                expand(overlord)

        # Expand from RGBs in the raw queue
        initial_rgb_list = raw_queue[mode]

        for rgb in initial_rgb_list:
            region_id = rgb_to_id.get(rgb)
            if region_id:
                expand(region_id)
            else:
                print(f"⚠️ No region found with RGB: {rgb}")

        # Convert back to RGBs for the compiled queue
        from ..mapgen.regiongen import sanitize_filename

        compiled_queue[mode] = [
            sanitize_filename(tuple(map(int, region_data[rid]["rgb"].split(","))))
            for rid in expanded_ids
            if "rgb" in region_data[rid]
        ]

    os.makedirs(DEFINES_DIR, exist_ok=True)
    with open(compiled_path, "w", encoding="utf-8") as f:
        json.dump(compiled_queue, f, indent=2)

    print("✅ Compiled queue written to defines/queue.json")

# === Load compiled queue for generation ===
def load_queue(map_name: str, mode: str) -> list:
    compiled_path = compiled_queue_path(map_name)

    if os.path.exists(compiled_path):
        with open(compiled_path, "r", encoding="utf-8") as f:
            queue = json.load(f)
            return queue.get(mode.lower(), [])

    return []

# === Save to raw input queue ===
def _save_queue(map_name: str, queue: dict):
    path = raw_queue_path(map_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(queue, f, ensure_ascii=False, indent=2)

# === Add region to raw queue ===
def enqueue(map_name: str, mode: str, path: str):
    mode = mode.lower()
    raw_path = raw_queue_path(map_name)

    queue = {}
    if os.path.exists(raw_path):
        with open(raw_path, "r", encoding="utf-8") as f:
            queue = json.load(f)

    queue.setdefault(mode, [])

    if path not in queue[mode]:
        queue[mode].append(path)

    _save_queue(map_name, queue)

# === Clear raw queue by mode ===
def clear_mode(map_name: str, mode: str):
    mode = mode.lower()
    raw_path = raw_queue_path(map_name)

    if not os.path.exists(raw_path):
        print(f"No queue found for map '{map_name}'")
        return

    with open(raw_path, "r", encoding="utf-8") as f:
        queue = json.load(f)

    if mode in queue:
        del queue[mode]
        _save_queue(map_name, queue)
        print(f"Cleared all entries under mode '{mode}' for map '{map_name}'.")
    else:
        print(f"No entries to clear for mode '{mode}' on map '{map_name}'.")


def queue_all_for_mode(map_name: str, mode: str) -> list[str]:
    """Queue every region RGB for a map mode (mirrors SF queueAllNations for nation)."""
    from .dirs import defines_file, validate_map

    validate_map(map_name)
    mode = mode.lower()
    data_path = defines_file(map_name, f"{mode}.json")
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"No defines file for mode '{mode}' on map '{map_name}'")

    with open(data_path, encoding="utf-8") as handle:
        region_data = json.load(handle)

    rgbs: list[str] = []
    for info in region_data.values():
        if not isinstance(info, dict):
            continue
        rgb = info.get("rgb")
        if not rgb:
            continue
        if mode == "nation":
            provinces = info.get("provinces")
            if not isinstance(provinces, list) or len(provinces) == 0:
                continue
        rgbs.append(rgb)

    raw_path = raw_queue_path(map_name)
    queue: dict = {}
    if os.path.exists(raw_path):
        with open(raw_path, encoding="utf-8") as handle:
            queue = json.load(handle)

    queue[mode] = sorted(set(rgbs))
    _save_queue(map_name, queue)
    return queue[mode]
