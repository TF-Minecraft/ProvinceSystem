"""Per-regeneration cache for province geometry arrays."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..loader.provinces import load_provinces, load_province_terrains
from ..province_id_grid import build_province_id_map
from ..util.dirs import input_file, validate_map
from .map_paint_numpy import load_provinces_array, pack_rgb

SKIP_TERRAINS = {"water", "sea", ""}


@dataclass
class MapGeometryCache:
    width: int
    height: int
    provinces_rgba: np.ndarray
    packed_rgb: np.ndarray
    province_id_map: np.ndarray
    land_mask: np.ndarray
    rgb_to_id: dict[tuple[int, int, int], int]
    _province_boxes: dict[int, tuple[int, int, int, int]] | None = field(
        default=None, repr=False, compare=False
    )

    @classmethod
    def load(cls, map_name: str) -> MapGeometryCache:
        validate_map(map_name)

        provinces_path = input_file(map_name, "provinces.png")
        provinces_rgba = load_provinces_array(provinces_path)
        height, width = provinces_rgba.shape[:2]

        width, height, province_id_map = build_province_id_map(map_name)
        rgb_to_id = load_provinces(map_name)
        packed_rgb = pack_rgb(provinces_rgba[:, :, :3])

        terrains = load_province_terrains(map_name)
        land_ids = [
            province_id
            for province_id, terrain in terrains.items()
            if terrain not in SKIP_TERRAINS
        ]
        is_land = np.zeros(
            max([int(province_id_map.max()), *land_ids]) + 1, dtype=bool
        )
        is_land[land_ids] = True
        land_mask = is_land[province_id_map]

        return cls(
            width=width,
            height=height,
            provinces_rgba=provinces_rgba,
            packed_rgb=packed_rgb,
            province_id_map=province_id_map,
            land_mask=land_mask,
            rgb_to_id=rgb_to_id,
        )

    def province_box(self, province_id: int) -> tuple[int, int, int, int] | None:
        """`(x0, y0, x1, y1)` around a province's pixels, or None if it has none.

        Lets callers compare a province's own box rather than the whole map,
        which over hundreds of provinces is most of the work.
        """
        if self._province_boxes is None:
            self._province_boxes = _province_boxes(self.province_id_map)
        return self._province_boxes.get(province_id)


def _province_boxes(ids: np.ndarray) -> dict[int, tuple[int, int, int, int]]:
    height, width = ids.shape
    count = int(ids.max()) + 1
    rows = np.zeros((count, height), dtype=bool)
    rows[ids, np.arange(height)[:, None]] = True
    cols = np.zeros((count, width), dtype=bool)
    cols[ids, np.arange(width)[None, :]] = True
    present = np.flatnonzero(rows.any(axis=1))
    y0 = rows.argmax(axis=1)
    y1 = height - rows[:, ::-1].argmax(axis=1)
    x0 = cols.argmax(axis=1)
    x1 = width - cols[:, ::-1].argmax(axis=1)
    return {
        int(i): (int(x0[i]), int(y0[i]), int(x1[i]), int(y1[i])) for i in present
    }
