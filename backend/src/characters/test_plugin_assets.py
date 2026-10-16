"""Plugin-synced wardrobe templates and kit skins live in the data mount."""

from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from PIL import Image

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src.characters import lore_items, wardrobe  # noqa: E402


def _png(size: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (size, size), (1, 2, 3, 255)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def folders(tmp_path, monkeypatch):
    data, baked = tmp_path / "data", tmp_path / "backend"
    monkeypatch.setattr(wardrobe, "DATA_DIR", data)
    monkeypatch.setattr(wardrobe, "_backend_root", lambda: baked)
    monkeypatch.setattr(lore_items, "_kit_skins_synced_dir", lambda: data / "plugin-assets" / "kit_skins")
    monkeypatch.setattr(lore_items, "_backend_root", lambda: baked)
    monkeypatch.delenv("KIT_SKINS_DIR", raising=False)
    return data, baked


def test_masked_template_is_stored_in_the_data_mount(folders):
    data, baked = folders
    with pytest.raises(wardrobe.WardrobeError):
        wardrobe.resolve_masked_template_path()
    (baked / "assets/wardrobe").mkdir(parents=True)
    (baked / "assets/wardrobe/masked.png").write_bytes(b"baked")
    assert wardrobe.load_masked_template() == b"baked"

    synced = _png(64)
    result = wardrobe.store_masked_template(synced)
    assert result["path"] == "data/plugin-assets/wardrobe/masked.png"
    assert (data / "plugin-assets/wardrobe/masked.png").read_bytes() == synced
    assert wardrobe.load_masked_template() == synced
    assert (baked / "assets/wardrobe/masked.png").read_bytes() == b"baked"


def test_kit_skin_is_stored_in_the_data_mount_and_searched_first(folders):
    data, baked = folders
    stored = lore_items.store_plugin_kit_skin("journal_skin", b"\x89PNG\r\n\x1a\nsynced")
    assert stored["path"] == "data/plugin-assets/kit_skins/journal_skin.png"
    assert (data / "plugin-assets/kit_skins/journal_skin.png").is_file()
    dirs = lore_items._kit_skins_search_dirs()
    assert dirs[0] == data / "plugin-assets/kit_skins"
    assert dirs[1] == baked / "assets/kit_skins"
