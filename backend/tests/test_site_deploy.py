"""Drive the real deployment shell with isolated host/Compose fault injection."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

OLD, NEW = "a" * 40, "b" * 40
SOURCE = Path(__file__).resolve().parents[2] / "scripts" / "site-deploy.sh"


def image_tag(site, service, revision):
    return f"tfmc-site-{site}-{service}:{revision}"


def image_id(tag):
    return "sha256:" + hashlib.sha256(tag.encode()).hexdigest()


def set_running(root, revision, site="www"):
    tags = {service: image_tag(site, service, revision) for service in ("backend", "frontend")}
    (root / f"images-{site}.json").write_text(json.dumps({tag: image_id(tag) for tag in tags.values()}))
    (root / f"containers-{site}.json").write_text(json.dumps({service: image_id(tag) for service, tag in tags.items()}))


@pytest.fixture
def host(tmp_path):
    binary = tmp_path / "bin"
    binary.mkdir()
    (tmp_path / "ProvinceSystem").mkdir()
    (tmp_path / "tfmc-staging").mkdir()
    data = tmp_path / "provincesystem-data" / "data"
    data.mkdir(parents=True)
    with sqlite3.connect(data / "province.db") as conn:
        conn.execute("CREATE TABLE content(value text)")
        conn.execute("INSERT INTO content VALUES ('preserve')")
    (tmp_path / "head").write_text(OLD)
    shim = """import hashlib, json, os, pathlib, sys
root=pathlib.Path(os.environ['DEPLOY_TEST_ROOT']); args=sys.argv[1:]; tool=pathlib.Path(sys.argv[0]).name
head=(root/'head').read_text(); old='a'*40; new='b'*40
site=os.environ.get('DEPLOY_TEST_SITE', 'www')
images_file=root/f'images-{site}.json'; containers_file=root/f'containers-{site}.json'
images=json.loads(images_file.read_text()) if images_file.exists() else {}
containers=json.loads(containers_file.read_text()) if containers_file.exists() else {}
def image_tag(service): return f'tfmc-site-{site}-{service}:{head}'
def image_id(tag): return 'sha256:'+hashlib.sha256(tag.encode()).hexdigest()
def overlay(): return json.loads((root/f'.site-images-{site}.json').read_text())['services']
with (root/'trace').open('a') as log: log.write(json.dumps([tool,head,args])+'\\n')
if tool=='id':
 print('tfmc' if args==['-un'] else '1001');sys.exit(0)
if tool=='sleep': sys.exit(0)
if tool=='curl': sys.exit(1 if os.environ.get('FAIL_HEALTH') and head==new else 0)
if tool=='git':
 if args[0]=='rev-parse': print(head)
 elif args[0] in ('reset','checkout'): (root/'head').write_text(args[-1])
 elif args[:2]==['diff','--name-only']: print('backend/server.py' if args[-2]!=args[-1] else '')
 elif args[:2]==['diff','--quiet']: sys.exit(1 if os.environ.get('DIRTY_INPUT') else 0)
 elif args[:2]==['merge-base','--is-ancestor']: sys.exit(0 if args[-1]=='origin/main' or args[-2]<=args[-1] else 1)
 elif args[0]=='cat-file': sys.exit(0 if args[-1].split(':')[0] in os.environ.get('NATIVE_REVISIONS',new).split(',') else 1)
 sys.exit(0)
if tool=='docker':
 if args[:2]==['image','inspect']:
  if args[-1] not in images: sys.exit(1)
  print(images[args[-1]])
 elif args[0]=='inspect':
  service=args[-1].removeprefix(f'{site}-')
  if service not in containers: sys.exit(1)
  print(containers[service])
 else: raise SystemExit('unexpected docker command')
 sys.exit(0)
if tool=='ps-compose':
 assert args[0]==('main' if site=='www' else 'dev')
 args=args[1:]; data=root/('provincesystem-data' if site=='www' else 'provincesystem-dev-data')/'data'; marker=data/'.postgres-authority.json'
 if args[0]=='build':
  services=overlay()
  for service in args[1:]:
   tag=services[service]['image']
   assert tag==image_tag(service), (tag,head)
   assert services[service]['build']['labels']=={'net.tfminecraft.site':site,'org.opencontainers.image.revision':head}
   if os.environ.get('FAIL_BUILD')==service and head==new: sys.exit(1)
   images[tag]=image_id(tag)
  images_file.write_text(json.dumps(images))
 if args[:2]==['up','-d'] and 'backend' in args:
  services=overlay()
  for service in ('backend','frontend'):
   if service not in args: continue
   tag=services[service]['image']
   assert tag==image_tag(service) and tag in images
   containers[service]=images[tag]
   if os.environ.get('WRONG_IMAGE')==service and head==new: containers[service]='sha256:wrong'
  containers_file.write_text(json.dumps(containers))
 if args[:2]==['ps','-q'] and args[-1] in containers:
  if os.environ.get('MISSING_CONTAINER')!=args[-1] or head!=new: print(f'{site}-{args[-1]}')
 if args[0]=='exec': print('private-postgres-dump')
 if args[0]=='run':
  tag=overlay()['backend']['image']
  assert tag==image_tag('backend') and tag in images, (tag,head)
  assert head in os.environ.get('NATIVE_REVISIONS',new).split(',')
  with (root/'operations').open('a') as log: log.write(json.dumps([head,tag,images[tag],args[-1]])+'\\n')
  command=args[-1]
  if command=='prepare': marker.write_text('{}')
  if command=='studio' and os.environ.get('FAIL_STUDIO'): sys.exit(1)
  if command=='rollback':
   if os.environ.get('FAIL_EXPORT'): sys.exit(1)
   marker.unlink()
 sys.exit(0)
raise SystemExit('unexpected host command')
"""
    for tool in ("git", "id", "curl", "sleep", "docker", "ps-compose"):
        path = binary / tool
        path.write_text(f"#!{sys.executable}\n" + shim)
        path.chmod(0o755)
    script = tmp_path / "site-deploy"
    script.write_text(SOURCE.read_text().replace("/home/tfmc", str(tmp_path))
                      .replace("/usr/local/sbin/ps-compose", str(binary / "ps-compose"))
                      .replace("SECONDS + 180", "SECONDS + 1"))

    def run(target=NEW, site="www", **faults):
        env = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}",
               "DEPLOY_TEST_ROOT": str(tmp_path), "DEPLOY_TEST_SITE": site, **faults}
        (tmp_path / "trace").write_text("")
        result = subprocess.run(["bash", str(script), "deploy", site, target], env=env,
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
    assert calls[build][1] == ["build", "backend", "frontend"]
    assert calls[serve][1] == ["up", "-d", "--no-build", "--no-deps", "backend", "frontend"]
    overlay = root / ".site-images-www.json"
    assert overlay.stat().st_mode & 0o777 == 0o600
    assert not overlay.with_suffix(".part").exists()
    services = json.loads(overlay.read_text())["services"]
    for service in ("backend", "frontend"):
        assert services[service] == {
            "image": image_tag("www", service, NEW),
            "build": {"labels": {"net.tfminecraft.site": "www", "org.opencontainers.image.revision": NEW}},
        }
        assert any(tool == "docker" and args[-1] == image_tag("www", service, NEW)
                   for tool, _, args in trace)
        assert (NEW, ["ps", "-q", service]) in calls
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
    assert calls[-3][1] == ["stop", "backend"]
    assert calls[-2][1] == ["build", "backend"]
    assert calls[-1][1][-1] == "rollback"


def test_explicit_legacy_downgrade_exports_using_current_native_image(host):
    root, data, run = host
    (root / "head").write_text(NEW)
    (data / ".postgres-authority.json").write_text("{}")
    result, trace = run(target=OLD)
    assert result.returncode == 0, result.stderr
    calls = commands(trace)
    assert next(head for head, args in calls if args[-1] == "rollback") == NEW
    assert calls[0] == (NEW, ["build", "backend"])
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


@pytest.mark.parametrize("native", [False, True], ids=["legacy", "native"])
def test_interrupted_deploy_return_to_last_healthy_revision_replaces_both_images(host, native):
    root, data, run = host
    (root / "head").write_text(NEW)
    (root / ".site-deployed-www").write_text(OLD)
    (data / ".postgres-authority.json").write_text("{}")
    set_running(root, NEW)
    revisions = f"{OLD},{NEW}" if native else NEW
    result, trace = run(target=OLD, NATIVE_REVISIONS=revisions)
    assert result.returncode == 0, result.stderr
    assert "already deployed" not in result.stdout
    calls = commands(trace)
    assert (OLD, ["build", "backend", "frontend"]) in calls
    assert (OLD, ["up", "-d", "--no-build", "--no-deps", "backend", "frontend"]) in calls
    assert any(args[:2] == ["diff", "--name-only"] and args[-2:] == [OLD, OLD]
               for tool, _, args in trace if tool == "git")
    assert json.loads((root / "containers-www.json").read_text()) == {
        service: image_id(image_tag("www", service, OLD)) for service in ("backend", "frontend")
    }
    operations = [json.loads(line) for line in (root / "operations").read_text().splitlines()]
    assert [(revision, command) for revision, _, _, command in operations] == (
        [(OLD, "prepare"), (OLD, "studio")] if native else [(NEW, "rollback")]
    )
    assert (data / ".postgres-authority.json").exists() == native


@pytest.mark.parametrize("service", ["backend", "frontend"])
def test_successful_http_health_with_wrong_container_image_rolls_back(host, service):
    root, data, run = host
    result, trace = run(WRONG_IMAGE=service)
    assert result.returncode == 5, result.stderr
    assert f"{service} is not running revision {NEW}" in result.stderr
    assert (root / "head").read_text() == OLD
    assert (root / ".site-deployed-www").read_text().strip() == OLD
    assert not (data / ".postgres-authority.json").exists()
    assert (OLD, ["build", "backend", "frontend"]) in commands(trace)
    assert "rolled back" in (root / "site-deploy.log").read_text()


@pytest.mark.parametrize("native", [False, True], ids=["legacy", "native"])
def test_failed_deployment_rebuilds_both_healthy_revision_images(host, native):
    root, data, run = host
    revisions = f"{OLD},{NEW}" if native else NEW
    if native:
        (data / ".postgres-authority.json").write_text("{}")
    result, trace = run(FAIL_HEALTH="1", NATIVE_REVISIONS=revisions)
    assert result.returncode == 5, result.stderr
    assert (OLD, ["build", "backend", "frontend"]) in commands(trace)
    assert (root / "head").read_text() == OLD
    assert (data / ".postgres-authority.json").exists() == native
    assert json.loads((root / "containers-www.json").read_text()) == {
        service: image_id(image_tag("www", service, OLD)) for service in ("backend", "frontend")
    }
    assert "rolled back" in (root / "site-deploy.log").read_text()


@pytest.mark.parametrize("service", ["backend", "frontend"])
def test_already_deployed_shortcut_requires_correct_container_images(host, service):
    root, data, run = host
    (root / "head").write_text(NEW)
    (root / ".site-deployed-www").write_text(NEW)
    (data / ".postgres-authority.json").write_text("{}")
    set_running(root, NEW)
    containers = json.loads((root / "containers-www.json").read_text())
    containers[service] = "sha256:wrong"
    (root / "containers-www.json").write_text(json.dumps(containers))
    result, trace = run()
    assert result.returncode == 0, result.stderr
    assert "already deployed" not in result.stdout
    assert (NEW, ["build", "backend", "frontend"]) in commands(trace)


def test_already_deployed_shortcut_checks_both_revision_tags(host):
    root, data, run = host
    (root / "head").write_text(NEW)
    (root / ".site-deployed-www").write_text(NEW)
    (data / ".postgres-authority.json").write_text("{}")
    set_running(root, NEW)
    result, trace = run()
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "already deployed"
    assert not any(args[0] == "build" for _, args in commands(trace))
    for service in ("backend", "frontend"):
        assert (NEW, ["ps", "-q", service]) in commands(trace)
        assert any(tool == "docker" and args == ["inspect", "--format", "{{.Image}}", f"www-{service}"]
                   for tool, _, args in trace)


@pytest.mark.parametrize("service", ["backend", "frontend"])
def test_http_health_without_service_container_fails(host, service):
    root, _, run = host
    result, _ = run(MISSING_CONTAINER=service)
    assert result.returncode == 5, result.stderr
    assert (root / "head").read_text() == OLD
    assert "rolled back" in (root / "site-deploy.log").read_text()


def test_dev_keeps_dirty_input_json_and_uses_separate_revision_tags(host):
    root, data, run = host
    dev_data = root / "provincesystem-dev-data" / "data"
    dev_data.mkdir(parents=True)
    (dev_data / "province.db").write_bytes((data / "province.db").read_bytes())
    dirty = root / "tfmc-staging" / "backend" / "src" / "input" / "provinces.json"
    dirty.parent.mkdir(parents=True)
    dirty.write_text('{"local": "preserve"}\n')
    result, trace = run(site="dev", DIRTY_INPUT="1")
    assert result.returncode == 0, result.stderr
    assert dirty.read_text() == '{"local": "preserve"}\n'
    assert not any(args[0] == "reset" for tool, _, args in trace if tool == "git")
    overlay = root / ".site-images-dev.json"
    assert overlay.stat().st_mode & 0o777 == 0o600
    for service, settings in json.loads(overlay.read_text())["services"].items():
        assert settings["image"] == image_tag("dev", service, NEW)
        assert settings["build"]["labels"]["net.tfminecraft.site"] == "dev"
    assert not (root / ".site-images-www.json").exists()


@pytest.mark.parametrize("wrong_image", [False, True])
def test_dev_newer_revision_shortcut_verifies_running_images(host, wrong_image):
    root, _, run = host
    (root / "head").write_text(NEW)
    (root / ".site-deployed-dev").write_text(NEW)
    set_running(root, NEW, site="dev")
    if wrong_image:
        containers = json.loads((root / "containers-dev.json").read_text())
        containers["frontend"] = "sha256:wrong"
        (root / "containers-dev.json").write_text(json.dumps(containers))
    result, trace = run(target=OLD, site="dev")
    assert result.returncode == (1 if wrong_image else 0), result.stderr
    assert ("a newer revision is already deployed" in result.stdout) == (not wrong_image)
    assert not any(args[0] == "build" for _, args in commands(trace))
    assert (root / "head").read_text() == NEW
