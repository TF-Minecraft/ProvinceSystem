"""Transactional storage, sync and outboxes.

Public handoff: create_or_update_link, refresh_member, recompute_link and
PatreonClient (client.py). All accept injected configuration/client for tests.

Every transaction that runs `_compute` or `_plan`, or otherwise reads and
rewrites links, desired state or the outboxes, opens with the `patreon`
advisory lock (PATREON_LOCK). A function that takes a caller's `conn` expects
the caller to hold it. Nothing calls Patreon while a transaction is open.

Times are timestamptz. Rows are read through `_text_times`, so the rules keep
comparing and sending the `isoformat()` strings they always stored.
"""
from __future__ import annotations

import asyncio
import logging
import uuid as uuidlib
from datetime import datetime, timedelta

from src import database
from src.skins import db as sqlite_db
from .config import Config
from .resolver import entitled_tier, iso, parse, resolve, utcnow

logger = logging.getLogger("patreon")
LEASE_SECONDS = 180
# Serialises everything that reads and rewrites the Patreon tables as a whole.
PATREON_LOCK = "patreon"


class ServiceError(ValueError):
    pass


def acquire_lease(name: str = "sync") -> str | None:
    """Take the lease if it is free or expired; the new owner, or None while another holds it."""
    owner = uuidlib.uuid4().hex
    with database.connect() as conn:
        # Seed or lock the named row before reading the clock. The no-op conflict
        # update also covers a concurrent release deleting it; no expired seed
        # escapes this transaction. A waiting first acquisition gets its full TTL.
        conn.execute(
            "INSERT INTO patreon_leases (name, owner, expires_at) VALUES (%s, '', '1970-01-01T00:00:00Z') "
            "ON CONFLICT (name) DO UPDATE SET name = excluded.name", (name,))
        now = utcnow()
        # One upsert takes a free or expired lease, or leaves another holder's alone (no row back).
        row = conn.execute(
            "INSERT INTO patreon_leases (name, owner, expires_at) VALUES (%s, %s, %s) "
            "ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at "
            "WHERE patreon_leases.expires_at <= %s RETURNING owner",
            (name, owner, now + timedelta(seconds=LEASE_SECONDS), now)).fetchone()
    return owner if row is not None and row["owner"] == owner else None


def renew_lease(name: str, owner: str):
    with database.connect() as conn:
        conn.execute("LOCK TABLE patreon_leases IN ROW EXCLUSIVE MODE")
        conn.execute("SELECT name FROM patreon_leases WHERE name = %s FOR UPDATE", (name,))
        now = utcnow()
        cur = conn.execute("UPDATE patreon_leases SET expires_at = %s WHERE name = %s AND owner = %s AND expires_at > %s",
                           (now + timedelta(seconds=LEASE_SECONDS), name, owner, now))
        if cur.rowcount != 1:
            raise ServiceError("patreon_lease_lost")


def release_lease(name: str, owner: str):
    with database.connect() as conn:
        conn.execute("DELETE FROM patreon_leases WHERE name = %s AND owner = %s", (name, owner))


def alert(conn, kind: str, message: str):
    # Messages are fixed strings, never exception text / API bodies / identities.
    # One open alert per kind, kept by the partial unique index even outside the patreon lock.
    conn.execute("INSERT INTO patreon_alerts (kind, message, created_at) VALUES (%s, %s, %s) "
                 "ON CONFLICT (kind) WHERE acked_at IS NULL DO NOTHING", (kind, message, utcnow()))


def _text_times(row) -> dict | None:
    """A row with each time as the `isoformat()` string the rules compare and the API sends."""
    if row is None:
        return None
    return {key: iso(value) if isinstance(value, datetime) else value for key, value in row.items()}


def _member(row) -> dict | None:
    if row is None:
        return None
    return {**row["data_json"], "last_tier": row["last_tier"],
            "declined_since": iso(row["declined_since"]) if row["declined_since"] else None}


def _members(conn) -> dict[str, dict]:
    # A fixed order: Postgres returns rows in storage order, which every sync's updates reshuffle.
    return {row["patreon_user_id"]: _member(row) for row in conn.execute("SELECT * FROM patreon_members ORDER BY patreon_user_id")}


def _discord_links(*, discord_user_id=None, player_uuid=None, minecraft_name=None) -> list[dict]:
    """Discord links matching any of the given values: their discord_user_id and player_uuid."""
    # PG-MIGRATION: Linking. discord_links is still in SQLite, so it is read on its own
    # connection (Linking does not take the patreon lock). The Linking
    # PR reads it on the caller's connection.
    where, params = [], []
    for column, value in (("discord_user_id", discord_user_id), ("player_uuid", player_uuid)):
        if value is not None:
            where.append(f"{column} = ?")
            params.append(value)
    if minecraft_name is not None:
        where.append("minecraft_name = ? COLLATE NOCASE")
        params.append(minecraft_name)
    if not where:
        return []
    with sqlite_db.connect() as lite:
        return [dict(r) for r in lite.execute(
            f"SELECT discord_user_id, player_uuid FROM discord_links WHERE {' OR '.join(where)}", params)]


def _resolved_link(conn, row) -> dict:
    link = _text_times(row)
    if not link["active"]:
        return link
    discord, uuid = link["discord_user_id"], link["player_uuid"]
    other = None
    if discord and not uuid:
        other = next(iter(_discord_links(discord_user_id=discord)), None)
    elif uuid and not discord:
        other = next(iter(_discord_links(player_uuid=uuid)), None)
    if other:
        for key in ("discord_user_id", "player_uuid"):
            if not link[key]:
                # An implicit half must not give two patrons control of a subject.
                occupied = conn.execute(f"SELECT 1 FROM patreon_links WHERE {key} = %s AND active AND patreon_user_id <> %s", (other[key], link["patreon_user_id"])).fetchone()
                if not occupied:
                    link["resolved_" + key] = other[key]
    return link


def _clean_subjects(discord_user_id, player_uuid):
    discord = str(discord_user_id).strip() if discord_user_id is not None else None
    player = str(player_uuid).strip() if player_uuid is not None else None
    if player:
        try:
            player = str(uuidlib.UUID(player))
        except ValueError:
            raise ServiceError("invalid_player_uuid") from None
    return discord or None, player or None


def _link(conn, user_id: str, discord: str | None, player: str | None, method: str, force: bool, config: Config, now) -> str:
    if not user_id or not (discord or player):
        return "invalid_subject"
    if "\x00" in user_id or (discord and "\x00" in discord):
        return "invalid_subject"  # Postgres text cannot hold NUL
    old = _text_times(conn.execute("SELECT * FROM patreon_links WHERE patreon_user_id = %s", (user_id,)).fetchone())
    # Validate the trusted pairing but leave an unspecified half dynamic.
    pair = _discord_links(discord_user_id=discord, player_uuid=player)
    if pair:
        if len(pair) != 1 or (discord and pair[0]["discord_user_id"] != discord) or (player and pair[0]["player_uuid"] != player):
            return "already_linked"
    changing = bool(old and ((discord and old["discord_user_id"] and discord != old["discord_user_id"]) or (player and old["player_uuid"] and player != old["player_uuid"])))
    if changing and not force and now < parse(old["person_changed_at"]) + timedelta(days=config.cooldown_days):
        return "relink_cooldown"
    if old and not changing:
        discord = discord or old["discord_user_id"]
        player = player or old["player_uuid"]
    effective_discord = discord or (pair[0]["discord_user_id"] if pair else None)
    effective_player = player or (pair[0]["player_uuid"] if pair else None)
    conflict = conn.execute("SELECT 1 FROM patreon_links WHERE active AND patreon_user_id <> %s AND (discord_user_id = %s OR player_uuid = %s)", (user_id, effective_discord, effective_player)).fetchone()
    if conflict:
        return "already_linked"
    changed_at = iso(now) if not old or changing else old["person_changed_at"]
    # Sync must not replace an OAuth/staff/import method with auto_discord.
    saved_method = old["method"] if old and old["active"] and method == "auto_discord" else method
    new_event = not old or not old["active"] or changing or old["method"] != saved_method or old["discord_user_id"] != discord or old["player_uuid"] != player
    linked_at = iso(now) if new_event else old["linked_at"]
    conn.execute("INSERT INTO patreon_links (patreon_user_id, discord_user_id, player_uuid, method, active, linked_at, person_changed_at) "
                 "VALUES (%s, %s, %s, %s, true, %s, %s) ON CONFLICT (patreon_user_id) DO UPDATE SET discord_user_id = excluded.discord_user_id, "
                 "player_uuid = excluded.player_uuid, method = excluded.method, active = true, linked_at = excluded.linked_at, "
                 "person_changed_at = excluded.person_changed_at",
                 (user_id, discord, player, saved_method, linked_at, changed_at))
    return "ok"


def create_or_update_link(patreon_user_id: str, discord_user_id: str | None = None, player_uuid: str | None = None, method: str = "oauth", *, force: bool = False, config: Config | None = None, conn=None, now=None) -> str:
    """Return ok/already_linked/relink_cooldown/invalid_subject; no implicit compute.

    Optional conn participates in a caller transaction (no commit), which must hold
    PATREON_LOCK. force only bypasses cooldown, never another account's subject uniqueness.
    """
    config = config or Config.from_env()
    if method not in {"oauth", "staff", "import", "auto_discord"}:
        raise ServiceError("invalid_link_method")
    discord, player = _clean_subjects(discord_user_id, player_uuid)
    if conn is not None:
        return _link(conn, str(patreon_user_id), discord, player, method, force, config, now or utcnow())
    with database.transaction(lock=PATREON_LOCK) as c:
        return _link(c, str(patreon_user_id), discord, player, method, force, config, now or utcnow())


def _store_member(conn, member: dict, now, config: Config):
    old = conn.execute("SELECT * FROM patreon_members WHERE patreon_user_id = %s", (member["patreon_user_id"],)).fetchone()
    history = _member(old) or {}
    state = resolve({**member, "last_tier": history.get("last_tier"), "declined_since": history.get("declined_since")}, None, now, config)
    conn.execute("INSERT INTO patreon_members (member_id, patreon_user_id, data_json, last_tier, declined_since, updated_at) "
                 "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (patreon_user_id) DO UPDATE SET member_id = excluded.member_id, "
                 "data_json = excluded.data_json, last_tier = excluded.last_tier, declined_since = excluded.declined_since, "
                 "updated_at = excluded.updated_at",
                 (member["member_id"], member["patreon_user_id"], database.Jsonb(member), state["last_tier"], state["declined_since"], now))


def _set_desired(conn, target, subject, tier, grace, *, link_event=None):
    old = _text_times(conn.execute("SELECT * FROM patreon_desired WHERE target = %s AND subject = %s", (target, subject)).fetchone())
    old_tier = old["tier_key"] if old else None
    old_grace = old["grace_until"] if old else None
    new_link_event = bool(target == "discord" and link_event and (not old or old["link_event"] != link_event))
    if old and old_tier == tier and old_grace == grace and not new_link_event:
        return
    dm = None
    if target == "discord":
        if tier and grace and grace != old_grace:
            dm = "payment_declined"
        elif tier != old_tier:
            dm = "tier_changed" if tier and old_tier else "tier_granted" if tier else "perks_ended"
        if new_link_event and not grace:
            dm = "link_success"
    generation = old["generation"] + 1 if old else 1
    saved_event = link_event or (old["link_event"] if old else None)
    conn.execute("INSERT INTO patreon_desired (target, subject, tier_key, grace_until, dm, generation, link_event) "
                 "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (target, subject) DO UPDATE SET tier_key = excluded.tier_key, "
                 "grace_until = excluded.grace_until, dm = excluded.dm, generation = excluded.generation, link_event = excluded.link_event",
                 (target, subject, tier, grace, dm, generation, saved_event))


def _plan(conn, target: str, subject: str, config: Config, now):
    desired = _text_times(conn.execute("SELECT * FROM patreon_desired WHERE target = %s AND subject = %s", (target, subject)).fetchone())
    if desired is None:
        return
    applied = conn.execute("SELECT * FROM patreon_applied WHERE target = %s AND subject = %s", (target, subject)).fetchone()
    owned = set(applied["tiers_json"]) if applied else set()
    tier = desired["tier_key"]
    remove = sorted(owned - ({tier} if tier else set()), key=config.rank)
    add = tier if tier and tier not in owned else None
    dm = desired["dm"] if not applied or applied["dm_generation"] < desired["generation"] else None
    held = conn.execute("SELECT brake_held FROM patreon_sync_state WHERE id = 1").fetchone()["brake_held"]
    if held:
        remove = []
        if config.rank(tier) < max((config.rank(k) for k in owned), default=0):
            dm = None
    # Decline is notification-only; granting grace to an as-yet-unapplied
    # subject is a separate row after this notification is acknowledged.
    if dm == "payment_declined":
        add, remove = None, []
    if not config.apply:
        logged_dm = None if config.suppress_dms and target == "discord" else dm
        if add or remove or dm:
            logger.warning("Patreon shadow target=%s add=%s remove=%s dm=%s", target, add, remove, logged_dm)
        return
    # Dispatched rows are immutable: their ids may be in an applier's hands.
    dispatched = conn.execute("SELECT 1 FROM patreon_changes WHERE target = %s AND subject = %s AND acked_at IS NULL AND cancelled_at IS NULL AND dispatched_at IS NOT NULL", (target, subject)).fetchone()
    if dispatched:
        return
    pending = conn.execute("SELECT * FROM patreon_changes WHERE target = %s AND subject = %s AND acked_at IS NULL AND cancelled_at IS NULL", (target, subject)).fetchone()
    if pending and pending["add_tier"] == add and pending["remove_json"] == remove and pending["dm"] == dm and pending["generation"] == desired["generation"]:
        return
    conn.execute("UPDATE patreon_changes SET cancelled_at = %s WHERE target = %s AND subject = %s AND acked_at IS NULL AND cancelled_at IS NULL", (now, target, subject))
    if add or remove or dm:
        # Keep the real dm on the row so acknowledgement marks it delivered.
        # dm_suppressed hides it from the outbox even after the env flag is cleared.
        suppressed = bool(config.suppress_dms and target == "discord" and dm)
        conn.execute("INSERT INTO patreon_changes (target, subject, add_tier, remove_json, dm, grace_until, generation, created_at, dm_suppressed) "
                     "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                     (target, subject, add, database.Jsonb(remove), dm, desired["grace_until"] if dm == "payment_declined" else None, desired["generation"], now, suppressed))


def _compute(conn, config: Config, now, *, brake_check=False, link_success_user=None):
    members = _members(conn)
    targets = {}
    for row in conn.execute("SELECT * FROM patreon_links WHERE active").fetchall():
        link = _resolved_link(conn, row)
        state = resolve(members.get(link["patreon_user_id"]), link, now, config)
        for target, (subject, tier) in state["targets"].items():
            identity = (target, subject)
            if identity in targets:
                raise ServiceError("patreon_subject_conflict")
            event = link["patreon_user_id"] + ":" + link["linked_at"] if link["patreon_user_id"] == link_success_user else None
            targets[identity] = (tier, state["grace_until"], event)
    known = {(r["target"], r["subject"]) for r in conn.execute("SELECT target,subject FROM patreon_desired UNION SELECT target,subject FROM patreon_applied")}
    for target, subject in known | targets.keys():
        tier, grace, event = targets.get((target, subject), (None, None, None))
        _set_desired(conn, target, subject, tier, grace, link_event=event)
    if brake_check:
        granted = lowered = 0
        for row in conn.execute("SELECT a.tiers_json,d.tier_key,d.generation,p.generation AS approved_generation FROM patreon_applied a LEFT JOIN patreon_desired d ON d.target=a.target AND d.subject=a.subject LEFT JOIN patreon_brake_approvals p ON p.target=a.target AND p.subject=a.subject"):
            rank = max((config.rank(k) for k in row["tiers_json"]), default=0)
            if rank:
                granted += 1
                lowered += config.rank(row["tier_key"]) < rank and row["generation"] != row["approved_generation"]
        if lowered >= 5 and granted and lowered / granted > config.removal_fraction:
            conn.execute("UPDATE patreon_sync_state SET brake_held = true WHERE id = 1")
            # Previously dispatched removals cannot be recalled; poll suppresses
            # new removal deliveries. Their ack remains truthful if in flight.
            alert(conn, "brake_held", "Mass removal brake held tier reductions; staff review required.")
    # In key order, as SQLite's primary-key scan gave them, so outbox ids come out in the same order.
    for row in conn.execute("SELECT target, subject FROM patreon_desired ORDER BY target, subject").fetchall():
        _plan(conn, row["target"], row["subject"], config, now)


def recompute_link(patreon_user_id: str, *, config: Config | None = None, conn=None, link_success: bool = False) -> dict:
    """Recompute links and enqueue differences, including a changed/missing half.

    Recomputing the full identity set also clears former subjects on relink.
    Returns this user's effective entitlement. Optional conn shares transaction,
    which must hold PATREON_LOCK.
    """
    config = config or Config.from_env()
    def compute(c):
        _compute(c, config, utcnow(), link_success_user=patreon_user_id if link_success else None)
        return _status(c, config, patreon_user_id=patreon_user_id)
    if conn is not None:
        return compute(conn)
    with database.transaction(lock=PATREON_LOCK) as c:
        return compute(c)


def unlink(*, patreon_user_id=None, discord_user_id=None, player_uuid=None, config=None) -> dict:
    config = config or Config.from_env()
    discord_user_id, player_uuid = _clean_subjects(discord_user_id, player_uuid)
    with database.transaction(lock=PATREON_LOCK) as conn:
        row = _find_link(conn, patreon_user_id, discord_user_id, player_uuid)
        if not row:
            return {"unlinked": False}
        conn.execute("UPDATE patreon_links SET active = false WHERE patreon_user_id = %s", (row["patreon_user_id"],))
        _compute(conn, config, utcnow())
        return {"unlinked": True}


def _find_link(conn, patreon_user_id=None, discord_user_id=None, player_uuid=None):
    if patreon_user_id:
        if "\x00" in patreon_user_id:
            return None
        return _text_times(conn.execute("SELECT * FROM patreon_links WHERE active AND patreon_user_id = %s", (patreon_user_id,)).fetchone())
    for row in conn.execute("SELECT * FROM patreon_links WHERE active").fetchall():
        link = _resolved_link(conn, row)
        if (discord_user_id and discord_user_id == (link["discord_user_id"] or link.get("resolved_discord_user_id"))) or (player_uuid and player_uuid == (link["player_uuid"] or link.get("resolved_player_uuid"))):
            return _text_times(row)
    return None


def _status(conn, config, patreon_user_id=None, discord_user_id=None, player_uuid=None) -> dict:
    row = _find_link(conn, patreon_user_id, discord_user_id, player_uuid)
    result = {"linked": False, "method": None, "patreon_name": None, "tier_key": None, "tier_name": None,
              "patron_status": None, "is_gifted": False, "grace_until": None, "has_discord": False, "has_minecraft": False}
    if not row:
        return result
    link = _resolved_link(conn, row)
    member = _member(conn.execute("SELECT * FROM patreon_members WHERE patreon_user_id = %s", (row["patreon_user_id"],)).fetchone()) or {}
    state = resolve(member, link, utcnow(), config)
    return {**result, "linked": True, "method": link["method"], "patreon_name": member.get("full_name"),
            "tier_key": state["tier_key"], "tier_name": config.name(state["tier_key"]),
            "patron_status": member.get("patron_status"), "is_gifted": member.get("is_gifted", False),
            "grace_until": state["grace_until"], "has_discord": "discord" in state["targets"], "has_minecraft": "luckperms" in state["targets"]}


def status(*, discord_user_id=None, player_uuid=None, config=None):
    discord, player = _clean_subjects(discord_user_id, player_uuid)
    with database.connect() as conn:
        return _status(conn, config or Config.from_env(), discord_user_id=discord, player_uuid=player)


def _sync_failure():
    with database.connect() as conn:
        # The UPDATE row-locks the counter until commit, so two failures count twice.
        failures = conn.execute(
            "UPDATE patreon_sync_state SET last_sync_at = %s, last_sync_ok = false, "
            "consecutive_failures = consecutive_failures + 1 WHERE id = 1 RETURNING consecutive_failures",
            (utcnow(),)).fetchone()["consecutive_failures"]
        if failures >= 3:
            alert(conn, "sync_failed", "Patreon sync failed three or more consecutive times; existing perks retained.")


def _run_fetch(*, config, client, member_id=None):
    from .client import PatreonClient
    owner = acquire_lease()
    if owner is None:
        return {"ok": False, "detail": "patreon_sync_busy"}
    own_client = client is None
    client = client or PatreonClient(config)
    old_heartbeat = getattr(client, "heartbeat", None)
    def heartbeat():
        renew_lease("sync", owner)
        if old_heartbeat:
            old_heartbeat()
    client.heartbeat = heartbeat
    try:
        # Fetch and validate everything before opening the write transaction.
        fetched = [client.member(member_id)] if member_id else client.members()
        with database.transaction(lock=PATREON_LOCK) as conn:
            # Held until commit: the lease cannot be taken over while these members are stored.
            lease = conn.execute("SELECT owner, expires_at FROM patreon_leases WHERE name = 'sync' FOR UPDATE").fetchone()
            now = utcnow()
            if not lease or lease["owner"] != owner or lease["expires_at"] <= now:
                raise ServiceError("patreon_lease_lost")
            for member in fetched:
                _store_member(conn, member, now, config)
            if not member_id:
                present = {m["patreon_user_id"] for m in fetched}
                for member in _members(conn).values():
                    if member["patreon_user_id"] not in present:
                        _store_member(conn, {**member, "tiers": [], "patron_status": "former_patron"}, now, config)
            for member in fetched:
                if entitled_tier(member, config) and member.get("discord_user_id"):
                    # A tombstone (explicit unlink) must stay disconnected.
                    # Auto-link only when no link row exists at all.
                    existing = conn.execute("SELECT 1 FROM patreon_links WHERE patreon_user_id = %s", (member["patreon_user_id"],)).fetchone()
                    if existing is None:
                        _link(conn, member["patreon_user_id"], member["discord_user_id"], None, "auto_discord", False, config, now)
            _compute(conn, config, now, brake_check=True)
            if not member_id:
                conn.execute("UPDATE patreon_sync_state SET last_sync_at = %s, last_sync_ok = true, consecutive_failures = 0 WHERE id = 1", (now,))
            # Member, link, outbox and sync-state writes may all wait. The held
            # lease row cannot change owner; its deadline must still be live.
            if lease["owner"] != owner or lease["expires_at"] <= utcnow():
                raise ServiceError("patreon_lease_lost")
        return {"ok": True, "members": len(fetched), "brake_held": health(config)["brake_held"]}
    except Exception:
        # No raw exception strings: HTTP bodies and parse failures may contain PII.
        _sync_failure()
        logger.warning("Patreon sync failed; stored entitlements retained")
        return {"ok": False, "detail": "patreon_sync_failed"}
    finally:
        client.heartbeat = old_heartbeat
        if own_client:
            client.close()
        release_lease("sync", owner)


def sync_now(*, config=None, client=None):
    config = config or Config.from_env()
    if not config.enabled:
        return {"ok": False, "detail": "patreon_disabled"}
    return _run_fetch(config=config, client=client)


def refresh_member(member_id: str, *, config=None, client=None):
    """Fetch one complete member and atomically store/recompute (webhook handoff)."""
    config = config or Config.from_env()
    if not config.enabled:
        return {"ok": False, "detail": "patreon_disabled"}
    return _run_fetch(config=config, client=client, member_id=member_id)


async def sync_loop(stop: asyncio.Event | None = None):
    """Keep one loop leader across sleeps; full syncs and webhook refreshes
    share a second lease. Shutdown finishes the current atomic sync.
    """
    from .client import PatreonClient
    from .linking import retry_pending_webhooks
    stop = stop or asyncio.Event()
    owner = None
    async def pause(seconds):
        remaining = seconds
        while remaining > 0 and not stop.is_set():
            step = min(60, remaining)
            try:
                await asyncio.wait_for(stop.wait(), timeout=step)
            except asyncio.TimeoutError:
                pass
            remaining -= step
            if owner:
                await asyncio.to_thread(renew_lease, "sync_loop", owner)
    try:
        while not stop.is_set():
            config = Config.from_env()
            if not config.enabled:
                return
            if owner is None:
                owner = await asyncio.to_thread(acquire_lease, "sync_loop")
            if owner is None:
                await pause(60)
                continue
            client = PatreonClient(config, heartbeat=lambda: renew_lease("sync_loop", owner))
            try:
                await asyncio.to_thread(retry_pending_webhooks, config=config, client=client)
                await asyncio.to_thread(sync_now, config=config, client=client)
            finally:
                client.close()
            await pause(config.sync_interval)
    except ServiceError:
        logger.warning("Patreon loop lease lost; stopping this worker's loop")
    finally:
        if owner:
            await asyncio.to_thread(release_lease, "sync_loop", owner)


def list_changes(target: str, *, config=None) -> dict:
    config = config or Config.from_env()
    if not config.apply:
        return {"changes": []}
    with database.transaction(lock=PATREON_LOCK) as conn:
        held = conn.execute("SELECT brake_held FROM patreon_sync_state WHERE id = 1").fetchone()["brake_held"]
        rows = conn.execute("SELECT * FROM patreon_changes WHERE target = %s AND acked_at IS NULL AND cancelled_at IS NULL ORDER BY id", (target,)).fetchall()
        changes = []
        for row in rows:
            if held and row["remove_json"]:
                continue
            conn.execute("UPDATE patreon_changes SET dispatched_at = COALESCE(dispatched_at, %s) WHERE id = %s", (utcnow(), row["id"]))
            change = {"id": row["id"], "discord_user_id" if target == "discord" else "player_uuid": row["subject"], "add_tier": row["add_tier"], "remove_tiers": row["remove_json"]}
            if target == "discord":
                hidden = config.suppress_dms or row["dm_suppressed"]
                change.update(dm=None if hidden else row["dm"], tier_name=config.name(row["add_tier"]))
                if row["grace_until"]:
                    change["grace_until"] = iso(row["grace_until"])
            changes.append(change)
        return {"changes": changes}


def ack_changes(target: str, ids: list[int], *, config=None) -> dict:
    config = config or Config.from_env()
    acked = []
    if not config.apply:
        return {"acked": acked}
    with database.transaction(lock=PATREON_LOCK) as conn:
        for change_id in dict.fromkeys(ids):
            row = conn.execute("SELECT * FROM patreon_changes WHERE id = %s AND target = %s AND cancelled_at IS NULL", (change_id, target)).fetchone()
            if row is None or row["dispatched_at"] is None:
                continue
            acked.append(change_id)
            if row["acked_at"]:
                continue
            applied = conn.execute("SELECT * FROM patreon_applied WHERE target = %s AND subject = %s", (target, row["subject"])).fetchone()
            tiers = set(applied["tiers_json"]) if applied else set()
            tiers.difference_update(row["remove_json"])
            if row["add_tier"]:
                tiers.add(row["add_tier"])
            dm_gen = applied["dm_generation"] if applied else 0
            if row["dm"]:
                dm_gen = max(dm_gen, row["generation"])
            ever = bool(tiers or (applied and applied["ever_granted"]))
            conn.execute("INSERT INTO patreon_applied (target, subject, tiers_json, ever_granted, dm_generation) VALUES (%s, %s, %s, %s, %s) "
                         "ON CONFLICT (target, subject) DO UPDATE SET tiers_json = excluded.tiers_json, ever_granted = excluded.ever_granted, "
                         "dm_generation = excluded.dm_generation",
                         (target, row["subject"], database.Jsonb(sorted(tiers)), ever, dm_gen))
            conn.execute("UPDATE patreon_changes SET acked_at = %s WHERE id = %s", (utcnow(), change_id))
            _plan(conn, target, row["subject"], config, utcnow())
    return {"acked": acked}


def roster(target: str, *, config=None) -> dict:
    config = config or Config.from_env()
    with database.transaction(isolation="repeatable read", read_only=True) as conn:
        held = conn.execute("SELECT brake_held FROM patreon_sync_state WHERE id = 1").fetchone()["brake_held"]
        members = []
        for row in conn.execute("SELECT a.subject, a.tiers_json, d.tier_key FROM patreon_applied a LEFT JOIN patreon_desired d ON d.target=a.target AND d.subject=a.subject WHERE a.target = %s AND a.ever_granted ORDER BY a.subject", (target,)):
            tier = row["tier_key"]
            owned = list(row["tiers_json"])
            if not config.apply or held:
                tier = max(owned + ([tier] if tier and config.apply else []), key=config.rank, default=None)
            members.append({"discord_user_id" if target == "discord" else "player_uuid": row["subject"], "tier_key": tier})
        return {"tier_keys": [t.key for t in config.tiers], "members": members}


def release_brake(*, config=None):
    config = config or Config.from_env()
    with database.transaction(lock=PATREON_LOCK) as conn:
        conn.execute("UPDATE patreon_sync_state SET brake_held = false WHERE id = 1")
        _compute(conn, config, utcnow())
        # Persist approval for these transitions, even if appliers haven't
        # acknowledged them before the next sync or process restart.
        for row in conn.execute("SELECT a.target,a.subject,a.tiers_json,d.tier_key,d.generation FROM patreon_applied a JOIN patreon_desired d ON d.target=a.target AND d.subject=a.subject").fetchall():
            if config.rank(row["tier_key"]) < max((config.rank(k) for k in row["tiers_json"]), default=0):
                conn.execute("INSERT INTO patreon_brake_approvals (target, subject, generation) VALUES (%s, %s, %s) "
                             "ON CONFLICT (target, subject) DO UPDATE SET generation = excluded.generation", (row["target"], row["subject"], row["generation"]))
    return {"released": True}


def health(config=None):
    config = config or Config.from_env()
    with database.transaction(isolation="repeatable read", read_only=True) as conn:
        state = _text_times(conn.execute("SELECT * FROM patreon_sync_state WHERE id = 1").fetchone())
        members = _members(conn)
        linked = {r["patreon_user_id"] for r in conn.execute("SELECT patreon_user_id FROM patreon_links WHERE active")}
        entitled = {user for user, member in members.items() if resolve(member, None, utcnow(), config)["tier_key"]}
        return {"enabled": config.enabled, "apply": config.apply, "last_sync_at": state["last_sync_at"], "last_sync_ok": None if state["last_sync_ok"] is None else bool(state["last_sync_ok"]),
                "consecutive_failures": state["consecutive_failures"], "brake_held": bool(state["brake_held"]),
                "members": len(members), "links": len(linked), "entitled_linked": len(entitled & linked), "entitled_unlinked": len(entitled - linked)}


def alerts():
    with database.connect() as conn:
        return {"alerts": [_text_times(r) for r in conn.execute("SELECT id,kind,message,created_at FROM patreon_alerts WHERE acked_at IS NULL ORDER BY id")]}


def ack_alerts(ids):
    with database.connect() as conn:
        for alert_id in ids:
            conn.execute("UPDATE patreon_alerts SET acked_at = %s WHERE id = %s AND acked_at IS NULL", (utcnow(), alert_id))
    return {"acked": ids}


def unlinked(config=None):
    config = config or Config.from_env()
    with database.transaction(isolation="repeatable read", read_only=True) as conn:
        linked = {r["patreon_user_id"] for r in conn.execute("SELECT patreon_user_id FROM patreon_links WHERE active")}
        result = []
        for user, member in _members(conn).items():
            tier = resolve(member, None, utcnow(), config)["tier_key"]
            if user not in linked and tier:
                result.append({"full_name": member.get("full_name"), "email": member.get("email"), "tier_key": tier})
        return {"members": result}


def lookup(*, discord_user_id=None, player_uuid=None, email=None, minecraft_name=None, config=None):
    config = config or Config.from_env()
    discord, player = _clean_subjects(discord_user_id, player_uuid)
    with database.transaction(isolation="repeatable read", read_only=True) as conn:
        if minecraft_name:
            pair = next(iter(_discord_links(minecraft_name=minecraft_name)), None)
            player = pair["player_uuid"] if pair else None
        link = _find_link(conn, discord_user_id=discord, player_uuid=player)
        member = None
        if email:
            matches = [m for m in _members(conn).values() if str(m.get("email") or "").casefold() == email.strip().casefold()]
            if len(matches) > 1:
                raise ServiceError("ambiguous_patreon_email")
            member = matches[0] if matches else None
            link = _find_link(conn, patreon_user_id=member["patreon_user_id"]) if member else None
        elif link:
            member = _member(conn.execute("SELECT * FROM patreon_members WHERE patreon_user_id = %s", (link["patreon_user_id"],)).fetchone())
        # active stays 0/1 in the reply, as it was.
        return {"found": bool(member or link), "member": member, "link": {**link, "active": int(link["active"])} if link else None, "tier_key": resolve(member, None, utcnow(), config)["tier_key"]}


def staff_link(*, patreon_email=None, patreon_user_id=None, discord_user_id=None, player_uuid=None, force=False, config=None):
    config = config or Config.from_env()
    discord, player = _clean_subjects(discord_user_id, player_uuid)
    with database.transaction(lock=PATREON_LOCK) as conn:
        if patreon_email:
            matches = [m for m in _members(conn).values() if str(m.get("email") or "").casefold() == patreon_email.strip().casefold()]
            if len(matches) != 1:
                raise ServiceError("patreon_member_not_found" if not matches else "ambiguous_patreon_email")
            patreon_user_id = matches[0]["patreon_user_id"]
        code = _link(conn, patreon_user_id, discord, player, "staff", force, config, utcnow())
        if code != "ok":
            raise ServiceError(code)
        _compute(conn, config, utcnow(), link_success_user=patreon_user_id)
    return {"result": "ok"}


def import_links(links: list[dict], grants: list[dict], *, dry_run=True, config=None):
    config = config or Config.from_env()
    report = {"linked": [], "merged": [], "unmatched": [], "conflicts": [], "grants_seeded": 0}
    with database.transaction(lock=PATREON_LOCK) as conn:
        members = _members(conn)
        for item in links:
            email = str(item.get("patreon_email") or "").strip()
            matches = [m for m in members.values() if str(m.get("email") or "").casefold() == email.casefold() and email]
            if not matches:
                report["unmatched"].append(item)
                continue
            if len(matches) != 1:
                report["conflicts"].append({**item, "detail": "ambiguous_patreon_email"})
                continue
            user = matches[0]["patreon_user_id"]
            old = conn.execute("SELECT 1 FROM patreon_links WHERE patreon_user_id = %s AND active", (user,)).fetchone()
            try:
                _, player = _clean_subjects(None, item.get("player_uuid"))
                if not player:
                    raise ServiceError("invalid_player_uuid")
                code = _link(conn, user, None, player, "import", False, config, utcnow())
            except ServiceError as exc:
                code = str(exc)
            if code != "ok":
                report["conflicts"].append({**item, "detail": code})
            else:
                report["merged" if old else "linked"].append(item)
        for item in grants:
            _, player = _clean_subjects(None, item.get("player_uuid"))
            tier = item.get("tier_key")
            if not player or tier not in {t.key for t in config.tiers}:
                raise ServiceError("invalid_import_grant")
            old = conn.execute("SELECT tiers_json FROM patreon_applied WHERE target = 'luckperms' AND subject = %s", (player,)).fetchone()
            owned = set(old["tiers_json"]) if old else set()
            if tier not in owned:
                owned.add(tier)
                conn.execute("INSERT INTO patreon_applied (target, subject, tiers_json, ever_granted) VALUES ('luckperms', %s, %s, true) "
                             "ON CONFLICT (target, subject) DO UPDATE SET tiers_json = excluded.tiers_json, ever_granted = true", (player, database.Jsonb(sorted(owned))))
                report["grants_seeded"] += 1
        _compute(conn, config, utcnow())
        if dry_run:
            conn.rollback()  # also releases the patreon lock
    return report
