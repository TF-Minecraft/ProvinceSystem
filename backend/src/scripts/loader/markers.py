import json
import logging
import math
import os

from ..util.dirs import (
    defines_file,
    input_file,
    validate_map,
    zoc_image,
    zoc_overlays_file,
)
from ..util.zoc_paths import safe_fort_filename

logger = logging.getLogger(__name__)


def _empty_payload(map_name: str) -> dict:
    return {
        "map_id": map_name,
        "exported_at": None,
        "settlements": [],
        "installations": [],
        "forts": [],
        "wars": [],
    }


def normalize_raw_markers(data: object, map_name: str) -> dict:
    """Coerce already-parsed map_markers JSON into the shape callers expect.

    Split out of load_raw_markers so a caller that already holds the bytes (the
    chronicle serves them out of a stored gzip, not out of input/) gets exactly
    the same normalisation without going through the filesystem.
    """
    if not isinstance(data, dict):
        return _empty_payload(map_name)

    settlements = data.get("settlements")
    if not isinstance(settlements, list):
        settlements = []

    installations = data.get("installations")
    if not isinstance(installations, list):
        installations = []
    else:
        # Older exports still name hub_slots and hubs on an installation.
        # Supply hubs are gone; the fields are dropped and the row still loads.
        installations = [_installation_without_hubs(entry) for entry in installations]

    # Older map_markers.json files still name hub_links, trade_networks and
    # trade_edges. Those layers are gone; the keys are ignored.

    forts = data.get("forts")
    if not isinstance(forts, list):
        forts = []

    wars = data.get("wars")
    if not isinstance(wars, list):
        wars = []

    return {
        "map_id": data.get("map_id") or map_name,
        "exported_at": data.get("exported_at"),
        "settlement_large_population_threshold": data.get(
            "settlement_large_population_threshold"
        ),
        "settlements": settlements,
        "installations": installations,
        "forts": forts,
        "wars": wars,
    }


def load_raw_markers(map_name: str) -> dict:
    validate_map(map_name)
    path = input_file(map_name, "map_markers.json")
    if not os.path.exists(path):
        return _empty_payload(map_name)

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    return normalize_raw_markers(data, map_name)


# map_name -> (path, mtime, size, centroids). Centroids are static geometry shared by
# every day and every marker build, but the file is ~80 KB of JSON that was
# re-read and re-parsed per request: a 79-day timelapse re-parsed 6.5 MB of
# identical bytes for one button press. Freshness by mtime+size, the same shape
# chronicle_routes._cached_geometry_version uses, so there is one idiom for
# "reuse a defines artifact"; unbounded is fine because the key set is the map
# list. The path is part of the freshness check, not the key, so the key set
# stays the map list while a relocated defines dir is still a miss rather than a
# stale hit. The cached dict is handed out shared - every consumer below only
# reads it, and a regenerated file replaces the entry rather than mutating it.
_centroid_cache: dict[str, tuple[str, float, int, dict]] = {}


def clear_province_centroid_cache(map_name: str | None = None) -> None:
    """Drop a cached centroid set, or all of them when no map is named."""
    if map_name is None:
        _centroid_cache.clear()
    else:
        _centroid_cache.pop(map_name, None)


def load_province_centroids(map_name: str) -> dict:
    validate_map(map_name)
    path = defines_file(map_name, "province_centroids.json")
    try:
        stat = os.stat(path)
    except OSError:
        # Not generated yet: cache nothing, so the first build after this is
        # picked up immediately instead of being pinned to an empty answer.
        _centroid_cache.pop(map_name, None)
        return {}

    cached = _centroid_cache.get(map_name)
    if cached is not None and cached[:3] == (path, stat.st_mtime, stat.st_size):
        return cached[3]

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    centroids = data if isinstance(data, dict) else {}
    _centroid_cache[map_name] = (path, stat.st_mtime, stat.st_size, centroids)
    return centroids


def _finite_int(value) -> int | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        # OverflowError: an int too large to become a float, which json will
        # happily parse out of an upload.
        return None
    if not math.isfinite(number):
        # json accepts the bare Infinity/NaN literals, so a bad coordinate from
        # the game plugin arrives here as a real float, and round() answers it
        # with OverflowError - not a ValueError, so it used to escape. A
        # captured chronicle day is immutable by design, so one such value would
        # 500 that day's public markers route permanently.
        return None
    return int(round(number))


def world_coords_to_map_xy(center_x, center_z) -> tuple[int, int] | None:
    """Minecraft block X/Z map 1:1 to map pixel x/y (same as province lookup)."""
    x = _finite_int(center_x)
    z = _finite_int(center_z)
    if x is None or z is None:
        return None
    return x, z


def centroid_to_map_xy(centroid: dict) -> tuple[int, int] | None:
    if not isinstance(centroid, dict):
        return None
    x = _finite_int(centroid.get("x"))
    y = _finite_int(centroid.get("y"))
    if x is None or y is None:
        return None
    return x, y


def resolve_marker_map_xy(
    row: dict,
    centroids: dict,
) -> tuple[int, int] | None:
    world = world_coords_to_map_xy(row.get("center_x"), row.get("center_z"))
    if world is not None:
        return world

    province_id = row.get("province_id")
    if province_id is None:
        return None

    return centroid_to_map_xy(centroids.get(str(province_id), {}))


def resolve_settlement_map_xy(
    row: dict,
    centroids: dict,
) -> tuple[int, int] | None:
    return resolve_marker_map_xy(row, centroids)


def resolve_province_map_xy(
    province_id,
    centroids: dict,
    *,
    center_x=None,
    center_z=None,
) -> tuple[int, int] | None:
    world = world_coords_to_map_xy(center_x, center_z)
    if world is not None:
        return world
    if province_id is None:
        return None
    return centroid_to_map_xy(centroids.get(str(province_id), {}))


def build_province_name_index(
    settlements: list,
    installations: list,
) -> dict[int, str]:
    index: dict[int, str] = {}
    for rows in (settlements, installations):
        if not isinstance(rows, list):
            continue
        for entry in rows:
            if not isinstance(entry, dict):
                continue
            province_id = _finite_int(entry.get("province_id"))
            name = entry.get("name")
            if province_id is None or not isinstance(name, str) or not name.strip():
                continue
            index.setdefault(province_id, name)
    return index


def province_display_name(province_id: int, name_index: dict[int, str]) -> str:
    return name_index.get(province_id, f"Province {province_id}")


def build_installation_index(installations: list) -> dict[str, dict]:
    index: dict[str, dict] = {}
    if not isinstance(installations, list):
        return index
    for entry in installations:
        if not isinstance(entry, dict):
            continue
        installation_id = entry.get("id")
        if installation_id is None:
            continue
        index[str(installation_id)] = entry
    return index


def build_settlement_index_by_province(settlements: list) -> dict[int, dict]:
    index: dict[int, dict] = {}
    if not isinstance(settlements, list):
        return index
    for entry in settlements:
        if not isinstance(entry, dict):
            continue
        province_id = _finite_int(entry.get("province_id"))
        if province_id is None or province_id in index:
            continue
        index[province_id] = entry
    return index


_SLOT_STATUS_RANK = {"next": 0, "fought": 1, "upcoming": 2}


def resolve_schedule_slot_map_xy(
    entry: dict,
    centroids: dict,
    installation_index: dict[str, dict],
    settlement_index: dict[int, dict] | None = None,
) -> tuple[int, int] | None:
    fort_id = entry.get("fort_installation_id")
    if isinstance(fort_id, str) and fort_id.strip():
        installation = installation_index.get(fort_id)
        if installation is not None:
            map_xy = resolve_marker_map_xy(installation, centroids)
            if map_xy is not None:
                return map_xy

    port_id = entry.get("port_installation_id")
    if isinstance(port_id, str) and port_id.strip():
        installation = installation_index.get(port_id)
        if installation is not None:
            map_xy = resolve_marker_map_xy(installation, centroids)
            if map_xy is not None:
                return map_xy

    province_id = _finite_int(entry.get("province_id"))
    if province_id is None:
        return None

    if settlement_index:
        settlement = settlement_index.get(province_id)
        if settlement is not None:
            map_xy = resolve_marker_map_xy(settlement, centroids)
            if map_xy is not None:
                return map_xy

    return resolve_province_map_xy(province_id, centroids)


def enrich_war_schedule_slots(
    slots: list,
    centroids: dict,
    name_index: dict[int, str],
    installations: list | None = None,
    settlements: list | None = None,
) -> list[dict]:
    enriched: list[dict] = []
    if not isinstance(slots, list):
        return enriched

    installation_index = build_installation_index(installations or [])
    settlement_index = build_settlement_index_by_province(settlements or [])

    for entry in slots:
        if not isinstance(entry, dict):
            continue
        province_id = _finite_int(entry.get("province_id"))
        if province_id is None:
            continue

        map_xy = resolve_schedule_slot_map_xy(
            entry, centroids, installation_index, settlement_index
        )
        if map_xy is None:
            logger.warning(
                "Dropping war schedule slot for province %s: no map coordinates",
                province_id,
            )
            continue

        row = dict(entry)
        row["map_x"], row["map_y"] = map_xy
        row["province_name"] = province_display_name(province_id, name_index)
        enriched.append(row)

    return enriched


def enrich_war_capital(capital: dict | None, centroids: dict) -> dict | None:
    if not isinstance(capital, dict):
        return None
    province_id = _finite_int(capital.get("province_id"))
    if province_id is None:
        return None

    row = dict(capital)
    map_xy = resolve_province_map_xy(
        province_id,
        centroids,
        center_x=row.get("center_x"),
        center_z=row.get("center_z"),
    )
    if map_xy is not None:
        row["map_x"], row["map_y"] = map_xy
    return row


def _capital_coords_for_province(
    war: dict,
    province_id: int,
) -> tuple[int | None, int | None]:
    for key in ("attacker_capital", "defender_capital"):
        capital = war.get(key)
        if not isinstance(capital, dict):
            continue
        cap_province = _finite_int(capital.get("province_id"))
        if cap_province != province_id:
            continue
        center_x = capital.get("center_x")
        center_z = capital.get("center_z")
        if center_x is not None or center_z is not None:
            return center_x, center_z
    return None, None


def _slot_map_xy_for_province(
    war: dict, province_id: int
) -> tuple[int, int] | None:
    best: tuple[int, int] | None = None
    best_rank = 99
    for key in ("campaign_battle_schedule", "campaign_counter_schedule"):
        slots = war.get(key)
        if not isinstance(slots, list):
            continue
        for slot in slots:
            if not isinstance(slot, dict):
                continue
            if _finite_int(slot.get("province_id")) != province_id:
                continue
            map_x = _finite_int(slot.get("map_x"))
            map_y = _finite_int(slot.get("map_y"))
            if map_x is None or map_y is None:
                continue
            rank = _SLOT_STATUS_RANK.get(slot.get("status"), 3)
            if rank < best_rank:
                best = (map_x, map_y)
                best_rank = rank
    return best


def build_campaign_line_points(war: dict, centroids: dict) -> list[dict]:
    provinces = war.get("campaign_provinces")
    if not isinstance(provinces, list):
        return []

    points: list[dict] = []
    for raw_province_id in provinces:
        province_id = _finite_int(raw_province_id)
        if province_id is None:
            continue

        slot_xy = _slot_map_xy_for_province(war, province_id)
        if slot_xy is not None:
            map_x, map_y = slot_xy
        else:
            center_x, center_z = _capital_coords_for_province(war, province_id)
            map_xy = resolve_province_map_xy(
                province_id,
                centroids,
                center_x=center_x,
                center_z=center_z,
            )
            if map_xy is None:
                logger.warning(
                    "Skipping campaign line point for province %s: no map coordinates",
                    province_id,
                )
                continue
            map_x, map_y = map_xy

        points.append(
            {
                "province_id": province_id,
                "map_x": map_x,
                "map_y": map_y,
            }
        )
    return points


def enrich_war(
    war: dict,
    centroids: dict,
    name_index: dict[int, str],
    installations: list | None = None,
    settlements: list | None = None,
) -> dict:
    row = dict(war)

    invasion = enrich_war_schedule_slots(
        row.get("campaign_battle_schedule") or [],
        centroids,
        name_index,
        installations,
        settlements,
    )
    row["campaign_battle_schedule"] = invasion

    counter_key = "campaign_counter_schedule"
    if counter_key in row:
        counter = enrich_war_schedule_slots(
            row.get(counter_key) or [],
            centroids,
            name_index,
            installations,
            settlements,
        )
        if counter:
            row[counter_key] = counter
        else:
            row.pop(counter_key, None)

    attacker_capital = enrich_war_capital(row.get("attacker_capital"), centroids)
    if attacker_capital is not None:
        row["attacker_capital"] = attacker_capital
    else:
        row.pop("attacker_capital", None)

    defender_capital = enrich_war_capital(row.get("defender_capital"), centroids)
    if defender_capital is not None:
        row["defender_capital"] = defender_capital
    else:
        row.pop("defender_capital", None)

    row["campaign_line_points"] = build_campaign_line_points(row, centroids)
    return row


def enrich_wars(
    wars: list,
    centroids: dict,
    name_index: dict[int, str],
    installations: list | None = None,
    settlements: list | None = None,
) -> list[dict]:
    enriched: list[dict] = []
    if not isinstance(wars, list):
        return enriched

    for entry in wars:
        if not isinstance(entry, dict):
            continue
        enriched.append(
            enrich_war(entry, centroids, name_index, installations, settlements)
        )
    return enriched


def enrich_marker_rows(
    rows: list,
    centroids: dict,
) -> list[dict]:
    enriched: list[dict] = []
    for entry in rows:
        if not isinstance(entry, dict):
            continue

        row = dict(entry)
        map_xy = resolve_marker_map_xy(row, centroids)
        if map_xy is not None:
            row["map_x"], row["map_y"] = map_xy

        enriched.append(row)

    return enriched


def enrich_settlements(
    settlements: list,
    centroids: dict,
) -> list[dict]:
    return enrich_marker_rows(settlements, centroids)


def _installation_without_hubs(entry: object) -> object:
    if not isinstance(entry, dict):
        return entry
    row = dict(entry)
    row.pop("hub_slots", None)
    row.pop("hubs", None)
    return row


def enrich_installations(
    installations: list,
    centroids: dict,
) -> list[dict]:
    return enrich_marker_rows(
        [_installation_without_hubs(entry) for entry in installations],
        centroids,
    )


def load_zoc_overlays(map_name: str) -> dict:
    validate_map(map_name)
    path = zoc_overlays_file(map_name)
    if not os.path.exists(path):
        return {}

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    return data if isinstance(data, dict) else {}


def enrich_forts(
    forts: list,
    centroids: dict,
    overlays: dict,
    map_name: str,
) -> list[dict]:
    enriched: list[dict] = []
    for entry in forts:
        if not isinstance(entry, dict):
            continue

        row = dict(entry)
        fort_id = row.get("id")
        map_xy = resolve_marker_map_xy(row, centroids)
        if map_xy is not None:
            row["map_x"], row["map_y"] = map_xy

        if fort_id is not None:
            overlay_entry = overlays.get(str(fort_id))
            if isinstance(overlay_entry, dict) and isinstance(
                overlay_entry.get("overlay"), dict
            ):
                row["overlay"] = overlay_entry["overlay"]

            safe_id = safe_fort_filename(str(fort_id))
            if safe_id is not None and os.path.exists(zoc_image(map_name, safe_id)):
                row["zoc_url"] = f"/{map_name}/zoc/{safe_id}.png"

        enriched.append(row)

    return enriched


def build_markers_response_from(
    raw: dict,
    centroids: dict,
    overlays: dict,
    map_name: str,
) -> dict:
    """Enrich already-loaded marker inputs.

    Separate from build_markers_response so the same enrichment can run against
    a stored chronicle day's files instead of the live input/ + defines/ ones.
    """
    # The only guard used to be load_raw_markers, which this path skips: map_name
    # still becomes both a filesystem path (zoc_image) and a response URL
    # (/{map_name}/zoc/...) inside enrich_forts.
    validate_map(map_name)
    name_index = build_province_name_index(
        raw["settlements"],
        raw["installations"],
    )
    return {
        "map_id": raw["map_id"],
        "exported_at": raw["exported_at"],
        "settlement_large_population_threshold": raw.get(
            "settlement_large_population_threshold"
        ),
        "settlements": enrich_settlements(raw["settlements"], centroids),
        "installations": enrich_installations(raw["installations"], centroids),
        "forts": enrich_forts(raw["forts"], centroids, overlays, map_name),
        "wars": enrich_wars(
            raw.get("wars") or [],
            centroids,
            name_index,
            raw["installations"],
            raw["settlements"],
        ),
    }


def build_markers_response(map_name: str) -> dict:
    return build_markers_response_from(
        load_raw_markers(map_name),
        load_province_centroids(map_name),
        load_zoc_overlays(map_name),
        map_name,
    )
