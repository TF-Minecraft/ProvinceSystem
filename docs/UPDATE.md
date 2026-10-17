# Production deploy (AMP host)

**Product docs:** [docs/README.md](docs/README.md)

TFMCWeb on the live box uses **production ports** only:

| Service | Host port | Container | Public URL (nginx) |
|---------|-----------|-----------|-------------------|
| API | **8000** | 8000 | `https://www.tfminecraft.net/api/` |
| UI (Next.js) | **3000** | 3000 | `https://www.tfminecraft.net/` |

Plugins, Red bot, and MC servers on the same host talk to the API at **`http://127.0.0.1:8000`** (not 18001).

**Staging** (`dev.tfminecraft.net`) uses **18001** / **13001** via `docker-compose.staging.yml`; see [STAGING.md](STAGING.md). Do **not** use staging scripts for production deploy.

---

## Important: run compose from the repo root

All `docker compose` commands must run from **`~/TFMCWeb`** (the directory that contains `docker-compose.yml`), **not** from `~/TFMCWeb/frontend`.

```bash
cd ~/TFMCWeb
docker compose build --no-cache
docker compose up -d
```

---

## 1. One-time production setup

### 1a. `backend/.env` (required)

`docker-compose.yml` loads **`backend/.env`** into the API container. Create it on the server before the first `docker compose up` (file is gitignored):

```bash
cd ~/TFMCWeb
nano backend/.env
```

Example (use your real production keys):

```env
PS_PRODUCTION=1
PLUGIN_KEY=your-production-plugin-key
STAFF_KEY=your-production-staff-key
MINESKIN_API_KEY=your-mineskin-api-key
```

- `PS_PRODUCTION=1` enables the production startup guard. See [docs/identity/auth-security.md](docs/identity/auth-security.md).
- `PLUGIN_KEY` must match TFMCWeb `api.plugin-key` on every MC server.
- `STAFF_KEY` must match Red bot `staff_key` in skinsreview / drinksreview / minecraftban.
- Do **not** set `SKINS_DEV=1` or `CHARACTER_UI_DEV=1` on production.

If `backend/.env` is missing, compose may warn or the backend may start without keys.

### 1b. Do not let `frontend/.env` override the public API URL

The Docker build log may show `Environments: .env`. If **`frontend/.env`** exists on the server with:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

that value is baked into the client bundle and causes:

- API calls from browsers to hit **localhost** (broken for visitors)
- Chrome "use other apps on this device" permission prompts

**Production:** either delete `frontend/.env` on the server, or set:

```env
NEXT_PUBLIC_API_URL=https://www.tfminecraft.net/api
```

The compose file also passes `NEXT_PUBLIC_API_URL` as a Docker build arg; avoid conflicting `frontend/.env` values.

### 1c. Data directories

Ensure `backend/src/data`, `input`, `output`, and `defines` exist and contain the data you need.

---

## 2. Production deploy / redeploy

Deploy www from GitHub: **Actions → Deploy → Run workflow** with site `www`. It backs up the database, rebuilds only
what changed, health-checks the site and puts the previous code back if it does not come up. To deploy by hand, use
the same script on the host (`sudo -u tfmc site-deploy deploy www <full sha>`). See [DEPLOY.md](DEPLOY.md).

Smoke checks on the host:

```bash
curl -s http://127.0.0.1:8000/ping
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

Expected: `{"ok":true}` and HTTP `200`.

Public check (after nginx):

```bash
curl -s https://www.tfminecraft.net/api/ping
```

### Optional: Season 5 dev landing

Production `docker-compose.yml` builds with the gate off (`NEXT_PUBLIC_SITE_DEV_GATE: "0"`). To enable it, set the build arg to `"1"`, then rebuild the frontend:

```bash
docker compose build --no-cache frontend
docker compose up -d
```

---

## 3. nginx (`/etc/nginx/sites-enabled/tfminecraft.net`)

Existing layout is correct. No new `location` blocks needed.

| Location | Upstream | Purpose |
|----------|----------|---------|
| `/` | `127.0.0.1:3000` | Next.js UI |
| `/api/` | `127.0.0.1:8000/` | TFMCWeb API |
| `/restart`, `/api/restart` | `127.0.0.1:8001` | Unrelated restart service |

**Recommended:** expand CORS methods on `/api/`:

```nginx
add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
```

The site uses PUT, PATCH, and DELETE (character editor, map editor, logout).

After edits:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4. Same-host integrations

| Component | Setting | Value |
|-----------|---------|-------|
| TFMCWeb | `api.base-url` | `http://127.0.0.1:8000` |
| TFMCWeb | `api.plugin-key` | same as `PLUGIN_KEY` in `backend/.env` |
| Red `skinsreview` | `api_base_url` | `http://127.0.0.1:8000` |
| Red `drinksreview` | `api_base_url` | `http://127.0.0.1:8000` |
| Red `minecraftban` | `api_base_url` | `http://127.0.0.1:8000` |
| SimpleFactions | (none) | Uses TFMCWeb gateway |

TFMCWeb and SimpleFactions must use **loopback** API URLs on the game host, not the public site hostname. See [docs/integrations/simplefactions.md](docs/integrations/simplefactions.md).

---

## 5. Staging stack

`dev.tfminecraft.net` (ports 18001/13001) deploys automatically from `main`; see [DEPLOY.md](DEPLOY.md) and
[STAGING.md](STAGING.md).

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Build fails at `npm run build` | Pull latest code; TypeScript errors must be fixed before deploy |
| Chrome asks to use apps on device | Frontend built with `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000` — fix `frontend/.env` or rebuild with compose build arg |
| `env_file` / missing keys | Create `backend/.env` with `PLUGIN_KEY` and `STAFF_KEY` |
| API 401 from bot / TFMCWeb | Keys in `backend/.env` do not match plugin/bot configs |

---

## Notes

- `git reset --hard` does not delete `backend/.env` if it is gitignored and already on disk.
- Does **not** update Paper jars (TFMCWeb, ArmourShop, etc.) — deploy those via AMP separately.
