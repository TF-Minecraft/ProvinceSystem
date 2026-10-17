import sys
from pathlib import Path
import pytest

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture
def database(postgres):
    """Patreon and its Discord-link reads share the isolated Postgres fixture."""
    from src import database as pg
    return pg
