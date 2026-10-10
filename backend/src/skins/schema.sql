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
    helmet_3d_tiers TEXT,
    texture_hash TEXT,
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
    tier_sets TEXT,
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
    grace_until TEXT,
    -- Their nickname in the TFMC Discord server, if any; discord_username is the account handle.
    discord_nickname TEXT
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

CREATE TABLE IF NOT EXISTS lore_item_customisations (
    player_uuid TEXT NOT NULL,
    character_id TEXT NOT NULL,
    kit_key TEXT NOT NULL,
    kit_id TEXT,
    name_colours TEXT,
    name_styles TEXT,
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

CREATE TABLE IF NOT EXISTS rpc_player_meta (
    player_uuid TEXT NOT NULL,
    realm_id TEXT NOT NULL DEFAULT 'main',
    name_colour_stops INTEGER NOT NULL DEFAULT 0,
    allow_drink_texture INTEGER NOT NULL DEFAULT 0,
    allow_drink_message INTEGER NOT NULL DEFAULT 0,
    donator_tier INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS creation_catalog (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_creates (
    id TEXT PRIMARY KEY,
    player_uuid TEXT NOT NULL,
    client_request_id TEXT,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    character_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    applied_at TEXT,
    realm_id TEXT NOT NULL DEFAULT 'main',
    wardrobe_active_slot TEXT
);

CREATE TABLE IF NOT EXISTS character_roster (
    player_uuid TEXT NOT NULL,
    realm_id TEXT NOT NULL DEFAULT 'main',
    character_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    race TEXT,
    class TEXT,
    created_at TEXT,
    updated_at TEXT NOT NULL,
    kit_status TEXT,
    kit_statuses_json TEXT,
    sheet_json TEXT,
    wardrobe_active_slot TEXT,
    PRIMARY KEY (player_uuid, realm_id, character_id)
);

CREATE TABLE IF NOT EXISTS character_player_meta (
    player_uuid TEXT PRIMARY KEY,
    -- Age-only upserts need to leave the character limit unset.
    max_alive_characters INTEGER,
    eighteen INTEGER,
    real_age_set INTEGER NOT NULL DEFAULT 0,
    account_created_at_epoch INTEGER,
    name_colour_stops INTEGER,
    updated_at TEXT NOT NULL,
    kit_cooldown_seconds_remaining INTEGER,
    kit_cooldown_hours INTEGER,
    kit_cooldowns_json TEXT,
    wardrobe_skin_slots INTEGER
);

CREATE INDEX IF NOT EXISTS idx_discord_links_grace
    ON discord_links(grace_until);

CREATE INDEX IF NOT EXISTS idx_submissions_texture_hash
    ON submissions(player_uuid, texture_hash);

CREATE INDEX IF NOT EXISTS idx_character_creates_realm_status
    ON character_creates(realm_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_character_creates_client_req
    ON character_creates(player_uuid, client_request_id)
    WHERE client_request_id IS NOT NULL AND TRIM(client_request_id) != '';

CREATE INDEX IF NOT EXISTS idx_character_creates_pending
    ON character_creates(status, created_at);

CREATE INDEX IF NOT EXISTS idx_character_roster_player
    ON character_roster(player_uuid);

CREATE INDEX IF NOT EXISTS idx_character_roster_player_realm
    ON character_roster(player_uuid, realm_id);

CREATE INDEX IF NOT EXISTS idx_lore_item_customisations_realm_state
    ON lore_item_customisations(realm_id, state);

CREATE INDEX IF NOT EXISTS idx_submissions_realm_apply
    ON submissions(realm_id, status, applied_at);

CREATE INDEX IF NOT EXISTS idx_drink_submissions_realm_apply
    ON drink_submissions(realm_id, status, applied_at);

-- Website accounts. Discord is the sign-in provider; the Minecraft account is
-- the discord_links row for the same discord_user_id, so links made through
-- the Discord bot appear on the website without another step.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL UNIQUE,
    discord_username TEXT,
    discord_global_name TEXT,
    discord_avatar TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL,
    -- Website staff role. Databases created before roles gain this column in
    -- db.migrate(); index it there, not here.
    role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'mod', 'admin', 'root'))
);

-- Cookie sessions for users. Separate from `sessions`, which belong to
-- in-game codes and carry a scope and realm. guild_member records the TFMC
-- Discord membership seen at sign-in; linking requires a recent check.
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guild_member INTEGER NOT NULL DEFAULT 0,
    guild_checked_at TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at);

-- Single-use Discord OAuth states. The browser also holds the state in a
-- cookie, so a callback only completes in the browser that started it.
CREATE TABLE IF NOT EXISTS discord_oauth_states (
    state_hash TEXT PRIMARY KEY,
    return_to TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_link_codes_player ON discord_link_codes(player_uuid);

-- Single-use Microsoft link attempts, tied to the site session that started
-- them. The callback marks a row used and deletes it once done; unlinking
-- deletes the user's rows, which cancels any attempt still in flight.
CREATE TABLE IF NOT EXISTS microsoft_link_states (
    state_hash TEXT PRIMARY KEY,
    session_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    code_verifier TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_microsoft_link_states_user ON microsoft_link_states(user_id);

-- Append-only record of staff actions on website accounts, including refused
-- attempts. No foreign keys: rows outlive the accounts they mention, so each
-- row keeps the names it was written with.
CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system')),
    actor_user_id INTEGER,
    actor_discord_id TEXT,
    actor_name TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,
    target_user_id INTEGER,
    target_discord_id TEXT,
    target_name TEXT,
    reason TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit(target_user_id, id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_user_id, id);

CREATE TRIGGER IF NOT EXISTS admin_audit_no_update BEFORE UPDATE ON admin_audit
BEGIN
    SELECT RAISE(ABORT, 'admin_audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS admin_audit_no_delete BEFORE DELETE ON admin_audit
BEGIN
    SELECT RAISE(ABORT, 'admin_audit is append-only');
END;

-- INSERT OR REPLACE on an existing id would otherwise delete the old row
-- without firing the delete trigger.
CREATE TRIGGER IF NOT EXISTS admin_audit_no_replace BEFORE INSERT ON admin_audit
WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM admin_audit WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'admin_audit is append-only');
END;

-- LuckPerms mirror for the staff panel. The TFMCWeb bridge publishes a whole
-- snapshot, which replaces these tables in one transaction; see
-- src/luckperms/README.md. Contexts are canonical JSON ({} when global) and
-- expiry is unix seconds, 0 when permanent.
CREATE TABLE IF NOT EXISTS lp_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    server TEXT,
    hash TEXT,
    generated_at INTEGER,
    -- Newest bridge revision applied: a snapshot's, or a change result's.
    revision INTEGER,
    received_at TEXT,
    -- Last time the bridge confirmed the snapshot is still current.
    checked_at TEXT,
    -- Last time an applying bridge asked for changes.
    polled_at TEXT
);

CREATE TABLE IF NOT EXISTS lp_groups (
    name TEXT PRIMARY KEY,
    display_name TEXT,
    weight INTEGER
);

CREATE TABLE IF NOT EXISTS lp_group_nodes (
    group_name TEXT NOT NULL,
    key TEXT NOT NULL,
    value INTEGER NOT NULL,
    contexts TEXT NOT NULL,
    expiry INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lp_group_nodes_group ON lp_group_nodes(group_name);

CREATE TABLE IF NOT EXISTS lp_tracks (
    name TEXT PRIMARY KEY,
    groups_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lp_users (
    uuid TEXT PRIMARY KEY,
    name TEXT
);

CREATE INDEX IF NOT EXISTS idx_lp_users_name ON lp_users(lower(name));

CREATE TABLE IF NOT EXISTS lp_user_nodes (
    uuid TEXT NOT NULL,
    key TEXT NOT NULL,
    value INTEGER NOT NULL,
    contexts TEXT NOT NULL,
    expiry INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lp_user_nodes_uuid ON lp_user_nodes(uuid);
CREATE INDEX IF NOT EXISTS idx_lp_user_nodes_key ON lp_user_nodes(key);

-- Changes staff queued for the bridge. Rows are kept as the change history.
CREATE TABLE IF NOT EXISTS lp_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor_user_id INTEGER NOT NULL,
    actor_name TEXT,
    actor_role TEXT,
    actor_minecraft_uuid TEXT,
    target_type TEXT NOT NULL CHECK (target_type IN ('user', 'group', 'track')),
    target TEXT NOT NULL,
    target_name TEXT,
    description TEXT NOT NULL,
    ops_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'applied', 'failed', 'expired', 'unknown')),
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT,
    finished_at TEXT,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_lp_changes_status ON lp_changes(status, id);
CREATE INDEX IF NOT EXISTS idx_lp_changes_target ON lp_changes(target_type, target, id);
