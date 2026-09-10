# The hosted web build (plan 09m step 2 / 09i E9): the `expo export -p web`
# output behind a small Caddy file server. The export is NOT produced here — the
# CI `Interface` job builds it (Node + pnpm, EXPO_PUBLIC_API_URL unset so web uses
# its own origin) and `interface-publish` copies it in; this file only packages
# it. Build context = packages/interface with dist/ present:
#
#   pnpm -F @ocf-ims/interface export:web
#   docker build --tag ocf-ims-web packages/interface
#
# Published as ghcr.io/mikeki/ocf-ims-web:<sha> and :latest by cicd.yml.
FROM caddy:2-alpine

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/mikeki/ocf-ims" \
      org.opencontainers.image.revision="${GIT_SHA}"

COPY Caddyfile /etc/caddy/Caddyfile
COPY dist/ /srv/

EXPOSE 80
