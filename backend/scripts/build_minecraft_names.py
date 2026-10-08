"""Build the vanilla block, item and entity names the staff activity list shows.

Mojang's language file is not ours to publish, so the repository keeps only
this script; the backend image runs it at build time. It downloads the pinned
client jar, checks its SHA-1, and keeps the plain `block.minecraft.<id>`,
`item.minecraft.<id>` and `entity.minecraft.<id>` names from `en_us.json`
(about 94 KB). Without the file, names fall back to tidied ids.

    python3 scripts/build_minecraft_names.py src/coreprotect/data/minecraft_names.json

Bump VERSION, JAR_URL and JAR_SHA1 together when the server moves to a new
Minecraft version (the version manifest lists the client jar's URL and SHA-1).
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

VERSION = "1.21.10"
JAR_URL = "https://piston-data.mojang.com/v1/objects/d3bdf582a7fa723ce199f3665588dcfe6bf9aca8/client.jar"
JAR_SHA1 = "d3bdf582a7fa723ce199f3665588dcfe6bf9aca8"
LANG = "assets/minecraft/lang/en_us.json"

_KEY = re.compile(r"(block|item|entity)\.minecraft\.([a-z0-9_]+)")


def trim(lang: dict[str, str]) -> dict:
    out: dict = {"version": VERSION, "block": {}, "item": {}, "entity": {}}
    for key, name in lang.items():
        match = _KEY.fullmatch(key)
        if match:
            out[match[1]][match[2]] = name
    for kind in ("block", "item", "entity"):
        out[kind] = dict(sorted(out[kind].items()))
    return out


def main(target: str) -> None:
    with urllib.request.urlopen(JAR_URL, timeout=120) as response:
        jar = response.read()
    digest = hashlib.sha1(jar).hexdigest()
    if digest != JAR_SHA1:
        raise SystemExit(f"client jar SHA-1 {digest} is not the pinned {JAR_SHA1}")
    with zipfile.ZipFile(io.BytesIO(jar)) as archive:
        lang = json.loads(archive.read(LANG))
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(trim(lang), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {sys.argv[0]} OUTPUT.json")
    main(sys.argv[1])
