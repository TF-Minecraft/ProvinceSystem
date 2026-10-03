"""Numpy mask/crop pipeline for region generation."""

from __future__ import annotations

import os
import sys
import time
from typing import Mapping

import numpy as np
from PIL import Image

from ..util.border_paint import (
    apply_occupation_seam_dashes_array,
    border_color_for_fill,
    border_thickness as default_border_thickness,
    stroke_opaque_union_array,
)
from ..util.colour_mapping import build_color_mapping, get_color_overrides
from ..util.display_colour import display_rgb, hover_rgb, occupation_display_rgb
from ..util.overlay_metadata import (
    crop_to_content,
    rgb_tuple_to_str,
    write_overlay_metadata,
)
from ..util.queue import load_queue, compile_queue, clear_mode
from ..util.dirs import input_file, validate_map
from .geometry_cache import MapGeometryCache

OwnerColor = tuple[int, int, int]


def log_progress(message: str) -> None:
    sys.stdout.write("\r" + message)
    sys.stdout.flush()


def _sanitize_filename(color: OwnerColor) -> str:
    return "_".join(map(str, color))


def _build_overlord_chains(overrides: Mapping[OwnerColor, OwnerColor]) -> dict:
    chains: dict[OwnerColor, list[OwnerColor]] = {}
    for vassal in overrides:
        cur = vassal
        seen = {vassal}
        chain: list[OwnerColor] = []

        while cur in overrides:
            nxt = overrides[cur]
            if nxt in seen:
                break
            chain.append(nxt)
            seen.add(nxt)
            cur = nxt

        chains[vassal] = chain

    return chains


class RegionBuffer:
    """Bbox-cropped RGBA buffers for one political owner color."""

    def __init__(self, with_nested: bool) -> None:
        self.with_nested = with_nested
        self.x0 = self.y0 = 0
        self.x1 = self.y1 = 0
        self.base: np.ndarray | None = None
        self.hover: np.ndarray | None = None
        self.nested: np.ndarray | None = None
        self.nested_hover: np.ndarray | None = None
        self.overlay_meta: dict[str, int] | None = None
        self.overlay_nested_meta: dict[str, int] | None = None
        self._initialized = False

    def _expand(self, new_x0: int, new_y0: int, new_x1: int, new_y1: int) -> None:
        if not self._initialized:
            self.x0, self.y0, self.x1, self.y1 = new_x0, new_y0, new_x1, new_y1
            height = new_y1 - new_y0
            width = new_x1 - new_x0
            self.base = np.zeros((height, width, 4), dtype=np.uint8)
            self.hover = np.zeros((height, width, 4), dtype=np.uint8)
            if self.with_nested:
                self.nested = np.zeros((height, width, 4), dtype=np.uint8)
                self.nested_hover = np.zeros((height, width, 4), dtype=np.uint8)
            self._initialized = True
            return

        nx0 = min(self.x0, new_x0)
        ny0 = min(self.y0, new_y0)
        nx1 = max(self.x1, new_x1)
        ny1 = max(self.y1, new_y1)
        if (nx0, ny0, nx1, ny1) == (self.x0, self.y0, self.x1, self.y1):
            return

        new_h, new_w = ny1 - ny0, nx1 - nx0
        new_base = np.zeros((new_h, new_w, 4), dtype=np.uint8)
        new_hover = np.zeros((new_h, new_w, 4), dtype=np.uint8)
        new_nested = new_nested_hover = None
        if self.with_nested:
            new_nested = np.zeros((new_h, new_w, 4), dtype=np.uint8)
            new_nested_hover = np.zeros((new_h, new_w, 4), dtype=np.uint8)

        sy, sx = self.y0 - ny0, self.x0 - nx0
        eh, ew = self.y1 - self.y0, self.x1 - self.x0
        new_base[sy : sy + eh, sx : sx + ew] = self.base
        new_hover[sy : sy + eh, sx : sx + ew] = self.hover
        if self.with_nested and self.nested is not None:
            new_nested[sy : sy + eh, sx : sx + ew] = self.nested
            new_nested_hover[sy : sy + eh, sx : sx + ew] = self.nested_hover

        self.x0, self.y0, self.x1, self.y1 = nx0, ny0, nx1, ny1
        self.base = new_base
        self.hover = new_hover
        self.nested = new_nested
        self.nested_hover = new_nested_hover

    def paint_flat(
        self,
        mask: np.ndarray,
        base_rgb: OwnerColor,
        hover_rgb: OwnerColor,
        *,
        nested: bool = False,
        origin: tuple[int, int] = (0, 0),
    ) -> None:
        """Paint `mask`, whose top-left pixel sits at map `origin` (x, y)."""
        ys, xs = np.where(mask)
        if ys.size == 0:
            return
        xs = xs + origin[0]
        ys = ys + origin[1]

        self._expand(int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        ly = ys - self.y0
        lx = xs - self.x0

        base_rgba = np.array((*base_rgb, 255), dtype=np.uint8)
        hover_rgba = np.array((*hover_rgb, 255), dtype=np.uint8)
        self.base[ly, lx] = base_rgba
        self.hover[ly, lx] = hover_rgba
        if nested and self.with_nested and self.nested is not None:
            self.nested[ly, lx] = base_rgba
            self.nested_hover[ly, lx] = hover_rgba

    def to_image(self, layer: str) -> Image.Image:
        arr = getattr(self, layer)
        if arr is None:
            raise ValueError(f"Layer {layer} not available")
        return Image.fromarray(np.array(arr, dtype=np.uint8, copy=True), mode="RGBA")


def _stage_on_full_canvas(
    buf: RegionBuffer,
    height: int,
    width: int,
    layer: str,
) -> np.ndarray:
    full = np.zeros((height, width, 4), dtype=np.uint8)
    arr = getattr(buf, layer)
    full[buf.y0 : buf.y1, buf.x0 : buf.x1] = arr
    return full


def _finalize_layer_from_full(
    full: np.ndarray,
) -> tuple[np.ndarray, dict[str, int] | None]:
    cropped, meta = crop_to_content(Image.fromarray(full, mode="RGBA"))
    return np.array(cropped, dtype=np.uint8), meta


def _save_layer_array(arr: np.ndarray, path: str) -> None:
    Image.fromarray(np.array(arr, dtype=np.uint8, copy=True), mode="RGBA").save(path, "PNG")


def _stage_on_window(
    buf: RegionBuffer,
    box: tuple[int, int, int, int],
    margin: int,
    height: int,
    width: int,
    layer: str,
) -> tuple[np.ndarray, tuple[int, int]]:
    """The layer on its box grown by `margin`, clipped to the map, and the
    window's map origin.

    Stands in for the full map canvas: everything outside the box is
    transparent, so with room for the stroke and the crop padding the window
    gives the same pixels for a fraction of the work.
    """
    x0, y0, x1, y1 = box
    wx0, wy0 = max(0, x0 - margin), max(0, y0 - margin)
    wx1, wy1 = min(width, x1 + margin), min(height, y1 + margin)
    window = np.zeros((wy1 - wy0, wx1 - wx0, 4), dtype=np.uint8)
    window[y0 - wy0 : y1 - wy0, x0 - wx0 : x1 - wx0] = getattr(buf, layer)
    return window, (wx0, wy0)


def _finalize_buffer_layer(
    buf: RegionBuffer,
    layer: str,
    full: np.ndarray,
    *,
    store_overlay_meta: bool = False,
    store_nested_overlay_meta: bool = False,
    origin: tuple[int, int] = (0, 0),
) -> None:
    """Crop `full` (a canvas whose top-left sits at map `origin`) to content."""
    cropped, meta = _finalize_layer_from_full(full)
    if meta is not None:
        meta = {**meta, "x": meta["x"] + origin[0], "y": meta["y"] + origin[1]}
    setattr(buf, layer, cropped)
    if store_overlay_meta and meta is not None:
        buf.overlay_meta = meta
    if store_nested_overlay_meta and meta is not None:
        buf.overlay_nested_meta = meta
    buf._initialized = True
    buf.x0 = buf.y0 = 0
    buf.x1 = cropped.shape[1]
    buf.y1 = cropped.shape[0]


# crop_to_content's default padding. A region's window leaves room for it
# beyond the stroke, so the crop matches the one taken from the full map.
_CROP_PAD = 2


def generate_regions_numpy(
    map_name: str,
    mode: str,
    borders: bool,
    cache: MapGeometryCache,
    queued_regen: bool = False,
    border_thickness: int = default_border_thickness,
    border_color: tuple[int, int, int, int] = (0, 0, 0, 255),
) -> None:
    del border_color
    start_time = time.perf_counter()
    validate_map(map_name)

    width, height = cache.width, cache.height
    province_to_color = build_color_mapping(map_name, mode)
    if not province_to_color:
        print(f"No mapping for mode '{mode}', skipping.")
        return

    overrides = get_color_overrides(map_name, mode)
    has_nesting = bool(overrides)
    overlord_chains = _build_overlord_chains(overrides)
    overlord_colors = set(overrides.values())
    trade_mixed = getattr(build_color_mapping, "trade_mixed", None)
    occupation_provinces = getattr(build_color_mapping, "occupation_provinces", None) or set()

    img_path = input_file(map_name, "provinces.png")
    output_dir = os.path.abspath(
        os.path.join(
            os.path.dirname(img_path),
            "..",
            "..",
            "output",
            map_name,
            "regions",
            mode,
        )
    )
    os.makedirs(output_dir, exist_ok=True)

    queued = None
    if queued_regen:
        compile_queue(map_name)
        queued = set(load_queue(map_name, mode))
        for fn in os.listdir(output_dir):
            base = (
                fn.replace("_hover", "")
                .replace("_nested", "")
                .replace(".png", "")
            )
            if base in queued:
                os.remove(os.path.join(output_dir, fn))
    else:
        for fn in os.listdir(output_dir):
            os.remove(os.path.join(output_dir, fn))

    regions: dict[OwnerColor, RegionBuffer] = {}

    def ensure_region(color: OwnerColor) -> RegionBuffer:
        if color not in regions:
            regions[color] = RegionBuffer(with_nested=color in overlord_colors)
        return regions[color]

    province_count = len(province_to_color)
    current = 0
    for prov_rgb, owner in province_to_color.items():
        name = _sanitize_filename(owner)
        if queued and name not in queued:
            continue

        pid = cache.rgb_to_id.get(prov_rgb)
        if pid is None:
            continue

        box = cache.province_box(pid)
        if box is None:
            continue
        px0, py0, px1, py1 = box
        mask = cache.province_id_map[py0:py1, px0:px1] == pid

        current += 1
        log_progress(
            f"Building regions: {current}/{province_count} "
            f"({current / max(province_count, 1) * 100:5.1f}%) → {name}"
        )

        if occupation_provinces and prov_rgb in occupation_provinces:
            base = occupation_display_rgb(owner)
        else:
            paint_rgb = trade_mixed.get(prov_rgb, owner) if trade_mixed else owner
            base = display_rgb(paint_rgb)
        hover = hover_rgb(owner)

        ensure_region(owner).paint_flat(
            mask,
            base,
            hover,
            nested=owner in overlord_colors,
            origin=(px0, py0),
        )

        for anc in overlord_chains.get(owner, []):
            ensure_region(anc).paint_flat(
                mask, display_rgb(anc), hover_rgb(anc), origin=(px0, py0)
            )

    print()

    if regions:
        total_regions = len(regions)
        kind = "nested" if has_nesting else "fast"
        margin = (border_thickness if borders else 0) + _CROP_PAD + 1
        for i, (color, buf) in enumerate(regions.items(), start=1):
            if borders:
                log_progress(
                    f"Painting borders ({kind}): {i}/{total_regions} "
                    f"({i / max(total_regions, 1) * 100:5.1f}%)"
                )
            display_color = display_rgb(color)
            base_stroke = border_color_for_fill(display_color)
            hover_stroke = border_color_for_fill(hover_rgb(color))
            box = (buf.x0, buf.y0, buf.x1, buf.y1)
            layers = [("base", "hover", "overlay")]
            if buf.with_nested and buf.nested is not None and buf.nested_hover is not None:
                layers.append(("nested", "nested_hover", "nested_overlay"))

            for fill_layer, hover_layer, meta_kind in layers:
                fill, origin = _stage_on_window(buf, box, margin, height, width, fill_layer)
                hover, _ = _stage_on_window(buf, box, margin, height, width, hover_layer)
                if borders:
                    stroke_opaque_union_array(fill, base_stroke, border_thickness)
                    stroke_opaque_union_array(hover, hover_stroke, border_thickness)
                    if occupation_provinces:
                        apply_occupation_seam_dashes_array(
                            fill,
                            [fill, hover],
                            display_color,
                            occupation_display_rgb(color),
                        )
                _finalize_buffer_layer(
                    buf,
                    fill_layer,
                    fill,
                    store_overlay_meta=meta_kind == "overlay",
                    store_nested_overlay_meta=meta_kind == "nested_overlay",
                    origin=origin,
                )
                _finalize_buffer_layer(buf, hover_layer, hover, origin=origin)

    print()

    metadata_by_rgb: dict[str, dict] = {}
    total_outputs = len(regions)
    for i, (color, buf) in enumerate(regions.items(), start=1):
        name = _sanitize_filename(color)
        if queued and name not in queued:
            continue

        log_progress(
            f"Saving images: {i}/{total_outputs} "
            f"({i / total_outputs * 100:5.1f}%) → {name}"
        )

        if buf.base is None or buf.hover is None:
            continue

        _save_layer_array(buf.base, os.path.join(output_dir, f"{name}.png"))
        _save_layer_array(buf.hover, os.path.join(output_dir, f"{name}_hover.png"))

        region_meta: dict = {}
        if buf.overlay_meta:
            region_meta["overlay"] = buf.overlay_meta

        if buf.with_nested and buf.nested is not None and buf.nested_hover is not None:
            _save_layer_array(buf.nested, os.path.join(output_dir, f"{name}_nested.png"))
            _save_layer_array(
                buf.nested_hover,
                os.path.join(output_dir, f"{name}_nested_hover.png"),
            )
            if buf.overlay_nested_meta:
                region_meta["overlay_nested"] = buf.overlay_nested_meta

        if region_meta:
            metadata_by_rgb[rgb_tuple_to_str(color)] = region_meta

    print()

    write_overlay_metadata(map_name, mode, metadata_by_rgb, merge=queued_regen)

    if queued_regen:
        clear_mode(map_name, mode)

    elapsed = time.perf_counter() - start_time
    print(
        f"Region generation for mode '{mode}' "
        f"took {elapsed:.2f} seconds "
        f"(nesting={'yes' if has_nesting else 'no'}, numpy)"
    )
