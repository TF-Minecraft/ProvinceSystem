"""Package verified repository contents and build provenance."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile

name = 'ProvinceSystem'
version = os.environ.get("BUILD_VERSION") or datetime.now(timezone.utc).strftime("DEV-%Y%m%d-%H%M")
if not re.fullmatch(r"(?:DEV-\d{8}-\d{4}|\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)", version) or "SNAPSHOT" in version.upper():
    raise SystemExit("Invalid archive version")
dist = Path("dist")
dist.mkdir(exist_ok=False)
archive = dist / f"{name}-{version}.tar.gz"
subprocess.run(["git", "archive", "--format=tar.gz", f"--prefix={name}-{version}/", "-o", str(archive), "HEAD"], check=True)
def runtime_only(member):
    if "/.next/cache" in member.name:
        return None
    return member

with tarfile.open(dist / f"ProvinceSystem-frontend-{version}.tar.gz", "w:gz") as output:
    for filename in [".next", "public", "package.json", "package-lock.json", "next.config.ts"]:
        output.add(Path("frontend") / filename, arcname=f"{name}-{version}/frontend/{filename}", filter=runtime_only)
checksums = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(dist.glob("*.tar.gz"))}
(dist / "SHA256SUMS").write_text("".join(f"{sha}  {filename}\n" for filename, sha in checksums.items()))
metadata = {"repository": os.environ.get("GITHUB_REPOSITORY", name), "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(), "version": version, "run_id": os.environ.get("GITHUB_RUN_ID"), "sha256": checksums}
(dist / "build.json").write_text(json.dumps(metadata, indent=2) + "\n")
with open(os.environ["GITHUB_OUTPUT"], "a") as output:
    output.write(f"name={name}-{version}\n")
