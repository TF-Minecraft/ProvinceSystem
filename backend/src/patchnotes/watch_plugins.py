"""Watch TFMCMain plugin folders and queue pending patch notes.

Repo plugins and the content packs are kept automatically. Staff can add
another folder. The first scan of a folder only stores hashes. A later edit
becomes one pending line. MythicDungeons notes do not name the dungeon.

    python -m patchnotes.watch_plugins --once \\
        --plugins-dir /path/TFMCMain01/Minecraft/plugins \\
        --state /var/lib/tfmc/plugin-patchnotes.json
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from .folders import (
    FolderChange,
    assert_main_plugins_dir,
    classify_tree,
    diff_tracked,
    excluded_relative,
    is_dangerous,
    note_text,
    plugin_folder,
    preset_rules,
    skip_directory,
    tracked_files,
)

_MAX_READ = 2_000_000


def read_plugin_files(folder: Path) -> dict[str, bytes]:
    """File bytes under one plugin. Excluded and huge files are not read."""
    files: dict[str, bytes] = {}
    root = folder.resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if not skip_directory(name)]
        for filename in filenames:
            path = Path(dirpath) / filename
            relative = path.relative_to(root).as_posix()
            if excluded_relative(relative):
                files[relative] = b""
                continue
            try:
                if path.stat().st_size > _MAX_READ:
                    files[relative] = b""
                    continue
                files[relative] = path.read_bytes()
            except OSError:
                continue
    return files


def load_state(path: Path) -> dict:
    if not path.is_file():
        return {"folders": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("State file must be a JSON object")
    folders = data.get("folders")
    if not isinstance(folders, dict):
        folders = {}
    return {"folders": folders}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def _request(api_base: str, staff_key: str, method: str, path: str, payload: dict | None) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"User-Agent": "TFMC-PatchNotes/1.0", "X-Staff-Key": staff_key}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"{api_base.rstrip('/')}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode() or "{}"
    except urllib.error.HTTPError as exc:
        detail = exc.read(300).decode(errors="replace")
        raise RuntimeError(f"Patch note API returned HTTP {exc.code}: {detail}") from exc
    body = json.loads(raw)
    if not isinstance(body, dict):
        raise RuntimeError("Patch note API returned an unexpected body")
    return body


def _present_names(plugins: Path) -> list[str]:
    return sorted(path.name for path in plugins.iterdir() if path.is_dir() and not path.name.startswith("."))


def _verify(plugins: Path, folder: dict) -> dict:
    name = str(folder["name"])
    found = plugin_folder(plugins, name)
    if found is None:
        return {
            "status": "rejected",
            "rules": None,
            "unclassified": [],
            "reject_reason": "No folder with that name on TFMCMain",
            "dangerous": True if is_dangerous(name) else None,
        }
    files = read_plugin_files(found)
    preset = preset_rules(name)
    if preset is not None:
        rules = preset
        unclassified = classify_tree(files).unclassified
    elif folder.get("rules"):
        rules = None
        unclassified = classify_tree(files).unclassified
    else:
        classified = classify_tree(files)
        rules = classified.rules
        unclassified = classified.unclassified
    if rules is not None and not rules:
        return {
            "status": "rejected",
            "rules": [],
            "unclassified": unclassified,
            "reject_reason": "Nothing in that folder is safe to track",
            "dangerous": True if is_dangerous(name) else None,
        }
    return {
        "status": "active",
        "rules": rules,
        "unclassified": unclassified,
        "reject_reason": None,
        "dangerous": True if is_dangerous(name) else None,
    }


def _scan_active(plugins: Path, folder: dict, previous: dict | None) -> tuple[dict, FolderChange | None, bool]:
    name = str(folder["name"])
    found = plugin_folder(plugins, name)
    rules = list(folder.get("rules") or [])
    if found is None or not rules:
        stored = previous or {"files": {}, "rules": rules}
        return stored, None, False
    current = tracked_files(read_plugin_files(found), rules)
    prev_files = None if previous is None else previous.get("files")
    if prev_files is not None and not isinstance(prev_files, dict):
        prev_files = None
    rules_changed = previous is not None and list(previous.get("rules") or []) != rules
    snapshot, change, baselined = diff_tracked(
        prev_files if isinstance(prev_files, dict) else None,
        current,
        rules_changed=rules_changed,
    )
    return {"files": snapshot, "rules": rules}, change, baselined


def scan(plugins: Path, state_path: Path, api_base: str, staff_key: str) -> dict:
    root = assert_main_plugins_dir(plugins)
    _request(api_base, staff_key, "POST", "/patchnotes/staff/folders/catalog", {"present": _present_names(root)})
    listed = _request(api_base, staff_key, "GET", "/patchnotes/staff/folders", None)
    folders = listed.get("folders") if isinstance(listed.get("folders"), list) else []
    state = load_state(state_path)
    stored = state["folders"]
    baselined = 0
    noted = 0
    for folder in folders:
        if not isinstance(folder, dict) or not folder.get("name"):
            continue
        name = str(folder["name"])
        if folder.get("status") == "rejected":
            continue
        if folder.get("status") != "active" or not folder.get("rules"):
            observation = _verify(root, folder)
            updated = _request(
                api_base,
                staff_key,
                "POST",
                f"/patchnotes/staff/folders/{name}/observation",
                observation,
            )
            folder = updated
            if folder.get("status") != "active":
                continue
        previous = stored.get(name) if isinstance(stored.get(name), dict) else None
        snapshot, change, did_baseline = _scan_active(root, folder, previous)
        stored[name] = snapshot
        if did_baseline:
            baselined += 1
            continue
        if change is None:
            continue
        drafted = note_text(name, change, dangerous=bool(folder.get("dangerous")))
        if drafted is None:
            continue
        section, body = drafted
        week_key = f"watch:{name}"
        _request(
            api_base,
            staff_key,
            "POST",
            "/patchnotes/staff/bullets",
            {"section": section, "body": body, "source_key": week_key[:200]},
        )
        noted += 1
        if folder.get("origin") == "repo" and folder.get("repo"):
            _request(
                api_base,
                staff_key,
                "POST",
                "/patchnotes/staff/sync-tasks",
                {"folder": name},
            )
    save_state(state_path, state)
    return {"baselined": baselined, "noted": noted}


def main() -> None:
    parser = argparse.ArgumentParser(description="Queue TFMCMain plugin edits as patch notes")
    parser.add_argument("--plugins-dir", default=os.environ.get("PATCHNOTES_PLUGINS_DIR", ""))
    parser.add_argument("--state", default=os.environ.get("PATCHNOTES_PLUGINS_STATE", ""))
    parser.add_argument("--api-base", default=os.environ.get("API_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--staff-key", default=os.environ.get("STAFF_KEY", ""))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=int, default=0)
    args = parser.parse_args()
    if not args.plugins_dir or not args.state or not args.staff_key:
        parser.error("--plugins-dir, --state, and --staff-key are required")
    plugins = Path(args.plugins_dir)
    state_path = Path(args.state)

    def run() -> None:
        result = scan(plugins, state_path, args.api_base, args.staff_key)
        print(json.dumps(result), flush=True)

    run()
    while args.interval > 0 and not args.once:
        time.sleep(args.interval)
        run()


if __name__ == "__main__":
    main()
