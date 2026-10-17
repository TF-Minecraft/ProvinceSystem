# Precedent lookup (`/precedent`)

Staff-only Discord tool: log past moderation cases, then semantically search them so
similar incidents get similar rulings. Bot never decides punishments — it's advisory.

**See also:** [Discord bot](discord-bot.md) (linked account selection and deployment),
[`TFMCWeb/discord/precedent/`](../../../discord/precedent) (cog source).

## Flow

1. Staff run `/case-log [user]` after handling an incident (players, rule broken, evidence
   summary, ruling, punishment) → cog POSTs to TFMCWeb → TFMCWeb embeds
   the case (Voyage AI) and stores it in the site's Postgres (`pgvector`).

   With `user`, the case belongs to the selected Discord account, even without a
   Minecraft link or website login. A verified link supplies the Minecraft name
   and UUID when present. Structured participants retain both account IDs across
   renames and unlinking. Without `user`, staff can still enter names manually. See the
   [linked account workflow](discord-bot.md#linked-accounts-in-moderation).

   **Only the summary is embedded** (`_case_text` in `precedent_routes.py`). A search
   query is always a description of what happened: staff cannot cite the rule number
   from memory, and the ruling and punishment are exactly what they are asking for.
   Indexing those fields put roughly half the stored vector beyond anything a query
   could match, which kept even exact-wording matches around 0.49 distance. Summary-only
   indexing moved `"xray"` against the logged `Xray` case from 0.493 to 0.390.
   Changing what gets embedded invalidates every stored vector — re-run
   `python -m src.scripts.backfill_precedent_embeddings` over the whole corpus rather
   than letting old and new rows coexist.
2. Staff run `/precedent <case info>` → cog POSTs the free-text query → TFMCWeb
   embeds it, runs a pgvector cosine-similarity search for the 3 closest past cases
   (boosted, not filtered, by exact-word matches on the query and by any `players`
   given, so a short exact-wording case like a one-line "Xray" summary isn't crowded
   out by a longer only-thematically-related one), and asks Claude to synthesize what
   precedent suggests → cog posts an embed with the 3 matches + the synthesis.

Helper role can run `/precedent` and `/case-view` (read-only) but not `/case-log`
or `/case-delete`, matching the staff/helper split already used by
`minecraftban` and `skinsreview`.

Staff can also view a logged case's untruncated details with `/case-view <id>`
(case ids are shown next to each match in `/precedent` results), and permanently
remove a bad entry with `/case-delete <id>` (staff only, asks for confirmation
before deleting). `/precedent` optionally takes a comma-separated `players`
argument, which ranks cases involving those players higher without excluding
other matches (a typo'd name never zero-results the search).

`/minecraftwarn` and `/minecraftnotify` (both in the `minecraftban` cog) also
auto-log a precedent case on every use — no separate `/case-log` needed for these.
`/minecraftnotify` is an existing anonymous-to-recipient staff DM (unrelated to
in-game warnings); its precedent record still keeps the real issuing staff member
as `logged_by` internally, for staff-side accountability, even though the
recipient never sees who sent it. `/minecraftwarn` resolves its selected user
through the verified Minecraft link and retains the UUID and Discord ID as
structured participants. `/minecraftban` logs its notification too.
`/minecraftnotify` retains its existing anonymous message flow while recording
the recipient's Discord ID and any known Minecraft UUID.

## Cases on a person

Every Minecraft staff profile has a **Cases** tab at
`/admin/players/<uuid>?tab=cases`. Discord-only people have the same case view at
`/admin/people/discord/<discord-id>`. No Minecraft account or website login is
needed for a case against a Discord account.

The Players directory's Discord view includes linked players, known website
accounts, and Discord participants from case records. Search by handle or Discord
ID. A numeric ID also offers **Open Discord account**, including when that person
has no previous case. This directory is not a complete Discord guild roster.
Discord-only directory rows have `uuid: null` and open the Discord profile.
Participant chips in the main Precedent list link to the person's history.

The Cases view combines, newest first:

- Case logs from the bot and website, including staff notices and Discord ban notifications.
- In-game warnings stored in `player_warnings`.
- Recorded ban/unban events and standalone warning notifications in `player_notifications`.

A warning's Discord mirror is shown once with its stored warning. Private bird
mail is excluded. This is recorded moderation history, not a live ban-status
check or an import of older Discord messages that were never logged.
A manual Discord ban notification and an in-game ban event are separate records;
without a shared event ID, the view keeps both rather than guessing they are duplicates.

**Log case** binds the new case to the profile's Discord ID and/or Minecraft UUID
without asking staff to type a name. Details show the summary, rule, ruling,
outcome, author, date and account identifiers. Cases can be edited from the view;
the existing audit trail records edits, deletion and restoration with their
participant identities. History is paginated in pages of 25.
For a case with account links, the edit form keeps its player names fixed;
incident details, ruling and outcome remain editable. An unknown account can be
recorded by ID with an empty display name; IDs are not saved as player names.

An ID-bound case matches exact Discord IDs or UUIDs, never another account's
reused name. Linking Minecraft later brings existing Discord cases into the
Minecraft profile. Stored participant IDs survive unlinking; the association is
not inferred again from display names.
Relinking does not transfer a Minecraft account's records to another Minecraft
account. A Minecraft profile keeps records naming its UUID and adds its current
Discord account's records that have no Minecraft UUID. A Discord profile keeps
records naming its Discord ID and adds Minecraft-only records from its current
link. For example, a Discord-only case joins Minecraft history after linking,
while a case naming both a Discord ID and an old UUID stays on those two accounts.

Older cases with no structured participants match exact current or historical
Minecraft names and show **Older name match**. These are candidates for staff to
assess, since a name alone cannot prove account ownership. A record that already
has participant IDs does not fall back to name matching. When Minecraft name
history cannot be read, the view warns that some name-only records may be missing.

`GET /admin/players/{uuid}/cases` and `GET /admin/discord/{discord_id}/cases` require
the signed-in website capability `use_precedent` (mod and above), return
`Cache-Control: no-store`, and accept `limit` (1–100, default 25) and `offset`.
The response contains `person`, `entries`, `total`, `limit` and `offset`. Each entry
has a `kind`, an optional editable `case_id`, and `matched_by` (`account` or `name`).
No embeddings or model calls are needed to browse history.

## Case account storage and compatibility

`precedent_cases.participants` is a JSONB array, separate from the legacy `players`
display labels. Each participant has at least one of `discord_user_id` or
`player_uuid`, plus an optional display `name` and Discord username. The API accepts
up to 20 participants and validates snowflakes and UUIDs. Both IDs can identify the
same participant; the case appears once in that person's view.

Precedent's existing migration adds the array with an empty default and a GIN
index. It preserves all cases, embeddings and audit rows and can be replayed.
Old writers can still create name-only cases; an update that omits `participants`
preserves existing account links. An explicit empty array removes the links and
is audited. Delete/restore includes participants, and old snapshots without them
still restore as name-only cases. The summary remains the only embedded field.

Deploy the API before new cogs. For a rollback, restore the older cogs/site code
and keep the additive column and index; do not drop participant data. An older
backend can read cases with its existing explicit column lists. The Cases endpoints return an unavailable error rather than an empty history
when their storage cannot be read; the Discord directory can still list website
accounts before Precedent is initialized.

## Staff panel tab (`/admin/precedent`)

Staff browse and maintain the whole corpus in the staff panel's Precedent tab; the
Discord commands only ever show three matches at a time. The tab lists cases 25 to a
page, newest first, and offers Log / Edit / Delete. Its search box narrows every case, not
just the page on screen: each word must appear somewhere in the case's text, rule,
ruling, punishment, logger or players (a plain database query, no cost). The case form
suggests player names already in the corpus. The semantic search sits in its own panel behind an explicit submit button,
since each run costs a Voyage embed plus a Claude call. `/precedent` redirects there.

Access follows the rest of the staff panel: the website role from the Discord sign-in,
`mod` and up (capability `use_precedent`). Writes and searches also need the site's own
`Origin`.

**Editing re-embeds the case.** The stored vector is what search matches on, so saving
edited text against the old vector would leave the row unfindable by the wording it now
contains. `PUT /staff/case/{id}` always recomputes the embedding before writing.

Implementation: `frontend/app/admin/precedent/page.tsx`,
`frontend/app/components/precedent/`, `frontend/lib/precedent/{api,filter}.ts`.

## API surface (staff)

Two clients, two credentials. The Discord bot and plugins send the shared
`X-Staff-Key`; the website must never ship that secret to a browser, so the staff panel
sends the Discord session cookie and the server checks the account's role
(`backend/src/api/staff_access.py`). Every route below except `/staff/ping` accepts
either. A *wrong* `X-Staff-Key` is rejected outright rather than falling through to the
cookie.

| Route | Body | Returns |
|-------|------|---------|
| `POST /precedent/staff/log` | `{logged_by, players[], participants[]?, summary, rule, ruling, punishment}` (all fields length-capped) | `{id}` |
| `POST /precedent/staff/search` | `{query, players[]?}` (`players` is an optional soft-boost ranking hint, not a filter) | `{matches: [{id, logged_by, players, participants, summary, rule, ruling, punishment, created_at, distance}], synthesis, max_distance}` |
| `GET /precedent/staff/cases?limit=&offset=&q=` | - | `{cases: [...], total}` — plain SELECT, newest first, no Voyage/Claude cost. `limit` defaults to 500 and clamps to 1000. `q` (up to 200 characters) keeps cases containing every word, ignoring case; `total` counts those matches |
| `GET /precedent/staff/players` | - | `{players: [...]}` — every player name in the corpus, once each ignoring case, in its newest spelling |
| `GET /precedent/staff/case/{id}` | - | Full case (same shape as one `matches` entry) or 404 |
| `PUT /precedent/staff/case/{id}` | Same body as `/staff/log` | `{updated: true, id}` or 404. Re-embeds before writing |
| `DELETE /precedent/staff/case/{id}` | - | `{deleted: true, id}` or 404 |
| `GET /precedent/staff/ping` | - | `{ok: true}` (cheap reachability check, no Voyage/Claude cost) |

`max_distance` in the search response is the live relevance cutoff (`MAX_RELEVANT_DISTANCE`
in `backend/src/precedent/db.py`) so bot-side similarity-percentage math never drifts out of
sync with the backend.

`MAX_RELEVANT_DISTANCE` is 0.55, measured against the live corpus: realistic moderation
queries peak at 0.505 for their nearest match, off-topic ones bottom out at 0.602. It is
specific to the current indexing — re-measure after changing `_case_text` or the embedding
call.

**Embeddings are symmetric.** `embed_batch` sends no `input_type`. Voyage recommends
`query`/`document` for asymmetric retrieval (short query, long document), but precedent
search compares a short incident description against a short case summary. Measured here,
the asymmetric prefixes added a near-constant 0.32–0.44 cosine penalty to *every*
comparison regardless of match quality: byte-identical text scored 0.319–0.442 apart as
query-vs-document, and 0.000 apart embedded the same way. Dropping it improved nearest-match
distance for every test query (`"xray"` against the logged `Xray` case went 0.390 → 0.103)
and widened the relevant/off-topic separation from 0.061 to 0.097.

Because identical text now scores 0, the website's similarity percentage maps
`[0, MAX_RELEVANT_DISTANCE]` to `[100%, 0%]` with a `^0.5` curve — 100% means genuinely
exact, with no floor subtracted. The Discord cog still applies its own `^0.3` curve, so the
two surfaces report different percentages for the same case. `/staff/search` is rate-limited to 10 requests/60s per staff
account, or per client IP for the bot (same in-process limiter pattern as the
`/skins/codes/inspect` route).

Implementation: `backend/src/api/precedent_routes.py`, `backend/src/precedent/{db,embeddings,synthesis}.py`.

## Audit trail

Every write to `precedent_cases` appends a row to `precedent_audit` in the same database.
There is **no API route to read it**: inspecting it takes database access (the root-only
[Database studio](../ops/database-studio.md) or `psql` on the host), so staff cannot review or
erase their own trail from the website.

| Column | Meaning |
|--------|---------|
| `case_id` | The case affected. Not a foreign key, so it survives the case being deleted |
| `action` | `create`, `update` or `delete` |
| `source` | `web` (staff panel account) or `bot` (shared `X-Staff-Key`) |
| `actor` / `actor_uuid` | For `web`, the staff account's linked Minecraft player, or its Discord username with no UUID when unlinked; caller-supplied and unverified for `bot` |
| `before` / `after` | JSONB snapshots of the case content, embedding excluded |

Two properties are deliberate:

- **The audit row is written inside the same transaction as the change**, so a case cannot be
  modified without a record of it — both commit or neither does.
- **`delete` keeps a full `before` snapshot.** Once the case row is gone, the audit entry is
  the only surviving copy of what it said, which is what makes a bad deletion recoverable.

Only `source='web'` proves who acted. The bot authenticates with a shared key, so its `actor`
is whatever the caller sent — treat it as a hint, not evidence.

### Restoring deleted cases

A `delete` snapshot holds everything needed to rebuild the case — original id, `created_at`,
and all content — so deletions through the API are reversible, including a mass one:

```bash
# What could be restored, writes nothing
python -m src.scripts.restore_precedent_cases --dry-run

# Restore everything deleted since a point in time
python -m src.scripts.restore_precedent_cases --since "2026-08-29"

# Restore a single case
python -m src.scripts.restore_precedent_cases --case-id <uuid>
```

Cases come back under their original id and timestamp, so links and ordering survive.
Embeddings are recomputed from the summary (a couple of batched Voyage calls for the whole
corpus). Ids that already exist are skipped rather than overwritten, so the script is safe to
re-run and safe to use while the corpus is only partly damaged. Restores are themselves
audited, as `action='restore'`, `source='script'`.

**This only covers deletions made through the API.** Direct SQL bypasses the audit trail; the
`postgres.before-deploy-*.dump` files that each deploy writes ([DEPLOY.md](../../DEPLOY.md)) are
the recovery path for that.

Useful queries:

```sql
-- Recent website activity
SELECT created_at, action, actor, before->>'summary', after->>'summary'
FROM precedent_audit WHERE source = 'web' ORDER BY created_at DESC LIMIT 50;

-- Everything that ever happened to one case, including its deletion
SELECT * FROM precedent_audit WHERE case_id = '<uuid>' ORDER BY id;

-- Recover a deleted case's content
SELECT before FROM precedent_audit WHERE action = 'delete' AND case_id = '<uuid>';
```

## Storage

The site's Postgres (the `db` service in each site's compose project), `pgvector`
extension. Two tables: `precedent_cases` (id, logged_by,
players, summary, rule, ruling, punishment, embedding `vector(1024)`, created_at) and
`precedent_audit` (see above). Tables + extension are created lazily on first request
(`migrate()` in `precedent/db.py`).

All site records and patch notes share this PostgreSQL database and the backend's connection pool, so
Precedent queries run under the pool's session limits ([PostgreSQL storage](../ops/postgresql.md)). Site
migrations leave the Precedent and patch-note tables intact. Branch previews exclude these tables and disable their API routers.

## Configuration

| Env (TFMCWeb `backend/.env`) | Purpose |
|--------------------------------------|---------|
| `DATABASE_URL` | The site's Postgres, `postgresql://provincesystem:<password>@db:5432/provincesystem` |
| `VOYAGE_API_KEY` | Voyage AI embeddings |
| `ANTHROPIC_API_KEY` | Claude synthesis |

These secrets live only in TFMCWeb's backend env — the bot never sees them,
same as `STAFF_KEY`-gated routes elsewhere.

| Env / config (tfmc_bot `precedent/config.yml`) | Purpose |
|-------------------------------------------------|---------|
| `api_base_url` / `API_BASE_URL` | TFMCWeb API base |
| `staff_key` / `STAFF_KEY` | Matches backend `STAFF_KEY` |
| `staff_role_id` / `STAFF_ROLE_ID` | Can run `/case-log` and `/precedent` |
| `helper_role_id` / `HELPER_ROLE_ID` | Can run `/precedent` only |

## Operational notes

- `migrate()` gates schema setup on a module-global flag, assuming a single-worker
  deploy (confirmed: no multi-worker launch config exists for this backend). Both
  the `CREATE EXTENSION`/`CREATE TABLE` statements are idempotent, so even under a
  future multi-worker deploy the only risk is duplicate cold-start work, not data
  corruption.
- `logged_by` is caller-supplied and trusted once the shared `X-Staff-Key` has
  authenticated the request, the same trust model as every other `X-Staff-Key`
  route in this codebase (e.g. `staff_name` fields in the skins routes). Not a
  gap specific to this feature. **Staff panel callers are exempt:** a signed-in
  account has a known staff member behind it, so the server overrides `logged_by`
  with their linked Minecraft name, falling back to their Discord username
  (`staff_name` in `backend/src/api/staff_access.py`). A signed-in staff member
  therefore cannot attribute a case to someone else.
- `/staff/search` rate-limiting buckets staff panel callers by account rather than
  client IP. Behind a reverse proxy every browser shares one IP and would
  otherwise contend for a single 10/60s budget.

## Out of scope (v1)

Backfill from historical mod-log channel messages, editing cases from Discord (the
website handles it), bulk edit/delete, per-case audit history, cross-server precedent
sharing.
