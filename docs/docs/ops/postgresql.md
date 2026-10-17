# PostgreSQL storage and migration

All site records use PostgreSQL 17: accounts, Discord/Microsoft links, codes and sessions, skins, drinks,
Characters, Patreon, LuckPerms snapshots, Chronicle, Ledger and staff tools. `DATABASE_URL` is required at
startup. CoreProtect remains an external SQLite database opened read-only. PNGs, uploaded assets and map
history files remain on disk.

Source: [database package](../../../backend/src/database).
See [previews and deploys](../../DEPLOY.md) for host paths and Actions, and
[Database Studio](database-studio.md) for its separate restricted login.

## Runtime and configuration

Each site's `pgvector/pgvector:pg17` Compose `db` service stores site records alongside Precedent and
patch notes, which borrow from the same connection pool. The named PostgreSQL volume and asset mounts are separate persistence boundaries; copying
`backend/src/data/` does not copy site records. Main and Dev use separate databases and volumes.

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | Required application connection to this site's PostgreSQL database |
| `DATABASE_STUDIO_URL` | Separate restricted login to the same database; absent configuration returns 503 in Studio |
| `DATABASE_POOL_MIN_SIZE` | Application pool minimum, default 1 |
| `DATABASE_POOL_MAX_SIZE` | Application pool maximum, default 10; previews use 3 |
| `TEST_DATABASE_URL` | Isolated test server where the login can create databases; never the serving database |

Keep connection strings in protected environment files. Do not print them in logs, Actions summaries or
command arguments. The host's Dev `environment: !override` requires its private override to include the
Studio connection; adding it only to the base Compose file is insufficient.

The connection context borrows one pooled connection for a transaction, committing on success and
rolling back on error. Rows are dictionaries. UTC timestamps, JSONB, booleans and identity columns use their
PostgreSQL types; timestamp serialization and public JSON formats stay compatible with callers. Session
settings bound queries and locks. Domain advisory locks coordinate checks that span multiple rows or the
absence of a row; file guards coordinate wardrobe and map assets across workers.

An hourly housekeeping loop in the backend, which also runs at startup, clears data that has outlived its use.
It clears the plaintext of login codes that expired unused and deletes expired code sessions
([opaque Bearer sessions](../identity/auth-security.md#opaque-bearer-sessions)).

## Schema migrations

Ordered SQL files in `backend/src/database/migrations/` are recorded with checksums in `schema_migrations`.
Startup applies pending migrations under a database advisory lock and then seeds required singleton rows.
Edited or reordered applied migrations are refused, and deployment and startup keep verbatim copies of the
applied files in the private data mount's `postgres-migrations/`. Migrations only go forward: a deploy refuses a
revision that lacks a migration the database already has, because its code expects the older schema
([deploy steps](#deploy-steps)). Add a new
numbered migration for a schema change; do not edit an applied file. To undo a change, add another migration.

CHECK constraints limit login code scopes and `minted_via`, skin and drink submission statuses, character
creation request statuses and lore item states to the values the code writes or still reads, so an edit in
Database Studio must use one of those values.

Precedent and patch-note tables have their own migrations and keep their data.

## Deploy steps

Deploys run through **Actions → Deploy** and the host's `site-deploy`
([site deploys](../../DEPLOY.md#site-deploys)). A merge to `main` deploys Dev after Build passes; www changes
only through an explicit manual `www` deployment.

Before changing anything, `site-deploy` reads `schema_migrations` from the site's `db` and compares it with
the target revision's files under `backend/src/database/migrations/`. A revision missing an applied migration
is refused with exit 4 and the log line `<sha> predates database migration NNNN; fix forward`. After a failed
deploy it checks the last healthy revision the same way before rolling back; if the failed deploy applied a
migration that revision predates, the backend stays stopped and the log records
`failed: last healthy revision does not fit the database (see log); backend kept stopped`. The check lives in
`site-deploy` because revisions from before it have no such check in their own code.

With the backend stopped, `site-deploy` then runs two steps from the target image:

```bash
python3 -m src.database.operations prepare
python3 -m src.database.operations studio
```

`prepare` reads the private `data/.postgres-authority.json` marker, written when the site moved to PostgreSQL.
It refuses a site without the marker, and a database whose name differs from the marker's or that no longer
holds every migration the marker records with the same checksum and time. It also repeats the migration check
above, naming the version in the deploy log. It then applies pending migrations without seeding.

`studio` provisions the restricted Studio login using the administrator connection. It restricts `PUBLIC`
large-object constructor access while keeping owner and direct grants, then creates or refreshes the login.
It refuses a `DATABASE_STUDIO_URL` that points at another database or reuses the owner login. On failure,
either step prints its name and, for a refusal, the reason; other errors print only the exception type, so URLs
and row values stay out of logs. The backend stays stopped.

`/home/tfmc/.site-deployed-<site>` separately records the last healthy revision. Git HEAD can already point
at a target whose build or migration was interrupted; it is not sufficient evidence of deployment success.
A private `.site-images-<site>.json` Compose overlay selects immutable tags for both services. Cached builds
and running-image verification bind successful deployment to that exact revision, even after interruption.

## Backups and restores

Deployment backups are private custom PostgreSQL dumps in the site's `deploy-backups/`, published from a
`.part` file after `pg_dump` succeeds; the newest 10 are kept. These full dumps include Precedent and patch
notes. Restoring one is a separate stopped-site database restore, and no deploy restores a dump
automatically. After a restore, run `/web syncmeta` on each server so TFMCWeb resends player entitlements
([TFMCWebBridge](../identity/tfmcweb.md)).

`province.db` files and the `data/migration-rollback/` folder left from before the move to PostgreSQL can stay
on the host as plain backups. No deploy or tool reads them.

Deploying an older revision keeps PostgreSQL data, and works only while that revision has every migration
the database has. After a newer migration, fix forward or restore a dump taken before it.

## Preview provisioning

Preview isolation needs a one-time administrator setup on Dev's cluster:

```bash
sudo -n -u tfmc /usr/local/sbin/ps-compose dev exec -T backend \
  python3 -m src.database.preview setup
```

This removes PUBLIC database CONNECT while retaining database-owner access and existing direct grants.
Each preview owner and Studio login then receives CONNECT only to its own database. Main's separate
cluster is unchanged. The repository variable `NATIVE_POSTGRES_PREVIEWS_READY=true` lets previews deploy;
set it to `false` if preview creation, redeployment or teardown stops working.

The trusted controller creates the schema under the preview owner, clones site-table data, scrubs
credentials and validates Studio before starting branch images. The site tables are Dev's public tables
except Precedent (`precedent_*`), patch notes (`patchnote_*`) and `schema_migrations`. Its credentials stay
inside trusted Dev tooling. Failed creation, redeploy, expiry, branch deletion and orphan cleanup retain
their metadata until the marked database and roles have been removed. Detailed environment, networking and
lifecycle behaviour is in [DEPLOY.md](../../DEPLOY.md#branch-previews).

## Tests and API smokes

Install `backend/requirements.txt` and `backend/requirements-dev.txt`. Use an isolated PostgreSQL 17 test
server with a superuser/CREATEDB login. Pytest creates its own database, applies migrations and resets touched
tables between tests; it drops the database on completion. PostgreSQL tests skip locally without
`TEST_DATABASE_URL` and fail in CI if it is absent. From the source checkout root:

```bash
cd backend
python -m pytest -q
python scripts/character_session_smoke.py
python scripts/character_ingest_smoke.py
python scripts/creation_catalog_smoke.py
python scripts/web_entitlements_smoke.py
python scripts/skins_e2e_smoke.py
python scripts/lore_items_smoke.py
```

Each standalone smoke requires `TEST_DATABASE_URL`, creates a random disposable database and temporary asset
directories, and cleans them up on exit. It overrides `DATABASE_URL` for that test run. These API smokes
exercise code/session, upload and plugin flows; renderer and live bot/Minecraft integration checks remain
separate.
