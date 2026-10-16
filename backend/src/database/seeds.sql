-- Rows the site needs, inserted at start-up after the migrations. Every
-- statement must be safe to run again and must not overwrite existing rows.

INSERT INTO patreon_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
