"""Real database isolation, credential scrub and recoverable preview teardown."""
import uuid

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from src.database import preview
from src.database.migrate import migrate


@pytest.fixture
def isolated_cluster(scratch_database):
    url = scratch_database
    with psycopg.connect(url) as conn:
        public_connect = [row[0] for row in conn.execute(
            "SELECT d.datname FROM pg_database d, LATERAL aclexplode(COALESCE(d.datacl, acldefault('d',d.datdba))) a "
            "WHERE a.grantee=0 AND a.privilege_type='CONNECT'")]
    preview.setup(url)
    try:
        yield url
    finally:
        # The test owns only its ACL changes; other test connections keep access.
        with psycopg.connect(url) as conn:
            for name in public_connect:
                if conn.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone():
                    conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO PUBLIC").format(sql.Identifier(name)))


@pytest.fixture
def clone(isolated_cluster):
    url, slug = isolated_cluster, "test-" + uuid.uuid4().hex[:20]
    try:
        credentials = preview.create(url, slug)
        yield url, slug, credentials
    finally:
        preview.drop(url, slug)


def login(url, credentials, key):
    parts = conninfo_to_dict(credentials[key])
    return make_conninfo(url, dbname=credentials["database"], user=parts["user"], password=parts["password"])


def test_creation_refuses_public_access_to_another_database(scratch_database):
    slug = "test-" + uuid.uuid4().hex[:20]
    try:
        with pytest.raises(preview.PreviewError, match="another database"):
            preview.create(scratch_database, slug)
        _, owner, studio = preview.names(slug)
        with psycopg.connect(scratch_database) as conn:
            assert conn.execute("SELECT bool_or(rolcanlogin) FROM pg_roles WHERE rolname=ANY(%s)",
                                ([owner, studio],)).fetchone() == (False,)
    finally:
        preview.drop(scratch_database, slug)


def test_preview_logins_are_confined_to_their_database(clone):
    url, slug, credentials = clone
    owner = login(url, credentials, "DATABASE_URL")
    studio = login(url, credentials, "DATABASE_STUDIO_URL")
    with psycopg.connect(owner) as conn:
        assert conn.execute("SELECT count(*) FROM public.codes").fetchone() == (0,)
        assert conn.execute("SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.codes'::regclass").fetchone() == (credentials["owner"],)
    with psycopg.connect(studio) as conn:
        assert conn.execute("SELECT count(*) FROM public.admin_audit").fetchone() == (0,)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("TRUNCATE public.codes")
    for connection in (owner, studio):
        with pytest.raises(psycopg.OperationalError, match="permission denied for database"):
            psycopg.connect(make_conninfo(connection, dbname=conninfo_to_dict(url)["dbname"]))
    preview.refresh(url, slug, credentials)
    with pytest.raises(preview.PreviewError, match="already exists"):
        preview.create(url, slug)


def test_scrub_preserves_content_and_foreign_keys_without_touching_source(clone):
    url, slug, credentials = clone
    migrate(url, seed=False)
    target = make_conninfo(url, dbname=credentials["database"])
    fixture = """
        INSERT INTO codes(id,code_hash,code_plaintext,player_uuid,created_at,expires_at)
          VALUES (9,'hash','secret','player',now(),now());
        INSERT INTO sessions(token_hash,code_id,player_uuid,created_at,expires_at)
          VALUES ('token',9,'player',now(),now());
        INSERT INTO submissions(id,player_uuid,code_id,kind,slug,display_name,status,dir_path,created_at)
          VALUES ('skin','player',9,'handheld','skin','Skin','applied','skins/skin',now());
        INSERT INTO discord_link_codes(code_hash,player_uuid,created_at,expires_at)
          VALUES ('link','player',now(),now());
        INSERT INTO patreon_tokens VALUES (1,'creator-secret','refresh-secret',now());
        INSERT INTO patreon_oauth_states(state_hash,discord_user_id,expires_at) VALUES ('state','discord',now());
        INSERT INTO patreon_pending_links(token_hash,patreon_user_id,patreon_name,discord_user_id,target_kind,target_name,expires_at)
          VALUES ('confirm','patron','Patron','discord','discord','Name',now());
        INSERT INTO war_declare_codes(code_hash,attacker_faction_id,defender_faction_id,goal,created_at,expires_at)
          VALUES ('war','a','b','goal',now(),now());
    """
    for connection in (url, target):
        with psycopg.connect(connection) as conn:
            conn.execute(fixture)
    preview.scrub(url, slug)
    with psycopg.connect(target) as conn:
        assert conn.execute("SELECT revoked, code_plaintext FROM codes").fetchone() == (True, None)
        assert conn.execute("SELECT code_id FROM submissions").fetchone() == (9,)
        assert conn.execute("SELECT revoked FROM war_declare_codes").fetchone() == (True,)
        for table in ("sessions", "user_sessions", "discord_oauth_states", "discord_link_codes", "preview_sign_in_tickets",
                      "microsoft_link_states", "patreon_tokens", "patreon_oauth_states", "patreon_pending_links"):
            assert conn.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table))).fetchone() == (0,)
        assert conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND "
                            "(tablename LIKE 'precedent_%' OR tablename LIKE 'patchnote_%')").fetchone() == (0,)
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT revoked,code_plaintext FROM codes").fetchone() == (False, "secret")
        assert conn.execute("SELECT access_token FROM patreon_tokens").fetchone() == ("creator-secret",)


def test_partial_creation_cleanup_and_identity_refusal(isolated_cluster):
    url, slug = isolated_cluster, "test-" + uuid.uuid4().hex[:20]
    credentials = preview.create(url, slug)
    name, owner, studio = preview.names(slug)
    try:
        with psycopg.connect(url) as conn:
            conn.execute(sql.SQL("COMMENT ON DATABASE {} IS 'unrelated'").format(sql.Identifier(name)))
        with pytest.raises(preview.PreviewError, match="identity"):
            preview.drop(url, slug)
        with psycopg.connect(url) as conn:
            # Simulate loss between CREATE DATABASE and its COMMENT.
            conn.execute(sql.SQL("COMMENT ON DATABASE {} IS NULL").format(sql.Identifier(name)))
        preview.drop(url, slug)
        preview.drop(url, slug)
        with psycopg.connect(url) as conn:
            assert conn.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone() is None
            assert conn.execute("SELECT 1 FROM pg_roles WHERE rolname=ANY(%s)", ([owner, studio],)).fetchall() == []
    finally:
        preview.drop(url, slug)
