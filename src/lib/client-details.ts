/**
 * Checking a change to a client's number or email, wherever it is made: the
 * client's page at the desk, or the personal assistant. Both are identity
 * keys (the phone and WhatsApp find a client by number, the website by
 * email), so one client's may not be given to another, or the next call
 * would land on the wrong record.
 */

import { prisma } from "@/lib/prisma";
import { normalisePhone } from "@/lib/phone";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 400 for a value that cannot be one, 409 for one another client has. */
export type DetailCheck<T> = { ok: true; value: T } | { ok: false; message: string; status: 400 | 409 };

/** A new email for client `leadId`, lower-cased as stored; null takes it away. */
export async function checkClientEmail(
  organizationId: string,
  leadId: string,
  raw: string | null
): Promise<DetailCheck<string | null>> {
  const lower = raw?.trim().toLowerCase() || null;
  if (!lower) return { ok: true, value: null };
  if (!EMAIL.test(lower)) return { ok: false, message: "That email address does not look right.", status: 400 };
  const taken = await prisma.lead.findFirst({
    where: { organizationId, email: lower, id: { not: leadId } },
    select: { name: true },
  });
  if (taken) return { ok: false, message: `${taken.name ?? "Another client"} already has that email.`, status: 409 };
  return { ok: true, value: lower };
}

/** A new number for client `leadId`, in +44 form as stored. */
export async function checkClientPhone(
  organizationId: string,
  leadId: string,
  raw: string
): Promise<DetailCheck<string>> {
  const parsed = normalisePhone(raw);
  if (!parsed.ok) return { ok: false, message: `That number does not look right: ${parsed.reason}`, status: 400 };
  const taken = await prisma.lead.findFirst({
    where: { organizationId, phone: parsed.e164, id: { not: leadId } },
    select: { name: true },
  });
  if (taken) return { ok: false, message: `${taken.name ?? "Another client"} already has that number.`, status: 409 };
  return { ok: true, value: parsed.e164 };
}
