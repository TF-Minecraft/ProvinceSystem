"""One exclusive, cross-process lock per (map, subsystem) tree.

`atomic._day_lock` serialises captures of the same (map, day) *inside this
process*, which is all a capture ever needed. The destructive ops need more:
`chronicle/wipe.py` archives index rows, renames the day tree aside and then
deletes the rows, and a capture landing between any two of those steps writes a
live row (or a day directory) that the next step orphans or deletes with no
archive copy. A `threading.Lock` cannot see the second uvicorn worker, and the
CLI (`python -m src.scripts.chronicle.wipe`) is a different process entirely.

The filesystem tree and its index must change together across processes. A
file lock covers directory renames as well as database work without holding a
long database transaction. `msvcrt` and `fcntl` cover the supported platforms.

The lock is *reentrant per thread*: `reindex_map` holds it across its whole loop
while each `promote_day` inside takes it again, and the staff routes take it
before calling `perform_wipe`, which takes it too. Each entry pairs a
`threading.RLock` (which excludes other threads here and gives the reentrancy)
with the OS lock taken once at depth 0 (which excludes other processes).
"""

from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from typing import Iterator

try:  # POSIX
    import fcntl
except ImportError:  # pragma: no cover - Windows
    fcntl = None  # type: ignore[assignment]

try:  # Windows
    import msvcrt
except ImportError:  # pragma: no cover - POSIX
    msvcrt = None  # type: ignore[assignment]

# Long enough that a wipe of a real chronicle finishes underneath a capture that
# is waiting on it, short enough that a wedged holder surfaces as an error
# instead of a hung threadpool worker.
DEFAULT_TIMEOUT = 30.0

# How often a blocked waiter re-tries the OS lock. `fcntl.flock` could block in
# the kernel, but `msvcrt.locking` has no unbounded blocking mode, so both
# platforms poll and the timeout means the same thing on each.
_POLL_SECONDS = 0.01


class MapLockBusy(RuntimeError):
    """The lock is held elsewhere and this caller declined (or ran out of time)."""


class _Entry:
    __slots__ = ("path", "rlock", "depth", "fd")

    def __init__(self, path: str) -> None:
        self.path = path
        self.rlock = threading.RLock()
        self.depth = 0
        self.fd: int | None = None


_ENTRIES_GUARD = threading.Lock()
_ENTRIES: dict[str, _Entry] = {}


def _entry(path: str) -> _Entry:
    key = os.path.abspath(path)
    with _ENTRIES_GUARD:
        entry = _ENTRIES.get(key)
        if entry is None:
            entry = _Entry(key)
            _ENTRIES[key] = entry
        return entry


def _try_os_lock(fd: int) -> bool:
    """One non-blocking attempt at the OS lock. False when someone else holds it."""
    try:
        if msvcrt is not None:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        elif fcntl is not None:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:  # pragma: no cover - no platform lacks both
            raise MapLockBusy("No file locking primitive available on this platform")
        return True
    except OSError:
        return False


def _release_os_lock(fd: int) -> None:
    try:
        if msvcrt is not None:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        elif fcntl is not None:
            fcntl.flock(fd, fcntl.LOCK_UN)
    except OSError:
        # Closing the descriptor drops the lock regardless; a failure here would
        # otherwise leak the fd and wedge the lock for the life of the process.
        pass


def _open_lock_file(path: str) -> int:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    # The file is a pure rendezvous point: never read, never written, and left
    # behind on purpose so the next acquire does not race on creating it.
    return os.open(path, os.O_RDWR | os.O_CREAT, 0o644)


@contextmanager
def map_lock(
    lock_path: str,
    *,
    blocking: bool = True,
    timeout: float | None = None,
) -> Iterator[None]:
    """Hold `lock_path` exclusively against every thread and every process.

    `blocking=False` raises `MapLockBusy` immediately when the lock is held —
    the staff routes' "already running" answer. Otherwise the caller waits up to
    `timeout` seconds (`DEFAULT_TIMEOUT` when None) and raises `MapLockBusy` if
    it never comes free.
    """
    entry = _entry(lock_path)
    limit = DEFAULT_TIMEOUT if timeout is None else float(timeout)
    # One deadline for both halves of the acquire. Timing the in-process RLock
    # and then the OS lock from a fresh clock let a caller wait up to 2x what it
    # asked for, which for a threadpool worker is 2x the time it is unavailable.
    deadline = time.monotonic() + limit

    if blocking:
        got = entry.rlock.acquire(timeout=limit)
    else:
        got = entry.rlock.acquire(blocking=False)
    if not got:
        raise MapLockBusy(f"Lock '{lock_path}' is held by another operation")

    took_os_lock = False
    try:
        if entry.depth == 0:
            fd = _open_lock_file(entry.path)
            while True:
                if _try_os_lock(fd):
                    break
                if not blocking or time.monotonic() >= deadline:
                    os.close(fd)
                    raise MapLockBusy(
                        f"Lock '{lock_path}' is held by another process"
                    )
                time.sleep(_POLL_SECONDS)
            entry.fd = fd
            took_os_lock = True
        entry.depth += 1
    except BaseException:
        entry.rlock.release()
        raise

    try:
        yield
    finally:
        entry.depth -= 1
        if took_os_lock:
            fd = entry.fd
            entry.fd = None
            if fd is not None:
                _release_os_lock(fd)
                os.close(fd)
        entry.rlock.release()
