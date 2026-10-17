"""Concurrent requests share a durable result, without holding wardrobe locks."""

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest import mock

from src.characters import wardrobe, wardrobe_plushie as plushie


def test_simultaneous_generation_is_uploaded_once_and_reused_afterward(tmp_path, monkeypatch):
    monkeypatch.setattr(wardrobe, "DATA_DIR", tmp_path)
    monkeypatch.setattr(wardrobe, "WARDROBE_DIR", tmp_path / "wardrobe")
    entered, release = Event(), Event()

    def sign(png, model):
        assert png == b"generated-png" and model == "classic"
        entered.set()
        assert release.wait(5)
        return "texture", "signature"

    with mock.patch.object(plushie, "sign_wardrobe_skin", side_effect=sign) as signer:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(plushie.generate_plushie, "a" * 64, b"generated-png")
            try:
                assert entered.wait(5)
                pool.submit(plushie.generate_plushie, "a" * 64, b"generated-png").result(timeout=5)
                # Signing must not hold the wardrobe guard.
                with wardrobe.assets.asset_guard():
                    pass
            finally:
                release.set()
            first.result(timeout=5)
        plushie.generate_plushie("a" * 64, b"generated-png")
        signer.assert_called_once()
    assert json.loads((tmp_path / "plushies" / ("a" * 64 + ".json")).read_text()) == {
        "value": "texture", "signature": "signature",
    }


def test_corrupt_cache_is_replaced_and_failed_upload_can_be_retried(tmp_path, monkeypatch):
    monkeypatch.setattr(wardrobe, "DATA_DIR", tmp_path)
    path = plushie._cache_path("b" * 64)
    path.parent.mkdir()
    for content in ("bad-json", "[]", '{"value":"", "signature":"signature"}',
                    '{"retry_at":999999999999}'):
        path.write_text(content)
        assert plushie._cached(path) == {}
    with mock.patch.object(plushie, "sign_wardrobe_skin", side_effect=RuntimeError("upstream broke")):
        plushie.generate_plushie("b" * 64, b"png")
    failed = plushie._cached(path)
    assert failed["status_code"] == 502
    assert "upstream broke" not in failed["error"]
    with mock.patch.object(plushie.time, "time", return_value=failed["retry_at"] + 1):
        with mock.patch.object(plushie, "sign_wardrobe_skin", return_value=("", "signature")):
            plushie.generate_plushie("b" * 64, b"png")
        assert "incomplete" in plushie._cached(path)["error"]
