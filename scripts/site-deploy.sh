#!/bin/bash
# Installed root-owned; run as tfmc through site-deploy-ssh. www is manual only.
# Database transitions run from the reviewed target image with its backend stopped.
set -euo pipefail

usage() { echo 'usage: deploy <www|dev> <sha>' >&2; exit 2; }
[[ $# -eq 3 && $1 == deploy ]] || usage
site=$2 sha=$3
[[ $sha =~ ^[0-9a-f]{40}$ ]] || usage
case "$site" in
  www) target=main repo=/home/tfmc/ProvinceSystem data=/home/tfmc/provincesystem-data front=3000 back=8000 ;;
  dev) target=dev repo=/home/tfmc/tfmc-staging data=/home/tfmc/provincesystem-dev-data front=13001 back=18001 ;;
  *) usage ;;
esac
[[ $(id -un) == tfmc ]] || { echo 'run as tfmc' >&2; exit 2; }
umask 077
state=/home/tfmc
exec 9> "$state/.site-deploy-$site.lock"
flock 9
log() { echo "$*" >&2; }
compose() { /usr/local/sbin/ps-compose "$target" "$@"; }
database() {
  compose run --rm -T --no-deps --user "$(id -u):$(id -g)" backend \
    python3 -m src.database.operations "$@" >&2
}
record() { printf '%s %s %s -> %s %s\n' "$(date -u +%FT%TZ)" "$site" "${old:0:7}" "${sha:0:7}" "$*" >> "$state/site-deploy.log"; }
native_commit() { git cat-file -e "$1:backend/src/database/operations.py" 2>/dev/null; }
checkout() {
  if [[ $site == www ]]; then git reset -q --hard "$1"; else git checkout -q --detach "$1"; fi
}
select_images() {
  python3 - "$state/.site-images-$site.json" "$site" "$1" <<'PYTHON'
import json, os, pathlib, sys
path = pathlib.Path(sys.argv[1]); temporary = path.with_suffix('.part')
services = {name: {'image': f'tfmc-site-{sys.argv[2]}-{name}:{sys.argv[3]}',
                   'build': {'labels': {'net.tfminecraft.site': sys.argv[2],
                                        'org.opencontainers.image.revision': sys.argv[3]}}}
            for name in ('backend', 'frontend')}
with temporary.open('w') as handle:
    os.fchmod(handle.fileno(), 0o600)
    json.dump({'services': services}, handle)
    handle.flush(); os.fsync(handle.fileno())
os.replace(temporary, path)
fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
try: os.fsync(fd)
finally: os.close(fd)
PYTHON
}
images_match() {
  local service expected container actual
  for service in backend frontend; do
    expected=$(docker image inspect --format '{{.Id}}' "tfmc-site-$site-$service:$1") || return 1
    container=$(compose ps -q "$service") || return 1
    [[ -n $expected && -n $container ]] || return 1
    actual=$(docker inspect --format '{{.Image}}' "$container") || return 1
    if [[ $actual != "$expected" ]]; then
      log "$service is not running revision $1"; return 1
    fi
  done
}
healthy() {
  local deadline=$((SECONDS + 180))
  while ((SECONDS < deadline)); do
    if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$front/" \
      && curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$back/maps/accessible"; then
      images_match "$1"
      return $?
    fi
    sleep 5
  done
  return 1
}
backup() {
  local stamp backup
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "$data/deploy-backups" || return 1
  chmod 700 "$data/deploy-backups" || return 1
  compose up -d --wait db >&2 || return 1
  backup="$data/deploy-backups/postgres.before-deploy-${sha:0:7}-$stamp.dump"
  log "backing up $site Postgres"
  if ! compose exec -T db pg_dump -U provincesystem -d provincesystem --format=custom > "$backup.part"; then
    rm -f "$backup.part"; return 1
  fi
  mv "$backup.part" "$backup" || return 1
  if [[ ! -f "$data/data/.postgres-authority.json" ]]; then
    # Also retain a consistent SQLite backup before a legacy deployment/cutover.
    python3 - "$data/data/province.db" "$data/deploy-backups/province.db.before-deploy-${sha:0:7}-$stamp" <<'PYTHON' || return 1
import sqlite3, sys
from pathlib import Path
source, target = map(Path, sys.argv[1:])
with sqlite3.connect(f'{source.resolve().as_uri()}?mode=ro', uri=True) as src:
    with sqlite3.connect(target) as dst:
        src.backup(dst)
PYTHON
  fi
  # SQLite cutover snapshots and legacy archives have independent retention:
  # keep through the rollback window (at least 30 days), never newest-ten prune.
  find "$data/deploy-backups" -maxdepth 1 -name 'postgres.before-deploy-*.dump' -printf '%T@ %p\n' \
    | sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -f
}

cd "$repo"
git fetch -q origin
if ! git merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then
  log "${sha:0:7} is not on main"; exit 4
fi
save_deployed() {
  python3 - "$deployed_file" "$1" <<'PYTHON'
import os, pathlib, sys
path = pathlib.Path(sys.argv[1]); temporary = path.with_suffix('.part')
with temporary.open('w') as handle:
    handle.write(sys.argv[2] + '\n'); handle.flush(); os.fsync(handle.fileno())
os.replace(temporary, path)
fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
try: os.fsync(fd)
finally: os.close(fd)
PYTHON
}
authority_matches() {
  if native_commit "$sha"; then
    [[ -f "$data/data/.postgres-authority.json" ]]
  else
    [[ ! -f "$data/data/.postgres-authority.json" ]]
  fi
}

checkedout=$(git rev-parse HEAD)
# Git moves before the copy/start sequence. Keep the last healthy revision
# separately so an interrupted deployment can resume and still roll back safely.
deployed_file="$state/.site-deployed-$site"
if [[ -f "$deployed_file" ]]; then
  old=$(cat "$deployed_file")
  [[ $old =~ ^[0-9a-f]{40}$ ]] || { log 'invalid last-deployed record'; exit 1; }
  git merge-base --is-ancestor "$old" origin/main || { log 'last-deployed revision is not on main'; exit 1; }
else
  old=$checkedout
  save_deployed "$old"
fi
if [[ $old == "$sha" && $checkedout == "$sha" ]] && authority_matches && healthy "$sha"; then
  echo 'already deployed'; exit 0
fi
if [[ $site == dev && $sha != "$old" ]] && git merge-base --is-ancestor "$sha" "$old"; then
  if ! healthy "$old"; then log 'the newer deployed revision is unhealthy'; exit 1; fi
  echo 'a newer revision is already deployed'; exit 0
fi
if [[ $site == www ]] && ! git diff --quiet HEAD --; then log "$site has uncommitted changes; nothing changed"; exit 1; fi
was_native=false
if native_commit "$old"; then was_native=true; fi
current_native=false
[[ ! -f "$data/data/.postgres-authority.json" ]] || current_native=true
target_native=false
if native_commit "$sha"; then target_native=true; fi
changed=$(git diff --name-only "$old" "$sha")
summary='backend,frontend'
stopped=false
export_failed=false

deploy_target() {
  if $current_native && ! $target_native; then
    # Ensure the current native tooling is available, even after an interrupted
    # build. Never check out or start legacy code until its export succeeds.
    native_commit "$checkedout" || return 1
    select_images "$checkedout" || return 1
    compose build backend >&2 || return 1
    compose stop backend >&2 || return 1
    stopped=true
    backup || return 1
    if ! database rollback; then export_failed=true; return 1; fi
  fi
  checkout "$sha" || return 1
  select_images "$sha" || return 1
  # Build before taking the site offline for the forward transition.
  compose build backend frontend >&2 || return 1
  if ! $stopped; then
    compose stop backend >&2 || return 1
    stopped=true
    backup || return 1
  fi
  if $target_native; then
    database prepare || return 1
    database studio || return 1
  fi
  compose up -d --no-build --no-deps backend frontend >&2 || return 1
  healthy "$sha"
}

log "deploying ${sha:0:7} to $site ($summary)"
if deploy_target; then
  save_deployed "$sha"
  record "deployed ($summary)"
  if [[ $site == www ]] && grep -q '^backend/src/patchnotes/' <<< "$changed"; then
    if ! sudo -n /usr/local/sbin/tfmc-patchnotes-update "$sha" >&2; then
      log 'patch note jobs need their separate updater'; record 'patch note update failed'
    fi
  fi
  echo "deployed $site ${sha:0:7} ($summary)"
  exit 0
fi

log "$site failed; restoring ${old:0:7}"
compose stop backend >&2 || { record 'failed: cannot stop backend'; exit 5; }
if $export_failed; then record 'failed: reverse export; backend kept stopped'; exit 5; fi
if ! $was_native && [[ -f "$data/data/.postgres-authority.json" ]]; then
  # Includes writes accepted during the health-check window. Never start stale SQLite.
  current=$(git rev-parse HEAD)
  if ! native_commit "$current" || ! select_images "$current" || ! compose build backend >&2; then
    record 'failed: reverse export image; backend kept stopped'; exit 5
  fi
  if ! database rollback; then record 'failed: reverse export; backend kept stopped'; exit 5; fi
fi
if ! checkout "$old"; then record 'failed: rollback checkout; backend kept stopped'; exit 5; fi
if ! select_images "$old" || ! compose build backend frontend >&2; then
  record 'failed: rollback build; backend kept stopped'; exit 5
fi
if $was_native; then
  if ! database prepare || ! database studio; then record 'failed: rollback database; backend kept stopped'; exit 5; fi
fi
if compose up -d --no-build --no-deps backend frontend >&2 && healthy "$old"; then
  save_deployed "$old"
  record "rolled back ($summary)"
  log "back on ${old:0:7}; backups retained"
else
  record "rollback unhealthy ($summary)"; log 'rollback unhealthy; inspect the site'
fi
exit 5
