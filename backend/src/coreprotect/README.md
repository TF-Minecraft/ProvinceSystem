# CoreProtect reader

The staff panel's player pages read the Minecraft server's live CoreProtect
SQLite database: who has played, their sessions, and their recent actions.
`src/auth/players.py` joins that with `discord_links`, `users` and
`character_roster`; the routes are `GET /admin/players`,
`/admin/players/{uuid}`, `/sessions` and `/activity` (`view_players`, mod and
above). Movement, `GET /admin/players/{uuid}/movement` and `/admin/movement`
for everyone, is for admins and the owner (`view_player_movement`).

## Settings

| Variable | Meaning |
| --- | --- |
| `COREPROTECT_DB` | Path to `database.db` inside the backend container. Unset: the directory still lists linked players and characters, and CoreProtect sections say they are unavailable. |
| `COREPROTECT_SERVER` | Short id that scopes caches and page cursors (default `main`). |
| `COREPROTECT_SERVER_LABEL` | World name shown with the data, for example `Vardera`. |
| `COREPROTECT_PING_SECONDS` | The server's `player-pings` interval (default 60; `0` if pings are off). Used to guess whether someone is online, to end crashed sessions and to tell a gap in a movement path. |
| `COREPROTECT_MAP_WORLD` | The CoreProtect world the site's map shows: the server's `level-name` (default `TFMC_Map`). Movement in other worlds is summarised, not drawn. |

Mount the CoreProtect **directory** read-only, so SQLite can see a hot
`-journal`. Set `disable-wal: true` in CoreProtect's `config.yml` (then
`/co reload`): our fork uses WAL by default, and through a read-only mount
SQLite can open a WAL database only while its `-wal` and `-shm` files already
exist. CoreProtect closes its connections between batches, which removes
them, so in WAL mode the site mostly reports `cannot_open`. The option is
appended to `config.yml` once and applied on every start or reload; CoreProtect
only ever appends missing options to that file, so updates keep it. The paths are host-specific, so they belong in the host's
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

With `disable-wal: true` the database uses a rollback journal, so a
reader's lock holds off CoreProtect's commits. `reader.py` explains the guards: autocommit, one
reader per process, a 1.5 s budget per request (waiting for the lock
included), and every statement fully fetched before the next. The backend
runs as one uvicorn process; running more would need the reader limit
shared between them. Never open the file with `immutable=1`: on Main that
read torn pages while CoreProtect wrote.

Candidate scans are indexed seeks by player; final-page metadata reads use
row IDs. The only whole-table reads are the small tables holding
CoreProtect names, including `co_user` and `co_username_log` (a few hundred
to a few thousand rows). Activity pages examine at most `SCAN_LIMIT` rows per
table, so a sparse filter stops early and returns a cursor to continue
(`searched_to`).

## What is shown

For moderators, chat is never read and commands are cut to their first word
inside SQL. Admins and the owner (`view_player_messages`) also get chat and
whole commands, each cut to 512 characters; every page that shows any is
recorded in `admin_audit` as `player.messages.view` (which rows, never the
text) before it is returned, and the page is refused if that record cannot
be written. Sign text is never selected. After selecting the final activity page,
point reads
fetch at most 64 KiB per item, entity, or identity blob for displayed rows. After closing the
reader, a bounded, read-only Java-stream/NBT decoder extracts only custom names
and MMOItems type/ID; raw metadata, lore, and other tags never enter API responses.
Decompression is capped at 256 KiB, with depth and node limits. Malformed,
oversized, or unsupported metadata retains the vanilla label.

Item and container labels include the recorded MMOItems identity beside the
saved name (including alloys). Named vanilla items are explicitly marked renamed.
Historical mob kills show their saved name as a name, not a proven mob type. New
kills from the custom-identity CoreProtect build additionally show the MythicMobs
ID from the `coreprotect:mythic` block-metadata marker. No history rewrite is
needed. Custom-ID search and ItemsAdder block identity are outside this change.

Sessions are rebuilt from login, logout and ping rows; see `sessions.py` for how crashed sessions end.

Movement is a player's session rows in a window (up to 7 days for one
player, 24 hours for everyone): logins, logouts and a position ping once a
minute, so the path between pings is a guess. Every request is recorded as
`player.movement.view` (who, which player or everyone, the window and how
many rows, never positions) before it is returned, and refused if that
record cannot be written. Rows are read newest first in batches of 5,000,
one statement each; a window holding more than the limit keeps the newest
rows and reports `complete_from`.

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

- Movement, inside Main's backend container (60 requests): everyone over
  24 h (26,900 rows, 10 statements) 33 ms per request, longest statement
  58 ms, usually under 8 ms; one player over 7 days (3,155 rows) 4 ms. Do
  not time live reads through `~/work/amp-readonly`: it is a FUSE mount that
  does not pass file locks through, so SQLite sees CoreProtect's journal as
  hot and fails with "attempt to write a readonly database".

- `hold` on live Main (7.4 GB, 242 players, 1,455 requests): p99 8.6 ms,
  max 18.5 ms.
- `contend` on a 6.5 GB synthetic Main, one reader (as in production):
  writer p99 +10 ms, max +18 ms, no failures, no reader errors.
- Three readers making back-to-back requests: writer p99 +18 ms, max
  +14 ms, throughput −5%, no writer failures; 2% of reader requests gave
  up as busy or out of budget. The synthetic writer spills its cache on
  every batch, so this is harsher than CoreProtect.
