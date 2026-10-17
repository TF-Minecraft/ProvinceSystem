# Database studio

Owners (website role `root`) browse, query and edit the site's databases at
**Staff panel → Database** (`/admin/database`). The tab only shows for roles with
the `use_database` capability, which is root only. Code:
[`backend/src/dbstudio/studio.py`](../../../backend/src/dbstudio/studio.py),
[`backend/src/api/database_routes.py`](../../../backend/src/api/database_routes.py)
and `frontend/app/components/admin/database/`.

## Databases

Each site lists the databases it can reach:

| Id | What | Access |
|----|------|--------|
| `site` | The site's Postgres: accounts, characters, wardrobes, skins, chronicle and ledger indexes, Precedent, patch notes and the staff audit log | Read and edit ordinary data; audit and migration history are read only |
| `coreprotect` | The CoreProtect SQLite file named by `COREPROTECT_DB` (Main on www, Dev on the Dev site) | Read only |

The list shows each database's tables, size and how many audited queries it has had.
Opening one shows its tables with columns and approximate row counts (`max(rowid)` on
SQLite, `reltuples` on Postgres), query tabs and table tabs. Query tabs are kept in
the browser's local storage per database.

## Reading

Every query is one statement, enforced by the databases themselves: Python's
`sqlite3` refuses a second statement, and Postgres statements go through the extended
protocol (psycopg 3), which refuses several commands. As a second layer with clearer
messages, the studio also refuses before connecting transaction and session control (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `SET`, `RESET`, `DISCARD`,
…), `VACUUM`, `ATTACH`, `DETACH` and `COPY`; semicolons inside strings, quoted names,
dollar quotes and comments are ignored when counting statements.

Reads run on connections that cannot write: SQLite opened with `mode=ro` and
`PRAGMA query_only`, Postgres in a read-only transaction through a server-side cursor
(`DECLARE … CURSOR FOR`),
so a Postgres read must be a query (`SELECT`, `WITH`, `VALUES`, `TABLE`) and its rows
arrive as they are fetched. Each statement returns at most 1,000 rows and stops after
10 seconds on the site database. CoreProtect schema reads may call SQLite
pragmas such as `table_info`.

CoreProtect reads go through the same guarded reader as the CoreProtect pages
([coreprotect.md](../integrations/coreprotect.md)): one reader at a time and a
3-second budget, because a long read holds off CoreProtect's writes. Filter on
indexed columns (`user`, `time`, `wid`, `x`/`z`) and add a `LIMIT`.

A table tab pages through `SELECT * FROM <table>` with an optional `WHERE` filter
and sorting by any column; **Open as query** copies the statement into a query tab.
One click on a table opens it in a reused preview tab (italic title); a double click,
or paging, sorting or filtering in it, keeps the tab open.

CSV exports prefix text that starts with `=`, `+`, `-`, `@`, a tab or a carriage
return with `'`, so player-written text cannot run as a spreadsheet formula.

Text and JSONB values in columns whose names look secret (`token`, `secret`, `password`,
`nonce`, `api_key`, such as `token_hash` and `refresh_token`) show as `••••••`.
This keeps them off the screen; it is not access control. Integers beyond 2^53 are
sent as text, blobs as their size and first 32 bytes in hex, timestamps in ISO
format and JSON/JSONB values as the database's JSON text. JSON scalars keep their
JSON representation, JSON null stays distinct from SQL NULL, and JSON numbers
retain their precision.

## Editing

On a writable database, switch a query tab from **Read** to **Edit**. The studio
shows the statement and asks before running it. Edits run in one transaction with
foreign keys enforced and the same time limits, and the result shows the rows
changed. SQL runs under a separate Postgres login that owns no persistent objects
and belongs to no other roles. It may SELECT from public tables and INSERT,
UPDATE and DELETE ordinary data. Views, `admin_audit`, `schema_migrations`
and their inherited or partitioned descendants are read only. It cannot reset
sequence counters, create persistent large objects, create triggers/functions, or
create, alter, truncate or drop tables. These restrictions are database grants;
they apply even if a statement bypasses the studio's text checks.

### Studio login

`DATABASE_STUDIO_URL` supplies the restricted login. It is separate from the
application owner's `DATABASE_URL`; missing studio configuration gives a 503,
with no fallback to the owner connection. Both logins must address the same
site database.

After migrations, perform the initial setup from `backend/` with a non-empty
`DATABASE_STUDIO_PASSWORD` in the environment. For this setup, `DATABASE_URL`
must use a database administrator that can change grants on the built-in
large-object functions:

```sh
python -m src.database.studio_role --role province_studio --restrict-large-objects
```

The explicit flag revokes PUBLIC execution of the `pg_catalog` large-object
constructors in this database, including `lo_import` overloads. Other logins
that rely on those PUBLIC grants also lose that access. The setup preserves
the database owner's access and existing direct grants; it does not remove
large-object data. Each site and preview database needs this setup.

Then configure `DATABASE_STUDIO_URL` with the restricted login. Use a distinct
role per preview database. After migrations, refresh grants on new tables with
the owner's `DATABASE_URL` and the same password:

```sh
python -m src.database.studio_role --role province_studio
```

Ordinary refresh changes no data or other logins' grants. It refuses an existing
owner or privileged role, role memberships, and effective grants that would
bypass the restrictions, including large-object constructor access. Direct
table and sequence grants are reset; unsafe inherited or PUBLIC grants need
administrator review.

The studio authenticates as this login for every request. It does not use
`SET ROLE` on the owner's connection, which SQL calling `set_config` could undo.

## Audit

Every browse, query and edit is written to the staff audit log as
`database.read` or `database.write`, with the database, the statement (first 2,000
characters), the outcome and the row counts. An edit is logged as `requested` before
it runs, so if the audit log cannot be written the edit does not happen. Opening the
list (`database.list`) and a database's tables (`database.schema`) are logged too.
The list's query count covers reads and edits with an outcome.

## Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/admin/database` | GET | Databases with tables, size and query counts |
| `/admin/database/{id}/schema` | GET | Tables, views and columns |
| `/admin/database/{id}/browse` | POST | One page of a table: `table`, `offset`, `limit` (≤ 500), `order`, `descending`, `where` |
| `/admin/database/{id}/query` | POST | Run `sql`; `write: true` for an edit |

All need a root session; the POST routes also need the site's `Origin`. SQL errors
come back as **400** with the database's message, timeouts as **408**, a busy
CoreProtect reader as **409** and refused statements as **403**.
