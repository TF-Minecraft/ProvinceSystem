"""Apply the numbered SQL files in `migrations/` that a database has not had yet.

Files are `NNNN_name.sql`, applied in order, each in its own transaction with
its row in `schema_migrations`. A session advisory lock lets only one runner
work at a time, so backends starting together never apply a file twice. An
applied file must not change, every applied version must still have its file,
and a new file must be numbered above the newest applied one. Native deployments
can retain bundled files so an older bundle can validate newer applied versions.

`seeds.sql` holds rows the site needs (idempotent inserts). The backend applies
migrations and seeds at start-up; the copy from SQLite migrates without seeding,
so the copied rows take their place.

By hand, from `backend/`:

    python -m src.database.migrate            # apply pending files
    python -m src.database.migrate --seed     # and the seed rows
    python -m src.database.migrate --status   # list files and when each was applied
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import psycopg

from .connection import database_url

MIGRATIONS_DIR = Path(__file__).resolve().with_name("migrations")
SEEDS_PATH = Path(__file__).resolve().with_name("seeds.sql")
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
    source: bytes = field(repr=False, compare=False)

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


def _read_migration(path: Path, match: re.Match) -> Migration:
    source = path.read_bytes()
    # Keep the historical read_text() checksum, but retain the original bytes.
    sql = source.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
    return Migration(match[1], match[2], sql, source)


def discover(directory: Path | None = None) -> list[Migration]:
    directory = directory or MIGRATIONS_DIR
    migrations = []
    for path in sorted(directory.iterdir()):
        if path.suffix != ".sql":
            continue
        match = _FILE.match(path.name)
        if not match:
            raise MigrationError(f"migration file name must be NNNN_name.sql: {path.name}")
        migrations.append(_read_migration(path, match))
    versions = [m.version for m in migrations]
    if len(set(versions)) != len(versions):
        raise MigrationError(f"two migration files share a number in {directory}")
    return migrations


def _connect(url: str | None) -> psycopg.Connection:
    return psycopg.connect(url or database_url(), autocommit=True,
                           options="-c search_path=public -c TimeZone=UTC",
                           application_name="provincesystem-migrate")


def _applied(conn: psycopg.Connection) -> dict[str, tuple[str, datetime, str]]:
    rows = conn.execute("SELECT version, checksum, applied_at, name FROM schema_migrations").fetchall()
    return {version: (checksum, applied_at, name) for version, checksum, applied_at, name in rows}


def _fsync_directory(directory: Path) -> None:
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _retain(migrations: list[Migration], applied: dict, directory: Path) -> list[Migration]:
    """Retain this bundle; return only applied definitions absent from it.

    The caller holds the database's migration advisory lock. Persist every file
    before applying any SQL, including files whose migration might fail.
    """
    if directory.is_symlink():
        raise MigrationError(f"retained migration directory must not be a symlink: {directory}")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    _fsync_directory(directory.parent)
    bundled = {m.version: m for m in migrations}
    retained = {}
    for path in sorted(directory.iterdir()):
        match = _FILE.match(path.name)
        if match is None or (match[1] not in bundled and match[1] not in applied):
            continue
        if path.is_symlink() or not path.is_file():
            raise MigrationError(f"retained migration must be a regular file: {path.name}")
        if match[1] in retained:
            raise MigrationError(f"two retained migration files share a number: {match[1]}")
        try:
            migration = _read_migration(path, match)
        except (OSError, UnicodeError) as exc:
            raise MigrationError(f"cannot read retained migration {path.name}") from exc
        current = bundled.get(migration.version)
        if current is not None:
            if migration.name != current.name or migration.source != current.source:
                raise MigrationError(f"retained migration {migration.version}_{migration.name} changed")
        elif migration.name != applied[migration.version][2]:
            raise MigrationError(f"retained migration {migration.version}_{migration.name} changed name")
        retained[migration.version] = migration
        path.chmod(0o600)
        with path.open("rb") as handle:
            os.fsync(handle.fileno())

    for migration in migrations:
        if migration.version in retained:
            continue
        path = directory / f"{migration.version}_{migration.name}.sql"
        fd, temporary = tempfile.mkstemp(prefix=".migration-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "wb") as handle:
                os.fchmod(handle.fileno(), 0o600)
                handle.write(migration.source)
                handle.flush()
                os.fsync(handle.fileno())
            # Publish a complete file atomically without replacing existing history.
            os.link(temporary, path)
        finally:
            os.unlink(temporary)
    _fsync_directory(directory)
    return [m for version, m in retained.items() if version not in bundled]


def _check_order(migrations: list[Migration], applied: dict) -> None:
    files = {m.version: m for m in migrations}
    unknown = sorted(set(applied) - set(files))
    if unknown:
        raise MigrationError(f"the database has applied migrations with no file: {', '.join(unknown)}")
    for version, (checksum, _, _) in applied.items():
        if files[version].checksum != checksum:
            raise MigrationError(f"migration {version}_{files[version].name} changed after it was applied")
    newest = max(applied, default=None)
    late = [m for m in migrations if m.version not in applied and newest is not None and m.version < newest]
    if late:
        raise MigrationError(
            f"migration {late[0].version}_{late[0].name} is numbered below the newest applied one ({newest})")


def migrate(url: str | None = None, *, directory: Path | None = None, seed: bool = False,
            retained_directory: Path | None = None) -> list[str]:
    """Apply pending migrations to `url` (default DATABASE_URL), then `seeds.sql` if `seed`.

    Returns the versions applied. Refuses to change the database when the files
    and its history disagree. With `retained_directory`, save bundled files and
    use retained definitions to validate applied versions missing from this
    bundle. Unapplied retained files absent from this bundle are ignored.
    """
    migrations = discover(directory)
    done = []
    with _connect(url) as conn:
        conn.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", (LOCK_NAME,))
        try:
            conn.execute(_CREATE_TABLE)
            applied = _applied(conn)
            retained = _retain(migrations, applied, retained_directory) if retained_directory is not None else []
            _check_order(migrations + retained, applied)
            for migration in migrations:
                if migration.version in applied:
                    continue
                with conn.transaction():
                    conn.execute(migration.sql)
                    conn.execute(
                        "INSERT INTO schema_migrations (version, name, checksum) VALUES (%s, %s, %s)",
                        (migration.version, migration.name, migration.checksum),
                    )
                done.append(migration.version)
            if seed:
                with conn.transaction():
                    conn.execute(SEEDS_PATH.read_text(encoding="utf-8"))
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
    parser.add_argument("--seed", action="store_true", help="also insert the seed rows (seeds.sql)")
    args = parser.parse_args(argv)
    if args.status:
        for version, name, applied_at in status(args.database_url):
            print(f"{version}_{name}\t{applied_at.isoformat() if applied_at else 'pending'}")
        return 0
    applied = migrate(args.database_url, seed=args.seed)
    print(f"applied {', '.join(applied)}" if applied else "up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
