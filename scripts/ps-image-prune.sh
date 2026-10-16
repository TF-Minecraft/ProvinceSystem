#!/bin/bash
# Untagged local builds of the main and dev sites, plus build cache unused for a week.
# Tagged images used by the running containers are left alone. Preview images are handled by ps-preview.
set -euo pipefail
docker image prune -f --filter "label=com.docker.compose.project=provincesystem"
docker image prune -f --filter "label=com.docker.compose.project=tfmc-staging"
docker builder prune -f --filter "until=168h"
