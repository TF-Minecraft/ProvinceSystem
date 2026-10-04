"""Vectorized province map painting via numpy LUT lookup."""

from __future__ import annotations

from typing import Mapping, Sequence

import numpy as np
from PIL import Image

ColorTuple = tuple[int, ...]


def pack_rgb(rgb: np.ndarray) -> np.ndarray:
    """Pack (H, W, 3) uint8 RGB into (H, W) int32 keys."""
    channels = rgb.astype(np.int32)
    return (channels[:, :, 0] << 16) | (channels[:, :, 1] << 8) | channels[:, :, 2]


def _pack_key(rgb: Sequence[int]) -> int:
    return (int(rgb[0]) << 16) | (int(rgb[1]) << 8) | int(rgb[2])


def _resolve_rgba(
    color: ColorTuple,
    *,
    skip_black: bool,
) -> tuple[int, int, int, int] | None:
    if len(color) == 4:
        rgba = (int(color[0]), int(color[1]), int(color[2]), int(color[3]))
        if skip_black and rgba[:3] == (0, 0, 0):
            return None
        return rgba

    rgb = (int(color[0]), int(color[1]), int(color[2]))
    if skip_black and rgb == (0, 0, 0):
        return None
    return (*rgb, 255)


def paint_from_rgb_lut(
    provinces_rgba: np.ndarray,
    rgb_to_color: Mapping[tuple[int, int, int], ColorTuple],
    *,
    skip_black: bool = True,
) -> np.ndarray:
    """
    Paint provinces using a prebuilt RGB -> color LUT.

    Missing keys remain transparent. Values may be RGB (alpha 255) or RGBA.
    """
    # Index every possible packed RGB straight into a palette whose entry 0 is
    # transparent. Sorting pixels with np.unique costs seconds per call on a
    # 6400 px map; one gather avoids that cost.
    palette = [(0, 0, 0, 0)]
    index_dtype = np.uint16 if len(rgb_to_color) < 0xFFFF else np.uint32
    palette_index = np.zeros(1 << 24, dtype=index_dtype)
    for rgb, mapped in rgb_to_color.items():
        rgba = _resolve_rgba(mapped, skip_black=skip_black)
        if rgba is not None:
            palette_index[_pack_key(rgb)] = len(palette)
            palette.append(rgba)

    packed = pack_rgb(provinces_rgba[:, :, :3])
    return np.asarray(palette, dtype=np.uint8)[palette_index[packed]]


def _build_mode_lut(
    province_id_map: np.ndarray,
    rgb_to_id: Mapping[tuple[int, int, int], int],
    rgb_to_color: Mapping[tuple[int, int, int], ColorTuple],
    *,
    skip_black: bool,
) -> np.ndarray:
    max_id = int(province_id_map.max())
    mode_lut = np.zeros((max_id + 1, 4), dtype=np.uint8)

    for rgb, mapped in rgb_to_color.items():
        province_id = rgb_to_id.get(rgb)
        if province_id is None:
            continue

        rgba = _resolve_rgba(mapped, skip_black=skip_black)
        if rgba is not None:
            mode_lut[province_id] = rgba

    return mode_lut


def paint_from_province_id_lut(
    province_id_map: np.ndarray,
    rgb_to_id: Mapping[tuple[int, int, int], int],
    rgb_to_color: Mapping[tuple[int, int, int], ColorTuple],
    *,
    skip_black: bool = True,
) -> np.ndarray:
    """Paint using a prebuilt province-id map (no per-call np.unique)."""
    mode_lut = _build_mode_lut(
        province_id_map,
        rgb_to_id,
        rgb_to_color,
        skip_black=skip_black,
    )
    return mode_lut[province_id_map]


def load_provinces_array(path: str) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"), dtype=np.uint8)


def rgba_array_to_image(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(arr, mode="RGBA")
