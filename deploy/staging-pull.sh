#!/usr/bin/env bash
#
# staging-pull.sh moves the staging stack (docker-compose.staging.yml, plan 09m)
# onto the newest image for its IMAGE_TAG — `latest` = the newest master build
# that passed CI — and prints a line only when the running image changed. Meant
# for cron on the staging host, e.g. every 10 minutes:
#
#   */10 * * * * /opt/ocf-ims-staging/deploy/staging-pull.sh >> /var/log/ims-staging-deploy.log 2>&1
#
# The host pulls; nothing pushes to it (no deploy key, no inbound access needed).
# Pinning IMAGE_TAG=<sha> in .env makes this a no-op until the pin is lifted.

set -o errexit -o nounset -o pipefail

# The repo checkout the stack runs from (this script lives in deploy/).
cd "$(dirname "$0")/.."

# --progress quiet: Compose v5 prints its pull/up progress ("Image … Pulled",
# "Container … Running") on stderr even with `pull --quiet` and `up --quiet-pull`,
# which would put eight lines in the cron log every ten minutes. This is what
# keeps "prints a line only when the image changed" true.
compose=(docker compose --progress quiet -f docker-compose.staging.yml)

before="$("${compose[@]}" images --quiet ims-go 2>/dev/null || true)"
"${compose[@]}" pull --quiet ims-go
"${compose[@]}" up --detach --quiet-pull
after="$("${compose[@]}" images --quiet ims-go 2>/dev/null || true)"

if [ "${before}" != "${after}" ]; then
    echo "$(date -Is) staging moved to image ${after:-?} (was ${before:-none})"
fi
