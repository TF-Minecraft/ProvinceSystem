from ..util.dirs import defines_file, validate_map
import os

def _parse_provinces_file(map_name: str) -> list[tuple[int, tuple[int, int, int], str | None, int | None]]:
    validate_map(map_name)

    province_file_path = defines_file(map_name, "provinces.txt")
    if not os.path.exists(province_file_path):
        raise FileNotFoundError(
            f"provinces.txt not found for map '{map_name}'"
        )

    rows: list[tuple[int, tuple[int, int, int], str | None, int | None]] = []

    with open(province_file_path, "r", encoding="utf-8") as file:
        for line_num, line in enumerate(file, start=1):
            line = line.strip()

            if not line or line.startswith("##"):
                continue

            try:
                province_id_str, rest = line.split("=", 1)
                province_id = int(province_id_str.strip())

                parts = rest.split(";")
                rgb_part = parts[0].strip()
                rgb = tuple(map(int, rgb_part.split(",")))

                if len(rgb) != 3:
                    raise ValueError("RGB must have exactly 3 values")

                terrain: str | None = None
                if len(parts) > 1 and parts[1].strip():
                    terrain = parts[1].strip()

                fertility: int | None = None
                if len(parts) > 2 and parts[2].strip():
                    fertility = int(parts[2].strip())

                rows.append((province_id, rgb, terrain, fertility))

            except Exception as e:
                raise ValueError(
                    f"Invalid line in {province_file_path} "
                    f"(line {line_num}): {line}"
                ) from e

    return rows


def load_provinces(map_name: str) -> dict[tuple[int, int, int], int]:
    """
    Loads province RGB -> province_id mappings for a given map.
    """
    provinces: dict[tuple[int, int, int], int] = {}
    for province_id, rgb, _terrain, _fertility in _parse_provinces_file(map_name):
        provinces[rgb] = province_id
    return provinces


def load_province_terrains(map_name: str) -> dict[int, str]:
    """Province id -> terrain string from provinces.txt (empty string if omitted)."""
    terrains: dict[int, str] = {}
    for province_id, _rgb, terrain, _fertility in _parse_provinces_file(map_name):
        terrains[province_id] = terrain or ""
    return terrains


def load_province_catalog(map_name: str) -> list[dict]:
    """Province rows for the map title editor sidebar."""
    catalog: list[dict] = []
    for province_id, rgb, terrain, fertility in _parse_provinces_file(map_name):
        row: dict = {
            "id": province_id,
            "rgb": f"{rgb[0]},{rgb[1]},{rgb[2]}",
        }
        if terrain:
            row["terrain"] = terrain
        if fertility is not None:
            row["fertility"] = fertility
        catalog.append(row)
    return catalog
