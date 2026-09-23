"""Watch TFMCMain's MMOItems item directory and queue pending notes.

The first run only writes a snapshot. Later runs post new lines to the staff
API. Dev paths are refused. Nothing is published until staff approve.

    python -m src.patchnotes.watch_mmoitems --once \\
        --item-dir /path/TFMCMain01/Minecraft/plugins/MMOItems/item \\
        --state /var/lib/tfmc/mmoitems-patchnotes.json
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from .mmoitems import CatalogSync, ItemDraft, assert_main_item_dir, sync_catalog


def read_item_files(item_dir: Path) -> dict[str, str]:
    files: dict[str, str] = {}
    for path in sorted(item_dir.glob("*.yml")):
        files[path.name] = path.read_text(encoding="utf-8", errors="replace")
    return files


def load_state(path: Path) -> dict | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("State file must be a JSON object")
    return data


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def post_draft(api_base: str, staff_key: str, draft: ItemDraft) -> str:
    """Return 'created' or 'duplicate'."""
    payload = json.dumps(
        {"section": draft.section, "body": draft.body, "source_key": draft.source_key}
    ).encode()
    request = urllib.request.Request(
        f"{api_base.rstrip('/')}/patchnotes/staff/bullets",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Staff-Key": staff_key,
            "User-Agent": "TFMC-PatchNotes/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read(300).decode(errors="replace")
        raise RuntimeError(f"Patch note API returned HTTP {exc.code}: {detail}") from exc
    if isinstance(body, dict) and body.get("duplicate") is True:
        return "duplicate"
    return "created"


def scan(item_dir: Path, state_path: Path, api_base: str, staff_key: str) -> CatalogSync:
    root = assert_main_item_dir(item_dir)
    result = sync_catalog(load_state(state_path), read_item_files(root))
    if result.baselined:
        save_state(state_path, result.state)
        return result
    for draft in result.drafts:
        post_draft(api_base, staff_key, draft)
    save_state(state_path, result.state)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Queue TFMCMain MMOItems changes as patch notes")
    parser.add_argument("--item-dir", default=os.environ.get("PATCHNOTES_MMOITEMS_DIR", ""))
    parser.add_argument("--state", default=os.environ.get("PATCHNOTES_MMOITEMS_STATE", ""))
    parser.add_argument("--api-base", default=os.environ.get("API_BASE_URL", ""))
    parser.add_argument("--staff-key", default=os.environ.get("STAFF_KEY", ""))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=int, default=0)
    args = parser.parse_args(argv)
    if not args.item_dir or not args.state:
        parser.error("--item-dir and --state are required")
    if not args.api_base or not args.staff_key:
        parser.error("--api-base and --staff-key are required")
    item_dir = Path(args.item_dir)
    state_path = Path(args.state)
    while True:
        result = scan(item_dir, state_path, args.api_base, args.staff_key)
        print(
            json.dumps(
                {
                    "baselined": result.baselined,
                    "created": 0 if result.baselined else len(result.drafts),
                    "withheld": result.withheld,
                }
            ),
            flush=True,
        )
        if args.once or args.interval <= 0:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
