"""Provision the studio's separate login after migrations, using the database owner.

Run with DATABASE_URL and DATABASE_STUDIO_PASSWORD in the environment:
    python -m src.database.studio_role [--role province_studio]

The login owns no persistent objects and belongs to no other roles. It can
read public tables and edit their data, except admin_audit and schema_migrations.
Re-run after migrations to grant access to new tables. This changes no rows.
"""
from __future__ import annotations

import argparse
import os

import psycopg
from psycopg import sql

from .connection import database_url

READ_ONLY_TABLES = {"admin_audit", "schema_migrations"}


class StudioRoleError(RuntimeError):
    pass


def provision(url: str, role: str, password: str) -> None:
    """Create or refresh a restricted login, refusing an existing privileged role."""
    if not role or len(role.encode("utf-8")) > 63 or "\x00" in role:
        raise StudioRoleError("invalid studio role name")
    if not password or "\x00" in password:
        raise StudioRoleError("a studio password is required")
    ident = sql.Identifier(role)
    with psycopg.connect(url) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"studio:role:{role}",))
        existing = conn.execute(
            "SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls "
            "FROM pg_roles WHERE rolname = %s", (role,),
        ).fetchone()
        if existing:
            oid, *privileged = existing
            membership = conn.execute("SELECT 1 FROM pg_auth_members WHERE member = %s LIMIT 1", (oid,)).fetchone()
            ownership = conn.execute(
                "SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass "
                "AND refobjid = %s AND deptype = 'o' LIMIT 1", (oid,),
            ).fetchone()
            if any(privileged) or membership or ownership:
                raise StudioRoleError("the studio role must own nothing and have no elevated privileges or memberships")
        else:
            conn.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(ident))
        conn.execute(sql.SQL(
            "ALTER ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD {}"
        ).format(ident, sql.Literal(password)))
        conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
            sql.Identifier(conn.info.dbname), ident,
        ))
        conn.execute(sql.SQL("REVOKE ALL ON SCHEMA public FROM {}").format(ident))
        conn.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(ident))
        conn.execute(sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {}").format(ident))
        conn.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}").format(ident))
        tables = conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        ).fetchall()
        for (table,) in tables:
            if table not in READ_ONLY_TABLES:
                conn.execute(sql.SQL("GRANT INSERT, UPDATE, DELETE ON TABLE public.{} TO {}").format(
                    sql.Identifier(table), ident,
                ))
        conn.execute(sql.SQL("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {}").format(ident))
        conn.execute(sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(ident))
        # Revoking this role's grants cannot remove privileges inherited from
        # PUBLIC. Refuse an older or restored database whose defaults bypass
        # these restrictions, without changing everyone else's permissions.
        unsafe = conn.execute(
            "SELECT has_schema_privilege(%s, 'public', 'CREATE') "
            "OR has_database_privilege(%s, current_database(), 'CREATE') "
            "OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND CASE WHEN c.relkind = 'S' "
            "THEN has_sequence_privilege(%s, c.oid, 'UPDATE') ELSE false END) "
            "OR EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' "
            "AND tablename = ANY(%s) AND has_table_privilege(%s, "
            "format('public.%%I', tablename), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))",
            (role, role, role, sorted(READ_ONLY_TABLES), role),
        ).fetchone()[0]
        if unsafe:
            raise StudioRoleError("PUBLIC grants bypass the studio restrictions; review the database grants first")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--role", default="province_studio")
    args = parser.parse_args(argv)
    try:
        provision(database_url(), args.role, os.environ.get("DATABASE_STUDIO_PASSWORD", ""))
    except StudioRoleError as exc:
        parser.error(str(exc))
    print(f"Studio role {args.role} is ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
