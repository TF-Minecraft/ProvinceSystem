import json

import numpy as np
import pytest
from fastapi import FastAPI

from src.api import admin_routes, auth_routes
from src.auth.test_admin import account, client
from src.rail import network
from src.scripts import province_id_grid
from src.scripts.util import dirs

MAIN = "aaaaaaaa-0000-4000-8000-000000000001"
SPUR = "aaaaaaaa-0000-4000-8000-000000000002"
LONE = "aaaaaaaa-0000-4000-8000-000000000003"


def track(track_id, points, world="TFMC_Map", broken=(), damaged=()):
    samples, s = [], 0.0
    for i, (x, z) in enumerate(points):
        if i:
            px, pz = points[i - 1]
            s += ((x - px) ** 2 + (z - pz) ** 2) ** 0.5
        samples.append({"s": s, "x": x, "y": 64.0, "z": z, "pitch": 0.0, "yaw": 0.0})
    segments = [
        {"broken": i in broken, "health": 0.5 if i in damaged else 1.0, "fromIndex": i}
        for i in range(len(points) - 1)
    ]
    return {"world": world, "loop": False, "id": track_id, "samples": samples, "segments": segments}


@pytest.fixture
def rail(tmp_path, monkeypatch):
    """A 100x100 map: province 1 on the left half, 2 on the right, 3 in the bottom strip."""
    monkeypatch.setattr(dirs, "INPUT_DIR", str(tmp_path / "input"))
    monkeypatch.setattr(dirs, "DEFINES_DIR", str(tmp_path / "defines"))
    ids = np.zeros((100, 100), dtype=np.uint16)
    ids[:80, :50] = 1
    ids[:80, 50:] = 2
    ids[80:, :] = 3
    province_id_grid.write_province_id_runs_file("main", source=(100, 100, ids))
    (tmp_path / "input" / "main").mkdir(parents=True)
    markers = {
        "settlements": [
            {"name": "§x§a§3§a§1§8§4West Town", "kind": "faction_capital", "faction_id": "f1",
             "center_x": 20, "center_z": 30, "provinces": [1]},
            {"name": "§6East Town", "kind": "settlement", "faction_id": "f2",
             "center_x": 80, "center_z": 30, "provinces": [2]},
            {"name": "Faraway", "kind": "settlement", "faction_id": "f3",
             "center_x": 50, "center_z": 90, "provinces": [3]},
        ]
    }
    (tmp_path / "input" / "main" / "map_markers.json").write_text(json.dumps(markers))

    folder = tmp_path / "tracks" / "TFMC_Map"
    (folder / "junctions").mkdir(parents=True)
    main = [(float(x), 40.0) for x in range(10, 91)]
    (folder / f"{MAIN}.json").write_text(json.dumps(track(MAIN, main, broken={30, 31, 32}, damaged={60})))
    (folder / f"{SPUR}.json").write_text(json.dumps(track(SPUR, [(70.0, 40.0), (70.0, 50.0), (70.0, 60.0)])))
    (folder / f"{LONE}.json").write_text(json.dumps(track(LONE, [(5.0, 5.0), (8.0, 5.0)])))
    (folder / "other-world.json").write_text(json.dumps(track("x", [(1.0, 1.0), (2.0, 2.0)], world="Nether")))
    (folder / "junctions" / "j1.json").write_text(json.dumps(
        {"id": "j1", "stem": MAIN, "branch": SPUR, "s": 60.0, "thrown": True, "side": "LEFT"}))
    monkeypatch.setenv("RAIL_TRACKS_DIR", str(tmp_path / "tracks"))
    monkeypatch.delenv("RAIL_WORLD", raising=False)
    network.clear_cache()
    yield folder
    network.clear_cache()


def load():
    return network.load_network(network.RailConfig.from_env(), "main")


def test_lines_stops_and_junctions(rail):
    net = load()
    assert net["status"] == "ok" and net["world"] == "TFMC_Map"
    assert [(line["name"], line["tracks"]) for line in net["lines"]] == [
        ("West Town – East Town", [MAIN, SPUR]),
        ("Unnamed line", [LONE]),
    ]
    # Colour codes stripped; each stop sits where the track comes closest inside its provinces.
    assert [(s["name"], s["at"], s["along"], s["distance"], s["line"]) for s in net["stops"]] == [
        ("West Town", [20.0, 40.0], 10.0, 10, 0),
        ("East Town", [80.0, 40.0], 70.0, 10, 0),
    ]
    assert net["junctions"] == [{"id": "j1", "stem": MAIN, "branch": SPUR, "at": [70.0, 40.0], "thrown": True}]
    # Other worlds are left out.
    assert {t["id"] for t in net["tracks"]} == {MAIN, SPUR, LONE}


def test_straight_track_is_simplified_and_breaks_reported(rail):
    main = next(t for t in load()["tracks"] if t["id"] == MAIN)
    assert main["points"] == [[10.0, 40.0], [90.0, 40.0]]
    assert main["length"] == 80.0
    assert main["broken"] == [{"from": 30.0, "to": 33.0, "points": [[40.0, 40.0], [43.0, 40.0]]}]
    assert main["damaged"] == [{"from": 60.0, "to": 61.0, "points": [[70.0, 40.0], [71.0, 40.0]]}]


def test_unreadable_file_is_counted_not_fatal(rail):
    (rail / "half-written.json").write_text('{"world": "TFMC_Map", "samples": [')
    net = load()
    assert net["unreadable_files"] == 1
    assert len(net["tracks"]) == 3


def test_cache_follows_the_files(rail):
    assert len(load()["tracks"]) == 3
    (rail / f"{LONE}.json").unlink()
    assert len(load()["tracks"]) == 2


def test_without_markers_or_provinces_there_are_no_stops(rail, tmp_path):
    (tmp_path / "defines" / "main" / province_id_grid.RUNS_FILENAME).unlink()
    net = load()
    assert net["stops"] == [] and net["lines"][0]["name"] == "Unnamed line"


def test_not_configured_and_missing(rail, monkeypatch, tmp_path):
    monkeypatch.delenv("RAIL_TRACKS_DIR")
    with pytest.raises(network.RailUnavailable) as exc:
        load()
    assert exc.value.code == "not_configured"
    monkeypatch.setenv("RAIL_TRACKS_DIR", str(tmp_path / "nowhere"))
    with pytest.raises(network.RailUnavailable) as exc:
        load()
    assert exc.value.code == "missing"


def test_simplify_keeps_corners():
    points = np.array([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], dtype=float)
    assert network.simplify(points) == [0, 2, 4]


@pytest.fixture
def env(database, monkeypatch):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", "https://www.tfminecraft.net")
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    return database


@pytest.fixture
def app(env):
    app = FastAPI()
    app.include_router(auth_routes.auth_router)
    admin_routes.install(app)
    return app


def test_route_is_for_admins(app, env, rail):
    assert client(app).get("/admin/rail").status_code == 401
    _, mod = account(env, "mod", "mod")
    assert client(app, mod).get("/admin/rail").status_code == 403
    _, admin = account(env, "boss", "admin")
    response = client(app, admin).get("/admin/rail")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert len(response.json()["tracks"]) == 3
    assert client(app, admin).get("/admin/rail", params={"map": "../main"}).status_code == 400


def test_route_reports_an_unconfigured_site(app, env, rail, monkeypatch):
    monkeypatch.delenv("RAIL_TRACKS_DIR")
    _, admin = account(env, "boss", "admin")
    body = client(app, admin).get("/admin/rail").json()
    assert body["status"] == "not_configured" and body["tracks"] == []
