"""Operator commands for root accounts. The website never grants or removes root.

Run inside the backend container, for example:
  python -m src.auth.admin_cli grant-root --discord-id 123 --reason "First owner"
  python -m src.auth.admin_cli revoke-root --discord-id 123 --reason "Stepped down"
  python -m src.auth.admin_cli list-staff

The account must have signed in to the website once. Each change is audited
as an operator action and signs the account out everywhere.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from src.skins import db

from . import audit
from .admin import REASON_MAX, REASON_MIN, AdminError, clean_reason, list_staff


def _set_root(discord_id: str, reason: str | None, *, grant: bool, demote_to: str = "player") -> str:
    clean = clean_reason(reason)
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT id AS user_id, discord_user_id, discord_username, discord_global_name, role "
                "FROM users WHERE discord_user_id = ?",
                (discord_id,),
            ).fetchone()
            if row is None:
                raise SystemExit("No website account for that Discord id; sign in to the site once first.")
            target = dict(row)
            if grant:
                if target["role"] == "root":
                    raise SystemExit("That account is already root.")
                new_role = "root"
            else:
                if target["role"] != "root":
                    raise SystemExit("That account is not root.")
                roots = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'root'").fetchone()[0]
                if roots <= 1:
                    raise SystemExit("Refusing to remove the last root account.")
                new_role = demote_to
            conn.execute("UPDATE users SET role = ? WHERE id = ?", (new_role, target["user_id"]))
            revoked = conn.execute("DELETE FROM user_sessions WHERE user_id = ?", (target["user_id"],)).rowcount
            audit.record(
                conn, actor=None, action="account.role.change", outcome="ok", target=target, reason=clean,
                detail={"before": target["role"], "after": new_role, "sessions_revoked": revoked},
            )
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
    return f"{audit.display_name(target)}: {target['role']} -> {new_role}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m src.auth.admin_cli", description=__doc__.splitlines()[0])
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
    print(f"Database: {db.DB_PATH}", file=sys.stderr)
    db.migrate()

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
