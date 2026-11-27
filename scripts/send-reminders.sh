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
# Owners and staff who have not used their invitation after a few days: one
# reminder each (src/lib/invitations.ts). Refused, harmlessly, where email is
# not set up.
post "$base/api/cron/invite-reminders" || echo "Invitation reminders run failed (is email set up?)." >&2
# "Your free trial is ending" to owners with no card (src/lib/plan-emails.ts).
post "$base/api/cron/trial-reminders" || echo "Trial reminders run failed (is email set up?)." >&2
# Billing against Stripe (src/lib/stripe-reconcile.ts): puts right what a lost
# or failed notice left wrong, and emails Kikai what it found. A no-op where
# Stripe is not set up.
post "$base/api/cron/billing-reconcile" || echo "Billing check failed." >&2
