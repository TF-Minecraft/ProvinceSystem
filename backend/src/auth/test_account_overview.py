import base64
import io
import json

import httpx
import pytest
from PIL import Image

from src.auth import account_overview
from src.coreprotect.sessions import ACTION_LOGIN, ACTION_LOGOUT
from src.luckperms import mirror
from src.luckperms.test_luckperms import ALICE, BOB, snapshot

PLAYER = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8"
SKIN_URL = "http://textures.minecraft.net/texture/abc123"


@pytest.fixture(autouse=True)
def fresh_heads():
    account_overview.clear_heads()
    yield
    account_overview.clear_heads()


def test_activity_reads_first_and_last_sight(database, coreprotect):
    user = coreprotect.user("MrEnzo99", PLAYER.upper())
    coreprotect.session(user, 1_000, ACTION_LOGIN)
    coreprotect.session(user, 5_000, ACTION_LOGOUT)
    result = account_overview.activity(PLAYER)
    assert result == {"first_seen": 1_000, "last_seen": 5_000, "online": False, "server_label": "Vardera"}


def test_activity_is_none_when_unknown_or_unconfigured(database, coreprotect, monkeypatch):
    assert account_overview.activity(PLAYER) is None
    monkeypatch.delenv("COREPROTECT_DB")
    assert account_overview.activity(PLAYER) is None
    monkeypatch.setenv("COREPROTECT_DB", "/nonexistent/database.db")
    assert account_overview.activity(PLAYER) is None


def test_rank_names_the_heaviest_group(database):
    assert account_overview.rank(ALICE) is None
    mirror.replace_snapshot(snapshot())
    assert account_overview.rank(ALICE) == "Commoner"
    # Staff track variants show as the rank itself.
    assert account_overview.rank(BOB) == "Helper"
    assert account_overview.rank(PLAYER) is None


def skin_png(face=(200, 10, 10, 255), hat=None, height=64) -> bytes:
    image = Image.new("RGBA", (64, height), (0, 0, 0, 0))
    image.paste(face, (8, 8, 16, 16))
    if hat:
        image.paste(hat, (40, 8, 41, 9))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def mojang(skin: bytes, url=SKIN_URL, calls=None):
    textures = base64.b64encode(json.dumps({"textures": {"SKIN": {"url": url}}}).encode()).decode()

    def handler(request):
        if calls is not None:
            calls.append(str(request.url))
        if request.url.host == "sessionserver.mojang.com":
            assert request.url.path.endswith(PLAYER.replace("-", ""))
            return httpx.Response(200, json={"properties": [{"name": "textures", "value": textures}]})
        if request.url.host == "textures.minecraft.net":
            assert request.url.scheme == "https"
            return httpx.Response(200, content=skin)
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_head_is_the_face_with_its_hat_scaled_up():
    calls = []
    png = account_overview.head(PLAYER, mojang(skin_png(hat=(10, 200, 10, 255)), calls=calls))
    image = Image.open(io.BytesIO(png))
    assert image.size == (64, 64)
    assert image.getpixel((0, 0)) == (10, 200, 10, 255)
    assert image.getpixel((63, 63)) == (200, 10, 10, 255)
    # A second request is served from the cache.
    assert account_overview.head(PLAYER, mojang(b"", calls=calls)) == png
    assert len(calls) == 2


def test_head_accepts_legacy_skins():
    assert account_overview.head(PLAYER, mojang(skin_png(height=32))) is not None


@pytest.mark.parametrize("skin,url", [
    (b"not a png", SKIN_URL),
    (skin_png(), "https://evil.example/texture/abc"),
])
def test_head_is_none_for_bad_skins(skin, url):
    assert account_overview.head(PLAYER, mojang(skin, url)) is None


def test_head_is_none_for_a_bad_uuid():
    assert account_overview.head("not-a-uuid") is None
