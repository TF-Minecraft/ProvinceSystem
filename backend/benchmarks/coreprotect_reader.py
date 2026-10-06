"""Deployment gate for the staff panel's CoreProtect reads.

hold <database.db>
    Times every player's profile, sessions and activity reads (default and
    sparse kind filters) and the directory build, through the real reader.
    On a live server database pass --no-lock: it opens the file immutable,
    so CoreProtect is never locked, and an occasional torn-page error is
    counted rather than fatal. The time each request spends in CoreProtect
    is how long a production request would hold its read lock.

contend <copy-of-database.db>
    Runs a CoreProtect-like writer (batched inserts, small cache so pages
    spill mid-transaction, a 3 s busy timeout like sqlite-jdbc) in another
    process, first alone and then while readers make back-to-back staff
    requests. Reports writer transaction latency, throughput and failures.
    Never point this at a live database: it writes.

Acceptance (agreed before running): hold p99 <= 100 ms and max <= 500 ms per
request; contend shows no writer failures, and writer transaction p99 and
max grow by no more than 100 ms and 500 ms respectively with readers on.
"""
from __future__ import annotations

import argparse
import multiprocessing as mp
import os
import sqlite3
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.coreprotect import activity, maps, sessions  # noqa: E402
from src.coreprotect.reader import Budget, CoreProtectConfig, Reader, Unavailable  # noqa: E402


def _config(path: str) -> CoreProtectConfig:
    return CoreProtectConfig(path=path, server="bench", label="", ping_seconds=60)


def _no_lock() -> None:
    """Open the reader's connections immutable (benchmark only: never in the site)."""
    original = sqlite3.connect

    def connect(target, *args, **kwargs):
        if isinstance(target, str) and target.endswith("?mode=ro"):
            target += "&immutable=1"
        return original(target, *args, **kwargs)

    sqlite3.connect = connect


def _ids(config):
    with Reader(config, Budget(30)) as r:
        rows = r.rows("SELECT id FROM co_user WHERE uuid IS NOT NULL")
    return [row["id"] for row in rows]


def _requests(config, uid):
    """The CoreProtect part of each staff request for one player."""
    def profile(r):
        r.rows("SELECT id, user, time FROM co_user WHERE id = ?", (uid,))
        sessions.last_event(r, [uid])
        r.rows("SELECT MIN(time) AS first FROM co_session WHERE user = ?", (uid,))

    def session_page(r):
        sessions.fetch(r, [uid], None, 20)

    def feed(kinds):
        def run(r):
            activity.fetch(r, maps.get(r), [uid], kinds, None, 20)
        return run

    return [("profile", profile), ("sessions", session_page), ("activity", feed(activity.KINDS)),
            ("activity:skill", feed(("skill",))), ("activity:sign", feed(("sign",))),
            ("activity:kill", feed(("kill",)))]


def _timed(config, work) -> tuple[float, str | None]:
    started = time.perf_counter()
    try:
        with Reader(config, Budget()) as r:
            work(r)
        return time.perf_counter() - started, None
    except Unavailable as exc:
        return time.perf_counter() - started, exc.code


def _summary(label, samples):
    if not samples:
        return f"{label}: no samples"
    ordered = sorted(samples)
    p99 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.99))]
    return (f"{label}: n={len(ordered)} p50={statistics.median(ordered) * 1000:.1f}ms "
            f"p99={p99 * 1000:.1f}ms max={ordered[-1] * 1000:.1f}ms")


def hold(args) -> None:
    if args.no_lock:
        _no_lock()
    config = _config(args.database)
    ids = _ids(config)[: args.players or None]
    by_kind: dict[str, list[float]] = {}
    errors: dict[str, int] = {}
    for uid in ids:
        for name, work in _requests(config, uid):
            seconds, error = _timed(config, work)
            by_kind.setdefault(name, []).append(seconds)
            if error:
                errors[f"{name}:{error}"] = errors.get(f"{name}:{error}", 0) + 1

    def directory(r):
        rows = r.rows("SELECT id FROM co_user WHERE uuid IS NOT NULL")
        r.rows("SELECT uuid, user FROM co_username_log")
        for row in rows:
            sessions.last_event(r, [row["id"]])

    for _ in range(3):
        seconds, error = _timed(config, directory)
        by_kind.setdefault("directory", []).append(seconds)
        if error:
            errors[f"directory:{error}"] = errors.get(f"directory:{error}", 0) + 1
    print(f"players: {len(ids)}")
    for name, samples in by_kind.items():
        print(_summary(name, samples))
    print(_summary("all requests", [s for samples in by_kind.values() for s in samples]))
    print(f"errors: {errors or 'none'}")


def _writer(path, seconds, batch, out):
    conn = sqlite3.connect(path, timeout=3, isolation_level=None)
    conn.execute("PRAGMA cache_size = 64")
    user = conn.execute("SELECT MIN(id) FROM co_user").fetchone()[0] or 1
    latencies, failures, rows = [], 0, 0
    stop = time.monotonic() + seconds
    t = int(time.time())
    while time.monotonic() < stop:
        started = time.perf_counter()
        try:
            conn.execute("BEGIN")
            conn.executemany(
                "INSERT INTO co_block (time, user, wid, x, y, z, type, data, meta, blockdata, action, rolled_back) "
                "VALUES (?, ?, 1, ?, 64, ?, 1, 0, NULL, NULL, 0, 0)",
                [(t, user, i, i) for i in range(batch)])
            conn.executemany("INSERT INTO co_session (time, user, wid, x, y, z, action) VALUES (?, ?, 1, 0, 64, 0, 2)",
                             [(t, user)] * 5)
            conn.execute("COMMIT")
            rows += batch
            latencies.append(time.perf_counter() - started)
        except sqlite3.OperationalError:
            failures += 1
            try:
                conn.execute("ROLLBACK")
            except sqlite3.OperationalError:
                pass
        t += 1
        time.sleep(0.05)
    conn.close()
    out.put((latencies, failures, rows))


def _hammer(path, seconds, out):
    config = _config(path)
    ids = _ids(config)
    requests = [work for uid in ids for _, work in _requests(config, uid)]
    done, errors, i = 0, {}, 0
    stop = time.monotonic() + seconds
    while time.monotonic() < stop:
        _, error = _timed(config, requests[i % len(requests)])
        i += 1
        done += 1
        if error:
            errors[error] = errors.get(error, 0) + 1
    out.put((os.getpid(), done, errors))


def contend(args) -> None:
    for phase, readers in (("writer alone", 0), ("writer + readers", args.readers)):
        out, reads = mp.Queue(), mp.Queue()
        writer = mp.Process(target=_writer, args=(args.database, args.seconds, args.batch, out))
        hammers = [mp.Process(target=_hammer, args=(args.database, args.seconds, reads)) for _ in range(readers)]
        writer.start()
        for h in hammers:
            h.start()
        latencies, failures, rows = out.get()
        writer.join()
        reader_results = [reads.get() for _ in hammers]
        for h in hammers:
            h.join()
        print(_summary(f"{phase}: write txn", latencies))
        print(f"{phase}: failures={failures} rows/s={rows / args.seconds:.0f}")
        for pid, done, errors in reader_results:
            print(f"{phase}: reader {pid} requests={done} errors={errors or 'none'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    h = sub.add_parser("hold")
    h.add_argument("database")
    h.add_argument("--no-lock", action="store_true")
    h.add_argument("--players", type=int, default=0)
    c = sub.add_parser("contend")
    c.add_argument("database")
    c.add_argument("--seconds", type=float, default=20)
    c.add_argument("--batch", type=int, default=500)
    c.add_argument("--readers", type=int, default=1)
    args = parser.parse_args()
    hold(args) if args.command == "hold" else contend(args)


if __name__ == "__main__":
    main()
