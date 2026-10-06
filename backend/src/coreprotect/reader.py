"""Guarded read-only connections to a live CoreProtect SQLite database.

CoreProtect writes this file from the Minecraft server while we read it. The
database uses a rollback journal, so any reader's SHARED lock holds off the
writer's commit (and its cache spills) until the reader lets go. CoreProtect
writes from its consumer thread and retries a busy commit, so a short hold
delays its queue rather than the server tick, but a long one would back the
queue up. Every read here is therefore kept short and bounded:

- autocommit, and every statement is fully fetched and closed before the
  next, so no read transaction stays open between statements;
- one reader at a time per process. The backend runs as a single uvicorn
  process; a second process or replica would need its own coordination;
- one budget per request covering the wait for the reader slot, cache locks
  and every statement. A statement waiting for the lock holds nothing, so
  it may wait for whatever budget is left; a progress handler interrupts a
  statement that overruns once it has the lock.
  The progress handler only runs while SQLite executes VM steps, so the
  budget is cooperative: it cannot cut short a stalled disk read;
- the connection is closed before any decoding, province.db access or
  response building.

Never open the file with immutable=1: that skips locking and reads torn
pages while CoreProtect writes (seen on Main as "database disk image is
malformed").
"""
from __future__ import annotations

import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

REQUEST_BUDGET_SECONDS = 1.5
PROGRESS_STEPS = 1000

_GATE = threading.BoundedSemaphore(1)


@dataclass(frozen=True)
class CoreProtectConfig:
    path: str | None
    # Scopes caches and cursors, so a cursor from one server is never read against another.
    server: str
    label: str
    # CoreProtect's player-pings interval; 0 when pings are off or unknown.
    ping_seconds: int

    @classmethod
    def from_env(cls) -> CoreProtectConfig:
        path = os.getenv("COREPROTECT_DB", "").strip() or None
        try:
            ping = max(0, int(os.getenv("COREPROTECT_PING_SECONDS", "60").strip() or "0"))
        except ValueError:
            ping = 0
        return cls(
            path=path,
            server=os.getenv("COREPROTECT_SERVER", "main").strip() or "main",
            label=os.getenv("COREPROTECT_SERVER_LABEL", "").strip(),
            ping_seconds=ping,
        )


class Unavailable(Exception):
    """CoreProtect could not be read: not_configured, missing, cannot_open, busy, timeout or error."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class Budget:
    """A monotonic deadline shared by everything one request does with CoreProtect."""

    def __init__(self, seconds: float = REQUEST_BUDGET_SECONDS):
        self.deadline = time.monotonic() + seconds

    def remaining(self) -> float:
        return self.deadline - time.monotonic()

    def check(self) -> float:
        left = self.remaining()
        if left <= 0:
            raise Unavailable("timeout")
        return left

    def acquire(self, lock) -> None:
        if not lock.acquire(timeout=self.check()):
            raise Unavailable("busy")


class Reader:
    """One guarded connection: `with Reader(config, budget) as r: r.rows(sql, params)`."""

    def __init__(self, config: CoreProtectConfig, budget: Budget | None = None):
        self.config = config
        self.budget = budget or Budget()
        self._conn: sqlite3.Connection | None = None
        self._gated = False

    def __enter__(self) -> Reader:
        if not self.config.path:
            raise Unavailable("not_configured")
        path = Path(self.config.path)
        if not path.is_file():
            raise Unavailable("missing")
        self.budget.acquire(_GATE)
        self._gated = True
        try:
            self._conn = sqlite3.connect(
                f"file:{quote(str(path))}?mode=ro", uri=True, isolation_level=None,
                timeout=0, check_same_thread=True,
            )
            self._conn.row_factory = sqlite3.Row
            deadline = self.budget.deadline
            self._conn.set_progress_handler(lambda: int(time.monotonic() > deadline), PROGRESS_STEPS)
            self._statement("PRAGMA query_only = 1", ())
        except sqlite3.OperationalError as exc:
            self.close()
            raise Unavailable(_classify(exc)) from None
        except sqlite3.Error:
            self.close()
            raise Unavailable("error") from None
        except BaseException:
            self.close()
            raise
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def close(self) -> None:
        try:
            if self._conn is not None:
                self._conn.close()
        finally:
            self._conn = None
            if self._gated:
                self._gated = False
                _GATE.release()

    def rows(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        return self._statement(sql, params)

    def _statement(self, sql: str, params: tuple) -> list[sqlite3.Row]:
        if self._conn is None:
            raise Unavailable("error")
        left = self.budget.check()
        try:
            self._conn.execute(f"PRAGMA busy_timeout = {max(1, int(left * 1000))}")
            cursor = self._conn.execute(sql, params)
            try:
                return cursor.fetchall()
            finally:
                cursor.close()
        except sqlite3.OperationalError as exc:
            raise Unavailable(_classify(exc)) from None
        except sqlite3.DatabaseError:
            raise Unavailable("error") from None


def _classify(exc: sqlite3.OperationalError) -> str:
    text = str(exc).lower()
    if "interrupted" in text:
        return "timeout"
    if "locked" in text or "busy" in text:
        return "busy"
    if "unable to open" in text:
        # The file exists (checked before connecting), so this is access: an
        # unreadable file, or a WAL database on a read-only mount.
        return "cannot_open"
    return "error"
