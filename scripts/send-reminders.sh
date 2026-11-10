#!/usr/bin/env bash
# Asks the running CRM to send tomorrow's appointment reminders, then the
# rebooking texts (src/lib/rebook.ts). Run by call-assistant-reminders.timer
# (deploy/); safe to run by hand, since each booking is only ever reminded
# once and each visit only ever texted about once.
#
# CRON_SECRET comes from the app's .env / .env.local (the unit loads them).
# It goes to curl on stdin rather than the command line, so it never shows in
# the process list.
set -euo pipefail

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set in .env or .env.local; no reminders sent." >&2
  exit 1
fi

base="${CRON_BASE_URL:-http://127.0.0.1:3000}"
reminders="${REMINDERS_URL:-$base/api/cron/appointment-reminders}"

post() {
  printf 'Authorization: Bearer %s\n' "$CRON_SECRET" \
    | curl -sS --fail-with-body -m 300 -X POST -H @- "$1"
  echo
}

# The reminders go first and their failure is the one that fails the unit;
# a rebooking run that fails is logged without hiding that they went.
post "$reminders"
post "$base/api/cron/rebook-texts" || echo "Rebooking texts run failed." >&2
