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

With `DEV_BYPASS_AUTH=1` in `.env.local` (set by the example), you are auto-signed-in as the seeded super-admin and can navigate everything without a real session.

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

Transcripts and failures go to `receptionist-stress-report.md`.

### Manual operations

```bash
ssh -i ~/.ssh/netcup-ca root@v2202609416356518198.megasrv.de

systemctl status call-assistant.service
journalctl -u call-assistant.service -f      # live logs
systemctl restart call-assistant.service

# Anything touching the checkout runs as the owner:
sudo -u deploy -H bash -lc 'cd /home/deploy/call-assistant && git log --oneline -5'
```
