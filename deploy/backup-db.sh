#!/usr/bin/env bash
#
# Logical backup of the IMS database — a compressed mysqldump pulled from the
# running DB container. A Docker volume on its own is NOT a backup; run this on a
# schedule and copy the output OFF the host.
#
# Usage:
#   deploy/backup-db.sh                  # writes to ./backups/
#   BACKUP_DIR=/mnt/backups deploy/backup-db.sh
#
# Cron (daily 03:30, after the nightly reboot window settles) — `crontab -e`:
#   30 3 * * * cd /opt/ocf-ims && BACKUP_DIR=/mnt/backups ./deploy/backup-db.sh >> /var/log/ims-backup.log 2>&1
#
# Restore (DESTRUCTIVE — overwrites the live DB). Load the creds from .env first,
# since they live there, not in your shell:
#   set -a; source .env; set +a
#   gunzip -c backups/ims-YYYYmmdd-HHMMSS.sql.gz | \
#     MYSQL_PWD="$IMS_DB_PASSWORD" docker exec -e MYSQL_PWD -i ocf-ims-db \
#       mariadb -u"$IMS_DB_USER_NAME" "$IMS_DB_DATABASE"

set -euo pipefail

# Run from the repo root regardless of where cron invoked us.
cd "$(dirname "$0")/.."

# Pull DB credentials from the same .env the compose file uses.
if [[ -f .env ]]; then
	set -a
	# shellcheck disable=SC1091
	source .env
	set +a
fi

DB_CONTAINER="${DB_CONTAINER:-ocf-ims-db}"
DB_NAME="${IMS_DB_DATABASE:-ims}"
DB_USER="${IMS_DB_USER_NAME:-ims}"
DB_PASS="${IMS_DB_PASSWORD:?IMS_DB_PASSWORD not set (need .env or the env var)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/ims-$stamp.sql.gz"

echo "[$(date -Is)] dumping $DB_NAME from $DB_CONTAINER -> $out"
# Pass the password via MYSQL_PWD, never `--password=` (which exposes it in the
# process list). `docker exec -e MYSQL_PWD` with NO value passes the variable
# through from this script's own environment, so the secret stays out of argv on
# the host too — only the export below holds it.
export MYSQL_PWD="$DB_PASS"
docker exec -e MYSQL_PWD "$DB_CONTAINER" \
	mariadb-dump --single-transaction --quick --user="$DB_USER" "$DB_NAME" \
	| gzip > "$out"

# Fail loudly on an empty/short dump rather than silently keeping a bad backup.
if [[ "$(stat -f%z "$out" 2>/dev/null || stat -c%s "$out")" -lt 1024 ]]; then
	echo "[$(date -Is)] ERROR: backup looks too small, removing $out" >&2
	rm -f "$out"
	exit 1
fi

echo "[$(date -Is)] ok: $(du -h "$out" | cut -f1)"

# Prune old local copies (off-host copies should have their own retention).
find "$BACKUP_DIR" -name 'ims-*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -delete
echo "[$(date -Is)] pruned backups older than ${RETENTION_DAYS}d"
