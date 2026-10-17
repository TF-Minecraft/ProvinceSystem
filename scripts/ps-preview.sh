#!/bin/bash
# Per-branch ProvinceSystem website previews at https://<slug>.tfminecraft.net.
# Installed as root's /usr/local/sbin/ps-preview and run as tfmc (docker group), by the
# preview key on psdeploy (through ps-preview-ssh), by admins with sudo -u tfmc, and by
# ps-preview-reap.timer. Preview backends run as tfmc too, so tfmc owns every file.
set -euo pipefail
umask 077

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

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
  local slug="$1" tmp="$ROOT/.new-$1" src m container
  container=$(staging_backend)
  remove_dir ".new-$slug"
  mkdir -p "$tmp"
  for m in "${MOUNTS[@]}"; do
    src=$(docker inspect "$container" \
      --format "{{range .Mounts}}{{if eq .Destination \"/app/src/$m\"}}{{.Source}}{{end}}{{end}}")
    [[ -n "$src" && -d "$src" ]] || die "dev backend has no host mount for /app/src/$m"
    case "$m" in
      # Only assets; PostgreSQL and retained rollback copies are cloned separately.
      data) low_prio rsync -a --exclude='*.db' --exclude='*.db-*' --exclude='/migration-rollback/' --exclude='/deploy-backups/' --exclude='/.postgres-*' --exclude='/.province.rollback.part' --exclude='/maintenance-backups/' "$src/" "$tmp/$m/" ;;
      # Regenerable tile/webp cache.
      output) low_prio rsync -a --exclude='/_derived/' "$src/" "$tmp/$m/" ;;
      *) low_prio rsync -a "$src/" "$tmp/$m/" ;;
    esac
  done
  {
    echo "STAFF_KEY=$(openssl rand -hex 32)"
    echo "PLUGIN_KEY=$(openssl rand -hex 32)"
  } > "$tmp/keys"
  mv "$tmp" "$ROOT/$slug"
}

dev_database() {
  /usr/local/sbin/ps-compose dev exec -T backend python3 -m src.database.preview "$@"
}

native_ready() {
  [[ -f /home/tfmc/provincesystem-dev-data/data/.postgres-authority.json ]]
}

preview_db_container() {
  docker ps -q --filter label=com.docker.compose.project=tfmc-staging \
    --filter label=com.docker.compose.service=db | head -n1
}

connect_database_network() {
  local container="$1" network=ps-preview-database
  docker network inspect "$network" >/dev/null 2>&1 || docker network create --internal "$network" >/dev/null || return 1
  if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$container" | python3 -c 'import json,sys;sys.exit("ps-preview-database" not in json.load(sys.stdin))'; then
    docker network connect --alias ps-preview-db "$network" "$container" || return 1
  fi
}

provision_database() {
  local slug="$1" dir="$ROOT/$1" container table db
  local tables=()
  [[ ! -f "$dir/database-ready" ]] || return 0
  # Retain this directory until database cleanup succeeds, even if creation dies.
  touch "$dir/database-requested" || return 1
  dev_database create "$slug" > "$dir/database.json.part" || return 1
  mv "$dir/database.json.part" "$dir/database.json" || return 1
  db=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["database"])' "$dir/database.json") || return 1
  dev_database tables > "$dir/tables" || return 1
  while read -r table; do
    [[ "$table" =~ ^[a-z_]+$ ]] || return 1
    tables+=("--table=public.$table")
  done < "$dir/tables"
  ((${#tables[@]} == 61)) || return 1
  container=$(preview_db_container)
  [[ -n "$container" ]] || return 1
  # Data only: schema is created by reviewed Dev migrations under the preview
  # owner. No Precedent/patchnote tables, extensions, owners or ACLs are copied.
  low_prio docker exec "$container" pg_dump -U provincesystem -d provincesystem \
    --format=custom --data-only "${tables[@]}" > "$dir/clone.dump" 2> "$dir/clone.log" || return 1
  docker exec -i "$container" pg_restore -U provincesystem -d "$db" \
    --exit-on-error --data-only --disable-triggers < "$dir/clone.dump" 2>> "$dir/clone.log" || return 1
  dev_database scrub "$slug" || return 1
  dev_database refresh "$slug" < "$dir/database.json" || return 1
  python3 - "$dir" <<'PYTHON' || return 1
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
credentials = json.loads((root / 'database.json').read_text())
(root / 'database.env').write_text(''.join(f'{key}={credentials[key]}\n' for key in ('DATABASE_URL', 'DATABASE_STUDIO_URL')))
PYTHON
  rm -f "$dir/clone.dump" "$dir/clone.log" "$dir/tables"
  touch "$dir/database-ready"
}

preview_healthy() {
  local slug="$1" deadline=$((SECONDS + 120))
  while ((SECONDS < deadline)); do
    if curl -fsS -o /dev/null --max-time 5 "https://$slug.$DOMAIN/" \
      && curl -fsS -o /dev/null --max-time 5 "https://$slug.$DOMAIN/api/maps/accessible"; then return 0; fi
    sleep 5
  done
  return 1
}

write_compose() {
  local slug="$1" dir="$ROOT/$1" staff plugin
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
    cap_drop:
      - ALL
    mem_limit: 2g
    cpus: 1.5
    env_file:
      - $dir/database.env
    environment:
      SKINS_DEV: "1"
      SIGN_IN_SITE: "https://dev.$DOMAIN"
      DATABASE_POOL_MAX_SIZE: "3"
      PROFILE_REALM_ID: "dev"
      PATREON_ENABLED: "0"
      PATREON_APPLY: "0"
      DISCORD_AUTH_ENABLED: "0"
      MICROSOFT_LINK_ENABLED: "0"
      SITE_PUBLIC_URL: "https://$slug.$DOMAIN"
      STAFF_KEY: "$staff"
      PLUGIN_KEY: "$plugin"
    volumes:
      - $dir/data:/app/src/data
      - $dir/input:/app/src/input
      - $dir/defines:/app/src/defines
      - $dir/output:/app/src/output
    networks:
      ps-preview-database: {}
      $NETWORK:
        aliases:
          - pv-$slug-backend

  frontend:
    image: $IMAGE_PREFIX-frontend:$slug
    init: true
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
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
  ps-preview-database:
    external: true
EOF
}

do_down() {
  local slug="$1" dir="$ROOT/$1" ids
  if [[ -f "$dir/compose.yml" ]]; then
    docker compose -p "pv-$slug" -f "$dir/compose.yml" down -v --remove-orphans || return 1
  else
    ids=$(docker ps -aq --filter "label=com.docker.compose.project=pv-$slug")
    if [[ -n "$ids" ]]; then docker rm -f $ids >/dev/null || return 1; fi
  fi
  if native_ready || [[ -f "$dir/database-requested" ]]; then
    dev_database drop "$slug" || return 1
  fi
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
  # Cloning must not overlap Dev's stopped-backend cutover or a Dev deployment.
  exec 8>/home/tfmc/.site-deploy-dev.lock
  flock -w 900 8 || die "timed out waiting for Dev deployment"
  native_ready || die "native previews are held until Dev's verified Postgres cutover"

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

  [[ $(docker image inspect -f '{{index .Config.Labels "net.tfminecraft.storage"}}' "$IMAGE_PREFIX-backend:$slug") == postgres ]] || die "branch image must include the native Postgres migration"
  local service container
  for service in backend frontend; do
    [[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE_PREFIX-$service:$slug") == "$sha" ]] || die "image revision does not match requested commit"
  done
  container=$(preview_db_container)
  [[ -n "$container" ]] || die "Dev Postgres is not running"
  connect_database_network "$container" || die "cannot connect the preview database network"
  [[ -d "$dir" ]] || create_data "$slug"
  if ! provision_database "$slug"; then
    do_down "$slug" || die "preview creation failed; cleanup metadata retained"
    die "preview database creation failed"
  fi
  write_compose "$slug"
  if ! docker compose -p "pv-$slug" -f "$dir/compose.yml" up -d --remove-orphans --pull never --quiet-pull >&2 \
    || ! preview_healthy "$slug" \
    || ! dev_database refresh "$slug" < "$dir/database.json"; then
    do_down "$slug" || die "preview startup failed; cleanup metadata retained"
    die "preview startup failed"
  fi

  echo "$sha" > "$dir/sha"
  echo $(( $(date +%s) + TTL )) > "$dir/expires"
  echo "https://$slug.$DOMAIN"
}

cmd_down() {
  [[ $# -eq 1 ]] || usage
  local slug="$1"
  [[ "$slug" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]] || die "invalid slug: '$slug'" 2
  take_lock
  exec 8>/home/tfmc/.site-deploy-dev.lock
  flock -w 900 8 || die "timed out waiting for Dev deployment"
  do_down "$slug"
  echo "stopped $slug"
}

cmd_reap() {
  [[ $# -eq 0 ]] || usage
  local now slug expires project
  take_lock nowait
  exec 8>/home/tfmc/.site-deploy-dev.lock
  flock -n 8 || exit 0
  now=$(date +%s)
  # No creator can hold this lock now; these are failed asset-only copies.
  local unfinished
  for unfinished in "$ROOT"/.new-*/; do
    [[ -d "$unfinished" ]] || continue
    slug=$(basename "$unfinished")
    validate_slug "${slug#.new-}"
    remove_dir "$slug"
  done
  while read -r slug; do
    [[ -n "$slug" ]] || continue
    expires=$(cat "$ROOT/$slug/expires" 2>/dev/null || true)
    if [[ ! "$expires" =~ ^[0-9]+$ ]] || (( now >= expires )); then
      echo "reaping $slug"
      do_down "$slug" || echo "failed to reap $slug" >&2
    fi
  done < <(previews)
  # Recover marked databases/roles even when their directory was lost.
  if native_ready; then
    local orphan_list="$ROOT/.database-orphans"
    if dev_database list > "$orphan_list"; then
      while read -r slug; do
        [[ -n "$slug" && ! -d "$ROOT/$slug" ]] || continue
        validate_slug "$slug"
        do_down "$slug" || echo "failed to reap database $slug" >&2
      done < "$orphan_list"
    fi
    rm -f "$orphan_list"
  fi
  # Container projects whose preview dir is gone.
  while read -r project; do
    slug="${project#pv-}"
    [[ "$slug" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]] || continue
    [[ -d "$ROOT/$slug" ]] && continue
    do_down "$slug" || echo "failed to reap $project" >&2
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
