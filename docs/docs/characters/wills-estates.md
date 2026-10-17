# Wills and estates on the website

Profile shows each living character's will and lets its owner change it. Dead
and missing characters open a read-only memorial with the death date, the will
heir and where the estate went. RPCharacters owns wills and estates; the site
mirrors what it pushes and sends will changes back through a pull-and-ack
queue, like web creation ([creator.md](creator.md)).

**Repos:** `TFMCWeb` · `rpcharacters/` · `tfmcweb/` (gateway allow-list)

## Profile

- **Living cards** carry a strip under the card: "Heir: Kira" or "No will",
  with *Change* and *Revoke*. *Change* opens a name search; picking a result
  sends the change. Until RPCharacters answers, the strip shows "Pending: …"
  in place of the buttons. A refused change shows why for seven days.
- **Heir search** lists living characters of the player's own realm whose name
  contains the text: three letters or more, ten results, twenty searches a
  minute per player. Each result shows name, race, the first eight characters
  of its id, and "yours" for the player's own characters. Account names never
  appear, and nothing shows who names whom.
- **Dead and missing cards** open `/profile?tab=characters&character=<id>`,
  which shows the death date ("Before records began" for legacy deaths with no
  date), the heir captured at death, the estate's state, each part's recipient,
  the money moved and what each part of the server moved.
- **Wardrobe and kits** refuse dead and missing characters: the pages say so and
  the backend answers `403 Character is not alive` to every edit. The wardrobe
  read (`GET /characters/{id}/wardrobe`) and the kit list refuse them too,
  because the wardrobe read also trims slots to the rank's limit. The face and
  figure pictures still load, for the cards and the memorial.

## Data

| Table | Key | Written by |
|---|---|---|
| `character_roster` (new columns `died_at`, `death_id`, `will_heir_id`, `will_heir_name`, `will_revision`) | `(player_uuid, realm_id, character_id)` | roster push; an applied will ack |
| `character_estates` | `(realm_id, death_id)` | roster push only; never deleted by a push |
| `will_requests` | `id` | Profile (`pending`), plugin ack (`acked`), a newer request (`replaced`) |

The tables and columns are declared by the ordered PostgreSQL migrations in
`backend/src/database/migrations/`. Code:
[`characters/estates.py`](../../../backend/src/characters/estates.py),
[`characters/wills.py`](../../../backend/src/characters/wills.py).

Estates are keyed by realm as well as death, because legacy death ids are
derived from the character id and Dev holds copies of Main's characters.

## Roster push

`PUT /characters/plugin/roster` accepts these optional keys on each character.
Times from the plugin are epoch milliseconds; the site returns ISO-8601 UTC.

```json
{
  "died_at": 1760356800000,
  "death_id": "uuid",
  "will_heir_id": "uuid or null",
  "will_heir_name": "Kira",
  "will_revision": 3,
  "estate": {
    "death_id": "uuid",
    "status": "OPEN | HELD | CANCELLED | DECIDED | REVERTED",
    "due_at": 1760443200000,
    "decided_at": 1760443260000,
    "revision": 0,
    "updated_at": 1760443260000,
    "heir_name": "Kira",
    "recipients": {
      "money": {"kind": "CHARACTER", "name": "Kira"},
      "property": {"kind": "WAITING", "name": null},
      "guild_locks": {"kind": "CHARACTER", "name": "Guruth"},
      "letters": {"kind": "SENDER", "name": null}
    },
    "money_moved_cents": 34025,
    "participants": {
      "thievery": {"outcome": "DONE", "revision": 0, "counts": {"locks": 297}}
    }
  }
}
```

- `died_at` and `death_id` are stored when either key is present; null clears
  them. A push without them leaves the stored values.
- The will is written only when `will_revision` is present and not lower than
  the stored revision; an equal revision replaces the names.
- An estate with a lower `revision` than the stored one is ignored. With the
  same revision, it replaces the stored one only when its `updated_at` is not
  older (an estate without `updated_at` cannot replace one that has it). An
  estate already stored for another character is left alone. `updated_at` is
  compared to the millisecond.
- Every estate push must carry `status`, `revision` and a death id (its own
  `death_id` or the character's); without them the estate is dropped and the
  rest of the push still applies. Send `updated_at` every time too.
- Negative counts and money read as zero.
- `estate.death_id` defaults to the character's `death_id`. Profile shows the
  estate of the character's current death; with no `death_id`, its latest one.
- Recipient kinds `FROZEN`, `WAITING`, `SENDER` and `NONE` show as "Held by
  staff", "Waiting for a guild leader", "Returned to senders" and "Nothing";
  others show their `name`. Counts are summed by label across participants and
  shown as "297 locks, 1 entity", so labels are plural nouns players know.
  Money is shown only from `money_moved_cents`.

## Will requests

### Profile

`POST /characters/{character_id}/will` with a Profile session:

```json
{"heir_character_id": "uuid or null", "base_revision": 3}
```

`null` revokes. `base_revision` is the `will.revision` the page showed. The
answer is `{"ok": true, "request": {…}}`, or:

| Status | Detail | When |
|---|---|---|
| 403 | `Character not found` | not the caller's character in the session's realm |
| 409 | `character_not_alive` | the character is not ALIVE |
| 409 | `will_changed` | `base_revision` differs from the site's stored revision |
| 409 | `request_pending` | a request is already waiting and is under ten minutes old |
| 400 | `invalid_heir` | heir unknown in the realm, not ALIVE, or the testator |

A pending request older than ten minutes is marked `replaced` by a new one, so
an old plugin that never pulls cannot block the will for good.

`GET /characters/heirs?q=<text>&character_id=<testator>` returns
`{"results": [{"id", "short_id", "name", "race", "own"}]}`; 400 under three
letters, 429 over the rate limit.

`GET /characters` and `GET /profile` add, per roster character, `died_at` and
`death_id`; for ALIVE characters `will {heir_id, heir_name, revision}` and
`will_request` (the pending request, or the last refused one within seven
days); for DEAD and MISSING characters `estate` (or null).

### Plugin

Both routes use `X-Plugin-Key` and require a realm. Neither defaults to `main`.

`GET /characters/plugin/wills/pending?realm_id=<realm>` → oldest first:

```json
{"requests": [{"id": "uuid", "realm_id": "main", "character_id": "uuid",
  "account_uuid": "uuid", "heir_character_id": "uuid or null",
  "base_revision": 3, "created_at": "2026-10-13T12:00:00Z"}]}
```

`POST /characters/plugin/wills/applied`:

```json
{"realm_id": "main",
 "results": [{"id": "uuid", "result": "applied", "will_revision": 4, "heir_name": "Kira"}]}
```

`result` is one of `applied`, `stale`, `invalid heir`, `invalid`,
`character dead`. With `applied`, an optional `will_revision` updates the
roster row at once when it is exactly `base_revision + 1` (and not older than
the stored will); any other value waits for the roster push that follows. The
answer lists `acked` ids, `already` ids (answered or replaced before; a
replayed ack lands here and changes nothing) and `refused` entries with reason
`realm` (the request belongs to another realm), `result` or `unknown`.

TFMCWeb's gateway adds `realm_id` to both routes as a second guard.

## Tests

`backend/src/characters/test_wills_estates.py` covers the push rules (revision
order, estates kept when a character leaves the push, realms kept apart), the
Profile and plugin routes (ownership, realm required and checked, replays,
replacement of stale pending requests), the heir search limits and the
wardrobe and kit refusals. Frontend tests:
`app/components/character/CharacterWill.test.tsx`,
`lib/characters/wills.test.ts`, and the memorial case in
`app/components/profile/ProfilePanel.test.tsx`.
