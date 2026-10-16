#!/bin/bash
# Forced command for the Deploy workflow's key on psdeploy. Installed as root's
# /usr/local/sbin/site-deploy-ssh; sudoers lets psdeploy run site-deploy as tfmc:
#   psdeploy ALL=(tfmc) NOPASSWD: /usr/local/sbin/site-deploy
set -euo pipefail
read -r -a args <<< "${SSH_ORIGINAL_COMMAND:-}"
if [[ ${#args[@]} -ne 3 || ${args[0]} != deploy ]]; then
  echo "usage: deploy <www|dev> <sha>" >&2
  exit 2
fi
exec sudo -n -u tfmc /usr/local/sbin/site-deploy "${args[@]}"
