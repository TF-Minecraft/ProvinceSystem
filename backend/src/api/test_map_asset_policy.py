"""Public artefact freshness must never widen catalogue or editor caching."""

import asyncio
import os
import tempfile
import threading
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("SKINS_DEV", "1")

import httpx
from fastapi import FastAPI
from PIL import Image

from src.api import data_routes, editor_routes, file_routes, map_routes, maps_routes, tile_cache, tile_routes
from src.api.http_headers import PRIVATE_CACHE, PUBLIC_MAP_CACHE


class AssetPolicyTest(unittest.IsolatedAsyncioTestCase):
    async def test_public_and_staff_route_classes_and_304(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp)
            png = root / "image.png"
            Image.new("RGBA", (32, 32), (10, 20, 30, 255)).save(png)
            overlay = root / "main" / "regions" / "nation" / "region.png"
            overlay.parent.mkdir(parents=True)
            overlay.write_bytes(png.read_bytes())
            stack.enter_context(patch.object(file_routes, "OUTPUT_BASE", root))
            stack.enter_context(patch.object(tile_cache, "_LOD_DIR", root / "lod"))
            geometry = root / "geometry.json"
            geometry.write_text("{}")
            preview = root / "preview.webp"
            Image.new("RGB", (16, 16)).save(preview)
            stack.enter_context(patch.object(file_routes, "resolve_mapdata_path", return_value=png))
            stack.enter_context(patch.object(map_routes, "map_preview_path", return_value=str(preview)))
            stack.enter_context(patch.object(data_routes, "defines_file", return_value=str(geometry)))
            stack.enter_context(patch.object(editor_routes, "defines_file", return_value=str(geometry)))
            stack.enter_context(patch.object(editor_routes, "load_province_catalog", return_value=[]))
            stack.enter_context(patch.object(maps_routes, "list_accessible_maps", return_value=[]))
            stack.enter_context(patch.object(tile_cache, "_PICK_DIR", root / "pick"))
            stack.enter_context(patch.object(tile_cache, "_CACHE_DIR", root / "tiles"))
            stack.enter_context(patch.object(tile_routes, "_tile_source", return_value=png))
            manifest = tile_cache.build_pyramid(png)
            app = FastAPI()
            for module, name in ((data_routes, "data"), (file_routes, "file"), (map_routes, "map"),
                                 (maps_routes, "maps"), (editor_routes, "editor"), (tile_routes, "tile")):
                app.include_router(getattr(module, f"{name}_router"))
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                for public, auth in ((True, None), (False, "Bearer staff"), (True, "Bearer staff")):
                    with ExitStack() as gates:
                        entry = SimpleNamespace(id="main", public=public)
                        for module in (data_routes, file_routes, map_routes, tile_routes):
                            gates.enter_context(patch.object(module, "ensure_map_access", return_value=entry))
                        gates.enter_context(patch.object(editor_routes, "ensure_map_staff_write", return_value=entry))
                        headers = {"Authorization": auth} if auth else {}
                        expected = PUBLIC_MAP_CACHE if public and not auth else PRIVATE_CACHE
                        for path in ("map/preview",
                                     "data/province_centroids", "data/province_neighbors", "data/province_label_neighbors", "data/province_label_grid",
                                     "data/province_label_grid_bin", "data/province_id_runs", "data/province_id_grid_q4"):
                            response = await client.get(f"/main/{path}", headers=headers)
                            self.assertEqual(response.status_code, 200, path)
                            self.assertEqual(response.headers["cache-control"], expected, path)
                            fresh = await client.get(f"/main/{path}", headers={**headers, "If-None-Match": response.headers["etag"]})
                            self.assertEqual(fresh.status_code, 304, path)
                            self.assertEqual(fresh.headers["cache-control"], expected, path)
                        for path in ("/main/mapdata/nation", "/main/mapdata/nation?scale=1",
                                     "/main/regions/nation/region?lod=1", "/main/data/nation", "/main/editor/province-runs", "/main/editor/provinces", "/maps/accessible"):
                            response = await client.get(path, headers=headers)
                            self.assertEqual(response.status_code, 200, path)
                            self.assertEqual(response.headers["cache-control"], PRIVATE_CACHE, path)
                            if path.startswith(("/main/mapdata/", "/main/regions/")):
                                fresh = await client.get(path, headers={**headers, "If-None-Match": response.headers["etag"]})
                                self.assertEqual(fresh.status_code, 304, path)
                                self.assertEqual(fresh.headers["cache-control"], PRIVATE_CACHE, path)
                        tile = await client.get(f"/main/tiles/base/{manifest['version']}/0/0/0.webp", headers=headers)
                        self.assertEqual(tile.status_code, 200)
                        self.assertEqual(tile.headers["cache-control"], f"{'public' if public and not auth else 'private'}, max-age=31536000, immutable")

    async def test_negotiated_images_remain_private_with_vary(self):
        with tempfile.TemporaryDirectory() as tmp:
            png = Path(tmp) / "image.png"
            png.write_bytes(b"png")
            webp = Path(tmp) / "image.webp"
            webp.write_bytes(b"webp")
            for module, helper, args in (
                (file_routes, file_routes._image_response, [png]),
                (map_routes, map_routes._base_map_response, [str(png), "original"]),
            ):
                for variant, accept in ((None, "image/png"), (webp, "image/webp")):
                    with patch.object(module, "webp_variant", return_value=variant):
                        response = helper(*args, accept, None, None)
                    self.assertEqual(response.headers["cache-control"], PRIVATE_CACHE)
                    self.assertEqual(response.headers["vary"], "Accept")
                    self.assertEqual(response.media_type, "image/webp" if variant else "image/png")

    async def test_cold_pick_and_lod_lock_wait_do_not_block_another_request(self):
        # Hold the actual generation lock. A heartbeat must finish while the
        # cold route is still waiting; checking thread IDs alone misses this.
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp)
            source = root / "main" / "regions" / "nation" / "region.png"
            source.parent.mkdir(parents=True)
            Image.new("RGBA", (128, 128), (10, 20, 30, 255)).save(source)
            stack.enter_context(patch.object(file_routes, "OUTPUT_BASE", root))
            stack.enter_context(patch.object(file_routes, "resolve_mapdata_path", return_value=source))
            stack.enter_context(patch.object(file_routes, "ensure_map_access", return_value=SimpleNamespace(id="main", public=True)))
            stack.enter_context(patch.object(tile_cache, "_PICK_DIR", root / "pick"))
            stack.enter_context(patch.object(tile_cache, "_LOD_DIR", root / "lod"))
            app = FastAPI()
            app.include_router(file_routes.file_router)

            @app.get("/heartbeat")
            async def heartbeat():
                return {"ok": True}

            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                for path, lock, name in (("/main/mapdata/nation?scale=1", tile_cache._pick_lock, "pick_variant"),
                                         ("/main/regions/nation/region?lod=1", tile_cache._lod_lock, "lod_variant")):
                    entered = threading.Event()
                    function = getattr(file_routes, name)

                    def generate(*args):
                        entered.set()
                        return function(*args)

                    lock.acquire()
                    # Release from a real timer even on regression: an event-loop
                    # timeout cannot rescue a test when that loop itself is stuck.
                    rescue = threading.Timer(2, lock.release)
                    rescue.start()
                    try:
                        with patch.object(file_routes, name, side_effect=generate):
                            cold = asyncio.create_task(client.get(path))
                            for _ in range(100):
                                if entered.is_set():
                                    break
                                await asyncio.sleep(0.005)
                            self.assertTrue(entered.is_set())
                            response = await client.get("/heartbeat")
                            self.assertEqual(response.status_code, 200)
                            self.assertFalse(cold.done(), "cold generation blocked the event loop")
                            rescue.cancel()
                            lock.release()
                            self.assertEqual((await cold).status_code, 200)
                    finally:
                        rescue.cancel()
                        if lock.locked():
                            lock.release()

    async def test_image_workers_are_bounded(self):
        active = maximum = 0
        lock = threading.Lock()
        release = threading.Event()
        started = threading.Event()

        def work():
            nonlocal active, maximum
            with lock:
                active += 1
                maximum = max(maximum, active)
                if active == 2:
                    started.set()
            release.wait(2)
            with lock:
                active -= 1

        jobs = [asyncio.create_task(tile_cache.run_derivative(work)) for _ in range(6)]
        try:
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.005)
            self.assertTrue(started.is_set())
            self.assertEqual(maximum, 2)
        finally:
            release.set()
            await asyncio.gather(*jobs)
        self.assertEqual(maximum, 2)

    async def test_manifest_can_answer_while_both_derivative_workers_are_busy(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            source = Path(tmp) / "map.png"
            Image.new("RGB", (32, 32)).save(source)
            stack.enter_context(patch.object(tile_cache, "_CACHE_DIR", Path(tmp) / "tiles"))
            stack.enter_context(patch.object(tile_routes, "_tile_source", return_value=source))
            stack.enter_context(patch.object(tile_routes, "ensure_map_access", return_value=SimpleNamespace(id="main", public=True)))
            built = tile_cache.build_pyramid(source)
            tile_cache._versions.clear()
            app = FastAPI()
            app.include_router(tile_routes.tile_router)
            # Occupy both slots without a timing race or a sleeping worker.
            borrowers = (object(), object())
            for borrower in borrowers:
                await tile_cache._DERIVATIVE_LIMITER.acquire_on_behalf_of(borrower)
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    response = await asyncio.wait_for(client.get("/main/tiles/base/manifest"), timeout=1)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["version"], built["version"])
            finally:
                for borrower in borrowers:
                    tile_cache._DERIVATIVE_LIMITER.release_on_behalf_of(borrower)

    async def test_regenerated_pick_maps_revalidate_old_etags_at_both_scales(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            source = Path(tmp) / "nation.png"
            Image.new("RGB", (32, 32), (10, 20, 30)).save(source)
            stack.enter_context(patch.object(tile_cache, "_CACHE_DIR", Path(tmp) / "tiles"))
            stack.enter_context(patch.object(tile_cache, "_PICK_DIR", Path(tmp) / "pick"))
            stack.enter_context(patch.object(file_routes, "resolve_mapdata_path", return_value=source))
            stack.enter_context(patch.object(file_routes, "ensure_map_access", return_value=SimpleNamespace(id="main", public=True)))
            app = FastAPI()
            app.include_router(file_routes.file_router)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                paths = ("/main/mapdata/nation", "/main/mapdata/nation?scale=1")
                before = [await client.get(path) for path in paths]
                Image.new("RGB", (32, 32), (200, 100, 50)).save(source)
                for path, old in zip(paths, before):
                    response = await client.get(path, headers={"If-None-Match": old.headers["etag"]})
                    self.assertEqual(response.status_code, 200)
                    self.assertNotEqual(response.content, old.content)
                    self.assertEqual(response.headers["cache-control"], PRIVATE_CACHE)
