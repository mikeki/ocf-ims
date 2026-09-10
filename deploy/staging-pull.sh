#!/usr/bin/env bash
#
# staging-pull.sh moves the staging stack (docker-compose.staging.yml, plan 09m)
# onto the newest images for its IMAGE_TAG / WEB_IMAGE_TAG — `latest` = the newest
# master build that passed CI — and prints a line only when a running image changed. Meant
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

# Both images follow their `latest`: the Go server (ims-go) and the hosted web
# build (web, ghcr.io/mikeki/ocf-ims-web). Pinning WEB_IMAGE_TAG works like IMAGE_TAG.
before_go="$("${compose[@]}" images --quiet ims-go 2>/dev/null || true)"
before_web="$("${compose[@]}" images --quiet web 2>/dev/null || true)"
"${compose[@]}" pull --quiet ims-go web
"${compose[@]}" up --detach --quiet-pull
after_go="$("${compose[@]}" images --quiet ims-go 2>/dev/null || true)"
after_web="$("${compose[@]}" images --quiet web 2>/dev/null || true)"

if [ "${before_go}" != "${after_go}" ]; then
    echo "$(date -Is) staging moved to image ${after_go:-?} (was ${before_go:-none})"
fi
if [ "${before_web}" != "${after_web}" ]; then
    echo "$(date -Is) staging web moved to image ${after_web:-?} (was ${before_web:-none})"
fi
