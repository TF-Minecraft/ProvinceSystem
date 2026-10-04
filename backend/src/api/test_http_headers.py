"""Cache-Control for live map file and JSON responses.

Map images must never go stale, but they are large and regenerate rarely, so
they revalidate (`no-cache` + ETag -> 304) instead of using `no-store`.
File-backed JSON (geometry, labels, the province grid) revalidates the same
way; only error payloads stay on `no-store`.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

# The routes take the *normalised* map id from ensure_map_access's MapEntry
# (a raw path segment like "/%20MaIn/..." passes the gate as "main"), so a stub
# gate has to hand back something with an .id or the routes key their caches
# and paths on a mock object.
_GATE = {"return_value": SimpleNamespace(id="main", public=False)}

from fastapi import Response

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from src.api.http_headers import (
    add_no_cache,
    add_revalidate,
    conditional_file_response,
    conditional_json_response,
    make_etag,
)


class HttpHeadersTest(unittest.TestCase):
    def test_add_no_cache_sets_no_store(self) -> None:
        response = add_no_cache(Response())
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertEqual("no-cache", response.headers["Pragma"])
        self.assertEqual("0", response.headers["Expires"])


class RevalidateHeaderTest(unittest.TestCase):
    def test_add_revalidate_allows_storage_but_forces_recheck(self) -> None:
        response = add_revalidate(Response())
        cache_control = response.headers["Cache-Control"]
        self.assertIn("no-cache", cache_control)
        self.assertIn("private", cache_control)
        # no-store would defeat the point: the body could never be reused.
        self.assertNotIn("no-store", cache_control)


class ConditionalFileResponseTest(unittest.TestCase):
    def _png(self, tmp: str) -> Path:
        png = Path(tmp) / "map.png"
        png.write_bytes(b"fake-png-bytes")
        return png

    def test_serves_body_with_etag_when_client_has_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            response = conditional_file_response(
                self._png(tmp), media_type="image/png"
            )
            self.assertEqual(200, response.status_code)
            self.assertTrue(response.headers["etag"])
            self.assertIn("no-cache", response.headers["Cache-Control"])

    def test_returns_304_when_etag_matches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            png = self._png(tmp)
            first = conditional_file_response(png, media_type="image/png")
            second = conditional_file_response(
                png,
                media_type="image/png",
                if_none_match=first.headers["etag"],
            )
            self.assertEqual(304, second.status_code)
            self.assertEqual(b"", second.body)

    def test_returns_200_when_file_changed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            png = self._png(tmp)
            stale_etag = conditional_file_response(
                png, media_type="image/png"
            ).headers["etag"]
            png.write_bytes(b"fake-png-bytes-regenerated")

            response = conditional_file_response(
                png, media_type="image/png", if_none_match=stale_etag
            )
            self.assertEqual(200, response.status_code)

    def test_keeps_cors_open_on_both_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            png = self._png(tmp)
            full = conditional_file_response(png, media_type="image/png")
            not_modified = conditional_file_response(
                png, media_type="image/png", if_none_match=full.headers["etag"]
            )
            self.assertEqual("*", full.headers["Access-Control-Allow-Origin"])
            self.assertEqual("*", not_modified.headers["Access-Control-Allow-Origin"])


class MapdataRevalidateTest(unittest.IsolatedAsyncioTestCase):
    async def test_mapdata_nation_revalidates_instead_of_no_store(self) -> None:
        from src.api import file_routes

        with tempfile.TemporaryDirectory() as tmp:
            maps_dir = Path(tmp) / "main" / "maps"
            maps_dir.mkdir(parents=True)
            png = maps_dir / "nation_map.png"
            png.write_bytes(b"fake-png-bytes")

            with patch.object(file_routes, "OUTPUT_BASE", Path(tmp)):
                with patch("src.api.file_routes.ensure_map_access", **_GATE):
                    response = await file_routes.get_map_file("main", "nation", None)

            self.assertIn("no-cache", response.headers["Cache-Control"])
            self.assertNotIn("no-store", response.headers["Cache-Control"])
            self.assertTrue(response.headers["etag"])
            self.assertEqual("*", response.headers["Access-Control-Allow-Origin"])


class ConditionalJsonResponseTest(unittest.TestCase):
    def test_serves_body_with_etag_when_client_has_nothing(self) -> None:
        etag = make_etag("main", 1234.5)
        response = conditional_json_response({"a": 1}, etag=etag)
        self.assertEqual(200, response.status_code)
        self.assertEqual(etag, response.headers["etag"])
        self.assertIn("no-cache", response.headers["Cache-Control"])
        self.assertNotIn("no-store", response.headers["Cache-Control"])
        self.assertEqual("*", response.headers["Access-Control-Allow-Origin"])

    def test_returns_304_when_etag_matches(self) -> None:
        etag = make_etag("main", 1234.5)
        response = conditional_json_response({"a": 1}, etag=etag, if_none_match=etag)
        self.assertEqual(304, response.status_code)
        self.assertEqual(b"", response.body)
        self.assertEqual("*", response.headers["Access-Control-Allow-Origin"])

    def test_weak_etag_from_a_proxy_still_matches(self) -> None:
        etag = make_etag("main", 1234.5)
        response = conditional_json_response(
            {"a": 1}, etag=etag, if_none_match=f"W/{etag}"
        )
        self.assertEqual(304, response.status_code)

    def test_returns_200_when_identity_changed(self) -> None:
        response = conditional_json_response(
            {"a": 2},
            etag=make_etag("main", 9999.0),
            if_none_match=make_etag("main", 1234.5),
        )
        self.assertEqual(200, response.status_code)


class MapDataJsonRevalidateTest(unittest.IsolatedAsyncioTestCase):
    async def test_nation_json_revalidates_instead_of_no_store(self) -> None:
        from src.api import data_routes

        with tempfile.TemporaryDirectory() as tmp:
            nation_path = os.path.join(tmp, "nation.json")
            with open(nation_path, "w", encoding="utf-8") as handle:
                handle.write('{"Lantan": {"id": "Lantan", "rgb": "51,200,210"}}')

            with patch("src.api.data_routes.ensure_map_access", **_GATE):
                with patch("src.api.data_routes.defines_file", return_value=nation_path):
                    response = await data_routes.get_map_name_data(
                        "main", "nation", None
                    )
                    etag = response.headers["etag"]
                    not_modified = await data_routes.get_map_name_data(
                        "main", "nation", None, etag
                    )

            self.assertEqual(200, response.status_code)
            self.assertIn("no-cache", response.headers["Cache-Control"])
            self.assertNotIn("no-store", response.headers["Cache-Control"])
            self.assertEqual("application/json", response.media_type)
            self.assertEqual(304, not_modified.status_code)

    async def test_missing_json_still_sends_no_store(self) -> None:
        from src.api import data_routes

        with tempfile.TemporaryDirectory() as tmp:
            missing = os.path.join(tmp, "nope.json")
            with patch("src.api.data_routes.ensure_map_access", **_GATE):
                with patch("src.api.data_routes.defines_file", return_value=missing):
                    response = await data_routes.get_map_name_data("main", "nope", None)

            self.assertEqual(404, response.status_code)
            self.assertIn("no-store", response.headers["Cache-Control"])


class CompiledProvincesEtagTest(unittest.IsolatedAsyncioTestCase):
    async def test_cached_payload_revalidates_with_304(self) -> None:
        from src.api import data_routes

        data_routes.clear_province_cache("main")
        self.addCleanup(data_routes.clear_province_cache, "main")

        with patch("src.api.data_routes.ensure_map_access", **_GATE):
            with patch(
                "src.api.data_routes.build_compiled_provinces",
                return_value={"1": {"province_id": "1"}},
            ) as build:
                first = await data_routes.get_compiled_provinces("main", None)
                etag = first.headers["etag"]
                second = await data_routes.get_compiled_provinces("main", None, etag)

        self.assertEqual(200, first.status_code)
        self.assertEqual(304, second.status_code)
        # The second request was answered from the in-memory cache.
        self.assertEqual(1, build.call_count)

    async def test_cleared_cache_with_identical_data_still_revalidates(self) -> None:
        """The ETag tracks the body, not the cache entry.

        Clearing the cache rebuilds the payload, but if it rebuilds to the same
        bytes the client already holds them, so a 304 is correct and saves the
        ~185KB re-download a timestamp-derived tag would have forced.
        """
        from src.api import data_routes

        data_routes.clear_province_cache("main")
        self.addCleanup(data_routes.clear_province_cache, "main")

        with patch("src.api.data_routes.ensure_map_access", **_GATE):
            with patch(
                "src.api.data_routes.build_compiled_provinces",
                return_value={"1": {"province_id": "1"}},
            ):
                first = await data_routes.get_compiled_provinces("main", None)
                etag = first.headers["etag"]
                data_routes.clear_province_cache("main")
                second = await data_routes.get_compiled_provinces("main", None, etag)

        self.assertEqual(304, second.status_code)

    async def test_changed_data_invalidates_the_etag(self) -> None:
        from src.api import data_routes

        data_routes.clear_province_cache("main")
        self.addCleanup(data_routes.clear_province_cache, "main")

        with patch("src.api.data_routes.ensure_map_access", **_GATE):
            with patch(
                "src.api.data_routes.build_compiled_provinces",
                return_value={"1": {"province_id": "1"}},
            ):
                first = await data_routes.get_compiled_provinces("main", None)
                etag = first.headers["etag"]

            data_routes.clear_province_cache("main")
            with patch(
                "src.api.data_routes.build_compiled_provinces",
                return_value={"1": {"province_id": "1"}, "2": {"province_id": "2"}},
            ):
                second = await data_routes.get_compiled_provinces("main", None, etag)

        self.assertEqual(200, second.status_code)
        self.assertNotEqual(etag, second.headers["etag"])


class MarkersEtagTest(unittest.IsolatedAsyncioTestCase):
    async def test_unchanged_markers_revalidate_with_304(self) -> None:
        from src.api import data_routes

        payload = {"map_id": "main", "settlements": [], "forts": []}
        with patch("src.api.data_routes.ensure_map_access", **_GATE):
            with patch(
                "src.api.data_routes.build_markers_response", return_value=payload
            ):
                first = await data_routes.get_map_markers("main", None)
                etag = first.headers["etag"]
                second = await data_routes.get_map_markers("main", None, etag)

        self.assertEqual(200, first.status_code)
        self.assertNotIn("no-store", first.headers["Cache-Control"])
        self.assertEqual(304, second.status_code)

    async def test_changed_markers_send_a_new_body(self) -> None:
        from src.api import data_routes

        with patch("src.api.data_routes.ensure_map_access", **_GATE):
            with patch(
                "src.api.data_routes.build_markers_response",
                return_value={"map_id": "main", "settlements": []},
            ):
                first = await data_routes.get_map_markers("main", None)
                etag = first.headers["etag"]
            with patch(
                "src.api.data_routes.build_markers_response",
                return_value={"map_id": "main", "settlements": [{"id": "s1"}]},
            ):
                second = await data_routes.get_map_markers("main", None, etag)

        self.assertEqual(200, second.status_code)


class OverlayWebpTest(unittest.IsolatedAsyncioTestCase):
    """Display-only overlays may be served as WebP; pick maps never are."""

    async def test_region_overlay_uses_webp_when_a_copy_is_ready(self) -> None:
        from src.api import file_routes

        with tempfile.TemporaryDirectory() as tmp:
            regions = Path(tmp) / "main" / "regions" / "nation"
            regions.mkdir(parents=True)
            png = regions / "lantan.png"
            png.write_bytes(b"fake-png-bytes")
            webp = Path(tmp) / "lantan.webp"
            webp.write_bytes(b"fake-webp-bytes")

            with patch.object(file_routes, "OUTPUT_BASE", Path(tmp)):
                with patch("src.api.file_routes.ensure_map_access", **_GATE):
                    with patch(
                        "src.api.file_routes.webp_variant", return_value=webp
                    ) as variant:
                        response = await file_routes.get_region_file(
                            "main", "nation", "lantan", None, "image/webp,*/*"
                        )

        self.assertEqual("image/webp", response.media_type)
        self.assertEqual("Accept", response.headers["Vary"])
        self.assertEqual("image/webp,*/*", variant.call_args.kwargs["accept"])

    async def test_region_overlay_falls_back_to_png(self) -> None:
        from src.api import file_routes

        with tempfile.TemporaryDirectory() as tmp:
            regions = Path(tmp) / "main" / "regions" / "nation"
            regions.mkdir(parents=True)
            (regions / "lantan.png").write_bytes(b"fake-png-bytes")

            with patch.object(file_routes, "OUTPUT_BASE", Path(tmp)):
                with patch("src.api.file_routes.ensure_map_access", **_GATE):
                    with patch("src.api.file_routes.webp_variant", return_value=None):
                        response = await file_routes.get_region_file(
                            "main", "nation", "lantan", None, None
                        )

        self.assertEqual("image/png", response.media_type)

    async def test_pick_map_is_never_converted_to_webp(self) -> None:
        from src.api import file_routes

        with tempfile.TemporaryDirectory() as tmp:
            maps_dir = Path(tmp) / "main" / "maps"
            maps_dir.mkdir(parents=True)
            (maps_dir / "nation_map.png").write_bytes(b"fake-png-bytes")

            with patch.object(file_routes, "OUTPUT_BASE", Path(tmp)):
                with patch("src.api.file_routes.ensure_map_access", **_GATE):
                    with patch("src.api.file_routes.webp_variant") as variant:
                        response = await file_routes.get_map_file(
                            "main", "nation", None
                        )

        # Lossy WebP would corrupt the RGB -> province id lookups the client
        # runs on this image.
        variant.assert_not_called()
        self.assertEqual("image/png", response.media_type)


if __name__ == "__main__":
    unittest.main()
