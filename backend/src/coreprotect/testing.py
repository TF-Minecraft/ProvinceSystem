"""Test helpers: a CoreProtect-shaped SQLite file with the fork's real schema."""
import sqlite3
from pathlib import Path

SCHEMA = Path(__file__).with_name("testdata") / "schema.sql"


class CoreProtectDb:
    """A CoreProtect-shaped SQLite file with the fork's real schema."""

    def __init__(self, path: Path):
        self.path = path
        conn = sqlite3.connect(path)
        conn.executescript(SCHEMA.read_text(encoding="utf-8"))
        conn.executemany("INSERT INTO co_world (id, world) VALUES (?, ?)", [(1, "TFMC_Map"), (2, "TFMC_Map_the_end")])
        conn.executemany("INSERT INTO co_material_map (id, material) VALUES (?, ?)",
                         [(1, "minecraft:stone"), (2, "minecraft:oak_door"), (3, "minecraft:iron_ingot")])
        conn.executemany("INSERT INTO co_entity_map (id, entity) VALUES (?, ?)", [(1, "cow"), (2, "sheep")])
        conn.commit()
        conn.close()

    def execute(self, sql: str, params: tuple = ()) -> int:
        conn = sqlite3.connect(self.path)
        try:
            cursor = conn.execute(sql, params)
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def user(self, name: str, uuid: str | None, time: int = 1_000) -> int:
        return self.execute("INSERT INTO co_user (time, user, uuid) VALUES (?, ?, ?)", (time, name, uuid))

    def session(self, user: int, time: int, action: int, x: int = 0) -> int:
        return self.execute(
            "INSERT INTO co_session (time, user, wid, x, y, z, action) VALUES (?, ?, 1, ?, 64, 0, ?)",
            (time, user, x, action))

    def block(self, user: int, time: int, action: int, type_id: int = 1, data: int = 0, rolled_back: int = 0) -> int:
        return self.execute(
            "INSERT INTO co_block (time, user, wid, x, y, z, type, data, meta, blockdata, action, rolled_back) "
            "VALUES (?, ?, 1, 10, 64, 20, ?, ?, NULL, NULL, ?, ?)", (time, user, type_id, data, action, rolled_back))

    def container(self, user: int, time: int, action: int, amount: int = 1, rolled_back: int = 0) -> int:
        return self.execute(
            "INSERT INTO co_container (time, user, wid, x, y, z, type, data, amount, metadata, action, rolled_back) "
            "VALUES (?, ?, 1, 1, 2, 3, 3, 0, ?, X'00', ?, ?)", (time, user, amount, action, rolled_back))

    def item(self, user: int, time: int, action: int, amount: int = 1) -> int:
        return self.execute(
            "INSERT INTO co_item (time, user, wid, x, y, z, type, data, amount, action, rolled_back) "
            "VALUES (?, ?, 1, 1, 2, 3, 3, X'00', ?, ?, 0)", (time, user, amount, action))

    def command(self, user: int, time: int, message: str) -> int:
        return self.execute(
            "INSERT INTO co_command (time, user, wid, x, y, z, message) VALUES (?, ?, 1, 5, 6, 7, ?)",
            (time, user, message))

    def chat(self, user: int, time: int, message: str) -> int:
        return self.execute(
            "INSERT INTO co_chat (time, user, wid, x, y, z, message) VALUES (?, ?, 1, 5, 6, 7, ?)",
            (time, user, message))

    def sign(self, user: int, time: int, action: int, text: str) -> int:
        return self.execute(
            "INSERT INTO co_sign (time, user, wid, x, y, z, action, color, color_secondary, data, waxed, face, "
            "line_1) VALUES (?, ?, 1, 1, 2, 3, ?, 0, 0, 0, 0, 0, ?)", (time, user, action, text))

    def interaction(self, user: int, time: int, action: int, type_id: int = 2) -> int:
        return self.execute(
            "INSERT INTO co_entity_interaction (time, user, entity_spawn_rowid, wid, x, y, z, type, action, "
            "metadata, rolled_back) VALUES (?, ?, 1, 1, 1, 2, 3, ?, ?, NULL, 0)", (time, user, type_id, action))
