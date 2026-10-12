import hashlib
import json
import threading
import zipfile

import pytest
from fastapi import FastAPI

from src.servers import control, host, inventory
from src.auth.test_admin import account, client, audit_rows, ORIGIN


def jar(path, name="Core", version="1.0.0"):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("plugin.yml", f"name: {name}\nversion: {version}\n")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def startup(logs, version="1.0.0", error=False):
    (logs / "latest.log").write_text("[06:00:00 INFO]: [bootstrap] Loading Paper 1.21.10\n"
                                    f"[06:00:01 INFO]: [Core] Enabling Core v{version}\n"
                                    + ("[06:00:02 ERROR]: plugin failed\n" if error else "")
                                    + "[06:00:03 INFO]: Done (1.0s)!\n")


@pytest.fixture
def controller(tmp_path, monkeypatch):
    monkeypatch.setattr(host, "scheduled_restart", lambda *_: False)
    roots = {}
    commands = []
    for server in ("main", "dev"):
        plugins = tmp_path / server / "plugins"
        logs = tmp_path / server / "logs"
        plugins.mkdir(parents=True)
        logs.mkdir()
        (plugins / "Maintenance").mkdir()
        (plugins / "Maintenance" / "config.yml").write_text("maintenance-enabled: false\n")
        jar(plugins / "core-1.0.0.jar")
        startup(logs)
        roots[server] = plugins, logs

    def console(server, command):
        commands.append((server, command))
        plugins, logs = roots[server]
        if command in {"maintenance on", "maintenance off"}:
            (plugins / "Maintenance" / "config.yml").write_text(f"maintenance-enabled: {str(command.endswith('on')).lower()}\n")
        if command == "save-all flush":
            with (logs / "latest.log").open("a") as handle:
                handle.write("[06:00:04 INFO]: Saved the game\n")
        if command == "stop":
            (logs / "latest.log").rename(logs / "old.log")
            jars = inventory.read_jars(plugins)
            startup(logs, jars[0].version)

    instance = host.Controller(tmp_path / "state", roots, console=console)
    instance.commands = commands
    return instance


def ready_job(controller, plan):
    job = {"id": plan["id"], "server": plan["server"], "phase": "countdown" if plan["server"] == "main" else "installing", "deadline": 0,
           "maintenance_started": False, "error": None, "events": [], "changes": plan["changes"]}
    controller.jobs[plan["server"]] = job
    return job


def test_restart_saves_then_stops_then_verifies_then_reopens(controller):
    public = controller.plan("main", "restart", [])
    plan = controller._plan(public["id"])
    job = ready_job(controller, plan)
    controller.run(plan)
    assert job["phase"] == "complete"
    commands = [c for _, c in controller.commands]
    assert commands.index("maintenance on") < commands.index("save-all flush") < commands.index("stop") < commands.index("maintenance off")
    assert commands.count("stop") == 1
    assert len([c for c in commands if "Finish what you are doing" in c]) == 5
    assert json.loads((controller.state / "jobs.json").read_text())["main"]["phase"] == "complete"


def test_release_install_has_verified_backup_and_one_runtime_jar(controller, tmp_path):
    new = tmp_path / "new.jar"
    sha = jar(new, version="2.0.0")
    controller.fetch = lambda release, target: target.write_bytes(new.read_bytes())
    public = controller.plan("dev", "latest", [{"repo": "Core", "tag": "v2.0.0", "asset": "core-2.0.0.jar", "sha256": sha, "known": [{"sha256": controller.snapshot("dev")[0]["sha256"], "version": "1.0.0"}]}])
    plan = controller._plan(public["id"])
    old = plan["baseline"][0]["sha256"]
    job = ready_job(controller, plan)
    controller.run(plan)
    assert job["phase"] == "complete"
    assert host.digest(controller.state / plan["id"] / "backup" / "core-1.0.0.jar") == old
    assert [p.name for p in controller.roots["dev"][0].glob("*.jar")] == ["core-2.0.0.jar"]


def test_changed_same_size_same_mtime_file_aborts_before_writes(controller):
    public = controller.plan("main", "restart", [])
    plan = controller._plan(public["id"])
    path = controller.roots["main"][0] / "core-1.0.0.jar"
    stamp = path.stat()
    content = path.read_bytes()
    path.write_bytes(content[:-1] + bytes([content[-1] ^ 1]))
    import os
    os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    job = ready_job(controller, plan)
    controller.run(plan)
    assert job["phase"] == "failed" and job["error"] == "plugins_changed"
    assert not job["maintenance_started"]
    assert not any(command in {"stop", "maintenance on"} for _, command in controller.commands)


def test_countdown_cancel_and_duplicate_start_are_safe(controller, monkeypatch):
    class NoWorker:
        def __init__(self, **_): pass
        def start(self): pass
    monkeypatch.setattr(host.threading, "Thread", NoWorker)
    plan = controller.plan("main", "restart", [])
    first = controller.start("main", plan["id"], "site-user:1", "test restart", "test backup")
    assert controller.start("main", plan["id"], "site-user:1", "test restart", "test backup")["id"] == first["id"]
    with pytest.raises(control.ControlError, match="server_job_active"):
        controller.plan("dev", "restart", [])
    assert controller.cancel("main", first["id"])["phase"] == "cancelled"
    controller.run(controller._plan(plan["id"]))
    assert not any(c == "stop" for _, c in controller.commands)


def test_crash_is_not_replayed_and_checks_block_reopen(controller):
    plan = controller.plan("main", "restart", [])
    job = ready_job(controller, controller._plan(plan["id"]))
    job.update(phase="checking", maintenance_started=True)
    controller._save()
    recovered = host.Controller(controller.state, controller.roots, console=controller.console)
    assert recovered.jobs["main"]["error"] == "helper_interrupted"
    startup(controller.roots["main"][1], error=True)
    with pytest.raises(control.ControlError, match="startup_check_failed"):
        recovered.reopen("main", job["id"])
    assert not any(c == "maintenance off" for _, c in controller.commands)


def test_release_checksum_and_identity_and_path_rejected(controller, tmp_path):
    new = tmp_path / "new.jar"
    sha = jar(new, name="Different", version="2.0.0")
    controller.fetch = lambda release, target: target.write_bytes(new.read_bytes())
    release = {"repo": "Core", "tag": "v2.0.0", "asset": "core-2.0.0.jar", "sha256": sha, "known": [{"sha256": controller.snapshot("dev")[0]["sha256"], "version": "1.0.0"}]}
    with pytest.raises(control.ControlError, match="release_identity_failed"):
        controller.plan("dev", "latest", [release])
    with pytest.raises(control.ControlError, match="release_identity_failed"):
        controller.plan("dev", "latest", [{**release, "sha256": "0" * 64}])
    with pytest.raises(control.ControlError, match="bad_release"):
        controller.plan("dev", "latest", [{**release, "asset": "../evil.jar"}])
    with pytest.raises(control.ControlError, match="bad_control_request"):
        controller.dispatch({"operation": "console", "server": "main", "command": "stop"})


def test_pending_update_and_symlink_refused(controller, tmp_path):
    plugins, _ = controller.roots["dev"]
    (plugins / "update").mkdir()
    jar(plugins / "update" / "core-2.0.0.jar", version="2.0.0")
    with pytest.raises(control.ControlError):
        controller.plan("dev", "restart", [])
    (plugins / "update" / "core-2.0.0.jar").unlink()
    (plugins / "link.jar").symlink_to(tmp_path / "outside")
    with pytest.raises(control.ControlError, match="unsafe_plugin_file"):
        controller.plan("dev", "restart", [])


def test_socket_transport_and_invalid_message(tmp_path, monkeypatch):
    class Fake:
        def dispatch(self, body):
            assert body == {"operation": "status"}
            return {"jobs": []}
    path = tmp_path / "control.sock"
    with host.Server(str(path), host.Handler) as server:
        server.controller = Fake()
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        monkeypatch.setenv("SERVER_CONTROL_SOCKET", str(path))
        assert control.status() == {"status": "available", "jobs": [], "allowed_servers": ["dev", "main"]}
        server.shutdown()
        worker.join()


@pytest.fixture
def app(database, monkeypatch):
    from src.api import admin_routes, auth_routes
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", "https://www.tfminecraft.net")
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    app = FastAPI()
    app.include_router(auth_routes.auth_router)
    admin_routes.install(app)
    return app


def test_write_requires_admin_session_origin_reason_and_logs_actor(app, database, monkeypatch):
    calls = []
    monkeypatch.setattr(control, "request", lambda op, **body: calls.append((op, body)) or {"id": body["plan_id"]})
    _, mod = account(database, "mod", "mod")
    user_id, admin = account(database, "admin", "admin")
    _, root = account(database, "owner", "root")
    body = {"id": "a" * 32, "reason": "scheduled restart"}
    url = "/admin/servers/main/start"
    assert client(app).post(url, json=body, headers=ORIGIN).status_code == 401
    assert client(app, mod).post(url, json=body, headers=ORIGIN).status_code == 403
    assert client(app, admin).post(url, json=body).status_code == 403
    assert client(app, admin).post(url, json={**body, "reason": "x"}, headers=ORIGIN).status_code == 400
    assert not calls
    result = client(app, admin).post(url, json=body, headers=ORIGIN)
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    assert calls[0][1]["actor"] == f"www.tfminecraft.net:user:{user_id}"
    assert client(app, root).post(url, json=body, headers=ORIGIN).status_code == 200
    assert [r["outcome"] for r in audit_rows(database)][-4:] == ["requested", "ok", "requested", "ok"]


def test_demoted_or_revoked_session_cannot_reach_helper(app, database, monkeypatch):
    monkeypatch.setattr(control, "request", lambda *_args, **_kwargs: pytest.fail("helper called"))
    user_id, token = account(database, "demoted", "admin")
    with database.connect() as conn:
        conn.execute("UPDATE users SET role='mod' WHERE id=?", (user_id,))
        conn.commit()
    body = {"id": "b" * 32, "reason": "testing role"}
    assert client(app, token).post("/admin/servers/dev/cancel", json=body, headers=ORIGIN).status_code == 403
    with database.connect() as conn:
        conn.execute("DELETE FROM user_sessions WHERE user_id=?", (user_id,))
        conn.commit()
    assert client(app, token).post("/admin/servers/dev/cancel", json=body, headers=ORIGIN).status_code == 401


def release_for(controller, sha, version="2.0.0", server="dev"):
    return {"repo": "Core", "tag": "v" + version, "asset": "core-" + version + ".jar", "sha256": sha,
            "known": [{"sha256": controller.snapshot(server)[0]["sha256"], "version": "1.0.0"}]}


def test_unknown_build_and_backport_are_skipped(controller):
    release = release_for(controller, "0" * 64)
    plan = controller.plan("dev", "latest", [{**release, "known": []}])
    assert plan["changes"] == [] and plan["skipped"][0]["reason"] == "test_or_unknown_build"
    backport = release_for(controller, "0" * 64, version="0.9.0")
    plan = controller.plan("dev", "latest", [backport])
    assert plan["changes"] == [] and plan["skipped"][0]["reason"] == "not_a_newer_version"


def test_main_requires_dev_evidence_backup_and_feature_review(controller, tmp_path, monkeypatch):
    new = tmp_path / "new.jar"
    sha = jar(new, version="2.0.0")
    release = release_for(controller, sha, server="main")
    plan = controller.plan("main", "latest", [release])
    assert plan["skipped"][0]["reason"] == "not_verified_on_dev"
    monkeypatch.setattr(controller, "_dev_verified", lambda *_: True)
    controller.fetch = lambda release, target: target.write_bytes(new.read_bytes())
    plan = controller.plan("main", "latest", [release])
    with pytest.raises(control.ControlError, match="backup_required"):
        controller.start("main", plan["id"], "www:user:1", "update releases")
    job = ready_job(controller, controller._plan(plan["id"]))
    controller.run(controller._plan(plan["id"]))
    assert job["phase"] == "awaiting_review"
    assert not any(c == "maintenance off" for _, c in controller.commands)
    assert controller.reopen("main", job["id"])["phase"] == "complete"


def test_known_boot_errors_allow_restart_new_errors_block(controller):
    logs = controller.roots["dev"][1]
    startup(logs, error=True)
    plan = controller.plan("dev", "restart", [])
    assert controller._startup_ok(controller._plan(plan["id"]))
    with (logs / "latest.log").open("r+") as f:
        text = f.read().replace("[06:00:03 INFO]: Done", "[06:00:02 ERROR]: new problem\n[06:00:03 INFO]: Done")
        f.seek(0)
        f.write(text)
        f.truncate()
    assert not controller._startup_ok(controller._plan(plan["id"]))


def test_partial_install_restores_every_old_file(controller, tmp_path, monkeypatch):
    import shutil
    plugins, _ = controller.roots["dev"]
    old_sha = jar(plugins / "other-1.0.0.jar", name="Other")
    new_core, new_other = tmp_path / "new-core.jar", tmp_path / "new-other.jar"
    sha = jar(new_core, version="2.0.0")
    other_sha = jar(new_other, name="Other", version="2.0.0")
    releases = [release_for(controller, sha), {"repo": "Other", "tag": "v2.0.0", "asset": "other-2.0.0.jar", "sha256": other_sha,
                "known": [{"sha256": old_sha, "version": "1.0.0"}]}]
    controller.fetch = lambda r, p: p.write_bytes((new_core if r["repo"] == "Core" else new_other).read_bytes())
    public = controller.plan("dev", "latest", releases)
    plan = controller._plan(public["id"])
    original = shutil.copyfile
    def copy(source, target, *args, **kwargs):
        if target.name.startswith(".control-") and source.name == "other-2.0.0.jar":
            target.write_bytes(b"corrupted")
            return target
        return original(source, target, *args, **kwargs)
    monkeypatch.setattr(host.shutil, "copyfile", copy)
    with pytest.raises(control.ControlError, match="release_checksum_failed"):
        controller._install(plan)
    assert controller.snapshot("dev") == plan["baseline"]


def test_resolve_does_not_issue_commands_and_other_server_remains_usable(controller):
    public = controller.plan("dev", "restart", [])
    job = ready_job(controller, controller._plan(public["id"]))
    job.update(phase="failed", maintenance_started=True)
    controller._save()
    controller.plan("main", "restart", [])
    commands = list(controller.commands)
    assert controller.resolve("dev", job["id"])["phase"] == "resolved"
    assert controller.commands == commands


def test_scheduler_blackouts_cross_midnight_and_cover_restart_window():
    from datetime import datetime, timezone
    def stamp(value): return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()
    assert host.scheduled_restart("main", stamp("2026-10-12T05:10:00"))
    assert host.scheduled_restart("main", stamp("2026-10-12T06:15:00"))
    assert not host.scheduled_restart("main", stamp("2026-10-12T08:00:00"))
    assert host.scheduled_restart("dev", stamp("2026-10-12T23:40:00"))
    assert host.scheduled_restart("dev", stamp("2026-10-12T00:10:00"))
    assert not host.scheduled_restart("dev", stamp("2026-10-12T01:00:00"))


def test_dev_socket_cannot_control_main(tmp_path, monkeypatch):
    class Fake:
        def dispatch(self, body): pytest.fail("Main control reached")
    path = tmp_path / "dev.sock"
    with host.Server(str(path), host.Handler) as server:
        server.allowed_servers = {"dev"}
        server.controller = Fake()
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        monkeypatch.setenv("SERVER_CONTROL_SOCKET", str(path))
        with pytest.raises(control.ControlError, match="server_not_allowed"):
            control.request("plan", server="main", mode="restart", releases=[])
        server.shutdown()
        worker.join()


def test_cancelling_failed_dev_job_does_not_cancel_active_main(controller):
    dev = controller.plan("dev", "restart", [])
    dev_job = ready_job(controller, controller._plan(dev["id"]))
    dev_job.update(phase="failed", deadline=1)
    main = controller.plan("main", "restart", [])
    ready_job(controller, controller._plan(main["id"]))
    assert not controller.cancelled.is_set()
    controller.cancel("dev", dev_job["id"])
    assert not controller.cancelled.is_set()


def test_accepted_journal_recovers_missing_index_and_is_not_replayed(controller):
    public = controller.plan("dev", "restart", [])
    job = ready_job(controller, controller._plan(public["id"]))
    job["deadline"] = 10
    host.save_json(controller.state / job["id"] / "job.json", job)
    recovered = host.Controller(controller.state, controller.roots, console=controller.console)
    assert recovered.jobs["dev"]["id"] == job["id"]
    assert recovered.jobs["dev"]["phase"] == "failed"
    assert recovered.start("dev", job["id"], "www:user:1", "retry after disconnect")["phase"] == "failed"
    assert not any(c == "stop" for _, c in controller.commands)


@pytest.mark.parametrize("server,override", [("dev", False), ("main", True)])
@pytest.mark.parametrize("mode", ["restart", "latest"])
def test_instant_restarts_skip_warnings_but_save_verify_and_stop(controller, monkeypatch, tmp_path, server, override, mode):
    monkeypatch.setattr(host.threading.Thread, "start", lambda _: None)
    releases = []
    if mode == "latest":
        path = tmp_path / "new-instant.jar"
        sha = jar(path, version="2.0.0")
        releases = [release_for(controller, sha, server=server)]
        controller.fetch = lambda release, target: target.write_bytes(path.read_bytes())
        monkeypatch.setattr(controller, "_dev_verified", lambda *_: True)
    public = controller.plan(server, mode, releases)
    result = controller.start(server, public["id"], "www:user:1", "emergency fix" if override else "Dev test", "test backup" if server == "main" else "", override)
    assert result["phase"] == "installing"
    assert result["deadline"] == result["accepted_at"]
    assert result["emergency_override"] is override
    with pytest.raises(control.ControlError, match="cannot_cancel"):
        controller.cancel(server, public["id"])
    monkeypatch.setattr(controller.cancelled, "wait", lambda delay: pytest.fail("countdown delay") if delay > 0 else False)
    controller.run(controller._plan(public["id"]))
    commands = [c for _, c in controller.commands]
    assert not any("Finish what you are doing" in c for c in commands)
    assert commands.index("maintenance on") < commands.index("save-all flush") < commands.index("stop")
    assert controller.jobs[server]["phase"] == ("awaiting_review" if server == "main" and mode == "latest" else "complete")


def test_main_default_still_has_five_minute_countdown(controller, monkeypatch):
    monkeypatch.setattr(host.threading.Thread, "start", lambda _: None)
    plan = controller.plan("main", "restart", [])
    result = controller.start("main", plan["id"], "www:user:1", "planned restart", "test backup")
    assert result["phase"] == "countdown" and result["emergency_override"] is False
    assert result["deadline"] - result["accepted_at"] == 300


def test_emergency_override_is_main_only_and_requires_a_backup(controller, monkeypatch):
    monkeypatch.setattr(host.threading.Thread, "start", lambda _: None)
    plan = controller.plan("main", "restart", [])
    with pytest.raises(control.ControlError, match="backup_required"):
        controller.start("main", plan["id"], "www:user:1", "emergency fix", emergency_override=True)
    dev = controller.plan("dev", "restart", [])
    with pytest.raises(control.ControlError, match="bad_server_action"):
        controller.start("dev", dev["id"], "www:user:1", "Dev test", emergency_override=True)


def test_emergency_flag_is_strict_audited_and_forwarded(app, database, monkeypatch):
    calls=[]
    monkeypatch.setattr(control, "request", lambda op, **body: calls.append(body) or {"id": body["plan_id"]})
    _, admin = account(database, "instant-admin", "admin")
    body = {"id": "c"*32, "reason": "emergency plugin fix", "backup_ref": "prepared backup", "emergency_override": True}
    assert client(app, admin).post("/admin/servers/main/start", json=body, headers=ORIGIN).status_code == 200
    assert calls[-1]["emergency_override"] is True
    assert json.loads(audit_rows(database)[-1]["detail_json"])["emergency_override"] is True
    assert client(app, admin).post("/admin/servers/main/start", json={**body,"emergency_override":"false"}, headers=ORIGIN).status_code == 422
    assert client(app, admin).post("/admin/servers/dev/start", json=body, headers=ORIGIN).status_code == 400
    assert len(calls) == 1


def test_recovery_orders_instant_jobs_by_acceptance_not_deadline(controller):
    legacy = controller.plan("dev", "restart", [])
    old = ready_job(controller, controller._plan(legacy["id"]))
    old.update(phase="complete", deadline=600)  # legacy acceptance was 300
    controller._save()
    instant = controller.plan("dev", "restart", [])
    new = ready_job(controller, controller._plan(instant["id"]))
    new.update(accepted_at=400, deadline=400)
    controller._save()
    recovered = host.Controller(controller.state, controller.roots, console=controller.console)
    assert recovered.jobs["dev"]["id"] == new["id"]
    assert recovered.jobs["dev"]["phase"] == "failed"
