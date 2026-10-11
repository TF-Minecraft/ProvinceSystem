"""Refuses writes while an admin views the site as a player (src/auth/view_as.py).

One check for every route: a write carrying the view's session cookie, or a
Profile session opened during the view, gets 403 viewing_as_player.
"""
from __future__ import annotations

import re

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse

from src.auth import view_as

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_SESSION_COOKIES = ("__Host-tfmc_session", "tfmc_session")
# A refused start from inside a view, audited before the 403.
_START = re.compile(r"/admin/accounts/(\d+)/view-as$")
# Writes a view still needs: leaving it, and opening or closing its view-only Profile.
_ALLOWED_SUFFIXES = ("/auth/view-as/stop", "/auth/logout", "/account/profile-session", "/characters/logout")


def _bearer(request: Request) -> str | None:
    scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
    if scheme.lower() != "bearer":
        return None
    return token.strip() or None


class ViewAsGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in _SAFE_METHODS:
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        if not request.url.path.rstrip("/").endswith(_ALLOWED_SUFFIXES):
            cookies = [token for name in _SESSION_COOKIES if (token := request.cookies.get(name))]
            bearer = _bearer(request)
            if cookies or bearer:
                if await run_in_threadpool(view_as.refuses_write, cookies, bearer):
                    start = _START.search(request.url.path.rstrip("/"))
                    if start and cookies:
                        await run_in_threadpool(view_as.audit_refused_start, cookies, int(start[1]))
                    response = JSONResponse({"detail": "viewing_as_player"}, status_code=403)
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)
