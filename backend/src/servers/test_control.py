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


def test_backport_is_skipped(controller):
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


@pytest.mark.parametrize("zone,written,boot,after", [
    ("Etc/UTC", "2026-10-13T00:02:00+00:00", "23:59:00", "2026-10-13T00:01:00+00:00"),
    ("America/New_York", "2026-10-13T04:02:00+00:00", "23:59:00", "2026-10-13T04:01:00+00:00"),
])
def test_dev_bytes_replaced_after_midnight_boot_are_not_verified(controller, monkeypatch, zone, written, boot, after):
    import os
    from datetime import datetime
    from types import SimpleNamespace
    monkeypatch.setenv("SERVER_CONTROL_LOG_TIMEZONE", zone)
    plugins, logs = controller.roots["dev"]
    log = logs / "latest.log"
    log.write_text(f"[{boot}] [ServerMain/INFO]: [bootstrap] Loading Paper 1.21.10\n"
                   "[00:00:00] [Server thread/INFO]: [Core] Enabling Core v1.0.0\n"
                   "[00:00:01] [Server thread/INFO]: Done (1s)!\n")
    stamp = datetime.fromisoformat(written).timestamp()
    os.utime(log, (stamp, stamp))
    jar_path = plugins / "core-1.0.0.jar"
    jar_time = datetime.fromisoformat(after).timestamp()
    original = host.Path.stat
    monkeypatch.setattr(host.Path, "stat", lambda path, *args, **kwargs: SimpleNamespace(st_mtime=jar_time, st_ctime=jar_time) if path == jar_path else original(path, *args, **kwargs))
    monkeypatch.setattr(controller, "snapshot", lambda *_: [{"file": jar_path.name, "name": "Core", "version": "1.0.0", "sha256": "known"}])
    assert not controller._dev_verified({"sha256": "known"})
    jar_time = datetime.fromisoformat(after).timestamp() - 180
    assert controller._dev_verified({"sha256": "known"})


def test_known_error_repetition_and_thread_numbers_do_not_block_reopen(controller):
    logs = controller.roots['main'][1]
    def write_errors(count, thread, extra=''):
        startup(logs)
        path = logs / 'latest.log'
        errors = '[06:00:02] [Server thread/ERROR]: [MythicMobs] [SCHEDULER] Exception thrown whilst executing task\n' * count
        errors += f'[06:00:02] [Craft Scheduler Thread - {thread}/ERROR]: [MCPets] Known failure\n'
        path.write_text(path.read_text().replace('[06:00:03 INFO]: Done', errors + extra + '[06:00:03 INFO]: Done'))
    write_errors(2, 19)
    public = controller.plan('main', 'restart', [])
    plan = controller._plan(public['id'])
    job = ready_job(controller, plan)
    job.update(phase='failed', maintenance_started=True)
    controller.console('main', 'maintenance on')
    write_errors(3, 27)
    assert controller.reopen('main', job['id'])['phase'] == 'complete'
    write_errors(3, 27, '[06:00:02] [Server thread/ERROR]: [Core] New failure\n')
    assert not controller._startup_ok(plan)


@pytest.mark.parametrize('server,override', [('main', False), ('main', True), ('dev', False)])
def test_staged_main_activation_waits_for_review(controller, server, override):
    plugins, _ = controller.roots[server]
    jar(plugins / 'core-1.0.0.jar', version='2.0.0')
    public = controller.plan(server, 'restart', [])
    assert public['changes'] == []
    assert public['activation'] == [{'name': 'Core', 'loaded': '1.0.0', 'version': '2.0.0'}]
    plan = controller._plan(public['id'])
    job = ready_job(controller, plan)
    if override:
        job.update(phase='installing', emergency_override=True)
    controller.run(plan)
    assert job['phase'] == ('awaiting_review' if server == 'main' else 'complete')
    if server == 'main':
        assert not any(c == 'maintenance off' for _, c in controller.commands)
        assert controller.reopen(server, job['id'])['phase'] == 'complete'


def test_known_failed_enable_does_not_prove_dev_release_but_allows_unchanged_restart(controller):
    import os
    from datetime import datetime, timezone
    plugins, logs = controller.roots['dev']
    boot = datetime.fromtimestamp(host.time.time() + 60, timezone.utc).strftime('%H:%M:%S')
    text = (f'[{boot}] [ServerMain/INFO]: [bootstrap] Loading Paper 1.21.10\n'
            f'[{boot}] [Server thread/INFO]: [Core] Enabling Core v1.0.0\n'
            f'[{boot}] [Server thread/INFO]: Done (1s)!\n')
    path = logs / 'latest.log'
    stamp = host.time.time() + 120
    path.write_text(text)
    os.utime(path, (stamp, stamp))
    release = {'sha256': host.digest(plugins / 'core-1.0.0.jar')}
    assert controller._dev_verified(release)
    failed = f'[{boot}] [Server thread/ERROR]: Error occurred while enabling Core v1.0.0 (Is it up to date?)\n'
    path.write_text(text.replace(f'[{boot}] [Server thread/INFO]: Done', failed + f'[{boot}] [Server thread/INFO]: Done'))
    os.utime(path, (stamp, stamp))
    assert not controller._dev_verified(release)
    public = controller.plan('dev', 'restart', [])
    assert not public['activation']
    assert controller._startup_ok(controller._plan(public['id']))


def test_refused_job_action_records_failure_outcome(controller):
    public = controller.plan('dev', 'restart', [])
    job = ready_job(controller, controller._plan(public['id']))
    body = {'operation': 'cancel', 'server': 'dev', 'job_id': job['id'], 'actor': 'www:user:1', 'reason': 'stop this restart'}
    with pytest.raises(control.ControlError, match='cannot_cancel'):
        controller.dispatch(body)
    event = [e for e in json.loads((controller.state / job['id'] / 'job.json').read_text())['events'] if 'action' in e][-1]
    assert event['action'] == 'cancel' and event['outcome'] == 'failed' and event['error'] == 'cannot_cancel'
    job['phase'] = 'failed'
    controller.dispatch({**body, 'operation': 'resolve'})
    event = [e for e in json.loads((controller.state / job['id'] / 'job.json').read_text())['events'] if 'action' in e][-1]
    assert event['action'] == 'resolve' and event['outcome'] == 'ok'


@pytest.mark.parametrize('upgrade', [False, True])
def test_unchanged_known_plugin_failure_can_restart_but_upgrade_failure_cannot(controller, tmp_path, upgrade):
    logs = controller.roots['dev'][1]
    def fail_enable(version):
        path = logs / 'latest.log'
        line = f'[06:00:02 ERROR]: Error occurred while enabling Core v{version} (Is it up to date?)\n'
        path.write_text(path.read_text().replace('[06:00:03 INFO]: Done', line + '[06:00:03 INFO]: Done'))
    fail_enable('1.0.0')
    releases = []
    if upgrade:
        new = tmp_path / 'new.jar'
        sha = jar(new, version='2.0.0')
        controller.fetch = lambda release, target: target.write_bytes(new.read_bytes())
        releases = [release_for(controller, sha)]
    public = controller.plan('dev', 'latest' if upgrade else 'restart', releases)
    plan = controller._plan(public['id'])
    original_console = controller.console
    def console(server, command):
        original_console(server, command)
        if command == 'stop':
            fail_enable('2.0.0' if upgrade else '1.0.0')
    controller.console = console
    def immediate_check(predicate, timeout, code):
        if not predicate():
            raise control.ControlError(code)
    controller._wait = immediate_check
    job = ready_job(controller, plan)
    controller.run(plan)
    assert job['phase'] == ('failed' if upgrade else 'complete')
    assert controller._maintenance('dev') is upgrade


def test_newly_staged_plugin_without_a_prior_failure_still_requires_activation(controller):
    plugins, _ = controller.roots['main']
    jar(plugins / 'other-1.0.0.jar', name='Other')
    public = controller.plan('main', 'restart', [])
    assert public['activation'] == [{'name': 'Other', 'loaded': None, 'version': '1.0.0'}]
    assert not controller._startup_ok(controller._plan(public['id']))


@pytest.mark.parametrize('first,second', [
    ('Worker-Main-12', 'Worker-Main-15'), ('pool-3-thread-1', 'pool-5-thread-9'),
    ('ForkJoinPool.commonPool-worker-5', 'ForkJoinPool.commonPool-worker-9'),
    ('Netty Epoll #3', 'Netty Epoll #4'), ('Timer-0', 'Timer-2'),
])
def test_worker_identity_changes_do_not_mask_error_message_changes(first, second):
    key = host.Controller._error_key
    before = f'[TIME] [{first}/ERROR]: failure code 23'
    after = f'[TIME] [{second}/ERROR]: failure code 23'
    assert key(before) == key(after)
    assert key(before) != key(after.replace('code 23', 'code 24'))


def test_test_builds_are_replaced_only_when_chosen(controller, tmp_path, monkeypatch):
    monkeypatch.setattr(host.threading.Thread, "start", lambda _: None)
    plugins, _ = controller.roots["dev"]
    (plugins / "core-1.0.0.jar").unlink()
    jar(plugins / "core-stage4-abc.jar", version="3.0.0")
    new = tmp_path / "new.jar"
    release = {**release_for(controller, jar(new, version="2.0.0")), "known": []}
    controller.fetch = lambda release, target: target.write_bytes(new.read_bytes())
    plan = controller.plan("dev", "latest", [release])
    assert plan["skipped"] == []
    assert [(c["repo"], c["old_version"], c["test_build"], c["newer_test"]) for c in plan["changes"]] == [("Core", "3.0.0", True, True)]
    with pytest.raises(control.ControlError, match="bad_server_action"):
        controller.start("dev", plan["id"], "www:user:1", "Dev test", replace_test_builds=["Other"])
    kept = controller.start("dev", plan["id"], "www:user:1", "Dev test")
    assert kept["changes"] == []
    stored = controller._plan(plan["id"])
    assert stored["changes"] == [] and stored["skipped"] == [{"repo": "Core", "reason": "test_build_kept"}]

    controller.jobs.clear()
    plan = controller.plan("dev", "latest", [release])
    chosen = controller.start("dev", plan["id"], "www:user:1", "Dev test", replace_test_builds=["Core"])
    assert [c["repo"] for c in chosen["changes"]] == ["Core"]
    controller.run(controller._plan(plan["id"]))
    assert controller.jobs["dev"]["phase"] == "complete"
    assert [j["file"] for j in controller.snapshot("dev")] == ["core-2.0.0.jar"]


def test_main_test_build_still_needs_dev_evidence(controller, tmp_path):
    plugins, _ = controller.roots["main"]
    (plugins / "core-1.0.0.jar").unlink()
    jar(plugins / "core-1.0.0-SNAPSHOT.jar", version="1.0.0-SNAPSHOT")
    release = {**release_for(controller, "0" * 64, server="main"), "known": []}
    plan = controller.plan("main", "latest", [release])
    assert plan["changes"] == [] and plan["skipped"][0]["reason"] == "not_verified_on_dev"


def test_test_build_choice_is_start_only_and_forwarded(app, database, monkeypatch):
    calls = []
    monkeypatch.setattr(control, "request", lambda op, **body: calls.append(body) or {"id": body.get("plan_id")})
    _, admin = account(database, "test-build-admin", "admin")
    body = {"id": "d" * 32, "reason": "replace test builds", "replace_test_builds": ["Core"]}
    assert client(app, admin).post("/admin/servers/dev/start", json=body, headers=ORIGIN).status_code == 200
    assert calls[-1]["replace_test_builds"] == ["Core"]
    assert json.loads(audit_rows(database)[-1]["detail_json"])["replace_test_builds"] == ["Core"]
    assert client(app, admin).post("/admin/servers/dev/start", json={**body, "replace_test_builds": []}, headers=ORIGIN).status_code == 200
    assert "replace_test_builds" not in calls[-1]
    assert client(app, admin).post("/admin/servers/dev/cancel", json=body, headers=ORIGIN).status_code == 400
    assert len(calls) == 2


def test_socket_test_build_list_is_optional_and_checked(controller, monkeypatch):
    monkeypatch.setattr(host.threading.Thread, "start", lambda _: None)
    plan = controller.plan("dev", "restart", [])
    body = {"operation": "start", "server": "dev", "plan_id": plan["id"], "actor": "www:user:1", "reason": "Dev test",
            "backup_ref": "", "emergency_override": False}
    with pytest.raises(control.ControlError, match="bad_control_request"):
        controller.dispatch({**body, "replace_test_builds": "Core"})
    with pytest.raises(control.ControlError, match="bad_control_request"):
        controller.dispatch({**body, "operation": "cancel", "job_id": plan["id"], "replace_test_builds": []})
    assert controller.dispatch(body)["phase"] == "installing"


def test_recheck_after_midnight_reads_the_rotated_startup_log(controller, tmp_path, monkeypatch):
    import gzip
    new = tmp_path / "new.jar"
    release = release_for(controller, jar(new, version="2.0.0"), server="main")
    monkeypatch.setattr(controller, "_dev_verified", lambda *_: True)
    controller.fetch = lambda release, target: target.write_bytes(new.read_bytes())
    public = controller.plan("main", "latest", [release])
    job = ready_job(controller, controller._plan(public["id"]))
    controller.run(controller._plan(public["id"]))
    assert job["phase"] == "awaiting_review"
    logs = controller.roots["main"][1]
    with gzip.open(logs / "2026-10-12-1.log.gz", "wt") as handle:
        handle.write((logs / "latest.log").read_text())
    (logs / "latest.log").write_text("[00:00:05 INFO]: <Player> evening\n")
    assert controller.reopen("main", job["id"])["phase"] == "complete"


def test_countdown_zero_only_reserves_the_restart(controller, monkeypatch):
    windows = []
    monkeypatch.setattr(host, "scheduled_restart", lambda server, now, short=False: windows.append(short) or False)
    monkeypatch.setattr(controller.cancelled, "wait", lambda delay: False)
    public = controller.plan("main", "restart", [])
    ready_job(controller, controller._plan(public["id"]))
    controller.run(controller._plan(public["id"]))
    assert windows == [True]


def test_failed_countdown_tells_players_the_restart_is_off(controller, monkeypatch):
    monkeypatch.setattr(controller.cancelled, "wait", lambda delay: False)
    public = controller.plan("main", "restart", [])
    job = ready_job(controller, controller._plan(public["id"]))
    jar(controller.roots["main"][0] / "late-1.0.0.jar", name="Late")
    controller.run(controller._plan(public["id"]))
    assert job["phase"] == "failed" and job["error"] == "plugins_changed"
    assert controller.commands[-1] == ("main", "broadcast &eThe server restart has been cancelled.")
    assert not any(c == "maintenance on" for _, c in controller.commands)


def test_unreadable_jar_has_its_own_error(controller, monkeypatch):
    def unreadable(path):
        raise PermissionError(path)
    monkeypatch.setattr(host.inventory, "_describe", unreadable)
    with pytest.raises(control.ControlError, match="plugin_unreadable"):
        controller.snapshot("dev")


def test_accepted_job_with_its_own_error_field_is_not_a_refusal(tmp_path, monkeypatch):
    class Fake:
        def dispatch(self, body):
            if body["operation"] == "cancel":
                raise control.ControlError("cannot_cancel")
            return {"id": "e" * 32, "server": "dev", "phase": "installing", "error": None}
    path = tmp_path / "dev.sock"
    with host.Server(str(path), host.Handler) as server:
        server.allowed_servers = {"dev"}
        server.controller = Fake()
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        monkeypatch.setenv("SERVER_CONTROL_SOCKET", str(path))
        assert control.request("start", server="dev", plan_id="e" * 32)["phase"] == "installing"
        with pytest.raises(control.ControlError, match="cannot_cancel") as refused:
            control.request("cancel", server="dev", job_id="e" * 32)
        assert refused.value.status == 409
        server.shutdown()
        worker.join()
