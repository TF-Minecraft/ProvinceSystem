# Patreon supporter integration

**Status:** Implemented.

**Repos:** `TFMCWeb` backend · `tfmc_bot` Patreon cog · `tfmcweb` plugin · website `/profile`

## Why

The third-party PatreonPlugin used Patreon API v1, which Patreon retires on **7 October 2026**. Patreon’s own Discord bot is also replaced. TFMCWeb now reads Patreon API v2 and owns supporter identity, tier decisions and desired state. This handles gifted memberships correctly and prevents a routine unlink/relink from being used to claim another person’s Patreon account.

## Ownership

| Concern | Owner |
|---------|-------|
| Patreon API v2, creator credentials, links, entitlement, grace, cooldown, removal brake, status, outboxes and alerts | TFMCWeb backend |
| Discord supporter roles, private DMs, role-change acknowledgements, Discord roster reconciliation and Discord linking commands | `tfmc_bot` `patreon` cog |
| LuckPerms supporter groups, plugin outbox acknowledgements and Minecraft roster reconciliation | TFMCWeb on exactly one configured server |
| Patreon authorization from the website | Patreon row under Profile → Linked accounts; link state and callback remain backend-owned |

The bot and plugin never call Patreon. The backend never edits Discord roles or LuckPerms directly. Only the primary TFMCWeb `PLUGIN_KEY` can use the LuckPerms outbox. Shared LuckPerms storage means `patreon.apply-ranks: true` must be set on exactly one server; leave it false elsewhere. The command `/patreon` can be enabled on every server.

## Linking accounts

Supporters can start the same Patreon OAuth consent flow from Discord, Minecraft or the website:

- **Discord:** `/patreon link` returns an ephemeral authorization button. After consent, the bot applies roles from the backend outbox.
- **Minecraft:** `/patreon` reports status. If no Patreon account is linked, it starts a short-lived link request and displays the authorization link. `/patreon unlink` removes the link.
- **Website:** sign in with Discord and use the Patreon row under Profile → Linked accounts (`/profile?tab=accounts`). It returns to the site after Patreon consent and can disconnect Patreon again.
- **Automatic Discord link:** during sync, an entitled Patreon member with a Discord connection is linked as `auto_discord` if no link row exists and that Discord ID is not already linked. An explicitly unlinked Patreon account is not auto-linked again.

Role changes arrive through bot polling and roster reconciliation; supporters do not need to leave and rejoin Discord to receive updates.

OAuth state is single-use and expires after 10 minutes. Patreon consent does not create the link by itself: the supporter lands on `/patreon/linked`, which names the Patreon account and the Discord or Minecraft account about to be linked, and the link is created only when they press Confirm. This stops someone sending their own link to a supporter to collect that supporter's tier. A confirmed link is stored even if the Patreon account has no mapped paid tier; the result is `not_a_member` and no perks are granted. A Patreon identity already owned by another person returns `already_linked`. Reclaiming a previously linked Patreon identity is refused for 30 days unless staff force the link. A Patreon account, Discord ID and Minecraft UUID can each belong to at most one link.

## Entitlement rules

- The backend selects the highest mapped tier in Patreon’s `currently_entitled_tiers`. Paid, gifted and free-trial entitlements all count. `last_charge_status` is not required to be `Paid`. Unmapped Free and Knight tiers do not grant a TFMC tier.
- A declined member with no currently entitled mapped tier keeps their last tier for **7 days** from the first declined sync. Returning to an entitled tier clears the grace clock. Followers, former patrons and members with no mapped tier have no entitlement.
- No link means no perks. Discord needs a Discord ID; LuckPerms needs a Minecraft UUID. The backend may fill the missing half from the existing Discord-to-Minecraft link, but it will not take a subject already owned by another Patreon link.
- The backend only asks appliers to remove TFMC supporter tiers it previously granted. The bot touches only configured Noble, Gilded and Ascended roles. TFMCWeb touches only configured Noble, Gilded and Ascended groups. Neither changes unrelated roles/groups; LuckPerms `legacy` and VIP are never touched.
- **Mass-removal brake:** if a sync would lower/remove at least 5 currently granted subjects and that count is over 25% of granted subjects, the backend holds all new removals, records an alert and continues additions. The hold persists across restarts and applies to rosters as well as outboxes.
- **Shadow mode:** `PATREON_APPLY=0` (default) records links, member history and desired tiers and logs changes that would be made. It queues no changes. Rosters continue to report recorded applied state, so Discord and LuckPerms are not changed. When apply is enabled, the next sync queues outstanding differences.
- A failed or partial Patreon sync does not recompute entitlements. Three consecutive failures raise an alert.

## Tier mapping

The backend maps Patreon tier IDs (with titles as fallback) to these checked-in tier keys. The IDs identify Patreon tiers; use the keys in bot and plugin mappings.

| Patreon tier | Backend key | Rank | Bot role mapping | LuckPerms group default |
|--------------|-------------|------|------------------|-------------------------|
| Noble Tier | `noble` | 1 | Noble role | `noble` |
| Gilded Tier | `gilded` | 2 | Gilded role | `gilded` |
| Ascended Tier | `ascended` | 3 | Ascended role | `ascended` |

The bot role IDs are set in its `patreon/config.yml` `roles` block (or `PATREON_ROLE_NOBLE`, `PATREON_ROLE_GILDED`, `PATREON_ROLE_ASCENDED`). TFMCWeb maps keys to group names under `patreon.groups` in its server `config.yml`.

## Configuration

Set backend variables in its secret environment. The example defaults are shown below; do not place real credentials in documentation or source control.

| Variable | Default | Meaning |
|----------|---------|---------|
| `PATREON_ENABLED` | `0` | Master switch. Disabled routes return 503 and no sync loop runs. |
| `PATREON_APPLY` | `0` | `0` computes/logs in shadow mode; `1` queues applier changes. |
| `PATREON_CLIENT_ID`, `PATREON_CLIENT_SECRET` | unset | Patreon API v2 app credentials. |
| `PATREON_CREATOR_ACCESS_TOKEN`, `PATREON_CREATOR_REFRESH_TOKEN` | unset | Initial creator tokens. After first storage, the database copy is authoritative and refresh rotates it. |
| `PATREON_WEBHOOK_SECRET` | unset | Patreon webhook signature key; webhook route is unavailable without it. |
| `PATREON_API_BASE` | `https://www.patreon.com` | API base; set a stub only for development/testing. |
| `PATREON_CAMPAIGN_ID` | discovered | Optional campaign ID pin. |
| `PATREON_REDIRECT_URI` | `https://www.tfminecraft.net/api/patreon/oauth/callback` | Must match the Patreon app callback. |
| `PATREON_PUBLIC_SITE_URL` | `https://www.tfminecraft.net` | Website base for post-consent redirect. |
| `PATREON_SYNC_INTERVAL_SECONDS` | `600` | Campaign polling interval. |
| `PATREON_DECLINED_GRACE_DAYS` | `7` | Declined payment grace period. |
| `PATREON_RELINK_COOLDOWN_DAYS` | `30` | Delay before a Patreon identity can move to another person. |
| `PATREON_MASS_REMOVAL_FRACTION` | `0.25` | Fraction threshold for the removal brake; minimum 5 subjects also applies. |
| `PATREON_SUPPRESS_DMS` | `0` | `1` stores/acks Discord changes without sending Patreon DMs; useful during migration. |

In production, enabling Patreon requires client ID, client secret and creator access/refresh tokens at startup. Staff and plugin keys use the backend’s existing `STAFF_KEY` and `PLUGIN_KEY`; those are not Patreon-specific. The bot reads `API_BASE_URL`, `STAFF_KEY`, tier role IDs and poll settings from YAML or its documented environment overrides. TFMCWeb uses `api.base-url`, `api.plugin-key`, and:

```yaml
patreon:
  enabled: false
  apply-ranks: false
  poll-seconds: 60
  reconcile-minutes: 30
  groups:
    noble: noble
    gilded: gilded
    ascended: ascended
```

`enabled` controls `/patreon` and the writer; `apply-ranks` starts the writer only when enabled. Keep `apply-ranks` true on one server only.

## Routes and authentication

All routes are under `/patreon`. Routes also require `PATREON_ENABLED=1`.

| Route | Auth | Use |
|-------|------|-----|
| `POST /link/start` | Staff key + Discord ID, plugin key + player UUID, or profile Bearer session | Start OAuth for one account. |
| `GET /oauth/callback` | Public, single-use OAuth state | Finish consent and store a pending link; redirects to the public site with a one-time confirm token in the URL fragment, or a failure status. |
| `POST /link/pending`, `POST /link/confirm`, `POST /link/cancel` | Public, one-time confirm token in the body | Show the two accounts, then create or discard the pending link. |
| `POST /link/unlink`, `GET /status` | Same three caller options | Unlink or read the caller’s link and effective tier. |
| `POST /webhook` | Patreon HMAC signature | Record a known member event and refresh that member in background. Unknown events are accepted and ignored. |
| `GET /staff/role-changes`, `POST /staff/role-changes/ack`, `GET /staff/roster` | Staff key | Discord role outbox, acknowledgement and reconciliation roster for the bot. |
| `GET /plugin/rank-changes`, `POST /plugin/rank-changes/ack`, `GET /plugin/roster` | Primary plugin key only | LuckPerms outbox, acknowledgement and roster for TFMCWeb. Secondary server keys are refused. |
| `GET /staff/lookup`, `POST /staff/link`, `POST /staff/unlink`, `GET /staff/unlinked` | Staff key | Look up people, manually link/unlink and find entitled unlinked supporters. Lookup/unlinked may return email. |
| `POST /staff/resync`, `GET /staff/health`, `GET /staff/alerts`, `POST /staff/alerts/ack` | Staff key | Run sync and inspect/acknowledge service health and alerts. |
| `POST /staff/brake/release` | Staff key | Release a held removal brake and replan removals from current desired state. |
| `POST /staff/import` | Staff key | Dry-run or apply legacy links and seed existing LuckPerms grants during migration. |

Outbox delivery is at least once. Both appliers acknowledge only after successful application. A missed acknowledgement causes the role or group change to be retried, which is harmless because the edits are idempotent, but the DM attached to that change can be sent a second time. The backend only treats acknowledged grants (or explicit legacy import grants) as owned/applied state.

## Staff tools

Discord staff commands are ephemeral. Staff and Helpers can run `/patreon health` and `/patreon resync`. Staff only can run `/patreon lookup <member>`, `/patreon forcelink <member> <patreon_email>` and `/patreon unlinked`; email output is only shown ephemerally. `forcelink` bypasses the cooldown, but not the one-person-per-Discord-ID/UUID uniqueness checks. There is no bot slash command to release the mass-removal brake; use the staff API route.

For a hand link, first use `/patreon lookup` or `GET /patreon/staff/lookup` to confirm the intended person and Patreon identity. Then use `/patreon forcelink` or `POST /patreon/staff/link` with exactly one Patreon identity (`patreon_email` or `patreon_user_id`) and the intended Discord ID and/or Minecraft UUID. A successful manual link recomputes desired state. Use `force: true` only when staff have verified the ownership change; it bypasses cooldown, not subject conflicts. Never put emails or Patreon IDs in public channels or game logs.

## Operations

### Read health and alerts

Use `/patreon health` in Discord or `GET /patreon/staff/health`. `enabled` should be true. `apply` tells whether changes are being queued or shadowed. `last_sync_at` and `last_sync_ok` show the latest campaign attempt; `consecutive_failures` should return to zero after a successful sync. `members` is the latest campaign snapshot size; `links` is stored links; `entitled_linked` and `entitled_unlinked` help find account-linking gaps. `brake_held` means removals are paused, while additions can continue.

Alerts use stable kinds and generic messages:

| Alert kind | Meaning | Staff action |
|------------|---------|---------------|
| `sync_failed` | Patreon snapshot/member refresh failed repeatedly; partial data was not used to remove perks. | Check backend connectivity and the Patreon API/service logs, then `/patreon resync`. If it persists, escalate to the backend owner. |
| `token_refresh_failed` | Creator access token could not be refreshed, so API sync cannot continue. | Check Patreon app credentials and the authoritative creator token pair, rotate/re-authorize them as needed, then resync. |
| `brake_held` | The planned reduction exceeded the configured mass-removal threshold. No new removals are delivered; additions continue. | Compare `/patreon health` counts with the current campaign and verify the tier mapping and Patreon snapshot. Release only after the reductions are expected. |

Discord role permission/hierarchy failures are alerted in the configured bot alert channel, not as backend API alerts. Restore the bot’s manage-role permission and move its highest role above the three configured supporter roles; the cog retries later. TFMCWeb logs rank-poll, ack, group-save and missing-LuckPerms errors on the writer server; check `patreon.enabled`, `patreon.apply-ranks`, the primary plugin key, group mappings and LuckPerms availability.

### Release the removal brake

After checking that the reductions are correct, call `POST /patreon/staff/brake/release` with `X-Staff-Key`. This replans against current desired state and allows pending removals to resume; it does not replay an old saved snapshot. Already dispatched changes cannot be recalled. Check health and both appliers after release.

### Rotate credentials

Update Patreon app client credentials and webhook secret in the backend secret environment, then restart the backend and update the webhook secret in Patreon’s webhook configuration at the same time. For creator API access, the environment tokens seed the database only when no persisted creator token row exists. Once initialized, the rotated refresh token in the database is authoritative; changing only `PATREON_CREATOR_*` environment values will not replace it. Coordinate a creator reauthorization/refresh-token replacement with the backend operator who can safely update the persisted `patreon_tokens` row, then confirm `/patreon health` and a successful resync. Do not copy tokens into tickets, chat, or logs. Patreon user OAuth tokens are exchanged only to identify the user and are discarded.

## Rules

- Keep Patreon API calls and credentials in TFMCWeb. No Patreon secrets or emails belong on game servers or in bot logs.
- Do not add public patron announcements or staff-channel reports for new patrons.
- Do not change legacy/VIP groups or any role/group outside the mapped supporter tiers.
- Use shadow mode first when introducing a new mapping or deployment. Turn on backend apply only after the computed changes have been reviewed.

See the [TFMCWeb identity guide](../identity/tfmcweb.md), [Discord bot integration](discord-bot.md), and the [backend protocol reference](patreon-backend.md) for implementation details.
