"""The housekeeping loop sweeps at once, survives a failed sweep and stops when asked."""

import asyncio

from src.database import housekeeping


def test_loop_sweeps_on_start_keeps_going_after_a_failure_and_stops(monkeypatch):
    calls = []

    def sweep():
        calls.append(len(calls))
        if len(calls) == 1:
            raise RuntimeError("database away")
        return {"expired_code_plaintext": 0}

    monkeypatch.setattr(housekeeping, "sweep", sweep)
    monkeypatch.setattr(housekeeping, "INTERVAL_SECONDS", 0.01)

    async def run():
        stop = asyncio.Event()
        task = asyncio.create_task(housekeeping.housekeeping_loop(stop))
        while len(calls) < 3:
            await asyncio.sleep(0.01)
        stop.set()
        await asyncio.wait_for(task, timeout=1)

    asyncio.run(run())
    assert len(calls) >= 3
