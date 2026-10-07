"""The rail network as VehicleFramework saved it, for the staff Rail map.

VehicleFramework keeps one JSON file per track in
`plugins/VehicleFramework/data/tracks/<world>/`, with switches in a
`junctions/` folder beside them. Each track holds a sample about every block
(`s` is the distance along it) and one segment per pair of samples, which a
weapon or a remover can mark broken or damaged. The files are read straight
from a read-only mount of that folder, so the map shows the network as the
server last saved it.

Stops are the settlements whose provinces a track crosses, the same rule the
hand-drawn Vardera rail map used. Tracks joined by a junction share a line;
a line is named after the first and last stop along its longest track.
"""
from __future__ import annotations

import json
import math
import os
import re
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from src.scripts.loader.markers import load_raw_markers
from src.scripts.province_id_grid import RUNS_FILENAME, read_province_id_runs_file
from src.scripts.util.dirs import defines_file, input_file, validate_map

# Douglas-Peucker tolerance in blocks: well under a pixel at the map's closest zoom.
SIMPLIFY_BLOCKS = 0.35
# A file being rewritten as we read it fails to parse; it is read again this many times.
READ_ATTEMPTS = 3

_COLOUR = re.compile(r"§x(?:§[0-9a-fA-F]){6}|§[0-9a-fk-orA-FK-OR]")


@dataclass(frozen=True)
class RailConfig:
    # VehicleFramework's data/tracks folder; one subfolder per world.
    tracks_dir: str | None
    # The world the site's map shows (the server's level-name).
    world: str

    @classmethod
    def from_env(cls) -> RailConfig:
        return cls(
            tracks_dir=os.getenv("RAIL_TRACKS_DIR", "").strip() or None,
            world=os.getenv("RAIL_WORLD", "").strip() or os.getenv("COREPROTECT_MAP_WORLD", "").strip() or "TFMC_Map",
        )


class RailUnavailable(Exception):
    """The tracks could not be read: not_configured or missing."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def plain_name(name: str) -> str:
    """A settlement name without Minecraft colour codes."""
    return _COLOUR.sub("", name or "").replace("§", "").strip()


def simplify(points: np.ndarray, tolerance: float = SIMPLIFY_BLOCKS) -> list[int]:
    """Indices of the points Douglas-Peucker keeps from an (n, 2) polyline."""
    n = len(points)
    if n <= 2:
        return list(range(n))
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        first, last = stack.pop()
        if last - first < 2:
            continue
        a, b = points[first], points[last]
        inner = points[first + 1:last]
        ab = b - a
        length = math.hypot(ab[0], ab[1])
        if length == 0:
            dist = np.hypot(inner[:, 0] - a[0], inner[:, 1] - a[1])
        else:
            dist = np.abs(ab[0] * (inner[:, 1] - a[1]) - ab[1] * (inner[:, 0] - a[0])) / length
        worst = int(np.argmax(dist))
        if dist[worst] > tolerance:
            middle = first + 1 + worst
            keep[middle] = True
            stack.append((first, middle))
            stack.append((middle, last))
    return [int(i) for i in np.flatnonzero(keep)]


def _read_json(path: Path) -> dict | None:
    for _ in range(READ_ATTEMPTS):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        return data if isinstance(data, dict) else None
    return None


@dataclass
class _Track:
    id: str
    loop: bool
    xz: np.ndarray  # (n, 2) block coordinates
    s: np.ndarray  # distance along the track at each sample
    broken: np.ndarray  # per segment
    damaged: np.ndarray  # per segment, not broken

    @property
    def length(self) -> float:
        return float(self.s[-1]) if len(self.s) else 0.0

    def point_at(self, along: float) -> tuple[float, float]:
        return float(np.interp(along, self.s, self.xz[:, 0])), float(np.interp(along, self.s, self.xz[:, 1]))


def _parse_track(data: dict, world: str) -> _Track | None:
    if data.get("world") != world or not isinstance(data.get("id"), str):
        return None
    samples = data.get("samples")
    if not isinstance(samples, list) or len(samples) < 2:
        return None
    try:
        xz = np.array([[float(p["x"]), float(p["z"])] for p in samples])
        s = np.array([float(p["s"]) for p in samples])
    except (KeyError, TypeError, ValueError):
        return None
    broken = np.zeros(len(samples) - 1, dtype=bool)
    damaged = np.zeros(len(samples) - 1, dtype=bool)
    for segment in data.get("segments") or []:
        try:
            i = int(segment["fromIndex"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 0 <= i < len(broken):
            continue
        if segment.get("broken"):
            broken[i] = True
        elif float(segment.get("health", 1.0)) < 1.0:
            damaged[i] = True
    return _Track(id=data["id"], loop=bool(data.get("loop")), xz=xz, s=s, broken=broken, damaged=damaged)


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """(first, last) segment index of each run of True."""
    out: list[tuple[int, int]] = []
    start = None
    for i, on in enumerate(mask):
        if on and start is None:
            start = i
        elif not on and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(mask) - 1))
    return out


def _polyline(track: _Track, first: int, last: int) -> list[list[float]]:
    """Simplified points from sample `first` to sample `last`, inclusive."""
    part = track.xz[first:last + 1]
    return [[round(float(part[i, 0]), 2), round(float(part[i, 1]), 2)] for i in simplify(part)]


def _stretches(track: _Track, mask: np.ndarray) -> list[dict]:
    return [
        {"from": round(float(track.s[a]), 1), "to": round(float(track.s[b + 1]), 1), "points": _polyline(track, a, b + 1)}
        for a, b in _runs(mask)
    ]


class _ProvinceLookup:
    """Province ids at block positions, from the run-length index (no full grid in memory)."""

    def __init__(self, path: str):
        width, height, lengths, run_ids, _ = read_province_id_runs_file(path)
        self.width = width
        self.height = height
        self.ends = np.cumsum(lengths.astype(np.int64))
        self.ids = run_ids

    def at(self, xz: np.ndarray) -> np.ndarray:
        x = np.floor(xz[:, 0]).astype(np.int64)
        z = np.floor(xz[:, 1]).astype(np.int64)
        inside = (x >= 0) & (z >= 0) & (x < self.width) & (z < self.height)
        offset = np.where(inside, z * self.width + x, 0)
        found = self.ids[np.searchsorted(self.ends, offset, side="right")]
        return np.where(inside, found, 0)


_CACHE_LOCK = threading.Lock()
_PROVINCES: dict[str, tuple[float, _ProvinceLookup]] = {}
_NETWORK: dict[tuple, dict] = {}


def clear_cache() -> None:
    with _CACHE_LOCK:
        _PROVINCES.clear()
        _NETWORK.clear()


def _provinces(map_name: str) -> _ProvinceLookup | None:
    path = defines_file(map_name, RUNS_FILENAME)
    try:
        mtime = os.stat(path).st_mtime
    except OSError:
        return None
    with _CACHE_LOCK:
        cached = _PROVINCES.get(path)
        if cached and cached[0] == mtime:
            return cached[1]
    lookup = _ProvinceLookup(path)
    with _CACHE_LOCK:
        _PROVINCES[path] = (mtime, lookup)
    return lookup


def _stamp(path: str) -> tuple:
    try:
        st = os.stat(path)
    except OSError:
        return (path, None)
    return (path, st.st_mtime_ns, st.st_size)


def _components(tracks: dict[str, _Track], junctions: list[dict]) -> list[list[str]]:
    """Tracks joined by junctions, longest track first in each group; groups longest first."""
    parent = {track_id: track_id for track_id in tracks}

    def root(t: str) -> str:
        while parent[t] != t:
            parent[t] = parent[parent[t]]
            t = parent[t]
        return t

    for junction in junctions:
        a, b = junction["stem"], junction["branch"]
        if a in parent and b in parent:
            parent[root(a)] = root(b)
    groups: dict[str, list[str]] = {}
    for track_id in tracks:
        groups.setdefault(root(track_id), []).append(track_id)
    ordered = [sorted(ids, key=lambda t: (-tracks[t].length, t)) for ids in groups.values()]
    return sorted(ordered, key=lambda ids: (-sum(tracks[t].length for t in ids), ids[0]))


def _stops(map_name: str, tracks: dict[str, _Track]) -> list[dict]:
    lookup = _provinces(map_name)
    if lookup is None:
        return []
    settlements = load_raw_markers(map_name).get("settlements") or []
    crossed: dict[int, list[tuple[str, int]]] = {}
    for track in tracks.values():
        ids = lookup.at(track.xz)
        for i in np.flatnonzero(ids):
            crossed.setdefault(int(ids[i]), []).append((track.id, int(i)))
    stops = []
    for settlement in settlements:
        provinces = settlement.get("provinces") or [settlement.get("province_id")]
        hits = [hit for pid in provinces if isinstance(pid, int) for hit in crossed.get(pid, [])]
        if not hits:
            continue
        try:
            cx, cz = float(settlement["center_x"]), float(settlement["center_z"])
        except (KeyError, TypeError, ValueError):
            continue
        # The stop sits where the track comes closest to the settlement inside its provinces.
        track_id, i = min(hits, key=lambda h: math.hypot(tracks[h[0]].xz[h[1], 0] - cx, tracks[h[0]].xz[h[1], 1] - cz))
        track = tracks[track_id]
        stops.append({
            "name": plain_name(str(settlement.get("name") or "")),
            "kind": settlement.get("kind") or "settlement",
            "faction_id": settlement.get("faction_id"),
            "settlement": [round(cx, 1), round(cz, 1)],
            "track": track_id,
            "along": round(float(track.s[i]), 1),
            "at": [round(float(track.xz[i, 0]), 2), round(float(track.xz[i, 1]), 2)],
            "distance": round(math.hypot(track.xz[i, 0] - cx, track.xz[i, 1] - cz)),
        })
    return stops


def load_network(config: RailConfig, map_name: str) -> dict:
    """Every track, junction and stop in the configured world, ready to draw."""
    validate_map(map_name)
    if not config.tracks_dir:
        raise RailUnavailable("not_configured")
    folder = Path(config.tracks_dir) / config.world
    if not folder.is_dir():
        raise RailUnavailable("missing")
    files = sorted(folder.glob("*.json"))
    junction_files = sorted((folder / "junctions").glob("*.json"))
    key = (
        map_name,
        config.world,
        tuple(_stamp(str(p)) for p in files + junction_files),
        _stamp(input_file(map_name, "map_markers.json")),
        _stamp(defines_file(map_name, RUNS_FILENAME)),
    )
    with _CACHE_LOCK:
        cached = _NETWORK.get(key)
    if cached is not None:
        return cached

    tracks: dict[str, _Track] = {}
    unreadable = 0
    for path in files:
        data = _read_json(path)
        track = _parse_track(data, config.world) if data else None
        if track:
            tracks[track.id] = track
        elif data is None:
            unreadable += 1

    junctions = []
    for path in junction_files:
        data = _read_json(path)
        if not data or data.get("stem") not in tracks or data.get("branch") not in tracks:
            continue
        stem = tracks[data["stem"]]
        x, z = stem.point_at(float(data.get("s", 0.0)))
        junctions.append({
            "id": str(data.get("id", path.stem)),
            "stem": data["stem"],
            "branch": data["branch"],
            "at": [round(x, 2), round(z, 2)],
            "thrown": bool(data.get("thrown")),
        })

    stops = _stops(map_name, tracks)
    lines = []
    track_line: dict[str, int] = {}
    for number, ids in enumerate(_components(tracks, junctions)):
        for track_id in ids:
            track_line[track_id] = number
        # Ordered along the line's longest track, so a stop on a spur counts where the spur leaves it.
        main = tracks[ids[0]]
        on_line = sorted(
            (s for s in stops if s["track"] in ids),
            key=lambda s: float(main.s[np.argmin(np.hypot(main.xz[:, 0] - s["at"][0], main.xz[:, 1] - s["at"][1]))]),
        )
        names = [s["name"] for s in on_line]
        if len(names) >= 2:
            name = f"{names[0]} – {names[-1]}"
        elif names:
            name = f"{names[0]} line"
        else:
            name = "Unnamed line"
        lines.append({"id": number, "name": name, "length": round(sum(tracks[t].length for t in ids)), "tracks": ids})

    for stop in stops:
        stop["line"] = track_line[stop["track"]]

    network = {
        "status": "ok",
        "world": config.world,
        "updated_at": max((os.stat(p).st_mtime for p in files + junction_files if p.exists()), default=None),
        "unreadable_files": unreadable,
        "lines": lines,
        "tracks": [
            {
                "id": track.id,
                "line": track_line[track.id],
                "length": round(track.length, 1),
                "loop": track.loop,
                "points": _polyline(track, 0, len(track.xz) - 1),
                "broken": _stretches(track, track.broken),
                "damaged": _stretches(track, track.damaged),
            }
            for track in sorted(tracks.values(), key=lambda t: (track_line[t.id], -t.length, t.id))
        ],
        "junctions": junctions,
        "stops": sorted(stops, key=lambda s: (s["line"], s["track"], s["along"])),
    }
    with _CACHE_LOCK:
        _NETWORK.clear()
        _NETWORK[key] = network
    return network
