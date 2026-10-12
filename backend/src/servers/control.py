"""Website client for the host's restricted Minecraft control socket."""
from __future__ import annotations

import json
import os
import socket

from src.servers import inventory

MAX_MESSAGE = 1 << 20


class ControlError(Exception):
    def __init__(self, code: str, status: int = 409):
        super().__init__(code)
        self.code, self.status = code, status


def request(operation: str, **body) -> dict:
    path = os.getenv("SERVER_CONTROL_SOCKET", "").strip()
    if not path:
        raise ControlError("control_not_configured", 503)
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(180 if operation == "plan" else 35)
            connection.connect(path)
            connection.sendall(json.dumps({"operation": operation, **body}).encode() + b"\n")
            with connection.makefile("rb") as stream:
                raw = stream.readline(MAX_MESSAGE + 1)
            if len(raw) > MAX_MESSAGE or not raw.endswith(b"\n"):
                raise ValueError("invalid control response")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError("invalid control response")
    except (OSError, ValueError) as exc:
        raise ControlError("control_unavailable", 503) from exc
    if "error" in result:
        raise ControlError(result["error"], result.get("status", 409))
    return result


def status() -> dict:
    try:
        return {"status": "available", **request("status")}
    except ControlError as exc:
        return {"status": exc.code, "jobs": []}


def plan(server: str, mode: str) -> dict:
    if server not in {"main", "dev"} or mode not in {"restart", "latest"}:
        raise ControlError("bad_server_action", 400)
    candidates = []
    if mode == "latest":
        if inventory.github_org() != inventory.DEFAULT_ORG:
            raise ControlError("release_org_not_supported", 400)
        # A write must never silently use stale release information.
        releases, _, failed = inventory.releases_cache.get()
        if releases is None or failed:
            raise ControlError("releases_unavailable", 503)
        for repo, found in releases.items():
            release = found[0]
            candidates.append({"repo": repo, "tag": release.tag, "asset": release.asset,
                               "sha256": release.sha256,
                               "known": [{"sha256": r.sha256, "version": r.version} for r in found]})
    return request("plan", server=server, mode=mode, releases=candidates)
