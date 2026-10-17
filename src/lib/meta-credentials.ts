/**
 * Each salon's Meta keys, and proving a webhook came from that salon's app.
 *
 * Every salon brings its own Meta app (WhatsApp, Instagram and Messenger),
 * and Meta signs each webhook with that app's secret. One shared URL takes
 * them all, so a delivery is checked like this:
 *
 *   1. Read which salon it claims to be for: the WhatsApp number, Instagram
 *      account or Facebook Page its entries name. Nothing is acted on yet.
 *   2. Check the signature with each claimed salon's own secret.
 *   3. Act only on the entries for salons whose secret matched.
 *
 * So one salon's secret can never vouch for another salon's messages.
 *
 * The secrets used to be one shared value per product in the environment.
 * Those still work as a fallback for a salon that has no key of its own yet,
 * and each use is logged, so the switch-over can be watched and the fallback
 * removed once every salon has its own. With neither, a delivery is refused
 * (allowed locally only, for curl).
 */

import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

/** Which webhook: WhatsApp's, or the one Instagram and Messenger share. */
export type MetaProduct = "whatsapp" | "messenger";

const FALLBACK_ENV: Record<MetaProduct, { secret: string; verifyToken: string; accessToken?: string }> = {
  whatsapp: {
    secret: "WHATSAPP_APP_SECRET",
    verifyToken: "WHATSAPP_VERIFY_TOKEN",
    accessToken: "WHATSAPP_ACCESS_TOKEN",
  },
  messenger: { secret: "META_APP_SECRET", verifyToken: "META_VERIFY_TOKEN" },
};

const fallback = (name: string | undefined) => (name ? process.env[name]?.trim() || null : null);

/** Whether the `x-hub-signature-256` header is this body signed with this secret. */
export function signatureMatches(rawBody: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice("sha256=".length), "utf8");
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface WebhookEntry {
  id?: string;
  changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }>;
}

/**
 * The salons a delivery says it is for. Untrusted: it only decides whose
 * secret to check the signature against.
 */
export async function claimedOrganizations(product: MetaProduct, body: unknown): Promise<string[]> {
  const b = (body ?? {}) as { object?: string; entry?: WebhookEntry[] };
  const entries = Array.isArray(b.entry) ? b.entry : [];

  if (product === "whatsapp") {
    const ids = entries
      .flatMap((e) => e.changes ?? [])
      .map((c) => c.value?.metadata?.phone_number_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!ids.length) return [];
    const rows = await prisma.phoneNumber.findMany({
      where: { channel: "whatsapp", whatsappPhoneNumberId: { in: [...new Set(ids)] } },
      select: { organizationId: true },
    });
    return [...new Set(rows.map((r) => r.organizationId))];
  }

  const ids = entries.map((e) => e.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (!ids.length) return [];
  const where =
    b.object === "instagram"
      ? { instagramBusinessId: { in: [...new Set(ids)] } }
      : b.object === "page"
        ? { facebookPageId: { in: [...new Set(ids)] } }
        : null;
  if (!where) return [];
  const rows = await prisma.organizationSettings.findMany({ where, select: { organizationId: true } });
  return [...new Set(rows.map((r) => r.organizationId))];
}

/**
 * The claimed salons whose own secret (or, until they have one, the shared
 * fallback) signed this delivery.
 */
export async function verifiedOrganizations(
  product: MetaProduct,
  rawBody: string,
  signature: string | null,
  claimed: string[]
): Promise<Set<string>> {
  const verified = new Set<string>();
  if (!claimed.length) return verified;

  const rows = await prisma.organizationSettings.findMany({
    where: { organizationId: { in: claimed } },
    select: { organizationId: true, metaAppSecret: true },
  });
  const own = new Map(rows.map((r) => [r.organizationId, r.metaAppSecret?.trim() || null]));
  const shared = fallback(FALLBACK_ENV[product].secret);

  let anySecret = false;
  for (const orgId of claimed) {
    const secret = own.get(orgId) ?? shared;
    if (!secret) continue;
    anySecret = true;
    if (signatureMatches(rawBody, signature, secret)) {
      if (!own.get(orgId)) {
        console.warn(
          `[META ${product}] ${orgId} has no Meta app secret of its own; used the shared ${FALLBACK_ENV[product].secret}. Set one in Admin.`
        );
      }
      verified.add(orgId);
    }
  }

  // Locally, with no secret anywhere, curl can stand in for Meta.
  if (!anySecret && process.env.NODE_ENV !== "production") {
    console.warn(`[META ${product}] no app secret set for ${claimed.join(", ")}; accepted unsigned (not in production)`);
    return new Set(claimed);
  }
  return verified;
}

/**
 * Whether a subscribe handshake's verify token is one we gave out: a salon's
 * own, or the shared fallback.
 */
export async function isKnownVerifyToken(product: MetaProduct, token: string | null): Promise<boolean> {
  const given = token?.trim();
  if (!given) return false;
  const shared = fallback(FALLBACK_ENV[product].verifyToken);
  if (shared && shared.length === given.length && timingSafeEqual(Buffer.from(shared), Buffer.from(given))) {
    return true;
  }
  const match = await prisma.organizationSettings.findFirst({
    where: { metaVerifyToken: given },
    select: { organizationId: true },
  });
  return match !== null;
}

/**
 * Who a WhatsApp reply goes out as: the number the customer wrote to, with
 * the salon's own token (or the shared fallback until it has one).
 */
export async function whatsappSender(
  organizationId: string,
  phoneNumberId: string
): Promise<{ phoneNumberId: string; accessToken: string } | null> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { whatsappAccessToken: true },
  });
  const own = settings?.whatsappAccessToken?.trim();
  if (own) return { phoneNumberId, accessToken: own };
  const shared = fallback(FALLBACK_ENV.whatsapp.accessToken);
  if (shared) {
    console.warn(
      `[META whatsapp] ${organizationId} has no WhatsApp token of its own; used the shared WHATSAPP_ACCESS_TOKEN. Set one in Admin.`
    );
    return { phoneNumberId, accessToken: shared };
  }
  return null;
}
