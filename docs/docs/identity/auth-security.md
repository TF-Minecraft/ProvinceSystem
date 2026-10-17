# Auth and security

TFMCWeb authentication model, production guards, and staff access controls.

Sources: [`prod_guard.py`](../../../backend/src/api/prod_guard.py), [`map_access.py`](../../../backend/src/api/map_access.py), [`internal_access.py`](../../../backend/src/api/internal_access.py), [STAGING.md](../../STAGING.md).

## Threat model (intentional)

Public map data is low sensitivity. Still validate uploads, hash codes, and keep plugin/staff secrets server-side. Docker isolation matters more than auth theater on map read endpoints.

Cosmetics and identity are higher sensitivity: UUID-bound codes, opaque Bearer sessions, and server-side staff keys.

## Discord website sign-in

The website supports Discord OAuth sign-in for account pages and the staff panel,
separately from the UUID-bound feature codes below. Enable it with
`DISCORD_AUTH_ENABLED=1`; configure `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
`DISCORD_GUILD_ID` and `SITE_PUBLIC_URL`. `DISCORD_REDIRECT_URI` defaults to the
site URL plus `/api/auth/discord/callback` and must return to that site.

[`auth_routes.py`](../../../backend/src/api/auth_routes.py)
starts sign-in at `/auth/discord/start`, checks the OAuth state against a browser
cookie, and sets an HttpOnly, SameSite=Lax session cookie. HTTPS uses the Secure
`__Host-tfmc_session` cookie; plain HTTP local development uses `tfmc_session`.
Cookie-authenticated writes enforce an origin check. `/account` exposes the
signed-in account and supports Minecraft linking and Patreon authorization.

Linking a Minecraft account needs TFMC server membership checked within the
last 15 minutes. Sign-in checks it. After that, the backend asks Discord with
`DISCORD_BOT_TOKEN` (`GET /guilds/{DISCORD_GUILD_ID}/members/{user}`) when an
unlinked player loads `/account` or starts a link, so a signed-in player never
has to sign in again just to link. "Unknown Member" or "Unknown User" means not
a member. One bot request runs at a time. A request that arrives mid-check
waits up to 4 seconds for that answer, and gives up asking if it takes longer.
A "not a member" answer is reused for 15 seconds without waiting. An unclear
answer keeps the old check, and that session is not asked again for a minute.
Some answers pause every check:

| Answer | Pause |
|--------|-------|
| Rate limit | Discord's `retry_after` |
| Timeout or 5xx | 30 seconds |
| 401, 403 or 404 Unknown Guild (the bot itself is refused) | 10 minutes |

`/account` returns `guild.can_recheck`. Unless it is true, Discord could not be
asked, and "I've joined, check again" falls back to a Discord sign-in.
Source: [`guild_check.py`](../../../backend/src/auth/guild_check.py).

### Branch previews

Discord returns players only to registered callbacks, so a preview at
`https://<slug>.tfminecraft.net` signs in through dev instead
([`preview_sign_in.py`](../../../backend/src/auth/preview_sign_in.py)).
Preview images set `SIGN_IN_SITE=https://dev.tfminecraft.net` and hold no Discord settings.
Dev sets `PREVIEW_SIGN_IN_DOMAIN=tfminecraft.net`.

1. The preview's `/auth/discord/start` stores a random state in its state cookie and
   sends the browser to dev's `/api/auth/preview/start` with the state, the preview's
   origin and the return path.
2. Dev accepts only `https://<slug>.<PREVIEW_SIGN_IN_DOMAIN>` origins whose slug is not
   reserved. Without a dev session, it signs the player in with Discord and Discord's
   callback returns them to that route.
3. Dev refreshes the session's guild check with the bot. If the bot cannot answer and
   the check is over 15 minutes old, or the preview asked for a recheck because the
   player was already signed in there ("I've joined, check again"), dev signs the
   player in with Discord again. It then
   stores a hashed single-use ticket for that preview (120 seconds) and redirects to the
   preview's `/api/auth/preview/callback`. Access logs drop the query on both routes.
4. The preview checks the state against its cookie, then posts the ticket and its
   origin to dev's `/api/auth/preview/redeem`. Dev deletes the ticket and returns the
   Discord identity, website role and guild check.
5. The preview opens its own session with that role and check.

A player already signed in on dev skips Discord unless the bot cannot answer one of
those checks. The preview never sees the dev session
or the Discord secret, and its changes stay in its own copy of dev's data.

## Microsoft link

Signed-in players can link Minecraft by signing in with Microsoft instead of
pasting a `/linkdiscord` code. This needs an Azure app for personal Microsoft
accounts that Mojang has allow-listed for Minecraft services. Enable it with
`MICROSOFT_LINK_ENABLED=1`, `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.
`MICROSOFT_REDIRECT_URI` defaults to the site URL plus
`/api/auth/microsoft/callback`; register it as a Web redirect on the Azure app.

`POST /account/minecraft/microsoft/start` needs the same fresh Discord guild
check as code linking. It stores a single-use state and PKCE verifier tied to
the site session, then returns the Microsoft sign-in URL. The callback exchanges
the code, follows Xbox Live, XSTS and Minecraft services to the Java profile, and
links that UUID through the same rules as a code. A link never replaces another
link in either direction. Microsoft, Xbox and Minecraft tokens are discarded
after the request. The callback returns to `/account?minecraft=<outcome>`,
which redirects to Profile's Linked accounts tab with the outcome.
Source: [`microsoft.py`](../../../backend/src/auth/microsoft.py).

## Profile page

`/profile` is the one page for a signed-in player. Once Minecraft is linked it
shows the player's skin face, rank and time on the server, then the tabs
Characters, Skins, Drinks, Custom items and Linked accounts (`?tab=` picks one).
Linked accounts lists Discord, Minecraft and Patreon with sign-out, unlink and
Patreon controls. Before linking it is the only section, and offers Microsoft
sign-in with the in-game code as a fallback. `/account` redirects to
`/profile?tab=accounts`, keeping the `signin` and `minecraft` notices, so Discord
and Microsoft callbacks still land there. The Discord,
Microsoft and Patreon buttons use each service's own artwork from
`frontend/public/brand/`, so the page loads nothing from those services.

| Route | Purpose |
|-------|---------|
| `GET /account/overview` | First and last sight on this site's server from `COREPROTECT_DB`, and the rank from the LuckPerms mirror. Each part is null when unreadable. |
| `GET /account/minecraft/head` | The linked player's face as a 64×64 PNG, from Mojang's session server and `textures.minecraft.net`. It serves only your own player, so it is no open proxy, and caches each face in memory for six hours. |
| `POST /account/profile-session` | Opens Profile for the linked player without an in-game code (below). |
| `POST /account/patreon/unlink` | Disconnects Patreon from the signed-in Discord account. |

`discord_links.link_method` records how a link was proved: `code` or
`microsoft`. Links made before it was kept have no method, and the page shows
only their date. Source: [`account_overview.py`](../../../backend/src/auth/account_overview.py).

### Profile without a code

A signed-in Discord account with a linked Minecraft account gets a `profile`
Bearer session from `POST /account/profile-session`. It is the same 8-hour
session a `/token create profile` code gives, so every Profile, character and
Patreon route works unchanged. The route needs the site origin and a current
link, and shares the link-attempt rate limit. It records a spent `profile` code
with no plaintext, because sessions belong to a code. The realm comes from
`PROFILE_REALM_ID`: `main` by default, and `dev` on the Dev site.

The browser keeps that session in local storage marked as opened through
Discord, and reuses it across tabs while more than five minutes remain.
Signing out of Discord or unlinking Minecraft under Linked accounts revokes it;
there is no separate Log out for these sessions. A visitor without a link still
redeems an in-game code: a profile code opens Profile, and a skin or drink code
opens only that wardrobe ([code sign-in](../cosmetics/skins.md#signing-in-with-a-skin-or-drink-code)).
Profile shows Log out for code sessions.

Website roles (`mod`, `admin`, `root`) control staff capabilities independently
of feature-code scopes. Staff panel tabs follow the role alone: a Profile session
with `tfmc.map.staff` opens staff maps and the map editor, not the panel. See [CoreProtect data](../integrations/coreprotect.md),
[rail data](../integrations/rail.md), [server plugins](../integrations/servers.md), [LuckPerms policy](../integrations/luckperms.md),
[precedent](../integrations/precedent.md) and the [code lookup](../cosmetics/skins.md#staff-code-lookup)
for the individual staff panels. Configuration validation is in
[`auth/config.py`](../../../backend/src/auth/config.py).

The staff panel's **Accounts → Find an account** accepts part of a Discord username or
display name, ignoring case, or a full Discord ID. A leading `@` is optional. It returns
up to five accounts that have signed in, with exact matches first; temporary view-as placeholders
are excluded. Use a longer name fragment to narrow the results.

## Viewing as a player

Admins and the owner (`view_as_player`) can see the site as a player sees it.
A player's staff page shows **View the site as them** when that player has
linked Discord and has no staff role, whether or not they have signed in to
the site. Source:
[`view_as.py`](../../../backend/src/auth/view_as.py).

1. `POST /admin/players/{player_uuid}/view-as` needs the site origin. It finds
   the player's website account through their Discord link (**404**
   `not_linked` without one) and opens a 30-minute session for it that names the
   admin in `user_sessions.acting_user_id`, copying the player's last guild check.
   A player who has never signed in gets a placeholder account (`users.placeholder = 1`,
   named from the link) that is deleted once its views end. Staff lists, the
   account lookup and player pages treat it as no account, and the player signing
   in with Discord turns it into their real account. The
   admin's own session token moves to the HttpOnly `__Host-tfmc_staff_session`
   cookie (`tfmc_staff_session` over plain HTTP), and the site opens the player's Profile.
2. The site shows a bar at the bottom of every page: "Viewing as …", with
   **Back to my account**. `/account` returns `viewing_as` with the admin's name
   and the end time.
3. **Back to my account** calls `POST /auth/view-as/stop`, which deletes the view
   and puts the admin's session back, then returns to the player's staff page.
   It never restores another admin's session in place of a view. When a view
   runs out, the bar does this itself; otherwise the next `/account` load does.
   The browser drops the view's cookie when it runs out, so these, signing out
   and signing in again also end the admin's views that have run out. Starting or
   leaving a view reloads the site's other tabs, so none shows the wrong account.

A view is view only. [`view_as_guard.py`](../../../backend/src/api/view_as_guard.py)
answers every `POST`, `PUT`, `PATCH` and `DELETE` sent with the view's session
cookie with **403** `viewing_as_player`. Only leaving the view, signing out and
opening or closing Profile get through, and Profile's Linked accounts card shows the
player's accounts with its actions disabled. Profile opened during a view records its code
with `minted_via = 'staff_view'` and the view's user session in `view_session_id`, ends with the view, and the guard
refuses its Bearer writes the same way. The view has no staff rights even if
the player's role changes, and dev will not hand it to a branch preview.
Signing out during a view also signs the admin out, and signing in with Discord
ends the view and drops the session it kept.

Only players with a Discord link can be viewed, and never staff.
Each start and end is written to the staff audit log
(`account.view_as.start` with `player_uuid` and `placeholder`,
`account.view_as.stop` with `expired`), as are
refused starts, including one from inside a view. Changing the admin's role or revoking their sessions also ends
their views and their Profile sessions; the role change or revocation is the audit row.

## Opaque Bearer sessions

| Surface | Mechanism |
|---------|-----------|
| Player redeem (skins / drinks / profile) | `POST …/redeem` with code → short-lived **opaque** session token whose hash is stored in PostgreSQL; client sends `Authorization: Bearer <token>`. Profile sign-in redeems any of the three through `POST /profile/redeem` |
| Session scope | Encoded in DB row (`skin`, `skin_staff`, `drink`, `profile`) |
| TTL | **8h** after redeem. The API still accepts `remember_me` (30 days) for profile, but the site never sends it |
| Profile / map staff | `profile` scope session from `/profile` redeem or a linked Discord account ([Profile without a code](#profile-without-a-code)); carries `player_uuid` and `realm_id` for permission checks |
| No website passwords | Codes are UUID-bound and not shareable by design |

Codes are **hashed at rest** (SHA-256). Plaintext shown once in-game at mint. The `login_codes` row keeps the
plaintext only while the code is open, for the plugin list of active codes (`GET /skins/plugin/codes/active`).
Redeeming a profile code, using a skin or drink code for a submission, and revoking a code clear it in the same
update. The backend's hourly housekeeping loop clears it once a code expires unused, and deletes expired
`code_sessions` rows.

### Scope enforcement

Routes validate session **scope** before acting:

- Skin upload/submit requires a valid `skin` or `skin_staff` session tied to the issuer UUID.
- Drink submit requires `drink` scope.
- `GET /profile/wardrobe` requires `skin`, `skin_staff` or `drink` scope and returns only that wardrobe.
- Character create and `GET /profile` require `profile` scope.
- Staff map viewer and title editor require `profile` scope plus permission flags.

Invalid or expired tokens return **401**. Wrong scope returns **403**.

## Staff map and site staff

[`map_access.py`](../../../backend/src/api/map_access.py) centralizes map and staff checks.

### Staff-only maps

- Map entries in `maps.yml` declare `public: false` and optional per-map `staff_permission`.
- `ensure_map_access()` returns **403** without a valid profile Bearer session and matching permission from `web_entitlements` (TFMCWeb's LuckPerms sync).

### Map title editor write

- `ensure_map_staff_write()` requires `tfmc.map.staff` permission flag (constant `EDITOR_STAFF_PERMISSION`).
- Editor regen endpoints use Bearer staff session, not the plugin regen hash.

### Site staff helper

`require_site_staff(authorization)`:

1. Parses Bearer token.
2. Accepts any valid feature session (`skin`, `drink`, `profile`, …) via `get_feature_session()`.
3. Requires `has_map_staff_access(…, "tfmc.map.staff")`.
4. Returns **401** without token; **403** without permission.

Used by the patch notes staff routes. Staff panel tools use `require_staff_account`
instead (below).

### Staff panel tools outside `/admin`

`require_staff_account(request, capability, write=False)` in
`backend/src/api/staff_access.py` applies the staff panel's rule to routes served
elsewhere: the Discord session cookie, a website role with the capability, and the
site `Origin` on writes. It returns **401** when signed out and **403** without the
capability. Used by `POST /skins/codes/inspect` (`inspect_codes`) and the precedent
routes when no `X-Staff-Key` is sent (`use_precedent`), and the diagnostic report
routes (`view_diagnostics`, see [ops/diagnostic.md](../ops/diagnostic.md)), and the
database studio (`use_database`, root only, see [ops/database-studio.md](../ops/database-studio.md)).

### UI dev bypass (non-production only)

When `CHARACTER_UI_DEV=1` and token is `ui-dev-session`, staff map/editor checks bypass for local UI work. **Must be unset in production** (see production guard below).

## Plugin and staff API keys

| Key | Header | Used by |
|-----|--------|---------|
| `PLUGIN_KEY` | `X-Plugin-Key` | TFMCWeb: link start, code mint, and the gateway for ArmourShop, DrinkBuilder, RPCharacters and SimpleFactions |
| `STAFF_KEY` | `X-Staff-Key` | tfmc_bot approve/deny, notifications, staff file download |

Never expose these as `NEXT_PUBLIC_*` env vars.

## Internal plugin routes (IP, not staff tokens)

[`internal_access.py`](../../../backend/src/api/internal_access.py) defines `require_localhost(request)`:

- Allows loopback (`127.0.0.1`, `::1`) and private TCP peers (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) so Paper on the Docker host can reach a published API (peer is often `172.18.0.1`).
- Rejects the request if `X-Forwarded-For` or `X-Real-IP` is set, so public nginx `/api/` cannot use the same Docker gateway IP to regen or overwrite map JSON.
- Used for plugin regen and all `POST /{map}/data/upload/{mode}` (including the regen queue and title tiers). No Bearer session is required on that upload path.
- Website title editor reads and regen use `ensure_map_staff_write()` (staff Bearer + `tfmc.map.staff`).

**Production rule:** TFMCWeb `api.base-url` on the game host must be loopback (e.g. `http://127.0.0.1:8000`), not the public website hostname. SimpleFactions regen and uploads inherit that URL through TFMCWeb's gateway. Hitting the public `/api/` hostname adds forwarded-for headers and is rejected.

## Production startup guard

[`prod_guard.py`](../../../backend/src/api/prod_guard.py) runs at server startup when `PS_PRODUCTION=1`:

| Check | Failure if |
|-------|------------|
| `SKINS_DEV=1` | Dev skins helpers enabled |
| `CHARACTER_UI_DEV=1` | UI dev session bypass enabled |
| Missing `PLUGIN_KEY` | Plugin routes unauthenticated |
| Missing `STAFF_KEY` | Staff routes unauthenticated |

Startup raises `RuntimeError` and refuses to boot if any check fails.

### Frontend production build

`frontend/scripts/assert-prod-build-env.mjs` runs on `prebuild`: if `PS_PRODUCTION=1` and `NEXT_PUBLIC_CHARACTER_UI_DEV=1`, the build fails.

Pass `PS_PRODUCTION` as a Docker build arg for production frontend images.

## Staging vs production checklist

| Topic | Staging | Production |
|-------|---------|------------|
| `PS_PRODUCTION` | **Do not set** | Set `PS_PRODUCTION=1` |
| Dev flags | `SKINS_DEV=1` OK | `SKINS_DEV` and `CHARACTER_UI_DEV` must be unset |
| API keys | Compose dev defaults OK | Real `PLUGIN_KEY` / `STAFF_KEY` required |
| Internal queue/regen/plugin upload | Loopback `api.base-url` (Docker NAT private peer OK; not public hostname) | Same |
| Code inspect | Staff Bearer + `tfmc.map.staff` | Same |
| Frontend build | `NEXT_PUBLIC_CHARACTER_UI_DEV` unset for prod images | Pass `PS_PRODUCTION=1` build arg |

Full operator detail: [STAGING.md](../../STAGING.md), [ops/dev-config.md](../ops/dev-config.md).

## Free-text validation

Display names and prose fields share charset rules in `backend/src/text_validation.py` (frontend mirror: `frontend/lib/textValidation.ts`):

- Display names: Unicode letters, digits, limited punctuation; no emoji or colour codes.
- Prose: printable text; no controls or colour codes.
- Technical ids (slugs, codes): unchanged strict alphabets.

Invalid input is **rejected** at the API (400). React renders user strings as text only.

## Site dev gate (optional)

When `NEXT_PUBLIC_SITE_DEV_GATE=1`, the entire UI is replaced by a dev landing page until the visitor redeems a **profile** code and has `tfmc.map.staff`.

**Security:** Client-side gate only; API routes remain reachable if endpoints are known. Unset on public launch.

## See also

- [identity/tfmcweb.md](tfmcweb.md) - Discord link and tokens
- [cosmetics/skins.md](../cosmetics/skins.md) - skins HTTP contracts and staff routes
- [map/overview.md](../map/overview.md) - staff map gates
