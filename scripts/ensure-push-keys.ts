/**
 * The key pair booking alerts are signed with (src/lib/push.ts), made once
 * on the server. Run by the deploy before the restarts, so the CRM and the
 * voice server both start with it; safe to run any number of times.
 *
 * With VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY already in .env (or
 * .env.local) it does nothing. Otherwise it makes a pair and adds it to .env.
 * The private key is never printed.
 *
 * Keep the pair. A new one stops alerts on every phone and computer until
 * each turns them on again (Account → "Booking alerts on this device").
 *
 * Usage: npx tsx scripts/ensure-push-keys.ts
 */

import { config as loadEnv } from "dotenv";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import webpush from "web-push";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const pub = process.env.VAPID_PUBLIC_KEY?.trim();
const priv = process.env.VAPID_PRIVATE_KEY?.trim();

if (pub && priv) {
  console.log("    booking alert keys: present");
} else if (pub || priv) {
  // Half a pair: someone set one by hand. Making a new pair would replace it.
  console.warn("WARNING: only one of VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY is set; booking alerts will not be sent until both are.");
} else {
  const file = existsSync(".env") || !existsSync(".env.local") ? ".env" : ".env.local";
  const keys = webpush.generateVAPIDKeys();
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const gap = before && !before.endsWith("\n") ? "\n" : "";
  appendFileSync(
    file,
    `${gap}\n# Booking alerts' signing keys, made by scripts/ensure-push-keys.ts. Keep them:\n` +
      `# new ones stop alerts on every device until each turns them on again.\n` +
      `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`,
    { mode: 0o600 }
  );
  console.log(`    booking alert keys: made and added to ${file}`);
}

// Apple's push service checks who is sending; the CRM's https address says so.
const subject = process.env.VAPID_SUBJECT?.trim() || process.env.AUTH_URL?.trim() || "";
if (!/^(https:\/\/|mailto:)/.test(subject)) {
  console.warn("WARNING: AUTH_URL is not an https address and VAPID_SUBJECT is not set; booking alerts will not be sent.");
}
