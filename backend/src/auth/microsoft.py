"""Prove which Minecraft Java account someone owns by signing in with Microsoft.

The chain is Microsoft account → Xbox Live → XSTS → Minecraft services → profile.
Every token stays in memory for one request and is then dropped; errors carry
stable codes only, never response bodies.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode, urlsplit

import httpx

from .config import SITE_DEFAULT, _callback_matches_site, _origin

CALLBACK_PATH = "/api/auth/microsoft/callback"
CALLBACK_ROUTE = "/auth/microsoft/callback"
LOGIN_BASE = "https://login.microsoftonline.com/consumers/oauth2/v2.0"
XBL_URL = "https://user.auth.xboxlive.com/user/authenticate"
XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize"
MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox"
MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile"
SCOPES = "XboxLive.signin"

_UUID_HEX = re.compile(r"[0-9a-f]{32}")
_MC_NAME = re.compile(r"[A-Za-z0-9_]{1,16}")
_GUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

# XSTS refusals people can act on; anything else is a plain failure.
_XSTS_ERRORS = {
    2148916233: "no_xbox_profile",
    2148916235: "xbox_region_blocked",
    2148916236: "xbox_adult_verification",
    2148916237: "xbox_adult_verification",
    2148916238: "xbox_child_account",
}


class MicrosoftError(RuntimeError):
    """A stable, non-sensitive failure code."""


@dataclass(frozen=True)
class MicrosoftConfig:
    enabled: bool
    client_id: str
    client_secret: str
    redirect_uri: str
    site_url: str

    @classmethod
    def from_env(cls) -> MicrosoftConfig:
        site = (os.getenv("SITE_PUBLIC_URL", SITE_DEFAULT).strip() or SITE_DEFAULT).rstrip("/")
        redirect = os.getenv("MICROSOFT_REDIRECT_URI", "").strip() or site + CALLBACK_PATH
        return cls(
            enabled=os.getenv("MICROSOFT_LINK_ENABLED", "0").strip() == "1",
            client_id=os.getenv("MICROSOFT_CLIENT_ID", "").strip(),
            client_secret=os.getenv("MICROSOFT_CLIENT_SECRET", "").strip(),
            redirect_uri=redirect,
            site_url=site,
        )

    def problems(self) -> list[str]:
        """Settings that stop the Microsoft link from working; empty when usable."""
        errors = []
        if not _GUID.fullmatch(self.client_id.lower()):
            errors.append("MICROSOFT_CLIENT_ID")
        if not self.client_secret:
            errors.append("MICROSOFT_CLIENT_SECRET")
        site = _origin(self.site_url)
        if not _callback_matches_site(self.redirect_uri, site) or not urlsplit(self.redirect_uri).path.endswith(
            CALLBACK_ROUTE
        ):
            errors.append("MICROSOFT_REDIRECT_URI")
        return errors

    @property
    def usable(self) -> bool:
        return self.enabled and not self.problems()


def new_verifier() -> str:
    return secrets.token_urlsafe(64)


def challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def authorize_url(config: MicrosoftConfig, state: str, verifier: str) -> str:
    query = urlencode([
        ("client_id", config.client_id),
        ("response_type", "code"),
        ("redirect_uri", config.redirect_uri),
        ("response_mode", "query"),
        ("scope", SCOPES),
        ("state", state),
        ("code_challenge", challenge(verifier)),
        ("code_challenge_method", "S256"),
        # Let people with several Microsoft accounts pick the one that owns Minecraft.
        ("prompt", "select_account"),
    ])
    return f"{LOGIN_BASE}/authorize?{query}"


def dashed_uuid(value: str) -> str:
    raw = value.replace("-", "").lower()
    if not _UUID_HEX.fullmatch(raw):
        raise MicrosoftError("minecraft_bad_profile")
    return f"{raw[0:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"


def _json(response: httpx.Response, code: str) -> dict:
    try:
        data = response.json()
    except ValueError:
        raise MicrosoftError(code) from None
    if not isinstance(data, dict):
        raise MicrosoftError(code)
    return data


def _text(data: dict, key: str, code: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise MicrosoftError(code)
    return value


def _uhs(data: dict, code: str) -> str:
    try:
        value = data["DisplayClaims"]["xui"][0]["uhs"]
    except (KeyError, IndexError, TypeError):
        raise MicrosoftError(code) from None
    if not isinstance(value, str) or not value:
        raise MicrosoftError(code)
    return value


class MicrosoftClient:
    def __init__(self, config: MicrosoftConfig, http: httpx.Client | None = None):
        self.config = config
        self.http = http or httpx.Client(timeout=10.0)

    def close(self) -> None:
        self.http.close()

    def _post(self, url: str, code: str, **kwargs) -> httpx.Response:
        try:
            return self.http.post(url, **kwargs)
        except httpx.HTTPError:
            raise MicrosoftError(code) from None

    def exchange_code(self, code: str, verifier: str) -> str:
        response = self._post(
            f"{LOGIN_BASE}/token",
            "microsoft_http_failed",
            data={
                "client_id": self.config.client_id,
                "client_secret": self.config.client_secret,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.config.redirect_uri,
                "code_verifier": verifier,
                "scope": SCOPES,
            },
            headers={"Accept": "application/json"},
        )
        if response.status_code != 200:
            raise MicrosoftError("microsoft_exchange_failed")
        return _text(_json(response, "microsoft_exchange_failed"), "access_token", "microsoft_exchange_failed")

    def xbox_user_token(self, access_token: str) -> tuple[str, str]:
        response = self._post(
            XBL_URL,
            "xbox_http_failed",
            json={
                "Properties": {
                    "AuthMethod": "RPS",
                    "SiteName": "user.auth.xboxlive.com",
                    # Tokens from the Microsoft identity platform take the d= prefix.
                    "RpsTicket": f"d={access_token}",
                },
                "RelyingParty": "http://auth.xboxlive.com",
                "TokenType": "JWT",
            },
            headers={"Accept": "application/json", "x-xbl-contract-version": "1"},
        )
        if response.status_code != 200:
            raise MicrosoftError("xbox_auth_failed")
        data = _json(response, "xbox_auth_failed")
        return _text(data, "Token", "xbox_auth_failed"), _uhs(data, "xbox_auth_failed")

    def xsts_token(self, user_token: str, uhs: str) -> str:
        response = self._post(
            XSTS_URL,
            "xbox_http_failed",
            json={
                "Properties": {"SandboxId": "RETAIL", "UserTokens": [user_token]},
                "RelyingParty": "rp://api.minecraftservices.com/",
                "TokenType": "JWT",
            },
            headers={"Accept": "application/json", "x-xbl-contract-version": "1"},
        )
        if response.status_code == 401:
            try:
                xerr = response.json().get("XErr")
            except (ValueError, AttributeError):
                xerr = None
            raise MicrosoftError(_XSTS_ERRORS.get(xerr, "xsts_failed"))
        if response.status_code != 200:
            raise MicrosoftError("xsts_failed")
        data = _json(response, "xsts_failed")
        # The XSTS token must belong to the same Xbox user as the user token.
        if _uhs(data, "xsts_failed") != uhs:
            raise MicrosoftError("xsts_failed")
        return _text(data, "Token", "xsts_failed")

    def minecraft_token(self, uhs: str, xsts: str) -> str:
        response = self._post(
            MC_LOGIN_URL,
            "minecraft_http_failed",
            json={"identityToken": f"XBL3.0 x={uhs};{xsts}"},
            headers={"Accept": "application/json"},
        )
        if response.status_code != 200:
            raise MicrosoftError("minecraft_login_failed")
        return _text(_json(response, "minecraft_login_failed"), "access_token", "minecraft_login_failed")

    def minecraft_profile(self, mc_token: str) -> dict:
        try:
            response = self.http.get(
                MC_PROFILE_URL,
                headers={"Authorization": f"Bearer {mc_token}", "Accept": "application/json"},
            )
        except httpx.HTTPError:
            raise MicrosoftError("minecraft_http_failed") from None
        if response.status_code == 404:
            raise MicrosoftError("no_java_profile")
        if response.status_code != 200:
            raise MicrosoftError("minecraft_profile_failed")
        data = _json(response, "minecraft_bad_profile")
        name = _text(data, "name", "minecraft_bad_profile")
        if not _MC_NAME.fullmatch(name):
            raise MicrosoftError("minecraft_bad_profile")
        return {"player_uuid": dashed_uuid(_text(data, "id", "minecraft_bad_profile")), "minecraft_name": name}

    def java_profile(self, code: str, verifier: str) -> dict:
        """Run the whole chain for one authorisation code."""
        access_token = self.exchange_code(code, verifier)
        user_token, uhs = self.xbox_user_token(access_token)
        xsts = self.xsts_token(user_token, uhs)
        return self.minecraft_profile(self.minecraft_token(uhs, xsts))
