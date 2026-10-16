#!/bin/bash
set -euo pipefail
read -r -a args <<< "${SSH_ORIGINAL_COMMAND:-}"
case "${args[0]:-}" in
  up|down|list) ;;
  *) echo "usage: up <slug> <sha> | down <slug> | list" >&2; exit 2 ;;
esac
exec sudo -n -u tfmc /usr/local/sbin/ps-preview "${args[@]}"
