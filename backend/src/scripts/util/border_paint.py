import numpy as np

border_thickness = 5  # Adjustable thickness

INK_DARK = (42, 31, 20, 255)

OCCUPATION_DASH_COLOR = (150, 72, 66, 210)
OCCUPATION_DASH_ON = 1
OCCUPATION_DASH_OFF = 0
OCCUPATION_DASH_THICKNESS = 1

_NEIGHBOR4 = ((-1, 0), (1, 0), (0, -1), (0, 1))


def occupation_seam_polylines(
    seam: set[tuple[int, int]],
) -> list[list[tuple[int, int]]]:
    """Walk 4-connected seam pixels into polylines."""
    remaining = set(seam)
    paths: list[list[tuple[int, int]]] = []

    def neighbors_in(pixel, pool):
        x, y = pixel
        return [
            (x + dx, y + dy)
            for dx, dy in _NEIGHBOR4
            if (x + dx, y + dy) in pool
        ]

    while remaining:
        start = next(
            (p for p in remaining if len(neighbors_in(p, remaining)) <= 1),
            next(iter(remaining)),
        )
        path = [start]
        remaining.remove(start)
        while True:
            cand = neighbors_in(path[-1], remaining)
            if not cand:
                break
            nxt = cand[0]
            remaining.remove(nxt)
            path.append(nxt)
        paths.append(path)
    return paths


def _stamp_dilated(img_data, x, y, width, height, color, thickness):
    t = thickness
    for dy in range(-t, t + 1):
        ny = y + dy
        if 0 <= ny < height:
            for dx in range(-t, t + 1):
                nx = x + dx
                if 0 <= nx < width:
                    img_data[nx, ny] = color


def stamp_dashed_polylines(
    img_data,
    width,
    height,
    polylines: list[list[tuple[int, int]]],
    color=OCCUPATION_DASH_COLOR,
    thickness=OCCUPATION_DASH_THICKNESS,
    dash_on=OCCUPATION_DASH_ON,
    dash_off=OCCUPATION_DASH_OFF,
) -> None:
    period = dash_on + dash_off
    if period <= 0:
        return
    for path in polylines:
        for i, (x, y) in enumerate(path):
            if dash_off == 0 or i % period < dash_on:
                _stamp_dilated(img_data, x, y, width, height, color, thickness)


def _any_neighbour4(mask: np.ndarray, outside: bool = False) -> np.ndarray:
    """Pixels with at least one 4-neighbour set; off the array counts as `outside`."""
    padded = np.pad(mask, 1, constant_values=outside)
    return padded[:-2, 1:-1] | padded[2:, 1:-1] | padded[1:-1, :-2] | padded[1:-1, 2:]


def dilate_square(mask: np.ndarray, radius: int) -> np.ndarray:
    """Grow `mask` by a (2r+1) square, clipped to the array."""
    out = mask
    if radius <= 0:
        return out.copy()
    for axis in (0, 1):
        n = out.shape[axis]
        sums = np.cumsum(out, axis=axis, dtype=np.int32)
        sums = np.concatenate(
            [np.zeros_like(np.take(sums, [0], axis=axis)), sums], axis=axis
        )
        index = np.arange(n)
        high = np.minimum(index + radius + 1, n)
        low = np.maximum(index - radius, 0)
        out = (np.take(sums, high, axis=axis) - np.take(sums, low, axis=axis)) > 0
    return out


def stroke_opaque_union_array(
    img: np.ndarray, color: tuple[int, int, int, int], thickness: int
) -> None:
    """Outline the union of opaque pixels, ignoring RGB differences.

    The array's edge counts as transparent, as the map's edge does, so pass the
    whole map or a window that only meets the map's edge where the map ends.
    """
    opaque = img[:, :, 3] != 0
    outline = opaque & _any_neighbour4(~opaque, outside=True)
    img[dilate_square(outline, thickness)] = color


def occupation_seam_mask(
    img: np.ndarray,
    home_rgb: tuple[int, int, int],
    occ_rgb: tuple[int, int, int],
) -> np.ndarray:
    """Mask the occupation-side pixels touching the home wash."""
    if tuple(home_rgb) == tuple(occ_rgb):
        return np.zeros(img.shape[:2], dtype=bool)
    opaque = img[:, :, 3] != 0
    rgb = img[:, :, :3]
    is_occ = opaque & np.all(rgb == np.asarray(occ_rgb, dtype=img.dtype), axis=-1)
    is_home = opaque & np.all(rgb == np.asarray(home_rgb, dtype=img.dtype), axis=-1)
    return is_occ & _any_neighbour4(is_home)


class _ArrayPixels:
    """PIL-style [x, y] access over an (H, W, 4) array."""

    def __init__(self, arr: np.ndarray):
        self.arr = arr

    def __getitem__(self, xy):
        x, y = xy
        pix = self.arr[y, x]
        return (int(pix[0]), int(pix[1]), int(pix[2]), int(pix[3]))

    def __setitem__(self, xy, value):
        x, y = xy
        self.arr[y, x] = value


def apply_occupation_seam_dashes_array(
    source: np.ndarray,
    targets: list[np.ndarray],
    home_rgb: tuple[int, int, int],
    occ_rgb: tuple[int, int, int],
    color=OCCUPATION_DASH_COLOR,
    thickness=OCCUPATION_DASH_THICKNESS,
    dash_on=OCCUPATION_DASH_ON,
    dash_off=OCCUPATION_DASH_OFF,
) -> None:
    """Stamp occupation seam dashes onto each target array."""
    seam = occupation_seam_mask(source, home_rgb, occ_rgb)
    if not seam.any():
        return
    if dash_off == 0:
        # A solid line stamps every seam pixel, so the walk order is moot.
        stamp = dilate_square(seam, thickness)
        for target in targets:
            target[stamp] = color
        return
    ys, xs = np.nonzero(seam)
    polylines = occupation_seam_polylines(set(zip(xs.tolist(), ys.tolist())))
    for target in targets:
        height, width = target.shape[:2]
        stamp_dashed_polylines(
            _ArrayPixels(target),
            width,
            height,
            polylines,
            color=color,
            thickness=thickness,
            dash_on=dash_on,
            dash_off=dash_off,
        )
