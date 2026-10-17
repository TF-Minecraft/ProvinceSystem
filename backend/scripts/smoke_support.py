"""Run a standalone API smoke against disposable Postgres and asset storage."""

from __future__ import annotations

import os
import tempfile
import uuid
from functools import wraps
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo


def isolated_smoke(main):
    @wraps(main)
    def run():
        base = os.environ.get("TEST_DATABASE_URL", "").strip()
        if not base:
            raise SystemExit("Set TEST_DATABASE_URL to a test server where the login can create databases")

        from src.database import close_pool, open_pool
        from src.database.migrate import migrate
        from src.skins import db

        name = f"ps_smoke_{uuid.uuid4().hex}"
        with psycopg.connect(base, autocommit=True) as admin:
            admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name)))
        previous_url = os.environ.get("DATABASE_URL")
        previous_paths = {key: getattr(db, key) for key in ("DATA_DIR", "SKINS_DIR", "WARDROBE_DIR", "DRINKS_DIR")}
        try:
            with tempfile.TemporaryDirectory(prefix="ps-smoke-") as directory:
                db.DATA_DIR = root = Path(directory)
                db.SKINS_DIR = root / "skins"
                db.WARDROBE_DIR = root / "wardrobe"
                db.DRINKS_DIR = root / "drinks"
                db.ensure_directories()
                url = make_conninfo(base, dbname=name)
                os.environ["DATABASE_URL"] = url
                migrate(url, seed=True)
                open_pool(url, min_size=0, max_size=3)
                # Import the app inside main(), after redirecting asset paths.
                return main()
        finally:
            close_pool()
            for key, value in previous_paths.items():
                setattr(db, key, value)
            if previous_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous_url
            with psycopg.connect(base, autocommit=True) as admin:
                admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))

    return run
