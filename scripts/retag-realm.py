#!/usr/bin/env python3
"""Retag ProvinceSystem data from one realm to another (e.g. main → dev).

Use after copying production data into a staging clone so a dev box
(TFMCWeb realm.id=dev) sees that content. Stops nothing — run while
staging is down.

  python scripts/retag-realm.py --from main --to dev
  python scripts/retag-realm.py --from main --to dev --dry-run
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from src.skins.db import DRINKS_DIR, SKINS_DIR, connect  # noqa: E402
from src.skins.naming import _realm_id_slug_fragment  # noqa: E402


def _prefix_for_realm(realm_id: str) -> str:
    frag = _realm_id_slug_fragment(realm_id)
    return f"{frag}_" if frag else ""


def _target_submission_id(old_id: str, target_realm: str) -> str:
    prefix = _prefix_for_realm(target_realm)
    if not prefix:
        return old_id
    if old_id.startswith(prefix):
        return old_id
    return f"{prefix}{old_id}"


def _submission_id_map(conn, source: str, target: str) -> dict[str, str]:
    rows = conn.execute(
        "SELECT id FROM submissions WHERE realm_id = ?",
        (source,),
    ).fetchall()
    return {row["id"]: _target_submission_id(row["id"], target) for row in rows}


def _drink_id_map(conn, source: str, target: str) -> dict[str, str]:
    rows = conn.execute(
        "SELECT id FROM drink_submissions WHERE realm_id = ?",
        (source,),
    ).fetchall()
    return {row["id"]: _target_submission_id(row["id"], target) for row in rows}


def _rename_path(old: Path, new: Path, dry_run: bool) -> None:
    if old == new or not old.exists():
        return
    if new.exists():
        raise SystemExit(f"Refusing to overwrite existing path: {new}")
    if dry_run:
        print(f"  rename {old} -> {new}")
        return
    new.parent.mkdir(parents=True, exist_ok=True)
    old.rename(new)


def _retag_submissions(
    conn,
    id_map: dict[str, str],
    *,
    source: str,
    target: str,
    dry_run: bool,
) -> None:
    for old_id, new_id in id_map.items():
        row = conn.execute(
            "SELECT dir_path FROM submissions WHERE id = ? AND realm_id = ?",
            (old_id, source),
        ).fetchone()
        if row is None:
            continue
        old_skin = SKINS_DIR / old_id
        new_skin = SKINS_DIR / new_id
        _rename_path(old_skin, new_skin, dry_run)
        new_dir_path = f"skins/{new_id}"
        if dry_run:
            print(f"  submissions {old_id} -> {new_id}")
            continue
        conn.execute(
            """
            UPDATE lore_item_customisations
            SET submission_id = ?, existing_skin_id = ?, skin_slug = ?
            WHERE submission_id = ? OR existing_skin_id = ? OR skin_slug = ?
            """,
            (new_id, new_id, new_id, old_id, old_id, old_id),
        )
        conn.execute(
            "UPDATE skin_notifications SET submission_id = ? WHERE submission_id = ?",
            (new_id, old_id),
        )
        conn.execute(
            """
            UPDATE submissions
            SET id = ?, realm_id = ?, dir_path = ?
            WHERE id = ? AND realm_id = ?
            """,
            (new_id, target, new_dir_path, old_id, source),
        )


def _retag_drinks(
    conn,
    id_map: dict[str, str],
    *,
    source: str,
    target: str,
    dry_run: bool,
) -> None:
    drink_root = DRINKS_DIR / "submissions"
    for old_id, new_id in id_map.items():
        row = conn.execute(
            "SELECT dir_path FROM drink_submissions WHERE id = ? AND realm_id = ?",
            (old_id, source),
        ).fetchone()
        if row is None:
            continue
        old_dir = Path(row["dir_path"])
        if not old_dir.is_absolute():
            old_dir = drink_root / old_id
        new_dir = drink_root / new_id
        _rename_path(old_dir, new_dir, dry_run)
        new_dir_path = str(new_dir)
        if dry_run:
            print(f"  drink_submissions {old_id} -> {new_id}")
            continue
        conn.execute(
            "UPDATE drink_notifications SET submission_id = ? WHERE submission_id = ?",
            (new_id, old_id),
        )
        conn.execute(
            """
            UPDATE drink_submissions
            SET id = ?, realm_id = ?, dir_path = ?
            WHERE id = ? AND realm_id = ?
            """,
            (new_id, target, new_dir_path, old_id, source),
        )


def _simple_realm_updates(conn, source: str, target: str, dry_run: bool) -> None:
    tables = (
        "codes",
        "character_creates",
        "character_roster",
        "lore_item_customisations",
        "rpc_player_meta",
    )
    for table in tables:
        count = conn.execute(
            f"SELECT COUNT(*) AS n FROM {table} WHERE realm_id = ?",
            (source,),
        ).fetchone()["n"]
        if count:
            print(f"  {table}: {count} row(s) {source} -> {target}")
        if dry_run or not count:
            continue
        conn.execute(
            f"UPDATE {table} SET realm_id = ? WHERE realm_id = ?",
            (target, source),
        )


def retag(source: str, target: str, *, dry_run: bool) -> None:
    source = source.strip().lower()
    target = target.strip().lower()
    if source == target:
        raise SystemExit("source and target must differ")

    with connect() as conn:
        existing_target = conn.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM submissions WHERE realm_id = ?) +
              (SELECT COUNT(*) FROM character_roster WHERE realm_id = ?) AS n
            """,
            (target, target),
        ).fetchone()["n"]
        if existing_target:
            raise SystemExit(
                f"Target realm {target!r} already has data ({existing_target} rows). "
                "Use a fresh copy or pick another target."
            )

        source_count = conn.execute(
            "SELECT COUNT(*) AS n FROM submissions WHERE realm_id = ?",
            (source,),
        ).fetchone()["n"]
        print(
            f"Retag {source!r} -> {target!r}"
            + (" (dry run)" if dry_run else "")
            + f" — {source_count} skin submission(s)"
        )

        skin_map = _submission_id_map(conn, source, target)
        drink_map = _drink_id_map(conn, source, target)

        if dry_run:
            _retag_submissions(conn, skin_map, source=source, target=target, dry_run=True)
            _retag_drinks(conn, drink_map, source=source, target=target, dry_run=True)
            _simple_realm_updates(conn, source, target, dry_run=True)
            return

        conn.execute("BEGIN")
        try:
            _retag_submissions(conn, skin_map, source=source, target=target, dry_run=False)
            _retag_drinks(conn, drink_map, source=source, target=target, dry_run=False)
            _simple_realm_updates(conn, source, target, dry_run=False)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise

    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="source", default="main")
    parser.add_argument("--to", dest="target", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    retag(args.source, args.target, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
