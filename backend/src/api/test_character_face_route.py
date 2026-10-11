"""GET /characters/{id}/face and /figure serve the worn skin to its owner's Profile session."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.api.characters_routes as routes
from src.characters.wardrobe import WardrobeError

SESSION = {"scope": "profile", "player_uuid": "p-1"}
AUTH = {"Authorization": "Bearer t"}


def client() -> TestClient:
    app = FastAPI()
    app.include_router(routes.characters_router)
    return TestClient(app)


def test_needs_a_profile_session():
    with mock.patch.object(routes, "get_session", return_value=None):
        assert client().get("/characters/c1/face", headers=AUTH).status_code == 401


def test_serves_the_face_uncached():
    with (
        mock.patch.object(routes, "get_session", return_value=SESSION),
        mock.patch.object(routes, "active_face_png", return_value=b"png") as face,
    ):
        res = client().get("/characters/c1/face", headers=AUTH)
    assert res.status_code == 200
    assert res.content == b"png"
    assert res.headers["content-type"] == "image/png"
    assert res.headers["cache-control"] == "no-store"
    face.assert_called_once_with("p-1", "c1")


def test_no_face_is_404_and_someone_elses_character_is_refused():
    with (
        mock.patch.object(routes, "get_session", return_value=SESSION),
        mock.patch.object(routes, "active_face_png", return_value=None),
    ):
        assert client().get("/characters/c1/face", headers=AUTH).json() == {"detail": "no_face"}
    with (
        mock.patch.object(routes, "get_session", return_value=SESSION),
        mock.patch.object(routes, "active_face_png", side_effect=WardrobeError("Character not found on roster", status_code=403)),
    ):
        assert client().get("/characters/c1/face", headers=AUTH).status_code == 403


def test_serves_the_worn_figure_uncached():
    with (
        mock.patch.object(routes, "get_session", return_value=SESSION),
        mock.patch.object(routes, "active_figure_png", return_value=b"figure") as figure,
    ):
        res = client().get("/characters/c1/figure", headers=AUTH)
    assert res.status_code == 200
    assert res.content == b"figure"
    assert res.headers["content-type"] == "image/png"
    assert res.headers["cache-control"] == "no-store"
    figure.assert_called_once_with("p-1", "c1")


def test_no_figure_is_404_and_someone_elses_is_refused():
    with (
        mock.patch.object(routes, "get_session", return_value=SESSION),
        mock.patch.object(routes, "active_figure_png", return_value=None),
    ):
        assert client().get("/characters/c1/figure", headers=AUTH).json() == {"detail": "no_figure"}
    with (
        mock.patch.object(routes, "get_session", return_value=SESSION),
        mock.patch.object(routes, "active_figure_png", side_effect=WardrobeError("Character not found on roster", status_code=403)),
    ):
        assert client().get("/characters/c1/figure", headers=AUTH).status_code == 403
    with mock.patch.object(routes, "get_session", return_value=None):
        assert client().get("/characters/c1/figure", headers=AUTH).status_code == 401
