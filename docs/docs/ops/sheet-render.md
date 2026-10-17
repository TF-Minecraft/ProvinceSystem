# 3D review-sheet renderer (ops)

Staff skin review sheets include headless 3D preview tiles for `item_3d`, `shield`, `helmet_3d`, `gun`, armor body views, etc. The renderer lives in [`backend/render/`](../../../backend/render).

## Deploy

1. **Rebuild the backend image** after pulling changes that touch `backend/render/`:

   ```bash
   # Production
   docker compose build backend
   docker compose up -d backend

   # Staging (same host, ports 18001/13001)
   ./scripts/staging-up.sh
   ```

2. **Environment:** confirm `SHEET_RENDER_DISABLE` is **not** set in `backend/.env` (local, gitignored) on prod/staging. Optional: `SHEET_RENDER_NODE` if Node is not on the default `PATH`.

3. **Discord bot:** reload **SkinsReview** on AMP after bot updates (`-reload skinsreview`). See `tfmc_bot/docs/hosting.md`.

## Local (non-Docker API)

From `backend/render`:

```bash
npm install
npx playwright install chromium
npx playwright install-deps chromium   # Linux only, if Chromium fails to launch
```

Run the API with `node` available on `PATH`. See [local-dev.md](local-dev.md).

## Smoke test (staging first)

1. Submit or reuse a pending **3D kind** (`item_3d`, `shield`, `gun`, …).
2. Staff review sheet:

   ```bash
   curl -D - -H "X-Staff-Key: …" -o /tmp/sheet.png \
     "http://127.0.0.1:18001/skins/submissions/{id}/review-sheet"
   ```

   - HTTP 200, PNG body
   - **No** `X-Sheet-Render-Error` response header
   - On disk: `preview_model.png` (and other views) under `backend/src/data/skins/{id}/`

3. Discord: `/skinsreview post {id}` — sheet image includes 3D tiles; embed has no **3D preview** error field.

4. Player: open submission status on the website — review preview loads (no technical error in UI).

## Backfill pending (after fixing renderer)

Submissions that failed render before deploy may have a texture-only cached `review_sheet.png` and `preview_render_error.txt`.

For each affected pending id:

- Delete `review_sheet.png` only (keep textures and model JSON), **or** leave files in place — cache invalidation retries when `preview_render_error.txt` exists.
- Force-refresh Discord: `/skinsreview post <id>` (dedup blocks auto-repost; intentional for staff).

## Related

- [cosmetics/skins.md](../cosmetics/skins.md) — review preview overview
- [backend/render/README.md](../../backend/render/README.md) — renderer internals
- `tfmc_bot/docs/skins-review.md` — `#bot-feed` flow
