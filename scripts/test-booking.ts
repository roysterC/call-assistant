/**
 * Dev-only. Exercises the Vapi tool endpoint the way Vapi does, without
 * needing a phone call.
 *
 * Signs each request with VAPI_WEBHOOK_SECRET so it passes the signature
 * check added to /api/vapi/functions. (If the secret is unset and NODE_ENV is
 * not production, the route allows unsigned requests, so this still works.)
 *
 * Usage:
 *   npx tsx scripts/test-booking.ts check                 # availability only
 *   npx tsx scripts/test-booking.ts check 2026-09-17 Balayage new
 *   npx tsx scripts/test-booking.ts book  2026-09-17 "Cut and finish" Jo
 *
 * Override the target with BASE_URL (default http://localhost:3000) and the
 * dialled number with SHOGO_PHONE (must match a PhoneNumber row).
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { createHmac } from "node:crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const DIALLED = process.env.SHOGO_PHONE || "+441234567890";
const CALLER = process.env.TEST_CALLER || "+447700900123";
const SECRET = process.env.VAPI_WEBHOOK_SECRET;

async function callTool(name: string, args: Record<string, unknown>) {
  // Matches Vapi's "toolCallList" shape, which is what the route parses.
  const payload = {
    message: {
      type: "tool-calls",
      toolCallList: [
        {
          id: `test-${Date.now()}`,
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
      call: { phoneNumber: { number: DIALLED } },
    },
  };

  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (SECRET) {
    // The route accepts either the plain secret or an HMAC of the body; send
    // the HMAC, which is the stricter of the two.
    headers["x-vapi-signature"] = createHmac("sha256", SECRET)
      .update(raw)
      .digest("hex");
  } else {
    console.warn(
      "VAPI_WEBHOOK_SECRET is unset — relying on the dev-only unsigned bypass.\n"
    );
  }

  const res = await fetch(`${BASE_URL}/api/vapi/functions`, {
    method: "POST",
    headers,
    body: raw,
  });

  const text = await res.text();
  if (res.status !== 200) {
    console.error(`HTTP ${res.status}: ${text}`);
    process.exit(1);
  }

  const body = JSON.parse(text) as { results?: Array<{ result: string }> };
  const result = body.results?.[0]?.result;
  return result ? JSON.parse(result) : body;
}

function defaultDate(): string {
  // Three days out clears both the 2h lead time and the 48h patch-test window.
  const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const [action, dateArg, serviceArg, thirdArg] = process.argv.slice(2);
  const date = dateArg || defaultDate();

  if (action === "book") {
    const service = serviceArg || "Cut and finish";
    const stylist = thirdArg || "Jo";

    console.log(`check_availability  ${date}  ${service}\n`);
    const avail = await callTool("check_availability", {
      date,
      service,
      stylist,
      clientType: "returning",
    });
    console.log(JSON.stringify(avail, null, 2), "\n");

    const first = avail?.options?.[0];
    if (!first) {
      console.log("No slots offered, so nothing to book. Stopping.");
      return;
    }

    // Pass back the exact startsAt, which is what the tool result instructs
    // the model to do.
    console.log(`book_appointment  ${first.startsAt}  with ${first.stylist}\n`);
    const booked = await callTool("book_appointment", {
      date,
      time: first.startsAt,
      service,
      stylist: first.stylist,
      customerPhone: CALLER,
      customerName: "Test Caller",
      clientType: "returning",
      notes: "Created by scripts/test-booking.ts",
    });
    console.log(JSON.stringify(booked, null, 2));
    return;
  }

  // Default: availability only.
  const service = serviceArg || "Cut and finish";
  const clientType = thirdArg || "returning";
  console.log(`check_availability  ${date}  ${service}  (${clientType})\n`);
  const avail = await callTool("check_availability", {
    date,
    service,
    clientType,
  });
  console.log(JSON.stringify(avail, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
