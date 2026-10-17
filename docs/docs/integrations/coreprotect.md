# CoreProtect reader

[Project index](../../README.md) · [Source module](../../../backend/src/coreprotect)

Bare filenames below refer to `backend/src/coreprotect/` in the TFMCWeb checkout; paths beginning with `src/` are relative to `backend/`.

The staff panel's player pages read the Minecraft server's live CoreProtect
SQLite database: who has played, their sessions, and their recent actions.
`src/auth/players.py` joins that with `discord_links`, `users` and
`character_roster`; the routes are `GET /admin/players`,
`/admin/players/{uuid}`, `/sessions` and `/activity` (`view_players`, mod and
above). Movement, `GET /admin/players/{uuid}/movement` and `/admin/movement`
for everyone, is for admins and the owner (`view_player_movement`). Admins can
also [view the site as a player](../identity/auth-security.md#viewing-as-a-player)
from that player's page.

## Settings

| Variable | Meaning |
| --- | --- |
| `COREPROTECT_DB` | Path to `database.db` inside the backend container. Unset: the directory still lists linked players and characters, and CoreProtect sections say they are unavailable. |
| `COREPROTECT_SERVER` | Short id that scopes caches and page cursors (default `main`). |
| `COREPROTECT_SERVER_LABEL` | World name shown with the data, for example `Vardera`. |
| `COREPROTECT_PING_SECONDS` | The server's `player-pings` interval (default 60; `0` if pings are off). Used to guess whether someone is online, to end crashed sessions and to tell a gap in a movement path. |
| `COREPROTECT_MAP_WORLD` | The CoreProtect world the site's map shows: the server's `level-name` (default `TFMC_Map`). Movement in other worlds is summarised, not drawn. |

Mount the CoreProtect **directory** read-only, so SQLite can see a hot
`-journal`. Set `disable-wal: true` in CoreProtect's `config.yml` (then restart the Minecraft application through the deployment procedure): our fork uses WAL by default, and through a read-only mount
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
needed. Custom-ID search and ItemsAdder block identity are not supported.

Each activity entry also carries `target_info`: the name the panel shows
(`Short Grass`, not `short_grass`), where it came from (vanilla, MMOItems,
MythicMobs, a player) and the ids behind it. Vanilla names come from
Minecraft's own `en_us.json`, which is Mojang's to publish, not ours: the
backend image runs `scripts/build_minecraft_names.py` to fetch the pinned
client jar, check its SHA-1 and keep the block, item and entity names
(about 94 KB) in `data/minecraft_names.json`, which git ignores. Bump the
pinned version there when the server updates. Without the file, ids are
tidied instead. Block changes use block names (`wheat` is "Wheat Crops"),
items use item names ("Wheat"); only `minecraft:` ids are looked up.
Activity responses also return `server_label` and `map_world`, so the panel
calls the map's world by its name (Vardera). The panel merges consecutive
changes to the same block within a minute into one row; the API does not.

RPCharacters chat sent by command (`/looc hi`, `/fooc`, `/me`, `/shout`…;
the aliases are `CHANNELS` in `activity.py`, from Main's `chat.yml`) is chat:
for admins it comes back as kind `chat` with its `channel` and the text after
the command, under the Chat filter and audited like chat; moderators still get
only the command word, with the `channel` named. Plain chat goes to the
player's current channel, which CoreProtect does not record, so it is worked
out (`channel_inferred`): RPCharacters keeps the channel picked with
`/channel <name>` in memory until the player quits, so a line's channel is
the last valid switch since their latest login, else RP. That looks back at
most 5,000 commands; further than that, or with no login recorded, the
channel is left unknown. Character-creation answers typed in chat are not
channel chat but are labelled as if they were.

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

Run these commands from `backend/` in the source checkout.

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

Time live reads against the real file, inside the backend container or with `sudo sqlite3 -readonly` on the host. A FUSE view such as bindfs does not pass file locks through, so SQLite can report a hot journal and fail with `attempt to write a readonly database`. Record timings and source revisions in the deployment PR or external test lab.
