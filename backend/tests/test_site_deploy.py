"""Drive the real deployment shell with isolated host/Compose fault injection."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

OLD, NEW = "a" * 40, "b" * 40
SOURCE = Path(__file__).resolve().parents[2] / "scripts" / "site-deploy.sh"


@pytest.fixture
def host(tmp_path):
    binary = tmp_path / "bin"
    binary.mkdir()
    (tmp_path / "ProvinceSystem").mkdir()
    data = tmp_path / "provincesystem-data" / "data"
    data.mkdir(parents=True)
    with sqlite3.connect(data / "province.db") as conn:
        conn.execute("CREATE TABLE content(value text)")
        conn.execute("INSERT INTO content VALUES ('preserve')")
    (tmp_path / "head").write_text(OLD)
    shim = """import json, os, pathlib, sys
root=pathlib.Path(os.environ['DEPLOY_TEST_ROOT']); args=sys.argv[1:]; tool=pathlib.Path(sys.argv[0]).name
head=(root/'head').read_text(); old='a'*40; new='b'*40
with (root/'trace').open('a') as log: log.write(json.dumps([tool,head,args])+'\\n')
if tool=='id':
 print('tfmc' if args==['-un'] else '1001');sys.exit(0)
if tool=='sleep': sys.exit(0)
if tool=='curl': sys.exit(1 if os.environ.get('FAIL_HEALTH') and head==new else 0)
if tool=='git':
 if args[0]=='rev-parse': print(head)
 elif args[0] in ('reset','checkout'): (root/'head').write_text(args[-1])
 elif args[:2]==['diff','--name-only']: print('backend/server.py')
 elif args[0]=='cat-file': sys.exit(0 if args[-1].startswith(new) else 1)
 sys.exit(0)
if tool=='ps-compose':
 args=args[1:]; data=root/'provincesystem-data'/'data'; marker=data/'.postgres-authority.json'
 if args[0]=='exec': print('private-postgres-dump')
 if args[0]=='run':
  command=args[-1]
  if command=='prepare': marker.write_text('{}')
  if command=='studio' and os.environ.get('FAIL_STUDIO'): sys.exit(1)
  if command=='rollback':
   if os.environ.get('FAIL_EXPORT'): sys.exit(1)
   marker.unlink()
 sys.exit(0)
raise SystemExit('unexpected host command')
"""
    for tool in ("git", "id", "curl", "sleep", "ps-compose"):
        path = binary / tool
        path.write_text(f"#!{sys.executable}\n" + shim)
        path.chmod(0o755)
    script = tmp_path / "site-deploy"
    script.write_text(SOURCE.read_text().replace("/home/tfmc", str(tmp_path))
                      .replace("/usr/local/sbin/ps-compose", str(binary / "ps-compose"))
                      .replace("SECONDS + 180", "SECONDS + 1"))

    def run(target=NEW, **faults):
        env = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}",
               "DEPLOY_TEST_ROOT": str(tmp_path), **faults}
        result = subprocess.run(["bash", str(script), "deploy", "www", target], env=env,
                                capture_output=True, text=True, timeout=20)
        trace = [json.loads(line) for line in (tmp_path / "trace").read_text().splitlines()]
        return result, trace

    return tmp_path, data, run


def commands(trace):
    return [(head, args[1:]) for tool, head, args in trace if tool == "ps-compose"]


def test_forward_builds_before_stopping_and_copies_before_serving(host):
    root, data, run = host
    result, trace = run()
    assert result.returncode == 0, result.stderr
    calls = commands(trace)
    build = next(i for i, (_, args) in enumerate(calls) if args[0] == "build")
    stop = next(i for i, (_, args) in enumerate(calls) if args[0] == "stop")
    prepare = next(i for i, (_, args) in enumerate(calls) if args[-1] == "prepare")
    serve = next(i for i, (_, args) in enumerate(calls) if args[:2] == ["up", "-d"] and "backend" in args)
    assert build < stop < prepare < serve
    assert (data / ".postgres-authority.json").exists()
    backups = list((root / "provincesystem-data" / "deploy-backups").iterdir())
    assert len(backups) == 2 and all(path.stat().st_mode & 0o077 == 0 for path in backups)


def test_failed_cutover_exports_before_legacy_code_returns(host):
    root, data, run = host
    result, trace = run(FAIL_STUDIO="1")
    assert result.returncode == 5
    calls = commands(trace)
    exported = next(i for i, (_, args) in enumerate(calls) if args[-1] == "rollback")
    legacy_start = next(i for i, (head, args) in enumerate(calls)
                        if head == OLD and args[:2] == ["up", "-d"] and "backend" in args)
    assert exported < legacy_start
    assert (root / "head").read_text() == OLD
    assert not (data / ".postgres-authority.json").exists()


def test_failed_reverse_export_keeps_backend_stopped(host):
    root, data, run = host
    result, trace = run(FAIL_HEALTH="1", FAIL_EXPORT="1")
    assert result.returncode == 5
    assert (root / "head").read_text() == NEW
    assert (data / ".postgres-authority.json").exists()
    calls = commands(trace)
    assert not any(head == OLD and args[0] == "up" and "backend" in args for head, args in calls)
    assert calls[-2][1] == ["stop", "backend"]
    assert calls[-1][1][-1] == "rollback"


def test_explicit_legacy_downgrade_exports_using_current_native_image(host):
    root, data, run = host
    (root / "head").write_text(NEW)
    (data / ".postgres-authority.json").write_text("{}")
    result, trace = run(target=OLD)
    assert result.returncode == 0, result.stderr
    calls = commands(trace)
    assert next(head for head, args in calls if args[-1] == "rollback") == NEW
    assert (root / "head").read_text() == OLD
    assert not (data / ".postgres-authority.json").exists()


def test_failed_explicit_downgrade_export_keeps_native_backend_stopped(host):
    root, data, run = host
    (root / "head").write_text(NEW)
    (data / ".postgres-authority.json").write_text("{}")
    result, trace = run(target=OLD, FAIL_EXPORT="1")
    assert result.returncode == 5
    assert (root / "head").read_text() == NEW
    assert (data / ".postgres-authority.json").exists()
    assert not any(args[0] == "up" and "backend" in args for _, args in commands(trace))


@pytest.mark.parametrize("copied", [False, True])
def test_interrupted_checkout_resumes_instead_of_claiming_success(host, copied):
    root, data, run = host
    (root / "head").write_text(NEW)
    (root / ".site-deployed-www").write_text(OLD)
    if copied:
        (data / ".postgres-authority.json").write_text("{}")
    result, trace = run()
    assert result.returncode == 0, result.stderr
    assert any(args[-1] == "prepare" for _, args in commands(trace))
    assert (root / ".site-deployed-www").read_text().strip() == NEW
