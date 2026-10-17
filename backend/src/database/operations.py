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
from psycopg.rows import dict_row

from .connection import database_url
from .migrate import migrate
from .studio_role import provision
from src.scripts.tools import copy_province_db as copier
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
        exists = conn.execute("SELECT to_regclass('public.schema_migrations') IS NOT NULL").fetchone()[0]
        history = conn.execute("SELECT version, checksum, applied_at FROM public.schema_migrations ORDER BY version").fetchall() if exists else []
        return {"name": conn.info.dbname, "history": {row[0]: [row[1], row[2].astimezone(timezone.utc).isoformat()] for row in history}}


def _checked_authority(marker: Path, url: str) -> None:
    saved = json.loads(marker.read_text())
    if saved.get("authority") != "postgres":
        raise CopyError("unexpected database authority marker")
    _checked_identity(saved["database"], url)


def _checked_identity(expected: dict, url: str) -> None:
    current = _identity(url)
    if current["name"] != expected["name"] or any(
            current["history"].get(version) != value for version, value in expected["history"].items()):
        raise CopyError("database differs from the verified cutover target")


def prepare(data: Path, url: str) -> None:
    """Copy once, or verify an interrupted copy; subsequent deployments migrate."""
    marker = data / ".postgres-authority.json"
    if marker.exists():
        _checked_authority(marker, url)
        migrate(url, seed=False, retained_directory=data / "postgres-migrations")
        return
    source = data / "province.db"
    if not source.is_file():
        raise CopyError("initial migration requires the stopped site's province.db")
    archive = _archive(data)
    stamp = _stamp()
    original = _snapshot(source, archive / f"province.before-postgres-{stamp}.db")
    transition_path = data / ".postgres-rollback-transition.json"
    if transition_path.exists():
        _resume_legacy(data, url, original, transition_path)
        return
    copier.validate_source(original)
    used = not _unused_target(url)
    if not used:
        # Persist the first copy attempt before PostgreSQL can commit. If
        # marker publication fails and legacy code accepts more writes, the
        # next deployment can verify this baseline and recover those writes.
        _write(transition_path, {"authority": "sqlite", "database": _identity(url),
                                 "initial": True, "targets": [_reference(original)]})
    # If the copy committed but marker publication failed, only an exact
    # verification may adopt it. A partially populated target is never erased.
    report = to_postgres(original, url, verify_only=used,
                         archive_legacy=None if used else archive / f"legacy-{stamp}")
    migrate(url, seed=False, retained_directory=data / "postgres-migrations")
    _sync(archive)
    _publish(data, url, original, report)
    if transition_path.exists():
        _complete_transition(data, transition_path)


def _unused_target(url: str) -> bool:
    with psycopg.connect(url, row_factory=dict_row) as conn:
        exists = conn.execute("SELECT to_regclass('public.codes') IS NOT NULL AS present").fetchone()["present"]
        if not exists:
            return True
        for table in specifications():
            if conn.execute(sql.SQL("SELECT EXISTS (SELECT 1 FROM public.{}) AS used").format(
                    sql.Identifier(table.name))).fetchone()["used"]:
                return False
            for column in table.columns:
                if column.identity and copier._sequence(conn, table, column)[1] != 0:
                    return False
        return True


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def _archive(data: Path) -> Path:
    archive = data / "migration-rollback"
    archive.mkdir(mode=0o700, exist_ok=True)
    os.chmod(archive, 0o700)
    return archive


def _snapshot(source: Path, target: Path) -> Path:
    with closing(sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)) as src:
        with closing(sqlite3.connect(target)) as dst:
            os.chmod(target, 0o600)
            src.backup(dst)
    with target.open("rb") as handle:
        os.fsync(handle.fileno())
    _sync(target.parent)
    return target


def _reference(path: Path) -> dict:
    return {"snapshot": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def _retained(archive: Path, reference: dict) -> Path:
    name = reference["snapshot"]
    if Path(name).name != name:
        raise CopyError("invalid rollback snapshot reference")
    path = archive / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != reference["sha256"]:
        raise CopyError("rollback snapshot changed or is missing")
    return path


def _publish(data: Path, url: str, snapshot: Path, report) -> None:
    _write(data / ".postgres-authority.json", {
        "authority": "postgres", "database": _identity(url),
        "copied_at": datetime.now(timezone.utc).isoformat(),
        "source_sha256": hashlib.sha256(snapshot.read_bytes()).hexdigest(), "snapshot": snapshot.name,
        "checks": [asdict(check) for check in report.checks], "legacy": report.legacy,
        "rounded_rows": report.rounded_rows, "discarded_microsoft_states": report.discarded_microsoft_states})


def _resume_legacy(data: Path, url: str, snapshot: Path, transition_path: Path) -> None:
    transition = json.loads(transition_path.read_text())
    if transition.get("authority") != "sqlite":
        raise CopyError("unexpected rollback transition")
    _checked_identity(transition["database"], url)
    archive = _archive(data)
    candidates = [_retained(archive, ref) for ref in transition["targets"]]
    # Publication may have failed after a complete import. Adopt only an exact
    # match; otherwise replace only a recorded and independently verified target.
    try:
        report = to_postgres(snapshot, url, verify_only=True)
    except CopyError:
        baseline = None
        unused = transition.get("initial") and _unused_target(url)
        if not unused:
            for candidate in candidates:
                try:
                    to_postgres(candidate, url, verify_only=True)
                except CopyError:
                    continue
                baseline = candidate
                break
            if baseline is None:
                raise CopyError("Postgres changed outside the tracked rollback transition")
        transition["targets"].append(_reference(snapshot))
        _write(transition_path, transition)  # durable before the replacement commits
        report = to_postgres(snapshot, url, expected_target=baseline,
                             archive_legacy=archive / f"legacy-{_stamp()}" if transition.get("initial") else None)
    migrate(url, seed=False, retained_directory=data / "postgres-migrations")
    _publish(data, url, snapshot, report)
    _complete_transition(data, transition_path)


def _complete_transition(data: Path, transition_path: Path) -> None:
    archive = _archive(data)
    os.replace(transition_path, archive / f"transition.completed-{_stamp()}.json")
    _sync(archive)
    _sync(data)


def rollback(data: Path, url: str) -> None:
    """Publish a verified SQLite export including every post-cutover write."""
    marker = data / ".postgres-authority.json"
    if not marker.exists():
        raise CopyError("no Postgres authority marker; refusing an untracked downgrade")
    _checked_authority(marker, url)
    archive = _archive(data)
    stamp = _stamp()
    exported = archive / f"province.rollback-{stamp}.db"
    to_sqlite(exported, url)
    _write(data / ".postgres-rollback-transition.json", {
        "authority": "sqlite", "database": _identity(url), "targets": [_reference(exported)]})
    # Keep the original SQLite and each export; replace only the serving copy.
    temporary = data / ".province.rollback.part"
    with exported.open("rb") as src, temporary.open("wb") as dst:
        os.chmod(temporary, 0o600)
        shutil.copyfileobj(src, dst)
        dst.flush()
        os.fsync(dst.fileno())
    # A killed legacy worker may leave WAL pages for the old database. Keep
    # those files with their old base file; never attach them to a new export.
    retained = archive / f"province.replaced-{stamp}.db"
    for suffix in ("", "-wal", "-shm", "-journal"):
        previous = data / f"province.db{suffix}"
        if previous.exists():
            destination = Path(str(retained) + suffix)
            os.replace(previous, destination)
            os.chmod(destination, 0o600)
    _sync(archive)
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
