#!/bin/bash
# Deploy a commit on main to www.tfminecraft.net or dev.tfminecraft.net.
#
# Installed on the TF server as ryan's ~/bin/site-deploy (copy it there after
# changing it; never run it from a checkout it updates). The Deploy workflow's
# key may run only this script:
#   restrict,command="/home/ryan/bin/site-deploy" ssh-ed25519 ... github-site-deploy
# By hand: site-deploy deploy <www|dev> <sha>
#
# Exit codes: 0 deployed or already deployed, 2 bad request, 4 commit not on
# main, 5 site did not come up and the previous code was put back, 1 other.
set -euo pipefail

usage() {
  echo "usage: deploy <www|dev> <sha>" >&2
  exit 2
}

read -r -a args <<< "${SSH_ORIGINAL_COMMAND:-$*}"
[[ ${#args[@]} -eq 3 && ${args[0]} == deploy ]] || usage
site=${args[1]}
sha=${args[2]}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || usage

case "$site" in
  www) target=main repo=$HOME/work/provincesystem data=$HOME/work/provincesystem-data front=3000 back=8000 ;;
  dev) target=dev repo=$HOME/work/provincesystem-dev data=$HOME/work/provincesystem-dev-data front=13001 back=18001 ;;
  *) usage ;;
esac

exec 9> "$HOME/.site-deploy-$site.lock"
flock 9

log() { echo "$*" >&2; }
compose() { sudo -n -u tfmc /usr/local/sbin/ps-compose "$target" "$@"; }
record() { printf '%s %s %s -> %s %s\n' "$(date -u +%FT%TZ)" "$site" "${old:0:7}" "${sha:0:7}" "$*" >> "$HOME/site-deploy.log"; }

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

# A consistent copy needs SQLite's backup API inside the container; the ~/work
# mounts don't pass file locks through.
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

checkout() {
  if [[ $site == www ]]; then
    git reset -q --hard "$1" || return 1
  else
    # Keeps dev's local edits; refuses if they would be overwritten.
    git checkout -q --detach "$1" || return 1
  fi
  # Git writes new files here as 660, which the containers cannot read.
  git diff --name-only -z "$old" "$sha" | while IFS= read -r -d '' file; do
    [[ -e $file ]] || continue
    chmod a+r "$file"
    dir=$(dirname "$file")
    while [[ $dir != . ]]; do
      chmod a+rx "$dir"
      dir=$(dirname "$dir")
    done
  done
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
