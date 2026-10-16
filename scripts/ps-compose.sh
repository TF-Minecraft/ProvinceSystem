#!/bin/bash
# Limited docker compose for the ProvinceSystem main and dev sites.
# Runs as tfmc (a docker-group user) via sudo. Ryan is not in the docker group.
set -euo pipefail

usage() {
  echo "usage: ps-compose <main|dev> <ps|logs|start|stop|restart|up|build|pull|exec|top> [args...]" >&2
  exit 1
}

[[ $# -ge 2 ]] || usage
target="$1"
shift
cmd="$1"
shift

case "$target" in
  main)
    dir=/home/tfmc/ProvinceSystem
    files=(-f "$dir/docker-compose.yml" -f "$dir/docker-compose.override.yml")
    ;;
  dev)
    dir=/home/tfmc/tfmc-staging
    files=(-f "$dir/docker-compose.staging.yml" -f "$dir/docker-compose.override.yml")
    ;;
  *)
    usage
    ;;
esac

case "$cmd" in
  ps|logs|start|stop|restart|up|build|pull|exec|top) ;;
  *)
    echo "subcommand not allowed: $cmd" >&2
    usage
    ;;
esac

for arg in "$@"; do
  case "$arg" in
    -f|--file|--file=*|-H|--host|--host=*|--context|--context=*|--project-directory|--project-directory=*|--project-name|--project-name=*|--env-file|--env-file=*|--privileged|--privileged=*|-v|--volume|--volume=*|--mount|--mount=*)
      echo "argument not allowed: $arg" >&2
      exit 1
      ;;
  esac
done

cd "$dir"
exec docker compose --project-directory "$dir" "${files[@]}" "$cmd" "$@"
