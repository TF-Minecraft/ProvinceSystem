"""Uploads contain the pack models needed by plugin downloads."""

import io
import json

import pytest
from PIL import Image

from src.skins import storage, submissions


@pytest.mark.parametrize(
    "kind,suffixes",
    [
        ("large_handheld", [""]),
        ("large_bow", ["", "_0", "_1", "_2"]),
        ("shield", ["", "_blocking"]),
        ("item_3d", [""]),
        ("helmet_3d", [""]),
        ("mask", [""]),
        ("gun", ["_carry", "_reload", "_aim", "_aim_charged"]),
    ],
)
def test_upload_writes_downloadable_models(tmp_path, monkeypatch, kind, suffixes):
    monkeypatch.setattr(storage, "SKINS_DIR", tmp_path)
    monkeypatch.setattr(submissions, "SKINS_DIR", tmp_path)
    png = io.BytesIO()
    Image.new("RGBA", (32, 32)).save(png, format="PNG")
    model = json.dumps({
        "textures": {"0": "source/texture"},
        "elements": [{"from": [0, 0, 0], "to": [1, 1, 1]}],
    }).encode()
    files = {"texture": png.getvalue()}
    if kind == "large_bow":
        files.update({f"pull_{i}": png.getvalue() for i in range(3)})
    elif kind == "gun":
        files.update({f"{pose}_model": model for pose in ("carry", "reload", "aim")})
    elif kind != "large_handheld":
        files["model"] = model
    folder = storage.write_submission_files(
        "submission", "item", kind, "Item", files,
        grip_preset="4.0" if kind == "large_handheld" else None,
    )
    expected = {f"item{suffix}.json" for suffix in suffixes}
    assert expected <= {p.name for p in folder.iterdir()}
    before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in folder.iterdir()}
    for name in expected:
        path = submissions.resolve_submission_file("submission", name)
        assert path == folder / name
        textures = json.loads(path.read_bytes())["textures"]
        assert all(value.startswith("tfmc_submissions:item/item") for value in textures.values())
    assert expected <= set(submissions._list_asset_files("submission"))
    assert {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in folder.iterdir()} == before
