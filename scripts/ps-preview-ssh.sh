#!/bin/bash
# Forced command for the Preview workflow's key on psdeploy. Installed as root's
# /usr/local/sbin/ps-preview-ssh; sudoers lets psdeploy run ps-preview as tfmc:
#   restrict,command="/usr/local/sbin/ps-preview-ssh" ssh-ed25519 ... github-preview-deploy
set -euo pipefail
read -r -a args <<< "${SSH_ORIGINAL_COMMAND:-}"
case "${args[0]:-}" in
  up|down|list) ;;
  *) echo "usage: up <slug> <sha> | down <slug> | list" >&2; exit 2 ;;
esac
exec sudo -n -u tfmc /usr/local/sbin/ps-preview "${args[@]}"
