"""Host project selection stays stable when deploying an older checkout."""
import json
import os
from pathlib import Path
import subprocess

import pytest


@pytest.mark.parametrize("target,project,checkout", [
    ("main", "tfmcweb-production", "ProvinceSystem"),
    ("dev", "tfmcweb-staging", "tfmc-staging"),
])
def test_host_wrapper_pins_project_independently_of_checkout(tmp_path, target, project, checkout):
    source = Path(__file__).resolve().parents[2] / "scripts" / "ps-compose.sh"
    script = tmp_path / "ps-compose"
    script.write_text(source.read_text().replace("/home/tfmc", str(tmp_path)))
    (tmp_path / checkout).mkdir()
    site = "www" if target == "main" else target
    overlay = tmp_path / f".site-images-{site}.json"
    overlay.write_text("{}")
    docker = tmp_path / "docker"
    docker.write_text('#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n')
    docker.chmod(0o755)
    result = subprocess.run(["bash", str(script), target, "ps"], check=True, capture_output=True,
                            text=True, env={**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"})
    args = json.loads(result.stdout)
    assert args[:5] == ["compose", "--project-name", project, "--project-directory", str(tmp_path / checkout)]
    assert args[-3:] == ["-f", str(overlay), "ps"]
