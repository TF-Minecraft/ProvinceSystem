"""Province site data on Postgres (psycopg 3).

    from src import database

    with database.connect() as conn:          # one transaction, rows are dicts
        row = conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()

Schema changes are numbered files in `migrations/`, applied by `migrate`.
"""

from psycopg import DatabaseError, Error, IntegrityError, OperationalError
from psycopg.errors import (
    CheckViolation,
    DeadlockDetected,
    ForeignKeyViolation,
    LockNotAvailable,
    QueryCanceled,
    SerializationFailure,
    UniqueViolation,
)
from psycopg.types.json import Jsonb

from .connection import (
    Connection,
    NotConfiguredError,
    advisory_lock,
    close_pool,
    connect,
    database_url,
    get_pool,
    open_pool,
    serializable,
    transaction,
)

__all__ = [
    "CheckViolation",
    "Connection",
    "DatabaseError",
    "DeadlockDetected",
    "Error",
    "ForeignKeyViolation",
    "IntegrityError",
    "Jsonb",
    "LockNotAvailable",
    "NotConfiguredError",
    "OperationalError",
    "QueryCanceled",
    "SerializationFailure",
    "UniqueViolation",
    "advisory_lock",
    "close_pool",
    "connect",
    "database_url",
    "get_pool",
    "open_pool",
    "serializable",
    "transaction",
]
