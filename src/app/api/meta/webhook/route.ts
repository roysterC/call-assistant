import { NextResponse } from "next/server";
import { processMetaWebhook, type MetaWebhookBody } from "@/lib/meta-messaging";
import {
  claimedOrganizations,
  isKnownVerifyToken,
  verifiedOrganizations,
} from "@/lib/meta-credentials";
import { rateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

/**
 * Unified webhook for Instagram DMs + Facebook Messenger.
 *
 * Meta allows a single webhook URL to subscribe to multiple products. The
 * `body.object` field (`"instagram"` or `"page"`) tells us which channel
 * the event belongs to; everything else is dispatched inside
 * `processMetaWebhook`. WhatsApp uses its own endpoint.
 *
 * Each salon's Meta app signs with its own secret and handshakes with its
 * own verify token, both set in Admin (see meta-credentials.ts).
 */

// GET — Meta subscribe handshake
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && (await isKnownVerifyToken("messenger", token))) {
    console.log("[META WEBHOOK] Verification successful");
    return new Response(challenge, { status: 200 });
  }

  console.warn("[META WEBHOOK] Verification failed");
  return new Response("Forbidden", { status: 403 });
}

// POST — inbound event (Instagram DMs, Messenger DMs)
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(rawBody) as MetaWebhookBody;
  } catch (err) {
    console.warn("[META WEBHOOK] Malformed JSON body:", err);
    return new Response("Bad Request", { status: 400 });
  }

  // Checked with the secret of the salon each account or Page belongs to.
  // One no salon has is ignored rather than refused, so Meta does not retry.
  const claimed = await claimedOrganizations("messenger", body);
  if (!claimed.length) {
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }
  const verified = await verifiedOrganizations("messenger", rawBody, signature, claimed);
  if (!verified.size) {
    console.warn("[META WEBHOOK] Invalid signature for", claimed.join(", "));
    return new Response("Unauthorized", { status: 401 });
  }

  // Rate-limit by client IP after signature check — attackers need a valid
  // HMAC to count against the bucket. Burst 30, refill 3/s: Meta can batch
  // multiple events per second per app.
  const rl = rateLimit("meta-webhook", clientIpFromHeaders(request.headers), {
    tokens: 30,
    refillPerSecond: 3,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)),
        },
      }
    );
  }

  // Fire-and-forget; return 200 immediately so Meta doesn't retry.
  processMetaWebhook(body, verified).catch((err) =>
    console.error("[META WEBHOOK] Processing error:", err)
  );

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
