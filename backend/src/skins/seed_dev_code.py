"""Seed local mock code TEST-CODE-1. Run from backend/: python src/skins/seed_dev_code.py"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow `python src/skins/seed_dev_code.py` from backend/
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from src import database
from src.database.migrate import migrate
from src.skins.codes import hash_secret

DEV_CODE = "TEST-CODE-1"
DEV_UUID = "00000000-0000-0000-0000-000000000001"


def main() -> None:
    """Writes to the Postgres in DATABASE_URL, migrated first."""
    migrate(seed=True)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    expires = now + timedelta(hours=48)
    code_hash = hash_secret(DEV_CODE)

    with database.connect() as conn:
        row = conn.execute(
            """
            INSERT INTO login_codes (
                code_hash, code_plaintext, player_uuid, scope,
                created_at, expires_at, redeemed_at, revoked
            )
            VALUES (%s, %s, %s, 'skin', %s, %s, NULL, false)
            ON CONFLICT (code_hash) DO UPDATE
            SET player_uuid = excluded.player_uuid, scope = 'skin', code_plaintext = excluded.code_plaintext,
                created_at = excluded.created_at, expires_at = excluded.expires_at,
                redeemed_at = NULL, revoked = false
            RETURNING (xmax = 0) AS inserted
            """,
            (code_hash, DEV_CODE, DEV_UUID, now, expires),
        ).fetchone()
    action = "inserted" if row["inserted"] else "updated"
    expires_at = expires.strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"Seed {action}: code={DEV_CODE} uuid={DEV_UUID} expires_at={expires_at}")
    print("Set SKINS_DEV=1 (see backend/.env.example) for local plugin/staff keys.")


if __name__ == "__main__":
    main()
