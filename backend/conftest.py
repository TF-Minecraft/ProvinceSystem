"""Share the database module and keep sandboxed threaded ASGI tests responsive."""
from pathlib import Path
import sys
import asyncio
import pytest

backend = Path(__file__).resolve().parent
sys.path.insert(0, str(backend))
sys.path.insert(0, str(backend / "src"))

import src.skins as skins
from src.skins import db

# Fixtures replace db paths with temporary directories. All imported connect
# functions must retain that same module's globals throughout test collection.
sys.modules["skins"] = skins
sys.modules["skins.db"] = db


@pytest.fixture(scope="session", autouse=True)
def sandbox_event_loop_wakeup():
    # Keep threaded ASGI tests responsive when socket wakeups are blocked.
    original = asyncio.DefaultEventLoopPolicy.new_event_loop

    def new_event_loop(policy):
        loop = original(policy)
        try:
            loop._csock.send(b"\0")
        except PermissionError:
            def tick():
                loop.call_later(.01, tick)
            loop.call_soon(tick)
        return loop

    asyncio.DefaultEventLoopPolicy.new_event_loop = new_event_loop
    try:
        yield
    finally:
        asyncio.DefaultEventLoopPolicy.new_event_loop = original
