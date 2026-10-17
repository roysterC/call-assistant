#!/usr/bin/env bash
# Asks the running CRM to send tomorrow's appointment reminders. Run by
# call-assistant-reminders.timer (deploy/); safe to run by hand, since each
# booking is only ever reminded once.
#
# CRON_SECRET comes from the app's .env / .env.local (the unit loads them).
# It goes to curl on stdin rather than the command line, so it never shows in
# the process list.
set -euo pipefail

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set in .env or .env.local; no reminders sent." >&2
  exit 1
fi

url="${REMINDERS_URL:-http://127.0.0.1:3000/api/cron/appointment-reminders}"
printf 'Authorization: Bearer %s\n' "$CRON_SECRET" \
  | curl -sS --fail-with-body -m 300 -X POST -H @- "$url"
echo
