# syntax=docker/dockerfile:1.7-labs

# -----------------
# Build image stage
# -----------------
FROM golang:alpine AS build

# Used for setcap below
RUN apk add --no-cache libcap
# Used by Go when building to inject repo metadata into the program
RUN apk add --no-cache git

# The Go module lives under go/ (plan 09f); proto/ + the buf configs stay at the
# repo root (shared with the TS tier). The image preserves that layout — go/ steps
# run from /app/go, and buf reaches up to /app/proto.
WORKDIR /app

# Install all the module dependencies early, so that this layer
# can be cached before ocf-ims code is copied over.
COPY go/go.mod go/go.sum ./go/
WORKDIR /app/go
RUN go mod download

# Fetch client deps that we need to embed in the binary
WORKDIR /app
COPY go/bin/fetchbuilddeps/ ./go/bin/fetchbuilddeps/
WORKDIR /app/go
RUN go run ./bin/fetchbuilddeps/fetchbuilddeps.go

# Copy everything in the repo, including the .git directory,
# because we want Go to bake the repo's state into the build.
# See https://pkg.go.dev/debug/buildinfo#BuildInfo
WORKDIR /app
COPY ./ ./

# Generate all code (sqlc, templ, tsgo, buf). None of it is committed to the repo,
# so it must be generated here before the build. Uses local go-tool generators
# (pinned in go.mod) — hermetic, no remote calls. buf runs from go/ pointed at
# ../proto (diverging roots); no pnpm in this stage, so build.go skips the
# TypeScript proto target (a client artifact, never a compile input for the
# binary). `-generate-only` runs the generators but skips the `go build` below,
# which we do ourselves with the cross-compile flags.
WORKDIR /app/go
RUN go run bin/build/build.go -generate-only

# Build the server (entry point go/cmd/ocf-ims)
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/ocf-ims ./cmd/ocf-ims

# Allow IMS to bind to privileged port numbers
RUN setcap "cap_net_bind_service=+ep" /app/ocf-ims


# --------------------
# Deployed image stage
# --------------------
FROM alpine:latest
COPY --from=build /app/ocf-ims /opt/ims/bin/ims

# Pre-create the local-attachments directory owned by the runtime user. When a
# production deployment mounts a named volume here (see docker-compose.prod.yml),
# Docker seeds the empty volume from this path — including its daemon ownership —
# so the non-root server can write to it. Harmless when attachments are disabled
# or backed by S3 (the dir just stays empty).
RUN mkdir -p /opt/ims/attachments && chown -R daemon:daemon /opt/ims/attachments

# Docker-specific default configuration
ENV IMS_HOSTNAME="0.0.0.0"
ENV IMS_PORT="80"
ENV IMS_DB_STORE_TYPE="mariadb"

# Use a non-root user to run the server
USER daemon:daemon

# This should match the IMS_PORT above
EXPOSE 80

CMD [ "/opt/ims/bin/ims", "serve" ]
