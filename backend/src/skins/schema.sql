CREATE TABLE IF NOT EXISTS codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash TEXT NOT NULL UNIQUE,
    code_plaintext TEXT,
    player_uuid TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'skin',
    realm_id TEXT NOT NULL DEFAULT 'main',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    redeemed_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    player_uuid TEXT NOT NULL,
    code_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    grip_preset TEXT,
    base_set TEXT,
    tiers TEXT,
    tier_aliases TEXT,
    add_name INTEGER NOT NULL DEFAULT 0,
    name_colours TEXT,
    name_styles TEXT,
    status TEXT NOT NULL,
    deny_reason TEXT,
    dir_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    applied_at TEXT,
    discord_message_id TEXT,
    discord_user_id TEXT,
    staff INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    scroll TEXT,
    tier_scrolls TEXT,
    realm_id TEXT NOT NULL DEFAULT 'main',
    FOREIGN KEY (code_id) REFERENCES codes(id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    code_id INTEGER NOT NULL,
    player_uuid TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (code_id) REFERENCES codes(id)
);

CREATE TABLE IF NOT EXISTS discord_links (
    player_uuid TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL UNIQUE,
    minecraft_name TEXT,
    discord_username TEXT,
    linked_at TEXT NOT NULL,
    left_guild_at TEXT,
    grace_until TEXT
);

CREATE TABLE IF NOT EXISTS discord_link_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash TEXT NOT NULL UNIQUE,
    player_uuid TEXT NOT NULL,
    minecraft_name TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);

-- One-time war declare codes. Staff mint one in Discord bound to an attacker,
-- a defender and a war goal; the plugin validates it, then redeems it only once
-- the war actually exists. No plaintext is stored: staff see the code once.
CREATE TABLE IF NOT EXISTS war_declare_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash TEXT NOT NULL UNIQUE,
    realm_id TEXT NOT NULL DEFAULT 'main',
    attacker_faction_id TEXT NOT NULL,
    defender_faction_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    created_by_discord_id TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    redeemed_at TEXT,
    redeemed_war_id TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS skin_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    submission_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS plugin_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    player_uuid TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_slug ON submissions(slug);
CREATE INDEX IF NOT EXISTS idx_codes_hash ON codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_discord_links_discord ON discord_links(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_discord_link_codes_hash ON discord_link_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_war_declare_codes_hash ON war_declare_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_war_declare_codes_outstanding
    ON war_declare_codes(realm_id, redeemed_at, revoked);
CREATE INDEX IF NOT EXISTS idx_skin_notifications_undelivered
    ON skin_notifications(delivered_at, created_at);
CREATE INDEX IF NOT EXISTS idx_plugin_notices_undelivered
    ON plugin_notices(delivered_at, created_at);

CREATE TABLE IF NOT EXISTS player_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_uuid TEXT NOT NULL,
    staff_uuid TEXT,
    staff_name TEXT,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    player_uuid TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_player_warnings_uuid
    ON player_warnings(player_uuid, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_notifications_undelivered
    ON moderation_notifications(delivered_at, created_at);

CREATE TABLE IF NOT EXISTS armourshop_catalog (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS armourshop_player_meta (
    player_uuid TEXT PRIMARY KEY,
    name_colour_stops INTEGER NOT NULL DEFAULT 0,
    max_3d_pair_bytes INTEGER NOT NULL DEFAULT 0,
    skin_token_cooldown_days INTEGER NOT NULL DEFAULT -1,
    skin_kinds_json TEXT NOT NULL DEFAULT '[]',
    allow_armor_3d_helmet INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lore_item_customisations (
    player_uuid TEXT NOT NULL,
    character_id TEXT NOT NULL,
    kit_key TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    lore_json TEXT NOT NULL DEFAULT '[]',
    existing_skin_id TEXT,
    submission_id TEXT,
    state TEXT NOT NULL DEFAULT 'draft',
    skin_slug TEXT,
    ready_at TEXT,
    applied_at TEXT,
    deny_reason TEXT,
    updated_at TEXT NOT NULL,
    realm_id TEXT NOT NULL DEFAULT 'main',
    PRIMARY KEY (player_uuid, character_id, kit_key)
);

CREATE TABLE IF NOT EXISTS character_wardrobe_slots (
    player_uuid TEXT NOT NULL,
    character_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    png_relpath TEXT,
    texture_value TEXT,
    texture_signature TEXT,
    model TEXT,
    display_name TEXT,
    apply_pending INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_uuid, character_id, slot)
);

CREATE TABLE IF NOT EXISTS character_create_wardrobe (
    create_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    png_relpath TEXT,
    texture_value TEXT,
    texture_signature TEXT,
    model TEXT,
    display_name TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (create_id, slot)
);

CREATE TABLE IF NOT EXISTS drink_submissions (
    id TEXT PRIMARY KEY,
    player_uuid TEXT NOT NULL,
    code_id INTEGER NOT NULL,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    recipe_json TEXT NOT NULL,
    status TEXT NOT NULL,
    deny_reason TEXT,
    texture_id TEXT,
    new_texture INTEGER NOT NULL DEFAULT 0,
    dir_path TEXT NOT NULL,
    discord_user_id TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    applied_at TEXT,
    realm_id TEXT NOT NULL DEFAULT 'main',
    FOREIGN KEY (code_id) REFERENCES codes(id)
);

CREATE TABLE IF NOT EXISTS drink_textures (
    id TEXT PRIMARY KEY,
    owner_uuid TEXT NOT NULL,
    cmd INTEGER,
    ia_item_id TEXT,
    png_path TEXT NOT NULL,
    refcount INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drink_catalog (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drink_player_meta (
    player_uuid TEXT PRIMARY KEY,
    allow_drink_texture INTEGER NOT NULL DEFAULT 0,
    name_colour_stops INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rpc_player_meta (
    player_uuid TEXT NOT NULL,
    realm_id TEXT NOT NULL DEFAULT 'main',
    name_colour_stops INTEGER NOT NULL DEFAULT 0,
    allow_drink_texture INTEGER NOT NULL DEFAULT 0,
    max_alive_characters INTEGER,
    wardrobe_skin_slots INTEGER NOT NULL DEFAULT 1,
    max_3d_pair_bytes INTEGER NOT NULL DEFAULT 0,
    skin_token_cooldown_days INTEGER NOT NULL DEFAULT -1,
    skin_kinds_json TEXT NOT NULL DEFAULT '[]',
    allow_armor_3d_helmet INTEGER NOT NULL DEFAULT 0,
    permission_flags_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_uuid, realm_id)
);

CREATE TABLE IF NOT EXISTS drink_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    submission_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS cosmetic_mint_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_uuid TEXT NOT NULL,
    reset_at TEXT NOT NULL,
    staff_uuid TEXT
);

CREATE INDEX IF NOT EXISTS idx_drink_submissions_status
    ON drink_submissions(status);
CREATE INDEX IF NOT EXISTS idx_drink_submissions_slug
    ON drink_submissions(slug);
CREATE INDEX IF NOT EXISTS idx_drink_textures_owner
    ON drink_textures(owner_uuid);
CREATE INDEX IF NOT EXISTS idx_drink_notifications_undelivered
    ON drink_notifications(delivered_at, created_at);
CREATE INDEX IF NOT EXISTS idx_cosmetic_mint_resets_player
    ON cosmetic_mint_resets(player_uuid);

CREATE TABLE IF NOT EXISTS map_chronicle_snapshots (
    map_id      TEXT NOT NULL,
    day         TEXT NOT NULL,
    realm_id    TEXT NOT NULL DEFAULT 'main',
    captured_at INTEGER NOT NULL,
    bytes       INTEGER NOT NULL,
    geometry_version TEXT,
    manifest    TEXT NOT NULL,
    PRIMARY KEY (map_id, day)
);

CREATE TABLE IF NOT EXISTS map_chronicle_snapshots_archive (
    map_id      TEXT NOT NULL,
    day         TEXT NOT NULL,
    realm_id    TEXT NOT NULL DEFAULT 'main',
    captured_at INTEGER NOT NULL,
    bytes       INTEGER NOT NULL,
    geometry_version TEXT,
    manifest    TEXT NOT NULL,
    archived_at INTEGER NOT NULL,
    PRIMARY KEY (map_id, day, archived_at)
);

CREATE INDEX IF NOT EXISTS idx_map_chronicle_snapshots_archive_map
    ON map_chronicle_snapshots_archive(map_id, archived_at);

-- Audit trail for staff-triggered chronicle wipes (and their restores).
-- `wiped_at` is the archive stamp the wipe used: it is both the audit clock and
-- the key that ties this row to its `map_chronicle_snapshots_archive` rows and
-- to the `chronicle.bak.<wiped_at>` directory, so a restore can find both.
CREATE TABLE IF NOT EXISTS map_chronicle_wipes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id      TEXT NOT NULL,
    wiped_at    INTEGER NOT NULL,
    wiped_by    TEXT NOT NULL,
    day_count   INTEGER NOT NULL DEFAULT 0,
    -- NULL when the wipe found index rows but no directory to set aside.
    backup_path TEXT,
    reason      TEXT NOT NULL,
    restored_at INTEGER,
    restored_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_map_chronicle_wipes_map
    ON map_chronicle_wipes(map_id, wiped_at);

-- Economy ledger (SimpleFactions `chronicle` upload mode). Partitioned on the
-- captured_at UTC date; `server_day` is the in-game clock and drifts, so it is
-- carried alongside but never used as a key.
CREATE TABLE IF NOT EXISTS map_ledger_days (
    map_id      TEXT NOT NULL,
    day         TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    captured_at_ts INTEGER NOT NULL,
    server_day  INTEGER,
    day_progress_seconds INTEGER,
    -- 0 when this day's canonical row is only the latest partial snapshot.
    complete    INTEGER NOT NULL DEFAULT 0,
    schema_version INTEGER NOT NULL DEFAULT 0,
    faction_count INTEGER NOT NULL DEFAULT 0,
    guild_count INTEGER NOT NULL DEFAULT 0,
    globals     TEXT NOT NULL,
    PRIMARY KEY (map_id, day)
);

-- Faction identity is (id, founded_at) hashed into faction_key: ids derive from
-- the faction name and are reused after deletion.
CREATE TABLE IF NOT EXISTS map_ledger_factions (
    map_id      TEXT NOT NULL,
    faction_key TEXT NOT NULL,
    faction_id  TEXT NOT NULL,
    founded_at  TEXT NOT NULL,
    first_seen_day TEXT NOT NULL,
    first_seen_at  TEXT NOT NULL,
    last_seen_day  TEXT NOT NULL,
    last_seen_at   TEXT NOT NULL,
    last_name   TEXT,
    last_rgb    TEXT,
    deleted_day TEXT,
    deleted_at  TEXT,
    PRIMARY KEY (map_id, faction_key)
);

CREATE TABLE IF NOT EXISTS map_ledger_faction_days (
    map_id      TEXT NOT NULL,
    day         TEXT NOT NULL,
    faction_key TEXT NOT NULL,
    faction_id  TEXT NOT NULL,
    founded_at  TEXT NOT NULL,
    name        TEXT,
    rgb         TEXT,
    overlord    TEXT,
    wealth      REAL,
    bank        REAL,
    vassal_wealth REAL,
    net_income  REAL,
    inflation_delta REAL,
    trade_power REAL,
    prestige    REAL,
    "rank"      TEXT,
    rank_level  INTEGER,
    rank_up_at   REAL,
    rank_down_at REAL,
    prestige_position INTEGER,
    wealth_position   INTEGER,
    provinces   INTEGER,
    realm_size  INTEGER,
    tier        TEXT,
    tier_index  INTEGER,
    highest_title TEXT,
    members     INTEGER,
    members_with_vassals INTEGER,
    settlements INTEGER,
    population  INTEGER,
    installations INTEGER,
    forts       INTEGER,
    wealth_breakdown   TEXT NOT NULL DEFAULT '{}',
    prestige_breakdown TEXT NOT NULL DEFAULT '{}',
    subjects    TEXT NOT NULL DEFAULT '[]',
    wars        TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (map_id, day, faction_key)
);

-- No founded_at in the guild payload, so guild identity is weak: a deleted and
-- recreated guild reads as continuous. Documented limitation, no guild registry.
CREATE TABLE IF NOT EXISTS map_ledger_guild_days (
    map_id      TEXT NOT NULL,
    day         TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    faction_id  TEXT,
    name        TEXT,
    type        TEXT,
    wealth      REAL,
    bank        REAL,
    expansions  INTEGER,
    trade_power REAL,
    credit_score REAL,
    size        INTEGER,
    PRIMARY KEY (map_id, day, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_map_ledger_factions_id
    ON map_ledger_factions(map_id, faction_id);
CREATE INDEX IF NOT EXISTS idx_map_ledger_faction_days_key
    ON map_ledger_faction_days(map_id, faction_key, day);

-- Patreon lives beside discord_links; link tombstones retain relink history.
CREATE TABLE IF NOT EXISTS patreon_members (
    member_id TEXT PRIMARY KEY,
    patreon_user_id TEXT NOT NULL UNIQUE,
    data_json TEXT NOT NULL,
    last_tier TEXT,
    declined_since TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patreon_links (
    patreon_user_id TEXT PRIMARY KEY,
    discord_user_id TEXT,
    player_uuid TEXT,
    method TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    linked_at TEXT NOT NULL,
    person_changed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_patreon_link_discord
    ON patreon_links(discord_user_id) WHERE active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_patreon_link_uuid
    ON patreon_links(player_uuid) WHERE active = 1;
CREATE TABLE IF NOT EXISTS patreon_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patreon_leases (
    name TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patreon_sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_sync_at TEXT,
    last_sync_ok INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    brake_held INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO patreon_sync_state(id) VALUES (1);
CREATE TABLE IF NOT EXISTS patreon_applied (
    target TEXT NOT NULL,
    subject TEXT NOT NULL,
    tiers_json TEXT NOT NULL DEFAULT '[]',
    ever_granted INTEGER NOT NULL DEFAULT 0,
    dm_generation INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (target, subject)
);
CREATE TABLE IF NOT EXISTS patreon_desired (
    target TEXT NOT NULL,
    subject TEXT NOT NULL,
    tier_key TEXT,
    grace_until TEXT,
    dm TEXT,
    generation INTEGER NOT NULL DEFAULT 1,
    link_event TEXT,
    PRIMARY KEY (target, subject)
);
CREATE TABLE IF NOT EXISTS patreon_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    subject TEXT NOT NULL,
    add_tier TEXT,
    remove_json TEXT NOT NULL,
    dm TEXT,
    grace_until TEXT,
    generation INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    dispatched_at TEXT,
    acked_at TEXT,
    cancelled_at TEXT,
    dm_suppressed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_patreon_changes_pending
    ON patreon_changes(target, acked_at, cancelled_at, subject);
CREATE TABLE IF NOT EXISTS patreon_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    acked_at TEXT
);
CREATE TABLE IF NOT EXISTS patreon_brake_approvals (
    target TEXT NOT NULL,
    subject TEXT NOT NULL,
    generation INTEGER NOT NULL,
    PRIMARY KEY (target, subject)
);
-- OAuth state is stored hashed, single-use, and bound to the subject that started it.
CREATE TABLE IF NOT EXISTS patreon_oauth_states (
    state_hash TEXT PRIMARY KEY,
    discord_user_id TEXT,
    player_uuid TEXT,
    target_kind TEXT,
    target_name TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    CHECK ((discord_user_id IS NULL) <> (player_uuid IS NULL))
);
-- Consent alone grants nothing; the patron must explicitly confirm this target.
CREATE TABLE IF NOT EXISTS patreon_pending_links (
    token_hash TEXT PRIMARY KEY,
    patreon_user_id TEXT NOT NULL,
    patreon_name TEXT NOT NULL,
    discord_user_id TEXT,
    player_uuid TEXT,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('discord', 'minecraft')),
    target_name TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    CHECK ((discord_user_id IS NULL) <> (player_uuid IS NULL))
);
-- Webhook member ids waiting for an out-of-band refresh (kept if the sync lease is busy).
CREATE TABLE IF NOT EXISTS patreon_webhook_members (
    member_id TEXT PRIMARY KEY,
    recorded_at TEXT NOT NULL
);
