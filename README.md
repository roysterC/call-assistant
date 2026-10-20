DOAI Call Assistant — multi-tenant CRM for voice (Vapi), WhatsApp, and embeddable website chatbots.

## Local development

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/) and Node.js 22+.

```bash
# First time setup
cp .env.local.example .env.local   # fills in DATABASE_URL + dev auth bypass
npm install
npm run db:up                       # starts Postgres in Docker
npm run dev:setup                   # pushes schema + seeds sample data

# Every time after that
npm run db:up                       # if not already running
npm run dev                         # http://localhost:4500
```

With `DEV_BYPASS_AUTH=1` in `.env.local` (set by the example), you are auto-signed-in as the seeded super-admin and can navigate everything without a real session. `next dev` only: a production build (`next build` / `next start`) ignores both bypass variables, so they can never open up the live CRM.

Reset the local DB and re-seed:
```bash
npm run dev:reset
```

## Tech stack

- Next.js 16 + React 19
- Prisma 7 + PostgreSQL
- NextAuth v5 (Credentials + JWT sessions)
- Tailwind 4 + shadcn/ui

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment

### Host topology

Production is **netcup**. It is not Vercel, and it is no longer Hetzner.

| | Host | Role |
|---|---|---|
| **Production** | `v2202609416356518198.megasrv.de` (89.58.45.110) | The live app. All deploys go here. |
| **Hetzner (retired)** | `178.104.49.71`, hostname `doai-vps`, ssh alias `kaia-vps` | Stale copy at `/home/kaia/doai/call-assistant`. Serves nothing anyone should be looking at. |

Both boxes still exist and both still have a checkout of this repo, which is
the trap: a deploy aimed at the wrong one succeeds quietly and changes nothing
users can see. The deploy workflow therefore names its target host in plain
text rather than reading it from a repository secret — see
`.github/workflows/deploy-netcup.yml`.

On netcup:

- **Path** — `/home/deploy/call-assistant`, owned by the `deploy` user
- **Service** — systemd unit `call-assistant.service`, running as `deploy`,
  `ExecStart=/usr/bin/npm start`, listening on port 3000
- **Public URL** — <https://89-58-45-110.nip.io> (Let's Encrypt, with nip.io
  supplying the wildcard DNS)
- **SSH** — as `root`, with the key at `~/.ssh/netcup-ca`

Note that SSH login is `root` while the checkout belongs to `deploy`. Every
command that touches the working tree runs under `sudo -u deploy`, so that root
never leaves files in `node_modules/` or `.next/` that the service user cannot
replace on the next deploy.

**Stale DNS:** `call.doaisystems.co.uk` still points at the retired Hetzner
box. It should be repointed at netcup or retired outright; until then, treat
any traffic or screenshot from that hostname as showing old code.

### The pipeline

`.github/workflows/deploy-netcup.yml` runs on every push to `master`, and can
be started by hand from the Actions tab. It checks on the runner first
(`npm ci`, `prisma generate`, typecheck, lint, `npm test`, `npm run build`) and
only then SSHes to netcup to fetch master, `npm ci`, regenerate the Prisma
client, sync the schema, rebuild and restart the unit. Deploys are serialised,
and a restart that does not leave the unit active fails the run.

It needs one repository secret:

| Secret | Value |
|---|---|
| `NETCUP_SSH_KEY` | The private half of `~/.ssh/netcup-ca`, whole file including the header and footer lines |

Everything else the deploy needs — `DATABASE_URL` above all — is read on the
box from `.env.local` (or `.env`) in the app directory, which is also where
Next and `prisma.config.ts` look. The production database URL is deliberately
not duplicated into GitHub.

The build step raises Node's heap to 3072MB. The default heap OOMs
(`SIGABRT`) on this 3.8GB box, which reads as a mysterious mid-build crash if
you do not know to look for it.

### Schema changes

There are no Prisma migration files; the schema is applied with
`prisma db push`. The deploy guards that push by first asking
`prisma migrate diff` what SQL is pending and refusing to continue if it drops
a table or column, re-tightens a `NOT NULL`, changes a column type, or
truncates. Purely additive changes go through automatically.

So an added column, a relaxed `NOT NULL` or a new unique constraint needs
nothing from you. Anything destructive stops the deploy and prints the SQL, and
is meant to be applied deliberately — usually as a two-commit dance: ship code
that stops reading the column, then drop it.

For Prisma, "stops reading" means marking the field `@ignore`, not deleting it:
the client stops selecting the column (it otherwise selects every column, so
dropping it under a live build breaks every query on that table), while the
schema still matches the database and the deploy goes through. Then drop the
column by hand on the box, and delete the field in a later commit.

A new column that existing rows need filling in goes in
`scripts/post-deploy.ts`, which the deploy runs after the restart. Everything
in it must be idempotent: it runs on every deploy, and after the first it
should find nothing left to do.

One sharp edge worth knowing: adding a unique constraint over rows that already
violate it fails when Postgres builds the index. That is a safe failure — the
schema and the data are left as they were — but the deploy stops, and the
duplicates have to be resolved on the box before it will go through.

### Voice server

Our own receptionist (the "Talk" tab of the Receptionist lab, and later the
phone line) needs a long-lived audio connection, so it runs as its own service
next to the CRM: `src/voice-server/index.ts` on port 4610, unit
`call-assistant-voice.service`. A CRM deploy restarts it only once it has been
installed, and never fails because of it.

One-time setup on netcup, as root:

1. Add to the app's settings file, `/home/deploy/call-assistant/.env` (the
   box has no `.env.local`; either would be read):
   `RECEPTIONIST_VOICE_URL=wss://89-58-45-110.nip.io/voice`,
   `RECEPTIONIST_VOICE_SECRET=` (from `openssl rand -hex 32`),
   `DEEPGRAM_API_KEY=` and `ELEVENLABS_API_KEY=`. The Anthropic key is the
   salon's own where one is set (Admin → Organizations → Anthropic API key
   override, so its usage is billed to that key), else `ANTHROPIC_API_KEY`.
2. Install the unit:
   `cp /home/deploy/call-assistant/deploy/call-assistant-voice.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now call-assistant-voice`
3. Route `/voice/` to it in the web server in front of the app, with websocket
   upgrades allowed. For nginx, inside the site's `server` block:

   ```nginx
   location /voice/ {
       proxy_pass http://127.0.0.1:4610;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_read_timeout 3600s;
   }
   ```

   (For Caddy: `handle /voice/* { reverse_proxy 127.0.0.1:4610 }`.)
4. Restart the CRM so it reads the two new settings:
   `systemctl restart call-assistant`, then check
   `curl https://89-58-45-110.nip.io/voice/health`.

Locally, `VOICE_FAKES=1 npx tsx src/voice-server/index.ts` runs it with a
stand-in model, recogniser and voice, so the audio path can be tried with no
provider accounts.

### Day-before reminders

Clients booked for tomorrow get a reminder text at 10am UK time, with a
second pass at 1pm in case the box was down at 10. The timer
`call-assistant-reminders.timer` runs `scripts/send-reminders.sh`, which posts
to `/api/cron/appointment-reminders` on the box. Each booking is stamped
before its text is tried, so no client is reminded twice. The deploy installs
and enables both units (`deploy/call-assistant-reminders.*`).

It needs `CRON_SECRET` in `/home/deploy/call-assistant/.env` (from
`openssl rand -hex 32`) and Twilio for the texts. The deploy prints a warning
if either is missing.

```bash
systemctl list-timers call-assistant-reminders.timer   # when it runs next
journalctl -u call-assistant-reminders -n 20           # what the last run sent
systemctl start call-assistant-reminders               # send now
```

Before sending for real, `?dryRun=1` lists who would get one, and
`?date=YYYY-MM-DD` targets another day. A booking confirmed or moved in the
24 hours before the run gets no reminder: the confirmation is still fresh.

### Texts and what they cost

Twilio bills per segment. A text in plain characters (GSM-7) fits 160
characters in one segment; one character outside that set, such as a long
dash, a curly apostrophe or an emoji, sends the whole text as UCS-2 at 70 a
segment. So:

- `sendSms` runs every text through `toGsm()` (`src/lib/sms-encoding.ts`)
  first, and logs how many segments it went as.
- The confirmation, reminder, move and cancellation wordings
  (`src/lib/sms.ts`) are written to fit one segment. When a long service name
  or date would tip one into two, the clipped wording ("Ref 1042. To change,
  call ...") takes over.
- A text the assistant writes is refused past two segments, and its card says
  when it will be billed as two.

### Monitoring

**Uptime.** Two public checks for an uptime monitor (Better Stack,
UptimeRobot or similar; their free tiers are enough). Have each one text or
email you:

| Check | URL | Red when |
|---|---|---|
| The CRM | `https://89-58-45-110.nip.io/api/health` | the app, its database or the voice server is not answering |
| Backups | `https://89-58-45-110.nip.io/api/health/backups` | no off-site backup in 26 hours |

Poll the first every minute or few, the second every hour or so.

**Errors.** With Sentry set up, crashes and anything logged with
`console.error` are reported from:

- the CRM's server;
- the browser (through `/api/monitoring`, so the content security policy and
  ad blockers let them through);
- the voice server.

Reports are scrubbed of phone numbers, emails, cookies, request bodies and
query strings first (`src/lib/sentry-scrub.ts`). Without a DSN it all does
nothing.

1. Create a free Sentry account and a Next.js project. Copy its DSN.
2. Add to `/home/deploy/call-assistant/.env`:

   ```bash
   SENTRY_DSN=https://...ingest.sentry.io/...
   NEXT_PUBLIC_SENTRY_DSN=https://...ingest.sentry.io/...   # same value; read at build
   # Optional, for readable stack traces (an auth token with project:releases):
   SENTRY_ORG=...
   SENTRY_PROJECT=...
   SENTRY_AUTH_TOKEN=...
   ```

3. Deploy (or rebuild and restart), then restart the voice server:
   `systemctl restart call-assistant-voice`.

### Backups

Every night at 3:15am UK time, `call-assistant-backup.timer` runs
`scripts/backup-db.sh`, which:

1. dumps the database (`pg_dump`);
2. encrypts it with `BACKUP_PASSPHRASE` (gpg, AES-256);
3. checks it decrypts into a dump `pg_restore` can read;
4. uploads it to S3-compatible storage with rclone;
5. stamps `/home/deploy/backups/last-success`.

`/api/health/backups` turns red when that stamp is more than 26 hours old.
The box keeps 7 days of copies, the bucket 30. The deploy installs the timer
and warns about anything missing.

One-time setup:

1. **Bucket.** Create a private bucket (Cloudflare R2 or Backblaze B2; either
   costs pennies at this size). Make an access key for that bucket only, with
   read and write but **no delete**. Then add a lifecycle rule that deletes
   objects after 30 days. With no delete rights, someone who takes over the
   box cannot wipe the backups.
2. **Tools on netcup**, as root:
   `apt-get install -y rclone`. `pg_dump` and `gpg` are normally there already;
   the deploy says if not. `pg_dump` must be the same major version as the
   database, or newer.
3. **Settings** in `/home/deploy/call-assistant/.env`. The passphrase comes
   from `openssl rand -base64 32`. **Also keep it in a password manager**:
   every backup needs it, and losing the box loses this file.

   ```bash
   BACKUP_PASSPHRASE=...
   BACKUP_REMOTE=offsite:<bucket>/call-assistant
   BACKUP_KEEP_REMOTE_DAYS=0            # the bucket's lifecycle rule prunes
   RCLONE_CONFIG_OFFSITE_TYPE=s3
   RCLONE_CONFIG_OFFSITE_PROVIDER=Cloudflare   # or Other for Backblaze B2
   RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=...
   RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=...
   RCLONE_CONFIG_OFFSITE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
   ```

4. **First run:** `systemctl start call-assistant-backup`, then
   `journalctl -u call-assistant-backup -n 30` and
   `curl https://89-58-45-110.nip.io/api/health/backups`.

**Restore drill** (do it once now, then every few months). It restores the
newest backup into a scratch database and prints row counts to compare with
the live ones:

```bash
sudo -u postgres createdb -O <db user> restore_test
sudo -u deploy -H bash -c 'cd /home/deploy/call-assistant && set -a && . ./.env && set +a \
  && scripts/restore-db.sh latest "postgresql://<db user>:<password>@localhost:5432/restore_test"'
sudo -u postgres dropdb restore_test
```

Restoring over the live database is refused unless `--replace-live` is
passed. Stop `call-assistant.service` before doing that for real.

### The phone line (our own receptionist, not Vapi)

A call to the salon's Twilio number is answered by our own receptionist:

1. Twilio posts "a call comes in" to `/api/twilio/voice`. The CRM checks
   Twilio's signature (`TWILIO_AUTH_TOKEN`), finds the salon from the number
   dialled (a voice number on the salon in Admin, channel "vapi"), and answers
   with TwiML that streams the call to the voice server with a one-minute
   pass (`src/lib/twilio-voice.ts`).
2. The voice server takes it on `/voice/phone`: 8kHz mu-law both ways, the
   same receptionist as the lab. Closing the stream ends the call.
3. When the call ends it is written to Call History as its outcome, and its
   usage (including the phone line, `USAGE_RATE_TELEPHONY_PER_MIN`) is
   recorded against the salon. A deploy waits for live calls to finish.

To switch a salon from Vapi to this:

1. Admin → the salon → phone numbers: add the Twilio number (E.164, channel
   "vapi"), if it is not there already.
2. Twilio console → the number → Voice configuration → "A call comes in":
   Webhook, `https://89-58-45-110.nip.io/api/twilio/voice`, HTTP POST. This is
   the switch: Vapi stops receiving the calls.
3. `.env` on the box needs `TWILIO_AUTH_TOKEN` (already there for texts),
   `RECEPTIONIST_VOICE_URL`, `RECEPTIONIST_VOICE_SECRET`, `DEEPGRAM_API_KEY`,
   `ELEVENLABS_API_KEY` and an Anthropic key, as for the lab. If the web
   server in front ever rewrites the host, set `TWILIO_VOICE_WEBHOOK_URL` to
   the exact URL Twilio calls, or every call is refused as unsigned.
4. Ring the number. The voice server's log shows `[VOICE] phone call CA...`,
   and the call appears in Call History when it ends.

To go back, point the number's webhook at Vapi again.

### The personal assistant

Phase 3 of the Shogo proposal: a round assistant button on every signed-in
page. Staff talk to it (or type) at the desk or on their phone:

- **Questions** it answers straight away: the day ("what's my afternoon
  like", "who's first in tomorrow", who is free when), a client ("when was
  Sarah last in, and what colour did we use?"), the phone's messages, and
  takings by day, week, month or year, by person and service, with no-shows
  (the same figures as the Sales report, `src/lib/takings.ts`).
- **Things to do** become a card, and nothing happens until "yes" or a tap:
  book, move or cancel (with "and text her" for the client's text), add a
  note to a client's page, or send a client a text (owners only). "Yes. And
  how much did we take last week?" saves the card, then answers.

How it is built:

- The microphone goes to the voice server (`/voice/dictate`), which turns it
  into words with Deepgram and sends them back. Replies are read aloud by
  the device's own British voice, with the microphone paused meanwhile; the
  speaker button turns that off.
- The words go to `/api/voice-booking`, where Haiku uses read-only tools and
  draws cards (`src/lib/voice-booking/`). It has no tool that writes: a plain
  "yes" or the card's button is handled by code, which saves it with the
  phone's rules (hours, working days, who does what, the skin test, no
  double-booking; a walk-in can be booked for now).
- It uses the same settings as the receptionist's Talk tab
  (`RECEPTIONIST_VOICE_URL`, `RECEPTIONIST_VOICE_SECRET`, `DEEPGRAM_API_KEY`
  and an Anthropic key); texts need Twilio, as the confirmations do. Without
  the voice settings the typing box still works.
- Locally, `VOICE_FAKES=1` on the voice server and `VOICE_BOOKING_FAKE_MODEL=1`
  on the CRM try the whole path with no provider accounts.
- Hands-free: `/assistant` opens the start page with the assistant already
  listening, for a Siri Shortcut ("Hey Siri, salon assistant"), a Google
  Assistant routine, or the home-screen icon's long-press shortcut (in the
  manifest). A phone that wants a touch before it uses the microphone gets one
  big "Tap to talk" instead.

### What the bots know about the salon

The phone receptionist and the chat bots (website, WhatsApp, Instagram,
Facebook) are given the salon's facts from Settings on every conversation:
opening hours, services with their starting prices ("from £45"), the team,
and the owner's own **Salon FAQs** box (address, parking, policies and the
like, the `salonFaq` column). The rules, in `src/lib/salon-knowledge.ts`:

- General hair questions ("what's balayage?") come from the model's own
  knowledge.
- Anything about this salon comes only from Settings. Anything not written
  there gets "I'm not sure" and a callback, never a guess.
- Prices are quoted as "from"; a service with no price gets no figure.
- Allergy, pregnancy and scalp questions go to the stylist.
- The service list is the whole list. Something not on it ("balayage" at a
  salon listing highlights) gets "not on our price list", never a yes.
- A request that could be several services ("a blow dry", "highlights") is
  asked about, not guessed. The booking tools back this up: they refuse a
  vague service and name the options, with prices (`servicesLike` in
  `src/lib/salon-config.ts`).

A chat bot's hand-written prompt keeps working; the facts are added after it.
A business with no services and no FAQ (the agency's own site) gets its
prompt unchanged.

### WhatsApp, Instagram and Messenger keys

Each salon brings its own Meta app, and its keys are kept with the salon:
Admin → the organisation → "This salon's Meta app" (app secret and webhook
verify token) and "WhatsApp (Cloud API)" (access token). Instagram and
Messenger tokens sit beside their own settings. Only a super-admin can set or
see them.

Both webhooks (`/api/whatsapp/webhook`, `/api/meta/webhook`) work out which
salon a delivery is for from the number, account or Page it names, check the
signature with that salon's app secret, and act only on what that salon's key
signed (`src/lib/meta-credentials.ts`). WhatsApp replies go from the number
the customer wrote to, with the salon's token.

The old shared keys in `.env` (`WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN`) still work as
a fallback for a salon with no key of its own, and each use is logged. To
retire them, give every salon its own keys, check nothing still falls back,
then empty them:

```bash
journalctl -u call-assistant --since "1 week ago" | grep "of its own"
```

### The in-person lead funnel

`/meet` is a one-question-a-screen form for meeting salon owners face to
face. Open it on a phone or tablet, or print it as a QR code. Nothing links
to it, and search engines are told to stay away (`noindex`, and `robots.txt`
disallows everything but the legal pages).

It asks, in order:

1. Do you already use a booking system? If yes, which one (one tap, or skip).
2. Business name.
3. Owner's name.
4. Phone.
5. Email.

Once those are saved, it offers a 30-minute discovery call. That is your
Calendly page, shown in the page with their name and email already filled
in. "Not now" moves on; a booking shows on the thank-you screen, and Calendly
sends the invite. Set the page in `.env` as
`DISCOVERY_CALL_URL=https://calendly.com/<you>/<event>`. It must be a
calendly.com link, and it is read on each visit, so a restart is enough. With
none set, the funnel ends at the thank-you screen. Left untouched, the
booking screen moves on by itself after five minutes.

Each lead lands on our own organisation's Leads page (`LEAD_FUNNEL_ORG_SLUG`,
default `doai`) as "In person". The issue line reads "Already uses Phorest" or
"No booking system yet". Someone already on file by email is updated rather
than duplicated. Super-admins always see Leads in the menu, even with the
receptionist switched on.

The thank-you screen clears itself after 20 seconds, so a shared tablet never
shows the last person's details for long. The endpoint (`/api/funnel`) is
public, so it checks every answer again, ignores bots that fill a hidden
field, and limits how many one connection can send.

### Messages and callbacks

The receptionist never transfers a call. When a caller asks for a person, or
wants something it cannot do or answer, it takes a message (`take_message`
in `src/lib/receptionist/actions.ts`): their name, number (caller ID unless they
give another) and what it is about, for a stylist if they named one. It
lands on the Callbacks page, listed by when the caller rang (waiting ones
oldest first). There is no due time, and the caller is never promised one,
only that someone will ring back as soon as they can. More detail a moment
later is added to the same message. A red counter beside Callbacks in the
menu (a dot on the phone's menu button) shows how many are waiting, and
refreshes every minute.

### Call History for our receptionist

Each call is one line: who rang, when, how long, and its outcome (booked,
rescheduled, cancelled, left a message, enquiry, or hung up), read from
what the receptionist actually did (`src/lib/receptionist/outcomes.ts`).
No recording, transcript or summary is kept. "Enquiry" is a call the
receptionist closed with nothing done; "hung up" is one the caller ended
first. Lab calls are never logged; the phone line calls `logCall` when a
call ends (`src/lib/receptionist/call-log.ts`).

### Stress-testing the receptionist

`scripts/receptionist-stress.ts` puts our own receptionist through twenty
simulated callers (a model playing each one): people who change their mind,
mumble, give dates in words, ring from withheld numbers, try to talk it into
cancelling everything, or ask about someone else's booking. Each call is
checked against what actually landed in the diary, a set of fixed rules, and
a grader model reading the transcript against the salon's prices, hours and
team. It books into the database it is pointed at, so it only runs against a
local one, and deletes what it booked.

    ANTHROPIC_API_KEY=… npx tsx scripts/receptionist-stress.ts          # all calls
    ANTHROPIC_API_KEY=… npx tsx scripts/receptionist-stress.ts privacy  # one scenario
    npx tsx scripts/receptionist-stress.ts --dry                        # the harness only, no key

In a Claude Code cloud session, where `ANTHROPIC_API_KEY` is the session's
own sign-in, set the key as `STRESS_ANTHROPIC_API_KEY` instead; the script
reads that first.

Transcripts, tool calls and failures go to `receptionist-stress-report.md`.

### Manual operations

```bash
ssh -i ~/.ssh/netcup-ca root@v2202609416356518198.megasrv.de

systemctl status call-assistant.service
journalctl -u call-assistant.service -f      # live logs
systemctl restart call-assistant.service

# Anything touching the checkout runs as the owner:
sudo -u deploy -H bash -lc 'cd /home/deploy/call-assistant && git log --oneline -5'
```
