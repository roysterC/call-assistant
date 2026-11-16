/**
 * The made-up clients Instagram and Messenger messages used to make, and
 * clearing them out (src/lib/social-client.ts says why they went).
 *
 * Each one is folded into the real client where the chat shows who that is:
 * a booking made from it (its photos went with the booking), a message the
 * team took from it, the number the receptionist booked or filed with, or a
 * quote's number. One that never became anything is deleted, its chat kept
 * with no client. One with something of its own on it (an email, notes typed
 * at the desk, a booking) and no real client to go to is left alone.
 *
 * Run after every deploy (scripts/post-deploy.ts), and by hand to preview
 * (scripts/social-placeholders.ts). Safe to run any number of times.
 *
 * Plain imports only: the deploy's scripts load this without the app's
 * path aliases.
 */

import type { PrismaClient } from "../generated/prisma/client";
import { normalisePhone } from "./phone";

/** The made-up number a first Instagram or Messenger message used to give a client. */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && /^(instagram|facebook)-/.test(phone);
}

/** Every client the made-up ones can point at: fewer than the Prisma client, so the app's own fits. */
export type PlaceholderDb = Pick<
  PrismaClient,
  "lead" | "socialConversation" | "chatPhoto" | "callback" | "chatSession" | "quote" | "$transaction"
>;

/**
 * One made-up client folded into the real one: whatever was on it (an
 * email or what they wanted, saved by the plain chat, notes typed at the
 * desk, anything booked or filed against it) goes to the real client, and
 * the made-up one is deleted. Their chats are kept, under the real one.
 */
export async function absorbPlaceholder(db: PlaceholderDb, placeholderId: string, intoId: string): Promise<void> {
  if (placeholderId === intoId) return;
  await db.$transaction(async (tx) => {
    const from = await tx.lead.findUnique({ where: { id: placeholderId } });
    const into = await tx.lead.findUnique({ where: { id: intoId } });
    if (!from || !into || !isPlaceholderPhone(from.phone)) return;

    const moved = { leadId: intoId };
    const where = { leadId: placeholderId };
    await tx.appointment.updateMany({ where, data: moved });
    await tx.callback.updateMany({ where, data: moved });
    await tx.call.updateMany({ where, data: moved });
    await tx.rebookText.updateMany({ where, data: moved });
    await tx.whatsAppConversation.updateMany({ where, data: moved });
    await tx.websiteConversation.updateMany({ where, data: moved });
    await tx.socialConversation.updateMany({ where, data: moved });
    await tx.lead.updateMany({ where: { contactLeadId: placeholderId }, data: { contactLeadId: intoId } });

    // The email is unique per salon: freed from the made-up client first.
    const email = !into.email && from.email ? from.email : null;
    if (email) await tx.lead.update({ where: { id: placeholderId }, data: { email: null } });
    const notes = [into.notes, from.notes].filter((n) => n?.trim()).join("\n\n") || null;
    await tx.lead.update({
      where: { id: intoId },
      data: {
        ...(email ? { email } : {}),
        ...(!into.issue && from.issue ? { issue: from.issue } : {}),
        ...(!into.company && from.company ? { company: from.company } : {}),
        ...(!into.name?.trim() && from.name ? { name: from.name } : {}),
        ...(notes !== into.notes ? { notes } : {}),
      },
    });
    await tx.lead.delete({ where: { id: placeholderId } });
  });
}

/** The last number the receptionist booked or filed with in a chat's saved history. */
export function lastNumberInSession(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  let found: string | null = null;
  for (const m of messages) {
    const content = (m as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as { type?: string; input?: { customerPhone?: unknown } };
      if (b?.type !== "tool_use" || typeof b.input?.customerPhone !== "string") continue;
      const phone = normalisePhone(b.input.customerPhone);
      if (phone.ok) found = phone.e164;
    }
  }
  return found;
}

/** The real client a made-up one's chats show, or null. */
async function realClientFor(db: PlaceholderDb, placeholder: { id: string; organizationId: string }): Promise<string | null> {
  const chats = await db.socialConversation.findMany({
    where: { leadId: placeholder.id },
    select: { id: true, channel: true },
  });
  const ids = chats.map((c) => c.id);
  if (ids.length === 0) return null;
  const isReal = (lead: { id: string; phone: string | null } | null | undefined) =>
    lead && lead.id !== placeholder.id && !isPlaceholderPhone(lead.phone) ? lead.id : null;

  // A booking made from the chat: its photos went with it.
  const photo = await db.chatPhoto.findFirst({
    where: { conversationId: { in: ids }, appointmentId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { appointment: { select: { lead: { select: { id: true, phone: true } } } } },
  });
  const fromPhoto = isReal(photo?.appointment?.lead);
  if (fromPhoto) return fromPhoto;

  // A message the team took from the chat.
  const callback = await db.callback.findFirst({
    where: { conversationId: { in: ids }, channel: { in: ["instagram", "facebook"] } },
    orderBy: { createdAt: "desc" },
    select: { lead: { select: { id: true, phone: true } } },
  });
  const fromCallback = isReal(callback?.lead);
  if (fromCallback) return fromCallback;

  // The number the receptionist booked or filed with, then a quote's.
  const numbers: string[] = [];
  for (const chat of chats) {
    const session = await db.chatSession.findUnique({
      where: { channel_conversationId: { channel: chat.channel, conversationId: chat.id } },
      select: { messages: true },
    });
    const n = lastNumberInSession(session?.messages);
    if (n) numbers.push(n);
  }
  const quote = await db.quote.findFirst({
    where: { conversationId: { in: ids }, clientPhone: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { clientPhone: true },
  });
  if (quote?.clientPhone) numbers.push(quote.clientPhone);
  for (const phone of numbers) {
    const lead = await db.lead.findUnique({
      where: { organizationId_phone: { organizationId: placeholder.organizationId, phone } },
      select: { id: true, phone: true },
    });
    const real = isReal(lead);
    if (real) return real;
  }
  return null;
}

export interface PlaceholderReport {
  /** Folded into the real client. */
  merged: number;
  /** Never became anything: deleted, their chats kept with no client. */
  removed: number;
  /** Something of their own on them and no real client to go to: left alone. */
  kept: number;
}

/** Clear out the made-up clients. With `apply` false, only says what it would do. */
export async function cleanUpSocialPlaceholders(
  db: PlaceholderDb,
  opts: { apply: boolean; log?: (line: string) => void }
): Promise<PlaceholderReport> {
  const log = opts.log ?? (() => {});
  const report: PlaceholderReport = { merged: 0, removed: 0, kept: 0 };
  const placeholders = await db.lead.findMany({
    where: { OR: [{ phone: { startsWith: "instagram-" } }, { phone: { startsWith: "facebook-" } }] },
    select: {
      id: true,
      organizationId: true,
      name: true,
      email: true,
      notes: true,
      _count: { select: { appointments: true, callbacks: true, calls: true } },
    },
  });

  for (const p of placeholders) {
    const real = await realClientFor(db, p);
    if (real) {
      log(`merge ${p.id} (${p.name ?? "no name"}) into ${real}`);
      if (opts.apply) await absorbPlaceholder(db, p.id, real);
      report.merged++;
      continue;
    }
    const own = p.email || p.notes?.trim() || p._count.appointments || p._count.callbacks || p._count.calls;
    if (own) {
      log(`keep ${p.id} (${p.name ?? "no name"}): has its own details or history`);
      report.kept++;
      continue;
    }
    log(`remove ${p.id} (${p.name ?? "no name"}): only ever messaged`);
    if (opts.apply) {
      await db.$transaction(async (tx) => {
        const unlink = { where: { leadId: p.id }, data: { leadId: null } };
        await tx.socialConversation.updateMany(unlink);
        await tx.whatsAppConversation.updateMany(unlink);
        await tx.websiteConversation.updateMany(unlink);
        await tx.rebookText.deleteMany({ where: { leadId: p.id } });
        await tx.lead.updateMany({ where: { contactLeadId: p.id }, data: { contactLeadId: null } });
        await tx.lead.delete({ where: { id: p.id } });
      });
    }
    report.removed++;
  }
  return report;
}
