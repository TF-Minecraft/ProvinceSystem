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


def migrate() -> None:
    """Initialise the current database schema and storage directories."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SKINS_DIR.mkdir(parents=True, exist_ok=True)
    WARDROBE_DIR.mkdir(parents=True, exist_ok=True)
    DRINKS_DIR.mkdir(parents=True, exist_ok=True)
    (DRINKS_DIR / "textures").mkdir(parents=True, exist_ok=True)
    (DRINKS_DIR / "submissions").mkdir(parents=True, exist_ok=True)
    (DRINKS_DIR / "assets").mkdir(parents=True, exist_ok=True)
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    with connect() as conn:
        conn.executescript(schema)
        conn.commit()
