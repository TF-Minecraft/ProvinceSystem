"""Deployment gate for the staff panel's CoreProtect reads.

hold <database.db>
    Times every player's profile, sessions and activity reads (default and
    sparse kind filters) and the directory build, through the real reader.
    On a live server database pass --no-lock: it opens the file immutable,
    so CoreProtect is never locked, and an occasional torn-page error is
    counted rather than fatal. The time each request spends in CoreProtect
    is how long a production request would hold its read lock.

synth <new.db>
    Builds a disposable database with the fork's schema at Main's size on
    2026-10-06 (23.6M block rows, 3.0M container, 3.3M item, 242 players,
    skewed so a few builders own most rows, with one-second bursts), for
    contend. Copying the live file would lock CoreProtect for the whole copy.

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
    # Setup only: retry while a writer holds the lock, as a page reload would.
    for _ in range(100):
        try:
            with Reader(config, Budget(30)) as r:
                return [row["id"] for row in r.rows("SELECT id FROM co_user WHERE uuid IS NOT NULL")]
        except Unavailable:
            time.sleep(0.1)
    raise SystemExit("CoreProtect stayed locked")


SYNTH_ROWS = {"co_block": 23_600_000, "co_container": 2_960_000, "co_item": 3_300_000, "co_command": 221_000,
              "co_sign": 8_200, "co_entity_interaction": 92_000}
SYNTH_PLAYERS = 242


def synth(args) -> None:
    schema = (Path(__file__).resolve().parents[1] / "src/coreprotect/testdata/schema.sql").read_text()
    conn = sqlite3.connect(args.database, isolation_level=None)
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    conn.executescript(schema)
    indexes = [row[0] for row in conn.execute("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")]
    for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").fetchall():
        conn.execute(f"DROP INDEX {name}")
    conn.executemany("INSERT INTO co_user (id, time, user, uuid) VALUES (?, 0, ?, ?)",
                     [(i, f"Player{i}", f"00000000-0000-4000-8000-{i:012d}") for i in range(1, SYNTH_PLAYERS + 1)])
    conn.execute("INSERT INTO co_world (id, world) VALUES (1, 'TFMC_Map')")
    conn.executemany("INSERT INTO co_material_map (id, material) VALUES (?, ?)", [(i, f"minecraft:m{i}") for i in range(1, 1316)])
    conn.executemany("INSERT INTO co_entity_map (id, entity) VALUES (?, ?)", [(i, f"e{i}") for i in range(1, 36)])
    # A skewed player (the product of two uniforms favours low ids) and a time that advances with the row,
    # in bursts of up to 500 rows sharing one second, over 17 days.
    user = f"1 + CAST({SYNTH_PLAYERS - 1} * (abs(random()) / 9.3e18) * (abs(random()) / 9.3e18) AS INTEGER)"
    t0 = 1_789_836_708

    def fill(table, columns, values):
        n = SYNTH_ROWS[table]
        conn.execute(
            f"INSERT INTO {table} ({columns}) WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < {n}) "
            f"SELECT {values} FROM c")
        print(f"{table}: {n} rows", flush=True)

    when = f"{t0} + (i * 1468800 / {{n}}) - (i * 1468800 / {{n}}) % (1 + abs(random()) % 3)"
    fill("co_block", "time, user, wid, x, y, z, type, data, meta, blockdata, action, rolled_back",
         f"{when.format(n=SYNTH_ROWS['co_block'])}, {user}, 1, abs(random()) % 9000, 64, abs(random()) % 9000, "
         "1 + abs(random()) % 1315, 0, NULL, randomblob(150), "
         "CASE abs(random()) % 100 WHEN 0 THEN 3 WHEN 1 THEN 13 WHEN 2 THEN 2 ELSE abs(random()) % 2 END, 0")
    fill("co_container", "time, user, wid, x, y, z, type, data, amount, metadata, action, rolled_back",
         f"{when.format(n=SYNTH_ROWS['co_container'])}, {user}, 1, 1, 64, 1, 1 + abs(random()) % 1315, 0, "
         "1 + abs(random()) % 64, randomblob(40), abs(random()) % 2, 0")
    fill("co_item", "time, user, wid, x, y, z, type, data, amount, action, rolled_back",
         f"{when.format(n=SYNTH_ROWS['co_item'])}, {user}, 1, 1, 64, 1, 1 + abs(random()) % 1315, randomblob(40), "
         "1 + abs(random()) % 64, abs(random()) % 13, 0")
    fill("co_command", "time, user, wid, x, y, z, message",
         f"{when.format(n=SYNTH_ROWS['co_command'])}, {user}, 1, 1, 64, 1, "
         "CASE abs(random()) % 10 WHEN 0 THEN '[skill] Blink (blink)' ELSE '/home base ' || hex(randomblob(8)) END")
    fill("co_sign", "time, user, wid, x, y, z, action, color, color_secondary, data, waxed, face, line_1",
         f"{when.format(n=SYNTH_ROWS['co_sign'])}, {user}, 1, 1, 64, 1, abs(random()) % 3, 0, 0, 0, 0, 0, 'x'")
    fill("co_entity_interaction", "time, user, entity_spawn_rowid, wid, x, y, z, type, action, metadata, rolled_back",
         f"{when.format(n=SYNTH_ROWS['co_entity_interaction'])}, {user}, 1, 1, 1, 64, 1, 1 + abs(random()) % 35, "
         "abs(random()) % 4, NULL, 0")
    # Sessions: each player logs in, pings once a minute for a while, and logs out (some never do).
    conn.execute(
        "INSERT INTO co_session (time, user, wid, x, y, z, action) "
        "WITH RECURSIVE s(n, u, t) AS (SELECT 1, 1, 0 UNION ALL SELECT n + 1, 1 + n % 242, "
        f"(n / 242) * 21600 + abs(random()) % 3600 FROM s WHERE n < 16000), "
        "p(n, u, t, k, len) AS (SELECT n, u, t, 0, 1 + abs(random()) % 90 FROM s UNION ALL "
        "SELECT n, u, t, k + 1, len FROM p WHERE k <= len) "
        f"SELECT {t0} + t + k * 60, u, 1, 0, 64, 0, CASE WHEN k = 0 THEN 1 WHEN k > len THEN "
        "(CASE WHEN n % 7 = 0 THEN 2 ELSE 0 END) ELSE 2 END FROM p")
    print(f"co_session: {conn.execute('SELECT COUNT(*) FROM co_session').fetchone()[0]} rows", flush=True)
    for sql in indexes:
        conn.execute(sql)
    print("indexes built", flush=True)
    conn.execute("PRAGMA journal_mode = DELETE")
    conn.close()


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

    def second_pages(r):
        first = sessions.fetch(r, [uid], None, 20)
        if first["next"]:
            sessions.fetch(r, [uid], first["next"], 20)
        names = maps.get(r)
        page = activity.fetch(r, names, [uid], activity.KINDS, None, 20)
        if page["next"]:
            activity.fetch(r, names, [uid], activity.KINDS, page["next"], 20)

    return [("profile", profile), ("sessions", session_page), ("activity", feed(activity.KINDS)),
            ("activity:skill", feed(("skill",))), ("activity:sign", feed(("sign",))),
            ("activity:kill", feed(("kill",))), ("second pages", second_pages)]


def _directory(r):
    rows = r.rows("SELECT id FROM co_user WHERE uuid IS NOT NULL")
    r.rows("SELECT uuid, user FROM co_username_log")
    for row in rows:
        sessions.last_event(r, [row["id"]])


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

    for _ in range(3):
        seconds, error = _timed(config, _directory)
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
    # A directory rebuild every so often, as its cache expires.
    requests[::50] = [_directory] * len(requests[::50])
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
        latencies, failures, rows = out.get(timeout=args.seconds * 10)
        writer.join()
        reader_results = [reads.get(timeout=args.seconds * 10) for _ in hammers]
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
    sub.add_parser("synth").add_argument("database")
    c = sub.add_parser("contend")
    c.add_argument("database")
    c.add_argument("--seconds", type=float, default=20)
    c.add_argument("--batch", type=int, default=500)
    c.add_argument("--readers", type=int, default=1)
    args = parser.parse_args()
    {"hold": hold, "synth": synth, "contend": contend}[args.command](args)


if __name__ == "__main__":
    main()
