#!/usr/bin/env bash
# Restore a backup made by backup-db.sh into a database.
#
#   scripts/restore-db.sh latest  postgresql://…/restore_test
#   scripts/restore-db.sh call-assistant-20261018T021500Z.dump.gpg  postgresql://…/restore_test
#
# "latest" fetches the newest copy from BACKUP_REMOTE; a file name looks in
# BACKUP_DIR first, then off-site. Reads BACKUP_PASSPHRASE, BACKUP_REMOTE and
# BACKUP_DIR from the environment (source the app's .env first).
#
# Restoring over the live database is refused unless the third argument is
# --replace-live: practise on a scratch database (README: "Backups").
set -euo pipefail

src="${1:?which backup: \"latest\" or a file name}"
target="${2:?the database URL to restore into}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
dir="${BACKUP_DIR:-/home/deploy/backups}"

strip_schema() { printf '%s' "$1" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//'; }
target="$(strip_schema "$target")"
if [ -n "${DATABASE_URL:-}" ] && [ "$target" = "$(strip_schema "$DATABASE_URL")" ] && [ "${3:-}" != "--replace-live" ]; then
  echo "ERROR: that is the live database. Restore into a scratch one, or pass --replace-live." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ "$src" = "latest" ]; then
  : "${BACKUP_REMOTE:?BACKUP_REMOTE is not set}"
  src="$(rclone lsf -q --include 'call-assistant-*.dump.gpg' "$BACKUP_REMOTE" | sort | tail -n 1)"
  [ -n "$src" ] || { echo "ERROR: no backups found at $BACKUP_REMOTE" >&2; exit 1; }
fi
if [ -f "$dir/$src" ]; then
  cp "$dir/$src" "$work/$src"
elif [ -f "$src" ]; then
  cp "$src" "$work/$(basename "$src")"; src="$(basename "$src")"
else
  : "${BACKUP_REMOTE:?BACKUP_REMOTE is not set}"
  echo "==> Fetching $src"
  rclone copyto "$BACKUP_REMOTE/$src" "$work/$src"
fi

echo "==> Restoring $src"
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$work/$src" 3<<<"$BACKUP_PASSPHRASE" \
  | pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$target"

echo "==> Restored. Row counts:"
psql "$target" -Atc "select 'clients ' || count(*) from ca_leads union all select 'appointments ' || count(*) from ca_appointments union all select 'calls ' || count(*) from ca_calls"
