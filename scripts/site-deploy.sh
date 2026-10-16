#!/bin/bash
# Deploy a commit on main to www.tfminecraft.net or dev.tfminecraft.net.
#
# Installed on the TF server as root's /usr/local/sbin/site-deploy and run as
# tfmc, which owns both checkouts. The Deploy workflow's key logs in as
# psdeploy, pinned to site-deploy-ssh, which runs this through sudo:
#   restrict,command="/usr/local/sbin/site-deploy-ssh" ssh-ed25519 ... github-site-deploy
# By hand: sudo -u tfmc site-deploy deploy <www|dev> <sha>
#
# Exit codes: 0 deployed or already deployed, 2 bad request, 4 commit not on
# main, 5 site did not come up and the previous code was put back, 1 other.
set -euo pipefail

usage() {
  echo "usage: deploy <www|dev> <sha>" >&2
  exit 2
}

[[ $# -eq 3 && $1 == deploy ]] || usage
site=$2
sha=$3
[[ $sha =~ ^[0-9a-f]{40}$ ]] || usage

case "$site" in
  www) target=main repo=/home/tfmc/ProvinceSystem data=/home/tfmc/provincesystem-data front=3000 back=8000 file=docker-compose.yml ;;
  dev) target=dev repo=/home/tfmc/tfmc-staging data=/home/tfmc/provincesystem-dev-data front=13001 back=18001 file=docker-compose.staging.yml ;;
  *) usage ;;
esac
[[ $(id -un) == tfmc ]] || { echo "run as tfmc: sudo -u tfmc $0 deploy $site $sha" >&2; exit 2; }
umask 022
export HOME=/home/tfmc
state=$HOME

exec 9> "$state/.site-deploy-$site.lock"
flock 9

log() { echo "$*" >&2; }
compose() { /usr/local/sbin/ps-compose "$target" "$@"; }
# The site's Postgres, when the checked-out compose file has one.
has_db() { grep -q '^  db:$' "$repo/$file"; }
start_db() { ! has_db || compose up -d --wait db >&2; }
record() { printf '%s %s %s -> %s %s\n' "$(date -u +%FT%TZ)" "$site" "${old:0:7}" "${sha:0:7}" "$*" >> "$state/site-deploy.log"; }

cd "$repo"
git fetch -q origin
if ! git merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then
  log "${sha:0:7} is not on main"
  exit 4
fi
old=$(git rev-parse HEAD)
# dev deploys run on every merge, so an older commit means a newer one already landed.
if [[ $old == "$sha" ]] || { [[ $site == dev ]] && git merge-base --is-ancestor "$sha" "$old"; }; then
  echo "already deployed"
  exit 0
fi
if [[ $site == www ]] && ! git diff --quiet HEAD --; then
  log "the www checkout has uncommitted changes; nothing was changed"
  exit 1
fi

# The backend image also bundles frontend/lib/skins for its renderer.
changed=$(git diff --name-only "$old" "$sha")
services=()
grep -qE '^(frontend|shared)/|^docker-compose' <<< "$changed" && services+=(frontend)
grep -qE '^(backend|shared|frontend/lib/skins)/|^docker-compose' <<< "$changed" && services+=(backend)

# SQLite's backup API inside the container keeps the copy consistent while the
# site writes.
log "backing up province.db"
compose exec -T backend python3 - <<'PYTHON'
import sqlite3
source = sqlite3.connect("file:/app/src/data/province.db?mode=ro", uri=True)
target = sqlite3.connect("/app/src/data/.deploy-backup.db")
source.backup(target)
target.close()
source.close()
PYTHON
mkdir -p "$data/deploy-backups"
mv "$data/data/.deploy-backup.db" "$data/deploy-backups/province.db.before-deploy-${sha:0:7}-$(date -u +%Y%m%dT%H%M%SZ)"
find "$data/deploy-backups" -maxdepth 1 -name 'province.db.before-deploy-*' -printf '%T@ %p\n' \
  | sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -f

if has_db; then
  log "backing up the site's Postgres"
  start_db
  backup="$data/deploy-backups/postgres.before-deploy-${sha:0:7}-$(date -u +%Y%m%dT%H%M%SZ).dump"
  if ! compose exec -T db pg_dump -U provincesystem -d provincesystem --format=custom > "$backup.part"; then
    rm -f "$backup.part"
    log "could not back up the site's Postgres; nothing was changed"
    exit 1
  fi
  mv "$backup.part" "$backup"
  find "$data/deploy-backups" -maxdepth 1 -name 'postgres.before-deploy-*' -printf '%T@ %p\n' \
    | sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -f
fi

checkout() {
  if [[ $site == www ]]; then
    git reset -q --hard "$1" || return 1
  else
    # Keeps dev's local edits; refuses if they would be overwritten.
    git checkout -q --detach "$1" || return 1
  fi
}

healthy() {
  local deadline=$((SECONDS + 180))
  while ((SECONDS < deadline)); do
    if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$front/" \
      && curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$back/maps/accessible"; then
      return 0
    fi
    sleep 5
  done
  return 1
}

rebuild() {
  start_db || return 1
  ((${#services[@]} == 0)) || compose up -d --build --no-deps "${services[@]}" >&2
}

if ! checkout "$sha"; then
  log "could not move the checkout to ${sha:0:7}; nothing was rebuilt"
  record "failed: checkout"
  exit 1
fi
summary="no rebuild"
((${#services[@]} == 0)) || summary=$(IFS=,; echo "${services[*]}")
summary=${summary//,/, }
log "deploying ${sha:0:7} to $site ($summary)"
if rebuild && healthy; then
  record "deployed ($summary)"
  # The patch note jobs run a root-owned copy of this package against www's API.
  if [[ $site == www ]] && grep -q '^backend/src/patchnotes/' <<< "$changed"; then
    if ! sudo -n /usr/local/sbin/tfmc-patchnotes-update "$sha" >&2; then
      log "patch note jobs were not updated; run: sudo tfmc-patchnotes-update $sha"
      record "patch note update failed"
    fi
  fi
  echo "deployed $site ${sha:0:7} ($summary)"
  exit 0
fi

log "$site did not come up on ${sha:0:7}; putting ${old:0:7} back"
checkout "$old"
if rebuild && healthy; then
  record "rolled back ($summary)"
  log "back on ${old:0:7}; the database backup was kept"
else
  record "rollback unhealthy ($summary)"
  log "still unhealthy after putting ${old:0:7} back; check the site now"
fi
exit 5
