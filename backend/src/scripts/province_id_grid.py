"""Province ID grid: build from provinces.png, serialize for SimpleFactions Input."""

from __future__ import annotations

import gzip
import os
import struct

import numpy as np

from .loader.provinces import load_provinces
from .mapgen.map_paint_numpy import _pack_key, load_provinces_array, pack_rgb
from .util.atomic import _write_atomic
from .util.dirs import defines_file, input_file, validate_map

GRID_FILENAME = "province_id_grid.bin.gz"
HEADER_SIZE = 8  # width + height as int32 LE

# A decimated grid keeps the same byte layout and gains a _q{scale} suffix, so
# scale=1 stays byte-identical to the artifact every existing caller already
# reads.
GRID_SCALED_FILENAME = "province_id_grid_q{scale}.bin.gz"

# Majority decimation is done in horizontal bands so peak memory stays bounded
# regardless of scale; 6400x6400 at scale 4 would otherwise materialise several
# 41M-element index arrays at once.
_DECIMATE_CHUNK_ELEMENTS = 4_000_000

# Province id 0 is ocean/background, not a province. It must not be allowed to
# win the block vote, so ocean pixels are voted with sentinel values above the
# uint16 id space (hence the int32 working dtype) - one distinct sentinel per
# column, so no two ocean pixels ever form a run longer than 1 and any real
# province present in the block outvotes or out-tie-breaks them all.
_OCEAN_VOTE_BASE = 1 << 16


def province_id_grid_filename(scale: int = 1) -> str:
    """Artifact filename for a given decimation factor."""
    if scale == 1:
        return GRID_FILENAME
    return GRID_SCALED_FILENAME.format(scale=scale)


def build_province_id_map(map_name: str) -> tuple[int, int, np.ndarray]:
    """
    Build uint16 province id grid from provinces.png + provinces.txt.

    Returns (width, height, ids) where ids.shape == (height, width).
    Pixel value 0 = no province (black or unknown RGB).
    """
    validate_map(map_name)

    provinces_path = input_file(map_name, "provinces.png")
    provinces_rgba = load_provinces_array(provinces_path)
    height, width = provinces_rgba.shape[:2]

    rgb_to_id = load_provinces(map_name)
    packed_rgb = pack_rgb(provinces_rgba[:, :, :3])

    id_lut = np.zeros(1 << 24, dtype=np.uint16)
    for rgb, province_id in rgb_to_id.items():
        id_lut[_pack_key(rgb)] = province_id
    province_id_map = id_lut[packed_rgb]

    return width, height, province_id_map


def _block_majority(blocks: np.ndarray) -> np.ndarray:
    """Modal value of each row of `blocks` (n, k), ties broken toward the lower id.

    Sorting each block groups equal ids into runs, so the mode is just the value
    inside the longest run. Everything is vectorised over all n blocks at once;
    a Python loop over 41M source pixels is not an option.
    """
    n, k = blocks.shape
    ordered = np.sort(blocks, axis=1)

    is_start = np.empty((n, k), dtype=bool)
    is_start[:, 0] = True
    np.not_equal(ordered[:, 1:], ordered[:, :-1], out=is_start[:, 1:])

    is_end = np.empty((n, k), dtype=bool)
    is_end[:, -1] = True
    is_end[:, :-1] = is_start[:, 1:]

    idx = np.arange(k, dtype=np.int32)
    # Running max of "index where a run starts" gives, per column, the start of
    # the run that column belongs to; the mirrored running min gives its end.
    start = np.maximum.accumulate(np.where(is_start, idx, np.int32(0)), axis=1)
    end = np.minimum.accumulate(
        np.where(is_end, idx, np.int32(k))[:, ::-1], axis=1
    )[:, ::-1]

    # argmax returns the first maximum, i.e. the lowest id among tied runs, so
    # the result is deterministic and independent of pixel order.
    pick = np.argmax(end - start, axis=1)
    return ordered[np.arange(n), pick]


def _block_majority_land(blocks: np.ndarray) -> np.ndarray:
    """_block_majority, but ocean (id 0) only wins a block that is entirely ocean.

    Ocean participating as an ordinary value is wrong twice over: it can outvote
    the land it surrounds, and because ties resolve toward the lower id, 0 wins
    *every* tie. At scale 4 that meant a block split 8 ocean / 8 land collapsed
    to ocean (coastlines erode inward), and a 3x3 island or a 1px-wide strait
    province disappeared from the decimated grid with nothing reporting it.

    Rather than reimplement the (brute-force-verified) vote, each ocean pixel is
    replaced by a sentinel unique to its column. Sentinels sort above every real
    id, so _block_majority's "longest run, ties to the lowest value" rule keeps
    holding, while each sentinel run is exactly one pixel long - a block with any
    land in it therefore always resolves to land, and an all-ocean block resolves
    to a sentinel that is mapped back to 0.
    """
    n, k = blocks.shape
    sentinels = (_OCEAN_VOTE_BASE + np.arange(k, dtype=np.int32)).reshape(1, k)
    votes = np.where(blocks > 0, blocks.astype(np.int32, copy=False), sentinels)
    picked = _block_majority(votes)
    return np.where(picked >= _OCEAN_VOTE_BASE, 0, picked).astype(np.uint16, copy=False)


def lost_province_ids(before: np.ndarray, after: np.ndarray) -> list[int]:
    """Province ids present in `before` but wiped out entirely by decimation.

    Ocean exclusion makes this rare, but a province thinner than the block size
    can still lose every one of its blocks to a larger neighbour. Callers report
    it instead of letting the province silently vanish from the timelapse.
    """
    kept = set(np.unique(after).tolist())
    return sorted(int(v) for v in np.unique(before).tolist() if v and v not in kept)


def decimate_province_id_map(
    width: int, height: int, ids: np.ndarray, scale: int
) -> tuple[int, int, np.ndarray]:
    """
    Shrink a province id grid by an integer factor for cheap timelapse repaints.

    Each scale x scale source block collapses to the province id that covers the
    most of it. Province ids are categorical, so anything that averages or
    interpolates would invent ids that name no province; majority is picked over
    plain nearest-neighbour sampling because at scale 4 a single sampled pixel
    lets a one-pixel coastal sliver decide a 16-pixel block, which makes narrow
    provinces flicker in and out along their borders.

    Ocean (id 0) is excluded from the vote unless the block contains no land at
    all - see _block_majority_land for why letting it vote deletes islands.

    `scale` must divide both dimensions exactly - a partial trailing block would
    silently crop the map edge, and callers are better off told than shrunk.
    """
    if scale < 1:
        raise ValueError(f"scale must be a positive integer, got {scale}")
    if ids.shape != (height, width):
        raise ValueError(
            f"ids shape {ids.shape} does not match height={height}, width={width}"
        )
    if scale == 1:
        return width, height, ids
    if width % scale or height % scale:
        raise ValueError(
            f"scale {scale} does not divide source dimensions {width}x{height} evenly"
        )

    out_width = width // scale
    out_height = height // scale
    source = np.ascontiguousarray(ids, dtype=np.uint16)
    out = np.empty((out_height, out_width), dtype=np.uint16)

    block_pixels = scale * scale
    rows_per_chunk = max(1, _DECIMATE_CHUNK_ELEMENTS // (out_width * block_pixels))
    for y0 in range(0, out_height, rows_per_chunk):
        y1 = min(y0 + rows_per_chunk, out_height)
        band = source[y0 * scale : y1 * scale].reshape(
            y1 - y0, scale, out_width, scale
        )
        blocks = band.transpose(0, 2, 1, 3).reshape(-1, block_pixels)
        out[y0:y1] = _block_majority_land(blocks).reshape(y1 - y0, out_width)

    return out_width, out_height, out


def serialize_province_id_grid(width: int, height: int, ids: np.ndarray) -> bytes:
    """Pack grid to bytes: header + row-major uint16 body."""
    if ids.shape != (height, width):
        raise ValueError(
            f"ids shape {ids.shape} does not match height={height}, width={width}"
        )
    header = struct.pack("<ii", width, height)
    body = ids.astype("<u2", copy=False).tobytes()
    return header + body


def deserialize_province_id_grid(data: bytes) -> tuple[int, int, np.ndarray]:
    """Unpack bytes written by serialize_province_id_grid."""
    if len(data) < HEADER_SIZE:
        raise ValueError("province id grid data too short for header")

    width, height = struct.unpack("<ii", data[:HEADER_SIZE])
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid grid dimensions: {width}x{height}")

    expected_body = width * height * 2
    body = data[HEADER_SIZE:]
    if len(body) != expected_body:
        raise ValueError(
            f"body length {len(body)} != expected {expected_body} for {width}x{height}"
        )

    ids = np.frombuffer(body, dtype="<u2").reshape(height, width)
    return width, height, ids.copy()


def write_province_id_grid_file(
    map_name: str,
    dest: str | None = None,
    source: tuple[int, int, np.ndarray] | None = None,
    scale: int = 1,
) -> str:
    """Write defines/{map}/province_id_grid.bin.gz unless dest is set.

    Pass `source` to reuse an already-decoded province id map; decoding
    provinces.png costs a 6400x6400 decode plus a 32MB LUT pass, and the grid
    and runs artifacts are built from exactly the same array.

    `scale` > 1 decimates the grid and writes the _q{scale} variant instead.
    """
    width, height, ids = source or build_province_id_map(map_name)
    width, height, ids = decimate_province_id_map(width, height, ids, scale)
    out_path = dest or defines_file(map_name, province_id_grid_filename(scale))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    payload = serialize_province_id_grid(width, height, ids)
    # Publish the compressed grid atomically so requests and geometry hashes
    # always read a complete file during regeneration.
    _write_atomic(out_path, gzip.compress(payload), prefix=".province-id-grid-")

    return out_path


def read_province_id_grid_file(path: str) -> tuple[int, int, np.ndarray]:
    """Read a gzip province id grid file."""
    with gzip.open(path, "rb") as f:
        data = f.read()
    return deserialize_province_id_grid(data)


def lookup_at(ids: np.ndarray, width: int, x: int, z: int) -> int:
    """Bounds-safe lookup; (x, z) is Minecraft block coords (z = image row)."""
    if x < 0 or z < 0 or x >= width or z >= ids.shape[0]:
        return 0
    return int(ids[z, x])


# ---------------------------------------------------------------------------
# Run-length province index (province_id_runs.bin.gz)
# ---------------------------------------------------------------------------
#
# A second, additive artifact next to province_id_grid.bin.gz. It carries the
# exact same information (every pixel province id) but stores it row-major
# run-length encoded, so the browser never has to materialise a 40.96M-entry
# flat grid just to know which pixels belong to which province.
#
# The file is gzip. The *decompressed* payload layout is, all little-endian:
#
#   Header (32 bytes)
#     off  0  char[4]  magic          = b"PRUV"
#     off  4  uint32   version        = 1
#     off  8  int32    width
#     off 12  int32    height
#     off 16  uint32   run_count
#     off 20  uint32   province_count  (rows in the bbox table)
#     off 24  uint32   reserved0      = 0
#     off 28  uint32   reserved1      = 0
#
#   Section A - runs, in row-major scan order, stored as two contiguous
#   planes rather than interleaved (planar gzips ~27% smaller because the
#   high bytes of the lengths are almost all zero):
#     A1  uint32[run_count]  length        pixel count of the run, always >= 1
#     A2  uint16[run_count]  province_id   0 means "no province"
#   A2 starts at byte offset 32 + 4 * run_count. Section A is
#   6 * run_count bytes total.
#
#   A run never crosses a row boundary, so the starting pixel offset of run k
#   is sum(length[0..k-1]) and its row is that offset // width. The decoder
#   reconstructs starts with a prefix sum. sum(all lengths) == width * height
#   exactly, which is also the integrity check the frontend decoder runs.
#
#   Section B - per-province bbox table: province_count entries of 20 bytes,
#   sorted ascending by province id, containing only ids > 0 that actually
#   occur in the grid:
#     +0   uint32  province_id
#     +4   uint32  min_x
#     +8   uint32  min_y
#     +12  uint32  max_x   (inclusive)
#     +16  uint32  max_y   (inclusive)
#
#   Total payload size == 32 + 6 * run_count + 20 * province_count.
#
# The runs artifact is written alongside the grid; neither replaces the other.

RUNS_FILENAME = "province_id_runs.bin.gz"
RUNS_MAGIC = b"PRUV"
RUNS_VERSION = 1
RUNS_HEADER_SIZE = 32
RUNS_ENTRY_SIZE = 6
RUNS_BBOX_ENTRY_SIZE = 20
_RUNS_HEADER_STRUCT = "<4sIiiIIII"


def build_province_id_runs(
    width: int, height: int, ids: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Row-major run-length encode a province id grid.

    Returns (lengths uint32[n], run_ids uint16[n], bbox uint32[m, 5]) where the
    bbox rows are (province_id, min_x, min_y, max_x, max_y) sorted by id and
    cover only ids > 0 that occur in the grid. Runs never cross a row boundary.
    """
    if ids.shape != (height, width):
        raise ValueError(
            f"ids shape {ids.shape} does not match height={height}, width={width}"
        )
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid grid dimensions: {width}x{height}")

    flat = np.ascontiguousarray(ids, dtype=np.uint16).reshape(-1)
    total = int(flat.size)

    boundary = np.zeros(total, dtype=bool)
    boundary[::width] = True  # every row starts a new run
    np.logical_or(boundary[1:], flat[1:] != flat[:-1], out=boundary[1:])

    starts = np.flatnonzero(boundary).astype(np.int64, copy=False)
    lengths = np.diff(np.append(starts, np.int64(total)))
    run_ids = flat[starts]

    bbox = _province_bboxes(width, starts, lengths, run_ids)
    return lengths.astype(np.uint32, copy=False), run_ids, bbox


def _province_bboxes(
    width: int, starts: np.ndarray, lengths: np.ndarray, run_ids: np.ndarray
) -> np.ndarray:
    """Per-province inclusive bounding boxes derived from the run table."""
    mask = run_ids > 0
    if not mask.any():
        return np.zeros((0, 5), dtype=np.uint32)

    rid = run_ids[mask].astype(np.int64, copy=False)
    run_start = starts[mask]
    run_len = lengths[mask]

    y = run_start // width
    x0 = run_start - y * width
    x1 = x0 + run_len - 1

    slots = int(rid.max()) + 1
    big = np.iinfo(np.int64).max
    min_x = np.full(slots, big, dtype=np.int64)
    min_y = np.full(slots, big, dtype=np.int64)
    max_x = np.full(slots, -1, dtype=np.int64)
    max_y = np.full(slots, -1, dtype=np.int64)

    np.minimum.at(min_x, rid, x0)
    np.minimum.at(min_y, rid, y)
    np.maximum.at(max_x, rid, x1)
    np.maximum.at(max_y, rid, y)

    present = np.flatnonzero(max_y >= 0)
    table = np.empty((present.size, 5), dtype=np.uint32)
    table[:, 0] = present
    table[:, 1] = min_x[present]
    table[:, 2] = min_y[present]
    table[:, 3] = max_x[present]
    table[:, 4] = max_y[present]
    return table


def serialize_province_id_runs(width: int, height: int, ids: np.ndarray) -> bytes:
    """Pack a province id grid into the province_id_runs payload (layout above)."""
    lengths, run_ids, bbox = build_province_id_runs(width, height, ids)

    header = struct.pack(
        _RUNS_HEADER_STRUCT,
        RUNS_MAGIC,
        RUNS_VERSION,
        width,
        height,
        int(lengths.size),
        int(bbox.shape[0]),
        0,
        0,
    )

    return (
        header
        + lengths.astype("<u4", copy=False).tobytes()
        + run_ids.astype("<u2", copy=False).tobytes()
        + bbox.astype("<u4", copy=False).tobytes()
    )


def deserialize_province_id_runs(
    data: bytes,
) -> tuple[int, int, np.ndarray, np.ndarray, np.ndarray]:
    """
    Unpack bytes written by serialize_province_id_runs.

    Returns (width, height, lengths uint32[n], run_ids uint16[n], bbox uint32[m, 5]).
    """
    if len(data) < RUNS_HEADER_SIZE:
        raise ValueError("province id runs data too short for header")

    magic, version, width, height, run_count, province_count, _r0, _r1 = struct.unpack(
        _RUNS_HEADER_STRUCT, data[:RUNS_HEADER_SIZE]
    )
    if magic != RUNS_MAGIC:
        raise ValueError(f"bad province id runs magic: {magic!r}")
    if version != RUNS_VERSION:
        raise ValueError(f"unsupported province id runs version: {version}")
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid grid dimensions: {width}x{height}")

    runs_end = RUNS_HEADER_SIZE + run_count * RUNS_ENTRY_SIZE
    expected = runs_end + province_count * RUNS_BBOX_ENTRY_SIZE
    if len(data) != expected:
        raise ValueError(
            f"province id runs length {len(data)} != expected {expected} "
            f"for run_count={run_count} province_count={province_count}"
        )

    ids_start = RUNS_HEADER_SIZE + run_count * 4
    lengths = np.frombuffer(data[RUNS_HEADER_SIZE:ids_start], dtype="<u4")
    run_ids = np.frombuffer(data[ids_start:runs_end], dtype="<u2")

    total = int(lengths.astype(np.int64).sum())
    if total != width * height:
        raise ValueError(
            f"province id runs cover {total} pixels, expected {width * height}"
        )

    bbox = (
        np.frombuffer(data[runs_end:expected], dtype="<u4")
        .reshape(province_count, 5)
        .astype(np.uint32)
    )
    return width, height, lengths.copy(), run_ids.copy(), bbox


def runs_to_province_id_grid(
    width: int, height: int, lengths: np.ndarray, run_ids: np.ndarray
) -> np.ndarray:
    """Expand a run table back into the (height, width) uint16 grid."""
    flat = np.repeat(run_ids.astype(np.uint16, copy=False), lengths.astype(np.int64))
    if flat.size != width * height:
        raise ValueError(f"runs expand to {flat.size} pixels, expected {width * height}")
    return flat.reshape(height, width)


def write_province_id_runs_file(
    map_name: str,
    dest: str | None = None,
    source: tuple[int, int, np.ndarray] | None = None,
) -> str:
    """Write defines/{map}/province_id_runs.bin.gz unless dest is set.

    See write_province_id_grid_file for `source`.
    """
    width, height, ids = source or build_province_id_map(map_name)
    out_path = dest or defines_file(map_name, RUNS_FILENAME)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    payload = serialize_province_id_runs(width, height, ids)
    _write_atomic(out_path, gzip.compress(payload), prefix=".province-id-runs-")

    return out_path


def read_province_id_runs_file(
    path: str,
) -> tuple[int, int, np.ndarray, np.ndarray, np.ndarray]:
    """Read a gzip province id runs file."""
    with gzip.open(path, "rb") as f:
        data = f.read()
    return deserialize_province_id_runs(data)
