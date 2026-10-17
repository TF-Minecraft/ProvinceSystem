-- TFMCWeb's entitlements and RPCharacters' account data, each named for what it
-- holds; spent login codes stop keeping their plaintext.

-- TFMCWeb pushes these at join; the site reads them for every entitlement gate.
ALTER TABLE rpc_player_meta RENAME TO web_entitlements;
ALTER TABLE web_entitlements RENAME CONSTRAINT rpc_player_meta_pkey TO web_entitlements_pkey;
ALTER TABLE web_entitlements RENAME COLUMN skin_kinds_json TO skin_kinds;
ALTER TABLE web_entitlements RENAME COLUMN permission_flags_json TO permission_flags;

-- RPCharacters pushes these with the roster: one row per Minecraft account.
-- Its copies of the character limit, name colours and wardrobe slots were
-- never read; web_entitlements holds those.
ALTER TABLE character_player_meta RENAME TO character_account_meta;
ALTER TABLE character_account_meta RENAME CONSTRAINT character_player_meta_pkey TO character_account_meta_pkey;
ALTER TABLE character_account_meta DROP COLUMN max_alive_characters;
ALTER TABLE character_account_meta DROP COLUMN name_colour_stops;
ALTER TABLE character_account_meta DROP COLUMN wardrobe_skin_slots;
ALTER TABLE character_account_meta RENAME COLUMN eighteen TO is_adult;
ALTER TABLE character_account_meta RENAME COLUMN kit_cooldowns_json TO kit_cooldowns;
ALTER TABLE character_account_meta RENAME COLUMN account_created_at_epoch TO account_created_at;
ALTER TABLE character_account_meta ALTER COLUMN account_created_at TYPE timestamptz
    USING CASE WHEN account_created_at > 0 THEN to_timestamp(account_created_at) END;

-- Only the staff list of open codes shows a plaintext, so a code that is
-- revoked, expired, used by a submission or (for a profile code) redeemed no
-- longer needs one.
UPDATE codes c SET code_plaintext = NULL
WHERE code_plaintext IS NOT NULL
  AND (revoked
       OR expires_at < now()
       OR (scope = 'profile' AND redeemed_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM submissions s WHERE s.code_id = c.id)
       OR EXISTS (SELECT 1 FROM drink_submissions d WHERE d.code_id = c.id));
