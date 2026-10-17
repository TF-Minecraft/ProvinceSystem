"""Provision the studio's separate login after migrations, using the database owner.

Run with DATABASE_URL and DATABASE_STUDIO_PASSWORD in the environment:
    python -m src.database.studio_role [--role province_studio] [--restrict-large-objects]

The login owns no persistent objects and belongs to no other roles. It can
read public relations and edit ordinary tables, except admin_audit,
schema_migrations and their descendants. User-defined views stay read-only.
Re-run after migrations to grant access to new tables. This changes no rows.
Initial admin setup must explicitly restrict PUBLIC large-object constructor access.
"""
from __future__ import annotations

import argparse
import os

import psycopg
from psycopg import sql

from .connection import database_url

READ_ONLY_TABLES = {"admin_audit", "schema_migrations"}
LARGE_OBJECT_CONSTRUCTORS = ("lo_create", "lo_creat", "lo_from_bytea", "lo_import")


class StudioRoleError(RuntimeError):
    pass


def provision(url: str, role: str, password: str, *, restrict_large_objects: bool = False) -> None:
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
        constructors = conn.execute(
            "SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid), "
            "pg_get_userbyid(d.datdba), has_function_privilege(d.datdba, p.oid, 'EXECUTE') "
            "FROM pg_proc p CROSS JOIN pg_database d "
            "WHERE p.pronamespace = 'pg_catalog'::regnamespace AND p.proname = ANY(%s) "
            "AND d.datname = current_database()", (list(LARGE_OBJECT_CONSTRUCTORS),),
        ).fetchall()
        if restrict_large_objects:
            for _, name, arguments, owner, owner_access in constructors:
                function = sql.SQL("pg_catalog.{}({})").format(sql.Identifier(name), sql.SQL(arguments))
                # Removing PUBLIC access also affects a non-superuser database
                # owner. Preserve that access and every existing direct grant.
                if owner_access:
                    conn.execute(sql.SQL("GRANT EXECUTE ON FUNCTION {} TO {}").format(function, sql.Identifier(owner)))
                conn.execute(sql.SQL("REVOKE EXECUTE ON FUNCTION {} FROM PUBLIC").format(function))
        if any(conn.execute("SELECT has_function_privilege(%s, %s, 'EXECUTE')", (role, oid)).fetchone()[0]
               for oid, *_ in constructors):
            raise StudioRoleError("Effective large-object constructor grants bypass the studio restrictions; "
                                  "use --restrict-large-objects for explicit PUBLIC setup and review direct grants")
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
        protected = [row[0] for row in conn.execute(
            "WITH RECURSIVE protected(oid) AS ("
            "SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relname = ANY(%s) "
            "UNION SELECT i.inhrelid FROM pg_inherits i JOIN protected p ON p.oid = i.inhparent) "
            "SELECT oid FROM protected", (sorted(READ_ONLY_TABLES),),
        )]
        tables = conn.execute(
            "SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname",
        ).fetchall()
        for oid, table in tables:
            if oid not in protected:
                conn.execute(sql.SQL("GRANT INSERT, UPDATE, DELETE ON TABLE public.{} TO {}").format(
                    sql.Identifier(table), ident,
                ))
        conn.execute(sql.SQL("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {}").format(ident))
        conn.execute(sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(ident))
        # Table privilege checks miss PUBLIC column grants. Check effective
        # access without changing other logins' permissions.
        unsafe = conn.execute(
            "SELECT has_database_privilege(%s, current_database(), 'CREATE') "
            "OR EXISTS (SELECT 1 FROM pg_namespace n "
            "WHERE n.nspname !~ '^pg_(toast_)?temp_[0-9]+$' AND has_schema_privilege(%s, n.oid, 'CREATE')) "
            "OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname !~ '^pg_(toast_)?temp_[0-9]+$' AND CASE WHEN c.relkind = 'S' "
            "THEN has_sequence_privilege(%s, c.oid, 'UPDATE') ELSE false END) "
            "OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND ("
            "(n.nspname = 'public' AND (has_table_privilege(%s, c.oid, 'TRUNCATE, REFERENCES, TRIGGER') "
            "OR has_any_column_privilege(%s, c.oid, 'REFERENCES'))) "
            "OR ((c.oid = ANY(%s) OR (c.relkind IN ('v', 'm') "
            "AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')) "
            "AND (has_table_privilege(%s, c.oid, 'INSERT, UPDATE, DELETE') "
            "OR has_any_column_privilege(%s, c.oid, 'INSERT, UPDATE')))))",
            (role, role, role, role, role, protected, role, role),
        ).fetchone()[0]
        if unsafe:
            raise StudioRoleError("Effective grants bypass the studio restrictions; review the database grants first")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--role", default="province_studio")
    parser.add_argument("--restrict-large-objects", action="store_true",
                        help="admin setup: revoke PUBLIC constructor EXECUTE, preserving database owner access")
    args = parser.parse_args(argv)
    try:
        provision(database_url(), args.role, os.environ.get("DATABASE_STUDIO_PASSWORD", ""),
                  restrict_large_objects=args.restrict_large_objects)
    except StudioRoleError as exc:
        parser.error(str(exc))
    print(f"Studio role {args.role} is ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
