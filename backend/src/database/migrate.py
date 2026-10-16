"""Apply the numbered SQL files in `migrations/` that a database has not had yet.

Files are `NNNN_name.sql`, applied in order, each in its own transaction with
its row in `schema_migrations`. A session advisory lock lets only one runner
work at a time, so backends starting together never apply a file twice. An
applied file must not change: its checksum is recorded and checked.

The backend runs this at start-up. By hand, from `backend/`:

    python -m src.database.migrate            # apply pending files
    python -m src.database.migrate --status   # list files and when each was applied
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import psycopg

from .connection import database_url, session_options

MIGRATIONS_DIR = Path(__file__).resolve().with_name("migrations")
LOCK_NAME = "provincesystem:migrations"
_FILE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version text COLLATE "C" PRIMARY KEY,
    name text COLLATE "C" NOT NULL,
    checksum text COLLATE "C" NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
)
"""


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    sql: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


def discover(directory: Path | None = None) -> list[Migration]:
    directory = directory or MIGRATIONS_DIR
    migrations = []
    for path in sorted(directory.iterdir()):
        if path.suffix != ".sql":
            continue
        match = _FILE.match(path.name)
        if not match:
            raise MigrationError(f"migration file name must be NNNN_name.sql: {path.name}")
        migrations.append(Migration(match[1], match[2], path.read_text(encoding="utf-8")))
    versions = [m.version for m in migrations]
    if len(set(versions)) != len(versions):
        raise MigrationError(f"two migration files share a number in {directory}")
    return migrations


def _connect(url: str | None) -> psycopg.Connection:
    return psycopg.connect(url or database_url(), autocommit=True, options="-c TimeZone=UTC",
                           application_name="provincesystem-migrate")


def _applied(conn: psycopg.Connection) -> dict[str, tuple[str, datetime]]:
    rows = conn.execute("SELECT version, checksum, applied_at FROM schema_migrations").fetchall()
    return {version: (checksum, applied_at) for version, checksum, applied_at in rows}


def migrate(url: str | None = None, *, directory: Path | None = None) -> list[str]:
    """Apply pending migrations to `url` (default DATABASE_URL). Returns the versions applied."""
    migrations = discover(directory)
    done = []
    with _connect(url) as conn:
        conn.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", (LOCK_NAME,))
        try:
            conn.execute(_CREATE_TABLE)
            applied = _applied(conn)
            for migration in migrations:
                if migration.version in applied:
                    if applied[migration.version][0] != migration.checksum:
                        raise MigrationError(
                            f"migration {migration.version}_{migration.name} changed after it was applied")
                    continue
                with conn.transaction():
                    conn.execute(migration.sql)
                    conn.execute(
                        "INSERT INTO schema_migrations (version, name, checksum) VALUES (%s, %s, %s)",
                        (migration.version, migration.name, migration.checksum),
                    )
                done.append(migration.version)
        finally:
            conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (LOCK_NAME,))
    return done


def status(url: str | None = None, *, directory: Path | None = None) -> list[tuple[str, str, datetime | None]]:
    """(version, name, applied_at or None) for every migration file."""
    with _connect(url) as conn:
        exists = conn.execute("SELECT to_regclass('schema_migrations') IS NOT NULL").fetchone()[0]
        applied = _applied(conn) if exists else {}
    return [(m.version, m.name, applied.get(m.version, (None, None))[1]) for m in discover(directory)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m src.database.migrate", description=__doc__.split("\n\n")[0])
    parser.add_argument("--database-url", help="defaults to DATABASE_URL")
    parser.add_argument("--status", action="store_true", help="list migrations instead of applying them")
    args = parser.parse_args(argv)
    if args.status:
        for version, name, applied_at in status(args.database_url):
            print(f"{version}_{name}\t{applied_at.isoformat() if applied_at else 'pending'}")
        return 0
    applied = migrate(args.database_url)
    print(f"applied {', '.join(applied)}" if applied else "up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
