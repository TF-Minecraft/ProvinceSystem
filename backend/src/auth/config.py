"""Discord sign-in settings, read from the environment on each use."""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

SITE_DEFAULT = "https://www.tfminecraft.net"
REDIRECT_DEFAULT = SITE_DEFAULT + "/api/auth/discord/callback"
API_BASE_DEFAULT = "https://discord.com/api/v10"
SNOWFLAKE_MAX_LEN = 20


def _origin(url: str) -> str | None:
    parts = urlsplit(url)
    if parts.scheme not in {"https", "http"} or not parts.hostname or parts.username or parts.password:
        return None
    return f"{parts.scheme}://{parts.netloc}"


@dataclass(frozen=True)
class AuthConfig:
    enabled: bool
    client_id: str
    client_secret: str
    redirect_uri: str
    guild_id: str
    site_url: str
    api_base: str

    @classmethod
    def from_env(cls) -> AuthConfig:
        site = (os.getenv("SITE_PUBLIC_URL", SITE_DEFAULT).strip() or SITE_DEFAULT).rstrip("/")
        if _origin(site) is None:
            site = SITE_DEFAULT
        return cls(
            enabled=os.getenv("DISCORD_AUTH_ENABLED", "0").strip() == "1",
            client_id=os.getenv("DISCORD_CLIENT_ID", "").strip(),
            client_secret=os.getenv("DISCORD_CLIENT_SECRET", "").strip(),
            redirect_uri=os.getenv("DISCORD_REDIRECT_URI", REDIRECT_DEFAULT).strip() or REDIRECT_DEFAULT,
            guild_id=os.getenv("DISCORD_GUILD_ID", "").strip(),
            site_url=site,
            api_base=(os.getenv("DISCORD_API_BASE", API_BASE_DEFAULT).strip() or API_BASE_DEFAULT).rstrip("/"),
        )

    @property
    def site_origin(self) -> str:
        return _origin(self.site_url) or SITE_DEFAULT

    @property
    def secure_cookies(self) -> bool:
        """Plain-HTTP local sites cannot hold Secure or __Host- cookies."""
        return self.site_origin.startswith("https://")

    def problems(self) -> list[str]:
        """Settings that stop sign-in from working; empty when usable."""
        errors = []
        if not self.client_id or any(ch.isspace() for ch in self.client_id):
            errors.append("DISCORD_CLIENT_ID")
        if not self.client_secret:
            errors.append("DISCORD_CLIENT_SECRET")
        if not self.guild_id.isdigit() or len(self.guild_id) > SNOWFLAKE_MAX_LEN:
            errors.append("DISCORD_GUILD_ID")
        if _origin(self.redirect_uri) is None:
            errors.append("DISCORD_REDIRECT_URI")
        return errors
