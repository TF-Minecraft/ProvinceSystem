#!/bin/bash
# Run one preview command on the TF server: up <slug> <sha> | down <slug> | list.
# The deploy key can only run these; the server's ps-preview does the work.
set -euo pipefail

: "${PREVIEW_SSH_KEY:?}" "${PREVIEW_SSH_HOST:?}" "${PREVIEW_SSH_KNOWN_HOSTS:?}"

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
printf '%s\n' "$PREVIEW_SSH_KEY" > "$dir/key"
printf '%s\n' "$PREVIEW_SSH_KNOWN_HOSTS" > "$dir/known_hosts"
chmod 600 "$dir/key"

exec ssh -i "$dir/key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o UserKnownHostsFile="$dir/known_hosts" -o StrictHostKeyChecking=yes \
  "psdeploy@$PREVIEW_SSH_HOST" "$@"
