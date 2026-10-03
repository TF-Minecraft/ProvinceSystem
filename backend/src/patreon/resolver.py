"""Pure entitlement rules; callers supply stored history and resolved identities."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .config import Config


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def parse(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def entitled_tier(member: dict | None, config: Config) -> str | None:
    if not member:
        return None
    refs = member.get("tiers", [])
    mapped = [t for t in config.tiers if any(
        str(r.get("id")) == t.patreon_id or r.get("title") == t.patreon_title for r in refs
    )]
    return max(mapped, key=lambda t: t.rank).key if mapped else None


def resolve(member: dict | None, link: dict | None, now: datetime, config: Config) -> dict:
    """Return effective tier, next history, grace and desired targets without I/O.

    link may carry resolved_discord_user_id/resolved_player_uuid, supplied by
    the storage layer from discord_links. Neither input is modified.
    """
    member = member or {}
    tier = entitled_tier(member, config)
    last = member.get("last_tier")
    declined = member.get("declined_since")
    grace_until = None
    if tier:
        last, declined = tier, None
    elif member.get("patron_status") == "declined_patron" and last:
        declined = declined or iso(now)
        grace_until = iso(parse(declined) + timedelta(days=config.grace_days))
        if now < parse(grace_until):
            tier = last
    else:
        last, declined = None, None
    targets = {}
    if link and link.get("active", True):
        discord = link.get("discord_user_id") or link.get("resolved_discord_user_id")
        uuid = link.get("player_uuid") or link.get("resolved_player_uuid")
        if discord:
            targets["discord"] = (discord, tier)
        if uuid:
            targets["luckperms"] = (uuid, tier)
    return {"tier_key": tier, "last_tier": last, "declined_since": declined,
            "grace_until": grace_until, "targets": targets}
