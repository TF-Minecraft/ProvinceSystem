# Patreon backend handoff

The tier mapping is `tiers.yaml`. New tables are in `src/skins/schema.sql`,
created by the existing `src.skins.db.migrate()` in the app lifespan. They
share `province.db` with `discord_links`. Patron linking lives in `linking.py`:
hashed single-use OAuth state and confirmation tokens, `link/start`,
`oauth/callback`, `link/pending`, `link/confirm`, `link/cancel`, and `webhook`.

## Explicit OAuth link confirmation

`POST /patreon/link/start` keeps the existing staff (Discord), plugin
(Minecraft), and profile-session entry points. It stores the target kind and
the supplied `discord_username` or `minecraft_name` with the subject and
hashed state. Profile sessions always use the session UUID and ignore supplied
names: resolve the Minecraft name from `discord_links`, then the most recent
`discord_link_codes` record. If no name is available, display the UUID (or the
Discord id for a nameless Discord request) so the target remains explicit.

Consent alone does not create a link or grant perks. The callback consumes
the state, exchanges the code, reads the Patreon id and full name, and discards
the patron tokens. It stores the identity and target in `patreon_pending_links`
under a fresh random token, stored only as a SHA-256 hash, valid for 10 minutes.
It redirects to `{PATREON_PUBLIC_SITE_URL}/patreon/linked#confirm=<token>`.
The fragment is never sent in an HTTP request or Referer header. Failure
redirects retain `?status=<status>&tier=` and never contain identities.

All three public confirmation routes accept `{"token": ".."}` in a POST
body; the token is the credential, with no browser session required:

- `/patreon/link/pending` returns only `target_kind` (`discord` or `minecraft`),
  `target_name`, and `patreon_name`, without consuming the token.
- `/patreon/link/confirm` consumes it before attempting the link, then creates
  the OAuth link and recomputes. An unknown member triggers the existing
  creator sync before returning an entitlement result. The response is always
  `{"status": "ok|not_a_member|already_linked|relink_cooldown|expired|error",
  "tier": "<tier key or empty>"}`. Consumed tokens stay consumed on failures.
- `/patreon/link/cancel` consumes it and creates nothing, returning
  `{"status": "ok"}`.

Unknown, used or expired tokens return `expired` (`{"status": "expired"}`
for pending/cancel, with an empty `tier` for confirm). Responses and callback
redirects disable caching. Logs contain fixed messages/status codes only.
OAuth states without the target kind or display name are treated as expired:
callers must start again so the confirmation page can identify the link target.

The website removes the fragment from the address bar, loads the pending
names as text, and asks the person to confirm that the target is theirs.
Cancel displays the existing “Link not completed” result. This addresses login
CSRF across all three entry points: someone completing an attacker's consent
URL sees the attacker's account before any link is created. A browser-session
binding cannot establish ownership for links started in Discord or Minecraft.
`POST /patreon/link/unlink` also accepts an absent body for profile sessions;
staff/plugin requests still require their subject through the existing auth
helper.

## Interface for OAuth and webhook routes

Import from `src.patreon.service`:

- `create_or_update_link(patreon_user_id, discord_user_id=None,
  player_uuid=None, method="oauth", *, force=False, config=None, conn=None,
  now=None) -> str`. Returns `ok`, `already_linked`, `relink_cooldown`, or
  `invalid_subject`. Invalid UUID or method raises `ServiceError` with a stable
  code. Staff force bypasses cooldown but never subject uniqueness. This
  function stores the link but does not recompute; call `recompute_link` next.
- `recompute_link(patreon_user_id, *, config=None, conn=None,
  link_success=False) -> dict`. Returns the public status shape, computes
  current entitlement, and enqueues changes (or logs them in shadow mode).
  Pass `link_success=True` after OAuth. It deduplicates this notification by
  the link event. Recomputing also clears previously owned subjects on relink.
- `refresh_member(member_id, *, config=None, client=None) -> dict`. Fetches
  one complete API member and stores/recomputes atomically. Returns
  `{"ok": true, "members": 1, "brake_held": bool}`, or `{"ok": false,
  "detail": "patreon_sync_busy"|"patreon_sync_failed"|"patreon_disabled"}`.
  It is synchronous: dispatch it with `asyncio.to_thread` or a background
  worker. Webhook handling should retain/retry busy or failed refreshes.
- `sync_now(*, config=None, client=None)` has the same summary contract for
  a complete paginated campaign snapshot. Never call the real API in tests;
  inject `PatreonClient(..., http=httpx.Client(transport=MockTransport(...)))`.

Import `PatreonClient` from `src.patreon.client`:

- `exchange_authorization_code(code, redirect_uri=None) -> dict` returns the
  patron token response. Nothing persists this response. Discard it after use.
- `identity(access_token) -> dict` returns the JSON:API `data` resource, with
  `id` and `attributes`; it does not persist the patron token.
- `member(member_id)`, `members()`, `creator_get(path, **kwargs)`,
  `refresh_tokens()` use authoritative persisted creator credentials.
- `close()` closes an internally owned HTTP client. Errors are `PatreonError`
  with fixed, non-sensitive codes. Never log tokens or API response bodies.

`conn=` on link and recompute functions participates in the caller's
transaction without committing. Confirmation uses
`with src.skins.db.connect() as conn`, `BEGIN IMMEDIATE`, create the link and,
if successful, recompute with that connection. `Config.from_env()` supplies
runtime configuration. Router helpers `require_enabled`, `caller_subject`,
`require_staff`, `require_plugin` are in `src.api.patreon_routes`. Register
future routes on `patreon_router` or on a separate router under `/patreon`.

## State and delivery behavior

Unlink retains an inactive link tombstone for cooldown enforcement. Auto-link
runs only when no link row exists for that Patreon user, so an explicit unlink
stays disconnected until the patron links again or staff links them. Missing
identity halves are resolved dynamically from `discord_links`; they cannot
claim a subject explicitly owned by another Patreon link.

Desired state and applied state are separate. Only an acknowledgement (or an
explicit staff legacy import grant) records ownership of a tier. Outbox rows
not yet fetched may coalesce into a new id. Fetched rows remain immutable;
their acknowledgement records exactly their contents, then queues a fresh
change toward the latest desired tier. Cancelled/other-target ids cannot grant
ownership. Appliers should deduplicate DMs by change id before acknowledging:
HTTP outbox delivery is at least once, so an ack lost after sending a DM can
otherwise replay it. Backend recomputes do not create a second DM for the
same transition. `PATREON_SUPPRESS_DMS=1` still stores that DM on the change
row (so an acknowledgement marks it delivered) but the Discord outbox sends
`dm: null`, including after the flag is turned off, via `dm_suppressed`.

The persistent removal brake affects both outboxes and rosters. While held,
new removals are not delivered and rosters retain the highest currently owned
tier. Additions continue. Staff release replans against current desired state,
not a stale saved snapshot. Already dispatched changes cannot be recalled.
Release approvals are persisted by desired-state generation, so another sync
cannot immediately re-hold the same reductions while acknowledgements are
still pending. Distinct subsequent transitions remain subject to the brake.

Shadow mode computes member history, links and desired state, but never
queues or delivers outbox changes. Rosters expose the recorded applied tier
in shadow mode, avoiding reconciliation applying shadow decisions. Switching
apply on causes the next sync to enqueue outstanding differences.

The lifespan loop keeps a database leader lease across polling intervals;
individual snapshots and member refreshes share a second lease. HTTP calls
renew these leases, and ownership is checked inside the snapshot transaction.
Other workers wait to take leadership after expiry. Shutdown waits for the
current atomic sync and releases leadership. Creator token refresh has its
own lease to protect rotating tokens.

Emails are returned only by lookup, unlinked and import. Alerts and logging
use fixed messages and tier keys, with no emails, names, tokens or API bodies.
Only the primary `PLUGIN_KEY` may use the rank outbox/roster; secondary server
keys are refused so one server owns LuckPerms application.
