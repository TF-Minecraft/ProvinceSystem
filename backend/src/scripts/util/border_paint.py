import numpy as np

# Now, after all provinces are painted, paint the borders
border_color = (0, 0, 0, 255)  # Solid black for kingdom borders (legacy paint_borders)
duchy_border_color = (255, 255, 255, 255)  # White for duchy borders
border_thickness = 5  # Adjustable thickness

# Step 39.04 adaptive ink borders
INK_DARK = (42, 31, 20, 255)
INK_LIGHT = (232, 220, 200, 255)
LUMINANCE_THRESHOLD = 0.55
# Sentinel owner for overlay-alpha union (home wash + occupation grey).
OPAQUE_UNION_OWNER = (1, 0, 0)

OCCUPATION_DASH_COLOR = (150, 72, 66, 210)
OCCUPATION_DASH_ON = 1
OCCUPATION_DASH_OFF = 0
OCCUPATION_DASH_THICKNESS = 1

_NEIGHBOR4 = ((-1, 0), (1, 0), (0, -1), (0, 1))


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0


def border_color_for_fill(
    fill_rgb: tuple[int, int, int],
    threshold: float = LUMINANCE_THRESHOLD,
) -> tuple[int, int, int, int]:
    """Uniform ink-dark stroke for washed fills.

    Per-fill adaptation (cream on dark, dark on light) clashes at shared
    nation edges after parchment_wash_rgb normalises fills to a mid band.
    """
    del fill_rgb, threshold
    return INK_DARK

def compute_border_owners(img_data, width, height, include_outer=True):
    """
    include_outer=True: count borders against transparent pixels as borders too.
    """
    borders = {}

    for y in range(height):
        for x in range(width):
            c = img_data[x, y]
            if c[3] == 0:
                continue
            c_rgb = c[:3]

            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= nx < width and 0 <= ny < height):
                    # edge of image counts as outer border
                    if include_outer:
                        borders.setdefault((x, y), set()).add(c_rgb)
                    continue

                n = img_data[nx, ny]
                if n[3] == 0:
                    if include_outer:
                        borders.setdefault((x, y), set()).add(c_rgb)
                    continue

                n_rgb = n[:3]
                if n_rgb != c_rgb:
                    borders.setdefault((x, y), set()).update((c_rgb, n_rgb))
                    borders.setdefault((nx, ny), set()).update((c_rgb, n_rgb))
    return borders


def compute_opaque_union_borders(img_data, width, height):
    """Outline the union of opaque pixels, ignoring RGB differences.

    Home wash and occupation grey on one overlay share one outer stroke.
    """
    borders = {}

    for y in range(height):
        for x in range(width):
            c = img_data[x, y]
            if c[3] == 0:
                continue

            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= nx < width and 0 <= ny < height):
                    borders.setdefault((x, y), set()).add(OPAQUE_UNION_OWNER)
                    continue

                n = img_data[nx, ny]
                if n[3] == 0:
                    borders.setdefault((x, y), set()).add(OPAQUE_UNION_OWNER)

    return borders


def apply_opaque_union_borders(img_data, width, height, color, thickness):
    owners = compute_opaque_union_borders(img_data, width, height)
    apply_region_borders(
        img_data, OPAQUE_UNION_OWNER, owners, width, height, color, thickness
    )


def apply_region_borders(
    img_data,
    region_color,
    border_owners,
    width,
    height,
    color=(0, 0, 0, 255),
    thickness=2,
    soften: bool = False,
):
    """
    Paints borders for a given region_color.
    Because compute_border_owners stores border points on both sides,
    the dilation extends outward as well as inward.
    """
    t = thickness
    for (x, y), owners in border_owners.items():
        if region_color not in owners:
            continue

        for dy in range(-t, t + 1):
            ny = y + dy
            if 0 <= ny < height:
                for dx in range(-t, t + 1):
                    nx = x + dx
                    if 0 <= nx < width:
                        img_data[nx, ny] = color


def _pixel_rgb(pixel) -> tuple[int, int, int]:
    return (int(pixel[0]), int(pixel[1]), int(pixel[2]))


def compute_occupation_seam_pixels(
    img_data,
    width,
    height,
    home_rgb: tuple[int, int, int],
    occ_rgb: tuple[int, int, int],
) -> set[tuple[int, int]]:
    """Occupation-side pixels that 4-neighbour home wash."""
    if home_rgb == occ_rgb:
        return set()

    seam = set()
    for y in range(height):
        for x in range(width):
            c = img_data[x, y]
            if c[3] == 0 or _pixel_rgb(c) != occ_rgb:
                continue
            for dx, dy in _NEIGHBOR4:
                nx, ny = x + dx, y + dy
                if not (0 <= nx < width and 0 <= ny < height):
                    continue
                n = img_data[nx, ny]
                if n[3] == 0:
                    continue
                if _pixel_rgb(n) == home_rgb:
                    seam.add((x, y))
                    break
    return seam


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


def apply_occupation_seam_dashes(
    source_img,
    targets,
    width,
    height,
    home_rgb: tuple[int, int, int],
    occ_rgb: tuple[int, int, int],
    color=OCCUPATION_DASH_COLOR,
    thickness=OCCUPATION_DASH_THICKNESS,
    dash_on=OCCUPATION_DASH_ON,
    dash_off=OCCUPATION_DASH_OFF,
) -> None:
    """Detect home/occupation seam on source and stamp dashes onto targets."""
    seam = compute_occupation_seam_pixels(
        source_img, width, height, home_rgb, occ_rgb
    )
    if not seam:
        return
    polylines = occupation_seam_polylines(seam)
    for target in targets:
        stamp_dashed_polylines(
            target,
            width,
            height,
            polylines,
            color=color,
            thickness=thickness,
            dash_on=dash_on,
            dash_off=dash_off,
        )


# ------------------------------------------------------------
# Array versions
# ------------------------------------------------------------
# The functions above visit every pixel in Python, which over a 6400 px map
# costs seconds per image. These do the same on (H, W, 4) uint8 arrays with
# whole-array operations, and produce identical pixels.


def _any_neighbour4(mask: np.ndarray, outside: bool = False) -> np.ndarray:
    """Pixels with at least one 4-neighbour set; off the array counts as `outside`."""
    padded = np.pad(mask, 1, constant_values=outside)
    return padded[:-2, 1:-1] | padded[2:, 1:-1] | padded[1:-1, :-2] | padded[1:-1, 2:]


def dilate_square(mask: np.ndarray, radius: int) -> np.ndarray:
    """Grow `mask` by a (2r+1) square, clipped to the array, as the per-pixel
    stamp in `apply_region_borders` does."""
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
    """`apply_opaque_union_borders` on an array: outline the opaque pixels.

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
    """`compute_occupation_seam_pixels` as a mask over an array."""
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
    """`apply_occupation_seam_dashes` on arrays."""
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


def paint_borders(outline, between, new_img_data, height, width):
    borders = set()
    # Iterate through all pixels and check for borders
    if outline:
        for y in range(height):
            for x in range(width):
                pixel_color = new_img_data[x, y]
                if pixel_color[3] != 0:  # Only check non-transparent pixels
                    # Check neighboring pixels
                    neighbors = [
                        (x - 1, y),  # Left
                        (x + 1, y),  # Right
                        (x, y - 1),  # Up
                        (x, y + 1),  # Down
                    ]
                    for nx, ny in neighbors:
                        if 0 <= nx < width and 0 <= ny < height:
                            neighbor_color = new_img_data[nx, ny]
                            if pixel_color != neighbor_color:  # Different color means border
                                if not between and neighbor_color[3] != 0:
                                    continue  # Skip if we are only drawing kingdom borders
                                else:
                                    for dx in range(-border_thickness, border_thickness + 1):
                                        for dy in range(-border_thickness, border_thickness + 1):
                                            bx, by = x + dx, y + dy
                                            if 0 <= bx < width and 0 <= by < height:
                                                borders.add((bx, by))

    # Apply the border color to all detected border pixels
    for x, y in borders:
        new_img_data[x, y] = border_color
    return new_img_data