"""Operator commands for root accounts, for the first owner or when no root can sign in.

Run inside the backend container, for example:
  python -m src.auth.admin_cli grant-root --discord-id 123 --reason "First owner"
  python -m src.auth.admin_cli revoke-root --discord-id 123 --reason "Stepped down"
  python -m src.auth.admin_cli list-staff

The account must have signed in to the website once. Each change is audited
as an operator action and signs the account out everywhere. Once one root
exists, roots can also give and take root in the staff panel.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from src import database
from src.skins import db

from . import audit
from .admin import REASON_MAX, REASON_MIN, AdminError, clean_reason, list_staff
from .users import PLACEHOLDERS_LOCK, drop_view_leftovers


def _set_root(discord_id: str, reason: str | None, *, grant: bool, demote_to: str = "player") -> str:
    clean = clean_reason(reason)
    with database.transaction(lock=PLACEHOLDERS_LOCK) as conn:
        # Lock the target, and to take root away every root too, in id order, so two
        # removals cannot each see the other root still there.
        roots = "" if grant else " OR role = 'root'"
        locked = conn.execute(
            "SELECT id AS user_id, discord_user_id, discord_username, discord_global_name, role "
            f"FROM users WHERE NOT placeholder AND (discord_user_id = %s{roots}) ORDER BY id FOR UPDATE",
            (discord_id,),
        ).fetchall()
        target = next((dict(row) for row in locked if row["discord_user_id"] == discord_id), None)
        if target is None:
            raise SystemExit("No website account for that Discord id; sign in to the site once first.")
        if grant:
            if target["role"] == "root":
                raise SystemExit("That account is already root.")
            new_role = "root"
        else:
            if target["role"] != "root":
                raise SystemExit("That account is not root.")
            if sum(row["role"] == "root" for row in locked) <= 1:
                raise SystemExit("Refusing to remove the last root account.")
            new_role = demote_to
        conn.execute("UPDATE users SET role = %s WHERE id = %s", (new_role, target["user_id"]))
        revoked = conn.execute(
            "DELETE FROM user_sessions WHERE user_id = %s OR acting_user_id = %s",
            (target["user_id"], target["user_id"]),
        ).rowcount
        drop_view_leftovers(conn)
        audit.record(
            conn, actor=None, action="account.role.change", outcome="ok", target=target, reason=clean,
            detail={"before": target["role"], "after": new_role, "sessions_revoked": revoked},
        )
    return f"{audit.display_name(target)}: {target['role']} -> {new_role}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m src.auth.admin_cli", description=__doc__.splitlines()[0])
    parser.add_argument("--database-url", help="the site's Postgres (default: DATABASE_URL)")
    # PG-MIGRATION: until the Scripts area converts, Profile sessions and Discord links are
    # still read from province.db (drop_view_leftovers, list-staff's Minecraft names).
    parser.add_argument("--db", type=Path, help="database file (default: the site's province.db)")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("grant-root", "revoke-root"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--discord-id", required=True)
        cmd.add_argument("--reason", required=True)
    sub.choices["revoke-root"].add_argument(
        "--to", choices=("player", "mod", "admin"), default="player", help="role after root (default: player)")
    sub.add_parser("list-staff")
    args = parser.parse_args(argv)

    if args.db:
        db.DB_PATH = args.db
        db.DATA_DIR = args.db.parent
        db.SKINS_DIR = db.DATA_DIR / "skins"
        db.WARDROBE_DIR = db.DATA_DIR / "wardrobe"
        db.DRINKS_DIR = db.DATA_DIR / "drinks"
    print(f"Database: {db.DB_PATH}", file=sys.stderr)
    db.migrate()
    if args.database_url:
        database.open_pool(args.database_url, min_size=0, max_size=1)

    if args.command == "list-staff":
        for row in list_staff():
            print(f"{row['role']:<6} {row['discord_user_id']:<20} {audit.display_name(row)}")
        return 0
    try:
        if args.command == "grant-root":
            print(_set_root(args.discord_id.strip(), args.reason, grant=True))
        else:
            print(_set_root(args.discord_id.strip(), args.reason, grant=False, demote_to=args.to))
    except AdminError as exc:
        raise SystemExit(f"Refused: {exc.code} (reasons need {REASON_MIN}-{REASON_MAX} characters)") from None
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
