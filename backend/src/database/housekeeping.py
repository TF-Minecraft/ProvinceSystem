"""Hourly clean-up of rows that have outlived their use.

A login code keeps its plaintext only while staff may still hand it out.
Spending or revoking a code clears it at once; the sweep clears codes that
expired unused.
"""

from __future__ import annotations

import asyncio
import logging

from src import database

INTERVAL_SECONDS = 3600

logger = logging.getLogger("database.housekeeping")


def sweep() -> dict[str, int]:
    """Run each clean-up once and return how many rows each changed."""
    with database.connect() as conn:
        cleared = conn.execute(
            "UPDATE login_codes SET code_plaintext = NULL WHERE code_plaintext IS NOT NULL AND expires_at < now()"
        ).rowcount
    return {"expired_code_plaintext": cleared}


async def housekeeping_loop(stop: asyncio.Event) -> None:
    """Sweep on start and every INTERVAL_SECONDS until stopped."""
    while not stop.is_set():
        try:
            changed = await asyncio.to_thread(sweep)
            if any(changed.values()):
                logger.info("Housekeeping: %s", changed)
        except Exception:
            logger.exception("Housekeeping sweep failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass
