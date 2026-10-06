# CoreProtect reader

The staff panel's player pages read the Minecraft server's live CoreProtect
SQLite database: who has played, their sessions, and their recent actions.
`src/auth/players.py` joins that with `discord_links`, `users` and
`character_roster`; the routes are `GET /admin/players`,
`/admin/players/{uuid}`, `/sessions` and `/activity` (`view_players`, mod and
above).

## Settings

| Variable | Meaning |
| --- | --- |
| `COREPROTECT_DB` | Path to `database.db` inside the backend container. Unset: the directory still lists linked players and characters, and CoreProtect sections say they are unavailable. |
| `COREPROTECT_SERVER` | Short id that scopes caches and page cursors (default `main`). |
| `COREPROTECT_SERVER_LABEL` | World name shown with the data, for example `Vardera`. |
| `COREPROTECT_PING_SECONDS` | The server's `player-pings` interval (default 60; `0` if pings are off). Only used to guess whether someone is online and to end crashed sessions. |

Mount the CoreProtect **directory** read-only, so SQLite can see a hot
`-journal`. The paths are host-specific, so they belong in the host's
`docker-compose.override.yml`, not the repository's compose files:

```yaml
services:
  backend:
    volumes:
      - /home/amp/.ampdata/instances/TFMCMain01/Minecraft/plugins/CoreProtect:/coreprotect:ro
    environment:
      - COREPROTECT_DB=/coreprotect/database.db
      - COREPROTECT_SERVER=main
      - COREPROTECT_SERVER_LABEL=Vardera
```

Docker resolves the bind as root, so the AMP tree needs no permission
changes. The mount also exposes CoreProtect's `config.yml`, which holds
connection settings for database engines the server does not use.

## Keeping CoreProtect's writer unblocked

The database uses a rollback journal, so a reader's lock holds off
CoreProtect's commits. `reader.py` explains the guards: autocommit, one
reader per process, a 1.5 s budget per request (waiting for the lock
included), and every statement fully fetched before the next. The backend runs as one uvicorn process; running
more would need the reader limit shared between them. Never open the file
with `immutable=1`: on Main that read torn pages while CoreProtect wrote.

Every query is an indexed seek by player, except small whole-table reads of
CoreProtect's name tables, `co_user` and `co_username_log` (a few hundred
to a few thousand rows). Activity pages examine at most `SCAN_LIMIT` rows per
table, so a sparse filter stops early and returns a cursor to continue
(`searched_to`).

## What is shown

Chat is never read. Commands are cut to their first word inside SQL, and sign
text, item metadata and NBT are not selected. Sessions are rebuilt from
login, logout and ping rows; see `sessions.py` for how crashed sessions end.

## Deployment gate

`backend/benchmarks/coreprotect_reader.py` measures both sides:

```sh
# Lock hold time per request against a live database (opens it immutable, benchmark only)
python3 benchmarks/coreprotect_reader.py hold --no-lock /path/to/database.db
# A disposable database at Main's size, then writer impact on it (contend writes)
python3 benchmarks/coreprotect_reader.py synth /tmp/main-synth.db
python3 benchmarks/coreprotect_reader.py contend /tmp/main-synth.db --readers 1
```

Acceptance: `hold` p99 ≤ 100 ms and max ≤ 500 ms; `contend` with no writer
failures and writer transaction p99/max up by no more than 100/500 ms.

Results on 2026-10-06:

- `hold` on live Main (7.4 GB, 242 players, 1,455 requests): p99 8.6 ms,
  max 18.5 ms.
- `contend` on a 6.5 GB synthetic Main, one reader (as in production):
  writer p99 +10 ms, max +18 ms, no failures, no reader errors.
- Three readers making back-to-back requests: writer p99 +18 ms, max
  +14 ms, throughput −5%, no writer failures; 2% of reader requests gave
  up as busy or out of budget. The synthetic writer spills its cache on
  every batch, so this is harsher than CoreProtect.
