# Previews and deploys

TFMCWeb changes reach the website in three steps, all driven by GitHub Actions on the TF server
(`188.40.119.246`, hostname `Ubuntu-2204-jammy-amd64-base`):

| Step | Site | Trigger |
| --- | --- | --- |
| Test | `https://<branch>.tfminecraft.net` | Push to a branch except `main`, once native preview readiness is enabled ([Preview](../.github/workflows/preview.yml)) |
| Staging | `https://dev.tfminecraft.net` | Merge to `main`, once **Build** passes ([Deploy](../.github/workflows/deploy.yml)) |
| Live | `https://www.tfminecraft.net` | **Actions → Deploy → Run workflow**, site `www` |

Paths below are on the TF server.

Both sites keep their records in PostgreSQL; CoreProtect's SQLite databases are read separately. See
[PostgreSQL storage](docs/ops/postgresql.md) for configuration, migrations, backups and restores.

## Branch previews

Previews deploy while the repository variable `NATIVE_POSTGRES_PREVIEWS_READY` is `true`. Set it to `false`
to hold preview deployment; builds still run. The host also requires Dev's authority marker at
`/home/tfmc/provincesystem-dev-data/data/.postgres-authority.json`, a backend image labelled
`net.tfminecraft.storage=postgres`, and both images' `org.opencontainers.image.revision` labels matching the
requested commit. A branch from before the move to PostgreSQL is refused.

Pushing a branch builds its backend and frontend images on GitHub, in parallel, and pushes them to
`ghcr.io/tf-minecraft/provincesystem-preview-{backend,frontend}:<slug>` (public packages). Pushes to `main` build
the same images without deploying them and keep a registry build cache (`:buildcache`) that every branch starts
from. Once readiness is enabled, the workflow runs
`up <slug> <sha>` over SSH as `psdeploy`, whose key is pinned to `ps-preview-ssh`.
`/usr/local/sbin/ps-preview` (runs as `tfmc`) starts compose project `pv-<slug>` on the `ps-previews` network, with
the backend running as `tfmc` and both containers under `init`;
the `ps-preview-router` Caddy container (`127.0.0.1:8090`, behind the `*.tfminecraft.net` tunnel rule) routes
`<slug>.tfminecraft.net` to it, with `/api/` going to the preview's backend.

- **Name:** [`preview_slug.py`](../.github/scripts/preview_slug.py)
  lowercases the branch and turns anything other than letters and digits into `-` (`codex/new-map` becomes
  `codex-new-map`). Names longer than 40 characters are cut and given a 6-character hash. Hostnames already in use
  (`www`, `dev`, `api`, `mail`, `map`, `admin`, `staff`, `play`, `mc`, `status`, `preview`, `t3`, `portainer`) fail the run.
  `dependabot/**` branches are skipped.
- **Assets:** the first `up` copies Dev's data, input, defines and output mounts. It excludes SQLite databases,
  authority markers, rollback archives, deployment and maintenance backups, and regenerable derived output.
- **Database:** each preview gets a database, an owner login and a separate restricted Studio login on Dev's
  PostgreSQL server. The private internal Docker network `ps-preview-database` exposes that server as
  `ps-preview-db`; preview backends use an owner connection pool capped at three. A redeploy keeps that preview's
  database and assets.
- **Clone:** the trusted live Dev helper
  ([`backend/src/database/preview.py`](../backend/src/database/preview.py))
  creates the site schema using reviewed migrations under the preview owner. It lists Dev's public tables,
  leaving out Precedent (`precedent_*`), patch notes (`patchnote_*`) and `schema_migrations`, and a data-only
  custom dump/restore copies those tables' rows and identity counters. No ownership or ACLs are copied. Schema
  creation and privileged restore use trusted Dev tooling; branch code takes no part. The schema follows Dev's
  migrations, so once Dev has a new migration, a preview of a branch cut before it fails its migration check
  until the branch is rebased onto `main`.
- **Scrub:** before startup, the helper clears code sessions, user sessions, Discord OAuth/link state, preview sign-in
  tickets, Microsoft link state, and Patreon tokens, OAuth and pending-link state, including creator credentials.
  It revokes redemption and war declaration codes and clears redemption-code plaintext, retaining rows needed by
  foreign-key-linked content.
- **Environment:** database URLs contain only that preview's owner and Studio credentials; Dev's administrator
  credentials never reach a preview. The host supplies random `STAFF_KEY`/`PLUGIN_KEY`, `SKINS_DEV=1`,
  `PROFILE_REALM_ID=dev`, `SITE_PUBLIC_URL`, `SIGN_IN_SITE=https://dev.tfminecraft.net` and the pool limit.
  Patreon, direct Discord OAuth and Microsoft linking are disabled. `SIGN_IN_SITE` disables the Precedent and
  patch note routers, and no CoreProtect connection settings are supplied.
- **Sign-in:** Discord sign-in goes through dev, which needs `PREVIEW_SIGN_IN_DOMAIN=tfminecraft.net`, and keeps the
  dev account's role ([Branch previews](docs/identity/auth-security.md#branch-previews)). A player signed in on dev
  usually skips Discord.
- **Access:** public, with `X-Robots-Tag: noindex, nofollow`.
- **Limits:** at most four previews at once (`up` exits 3); backend 2 GB / 1.5 CPU, frontend 1 GB / 1 CPU.
- **Lifetime:** each `up` sets the expiry to 90 minutes later; `ps-preview-reap.timer` runs `reap` every minute.
  Push again or re-run **Preview** on the branch to restart it. Deleting the branch (merged branches are deleted
  automatically) runs `down` at once. Closing a PR without merging leaves the preview until it expires.
- **Cleanup:** expiry, branch deletion, explicit `down` and failed creation/startup remove containers, the marked
  database and both roles. Cleanup failures retain metadata for retry; the reaper also finds marked orphan
  databases and roles when a preview directory is missing. Unexpected ownership or role identities require
  operator inspection rather than broad cleanup of unrelated objects.
- **Publication:** `up` reports success and sets the expiry only after the public UI and API pass health checks.
  Host preview and Dev deployment locks prevent cloning while Dev is being deployed or migrated.

Preview isolation needs a one-time administrator setup, run from the trusted Dev backend:

```bash
sudo -n -u tfmc /usr/local/sbin/ps-compose dev exec -T backend python3 -m src.database.preview setup
```

This revokes `PUBLIC CONNECT` on connectable databases in Dev's PostgreSQL cluster, preserving database-owner
access and existing direct grants. Provisioning grants each runtime preview login access only to its own
database and refuses creation if either login can connect elsewhere. See
[preview provisioning](docs/ops/postgresql.md#preview-provisioning).

Inspect or stop previews by hand:

```bash
sudo -n -u tfmc /usr/local/sbin/ps-preview list
sudo -n -u tfmc /usr/local/sbin/ps-preview logs <slug> [backend|frontend]
sudo -n -u tfmc /usr/local/sbin/ps-preview down <slug>
```

## Site deploys

The **Deploy** workflow resolves the commit, checks it is on `main`, and runs `deploy <www|dev> <sha>` over SSH as
`psdeploy` with `DEPLOY_SSH_KEY`. That key is pinned in psdeploy's `authorized_keys` to
`restrict,command="/usr/local/sbin/site-deploy-ssh"`
([`scripts/site-deploy-ssh.sh`](../scripts/site-deploy-ssh.sh)),
which runs `/usr/local/sbin/site-deploy`, a root-owned copy of
[`scripts/site-deploy.sh`](../scripts/site-deploy.sh), as `tfmc`,
the owner of both checkouts. Deploys to the same site run one at a time.

| | `www` | `dev` |
| --- | --- | --- |
| Checkout | `/home/tfmc/ProvinceSystem` (branch `main`) | `/home/tfmc/tfmc-staging` (detached) |
| Compose target | `ps-compose main` | `ps-compose dev` |
| Health checks | `127.0.0.1:3000/` and `127.0.0.1:8000/maps/accessible` | `127.0.0.1:13001/` and `127.0.0.1:18001/maps/accessible` |
| Backups | `/home/tfmc/provincesystem-data/deploy-backups/` | `/home/tfmc/provincesystem-dev-data/deploy-backups/` |
| Older commit than deployed | deployed if it has every migration the database has ([Rolling back www](#rolling-back-www)) | skipped as `already deployed` |

The Compose projects are `tfmcweb-production` and `tfmcweb-staging`. The host wrapper pins these names even
when deploying an older source revision. Checkout and asset paths retain their existing names.

`site-deploy`:

1. Refuses commits not on `origin/main` or from before the move to PostgreSQL (no
   `backend/src/database/operations.py`), both with exit 4, and, on www, a checkout with uncommitted changes to
   tracked files (exit 1). On dev, `git checkout --detach` keeps the expected local edits and refuses if they would
   be overwritten. It then reads `schema_migrations` from the site's `db` and compares it with the target
   revision's files under `backend/src/database/migrations/`. A revision missing an applied migration is refused
   before anything changes (exit 4, log `<sha> predates database migration NNNN; fix forward`).
2. Selects private `/home/tfmc/.site-images-<site>.json` image tags for the exact requested revision and builds
   both services using Docker's cache before stopping the backend for a forward deployment. The overlay is
   applied after the site's private Compose override. Both running container image IDs must match those
   revision tags before the deployment can pass its health checks, including an already-deployed shortcut.
3. Starts/checks the `db` service and writes a private custom-format PostgreSQL backup as
   `postgres.before-deploy-<sha>-<UTC time>.dump`, publishing it by an atomic rename after `pg_dump` succeeds,
   and keeps the newest 10.
4. Runs [`src.database.operations`](../backend/src/database/operations.py)
   `prepare` and then `studio` from the target image while the backend is stopped. `prepare` checks that the
   configured database is the one named by the data mount's `.postgres-authority.json` marker, repeats the
   migration check, then applies pending migrations. `studio` provisions the Database Studio login, which must be
   a separate restricted `DATABASE_STUDIO_URL` login for the same database ([deploy steps](docs/ops/postgresql.md#deploy-steps)).
5. Starts both services without rebuilding, verifies their image IDs, then waits up to 3 minutes for both health checks.
   On failure it stops the backend and checks the last healthy revision against `schema_migrations` the same
   way. If the failed deploy applied a migration that revision predates, the backend stays stopped and the log
   records `failed: last healthy revision does not fit the database (see log); backend kept stopped`; deploy a fix
   forward. Otherwise it restores the previous code, rebuilds, runs `prepare` and `studio` again and checks
   health, then exits 5. If any of those steps fails, the backend stays stopped. No deploy restores a dump.
6. After a healthy www deploy that changes `backend/src/patchnotes/`, runs `sudo tfmc-patchnotes-update <sha>` so the
   [patch note jobs](docs/ops/patch-notes-jobs.md) use the same code. A failure there is logged and does not fail the
   deploy.

Each run appends a line to `/home/tfmc/site-deploy.log`. The private
`/home/tfmc/.site-deployed-<site>` record tracks the last healthy revision separately from Git HEAD,
so a retry resumes an interrupted build or migration instead of reporting an undeployed checkout as successful.
Revision-tagged images carry site/revision labels. Weekly image pruning waits for both deployment locks and
removes unused site images only after 30 days; images referenced by containers remain protected.

`province.db` files and the `migration-rollback/` folder left from before the move to PostgreSQL can stay on the
host as plain backups. No deploy or tool reads them.

### Rolling back www

Run **Deploy** with site `www` and an older commit on `main` only when explicitly requested. Migrations only go
forward: `site-deploy` refuses a commit that lacks a migration the database already has (exit 4), and the log
names the version. Once www has a newer migration, fix forward with a new commit on `main`. A full PostgreSQL
restore is a separate manual operation that also affects Precedent and patch notes; see [backups and restores](docs/ops/postgresql.md#backups-and-restores).

### Deploying by hand

Use the same script rather than `ps-compose up` directly, so backups, health checks and the log stay consistent:

```bash
sudo -u tfmc site-deploy deploy www <full sha>
sudo -u tfmc site-deploy deploy dev <full sha>
```

## Host Compose overrides

Each site's `docker-compose.override.yml` (`/home/tfmc/ProvinceSystem` and `/home/tfmc/tfmc-staging`, mode 640, owned
by `tfmc`) holds the host's ports, mounts and environment. The backend runs as `tfmc`, not root, so the files it
writes stay `tfmc`'s:

```yaml
services:
  backend:
    user: "1001:1001"      # tfmc
    group_add:
      - "1000"             # amp: some plugin jars are amp's and mode 640
      - "996"              # tfmc-control: the server control socket
```

`backend/.env` reaches the container only through Compose: www's base file loads it with `env_file`, and Dev's
override does the same because its `environment: !override` replaces the base list. `.dockerignore` keeps `.env`
files out of images, so a local `docker-compose.staging.yml` run gets only the settings it lists. Files the plugins
sync to the site go to `backend/src/data/plugin-assets/`, inside the data mount. Both compose files run the backend and
frontend with `init: true`; in the backend it reaps the renderer's Chromium processes.

### The site's PostgreSQL

Each compose project has a `db` service (`pgvector/pgvector:pg17`) holding all native site records alongside
Precedent and patch notes, in the volume `provincesystem_db` (www) or `tfmc-staging_db` (Dev).
The host overrides declare these volumes by explicit name with `external: true`, so changing the Compose
project does not create an empty database. Keep those declarations when editing the host overrides.
It has no host port; the backend reaches it as `db`
and waits until it is healthy. Each site's password is `POSTGRES_PASSWORD` in its project's `.env`
(`/home/tfmc/ProvinceSystem/.env` or `/home/tfmc/tfmc-staging/.env`, mode 600; hex, as it goes into a URL), and www's
`backend/.env` sets
`DATABASE_URL=postgresql://provincesystem:<password>@db:5432/provincesystem`. Dev's compose file builds `DATABASE_URL`
from the same password, and its override repeats it because its `environment: !override` replaces the list.
`DATABASE_STUDIO_URL` must address that same database using a separate restricted login; it must not reuse the
owner credentials. The deploy's `studio` step restricts `PUBLIC` large-object constructor privileges while
keeping owner access and direct grants, refreshes the Studio grants after migrations and refuses unsafe roles
([deploy steps](docs/ops/postgresql.md#deploy-steps)).
PostgreSQL reads `POSTGRES_PASSWORD` only when it creates the volume; to change the password later, run
`ALTER USER provincesystem PASSWORD '…'` in `psql` and update both files.

```bash
sudo -u tfmc ps-compose main exec db psql -U provincesystem provincesystem      # a shell
```

Copying the asset mounts does not copy site records. See [PostgreSQL storage](docs/ops/postgresql.md) for
backups and restores.

## Keys and secrets

| Secret | Where | Used by |
| --- | --- | --- |
| `PREVIEW_SSH_KEY` | repository secret | Preview (`psdeploy`, pinned to `ps-preview-ssh`) |
| `PREVIEW_SSH_HOST`, `PREVIEW_SSH_KNOWN_HOSTS` | repository secrets | Preview and Deploy |
| `DEPLOY_SSH_KEY` | `production` and `dev` environment secrets | Deploy (`psdeploy`, pinned to `site-deploy-ssh`) |

The `production` and `dev` environments only accept deployments from `main`, so workflows on other branches cannot
read `DEPLOY_SSH_KEY`. Each psdeploy key runs only its own forced command, so the preview key cannot deploy a site.

To rotate the deploy key, generate an ed25519 key, replace its line in `/home/psdeploy/.ssh/authorized_keys` (root-owned)
with `restrict,command="/usr/local/sbin/site-deploy-ssh" ssh-ed25519 … github-site-deploy`, and store the private half as
`DEPLOY_SSH_KEY` in both the `production` and `dev` environments.

The host scripts are root-owned copies of files in
[`scripts/`](../scripts). sudoers lets `psdeploy` run `ps-preview`
and `site-deploy` as `tfmc`, and `tfmc` run `tfmc-patchnotes-update` as root.

| Host path | Source |
| --- | --- |
| `/usr/local/sbin/site-deploy`, `site-deploy-ssh` | `site-deploy.sh`, `site-deploy-ssh.sh` |
| `/usr/local/sbin/ps-preview`, `ps-preview-ssh` | `ps-preview.sh`, `ps-preview-ssh.sh` |
| `/usr/local/sbin/ps-compose` | `ps-compose.sh` |
| `/usr/local/sbin/ps-image-prune` | `ps-image-prune.sh` |
| `/etc/systemd/system/ps-preview-reap.{service,timer}`, `ps-image-prune.{service,timer}` | same names |
| `/home/tfmc/ps-preview-router/Caddyfile` (router container `ps-preview-router`, `caddy:2`) | `ps-preview-router.Caddyfile` |

After changing one, install it once merged, for example:

```bash
sudo install -m 755 scripts/ps-preview.sh /usr/local/sbin/ps-preview
sudo install -m 644 scripts/ps-preview-reap.timer /etc/systemd/system/ && sudo systemctl daemon-reload
sudo install -m 640 -o tfmc -g tfmc scripts/ps-preview-router.Caddyfile /home/tfmc/ps-preview-router/Caddyfile && sudo docker restart ps-preview-router
```
