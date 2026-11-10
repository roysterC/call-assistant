/**
 * Rebooking texts: a client due back for a service gets a text offering a
 * free time, with a link into the salon's WhatsApp or Instagram chat, where
 * the booking chat (chat-booking.ts) reads it back and books it.
 *
 *   "Hi Mai, your BIAB infill is due. Lan has Thursday 13 November at 3pm
 *    free. Book: https://…/r/Ab3kQ9 Stop these: https://…/r/Ab3kQ9/stop
 *    Hoang Nail Salon"
 *
 * Why a link and not "reply YES": salon texts go from a one-way sender (the
 * salon's name), so a reply never arrives. The link (/r/<id>, src/app/r)
 * opens WhatsApp with the message written for them, or for Instagram, which
 * cannot be given one, shows it with a button to copy it and open the chat.
 *
 * Who gets one, run each morning with the day-before reminders
 * (api/cron/rebook-texts):
 * - a salon that switched rebooking texts on, books by message, has a
 *   WhatsApp number or an Instagram username to send them to, and a diary
 *   that can take bookings;
 * - per client, their latest completed visit only, for a service with a
 *   rebookWeeks, due within the next few days (or up to two weeks past);
 * - not if they already have something booked, asked to stop these, were
 *   texted about this visit already, or had one in the last fortnight.
 *
 * UK rules allow these to a salon's own clients about its own services, as
 * long as every one has an easy way to stop them: the stop link.
 */

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { canReadAvailability, getSalonConfig, selectProvider, type SalonConfig } from "@/lib/booking";
import type { TimeSlot } from "@/lib/booking/types";
import { addCalendarDays, describeAppointmentWhen, zonedDateString, zonedParts } from "@/lib/business-hours";
import { textRecipient } from "@/lib/client-link";
import { sendSms } from "@/lib/sms";
import { smsSize, toGsm } from "@/lib/sms-encoding";
import { bookingReadiness } from "@/lib/booking/readiness";
import type { SalonService } from "@/lib/salon-config";

/** Texted this many days before the due date, so the offered time is a few days out. */
export const NOTICE_DAYS = 3;
/** Still texted up to this long after the due date; beyond it, they have gone elsewhere. */
export const LATE_DAYS = 14;
/** Never two rebooking texts to one client within this many days. */
export const QUIET_DAYS = 14;
/** At most this many texts a salon a run: a first run on a long history should not flood. */
export const PER_SALON_PER_RUN = 40;

/** The service a visit was for, as the salon's own list has it, with its rebook setting. */
export function rebookServiceFor(serviceText: string, services: SalonService[]): SalonService | null {
  const text = serviceText.toLowerCase();
  // The longest name it contains: "BIAB infill and gel removal" is the infill.
  const matches = services
    .filter((s) => s.rebookWeeks && text.includes(s.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);
  return matches[0] ?? null;
}

/** The day a visit's client is due back: its date plus the service's weeks. */
export function dueDate(visitDay: string, weeks: number): string {
  return addCalendarDays(visitDay, weeks * 7);
}

/** Whether to text today: from NOTICE_DAYS before the due date to LATE_DAYS after. */
export function isDueToday(today: string, due: string): boolean {
  return today >= addCalendarDays(due, -NOTICE_DAYS) && today <= addCalendarDays(due, LATE_DAYS);
}

/**
 * The time to offer: on the first day with any free time, the one nearest
 * the time of day of their last visit (someone who comes at 6pm after work
 * is offered an evening).
 */
export function pickSlot(slots: TimeSlot[], lastVisit: Date, timeZone: string): TimeSlot | null {
  if (slots.length === 0) return null;
  const day = (s: TimeSlot) => zonedDateString(new Date(s.start), timeZone);
  const minutes = (d: Date) => {
    const p = zonedParts(d, timeZone);
    return p.hour * 60 + p.minute;
  };
  const first = [...slots].sort((a, b) => a.start.localeCompare(b.start))[0];
  const target = minutes(lastVisit);
  return slots
    .filter((s) => day(s) === day(first))
    .sort((a, b) => Math.abs(minutes(new Date(a.start)) - target) - Math.abs(minutes(new Date(b.start)) - target))[0];
}

/** Where the link sends them: the salon's WhatsApp, its Instagram, or nowhere to book by message. */
export type BookingChat = { kind: "whatsapp"; number: string } | { kind: "instagram"; username: string };

export async function bookingChatFor(organizationId: string): Promise<BookingChat | null> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { whatsappEnabled: true, instagramEnabled: true, instagramUsername: true },
  });
  if (settings?.whatsappEnabled) {
    const wa = await prisma.phoneNumber.findFirst({
      where: { organizationId, channel: "whatsapp", active: true },
      select: { number: true },
    });
    if (wa) return { kind: "whatsapp", number: wa.number };
  }
  if (settings?.instagramEnabled && settings.instagramUsername) {
    return { kind: "instagram", username: settings.instagramUsername };
  }
  return null;
}

/** What they send to book: written for them, so the booking chat has everything at once. */
export function chatMessage(r: {
  firstName: string | null;
  /** Whose visit it is, when the texts go to someone else's phone (a child's parent). */
  forName?: string | null;
  service: string;
  /** "on Thursday 13 November at 3pm" (fullWhen), or null to ask for a time. */
  whenText: string | null;
  stylist: string | null;
}): string {
  const hello = r.firstName ? `Hi, it's ${r.firstName}. ` : "Hi! ";
  const what = `${withArticle(r.service)}${r.forName ? ` for ${r.forName}` : ""}`;
  if (!r.whenText) return `${hello}I'd like to book ${what}. When are you free?`;
  return `${hello}Could I book ${what} ${r.whenText}${r.stylist ? ` with ${r.stylist}` : ""}?`;
}

/**
 * "on Thursday 13 November at 3pm": the date in full, never "tomorrow", since
 * the message is read whenever the link is opened, not when it was texted.
 */
export function fullWhen(at: Date, timeZone: string): string {
  // describeAppointmentWhen gives the full date for anything over a week away.
  return `on ${describeAppointmentWhen(at, timeZone, new Date(at.getTime() - 8 * 86_400_000))}`;
}

/** The link that opens the chat: WhatsApp with the message written; Instagram's chat as is. */
export function chatLink(chat: BookingChat, message: string): string {
  if (chat.kind === "whatsapp") {
    return `https://wa.me/${chat.number.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`;
  }
  return `https://ig.me/m/${encodeURIComponent(chat.username)}`;
}

/** The text itself: friendlier first, tighter when that would run past two segments. */
export function rebookBody(r: {
  firstName: string | null;
  forName?: string | null;
  service: string;
  whenText: string | null;
  stylist: string | null;
  link: string;
  businessName: string;
}): string {
  const hi = r.firstName ? `Hi ${r.firstName}, ` : "";
  const whose = r.forName ? `${r.forName}'s` : "your";
  const service = casual(r.service);
  const offer = (short: boolean) =>
    !r.whenText
      ? ""
      : short
        ? `${r.whenText.replace(/^on /, "")} is free. `
        : `${r.stylist ? `${r.stylist} has` : "We have"} ${r.whenText.replace(/^on /, "")} free. `;
  const say = (short: boolean) =>
    `${hi}${whose} ${service} is due. ${offer(short)}Book: ${r.link} Stop these: ${r.link}/stop ${r.businessName}`;
  const fits = (w: string) => smsSize(toGsm(w)).segments <= 2;
  return [say(false), say(true)].find(fits) ?? say(true);
}

function withArticle(name: string): string {
  const n = casual(name);
  if (/s$/.test(n) && !/ss$/.test(n)) return n;
  return `${/^[aeiou]/i.test(n) ? "an" : "a"} ${n}`;
}

/** Mid-sentence: "Gel manicure" → "gel manicure", but "BIAB infill" keeps its capitals. */
function casual(name: string): string {
  const n = name.trim();
  return /^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n;
}

/** The time a text offered, while it is still ahead; null once it has passed. */
export function offerStillOpen(at: Date | null, now: Date = new Date()): Date | null {
  return at && at.getTime() > now.getTime() ? at : null;
}

/** Short, unguessable, and easy to read in a text: the id in /r/<id>. */
export function newLinkId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
}

/** The app's own address, for the links: AUTH_URL. */
export function publicOrigin(): string {
  try {
    return new URL(process.env.AUTH_URL ?? "").origin;
  } catch {
    return "";
  }
}

// ─── The run ──────────────────────────────────────────────────────────────

export interface RebookCandidate {
  organizationId: string;
  appointmentId: string;
  leadId: string;
  to: string;
  firstName: string | null;
  forName: string | null;
  service: string;
  due: string;
  lastStylist: string;
  lastVisit: Date;
}

/** Why a salon is not sending, for the run's summary; null when it can. */
export async function salonCannotSend(organizationId: string, cfg: SalonConfig): Promise<string | null> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { rebookTextsEnabled: true, chatBookingEnabled: true },
  });
  if (!settings?.rebookTextsEnabled) return "rebooking texts are off";
  if (!settings.chatBookingEnabled) return "booking by message is off, so the link would not book";
  if (!(await bookingChatFor(organizationId))) return "no WhatsApp number or Instagram username to book through";
  const ready = bookingReadiness({ services: cfg.services, teamMembers: cfg.stylists, businessHours: cfg.hours, diaryProvider: cfg.diary });
  if (!ready.ready) return `the diary cannot take bookings yet (${ready.missing.join(", ")})`;
  if (!cfg.services.some((s) => s.rebookWeeks)) return "no service has a rebook time";
  return null;
}

/** The salon's clients due a rebooking text today. */
export async function dueClients(organizationId: string, cfg: SalonConfig, now: Date): Promise<RebookCandidate[]> {
  const tz = cfg.timeZone;
  const today = zonedDateString(now, tz);
  const longest = Math.max(...cfg.services.map((s) => s.rebookWeeks ?? 0));
  if (!longest) return [];
  const since = new Date(now.getTime() - (longest * 7 + LATE_DAYS + 1) * 86_400_000);

  // Their latest completed visit in the window, one per client.
  const visits = await prisma.appointment.findMany({
    where: { organizationId, status: "completed", startsAt: { gte: since, lte: now } },
    orderBy: { startsAt: "desc" },
    select: { id: true, leadId: true, serviceText: true, stylistName: true, startsAt: true },
  });
  const latest = new Map<string, (typeof visits)[number]>();
  for (const v of visits) if (!latest.has(v.leadId)) latest.set(v.leadId, v);

  const leadIds = [...latest.keys()];
  if (leadIds.length === 0) return [];
  const quietSince = new Date(now.getTime() - QUIET_DAYS * 86_400_000);
  const [leads, upcoming, texted] = await Promise.all([
    prisma.lead.findMany({
      where: { id: { in: leadIds }, rebookTextsOff: false, anonymisedAt: null },
      select: { id: true, name: true, phone: true, contactLead: { select: { name: true, phone: true } } },
    }),
    prisma.appointment.findMany({
      where: { organizationId, leadId: { in: leadIds }, status: "booked", startsAt: { gt: now } },
      select: { leadId: true },
    }),
    prisma.rebookText.findMany({
      where: {
        organizationId,
        OR: [{ appointmentId: { in: [...latest.values()].map((v) => v.id) } }, { leadId: { in: leadIds }, sentAt: { gte: quietSince } }],
      },
      select: { appointmentId: true, leadId: true },
    }),
  ]);
  const hasUpcoming = new Set(upcoming.map((u) => u.leadId));
  const textedVisit = new Set(texted.map((t) => t.appointmentId));
  const textedLead = new Set(texted.map((t) => t.leadId));

  const out: RebookCandidate[] = [];
  for (const lead of leads) {
    const visit = latest.get(lead.id)!;
    if (hasUpcoming.has(lead.id) || textedVisit.has(visit.id) || textedLead.has(lead.id)) continue;
    const service = rebookServiceFor(visit.serviceText, cfg.services);
    if (!service?.rebookWeeks) continue;
    const due = dueDate(zonedDateString(visit.startsAt, tz), service.rebookWeeks);
    if (!isDueToday(today, due)) continue;
    const to = textRecipient(lead);
    if (!to) continue;
    out.push({
      organizationId,
      appointmentId: visit.id,
      leadId: lead.id,
      to: to.to,
      firstName: to.greet ? to.greet.trim().split(/\s+/)[0] : null,
      forName: to.forName,
      service: service.rebookAs || service.name,
      due,
      lastStylist: visit.stylistName,
      lastVisit: visit.startsAt,
    });
  }
  return out;
}

/** A free time from their due date, with their last stylist if they can. */
export async function offerFor(c: RebookCandidate, cfg: SalonConfig, now: Date): Promise<TimeSlot | null> {
  const provider = selectProvider(cfg);
  if (!canReadAvailability(provider)) return null;
  const today = zonedDateString(now, cfg.timeZone);
  const from = c.due > today ? c.due : addCalendarDays(today, 1);
  const query = { organizationId: c.organizationId, date: from, serviceName: c.service, clientType: "returning" as const, searchDays: 7 };
  try {
    const theirs = cfg.stylists.some((s) => s.name === c.lastStylist)
      ? await provider.getAvailability({ ...query, stylistName: c.lastStylist })
      : [];
    const slots = theirs.length ? theirs : await provider.getAvailability(query);
    return pickSlot(slots, c.lastVisit, cfg.timeZone);
  } catch (err) {
    console.error("[REBOOK] availability failed:", err);
    return null;
  }
}

export interface RunSummary {
  organizationId: string;
  skipped?: string;
  due: number;
  sent: number;
  failed: number;
  wouldSend?: Array<{ to: string; text: string }>;
}

/** One salon's run. `dryRun` lists who would be texted, and what, without sending. */
export async function runRebookTexts(organizationId: string, opts: { now?: Date; dryRun?: boolean } = {}): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const cfg = await getSalonConfig(organizationId);
  const why = await salonCannotSend(organizationId, cfg);
  if (why) return { organizationId, skipped: why, due: 0, sent: 0, failed: 0 };

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { businessName: true },
  });
  const origin = publicOrigin();
  const due = (await dueClients(organizationId, cfg, now)).slice(0, PER_SALON_PER_RUN);
  const summary: RunSummary = { organizationId, due: due.length, sent: 0, failed: 0, ...(opts.dryRun ? { wouldSend: [] } : {}) };

  for (const c of due) {
    const slot = await offerFor(c, cfg, now);
    const whenText = slot ? describeAppointmentWhen(new Date(slot.start), cfg.timeZone, now) : null;
    const stylist = slot?.stylistName ?? null;
    const id = newLinkId();
    const text = rebookBody({
      firstName: c.firstName,
      forName: c.forName,
      service: c.service,
      whenText,
      stylist,
      link: `${origin}/r/${id}`,
      businessName: settings?.businessName || "the salon",
    });
    if (opts.dryRun) {
      summary.wouldSend!.push({ to: c.to, text });
      continue;
    }
    // Recorded first: a run that overlaps itself must not text twice for one visit.
    try {
      await prisma.rebookText.create({
        data: {
          id,
          organizationId,
          leadId: c.leadId,
          appointmentId: c.appointmentId,
          service: c.service,
          stylist,
          slotStartsAt: slot ? new Date(slot.start) : null,
        },
      });
    } catch {
      continue; // another run got there first
    }
    const result = await sendSms(organizationId, c.to, text);
    if (result.ok) summary.sent++;
    else {
      summary.failed++;
      await prisma.rebookText.update({ where: { id }, data: { sendError: result.reason.slice(0, 300) } });
    }
  }
  return summary;
}
