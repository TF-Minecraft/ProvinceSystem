"""Local copy of the server resource pack, keyed by SHA-1.

The game server hosts the pack over plain HTTP on its own port, which a browser
on an HTTPS page cannot fetch. The site keeps a copy so the diagnostic page can
time the download, check its SHA-1 and offer it for manual install.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

_CHUNK = 1 << 20
_SHA1 = re.compile(r"[0-9a-f]{40}")


@dataclass(frozen=True)
class PackInfo:
    sha1: str
    size: int
    fetched_at: float


class PackMirror:
    def __init__(self, source_url: str, directory: Path, max_age: float = 300.0, max_bytes: int = 250 << 20):
        self.source_url = source_url
        self.directory = directory
        self.max_age = max_age
        self.max_bytes = max_bytes
        self._lock = threading.Lock()
        self._info: PackInfo | None = None
        self._checked_at = 0.0
        self.error: str | None = None

    def path_for(self, sha1: str) -> Path | None:
        if not _SHA1.fullmatch(sha1):
            return None
        path = self.directory / f"pack-{sha1}.zip"
        return path if path.is_file() else None

    def current(self) -> PackInfo | None:
        """The newest copy, refreshed from the game server when it is older than max_age."""
        with self._lock:
            if self._info is None:
                self._info = self._newest_on_disk()
            if time.time() - self._checked_at >= self.max_age:
                self._checked_at = time.time()
                try:
                    self._info = self._download()
                    self.error = None
                except (OSError, ValueError) as exc:
                    self.error = str(exc) or type(exc).__name__
            return self._info

    def _newest_on_disk(self) -> PackInfo | None:
        files = sorted(self.directory.glob("pack-*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
        for path in files:
            sha1 = path.stem.removeprefix("pack-")
            if _SHA1.fullmatch(sha1):
                stat = path.stat()
                return PackInfo(sha1=sha1, size=stat.st_size, fetched_at=stat.st_mtime)
        return None

    def _download(self) -> PackInfo:
        self.directory.mkdir(parents=True, exist_ok=True)
        tmp = self.directory / f".pack-{os.getpid()}-{threading.get_ident()}.part"
        digest = hashlib.sha1()
        size = 0
        try:
            with urllib.request.urlopen(self.source_url, timeout=30) as resp, tmp.open("wb") as out:
                while chunk := resp.read(_CHUNK):
                    size += len(chunk)
                    if size > self.max_bytes:
                        raise ValueError("pack larger than limit")
                    digest.update(chunk)
                    out.write(chunk)
            if size == 0:
                raise ValueError("empty pack")
            sha1 = digest.hexdigest()
            final = self.directory / f"pack-{sha1}.zip"
            if final.is_file():
                tmp.unlink()
                os.utime(final)
            else:
                tmp.replace(final)
        finally:
            tmp.unlink(missing_ok=True)
        # Keep the previous copy too, so a download that started before a pack rebuild still finishes.
        keep = {sha1, self._info.sha1 if self._info else sha1}
        for old in self.directory.glob("pack-*.zip"):
            if old.stem.removeprefix("pack-") not in keep:
                old.unlink(missing_ok=True)
        return PackInfo(sha1=sha1, size=size, fetched_at=time.time())
