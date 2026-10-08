#!/bin/bash
# Run one command on the TF server as SSH_USER with SSH_KEY. The server pins
# each deploy key to one forced command: psdeploy runs ps-preview
# (up <slug> <sha> | down <slug> | list) and ryan's deploy key runs
# site-deploy (deploy <www|dev> <sha>).
set -euo pipefail

: "${SSH_USER:?}" "${SSH_KEY:?}" "${SSH_HOST:?}" "${SSH_KNOWN_HOSTS:?}"

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
printf '%s\n' "$SSH_KEY" > "$dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$dir/known_hosts"
chmod 600 "$dir/key"

ssh -i "$dir/key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o UserKnownHostsFile="$dir/known_hosts" -o StrictHostKeyChecking=yes \
  "$SSH_USER@$SSH_HOST" "$@"
