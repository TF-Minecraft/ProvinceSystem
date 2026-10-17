# Local staging stack

Use a separate development machine or isolated test host for Discord bot and plugin integration testing with
[`docker-compose.staging.yml`](../docker-compose.staging.yml).
The local stack uses ports **18001** (API) and **13001** (UI).

All site records live in the stack's PostgreSQL `db` service (`pgvector/pgvector:pg17`), persisted in the
`tfmc-staging_db` named volume. The backend waits for the database health check and uses `DATABASE_URL`.
The clone's `backend/src/data`, `input`, `defines` and `output` directories are mounted for assets and generated
files; copying these directories does not copy site records. CoreProtect remains an external SQLite source.
See [PostgreSQL storage](docs/ops/postgresql.md) for migrations, backups and restores.

**Product docs:** [docs/README.md](docs/README.md) · **Flows:** [docs/flows/journeys.md](docs/flows/journeys.md) · **Dev flags:** [docs/ops/dev-config.md](docs/ops/dev-config.md)

## Prerequisites

- Docker + Docker Compose on the host
- Git access to this repo

## Managed host Dev

The TF server's `/home/tfmc/tfmc-staging` checkout serves `dev.tfminecraft.net` and deploys automatically once
**Build** passes on `main`; see [DEPLOY.md](DEPLOY.md). That managed Dev site is separate from the local stack
described here. Its checkout preserves intentional local edits and refuses updates that would overwrite them;
do not run `git reset --hard` there. If a manual deployment is necessary, use
`sudo -u tfmc site-deploy deploy dev <full sha>` on the TF server.

Do not run the local staging scripts on the TF server: their Compose project name, `tfmc-staging`, is also used
by managed Dev. Main (`www`) deploys only through an explicitly requested **Actions → Deploy → Run workflow**.

## Start a separate local stack

First-time clone:

```bash
git clone <TFMCWeb-git-url> ~/tfmc-staging
cd ~/tfmc-staging
git checkout main
./scripts/staging-down.sh
./scripts/staging-up.sh
curl -s http://127.0.0.1:18001/ping
```

`staging-down.sh` clears a failed partial up before `staging-up.sh`.

For later updates to this separate test clone, preserve local changes and fast-forward `main`, then restart:

```bash
git fetch origin
git checkout main
git merge --ff-only origin/main
./scripts/staging-down.sh
./scripts/staging-up.sh
curl -s http://127.0.0.1:18001/ping
```

Expected ping body: `{"ok":true}` (JSON). An HTML 404 means something else owns that port.

Stop later:

```bash
./scripts/staging-down.sh
```

Stopping removes containers and the stack network, but retains the database volume and mounted assets.
Removing the volume deletes the local site records. To load another site's records, restore one of its
PostgreSQL deploy dumps into this stack's database with `pg_restore`
([backups and restores](docs/ops/postgresql.md#backups-and-restores)); copy asset directories separately.

## Same-host integrations

| Component | Setting | Value |
|-----------|---------|-------|
| TFMCWeb | `api.base-url` | `http://127.0.0.1:18001` (loopback only) |
| TFMCWeb | `api.plugin-key` | same as API `PLUGIN_KEY` |
| Red `skinsreview` | `api_base_url` | `http://127.0.0.1:18001` |
| Red `drinksreview` | `api_base_url` | `http://127.0.0.1:18001` |
| Red `minecraftban` | `api_base_url` | `http://127.0.0.1:18001` |
| SimpleFactions | (none) | Uses TFMCWeb gateway |

Loopback rule detail: [docs/integrations/simplefactions.md](docs/integrations/simplefactions.md) · [docs/identity/auth-security.md](docs/identity/auth-security.md)

## Red bot config

**`skinsreview` config.yml** (same machine as AMP/Red):

```yaml
api_base_url: "http://127.0.0.1:18001"
staff_key: "dev-staff-key"
bot_feed_channel_id: YOUR_BOT_FEED_CHANNEL_ID
poll_interval_seconds: 60
```

Set the same `api_base_url` and `staff_key` on **`drinksreview`** and **`minecraftban`**.

Then in Discord: `-reload skinsreview` → `/skinsreview ping`. Enable slash if needed: `!slash enable skinsreview` then `!slash sync`.

## Local Compose settings

| Env | Value |
|-----|--------|
| `SKINS_DEV` | `1` |
| `STAFF_KEY` | `dev-staff-key` |
| `PLUGIN_KEY` | `dev-plugin-key` |
| `DATABASE_URL` | Owner connection to the stack's own `db:5432/provincesystem` |

The committed API-key defaults are for disposable local tests. Set private values in the local Compose
configuration for a shared or longer-lived stack. `POSTGRES_PASSWORD` comes from the local project's `.env`
(with a development fallback); PostgreSQL reads
it when initializing the volume, so changing the variable alone does not rotate an existing database password.
Do not copy host Dev administrator credentials into local or branch-preview containers. If testing Database
Studio, provision a separate restricted login and set `DATABASE_STUDIO_URL` for the same local database as
described in the [PostgreSQL guide](docs/ops/postgresql.md).

## Auth hardening

Full reference: [docs/identity/auth-security.md](docs/identity/auth-security.md)

| Topic | Staging | Production |
|-------|---------|------------|
| `PS_PRODUCTION` | **Do not set** (staging keeps `SKINS_DEV=1`) | Set `PS_PRODUCTION=1` |
| Dev flags | `SKINS_DEV=1` OK | `SKINS_DEV` and `CHARACTER_UI_DEV` must be unset |
| API keys | Compose dev defaults OK | Real `PLUGIN_KEY` / `STAFF_KEY` required |
| Internal queue/regen | Callers use loopback `http://127.0.0.1:18001` | Same: never public hostname |
| Code inspect | Staff Bearer + `tfmc.map.staff` server-side | Same |
| Frontend build | `NEXT_PUBLIC_CHARACTER_UI_DEV` unset for prod images | Pass `PS_PRODUCTION=1` build arg when building prod frontend |

## Smoke checklist

Tick after a staging deploy or major pull. Detail for each flow: [docs/flows/journeys.md](docs/flows/journeys.md).

### Stack

- [ ] `curl -s http://127.0.0.1:18001/ping` → `{"ok":true}`
- [ ] `http://127.0.0.1:13001/` loads hub
- [ ] Recreating containers retains PostgreSQL records and mounted assets

### Identity (TFMCWeb)

- [ ] `/linkdiscord` in-game → Discord `/linkdiscord <code>` completes bind
- [ ] Survival unlinked player frozen; non-Survival staff not gated
- [ ] Guild leave → ≤1h grace; rejoin clears; after expire → freeze

### Skins

- [ ] `/token create skin` → redeem on `/profile?tab=skins` → upload → `#bot-feed` approve → outcome DM
- [ ] Non-ranked player cannot mint; ranked KindPicker filtered by entitlements

### Drinks

- [ ] `/token create drink` → redeem on `/profile?tab=drinks` → submit → approve in Discord

### Characters

- [ ] `/token create profile` → redeem on `/profile` → create + list on site

### Map

- [ ] `/map/main` loads base map + overlays; hover and drill-down work
- [ ] Staff-only map returns 403 without `tfmc.map.staff`

### Staff tools

- [ ] Map title editor opens from **Edit titles** with staff session (needs `NEXT_PUBLIC_MAP_EDITOR_ENABLED=1`)
- [ ] Code inspect requires staff Bearer + `tfmc.map.staff`

### Moderation

- [ ] `/warning` → in-game chat + Discord DM
- [ ] `/tempban` → Discord DM + Banned role; `/unban` clears role

### Auth / config

- [ ] TFMCWeb `api.base-url` is loopback (`127.0.0.1:18001`), not public hostname
- [ ] `PS_PRODUCTION` not set on staging

## SSH tunnel to an isolated test host

```bash
ssh -L 13001:127.0.0.1:13001 -L 18001:127.0.0.1:18001 user@test-host
```

Open `http://127.0.0.1:13001/` locally.

## Site dev gate (Season 5 landing)

When `NEXT_PUBLIC_SITE_DEV_GATE=1`, the entire UI is replaced by a dev landing page until the visitor redeems a **profile** code and has `tfmc.map.staff` in `permission_flags`.

**Security:** Client-side gate only; API routes remain reachable if endpoints are known. Unset on public launch.

Config detail: [docs/ops/dev-config.md](docs/ops/dev-config.md)

- [ ] Gate **off**: site works as today (hub, map, skins, etc.)
- [ ] Gate **on**, no session: dev landing on all routes
- [ ] Gate **on**, staff profile code: full site visible

## Free-text validation

Display names and prose fields are validated server-side (`backend/src/text_validation.py`; frontend mirror: `frontend/lib/textValidation.ts`). Invalid input is rejected at the API (400).

## Port already in use?

```bash
sudo ss -tlnp | rg '18001|13001|8001'
```

Change the left-hand side of `ports:` in `docker-compose.staging.yml` if needed; keep container ports `8000` / `3000`.
