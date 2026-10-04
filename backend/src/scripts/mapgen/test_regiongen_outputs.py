"""Pixel and crop-box contracts for political region generation."""

import hashlib
import json

import numpy as np
import pytest
from PIL import Image

from ..util import dirs
from . import regiongen
from .geometry_cache import MapGeometryCache


@pytest.mark.parametrize("cached", [False, True])
@pytest.mark.parametrize("borders", [False, True])
@pytest.mark.parametrize("queued", [False, True])
def test_region_outputs(tmp_path, monkeypatch, borders, queued, cached):
    monkeypatch.setattr(dirs, "OUTPUT_DIR", str(tmp_path / "output"))
    monkeypatch.setattr(dirs, "INPUT_DIR", str(tmp_path / "input"))
    source = tmp_path / "input" / "testmap"
    source.mkdir(parents=True)
    ids = np.zeros((24, 32), dtype=np.uint16)
    ids[0:14, 0:10] = 1
    ids[4:20, 10:18] = 2
    ids[6:24, 18:32] = 3
    owners = [(150, 20, 30), (40, 170, 60), (70, 80, 190)]
    colours = [(1, 0, 0), (2, 0, 0), (3, 0, 0)]
    provinces = np.zeros((*ids.shape, 4), dtype=np.uint8)
    for pid, colour in enumerate(colours, 1):
        provinces[ids == pid] = (*colour, 255)
    cache = MapGeometryCache(
        width=32, height=24, provinces_rgba=provinces,
        packed_rgb=np.zeros(ids.shape, dtype=np.uint32),
        province_id_map=ids, land_mask=ids != 0,
        rgb_to_id=dict(zip(colours, range(1, 4))),
    )
    monkeypatch.setattr(MapGeometryCache, "load", lambda *args: cache)

    def mapping(*args):
        return dict(zip(colours, [owners[0], owners[0], owners[1]]))
    mapping.occupation_provinces = {colours[1]}
    monkeypatch.setattr(regiongen, "build_color_mapping", mapping)
    monkeypatch.setattr(regiongen, "get_color_overrides", lambda *args: {owners[0]: owners[1]})
    monkeypatch.setattr(regiongen, "compile_queue", lambda *args: None)
    monkeypatch.setattr(regiongen, "load_queue", lambda *args: ["150_20_30"])
    monkeypatch.setattr(regiongen, "clear_mode", lambda *args: None)
    output = tmp_path / "output" / "testmap" / "regions" / "nation"
    output.mkdir(parents=True)
    # Queued regeneration must retain the crop boxes it does not repaint.
    (output / "overlays.json").write_text(json.dumps({"7,8,9": {"overlay": {"x": 1, "y": 2, "w": 3, "h": 4}}}))
    regiongen.generate_regions("testmap", "nation", borders, cache=cache if cached else None, queued_regen=queued)
    digest = hashlib.sha256()
    for path in sorted(output.iterdir()):
        digest.update(path.name.encode())
        if path.suffix == ".png":
            with Image.open(path) as image:
                digest.update(str(image.size).encode())
                digest.update(image.tobytes())
        else:
            digest.update(json.dumps(json.loads(path.read_text()), sort_keys=True).encode())
    expected = {
        (False, False): "28f91eb4ef224793b8e5235c3d7b8165a26e37cdeb32aab12a8dfab27c7f9e02",
        (True, False): "707097d6c1e676d23b3e48cdf89139956bdc441c0b6f1c9281012a7db98c3102",
        (False, True): "c5125c51174974434e9307645fcaf555deeadde2987c61cdb8891c395afe9902",
        (True, True): "c985482576f9900d489b1fbe14807dc0ea790e9230e2cc92a51a704c6703cd59",
    }
    assert digest.hexdigest() == expected[borders, queued]
