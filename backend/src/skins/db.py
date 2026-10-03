import shutil
import sqlite3
from pathlib import Path

_SKINS_PKG = Path(__file__).resolve().parent
DATA_DIR = _SKINS_PKG.parent / "data"
DB_PATH = DATA_DIR / "province.db"
SKINS_DIR = DATA_DIR / "skins"
WARDROBE_DIR = DATA_DIR / "wardrobe"
DRINKS_DIR = DATA_DIR / "drinks"
SCHEMA_PATH = _SKINS_PKG / "schema.sql"


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"] for row in rows}


def _tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    return {row["name"] for row in rows}


def _migrate_character_roster_realm(conn: sqlite3.Connection) -> None:
    if "character_roster" not in _tables(conn):
        return
    roster_cols = _column_names(conn, "character_roster")
    if "wardrobe_active_slot" not in roster_cols:
        conn.execute(
            "ALTER TABLE character_roster "
            "ADD COLUMN wardrobe_active_slot TEXT"
        )
    roster_cols = _column_names(conn, "character_roster")
    if "realm_id" not in roster_cols:
        # SQLite cannot ALTER PRIMARY KEY — rebuild with realm_id.
        conn.execute("ALTER TABLE character_roster RENAME TO character_roster_old")
        conn.execute(
            """
            CREATE TABLE character_roster (
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
            )
            """
        )
        old_cols = _column_names(conn, "character_roster_old")
        has_kit = "kit_status" in old_cols
        has_statuses = "kit_statuses_json" in old_cols
        has_sheet = "sheet_json" in old_cols
        has_wardrobe = "wardrobe_active_slot" in old_cols
        conn.execute(
            f"""
            INSERT INTO character_roster (
                player_uuid, realm_id, character_id, name, status, race, class,
                created_at, updated_at, kit_status, kit_statuses_json,
                sheet_json, wardrobe_active_slot
            )
            SELECT
                player_uuid,
                'main',
                character_id,
                name,
                status,
                race,
                class,
                created_at,
                updated_at,
                {"kit_status" if has_kit else "NULL"},
                {"kit_statuses_json" if has_statuses else "NULL"},
                {"sheet_json" if has_sheet else "NULL"},
                {"wardrobe_active_slot" if has_wardrobe else "NULL"}
            FROM character_roster_old
            """
        )
        conn.execute("DROP TABLE character_roster_old")
    if "realm_id" in _column_names(conn, "character_roster"):
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_character_roster_player_realm
            ON character_roster(player_uuid, realm_id)
            """
        )


def migrate() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SKINS_DIR.mkdir(parents=True, exist_ok=True)
    WARDROBE_DIR.mkdir(parents=True, exist_ok=True)
    DRINKS_DIR.mkdir(parents=True, exist_ok=True)
    (DRINKS_DIR / "textures").mkdir(parents=True, exist_ok=True)
    (DRINKS_DIR / "submissions").mkdir(parents=True, exist_ok=True)
    (DRINKS_DIR / "assets").mkdir(parents=True, exist_ok=True)
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    denied_ids: list[str] = []
    with connect() as conn:
        conn.executescript(schema)
        if "link_event" not in _column_names(conn, "patreon_desired"):
            conn.execute("ALTER TABLE patreon_desired ADD COLUMN link_event TEXT")
        if "patreon_changes" in _tables(conn) and "dm_suppressed" not in _column_names(conn, "patreon_changes"):
            conn.execute("ALTER TABLE patreon_changes ADD COLUMN dm_suppressed INTEGER NOT NULL DEFAULT 0")
        if "grip_preset" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN grip_preset TEXT"
            )
        if "base_set" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN base_set TEXT"
            )
        if "discord_user_id" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN discord_user_id TEXT"
            )
        if "code_plaintext" not in _column_names(conn, "codes"):
            conn.execute(
                "ALTER TABLE codes ADD COLUMN code_plaintext TEXT"
            )
        if "discord_username" not in _column_names(conn, "discord_links"):
            conn.execute(
                "ALTER TABLE discord_links ADD COLUMN discord_username TEXT"
            )
        if "left_guild_at" not in _column_names(conn, "discord_links"):
            conn.execute(
                "ALTER TABLE discord_links ADD COLUMN left_guild_at TEXT"
            )
        if "grace_until" not in _column_names(conn, "discord_links"):
            conn.execute(
                "ALTER TABLE discord_links ADD COLUMN grace_until TEXT"
            )
        if "scope" not in _column_names(conn, "codes"):
            conn.execute(
                "ALTER TABLE codes ADD COLUMN scope TEXT NOT NULL DEFAULT 'skin'"
            )
        if "realm_id" not in _column_names(conn, "codes"):
            conn.execute(
                "ALTER TABLE codes ADD COLUMN realm_id TEXT NOT NULL DEFAULT 'main'"
            )
        conn.execute(
            "UPDATE codes SET realm_id = 'main' "
            "WHERE realm_id IS NULL OR TRIM(realm_id) = ''"
        )
        conn.execute(
            "UPDATE codes SET scope = 'skin' WHERE scope IS NULL OR TRIM(scope) = ''"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_discord_links_grace "
            "ON discord_links(grace_until)"
        )
        # Legacy player_key column may exist; leave unused (SQLite DROP COLUMN optional)
        if "add_name" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN add_name INTEGER NOT NULL DEFAULT 0"
            )
        if "name_colours" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN name_colours TEXT"
            )
        if "name_styles" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN name_styles TEXT"
            )
        if "tiers" not in _column_names(conn, "submissions"):
            conn.execute("ALTER TABLE submissions ADD COLUMN tiers TEXT")
        if "tier_aliases" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN tier_aliases TEXT"
            )
        if "helmet_3d_tiers" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN helmet_3d_tiers TEXT"
            )
        if "texture_hash" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN texture_hash TEXT"
            )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_submissions_texture_hash
            ON submissions(player_uuid, texture_hash)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS player_warnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_uuid TEXT NOT NULL,
                staff_uuid TEXT,
                staff_name TEXT,
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS moderation_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                discord_user_id TEXT NOT NULL,
                player_uuid TEXT,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                delivered_at TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_player_warnings_uuid "
            "ON player_warnings(player_uuid, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_moderation_notifications_undelivered "
            "ON moderation_notifications(delivered_at, created_at)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS armourshop_catalog (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS armourshop_player_meta (
                player_uuid TEXT PRIMARY KEY,
                name_colour_stops INTEGER NOT NULL DEFAULT 0,
                max_3d_pair_bytes INTEGER NOT NULL DEFAULT 0,
                skin_token_cooldown_days INTEGER NOT NULL DEFAULT -1,
                skin_kinds_json TEXT NOT NULL DEFAULT '[]',
                allow_armor_3d_helmet INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """
        )
        as_meta_cols = _column_names(conn, "armourshop_player_meta")
        if "skin_token_cooldown_days" not in as_meta_cols:
            conn.execute(
                "ALTER TABLE armourshop_player_meta "
                "ADD COLUMN skin_token_cooldown_days INTEGER NOT NULL DEFAULT -1"
            )
        if "skin_kinds_json" not in as_meta_cols:
            conn.execute(
                "ALTER TABLE armourshop_player_meta "
                "ADD COLUMN skin_kinds_json TEXT NOT NULL DEFAULT '[]'"
            )
        if "allow_armor_3d_helmet" not in as_meta_cols:
            conn.execute(
                "ALTER TABLE armourshop_player_meta "
                "ADD COLUMN allow_armor_3d_helmet INTEGER NOT NULL DEFAULT 0"
            )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS creation_catalog (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
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
                realm_id TEXT NOT NULL DEFAULT 'main'
            )
            """
        )
        if "realm_id" not in _column_names(conn, "character_creates"):
            conn.execute(
                "ALTER TABLE character_creates "
                "ADD COLUMN realm_id TEXT NOT NULL DEFAULT 'main'"
            )
        conn.execute(
            "UPDATE character_creates SET realm_id = 'main' "
            "WHERE realm_id IS NULL OR TRIM(realm_id) = ''"
        )
        create_cols = _column_names(conn, "character_creates")
        if "wardrobe_active_slot" not in create_cols:
            conn.execute(
                "ALTER TABLE character_creates "
                "ADD COLUMN wardrobe_active_slot TEXT"
            )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_character_creates_realm_status
            ON character_creates(realm_id, status)
            """
        )
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_character_creates_client_req
            ON character_creates(player_uuid, client_request_id)
            WHERE client_request_id IS NOT NULL AND TRIM(client_request_id) != ''
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_character_creates_pending
            ON character_creates(status, created_at)
            """
        )
        conn.execute(
            """
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
                PRIMARY KEY (player_uuid, realm_id, character_id)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_character_roster_player
            ON character_roster(player_uuid)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS character_player_meta (
                player_uuid TEXT PRIMARY KEY,
                max_alive_characters INTEGER,
                eighteen INTEGER,
                real_age_set INTEGER NOT NULL DEFAULT 0,
                account_created_at_epoch INTEGER,
                name_colour_stops INTEGER,
                updated_at TEXT NOT NULL
            )
            """
        )
        meta_cols = _column_names(conn, "character_player_meta")
        if "eighteen" not in meta_cols:
            conn.execute(
                "ALTER TABLE character_player_meta ADD COLUMN eighteen INTEGER"
            )
        if "real_age_set" not in meta_cols:
            conn.execute(
                "ALTER TABLE character_player_meta ADD COLUMN real_age_set "
                "INTEGER NOT NULL DEFAULT 0"
            )
        if "account_created_at_epoch" not in meta_cols:
            conn.execute(
                "ALTER TABLE character_player_meta "
                "ADD COLUMN account_created_at_epoch INTEGER"
            )
        if "name_colour_stops" not in meta_cols:
            conn.execute(
                "ALTER TABLE character_player_meta "
                "ADD COLUMN name_colour_stops INTEGER"
            )
        meta_cols = _column_names(conn, "character_player_meta")
        if "kit_cooldown_seconds_remaining" not in meta_cols:
            conn.execute(
                "ALTER TABLE character_player_meta "
                "ADD COLUMN kit_cooldown_seconds_remaining INTEGER"
            )
        if "kit_cooldown_hours" not in meta_cols:
            conn.execute(
                "ALTER TABLE character_player_meta "
                "ADD COLUMN kit_cooldown_hours INTEGER"
            )
        meta_cols = _column_names(conn, "character_player_meta")
        if "kit_cooldowns_json" not in meta_cols:
            conn.execute(
                "ALTER TABLE character_player_meta "
                "ADD COLUMN kit_cooldowns_json TEXT"
            )
        roster_cols = _column_names(conn, "character_roster")
        if "kit_status" not in roster_cols:
            conn.execute(
                "ALTER TABLE character_roster ADD COLUMN kit_status TEXT"
            )
        roster_cols = _column_names(conn, "character_roster")
        if "kit_statuses_json" not in roster_cols:
            conn.execute(
                "ALTER TABLE character_roster ADD COLUMN kit_statuses_json TEXT"
            )
        roster_cols = _column_names(conn, "character_roster")
        if "sheet_json" not in roster_cols:
            conn.execute(
                "ALTER TABLE character_roster ADD COLUMN sheet_json TEXT"
            )
        _migrate_character_roster_realm(conn)
        # Legacy NOT NULL on max_alive_characters breaks age-only upserts.
        max_col = next(
            (
                row
                for row in conn.execute(
                    "PRAGMA table_info(character_player_meta)"
                ).fetchall()
                if row["name"] == "max_alive_characters"
            ),
            None,
        )
        if max_col is not None and int(max_col["notnull"] or 0) == 1:
            conn.execute(
                """
                CREATE TABLE character_player_meta_new (
                    player_uuid TEXT PRIMARY KEY,
                    max_alive_characters INTEGER,
                    eighteen INTEGER,
                    real_age_set INTEGER NOT NULL DEFAULT 0,
                    account_created_at_epoch INTEGER,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO character_player_meta_new (
                    player_uuid, max_alive_characters, eighteen,
                    real_age_set, account_created_at_epoch, updated_at
                )
                SELECT
                    player_uuid,
                    max_alive_characters,
                    eighteen,
                    COALESCE(real_age_set, 0),
                    account_created_at_epoch,
                    updated_at
                FROM character_player_meta
                """
            )
            conn.execute("DROP TABLE character_player_meta")
            conn.execute(
                "ALTER TABLE character_player_meta_new "
                "RENAME TO character_player_meta"
            )
        if "staff" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions ADD COLUMN staff INTEGER NOT NULL DEFAULT 0"
            )
        if "category" not in _column_names(conn, "submissions"):
            conn.execute("ALTER TABLE submissions ADD COLUMN category TEXT")
        if "scroll" not in _column_names(conn, "submissions"):
            conn.execute("ALTER TABLE submissions ADD COLUMN scroll TEXT")
        if "tier_scrolls" not in _column_names(conn, "submissions"):
            conn.execute("ALTER TABLE submissions ADD COLUMN tier_scrolls TEXT")
        conn.execute(
            """
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
                updated_at TEXT NOT NULL,
                realm_id TEXT NOT NULL DEFAULT 'main',
                PRIMARY KEY (player_uuid, character_id, kit_key)
            )
            """
        )
        lore_cols = _column_names(conn, "lore_item_customisations")
        if "state" not in lore_cols:
            conn.execute(
                "ALTER TABLE lore_item_customisations "
                "ADD COLUMN state TEXT NOT NULL DEFAULT 'draft'"
            )
        if "skin_slug" not in lore_cols:
            conn.execute(
                "ALTER TABLE lore_item_customisations ADD COLUMN skin_slug TEXT"
            )
        if "ready_at" not in lore_cols:
            conn.execute(
                "ALTER TABLE lore_item_customisations ADD COLUMN ready_at TEXT"
            )
        if "applied_at" not in lore_cols:
            conn.execute(
                "ALTER TABLE lore_item_customisations ADD COLUMN applied_at TEXT"
            )
        lore_cols = _column_names(conn, "lore_item_customisations")
        if "kit_id" not in lore_cols:
            conn.execute(
                "ALTER TABLE lore_item_customisations ADD COLUMN kit_id TEXT"
            )
        lore_cols = _column_names(conn, "lore_item_customisations")
        if "name_colours" not in lore_cols:
            conn.execute(
                "ALTER TABLE lore_item_customisations ADD COLUMN name_colours TEXT"
            )
        lore_cols = _column_names(conn, "lore_item_customisations")
        if "name_styles" not in lore_cols:
            conn.execute(
                "ALTER TABLE lore_item_customisations ADD COLUMN name_styles TEXT"
            )
        lore_cols = _column_names(conn, "lore_item_customisations")
        if "deny_reason" not in lore_cols:
            conn.execute(
                "ALTER TABLE lore_item_customisations ADD COLUMN deny_reason TEXT"
            )
        lore_cols = _column_names(conn, "lore_item_customisations")
        if "realm_id" not in lore_cols:
            conn.execute(
                "ALTER TABLE lore_item_customisations "
                "ADD COLUMN realm_id TEXT NOT NULL DEFAULT 'main'"
            )
            conn.execute(
                """
                UPDATE lore_item_customisations
                SET realm_id = (
                    SELECT cr.realm_id FROM character_roster cr
                    WHERE cr.player_uuid = lore_item_customisations.player_uuid
                      AND cr.character_id = lore_item_customisations.character_id
                    LIMIT 1
                )
                WHERE EXISTS (
                    SELECT 1 FROM character_roster cr
                    WHERE cr.player_uuid = lore_item_customisations.player_uuid
                      AND cr.character_id = lore_item_customisations.character_id
                )
                """
            )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_lore_item_customisations_realm_state
            ON lore_item_customisations(realm_id, state)
            """
        )
        conn.execute(
            """
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
            )
            """
        )
        wardrobe_cols = _column_names(conn, "character_wardrobe_slots")
        if "display_name" not in wardrobe_cols:
            conn.execute(
                "ALTER TABLE character_wardrobe_slots ADD COLUMN display_name TEXT"
            )
        wardrobe_cols = _column_names(conn, "character_wardrobe_slots")
        if "apply_pending" not in wardrobe_cols:
            conn.execute(
                "ALTER TABLE character_wardrobe_slots "
                "ADD COLUMN apply_pending INTEGER NOT NULL DEFAULT 0"
            )
        conn.execute(
            """
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
            )
            """
        )
        create_wardrobe_cols = _column_names(conn, "character_create_wardrobe")
        if "display_name" not in create_wardrobe_cols:
            conn.execute(
                "ALTER TABLE character_create_wardrobe ADD COLUMN display_name TEXT"
            )
        meta_cols = _column_names(conn, "character_player_meta")
        if "wardrobe_skin_slots" not in meta_cols:
            conn.execute(
                "ALTER TABLE character_player_meta "
                "ADD COLUMN wardrobe_skin_slots INTEGER"
            )
        conn.execute(
            """
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
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS drink_textures (
                id TEXT PRIMARY KEY,
                owner_uuid TEXT NOT NULL,
                cmd INTEGER,
                ia_item_id TEXT,
                png_path TEXT NOT NULL,
                refcount INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS drink_catalog (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS drink_player_meta (
                player_uuid TEXT PRIMARY KEY,
                allow_drink_texture INTEGER NOT NULL DEFAULT 0,
                name_colour_stops INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """
        )
        if "name_colour_stops" not in _column_names(conn, "drink_player_meta"):
            conn.execute(
                "ALTER TABLE drink_player_meta "
                "ADD COLUMN name_colour_stops INTEGER NOT NULL DEFAULT 0"
            )
        if "realm_id" not in _column_names(conn, "submissions"):
            conn.execute(
                "ALTER TABLE submissions "
                "ADD COLUMN realm_id TEXT NOT NULL DEFAULT 'main'"
            )
            conn.execute(
                """
                UPDATE submissions
                SET realm_id = COALESCE(
                    (
                        SELECT c.realm_id FROM codes c
                        WHERE c.id = submissions.code_id
                    ),
                    'main'
                )
                WHERE realm_id IS NULL OR TRIM(realm_id) = '' OR realm_id = 'main'
                """
            )
            # Prefer code realm when present (overwrite default for rows that have codes).
            conn.execute(
                """
                UPDATE submissions
                SET realm_id = (
                    SELECT c.realm_id FROM codes c WHERE c.id = submissions.code_id
                )
                WHERE EXISTS (
                    SELECT 1 FROM codes c
                    WHERE c.id = submissions.code_id
                      AND c.realm_id IS NOT NULL
                      AND TRIM(c.realm_id) != ''
                )
                """
            )
        if "realm_id" not in _column_names(conn, "drink_submissions"):
            conn.execute(
                "ALTER TABLE drink_submissions "
                "ADD COLUMN realm_id TEXT NOT NULL DEFAULT 'main'"
            )
            conn.execute(
                """
                UPDATE drink_submissions
                SET realm_id = (
                    SELECT c.realm_id FROM codes c
                    WHERE c.id = drink_submissions.code_id
                )
                WHERE EXISTS (
                    SELECT 1 FROM codes c
                    WHERE c.id = drink_submissions.code_id
                      AND c.realm_id IS NOT NULL
                      AND TRIM(c.realm_id) != ''
                )
                """
            )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_submissions_realm_apply
            ON submissions(realm_id, status, applied_at)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_drink_submissions_realm_apply
            ON drink_submissions(realm_id, status, applied_at)
            """
        )
        conn.execute(
            """
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
            )
            """
        )
        rpc_meta_cols = _column_names(conn, "rpc_player_meta")
        if "realm_id" not in rpc_meta_cols:
            # SQLite cannot ALTER PRIMARY KEY — rebuild with realm_id.
            conn.execute(
                "ALTER TABLE rpc_player_meta RENAME TO rpc_player_meta_old"
            )
            conn.execute(
                """
                CREATE TABLE rpc_player_meta (
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
                )
                """
            )
            old_cols = _column_names(conn, "rpc_player_meta_old")
            has_wardrobe = "wardrobe_skin_slots" in old_cols
            has_pair = "max_3d_pair_bytes" in old_cols
            has_cooldown = "skin_token_cooldown_days" in old_cols
            has_kinds = "skin_kinds_json" in old_cols
            has_helmet = "allow_armor_3d_helmet" in old_cols
            has_flags = "permission_flags_json" in old_cols
            conn.execute(
                f"""
                INSERT INTO rpc_player_meta (
                    player_uuid, realm_id, name_colour_stops, allow_drink_texture,
                    max_alive_characters, wardrobe_skin_slots, max_3d_pair_bytes,
                    skin_token_cooldown_days, skin_kinds_json,
                    allow_armor_3d_helmet, permission_flags_json, updated_at
                )
                SELECT
                    player_uuid,
                    'main',
                    name_colour_stops,
                    allow_drink_texture,
                    max_alive_characters,
                    {"wardrobe_skin_slots" if has_wardrobe else "1"},
                    {"max_3d_pair_bytes" if has_pair else "0"},
                    {"skin_token_cooldown_days" if has_cooldown else "-1"},
                    {"skin_kinds_json" if has_kinds else "'[]'"},
                    {"allow_armor_3d_helmet" if has_helmet else "0"},
                    {"permission_flags_json" if has_flags else "'{}'"},
                    updated_at
                FROM rpc_player_meta_old
                """
            )
            conn.execute("DROP TABLE rpc_player_meta_old")
        rpc_meta_cols = _column_names(conn, "rpc_player_meta")
        if "allow_drink_message" not in rpc_meta_cols:
            conn.execute(
                "ALTER TABLE rpc_player_meta "
                "ADD COLUMN allow_drink_message INTEGER NOT NULL DEFAULT 0"
            )
            rpc_meta_cols = _column_names(conn, "rpc_player_meta")
        if "donator_tier" not in rpc_meta_cols:
            conn.execute(
                "ALTER TABLE rpc_player_meta "
                "ADD COLUMN donator_tier INTEGER NOT NULL DEFAULT 0"
            )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS drink_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                submission_id TEXT NOT NULL,
                discord_user_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                delivered_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cosmetic_mint_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_uuid TEXT NOT NULL,
                reset_at TEXT NOT NULL,
                staff_uuid TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_drink_submissions_status "
            "ON drink_submissions(status)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_drink_submissions_slug "
            "ON drink_submissions(slug)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_drink_textures_owner "
            "ON drink_textures(owner_uuid)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_drink_notifications_undelivered "
            "ON drink_notifications(delivered_at, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cosmetic_mint_resets_player "
            "ON cosmetic_mint_resets(player_uuid)"
        )
        conn.execute(
            """
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
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_war_declare_codes_hash "
            "ON war_declare_codes(code_hash)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_war_declare_codes_outstanding "
            "ON war_declare_codes(realm_id, redeemed_at, revoked)"
        )
        denied_ids = [
            str(r["id"])
            for r in conn.execute(
                "SELECT id FROM submissions WHERE status = 'denied'"
            ).fetchall()
        ]
        if denied_ids:
            conn.execute("DELETE FROM submissions WHERE status = 'denied'")
        # Discard player_keys system
        if "player_keys" in _tables(conn):
            conn.execute("DROP TABLE player_keys")
        conn.execute("DROP INDEX IF EXISTS idx_discord_links_player_key")
        conn.execute("DROP INDEX IF EXISTS idx_player_keys_key")
        conn.commit()

    for sid in denied_ids:
        out = SKINS_DIR / sid
        if out.exists():
            shutil.rmtree(out, ignore_errors=True)
