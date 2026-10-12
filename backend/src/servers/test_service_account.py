import importlib.util
import json
from pathlib import Path

import pytest


def load_script(name):
    path = Path(__file__).resolve().parents[3] / "scripts" / name
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


wrapper = load_script("server-control-command.py")
installer = load_script("server-control-install.py")


@pytest.mark.parametrize("server", ["main", "dev"])
@pytest.mark.parametrize("message", sorted(wrapper.COMMANDS))
def test_wrapper_executes_only_fixed_console_arguments(monkeypatch, server, message):
    captured = []
    monkeypatch.setattr(wrapper.os, "execv", lambda *args: captured.append(args))
    wrapper.main([server, message])
    assert captured == [("/usr/local/sbin/amp-ctl", ["/usr/local/sbin/amp-ctl", "console", wrapper.INSTANCES[server], message])]


@pytest.mark.parametrize("args", [[], ["main"], ["other", "stop"], ["main", "restart"],
    ["main", "reload"], ["main", "op attacker"], ["main", "stop\nlist"],
    ["main", "stop; id"], ["main", "list", "stop"], ["main", "broadcast emergency;stop"]])
def test_wrapper_rejects_other_operations_and_injection(monkeypatch, args):
    monkeypatch.setattr(wrapper.os, "execv", lambda *_: pytest.fail("Rejected input executed"))
    with pytest.raises(SystemExit):
        wrapper.main(args)


def test_state_copy_preserves_jobs_plans_and_backup_bytes_and_retries(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    (old / "plan-id/backup").mkdir(parents=True)
    (old / "jobs.json").write_text(json.dumps({"main": {"phase": "complete", "actor": "www:user:3"}}))
    (old / "plan-id/plan.json").write_text('{"id":"immutable-plan"}')
    (old / "plan-id/backup/old.jar").write_bytes(b"original jar bytes")
    expected = installer.manifest(old)
    assert installer.copy_state(old, new) == expected
    assert installer.manifest(new) == expected
    assert installer.copy_state(old, new) == expected
    (new / "jobs.json").write_text('{"different":"job"}')
    with pytest.raises(RuntimeError, match="refusing to overwrite"):
        installer.copy_state(old, new)
    assert (new / "jobs.json").read_text() == '{"different":"job"}'


def test_state_copy_rejects_symlinks_without_touching_the_target(tmp_path):
    old, new, outside = tmp_path / "old", tmp_path / "new", tmp_path / "outside"
    old.mkdir()
    outside.write_text("preserve unrelated data")
    (old / "link").symlink_to(outside)
    with pytest.raises(RuntimeError, match="symlinks"):
        installer.copy_state(old, new)
    assert outside.read_text() == "preserve unrelated data" and not new.exists()


def test_upgrade_probe_can_expire_unaccepted_plans_but_must_preserve_job_evidence(tmp_path):
    import shutil
    accepted, expired = tmp_path / ("a" * 32), tmp_path / ("b" * 32)
    (accepted / "backup").mkdir(parents=True)
    expired.mkdir()
    (tmp_path / "jobs.json").write_text('{}')
    (accepted / "job.json").write_text('{"phase":"complete"}')
    (accepted / "plan.json").write_text('{"expires_at":0}')
    (accepted / "backup/old.jar").write_bytes(b"original plugin")
    (expired / "plan.json").write_text('{"expires_at":0}')
    (expired / "core-2.0.0.jar").write_bytes(b"downloaded release")
    expected = installer.manifest(tmp_path)
    (expired / "core-2.0.0.jar").unlink()
    with pytest.raises(RuntimeError, match="job evidence changed"):
        installer.verify_preserved_state(expected, installer.manifest(tmp_path))
    shutil.rmtree(expired)
    installer.verify_preserved_state(expected, installer.manifest(tmp_path))
    (accepted / "backup/old.jar").unlink()
    with pytest.raises(RuntimeError, match="job evidence changed"):
        installer.verify_preserved_state(expected, installer.manifest(tmp_path))


def test_busy_migration_is_refused_before_copy_or_stop(tmp_path, monkeypatch):
    (tmp_path / "state").mkdir()
    for phase in installer.BUSY:
        (tmp_path / "state/jobs.json").write_text(json.dumps({"main": {"phase": phase}}))
        with pytest.raises(RuntimeError, match="Finish active restarts"):
            installer.assert_idle(tmp_path, tmp_path / "control.sock", False)
    monkeypatch.setattr(installer, "rpc", lambda path: {"jobs": [{"phase": "countdown"}]})
    with pytest.raises(RuntimeError, match="Finish active restarts"):
        installer.assert_idle(tmp_path, tmp_path / "control.sock", True)


def test_installer_requires_administrator_without_running_commands(monkeypatch):
    monkeypatch.setattr(installer.os, "geteuid", lambda: 1002)
    monkeypatch.setattr(installer, "command", lambda *_args, **_kw: pytest.fail("Host command ran"))
    with pytest.raises(SystemExit, match="host administrator"):
        installer.main()


def test_acl_scope_keeps_config_write_and_backup_contents_ungranted(tmp_path, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(installer, "INSTANCES", tmp_path / "instances")
    calls = []
    def command(*args, **_):
        calls.append(args)
        return SimpleNamespace(stdout="[]", returncode=0)
    monkeypatch.setattr(installer, "command", command)
    for name in ("TFMCMain01", "TFMCDev01"):
        root = installer.INSTANCES / name
        (root / "Minecraft/plugins/Maintenance").mkdir(parents=True)
        (root / "Minecraft/plugins/test.jar").write_bytes(b"already readable")
        (root / "Minecraft/plugins/Maintenance/config.yml").write_text("maintenance-enabled: false")
        (root / "Minecraft/logs").mkdir()
        (root / "Backups").mkdir()
        (root / "Backups/world.zip").write_bytes(b"private world backup")
    installer.grant_access()
    recursive = [args for args in calls if args[0] == "setfacl" and "-R" in args]
    assert len(recursive) == 2 and all(str(args[-1]).endswith("Minecraft/logs") for args in recursive)
    assert all("r--" in args[2] for args in calls if args[0] == "setfacl" and str(args[-1]).endswith("config.yml"))
    assert all(args[2].endswith(":---") for args in calls if args[0] == "setfacl" and str(args[-1]).endswith("world.zip"))
    assert not any(args[0] == "setfacl" and str(args[-1]).endswith("test.jar") for args in calls)
