# Player diagnostic page

`https://tfminecraft.net/diagnostic` checks a player's connection, the resource pack and their computer. It is public but unlisted: no menu links to it and it asks search engines not to index it. Staff send the link in a ticket; the player runs it and sends back a short code.

## What it checks

| Section | Check | How |
|---------|-------|-----|
| Minecraft server | Online, players, address and game version | The API sends a server list ping to `play.tfminecraft.net:25565` (cached 15 s) |
| Minecraft server | DNS | The browser resolves the address through Cloudflare and Google DNS over HTTPS and compares the answers with the API's own lookup |
| Your connection | Location | Cloudflare's `CF-IPCountry` header and the browser's time zone |
| Your connection | Round trip and jitter | Ten requests to `/api/ping`; the first is dropped |
| Your connection | Download speed | 8 MiB of random bytes from `/api/diagnostic/speed`, never cached, so it measures the path to the host; also estimates the pack download time |
| Resource pack | Current pack | Size and SHA-1 of the API's copy |
| Resource pack | Download test (on request) | Downloads the pack, then checks its SHA-1 in the browser |
| Mojang and Microsoft | Reachability | `no-cors` requests to session, profile, sign-in, skin and launcher hosts; any HTTP reply counts as reachable |
| This computer | System, browser, processor, memory, graphics, screen, battery | Browser APIs: User-Agent Client Hints, `hardwareConcurrency`, `deviceMemory`, the WebGL renderer, `getBattery()` |

The page lists problems first, worst first, each with a fix in plain words. Findings include a server that isn't answering, DNS that is blocked or differs, blocked Mojang or Microsoft hosts, lost or slow round trips, a slow or failed pack download, a pack damaged on the way, software rendering (no graphics driver), 32-bit systems, Windows 7 or 8, little memory and few processor threads.

What a browser can't check: the game's own TCP connection to port 25565, and the ItemsAdder pack host (`http://188.40.119.246:9900`), which is plain HTTP on its own port. Players can compare with the in-game ping and the server's pack prompt.

Browser limits:

- Chromium rounds `deviceMemory` down to a power of two and caps it at 8, so the page shows "8 GB or more".
- Firefox reports a generic graphics name and no memory.
- Laptops with two graphics chips may show the built-in one, as the browser can run on a different chip from Java.

## Resource pack copy

ItemsAdder hosts the pack over HTTP on port 9900, which an HTTPS page cannot fetch. The API keeps a copy in `backend/src/data/diagnostic/pack-<sha1>.zip`:

- When the page asks for status and the copy is more than 5 minutes old, the API fetches the pack from `DIAGNOSTIC_PACK_URL` and hashes it.
- It keeps the newest two copies, so a download that started before a pack rebuild still finishes.
- If the game server's host is down, it keeps serving the last copy and marks it stale.
- `GET /api/diagnostic/pack/<sha1>.zip` serves the copy with `Cache-Control: public, max-age=31536000, immutable`. The name holds the hash, so Cloudflare can keep it near the player.

The page offers the pack for manual install. The steps are Options → Resource Packs → Open Pack Folder, then select it. A manual copy doesn't update, so players should remove it once the server's download works.

## Reports

**Send to staff** stores the report and shows a six-character code (no `0`, `O`, `1`, `I` or `L`).

- Signed-in players are named by their linked Minecraft account. Others may type a Minecraft name.
- The API stores the country but not the IP address.
- Reports are kept for 30 days in the `diagnostic_reports` table.
- **Copy report** puts the same report on the clipboard as text.

Staff open reports at **Staff panel → Diagnostics** (`/admin/diagnostics?code=<code>`), which needs the `view_diagnostics` capability (moderator and above). The page lists the 50 newest reports and shows the full checks for one code.

## API

| Route | Access | Purpose |
|-------|--------|---------|
| `GET /diagnostic/status` | Public | Country, server ping, pack copy and game version; `no-store` |
| `GET /diagnostic/server` | Public | Address, online state, player count and game version for the home page; skips the pack check; `no-store` |
| `GET /diagnostic/speed` | Public, 20 per 10 min per IP | 8 MiB of random bytes; `no-store` |
| `GET /diagnostic/pack/{sha1}.zip` | Public | The pack copy |
| `POST /diagnostic/reports` | Public, same site, 5 per 10 min per IP, 64 KiB | Store a report; returns `{code}` |
| `GET /diagnostic/reports` | `view_diagnostics` | 50 newest reports |
| `GET /diagnostic/reports/{code}` | `view_diagnostics` | One report |

Rate limits key on `CF-Connecting-IP` and are held in memory, so they reset when the API restarts.

## Configuration

Backend `.env`, all optional:

| Key | Default |
|-----|---------|
| `DIAGNOSTIC_SERVER_ADDRESS` | `play.tfminecraft.net:25565` |
| `DIAGNOSTIC_PACK_URL` | `http://188.40.119.246:9900/generated.zip` |
| `DIAGNOSTIC_GAME_VERSION` | `1.21.10` |

Code: [`diagnostic_routes.py`](../../../backend/src/api/diagnostic_routes.py), [`src/diagnostic/`](../../../backend/src/diagnostic), [`lib/diagnostic/`](../../../frontend/lib/diagnostic), [`app/diagnostic/`](../../../frontend/app/diagnostic).
