# Economy ledger

SimpleFactions POSTs an economy snapshot (faction wealth, prestige, guild data) to
`POST /{map}/data/upload/chronicle` every 300s per map. TFMCWeb partitions
these into a raw + daily-canonical series and serves them for the timelapse
studio's right-hand chart panel.

**See also:** [`backend/src/scripts/chronicle/`](../../../backend/src/scripts/chronicle) (map timelapse itself) ·
[integrations/simplefactions.md](../integrations/simplefactions.md) (upload modes)

## Why `ledger`, not `chronicle`

`chronicle` already means the **map timelapse** in this repo — `scripts/chronicle/*`,
`output/{map}/chronicle/`, `map_chronicle_snapshots`, `/{map}/chronicle/*`. Reusing
it for economy data would make both features unreadable in the same codebase.

The economy series is named **`ledger`** everywhere on this side: the package
(`backend/src/scripts/ledger/`), the routes (`/{map}/ledger/*`), the tables
(`map_ledger_*`), the frontend libs (`ledgerData.ts`, `ledgerSeries.ts`).

`chronicle` survives only as the **upload mode string** — SimpleFactions POSTs to
`.../data/upload/chronicle` because the plugin owns that URL and changing it is a
Paper-side change out of scope here. It is pinned as `LEDGER_UPLOAD_MODE` in
`backend/src/scripts/ledger/schema.py` with a comment explaining the collision, so
the string is greppable rather than a mystery literal in `data_routes.py`.

## Payload shape

One snapshot: `schema_version`, `map_id`, `captured_at` (ISO instant), `server_day`,
`day_progress_seconds`, `complete`, `global{}`, `factions[]`, `guilds[]`, `events[]`
(always empty, discarded on ingest). See `backend/src/scripts/ledger/schema.py`
(`normalize_snapshot`) for the authoritative field list and types — the field
authority is SF's Java type (`ChronicleSnapshot.java`). The parser accepts
`rank`/`rank_level` in either order and logs a warning when it detects the swap
(`_faction_rank`).

Unknown extra keys are ignored (a plugin-side field addition should not 400 a whole
season) and non-finite floats (`NaN`/`Infinity`) are normalised to `null`, mirroring
`chronicle_routes._json_safe`.

`parse_instant` reads Java `Instant.toString()` timestamps such as
`2026-09-11T01:42:29.882157766Z` with `datetime.fromisoformat`, which needs
Python 3.11 or later (the backend image uses 3.12). Fractions beyond six digits
are truncated to microseconds. A timestamp it cannot read is rejected with HTTP 400
(`Unparsable captured_at`).

## `map_id` reconciliation: the URL wins, loudly

Every snapshot carries its own `map_id`, and it is **not** what the data is stored
under — the registry id resolved from the URL is. The payload's value is compared
against it case-insensitively (`data_routes.py`, ledger branch) and then one of
three things happens:

| Payload `map_id` | Result |
|------------------|--------|
| Matches the URL's registry id (any case) | Stored, silently |
| Names a **different registered map** | **409**, nothing written |
| Anything else — a display name, a world name, an id we don't know | Stored under the URL's id, with a warning logged |

Only the middle case is a refusal, and only because it is the one case where
accepting would corrupt *two* series: a snapshot misrouted from one map into
another's history is worse than a lost snapshot.

The third case looks like the one worth being strict about, and isn't. SF's
`map_id` is whatever the plugin calls that world; our registry ids come from
`maps.yml` and are ours. If those two spellings ever drift apart — a renamed
world, a registry id chosen for the URL rather than the server — strict rejection
would 4xx **every** snapshot, **every 5 minutes, forever**, and the only symptom
would be a season with no economy data in it. The upload is unconditional and
fire-and-forget on the plugin's side; nothing over there would notice or retry.
So a mismatch that cannot be misrouted is a naming difference, and a naming
difference is a log line, not a dropped season.

`normalize_snapshot` keeps the payload's value as `payload_map_id` for the route
to compare and never keys anything on it.

## Two time axes

Every snapshot carries two clocks, and they are not interchangeable:

| Field | What it is | Used to partition? |
|-------|------------|---------------------|
| `captured_at` | Wall-clock UTC instant the snapshot was taken | **Yes** — the UTC date of `captured_at` is the partition key everywhere |
| `server_day` | The in-game day counter | No — carried alongside, never used as a key |

`server_day` counts server *uptime*: it stops advancing while the server is down
and resumes on restart, so two snapshots eleven wall-clock days apart can be one
`server_day` apart if the server was offline for ten of them. Partitioning on it
would silently compress or stretch a season's calendar. `captured_at` is the only
axis a calendar chart, a daily rollup, or a cross-season comparison can trust.
Both are stored and exposed (`/ledger/index` returns `server_day_first/last`;
`/ledger/series` returns a parallel `server_day[]` column) so a chart can *show*
the in-game day without ever partitioning on it, and gaps are never interpolated
across.

## Faction identity: `(id, founded_at)`

A faction's `id` is derived from its name and **is reused** after the faction is
disbanded — a new faction founded with the same name gets the same `id`. Keying
storage on `id` alone would silently splice two unrelated nations' histories into
one line the moment the name is reused.

`faction_key` (`backend/src/scripts/ledger/schema.py`) is
`sha1(f"{id}\x00{founded_at}")`, hex-encoded — the NUL separator exists so
`("ab", "c")` and `("a", "bc")` cannot collide. Every stored row, every registry
entry, and every series response key off `faction_key`, never bare `id`. The
frontend has to resolve this back the other way: `focusNationId` in the timelapse
studio is a bare region/faction id, so `useLedgerSeries.ts`'s `resolveFactionKey`
picks whichever registry row (there can be more than one for the same `id`) best
overlaps the requested date range, falling back to the most recently founded one.

## Deletion is gated on `complete: true`

A faction absent from a snapshot means "deleted" **only** when that snapshot's
`complete` flag is `true`. The plugin can send partial snapshots (it ran out of
per-tick budget before enumerating every faction); absence in a partial snapshot
means "didn't get to it yet," not "gone."

`complete: true` is necessary but not sufficient, because a broken upload can
forge it two ways. A snapshot with **no `factions` key at all** — a truncated body,
a serialiser that stopped early — is refused outright (400): defaulting it to `[]`
would make a half-sent POST byte-for-byte identical to a genuine server-wide wipe,
which defeats the point of the gate. An *empty but present* `factions: []` is
accepted, because that is how an empty server reports itself. And a complete
snapshot whose `global.faction_count` disagrees with the length of its own
`factions` array — **or omits it, `global` included** — still indexes normally but
is marked `deletion_safe: false` and deletes nothing. A genuine SF complete
snapshot always carries the count; without it there is nothing to cross-check, and
treating that as "`complete` speaks for itself" would let a hand-built POST that
simply leaves `global` out stamp every live faction on the map deleted. The array
being short of what the server holds costs nothing to refuse — the next honest
snapshot is five minutes away.

### Payload bounds

Refusals, not truncations — a payload past any of these is answered 400 and
nothing is stored:

| Bound | Value | Why |
| --- | --- | --- |
| `captured_at` floor | `2020-01-01Z` | Predates SimpleFactions; a date below it is a broken clock or a hand-built payload |
| `captured_at` ceiling | receiving server's clock + 24h | The UTC date of `captured_at` is the partition key *and* the anchor the default range clamps against, so one snapshot dated `9999-12-31` becomes `days[-1]` and pushes every real day outside every default request — with no per-day delete route to undo it. A day of slack absorbs a badly-set plugin host clock |
| Breakdown keys | 64 per breakdown, 64 chars each | The game's component set is small and fixed. Every distinct key across a requested range becomes a full-length column in the `fields=full` response, so an unbounded dict planted once turns every later read into an unbounded allocation. Capped again on the read side so a row already in the DB cannot detonate one |
| Integers | signed 64-bit | Values outside PostgreSQL bigint range would fail background indexing after the POST answered 200. Out-of-range values are dropped like non-finite floats |
| Nesting | 32 levels | `json.loads` already refuses ~1000, but the recursive walks in `json_safe`/`json.dumps` run on top of the request's own stack; capping keeps a `[[[[…]]]]` body a 400 rather than a 500 |

`ingest.index_snapshot` only calls `store.mark_deleted` when that
`deletion_safe` flag is set, and `mark_deleted` further guards with
`last_seen_day <= day` so re-promoting an old (possibly partial) day can never
bury a faction that is alive in later days. A day whose canonical snapshot never
reported `complete: true` is still indexed and charted — it's flagged
`incomplete_days` in `/ledger/index` — but it never triggers a deletion.

## Storage layout

```
output/{map}/ledger/
  raw/{YYYY-MM-DD}/{HHMMSS}Z-{sha8}.json.gz   # every accepted snapshot, gzipped
  daily/{YYYY-MM-DD}.json.gz                   # one canonical snapshot per UTC day
```

- **Raw**: every snapshot that passes `normalize_snapshot` is written synchronously
  (`ingest.store_raw`) before the request returns 200 — it is the only durable copy
  of that 5-minute sample. The `sha8` in the filename hashes the packed bytes, so a
  retried, byte-identical snapshot overwrites its own file instead of duplicating.
- **Daily canonical**: promotion (`ingest.promote_day`, queued as a `BackgroundTask`
  after the raw write) picks **the latest `complete: true` snapshot of the UTC day**;
  if the day never reported complete, it falls back to the latest snapshot overall
  and the day is flagged `complete=0` in the index. Promotion scans a day's raw
  files newest-first and stops at the first complete one, so the common case reads
  exactly one of the day's ~288 files. A day that never reports complete has no
  such early exit and promotion runs on every upload, so files already read and
  found not-complete are memoised per day and skipped on the next pass — the
  newest file (the fallback) is always re-read.
- **PostgreSQL** (`backend/src/database/migrations/`) indexes the daily canonical only —
  raw files are never queried, just replayed by `reindex.py` if the index needs
  rebuilding.

**Retention: keep everything, no pruning.** Raw 5-minute snapshots are never
deleted. `ingest.prune_raw(map_id, keep_days)` exists as an unused helper for a
future ops decision — it is deliberately not called from anywhere, because
promotion is derived from raw and pruning it would be irreversible loss of the
5-minute resolution underneath the daily canonical.

### PostgreSQL tables

| Table | Key | Holds |
|-------|-----|-------|
| `map_ledger_days` | `(map_id, day)` | One canonical row per UTC day — `captured_at`, `server_day`, `complete`, counts, and the full `globals` JSONB data |
| `map_ledger_factions` | `(map_id, faction_key)` | The faction registry — `first_seen_*`/`last_seen_*`, latest name/rgb, `deleted_day`/`deleted_at` |
| `map_ledger_faction_days` | `(map_id, day, faction_key)` | Per-faction, per-day columns plus `wealth_breakdown`/`prestige_breakdown`/`subjects`/`wars` as JSON |
| `map_ledger_guild_days` | `(map_id, day, guild_id)` | Per-guild, per-day columns (guilds have no registry — see below) |

Indexes: `map_ledger_factions(map_id, faction_id)` and
`map_ledger_faction_days(map_id, faction_key, day)`.

**Guild identity is weak by design.** The payload carries no `founded_at` for
guilds, so a deleted-and-recreated guild reusing the same `id` reads as one
continuous series. There is no guild registry to catch this — documented
limitation, not a bug to fix here.

## Read routes

All four routes live in `backend/src/api/ledger_routes.py`, are gated by
`ensure_map_access`, and are plain `def` handlers (FastAPI runs them in the
threadpool, since every body is synchronous PostgreSQL + JSON — same reasoning as
`chronicle_routes.get_chronicle_index`).

| Route | Returns | Caps |
|-------|---------|------|
| `GET /{map}/ledger/index` | Every indexed day (first/last, `latest_complete_day`, `incomplete_days`, `server_day_first/last`) plus the full faction registry | — |
| `GET /{map}/ledger/series?start&end&factions=k,k&fields=core\|full` | Columnar series: shared `days[]` axis, `global{}` columns, per-faction blocks | Range ≤ 730 days, ≤ 40 faction keys (400 past either); default = top 12 by wealth on `latest_complete_day`; `fields=core` (default) omits breakdown maps, `fields=full` includes them |
| `GET /{map}/ledger/faction/{key}` | One faction's full series (always `fields=full`) plus `overlord`/`subjects`/`wars` history | — |
| `GET /{map}/ledger/day/{day}` | The raw gzip bytes of that day's canonical snapshot, streamed | — |

An explicit out-of-bounds range is a 400, never a silent trim. A range that is
only too long because the caller omitted `start`/`end` is clamped to the newest
730 days and flagged `truncated: true`, so a map with years of history can still
answer a default request instead of erroring on it.

`series`/`faction` responses are **columnar**, not row-per-day-per-faction: one
`days[]` axis and one array per field, because a row-shaped response repeats every
field name once per day and costs megabytes over a multi-year range. `null` at
index `i` means that field/faction was absent from that day — deliberately
distinct from `0`. There are **no server-side deltas**; see the third trap below.

## Three traps for a chart author

1. **Never sum `faction_wealth` + `pouch_wealth` + `player_bank_wealth` (or
   `guild_liquid_wealth`, `node_wealth`, `expansion_wealth`).** These are separate
   `global` fields that overlap in ways only the game's own accounting knows —
   summing them invents a "total economy" number the game itself doesn't produce
   and that can double-count. The studio's wealth panel draws
   `pouch_wealth`/`player_bank_wealth` as separate lines with an explicit "not
   part of this faction's wealth" note for exactly this reason.

2. **Prestige can fall while a faction's own finances are flat.** A faction's
   position in `prestige_breakdown` includes a Wealth component that is the
   faction's *share* of `global.faction_wealth`, not its raw wealth — so prestige
   moves when rivals' wealth changes even if this faction's own numbers hold
   steady. `wealthShare(wealth, global.faction_wealth)` in `ledgerSeries.ts`
   computes that share for the readout; do not read a prestige dip as evidence
   this faction lost money.

3. **`net_income`, `inflation_delta`, and `guild_income` are full-day
   projections from the game, not observed stock deltas.** They are the game's
   forecast for the day, served as their own series. A client-computed
   `diffConsecutive(wealth)` (today's wealth minus yesterday's) is a different
   quantity — an observed result versus a forecast — and mixing the two into one
   line would silently present a projection as if it were measured. The studio's
   income panel keeps them in visually separate charts on purpose.
