"""Website client for the host's restricted Minecraft control socket."""
from __future__ import annotations

import json
import os
import socket
from pathlib import Path

from src.servers import inventory

MAX_MESSAGE = 1 << 20


class ControlError(Exception):
    def __init__(self, code: str, status: int = 409):
        super().__init__(code)
        self.code, self.status = code, status


def _amp_login() -> dict | None:
    """The AMP account the helper should act as, from this site's environment."""
    username = os.getenv("SERVER_CONTROL_AMP_USERNAME", "").strip()
    password = os.getenv("SERVER_CONTROL_AMP_PASSWORD", "")
    return {"username": username, "password": password} if username and password else None


def request(operation: str, **body) -> dict:
    path = os.getenv("SERVER_CONTROL_SOCKET", "").strip()
    if not path:
        raise ControlError("control_not_configured", 503)
    if operation != "status" and (login := _amp_login()):
        body["amp"] = login
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            # Writes can wait behind a plan's downloads for the helper's lock, and a
            # reopen spends up to 30 s on maintenance plus 25 s per console call.
            connection.settimeout(35 if operation in {"status", "resolve"} else 180)
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
    # Refusals are exactly {"error", "status"}; accepted jobs carry their own "error" field.
    if set(result) == {"error", "status"}:
        raise ControlError(result["error"], result["status"])
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
        variable = "SERVER_MAIN_DIR" if server == "main" else "SERVER_DEV_DIR"
        root = os.getenv(variable, "").strip()
        if not root or not (Path(root) / "plugins").is_dir():
            raise ControlError("server_files_unavailable", 503)
        releases, servers = inventory.check_servers({server: (Path(root), server == "main")})
        if releases.error or releases.errors:
            raise ControlError("releases_unavailable", 503)
        plugins, others = inventory.compare(releases, servers)
        if any(p["servers"][server]["state"] == "unverified" for p in plugins) or any(o.get("unverified") for o in others):
            raise ControlError("releases_unavailable", 503)
        expected = [{"file": ("update/" if j.update else "") + j.file, "sha256": j.sha256,
                     "name": j.name, "version": j.version} for j in servers[server]["jars"]]
        for repo, found in releases.items():
            release = found[0]
            candidates.append({"repo": repo, "tag": release.tag, "asset": release.asset,
                               "sha256": release.sha256,
                               "known": [{"sha256": r.sha256, "version": r.version} for r in found]})
    try:
        return request("plan", server=server, mode=mode, releases=candidates,
                       **({"expected": expected} if mode == "latest" else {}))
    except ControlError as error:
        if mode == "latest" and error.code == "bad_control_request":
            raise ControlError("control_unavailable", 503) from None
        raise
