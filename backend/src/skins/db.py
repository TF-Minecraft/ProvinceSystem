import json
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
        _upgrade(conn)


_USERS_ROLE_COLUMN = (
    "role TEXT NOT NULL DEFAULT 'player' "
    "CHECK (role IN ('player', 'mod', 'admin', 'root'))"
)


def _move_nicknames_out_of_usernames(conn: sqlite3.Connection) -> None:
    """Links made before usernames were checked hold a server nickname there ("Justin").

    Move each into discord_nickname and clear the username, so the bot's next
    fill (which only fills empty ones) or the player's next sign-in stores the handle.
    """
    from .discord_link import is_discord_username

    for row in conn.execute("SELECT player_uuid, discord_username FROM discord_links").fetchall():
        name = row["discord_username"]
        if name and not is_discord_username(name):
            conn.execute(
                "UPDATE discord_links SET discord_nickname = ?, discord_username = NULL WHERE player_uuid = ?",
                (name.strip(), row["player_uuid"]),
            )


# Player armour approved before metal lines stored bare tiers (``iron``, ``mage``).
# These are the shop sets staff gave them, keyed by submission id (main and dev).
_LEGACY_ARMOR_SETS = {
    "archbishqp_crusader": {"iron": "medium steel"},
    "estiennehavenga_priestess_armour": {"mage": "mage steel"},
    "geofflive_thalendorian_armor": {
        "iron": "light iron",
        "steel": "light steel",
        "abyssalite": "light abyssalite",
        "mythril": "light mythril",
        "mage": "mage steel",
    },
}


def _set_legacy_armor_sets(conn: sqlite3.Connection) -> None:
    """Store the shop sets of armour approved before metal lines.

    Keeps a re-apply from writing the bare metal back over the shop. Only an
    unset row is touched, so later edits are kept.
    """
    for submission_id, sets in _LEGACY_ARMOR_SETS.items():
        conn.execute(
            "UPDATE submissions SET tier_sets = ? WHERE id IN (?, ?) AND tier_sets IS NULL",
            (json.dumps(sets), submission_id, f"dev_{submission_id}"),
        )


def _upgrade(conn: sqlite3.Connection) -> None:
    """Add columns that CREATE TABLE IF NOT EXISTS cannot add to old tables."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
        if "role" not in columns:
            conn.execute(f"ALTER TABLE users ADD COLUMN {_USERS_ROLE_COLUMN}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)")
        links = {row["name"] for row in conn.execute("PRAGMA table_info(discord_links)")}
        if "discord_nickname" not in links:
            conn.execute("ALTER TABLE discord_links ADD COLUMN discord_nickname TEXT")
            _move_nicknames_out_of_usernames(conn)
        submissions = {row["name"] for row in conn.execute("PRAGMA table_info(submissions)")}
        if "tier_sets" not in submissions:
            conn.execute("ALTER TABLE submissions ADD COLUMN tier_sets TEXT")
        _set_legacy_armor_sets(conn)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
