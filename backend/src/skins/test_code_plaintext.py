"""A login code keeps its plaintext only while staff may still hand it out."""

from datetime import datetime, timedelta, timezone

import pytest

from src import database
from src.auth import testing
from src.database.housekeeping import sweep
from src.skins import codes

pytestmark = pytest.mark.usefixtures("postgres")

NOW = datetime.now(timezone.utc)


def _code(plaintext: str, scope: str, *, expires: timedelta = timedelta(hours=1)) -> int:
    return testing.value(
        "INSERT INTO codes (code_hash, code_plaintext, player_uuid, scope, realm_id, created_at, expires_at) "
        "VALUES (%s, %s, 'player', %s, 'main', %s, %s) RETURNING id",
        (codes.hash_secret(plaintext), plaintext, scope, NOW, NOW + expires),
    )


def _plaintext(code_id: int) -> str | None:
    return testing.value("SELECT code_plaintext FROM codes WHERE id = %s", (code_id,))


def test_redeeming_a_profile_code_clears_its_plaintext():
    code_id = _code("PROFILE1", "profile")
    codes.redeem_profile_code("PROFILE1")
    assert _plaintext(code_id) is None


def test_revoking_a_code_clears_its_plaintext():
    code_id = _code("SKIN0001", "skin")
    codes.revoke_code("SKIN0001")
    assert _plaintext(code_id) is None


def test_consuming_a_code_for_a_submission_clears_its_plaintext():
    code_id = _code("DRINK001", "drink")
    with database.connect() as conn:
        codes.mark_code_consumed(conn, code_id)
    assert _plaintext(code_id) is None


def test_starting_a_skin_session_keeps_the_plaintext_until_the_code_is_used():
    code_id = _code("SKIN0002", "skin")
    codes.redeem_code("SKIN0002")
    assert _plaintext(code_id) == "SKIN0002"
    assert [c["code"] for c in codes.list_active_codes()] == ["SKIN0002"]


def test_sweep_clears_only_expired_codes():
    live = _code("LIVE0001", "profile")
    expired = _code("OLD00001", "profile", expires=-timedelta(minutes=1))
    assert sweep() == {"expired_code_plaintext": 1}
    assert (_plaintext(live), _plaintext(expired)) == ("LIVE0001", None)
    assert sweep() == {"expired_code_plaintext": 0}
