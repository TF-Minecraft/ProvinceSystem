#!/bin/bash
# Per-branch ProvinceSystem website previews at https://<slug>.tfminecraft.net.
# Installed as root's /usr/local/sbin/ps-preview and run as tfmc (docker group), by the
# preview key on psdeploy (through ps-preview-ssh), by admins with sudo -u tfmc, and by
# ps-preview-reap.timer. Preview backends run as tfmc too, so tfmc owns every file.
set -euo pipefail
umask 077

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/home/tfmc

ROOT=/home/tfmc/previews
LOCK="$ROOT/.lock"
NETWORK=ps-previews
DOMAIN=tfminecraft.net
MAX_PREVIEWS=4
TTL=5400
IMAGE_PREFIX=ghcr.io/tf-minecraft/provincesystem-preview
RESERVED=(www dev api mail map admin staff play mc status preview t3 portainer)
MOUNTS=(data input defines output)

die() { echo "ps-preview: $1" >&2; exit "${2:-1}"; }

usage() {
  cat >&2 <<'EOF'
usage: ps-preview up <slug> <sha>
       ps-preview down <slug>
       ps-preview reap
       ps-preview list
       ps-preview logs <slug> [backend|frontend]
EOF
  exit 2
}

[[ "$(id -un)" == tfmc ]] || die "must run as tfmc (sudo -u tfmc $0 ...)"
cd /
mkdir -p "$ROOT"

validate_slug() {
  local slug="$1" r
  [[ "$slug" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]] || die "invalid slug: '$slug'" 2
  for r in "${RESERVED[@]}"; do
    [[ "$slug" != "$r" ]] || die "slug '$slug' is reserved" 2
  done
}

take_lock() {
  exec 9>"$LOCK"
  if [[ "${1:-}" == nowait ]]; then
    flock -n 9 || exit 0
  else
    flock -w 900 9 || die "timed out waiting for another ps-preview run"
  fi
}

low_prio() { nice -n 10 ionice -c3 "$@"; }

previews() {
  local d
  for d in "$ROOT"/*/; do
    [[ -d "$d" ]] || continue
    basename "$d"
  done
}

remove_dir() {
  rm -rf "${ROOT:?}/$1"
}

staging_backend() {
  local id
  id=$(docker ps -a -q \
    --filter label=com.docker.compose.project=tfmc-staging \
    --filter label=com.docker.compose.service=backend | head -n1)
  [[ -n "$id" ]] || die "cannot find the tfmc-staging backend container"
  echo "$id"
}

create_data() {
  local slug="$1" tmp="$ROOT/.new-$slug" src m container
  container=$(staging_backend)
  remove_dir ".new-$slug"
  mkdir -p "$tmp"
  for m in "${MOUNTS[@]}"; do
    src=$(docker inspect "$container" \
      --format "{{range .Mounts}}{{if eq .Destination \"/app/src/$m\"}}{{.Source}}{{end}}{{end}}")
    [[ -n "$src" && -d "$src" ]] || die "dev backend has no host mount for /app/src/$m"
    case "$m" in
      # Copied separately below via sqlite's online backup; the other .db files are old backups.
      data) low_prio rsync -a --exclude='/*.db' --exclude='/*.db-*' --exclude='/maintenance-backups/' "$src/" "$tmp/$m/" ;;
      # Regenerable tile/webp cache.
      output) low_prio rsync -a --exclude='/_derived/' "$src/" "$tmp/$m/" ;;
      *) low_prio rsync -a "$src/" "$tmp/$m/" ;;
    esac
    if [[ "$m" == data ]]; then
      [[ -f "$src/province.db" ]] || die "dev data has no province.db"
      low_prio sqlite3 "$src/province.db" ".timeout 30000" ".backup '$tmp/data/province.db'"
    fi
  done
  # PG-MIGRATION: host plumbing. Accounts (user_sessions, discord_oauth_states) live in
  # Postgres on the postgres branch, so these two deletes hit stale SQLite tables and previews
  # of that branch have no DATABASE_URL and cannot sign in. The host-plumbing PR gives each
  # preview its own database and moves this scrub there.
  sqlite3 "$tmp/data/province.db" <<'SQL'
.timeout 30000
DELETE FROM sessions;
DELETE FROM user_sessions;
DELETE FROM discord_oauth_states;
DELETE FROM discord_link_codes;
VACUUM;
SQL
  {
    echo "STAFF_KEY=$(openssl rand -hex 32)"
    echo "PLUGIN_KEY=$(openssl rand -hex 32)"
  } > "$tmp/keys"
  mv "$tmp" "$ROOT/$slug"
}

write_compose() {
  local slug="$1" dir="$ROOT/$slug" staff plugin
  staff=$(sed -n 's/^STAFF_KEY=//p' "$dir/keys")
  plugin=$(sed -n 's/^PLUGIN_KEY=//p' "$dir/keys")
  [[ -n "$staff" && -n "$plugin" ]] || die "missing keys in $dir/keys"
  cat > "$dir/compose.yml" <<EOF
name: pv-$slug

services:
  backend:
    image: $IMAGE_PREFIX-backend:$slug
    user: "1001:1001"
    init: true
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    mem_limit: 2g
    cpus: 1.5
    environment:
      SKINS_DEV: "1"
      SITE_PUBLIC_URL: "https://$slug.$DOMAIN"
      STAFF_KEY: "$staff"
      PLUGIN_KEY: "$plugin"
    volumes:
      - $dir/data:/app/src/data
      - $dir/input:/app/src/input
      - $dir/defines:/app/src/defines
      - $dir/output:/app/src/output
    networks:
      $NETWORK:
        aliases:
          - pv-$slug-backend

  frontend:
    image: $IMAGE_PREFIX-frontend:$slug
    init: true
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    mem_limit: 1g
    cpus: 1.0
    environment:
      NODE_ENV: production
    networks:
      $NETWORK:
        aliases:
          - pv-$slug-frontend

networks:
  $NETWORK:
    external: true
EOF
}

do_down() {
  local slug="$1"
  docker compose -p "pv-$slug" down -v --remove-orphans
  docker image rm "$IMAGE_PREFIX-backend:$slug" "$IMAGE_PREFIX-frontend:$slug" >/dev/null 2>&1 || true
  remove_dir "$slug"
}

cmd_up() {
  [[ $# -eq 2 ]] || usage
  local slug="$1" sha="$2" dir count=0 p
  validate_slug "$slug"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "invalid sha: '$sha'" 2
  dir="$ROOT/$slug"
  take_lock

  if [[ ! -d "$dir" ]]; then
    while read -r p; do
      [[ -n "$p" ]] && count=$((count + 1))
    done < <(previews)
    if (( count >= MAX_PREVIEWS )); then
      echo "ps-preview: $MAX_PREVIEWS previews are already running; stop one first:" >&2
      previews | sed 's/^/  /' >&2
      exit 3
    fi
  fi

  low_prio docker pull -q "$IMAGE_PREFIX-backend:$slug" >/dev/null
  low_prio docker pull -q "$IMAGE_PREFIX-frontend:$slug" >/dev/null
  docker image prune -f \
    --filter "label=org.opencontainers.image.source=https://github.com/TF-Minecraft/ProvinceSystem" >/dev/null

  [[ -d "$dir" ]] || create_data "$slug"
  write_compose "$slug"
  docker compose -p "pv-$slug" -f "$dir/compose.yml" up -d --remove-orphans --pull never --quiet-pull >&2

  echo "$sha" > "$dir/sha"
  echo $(( $(date +%s) + TTL )) > "$dir/expires"
  echo "https://$slug.$DOMAIN"
}

cmd_down() {
  [[ $# -eq 1 ]] || usage
  local slug="$1"
  [[ "$slug" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]] || die "invalid slug: '$slug'" 2
  take_lock
  do_down "$slug"
  echo "stopped $slug"
}

cmd_reap() {
  [[ $# -eq 0 ]] || usage
  local now slug expires project
  take_lock nowait
  now=$(date +%s)
  while read -r slug; do
    [[ -n "$slug" ]] || continue
    expires=$(cat "$ROOT/$slug/expires" 2>/dev/null || true)
    if [[ ! "$expires" =~ ^[0-9]+$ ]] || (( now >= expires )); then
      echo "reaping $slug"
      do_down "$slug" || echo "failed to reap $slug" >&2
    fi
  done < <(previews)
  # Compose projects whose preview dir is gone.
  while read -r project; do
    slug="${project#pv-}"
    [[ "$slug" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]] || continue
    [[ -d "$ROOT/$slug" ]] && continue
    echo "reaping orphaned project $project"
    docker compose -p "$project" down -v --remove-orphans || echo "failed to reap $project" >&2
  done < <(docker ps -a --filter label=com.docker.compose.project \
             --format '{{.Label "com.docker.compose.project"}}' | grep '^pv-' | sort -u)
  docker image prune -f \
    --filter "label=org.opencontainers.image.source=https://github.com/TF-Minecraft/ProvinceSystem" >/dev/null
}

cmd_list() {
  [[ $# -eq 0 ]] || usage
  local slug sha expires
  while read -r slug; do
    [[ -n "$slug" ]] || continue
    sha=$(cat "$ROOT/$slug/sha" 2>/dev/null || echo -)
    expires=$(cat "$ROOT/$slug/expires" 2>/dev/null || true)
    if [[ "$expires" =~ ^[0-9]+$ ]]; then
      expires=$(date -u -d "@$expires" +%Y-%m-%dT%H:%M:%SZ)
    else
      expires=-
    fi
    printf '%s %s %s\n' "$slug" "$sha" "$expires"
  done < <(previews)
}

cmd_logs() {
  [[ $# -ge 1 && $# -le 2 ]] || usage
  local slug="$1" service="${2:-}"
  validate_slug "$slug"
  case "$service" in
    ""|backend|frontend) ;;
    *) usage ;;
  esac
  [[ -d "$ROOT/$slug" ]] || die "no such preview: $slug"
  docker compose -p "pv-$slug" -f "$ROOT/$slug/compose.yml" logs --no-color --tail 200 ${service:+"$service"}
}

[[ $# -ge 1 ]] || usage
sub="$1"
shift
case "$sub" in
  up) cmd_up "$@" ;;
  down) cmd_down "$@" ;;
  reap) cmd_reap "$@" ;;
  list) cmd_list "$@" ;;
  logs) cmd_logs "$@" ;;
  *) usage ;;
esac
