"""Undo an audited change to a precedent case.

Reverts an `update` by writing its `before` snapshot back, or an `undelete` by
re-inserting a deleted case. Reverts are themselves audited (`action='revert'`),
so undoing a change is recorded rather than hiding it.

    # What happened to a case
    cd backend && python -m src.scripts.revert_precedent_change --case-id <uuid> --list

    # Undo the most recent change to a case (preview first)
    cd backend && python -m src.scripts.revert_precedent_change --case-id <uuid> --dry-run
    cd backend && python -m src.scripts.revert_precedent_change --case-id <uuid>

    # Undo one specific audit entry
    cd backend && python -m src.scripts.revert_precedent_change --audit-id 42
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
for _p in (str(_BACKEND_ROOT), str(_BACKEND_SRC)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from dotenv import load_dotenv

load_dotenv(_BACKEND_ROOT / ".env")

from src.precedent.db import (
    AuditActor,
    list_audit_entries,
    restore_case,
    update_case,
)
from src.precedent.embeddings import embed

_FIELDS = ("summary", "rule", "ruling", "punishment", "players", "logged_by")


def _describe(entry: dict) -> None:
    when = entry["created_at"]
    print(
        f"  #{entry['id']}  [{entry['action']}]  {when:%Y-%m-%d %H:%M:%S}  "
        f"source={entry['source']}  actor={entry['actor']!r}"
    )
    before, after = entry["before"] or {}, entry["after"] or {}
    if before and after:
        for f in _FIELDS:
            if before.get(f) != after.get(f):
                print(f"       {f}: {before.get(f)!r} -> {after.get(f)!r}")
    elif after:
        print(f"       created: {after.get('summary')!r}")
    elif before:
        print(f"       deleted: {before.get('summary')!r}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-id", help="Act on the newest change to this case.")
    parser.add_argument("--audit-id", type=int, help="Act on this specific audit entry.")
    parser.add_argument("--list", action="store_true", help="Show history, change nothing.")
    parser.add_argument("--dry-run", action="store_true", help="Preview; write nothing.")
    parser.add_argument("--actor", default="revert-script")
    args = parser.parse_args()

    if not args.case_id and not args.audit_id:
        parser.error("give --case-id or --audit-id")

    entries = list_audit_entries(case_id=args.case_id, limit=50)
    if args.audit_id:
        entries = [e for e in list_audit_entries(limit=500) if e["id"] == args.audit_id]

    if not entries:
        print("No audit entries found.")
        return

    if args.list:
        print(f"{len(entries)} entr(y/ies), newest first:")
        for e in entries:
            _describe(e)
        return

    target = entries[0]
    print("Reverting this change:")
    _describe(target)

    action = target["action"]
    before = target["before"] or {}
    case_id = str(target["case_id"])

    if action not in ("update", "delete", "revert"):
        print(f"\nCannot revert action {action!r} automatically.")
        if action == "create":
            print("Undoing a create means deleting the case; do that through the UI.")
        return
    if not before:
        print("\nThis entry has no 'before' snapshot, so there is nothing to revert to.")
        return

    print("\nWill restore:")
    for f in _FIELDS:
        print(f"    {f} = {before.get(f)!r}")

    if args.dry_run:
        print("\nDry run: nothing written.")
        return

    vector = embed(before.get("summary", ""))
    actor = AuditActor(source="script", actor=args.actor)

    if action == "delete":
        ok = restore_case(case_id, snapshot=before, embedding=vector, actor=actor)
        print("\nrestored" if ok else "\nskipped: a case with that id already exists")
        return

    ok = update_case(
        case_id,
        logged_by=before.get("logged_by", ""),
        players=list(before.get("players") or []),
        participants=list(before.get("participants") or []),
        summary=before.get("summary", ""),
        rule=before.get("rule", ""),
        ruling=before.get("ruling", ""),
        punishment=before.get("punishment", ""),
        embedding=vector,
        actor=actor,
        audit_action="revert",
    )
    print("\nreverted" if ok else "\nfailed: case no longer exists (restore it first)")


if __name__ == "__main__":
    main()
