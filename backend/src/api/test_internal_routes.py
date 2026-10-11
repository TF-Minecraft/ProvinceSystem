"""Route handler tests for localhost-gated internal map routes."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from fastapi import BackgroundTasks, HTTPException

from src.scripts.util.auth import HASHED_KEY


class _Headers(dict):
    def get(self, key, default=None):
        lowered = {str(name).lower(): value for name, value in self.items()}
        return lowered.get(str(key).lower(), default)


def _request_with_host(host: str, forwarded_for: str | None = None) -> MagicMock:
    request = MagicMock()
    request.client = MagicMock(host=host)
    headers = _Headers()
    if forwarded_for is not None:
        headers["X-Forwarded-For"] = forwarded_for
    request.headers = headers
    return request


def _stub_json_body(request: MagicMock, payload: object) -> None:
    """Feed a mocked Request through `data_routes._read_json_body`.

    That reader streams the body under a byte ceiling rather than calling
    `request.json()`, so stubbing `.json` no longer reaches the handler — the
    body has to arrive as chunks, with a Content-Length for the early check.
    """
    body = json.dumps(payload).encode("utf-8")
    request.headers["Content-Length"] = str(len(body))

    async def _stream():
        yield body

    request.stream = _stream



class InternalRoutesTest(unittest.IsolatedAsyncioTestCase):
    async def test_regenerate_rejects_remote(self) -> None:
        from src.api.regen_routes import regenerate_map

        request = _request_with_host("8.8.8.8")
        with self.assertRaises(HTTPException) as ctx:
            await regenerate_map(
                "main",
                HASHED_KEY,
                "fullregen",
                BackgroundTasks(),
                request,
            )
        self.assertEqual(403, ctx.exception.status_code)

    async def test_regenerate_allows_localhost(self) -> None:
        from src.api.regen_routes import regenerate_map

        request = _request_with_host("127.0.0.1")
        tasks = BackgroundTasks()

        with patch("src.api.regen_routes.validate_map"), patch(
            "src.api.regen_routes.run_regeneration"
        ):
            response = await regenerate_map(
                "main",
                HASHED_KEY,
                "fullregen",
                tasks,
                request,
            )

        self.assertEqual(200, response.status_code)
        body = json.loads(response.body)
        self.assertTrue(body["success"])
        self.assertEqual("main", body["map"])
        self.assertEqual("fullregen", body["regen_type"])

    async def test_regenerate_allows_docker_bridge(self) -> None:
        from src.api.regen_routes import regenerate_map

        request = _request_with_host("172.18.0.1")
        tasks = BackgroundTasks()

        with patch("src.api.regen_routes.validate_map"), patch(
            "src.api.regen_routes.run_regeneration"
        ):
            response = await regenerate_map(
                "main",
                HASHED_KEY,
                "fullregen",
                tasks,
                request,
            )

        self.assertEqual(200, response.status_code)

    async def test_regenerate_rejects_forwarded_for(self) -> None:
        from src.api.regen_routes import regenerate_map

        request = _request_with_host("172.18.0.1", forwarded_for="8.8.8.8")
        with self.assertRaises(HTTPException) as ctx:
            await regenerate_map(
                "main",
                HASHED_KEY,
                "fullregen",
                BackgroundTasks(),
                request,
            )
        self.assertEqual(403, ctx.exception.status_code)

    async def test_upload_region_rejects_remote(self) -> None:
        from src.api.data_routes import upload_region_data

        request = _request_with_host("8.8.8.8")
        with self.assertRaises(HTTPException) as ctx:
            await upload_region_data("main", "nation", request, BackgroundTasks())
        self.assertEqual(403, ctx.exception.status_code)

    async def test_upload_county_allows_docker_bridge_without_auth(self) -> None:
        from src.api.data_routes import upload_region_data

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            county_path = os.path.join(tmp, "county.json")
            request = _request_with_host("172.18.0.1")
            _stub_json_body(
                request,
                {"COUNTY_1": {"name": "A", "provinces": [1], "rgb": "1,2,3"}},
            )
            with patch("src.api.data_routes.validate_map"), patch(
                "src.api.data_routes.validate_title_tier",
                return_value={"COUNTY_1": {"name": "A", "provinces": [1], "rgb": "1,2,3"}},
            ), patch(
                "src.api.data_routes.defines_file",
                return_value=county_path,
            ):
                response = await upload_region_data(
                    "main",
                    "county",
                    request,
                    BackgroundTasks(),
                )

            self.assertEqual(200, response.status_code)
            self.assertTrue(os.path.isfile(county_path))

    async def test_upload_empty_duchy_skips_write(self) -> None:
        from src.api.data_routes import upload_region_data

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            duchy_path = os.path.join(tmp, "duchy.json")
            with open(duchy_path, "w", encoding="utf-8") as handle:
                handle.write('{"keep": true}')
            request = _request_with_host("172.18.0.1")
            _stub_json_body(request, {})
            with patch("src.api.data_routes.validate_map"), patch(
                "src.api.data_routes.defines_file",
                return_value=duchy_path,
            ) as defines:
                response = await upload_region_data(
                    "main",
                    "duchy",
                    request,
                    BackgroundTasks(),
                )

            self.assertEqual(200, response.status_code)
            defines.assert_not_called()
            with open(duchy_path, encoding="utf-8") as handle:
                self.assertEqual(handle.read(), '{"keep": true}')

    async def test_upload_regions_rejects_remote(self) -> None:
        from src.api.data_routes import upload_region_data

        request = _request_with_host("8.8.8.8")
        with self.assertRaises(HTTPException) as ctx:
            await upload_region_data("main", "regions", request, BackgroundTasks())
        self.assertEqual(403, ctx.exception.status_code)

    async def test_upload_regions_allows_docker_bridge(self) -> None:
        from src.api.data_routes import upload_region_data

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            regions_path = os.path.join(tmp, "regions.json")
            request = _request_with_host("172.18.0.1")
            _stub_json_body(
                request,
                {"REGION_1": {"name": "A", "provinces": [1], "rgb": "1,2,3"}},
            )
            with patch("src.api.data_routes.validate_map"), patch(
                "src.api.data_routes.defines_file",
                return_value=regions_path,
            ):
                response = await upload_region_data(
                    "main",
                    "regions",
                    request,
                    BackgroundTasks(),
                )

            self.assertEqual(200, response.status_code)
            self.assertTrue(os.path.isfile(regions_path))
            written = json.loads(Path(regions_path).read_text(encoding="utf-8"))
            self.assertEqual(written["REGION_1"]["provinces"], [1])

    async def test_upload_empty_regions_overwrites(self) -> None:
        from src.api.data_routes import upload_region_data

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            regions_path = os.path.join(tmp, "regions.json")
            with open(regions_path, "w", encoding="utf-8") as handle:
                handle.write('{"keep": true}')
            request = _request_with_host("172.18.0.1")
            _stub_json_body(request, {})
            with patch("src.api.data_routes.validate_map"), patch(
                "src.api.data_routes.defines_file",
                return_value=regions_path,
            ) as defines:
                response = await upload_region_data(
                    "main",
                    "regions",
                    request,
                    BackgroundTasks(),
                )

            self.assertEqual(200, response.status_code)
            defines.assert_called()
            written = json.loads(Path(regions_path).read_text(encoding="utf-8"))
            self.assertEqual(written, {})


class ChronicleSnapshotTriggerTest(unittest.IsolatedAsyncioTestCase):
    """The LAN-reachable capture trigger: no `force`, one capture per map."""

    def setUp(self) -> None:
        from src.api import chronicle_routes

        self.routes = chronicle_routes
        chronicle_routes._in_flight_maps.clear()
        self.addCleanup(chronicle_routes._in_flight_maps.clear)

    def test_force_is_not_part_of_the_route_surface(self) -> None:
        """`force=true` re-writes stored history; this gate is the whole LAN."""
        import inspect

        params = inspect.signature(self.routes.create_chronicle_snapshot).parameters
        self.assertNotIn("force", params)

    async def test_localhost_trigger_queues_one_capture(self) -> None:
        request = _request_with_host("127.0.0.1")
        tasks = BackgroundTasks()

        response = await self.routes.create_chronicle_snapshot("main", request, tasks)

        self.assertEqual(200, response.status_code)
        body = json.loads(response.body)
        self.assertTrue(body["success"])
        self.assertNotIn("force", body)
        self.assertEqual(1, len(tasks.tasks))
        self.assertEqual(("main", None), tasks.tasks[0].args)

    async def test_second_trigger_while_one_is_in_flight_is_409(self) -> None:
        """A LAN peer looping this must not fill the 40-slot threadpool."""
        request = _request_with_host("127.0.0.1")

        first = await self.routes.create_chronicle_snapshot(
            "main", request, BackgroundTasks()
        )
        second = await self.routes.create_chronicle_snapshot(
            "main", request, BackgroundTasks()
        )

        self.assertEqual(200, first.status_code)
        self.assertEqual(409, second.status_code)
        self.assertFalse(json.loads(second.body)["success"])

    async def test_a_busy_map_does_not_block_another_map(self) -> None:
        request = _request_with_host("127.0.0.1")

        await self.routes.create_chronicle_snapshot("main", request, BackgroundTasks())
        other = await self.routes.create_chronicle_snapshot(
            "dev", request, BackgroundTasks()
        )

        self.assertEqual(200, other.status_code)

    async def test_an_abandoned_slot_is_reclaimed_after_the_ttl(self) -> None:
        """The claim is in the handler, the release in the BackgroundTask.

        A response that never sends means the task never runs, and without an
        expiry that map would answer 409 for the life of the process.
        """
        request = _request_with_host("127.0.0.1")
        await self.routes.create_chronicle_snapshot("main", request, BackgroundTasks())

        # As if the claim had happened one second past the TTL.
        stale = self.routes._in_flight_maps["main"]
        self.routes._in_flight_maps["main"] = (
            stale - self.routes._CAPTURE_SLOT_TTL_SECONDS - 1
        )

        again = await self.routes.create_chronicle_snapshot(
            "main", request, BackgroundTasks()
        )
        self.assertEqual(200, again.status_code)

    async def test_a_slot_inside_the_ttl_is_still_held(self) -> None:
        request = _request_with_host("127.0.0.1")
        await self.routes.create_chronicle_snapshot("main", request, BackgroundTasks())

        self.routes._in_flight_maps["main"] -= (
            self.routes._CAPTURE_SLOT_TTL_SECONDS - 5
        )

        blocked = await self.routes.create_chronicle_snapshot(
            "main", request, BackgroundTasks()
        )
        self.assertEqual(409, blocked.status_code)

    async def test_the_slot_is_released_even_when_the_capture_raises(self) -> None:
        request = _request_with_host("127.0.0.1")
        tasks = BackgroundTasks()
        await self.routes.create_chronicle_snapshot("main", request, tasks)

        def _boom(*args, **kwargs):
            raise RuntimeError("capture exploded")

        with patch("src.scripts.chronicle.capture.capture_snapshot", _boom):
            self.routes._run_capture("main", None)

        again = await self.routes.create_chronicle_snapshot(
            "main", request, BackgroundTasks()
        )
        self.assertEqual(200, again.status_code)


if __name__ == "__main__":
    unittest.main()
