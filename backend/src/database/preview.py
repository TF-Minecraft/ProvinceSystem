"""Trusted Dev-side provisioning; preview images never receive cluster credentials.

The host controller holds both the preview lock and Dev deployment lock. Data
is restored by pg_restore between create and scrub; only then may clients start.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
import sys

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

from .connection import database_url
from .migrate import migrate
from .studio_role import provision


class PreviewError(RuntimeError):
    pass


def names(slug: str) -> tuple[str, str, str]:
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?", slug):
        raise PreviewError("invalid preview slug")
    name = "ps_pv_" + hashlib.sha256(slug.encode()).hexdigest()[:20]
    return name, name + "_owner", name + "_studio"


def tag(slug: str) -> str:
    return "provincesystem-preview:" + slug


def site_tables(url: str) -> list[str]:
    """Dev's tables that a preview copies: all but Precedent, patch notes and the migration history."""
    with psycopg.connect(url) as conn:
        names = [row[0] for row in conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")]
    return [name for name in names
            if name != "schema_migrations" and not name.startswith(("precedent_", "patchnote_"))]


def setup(url: str) -> None:
    """Explicit Dev administrator setup: isolate logins to their own databases.

    Keep every database owner's CONNECT and all existing direct grants. Each
    Studio/preview login receives its own explicit CONNECT when provisioned.
    """
    with psycopg.connect(url) as conn:
        for name, owner in conn.execute(
                "SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datallowconn"):
            conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(name), sql.Identifier(owner)))
            conn.execute(sql.SQL("REVOKE CONNECT ON DATABASE {} FROM PUBLIC").format(sql.Identifier(name)))


def _checked(conn, slug: str) -> tuple[str, str, str]:
    name, owner, studio = names(slug)
    row = conn.execute(
        "SELECT pg_get_userbyid(datdba), shobj_description(oid, 'pg_database') "
        "FROM pg_database WHERE datname = %s", (name,),
    ).fetchone()
    marked = []
    for role in (owner, studio):
        found = conn.execute("SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname=%s", (role,)).fetchone()
        if found is not None and found[0] != tag(slug):
            raise PreviewError("preview role identity does not match")
        marked.append(found is not None and found[0] == tag(slug))
    if row is not None and row != (owner, tag(slug)):
        # CREATE DATABASE cannot share a transaction with its COMMENT. Both
        # marked roles and the exact owner identify a crash in that narrow gap.
        if row != (owner, None) or not all(marked):
            raise PreviewError("preview database identity does not match")
    return name, owner, studio


def create(url: str, slug: str) -> dict:
    name, owner, studio = names(slug)
    password, studio_password = secrets.token_hex(32), secrets.token_hex(32)
    with psycopg.connect(url, autocommit=True) as conn:
        # Never adopt or reset an existing database on an ordinary redeploy.
        if conn.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone():
            raise PreviewError("preview database already exists; clean up the interrupted creation")
        with conn.transaction():
            for role in (owner, studio):
                conn.execute(sql.SQL("CREATE ROLE {} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE "
                                     "NOINHERIT NOREPLICATION NOBYPASSRLS").format(sql.Identifier(role)))
                conn.execute(sql.SQL("COMMENT ON ROLE {} IS {}").format(sql.Identifier(role), sql.Literal(tag(slug))))
        conn.execute(sql.SQL("CREATE DATABASE {} OWNER {} TEMPLATE template0 ENCODING 'UTF8' ALLOW_CONNECTIONS false").format(
            sql.Identifier(name), sql.Identifier(owner)))
        conn.execute(sql.SQL("COMMENT ON DATABASE {} IS {}").format(sql.Identifier(name), sql.Literal(tag(slug))))
        with conn.transaction():
            conn.execute(sql.SQL("REVOKE CONNECT ON DATABASE {} FROM PUBLIC").format(sql.Identifier(name)))
            for role, secret in ((owner, password), (studio, studio_password)):
                conn.execute(sql.SQL("ALTER ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(role), sql.Literal(secret)))
                conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(sql.Identifier(name), sql.Identifier(role)))
                other = conn.execute("SELECT 1 FROM pg_database WHERE datallowconn AND datname<>%s "
                                     "AND has_database_privilege(%s, oid, 'CONNECT') LIMIT 1", (name, role)).fetchone()
                if other:
                    raise PreviewError("preview login can access another database; run explicit isolation setup")
        conn.execute(sql.SQL("ALTER DATABASE {} ALLOW_CONNECTIONS true").format(sql.Identifier(name)))
    # Schema belongs to the disposable owner; its password reaches only this DB.
    owner_url = make_conninfo(url, dbname=name, user=owner, password=password)
    migrate(owner_url, seed=False)
    provision(make_conninfo(url, dbname=name), studio, studio_password, restrict_large_objects=True)
    return {"database": name, "owner": owner, "studio": studio,
            "DATABASE_URL": f"postgresql://{owner}:{password}@ps-preview-db:5432/{name}",
            "DATABASE_STUDIO_URL": f"postgresql://{studio}:{studio_password}@ps-preview-db:5432/{name}"}


def scrub(url: str, slug: str) -> None:
    with psycopg.connect(url) as conn:
        name, _, _ = _checked(conn, slug)
    with psycopg.connect(make_conninfo(url, dbname=name)) as conn:
        for table in ("code_sessions", "user_sessions", "discord_oauth_states", "discord_link_codes",
                      "preview_sign_in_tickets", "microsoft_link_states", "patreon_tokens",
                      "patreon_oauth_states", "patreon_pending_links"):
            conn.execute(sql.SQL("DELETE FROM public.{}").format(sql.Identifier(table)))
        conn.execute("UPDATE public.login_codes SET revoked=true, code_plaintext=NULL")
        conn.execute("UPDATE public.war_declaration_codes SET revoked=true")


def refresh(url: str, slug: str, credentials: dict) -> None:
    from psycopg.conninfo import conninfo_to_dict

    with psycopg.connect(url) as conn:
        name, owner, studio = _checked(conn, slug)
    if any(credentials.get(key) != value for key, value in (("database", name), ("owner", owner), ("studio", studio))):
        raise PreviewError("preview credentials do not match the controlled database")
    password = conninfo_to_dict(credentials["DATABASE_STUDIO_URL"]).get("password", "")
    provision(make_conninfo(url, dbname=name), studio, password)


def drop(url: str, slug: str) -> None:
    with psycopg.connect(url, autocommit=True) as conn:
        name, owner, studio = _checked(conn, slug)
        conn.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))
        for role in (studio, owner):
            # Refuse unexpected ownership/grants elsewhere; retain metadata for
            # operator inspection instead of DROP OWNED across unrelated DBs.
            conn.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("setup", "create", "scrub", "refresh", "drop", "tables", "list"))
    parser.add_argument("slug", nargs="?")
    args = parser.parse_args()
    try:
        url = database_url()
        if args.command == "setup":
            setup(url)
        elif args.command == "list":
            with psycopg.connect(url) as conn:
                rows = conn.execute("SELECT DISTINCT substring(description from length('provincesystem-preview:') + 1) FROM pg_shdescription "
                                    "WHERE description LIKE 'provincesystem-preview:%'").fetchall()
            for (slug,) in rows:
                names(slug)
                print(slug)
        elif args.command == "tables":
            print("\n".join(site_tables(url)))
        else:
            if args.slug is None:
                raise PreviewError("preview slug is required")
            if args.command == "create":
                print(json.dumps(create(url, args.slug)))  # Host redirects to a private file.
            elif args.command == "refresh":
                refresh(url, args.slug, json.load(sys.stdin))
            else:
                globals()[args.command](url, args.slug)
    except Exception as exc:
        detail = f": {exc}" if isinstance(exc, PreviewError) else ""
        print(f"Preview database {args.command} failed ({type(exc).__name__}){detail}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
