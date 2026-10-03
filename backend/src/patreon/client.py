"""Synchronous, injectable Patreon HTTP client. Never include response bodies in errors."""
from __future__ import annotations

import json
import os
from datetime import timedelta
from urllib.parse import urljoin, urlparse

import httpx

from src.skins import db
from .config import Config
from .resolver import iso, parse, utcnow

MEMBER_PARAMS = {
    "include": "currently_entitled_tiers,user",
    "fields[member]": "patron_status,email,full_name,last_charge_status,last_charge_date,next_charge_date,currently_entitled_amount_cents,is_gifted,is_free_trial",
    "fields[user]": "social_connections,full_name",
    "fields[tier]": "title",
}


class PatreonError(RuntimeError):
    """A stable, non-sensitive failure code."""


def decode_members(document: dict, *, single: bool = False) -> list[dict]:
    try:
        data = [document["data"]] if single else document["data"]
        if not isinstance(data, list) or any(not isinstance(r, dict) for r in data):
            raise ValueError()
        included = document.get("included", [])
        if not isinstance(included, list):
            raise ValueError()
        resources = {(r["type"], str(r["id"])): r for r in included}
        result = []
        for row in data:
            if row["type"] != "member" or not isinstance(row["id"], str) or not row["id"]:
                raise ValueError()
            attrs = row["attributes"]
            if not isinstance(attrs, dict) or "patron_status" not in attrs:
                raise ValueError()
            if attrs["patron_status"] not in {None, "active_patron", "declined_patron", "former_patron"}:
                raise ValueError()
            relationships = row["relationships"]
            user_ref = relationships["user"]["data"]
            user_id = user_ref["id"]
            if user_ref["type"] != "user" or not isinstance(user_id, str) or not user_id:
                raise ValueError()
            refs = relationships["currently_entitled_tiers"]["data"]
            if not isinstance(refs, list):
                raise ValueError()
            tiers = []
            for ref in refs:
                if ref["type"] != "tier" or not isinstance(ref["id"], str) or not ref["id"]:
                    raise ValueError()
                title = resources.get(("tier", str(ref["id"])), {}).get("attributes", {}).get("title")
                tiers.append({"id": str(ref["id"]), "title": title})
            user = resources.get(("user", user_id), {}).get("attributes", {})
            social = user.get("social_connections") or {}
            discord = social.get("discord") or {}
            result.append({
                "member_id": str(row["id"]), "patreon_user_id": user_id,
                "email": attrs.get("email"), "full_name": attrs.get("full_name") or user.get("full_name"),
                "patron_status": attrs["patron_status"], "is_gifted": bool(attrs.get("is_gifted")),
                "is_free_trial": bool(attrs.get("is_free_trial")), "last_charge_status": attrs.get("last_charge_status"),
                "last_charge_date": attrs.get("last_charge_date"), "next_charge_date": attrs.get("next_charge_date"),
                "currently_entitled_amount_cents": attrs.get("currently_entitled_amount_cents"),
                "discord_user_id": str(discord["user_id"]) if discord.get("user_id") else None,
                "tiers": tiers,
            })
        return result
    except (KeyError, TypeError, ValueError, AttributeError):
        raise PatreonError("patreon_bad_document") from None


class PatreonClient:
    def __init__(self, config: Config | None = None, *, http: httpx.Client | None = None, heartbeat=None):
        self.config = config or Config.from_env()
        self.http = http or httpx.Client(timeout=30, follow_redirects=False)
        self.heartbeat = heartbeat
        self._owns_http = http is None

    def close(self):
        if self._owns_http:
            self.http.close()

    def _request(self, method: str, path: str, *, token: str | None = None, **kwargs) -> dict:
        if self.heartbeat:
            self.heartbeat()
        url = urljoin(self.config.api_base + "/", path)
        if (urlparse(url).scheme, urlparse(url).netloc) != (urlparse(self.config.api_base).scheme, urlparse(self.config.api_base).netloc):
            raise PatreonError("patreon_unsafe_pagination")
        headers = {"User-Agent": "TFMinecraft-ProvinceSystem/Patreon-v2", "Accept": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if kwargs.get("params") == {}:
            kwargs.pop("params")  # Preserve the query supplied by links.next.
        try:
            response = self.http.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError:
            raise PatreonError("patreon_http_failed") from None
        if response.status_code == 401:
            raise PatreonError("patreon_unauthorized")
        if not 200 <= response.status_code < 300:
            raise PatreonError("patreon_http_failed")
        try:
            value = response.json()
            if not isinstance(value, dict) or "errors" in value:
                raise ValueError()
            return value
        except (ValueError, TypeError):
            raise PatreonError("patreon_bad_json") from None

    def _token_exchange(self, fields: dict) -> dict:
        body = {**fields, "client_id": os.getenv("PATREON_CLIENT_ID", ""),
                "client_secret": os.getenv("PATREON_CLIENT_SECRET", "")}
        value = self._request("POST", "/api/oauth2/token", data=body)
        try:
            if not isinstance(value["access_token"], str) or not value["access_token"] or not isinstance(value["refresh_token"], str) or not value["refresh_token"] or int(value["expires_in"]) <= 0:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise PatreonError("patreon_bad_token_response") from None
        return value

    def exchange_authorization_code(self, code: str, redirect_uri: str | None = None) -> dict:
        return self._token_exchange({"grant_type": "authorization_code", "code": code,
                                    "redirect_uri": redirect_uri or os.getenv("PATREON_REDIRECT_URI", "https://www.tfminecraft.net/api/patreon/oauth/callback")})

    def identity(self, access_token: str) -> dict:
        value = self._request("GET", "/api/oauth2/v2/identity", token=access_token, params={"fields[user]": "full_name"})
        try:
            if value["data"]["type"] != "user" or not value["data"]["id"]:
                raise ValueError()
            return value["data"]
        except (KeyError, TypeError, ValueError):
            raise PatreonError("patreon_bad_identity") from None

    def _tokens(self) -> dict:
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM patreon_tokens WHERE id=1").fetchone()
            if row:
                return dict(row)
            access = os.getenv("PATREON_CREATOR_ACCESS_TOKEN", "")
            refresh = os.getenv("PATREON_CREATOR_REFRESH_TOKEN", "")
            if not access or not refresh:
                raise PatreonError("patreon_tokens_missing")
            conn.execute("INSERT OR IGNORE INTO patreon_tokens VALUES (1, ?, ?, ?)",
                         (access, refresh, iso(utcnow() + timedelta(days=1))))
            return dict(conn.execute("SELECT * FROM patreon_tokens WHERE id=1").fetchone())

    def refresh_tokens(self, rejected_access: str | None = None) -> dict:
        # Separate short lease serializes rotating refresh tokens across workers.
        from .service import acquire_lease, release_lease, alert
        owner = acquire_lease("token_refresh")
        if owner is None:
            raise PatreonError("patreon_token_refresh_busy")
        try:
            tokens = self._tokens()
            if rejected_access and tokens["access_token"] != rejected_access:
                return tokens
            value = self._token_exchange({"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"]})
            with db.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                lease = conn.execute("SELECT * FROM patreon_leases WHERE name='token_refresh'").fetchone()
                if not lease or lease["owner"] != owner or parse(lease["expires_at"]) <= utcnow():
                    raise PatreonError("patreon_token_refresh_lease_lost")
                conn.execute("UPDATE patreon_tokens SET access_token=?, refresh_token=?, expires_at=? WHERE id=1 AND access_token=? AND refresh_token=?",
                             (value["access_token"], value["refresh_token"], iso(utcnow() + timedelta(seconds=int(value["expires_in"]))), tokens["access_token"], tokens["refresh_token"]))
            return self._tokens()
        except PatreonError:
            with db.connect() as conn:
                alert(conn, "token_refresh_failed", "Creator token refresh failed.")
            raise
        finally:
            release_lease("token_refresh", owner)

    def creator_get(self, path: str, **kwargs) -> dict:
        tokens = self._tokens()
        if parse(tokens["expires_at"]) <= utcnow() + timedelta(seconds=30):
            tokens = self.refresh_tokens(tokens["access_token"])
        try:
            return self._request("GET", path, token=tokens["access_token"], **kwargs)
        except PatreonError as exc:
            if str(exc) != "patreon_unauthorized":
                raise
            tokens = self.refresh_tokens(tokens["access_token"])
            return self._request("GET", path, token=tokens["access_token"], **kwargs)

    def campaign(self) -> str:
        if self.config.campaign_id:
            return self.config.campaign_id
        value = self.creator_get("/api/oauth2/v2/campaigns", params={"include": "tiers", "fields[tier]": "title,amount_cents"})
        try:
            rows = value["data"]
            if len(rows) != 1 or rows[0]["type"] != "campaign" or not rows[0]["id"]:
                raise ValueError()
            return str(rows[0]["id"])
        except (KeyError, TypeError, ValueError):
            raise PatreonError("patreon_campaign_ambiguous") from None

    def members(self) -> list[dict]:
        campaign_id = self.campaign()
        path = f"/api/oauth2/v2/campaigns/{campaign_id}/members"
        params = {**MEMBER_PARAMS, "page[count]": "500"}
        result, seen_pages, seen_members, seen_users = [], set(), set(), set()
        total = None
        while path:
            fingerprint = (path, json.dumps(params, sort_keys=True))
            if fingerprint in seen_pages:
                raise PatreonError("patreon_pagination_loop")
            seen_pages.add(fingerprint)
            value = self.creator_get(path, params=params)
            for member in decode_members(value):
                if member["member_id"] in seen_members or member["patreon_user_id"] in seen_users:
                    raise PatreonError("patreon_duplicate_member")
                seen_members.add(member["member_id"])
                seen_users.add(member["patreon_user_id"])
                result.append(member)
            try:
                pagination = value.get("meta", {}).get("pagination", {})
                page_total = pagination.get("total")
                if page_total is not None:
                    if not isinstance(page_total, int) or page_total < 0 or (total is not None and total != page_total):
                        raise ValueError()
                    total = page_total
                next_link = value.get("links", {}).get("next")
                cursor = pagination.get("cursors", {}).get("next")
                if next_link:
                    if not isinstance(next_link, str):
                        raise ValueError()
                    path, params = urljoin(self.config.api_base + path, next_link), {}
                elif cursor:
                    path = f"/api/oauth2/v2/campaigns/{campaign_id}/members"
                    params = {**MEMBER_PARAMS, "page[count]": "500", "page[cursor]": str(cursor)}
                else:
                    path = None
            except (TypeError, AttributeError, ValueError):
                raise PatreonError("patreon_bad_pagination") from None
        if total is not None and len(result) != total:
            raise PatreonError("patreon_partial_members")
        return result

    def member(self, member_id: str) -> dict:
        value = self.creator_get(f"/api/oauth2/v2/members/{member_id}", params=MEMBER_PARAMS)
        member = decode_members(value, single=True)[0]
        if member["member_id"] != member_id:
            raise PatreonError("patreon_wrong_member")
        return member
