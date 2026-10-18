#!/usr/bin/env bash
# Nightly database backup: dump, encrypt, check it restores, send it
# off-site, prune old copies. Run by call-assistant-backup.timer (deploy/);
# safe to run by hand. See README: "Backups".
#
# From the app's .env (the unit loads it):
#   DATABASE_URL          the database to back up
#   BACKUP_PASSPHRASE     encrypts every copy (gpg, AES-256). Keep it in a
#                         password manager too: without it no backup can be
#                         read, and losing the box loses the .env.
#   BACKUP_REMOTE         where copies go, as rclone sees it, e.g.
#                         "offsite:my-bucket/call-assistant". The "offsite"
#                         remote itself is set with RCLONE_CONFIG_OFFSITE_*
#                         variables (README), so there is no rclone.conf.
#   BACKUP_DIR            local copies (default /home/deploy/backups)
#   BACKUP_KEEP_LOCAL_DAYS / BACKUP_KEEP_REMOTE_DAYS   default 7 / 30.
#                         BACKUP_KEEP_REMOTE_DAYS=0 leaves pruning to the
#                         bucket's own lifecycle rule, so the key on this box
#                         needs no delete permission (the safer setup).
#
# Only after the copy is off-site does it write $BACKUP_DIR/last-success,
# which /api/health/backups reads, so a monitor sees any night that failed.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set in .env; refusing to write an unencrypted backup}"

dir="${BACKUP_DIR:-/home/deploy/backups}"
keep_local="${BACKUP_KEEP_LOCAL_DAYS:-7}"
keep_remote="${BACKUP_KEEP_REMOTE_DAYS:-30}"
name="call-assistant-$(date -u +%Y%m%dT%H%M%SZ).dump.gpg"
file="$dir/$name"

umask 077
mkdir -p "$dir"

# Prisma's ?schema=public means nothing to pg_dump, which refuses it.
db_url="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"

# The passphrase goes to gpg on a file descriptor, never the command line.
gpg_encrypt() { gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 "$@" 3<<<"$BACKUP_PASSPHRASE"; }
gpg_decrypt() { gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$@" 3<<<"$BACKUP_PASSPHRASE"; }

echo "==> Dumping the database"
pg_dump --format=custom --no-owner --no-privileges "$db_url" | gpg_encrypt --output "$file.partial"
mv "$file.partial" "$file"

# A backup nobody has tried to read is a hope. This proves it decrypts and
# is a whole dump pg_restore understands, every night.
echo "==> Checking it restores"
tables="$(gpg_decrypt "$file" | pg_restore --list | grep -c ' TABLE DATA ' || true)"
if [ "${tables:-0}" -lt 1 ]; then
  echo "ERROR: $name decrypted to a dump with no table data; not sending it." >&2
  exit 1
fi
echo "    $name: $(du -h "$file" | cut -f1), $tables tables"

if [ -z "${BACKUP_REMOTE:-}" ]; then
  echo "ERROR: BACKUP_REMOTE is not set; $name is on this box only." >&2
  exit 1
fi

echo "==> Sending it off-site"
rclone copyto --quiet "$file" "$BACKUP_REMOTE/$name"
if [ "$keep_remote" != "0" ]; then
  rclone delete --quiet --min-age "${keep_remote}d" --include "call-assistant-*.dump.gpg" "$BACKUP_REMOTE"
fi

find "$dir" -maxdepth 1 -name 'call-assistant-*.dump.gpg' -mtime "+$keep_local" -delete
date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/last-success"
echo "==> Backup done: $BACKUP_REMOTE/$name"
