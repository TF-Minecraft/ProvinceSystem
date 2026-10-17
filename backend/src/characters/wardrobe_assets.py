"""Coordinate wardrobe files with their database writes across workers.

Compaction and realm cleanup touch several slots, so every wardrobe mutation
takes the same short asset guard. MineSkin signing happens before this guard.
File replacements are atomic and restored if the matching transaction fails.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from pathlib import Path

from src import database
from src.scripts.util.atomic import _write_atomic
from src.scripts.util.maplock import map_lock

_changes = ContextVar("wardrobe_file_changes", default=None)


@contextmanager
def asset_guard():
    from src.characters import wardrobe

    with map_lock(str(wardrobe.WARDROBE_DIR / ".mutations.lock")):
        yield


def guarded(fn):
    @wraps(fn)
    def call(*args, **kwargs):
        with asset_guard():
            return fn(*args, **kwargs)
    return call


def _remember(path: Path) -> None:
    changes = _changes.get()
    if changes is not None and path not in changes:
        changes[path] = path.read_bytes() if path.is_file() else None


def write_png(path: Path, data: bytes) -> None:
    _remember(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _write_atomic(str(path), data, prefix=".wardrobe-")


def delete_png(path: Path) -> None:
    _remember(path)
    path.unlink(missing_ok=True)


@contextmanager
def asset_transaction():
    with asset_guard():
        changes = {}
        token = _changes.set(changes)
        try:
            with database.connect() as conn:
                yield conn
        except BaseException:
            for path, previous in reversed(list(changes.items())):
                if previous is None:
                    path.unlink(missing_ok=True)
                else:
                    _write_atomic(str(path), previous, prefix=".wardrobe-")
            raise
        finally:
            _changes.reset(token)
