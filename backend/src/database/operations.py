"""Stopped-backend deployment transition; retain SQLite copies for rollback.

Run only from the reviewed target backend image, with its normal DATABASE_URL
and data mount. The host deployment lock and stopped backend exclude writers.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg import sql

from .connection import database_url
from .migrate import migrate
from .studio_role import provision
from src.scripts.tools.copy_province_db import CopyError, specifications, to_postgres, to_sqlite


def _write(path: Path, value: dict) -> None:
    temporary = path.with_suffix(".part")
    with temporary.open("w", encoding="utf-8") as handle:
        os.chmod(temporary, 0o600)
        json.dump(value, handle, sort_keys=True, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    _sync(path.parent)


def _sync(directory: Path) -> None:
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _identity(url: str) -> dict:
    with psycopg.connect(url) as conn:
        history = conn.execute("SELECT version, checksum, applied_at FROM public.schema_migrations ORDER BY version").fetchall()
        return {"name": conn.info.dbname, "history": {row[0]: [row[1], row[2].astimezone(timezone.utc).isoformat()] for row in history}}


def _checked_authority(marker: Path, url: str) -> None:
    saved = json.loads(marker.read_text())
    if saved.get("authority") != "postgres":
        raise CopyError("unexpected database authority marker")
    current = _identity(url)
    expected = saved["database"]
    if current["name"] != expected["name"] or any(
            current["history"].get(version) != value for version, value in expected["history"].items()):
        raise CopyError("database differs from the verified cutover target")


def prepare(data: Path, url: str) -> None:
    """Copy once, or verify an interrupted copy; subsequent deployments migrate."""
    marker = data / ".postgres-authority.json"
    if marker.exists():
        _checked_authority(marker, url)
        migrate(url, seed=False)
        return
    source = data / "province.db"
    if not source.is_file():
        raise CopyError("initial migration requires the stopped site's province.db")
    # Keep the source and all legacy columns/DDL outside ordinary backup pruning.
    archive = data / "migration-rollback"
    archive.mkdir(mode=0o700, exist_ok=True)
    os.chmod(archive, 0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    original = archive / f"province.before-postgres-{stamp}.db"
    with closing(sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)) as src:
        with closing(sqlite3.connect(original)) as dst:
            os.chmod(original, 0o600)
            src.backup(dst)
    with original.open("rb") as handle:
        os.fsync(handle.fileno())
    tables = specifications()
    with psycopg.connect(url) as conn:
        exists = conn.execute("SELECT to_regclass('public.codes') IS NOT NULL").fetchone()[0]
        used = exists and any(conn.execute(sql.SQL("SELECT EXISTS (SELECT 1 FROM public.{})").format(
            sql.Identifier(table.name))).fetchone()[0] for table in tables)
    # If the copy committed but marker publication failed, only an exact
    # verification may adopt it. A partially populated target is never erased.
    report = to_postgres(original, url, verify_only=used,
                         archive_legacy=None if used else archive / f"legacy-{stamp}")
    _sync(archive)
    _write(marker, {"authority": "postgres", "database": _identity(url), "copied_at": datetime.now(timezone.utc).isoformat(),
                    "source_sha256": hashlib.sha256(original.read_bytes()).hexdigest(),
                    "snapshot": original.name,
                    "checks": [asdict(check) for check in report.checks],
                    "legacy": report.legacy, "rounded_rows": report.rounded_rows,
                    "discarded_microsoft_states": report.discarded_microsoft_states})


def rollback(data: Path, url: str) -> None:
    """Publish a verified SQLite export including every post-cutover write."""
    marker = data / ".postgres-authority.json"
    if not marker.exists():
        raise CopyError("no Postgres authority marker; refusing an untracked downgrade")
    _checked_authority(marker, url)
    archive = data / "migration-rollback"
    archive.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    exported = archive / f"province.rollback-{stamp}.db"
    to_sqlite(exported, url)
    # Keep the original SQLite and each export; replace only the serving copy.
    temporary = data / ".province.rollback.part"
    with exported.open("rb") as src, temporary.open("wb") as dst:
        os.chmod(temporary, 0o600)
        shutil.copyfileobj(src, dst)
        dst.flush()
        os.fsync(dst.fileno())
    os.replace(temporary, data / "province.db")
    _sync(data)
    os.replace(marker, archive / f"authority.rollback-{stamp}.json")
    _sync(archive)
    _sync(data)


def studio(url: str) -> None:
    from psycopg.conninfo import conninfo_to_dict

    studio_url = os.environ.get("DATABASE_STUDIO_URL", "").strip()
    if not studio_url:
        raise CopyError("DATABASE_STUDIO_URL is required for the deployed Studio")
    owner, restricted = conninfo_to_dict(url), conninfo_to_dict(studio_url)
    if any(owner.get(k) != restricted.get(k) for k in ("host", "port", "dbname")):
        raise CopyError("Studio must use the same database as the site")
    role = restricted.get("user", "")
    if not role or role == owner.get("user"):
        raise CopyError("Studio requires a separate restricted login")
    provision(url, role, restricted.get("password", ""), restrict_large_objects=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "rollback", "studio"))
    parser.add_argument("--data", type=Path, default=Path("/app/src/data"))
    args = parser.parse_args()
    try:
        url = database_url()
        if args.command == "studio":
            studio(url)
        else:
            globals()[args.command](args.data, url)
    except Exception as exc:
        # URLs, passwords and row values never reach Actions or deploy logs.
        print(f"Database {args.command} failed ({type(exc).__name__}); backend must stay stopped", file=sys.stderr)
        return 1
    print(f"Database {args.command} complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
