import sys
from pathlib import Path
import pytest

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture
def database(tmp_path, monkeypatch):
    from src.patreon import service
    db = service.db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "province.db")
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    for name in ("SKINS_DIR", "WARDROBE_DIR", "DRINKS_DIR"):
        monkeypatch.setattr(db, name, tmp_path / name.lower())
    db.migrate()
    return db
