-- Names that say what each table holds, real timestamp types, CHECKs on the
-- status columns and keys on the LuckPerms node mirrors.

-- In-game login codes and the sessions they open.
ALTER TABLE codes RENAME TO login_codes;
ALTER TABLE login_codes RENAME CONSTRAINT codes_pkey TO login_codes_pkey;
ALTER TABLE login_codes RENAME CONSTRAINT codes_code_hash_key TO login_codes_code_hash_key;
ALTER SEQUENCE codes_id_seq RENAME TO login_codes_id_seq;

ALTER TABLE sessions RENAME TO code_sessions;
ALTER TABLE code_sessions RENAME CONSTRAINT sessions_pkey TO code_sessions_pkey;
ALTER TABLE code_sessions RENAME CONSTRAINT sessions_token_hash_key TO code_sessions_token_hash_key;
ALTER TABLE code_sessions RENAME CONSTRAINT sessions_code_id_fkey TO code_sessions_code_id_fkey;
ALTER SEQUENCE sessions_id_seq RENAME TO code_sessions_id_seq;

ALTER TABLE submissions RENAME TO skin_submissions;
ALTER TABLE skin_submissions RENAME CONSTRAINT submissions_pkey TO skin_submissions_pkey;
ALTER TABLE skin_submissions RENAME CONSTRAINT submissions_code_id_fkey TO skin_submissions_code_id_fkey;
ALTER INDEX idx_submissions_realm_apply RENAME TO idx_skin_submissions_realm_apply;
ALTER INDEX idx_submissions_slug RENAME TO idx_skin_submissions_slug;
ALTER INDEX idx_submissions_status RENAME TO idx_skin_submissions_status;
ALTER INDEX idx_submissions_texture_hash RENAME TO idx_skin_submissions_texture_hash;

-- Discord DMs to players: staff warnings and bird mail.
ALTER TABLE moderation_notifications RENAME TO player_notifications;
ALTER TABLE player_notifications RENAME CONSTRAINT moderation_notifications_pkey TO player_notifications_pkey;
ALTER INDEX idx_moderation_notifications_undelivered RENAME TO idx_player_notifications_undelivered;
ALTER SEQUENCE moderation_notifications_id_seq RENAME TO player_notifications_id_seq;

ALTER TABLE character_creates RENAME TO character_creation_requests;
ALTER TABLE character_creation_requests RENAME CONSTRAINT character_creates_pkey TO character_creation_requests_pkey;
ALTER INDEX idx_character_creates_client_req RENAME TO idx_character_creation_requests_client_req;
ALTER INDEX idx_character_creates_pending RENAME TO idx_character_creation_requests_pending;
ALTER INDEX idx_character_creates_realm_status RENAME TO idx_character_creation_requests_realm_status;

ALTER TABLE character_create_wardrobe RENAME TO character_creation_wardrobe;
ALTER TABLE character_creation_wardrobe RENAME CONSTRAINT character_create_wardrobe_pkey TO character_creation_wardrobe_pkey;

ALTER TABLE war_declare_codes RENAME TO war_declaration_codes;
ALTER TABLE war_declaration_codes RENAME CONSTRAINT war_declare_codes_pkey TO war_declaration_codes_pkey;
ALTER TABLE war_declaration_codes RENAME CONSTRAINT war_declare_codes_code_hash_key TO war_declaration_codes_code_hash_key;
ALTER INDEX idx_war_declare_codes_outstanding RENAME TO idx_war_declaration_codes_outstanding;
ALTER SEQUENCE war_declare_codes_id_seq RENAME TO war_declaration_codes_id_seq;

-- jsonb columns need no _json suffix.
ALTER TABLE admin_audit RENAME COLUMN detail_json TO detail;
ALTER TABLE character_roster RENAME COLUMN kit_statuses_json TO kit_statuses;
ALTER TABLE character_roster RENAME COLUMN sheet_json TO sheet;
ALTER TABLE diagnostic_reports RENAME COLUMN report_json TO report;
ALTER TABLE drink_submissions RENAME COLUMN recipe_json TO recipe;
ALTER TABLE lore_item_customisations RENAME COLUMN lore_json TO lore;
ALTER TABLE lp_changes RENAME COLUMN ops_json TO ops;
ALTER TABLE lp_tracks RENAME COLUMN groups_json TO group_names;
ALTER TABLE patreon_applied RENAME COLUMN tiers_json TO tiers;
ALTER TABLE patreon_changes RENAME COLUMN remove_json TO remove_tiers;
ALTER TABLE patreon_members RENAME COLUMN data_json TO data;

-- The ItemsAdder custom model data number DrinkBuilder assigns.
ALTER TABLE drink_textures RENAME COLUMN cmd TO custom_model_data;
