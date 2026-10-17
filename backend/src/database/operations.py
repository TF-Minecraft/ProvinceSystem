"""Deployment database steps, run from the reviewed target image with the backend stopped.

`prepare` applies pending migrations to the site's Postgres. The authority marker
written when the site moved off SQLite must name this database, so a deploy never
migrates a database it was not pointed at. Migrations only go forward: a revision
that lacks a migration the database already has is refused, since its code
expects the older schema. `studio` provisions the Database studio's restricted
login.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import timezone
from pathlib import Path

import psycopg

from .connection import database_url
from .migrate import discover, migrate
from .studio_role import provision


class OperationError(RuntimeError):
    pass


def _identity(url: str) -> dict:
    with psycopg.connect(url) as conn:
        exists = conn.execute("SELECT to_regclass('public.schema_migrations') IS NOT NULL").fetchone()[0]
        history = conn.execute("SELECT version, checksum, applied_at FROM public.schema_migrations ORDER BY version").fetchall() if exists else []
        return {"name": conn.info.dbname, "history": {row[0]: [row[1], row[2].astimezone(timezone.utc).isoformat()] for row in history}}


def _checked_authority(marker: Path, url: str) -> None:
    saved = json.loads(marker.read_text())
    if saved.get("authority") != "postgres":
        raise OperationError("unexpected database authority marker")
    expected, current = saved["database"], _identity(url)
    if current["name"] != expected["name"] or any(
            current["history"].get(version) != value for version, value in expected["history"].items()):
        raise OperationError("database differs from the verified cutover target")


def prepare(data: Path, url: str) -> None:
    marker = data / ".postgres-authority.json"
    if not marker.exists():
        raise OperationError("no Postgres authority marker; this site never moved off SQLite")
    _checked_authority(marker, url)
    newer = sorted(set(_identity(url)["history"]) - {m.version for m in discover()})
    if newer:
        raise OperationError(
            f"the database has migration {', '.join(newer)}, which this revision predates; deploy a fix forward")
    migrate(url, seed=False, retained_directory=data / "postgres-migrations")


def studio(url: str) -> None:
    from psycopg.conninfo import conninfo_to_dict

    studio_url = os.environ.get("DATABASE_STUDIO_URL", "").strip()
    if not studio_url:
        raise OperationError("DATABASE_STUDIO_URL is required for the deployed Studio")
    owner, restricted = conninfo_to_dict(url), conninfo_to_dict(studio_url)
    if any(owner.get(k) != restricted.get(k) for k in ("host", "port", "dbname")):
        raise OperationError("Studio must use the same database as the site")
    role = restricted.get("user", "")
    if not role or role == owner.get("user"):
        raise OperationError("Studio requires a separate restricted login")
    provision(url, role, restricted.get("password", ""), restrict_large_objects=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "studio"))
    parser.add_argument("--data", type=Path, default=Path("/app/src/data"))
    args = parser.parse_args()
    try:
        url = database_url()
        if args.command == "studio":
            studio(url)
        else:
            prepare(args.data, url)
    except OperationError as exc:
        print(f"Database {args.command} failed: {exc}; backend must stay stopped", file=sys.stderr)
        return 1
    except Exception as exc:
        # URLs, passwords and row values never reach Actions or deploy logs.
        print(f"Database {args.command} failed ({type(exc).__name__}); backend must stay stopped", file=sys.stderr)
        return 1
    print(f"Database {args.command} complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
