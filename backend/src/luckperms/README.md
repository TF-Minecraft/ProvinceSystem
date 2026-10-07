# LuckPerms in the staff panel

The website shows and edits LuckPerms without touching its database. One
server's TFMCWeb (Main's) is the bridge: it publishes a snapshot of LuckPerms
to the site and applies changes that staff queue on the site, through the
LuckPerms API. Dev and Main share one LuckPerms MariaDB, so exactly one server
may apply changes. Another server may publish to its own site (Dev publishes to
dev.tfminecraft.net) without applying, which makes that site read-only.

## Rights

| Who | May |
| --- | --- |
| mod | view everything: groups, tracks, every player's groups and permissions, change history |
| admin | add or remove the groups in `policy.yaml` `admin_groups` on players, promote/demote players along tracks between those groups, set or unset player permissions matching `admin_permissions` |
| root | everything, including staff groups, other permissions, meta (prefix/suffix/weight) on players, group definitions and tracks |

A listed group counts as an admin group only while everything it inherits, in
any context, is listed too, so a root edit to a group definition cannot hand
admins a staff group by inheritance. Unknown permissions, wildcards and regex
nodes are root-only.

Admins may not change anything on their own Minecraft account, on a player
whose linked website account is admin or root, or on a player who holds or
inherits a root-only group (in-game staff, linked or not). Rights are checked
when a change is queued and again when the bridge collects it, so a demotion
in between cancels it. Every change carries a
reason and is written to `admin_audit`, and LuckPerms logs it (`/lp log`) with
the source `web:<discord name>`.

## Plugin protocol

All routes need the primary `X-Plugin-Key`; secondary keys are refused.

### Snapshot

`PUT /luckperms/plugin/snapshot` (JSON, at most 16 MiB):

```json
{
  "server": "main",
  "generated_at": 1791321779,
  "revision": 1791321779123,
  "hash": "<sha-256 hex of the canonical groups/tracks/users JSON>",
  "groups": [{"name": "staff", "display_name": null, "weight": 200, "nodes": [NODE]}],
  "tracks": [{"name": "staff", "groups": ["staff_player", "staff_inactive", "staff"]}],
  "users": [{"uuid": "…", "name": "drefvelin", "nodes": [NODE]}]
}
```

`NODE` is `{"key": "group.staff", "value": true, "contexts": {"server": ["main"]}, "expiry": 0}`;
`expiry` is unix seconds, 0 for permanent; `contexts` maps each key to its values (empty object for global).
`users` holds every user with at least one stored node (`UserManager.searchAll` with an empty key prefix).
The site replaces its whole mirror in one transaction and answers `{"ok": true}`.

`revision` orders everything the bridge reports: it strictly increases across snapshots and
results, also across restarts (the bridge uses `max(last + 1, current time in ms)`). The site
ignores a snapshot or result state whose revision is not above the newest it has stored
(answering `{"ok": true, "stale": true}`), so a request delayed past a newer one cannot undo it.

`POST /luckperms/plugin/snapshot/unchanged` `{"hash": "…", "revision": …}` answers `{"ok": true}` and
marks the mirror current when the hash matches the stored one, else `{"ok": false, "need_full": true}`.

The bridge builds a snapshot every `snapshot-seconds` (default 30) and right after applying changes,
on the same single worker thread that applies changes, so a snapshot never predates an applied change.

### Changes

`GET /luckperms/plugin/changes` returns up to 20 changes in id order and records the poll time
(the site shows the bridge as connected while polls are recent):

```json
{"changes": [{
  "id": 12,
  "target_type": "user",           // user | group | track
  "target": "5b0c…-uuid",          // user UUID, group name or track name
  "target_name": "drefvelin",
  "actor_name": "web:w.o.n",       // LuckPerms action source name
  "actor_uuid": null,              // the actor's linked Minecraft UUID, if any
  "description": "parent add staff",  // LuckPerms action log text
  "ops": [OP]
}]}
```

Ops, applied in order to one holder and saved once:

| target | op | fields | precondition |
| --- | --- | --- | --- |
| user, group | `add_node` | `node` | the exact node (key, value, contexts, expiry) is absent |
| user, group | `remove_node` | `node` | the exact node is present |
| group | `create_group` | | the group does not exist |
| group | `delete_group` | | the group exists |
| track | `create_track` | | the track does not exist |
| track | `delete_track` | | the track exists |
| track | `set_groups` | `groups` (ordered) | the track exists and every group exists |

The bridge checks every precondition in op order against a staged copy of the live LuckPerms data
(so create-then-add and remove-then-add work) before mutating anything; if one fails, nothing is
mutated or saved and the result is `{"ok": false, "error": "<code>"}` with codes
`node_exists`, `node_missing`, `group_exists`, `group_missing`, `track_exists`, `track_missing`,
`bad_op`, `bad_target`, `save_failed`. A `group.<name>` node whose group does not exist is `group_missing`.
If saving fails after mutating a loaded holder, the bridge reloads that holder from storage so the
server does not keep an unsaved change in memory. After saving a user it pushes a user update; after
a group or track change it pushes a full update. It submits one LuckPerms action per change
(source UUID: the actor's linked Minecraft UUID, else the nil UUID).

`POST /luckperms/plugin/changes/results`:

```json
{"results": [{"id": 12, "ok": true, "error": null, "revision": 1791321780456, "state": STATE}]}
```

`STATE` (optional) is the target after the change: a user `{"uuid", "name", "nodes"}`, a group
`{"name", "display_name", "weight", "nodes"}` or `null` (deleted, or tracks). The site updates its
mirror for that target at once. The bridge keeps results it could not post and posts them again
on later ticks until the site answers `ok`.

Site side, a change is `pending` until fetched, then `sent`, and the site never offers it again: a
change is applied at most once. A sent change with no result after 300 s becomes `unknown` (staff
are told to check the player); a late result still settles it. A change not fetched within
10 minutes `expired`. New changes are refused with `bridge_offline` unless the bridge polled in the
last 60 s, and always on a site with `LUCKPERMS_READ_ONLY=1` (dev.tfminecraft.net, whose server
shares LuckPerms with Main).
