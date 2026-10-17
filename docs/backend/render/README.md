# Staff review-sheet 3D renderer

Headless Chromium (Playwright) + Three.js. Python [`review_sheet.py`](../../../backend/src/skins/review_sheet.py) calls `cli.mjs` via [`preview_3d.py`](../../../backend/src/skins/preview_3d.py).

## Local setup

```bash
cd backend/render
npm ci
npx playwright install chromium
```

`npm ci` runs `postinstall`, which runs the build and its `prebuild` step, which copies [`frontend/lib/skins`](../../../frontend/lib/skins) into `src/skins/` so esbuild can resolve `three` from this package’s `node_modules`.

## Production

The backend Docker image runs `npm ci --ignore-scripts`, installs Playwright Chromium and its system dependencies, then copies the renderer and shared skin helpers and runs `npm run build` ([`backend/Dockerfile`](../../../backend/Dockerfile)). Rebuild the backend image after any change under `backend/render/` or those shared skin modules.

Non-Docker hosts: run the local setup commands above on the API machine; ensure `node` is on `PATH` for the uvicorn process.

## Environment

| Variable | Purpose |
|----------|---------|
| `SHEET_RENDER_DISABLE=1` | Skip 3D render (local dev only; do not set in prod) |
| `SHEET_RENDER_NODE` | Override Node binary path |

## Verify

1. Submit a pending `item_3d`, `shield`, or `gun` skin.
2. Staff fetch:

```bash
curl -D - -H "X-Staff-Key: …" -o sheet.png \
  "http://localhost:8000/skins/submissions/{id}/review-sheet"
```

Expect a PNG, **no** `X-Sheet-Render-Error` header, and `preview_model.png` (and related views) under `backend/src/data/skins/{id}/` on disk.

3. Discord: `/skinsreview post {id}` — composite sheet with 3D row; no **3D preview** error field in the embed.

## Failure signals

When render fails, staff see the issue through (players do not):

| Signal | Where |
|--------|--------|
| `preview_render_error.txt` | Submission dir on API host |
| `X-Sheet-Render-Error` | Staff `GET …/review-sheet` response header |
| **3D preview** embed field | `#bot-feed` (SkinsReview) |

Ops runbook: [docs/ops/sheet-render.md](../../docs/ops/sheet-render.md).
