/**
 * The assistant behind the diary's microphone: staff say what they want, it
 * looks things up and draws a card, and the person saves it.
 *
 * Same conversation loop as the phone receptionist (ReceptionistEngine), with
 * a different job: the person speaking works at the salon, the answer is read
 * off a screen rather than heard, and its tools can only propose. There is no
 * tool that writes to the diary.
 */

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { getSalonConfig } from "@/lib/booking";
import { executeVapiFunction } from "@/lib/vapi-functions";
import { ReceptionistEngine, type StreamingClient } from "@/lib/receptionist/engine";
import { upcomingDays } from "@/lib/receptionist/prompt";
import { receptionistApiKey, receptionistModel } from "@/lib/receptionist/session";
import { findClients, proposeBooking, proposeCancel, proposeMove, upcomingBookings, type Asker, type Draft, type Proposal } from "./drafts";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_client",
    description:
      "Look a client up by name, as heard. Returns up to five, best first, with the last three digits of " +
      "their number. exactMatch means the whole name matched.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "find_bookings",
    description: "A client's upcoming bookings, for moving or cancelling one.",
    input_schema: { type: "object", properties: { clientId: { type: "string" } }, required: ["clientId"] },
  },
  {
    name: "check_availability",
    description: "Free times for a service on a day, to suggest one when the time asked for is not free.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "The day, in the words used ('Thursday', 'the 3rd')" },
        service: { type: "string" },
        stylist: { type: "string" },
      },
      required: ["date", "service"],
    },
  },
  {
    name: "propose_booking",
    description:
      "Show a new booking on screen for the person to save. Nothing is saved. Give clientId from find_client " +
      "for someone on the books, or clientName (and clientPhone if said) for a new client. Day and time in " +
      "the words used. Leave stylist out if none was said. Set skinTestDone only if they say the client has had one.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        clientName: { type: "string" },
        clientPhone: { type: "string" },
        service: { type: "string", description: "Every service, e.g. 'cut and finish and a toner'" },
        stylist: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
        skinTestDone: { type: "boolean" },
        notes: { type: "string" },
      },
      required: ["service", "date", "time"],
    },
  },
  {
    name: "propose_move",
    description:
      "Show a move of an existing booking on screen. appointmentId from find_bookings. Give only what changes: " +
      "a new day, a new time, or a new stylist.",
    input_schema: {
      type: "object",
      properties: {
        appointmentId: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
        stylist: { type: "string" },
      },
      required: ["appointmentId"],
    },
  },
  {
    name: "propose_cancel",
    description: "Show a cancellation of an existing booking on screen. appointmentId from find_bookings.",
    input_schema: { type: "object", properties: { appointmentId: { type: "string" } }, required: ["appointmentId"] },
  },
];

function instructions(business: string, speaker: string, stylistOnly: string | null): string {
  return `# You are the booking assistant in ${business}'s diary

Salon staff speak to you at the desk or on their phone to book, move or cancel
appointments. What they say reaches you through speech recognition, so names
and words may be slightly off: match them sensibly.

- To book: look the client up with find_client using the name as heard. One
  exactMatch, use it. Several people who could be meant, ask which in a few
  words ("Sarah Jones, number ending 123, or Sarah Johnson?"). Nobody, they are
  a new client: book them by name, and include a number only if one was said.
- Then call propose_booking with the service, day and time in the words used.
- To move or cancel: find_client, then find_bookings, then propose_move or
  propose_cancel. If they have several bookings, pick the one described; ask
  only if you cannot tell.
- You cannot save anything. propose_* puts a card on screen and the person
  saves it by saying yes or tapping Save. Never say it is booked, moved or
  cancelled.
- If a proposal is refused, say why in a few words and, for a time that is
  not free, offer the nearest free time using check_availability.
- "Make that half two", "with Marcus instead": call propose_* again with the
  change. The new card replaces the old one.
- Your reply is shown next to the card: one short sentence, no lists, e.g.
  "Sarah Jones, cut and finish, Thursday at 2 with Jo. Save it?"
- Bookings only. Politely say you can only help with the diary otherwise.

Speaking now: ${speaker}.${stylistOnly ? ` They are a stylist and can only book into their own column (${stylistOnly}).` : ""}`;
}

export interface VoiceBookingSession {
  id: string;
  asker: Asker;
  userId: string;
  engine: ReceptionistEngine;
  model: string;
  /** The card on screen, waiting for yes or no. */
  pending: Draft | null;
  lastUsed: number;
  busy: boolean;
}

export async function startVoiceBooking(
  asker: Asker,
  userId: string,
  opts: { speaker: string; client?: StreamingClient; now?: Date }
): Promise<VoiceBookingSession> {
  const key = opts.client ? null : await receptionistApiKey(asker.organizationId);
  if (!opts.client && !key) throw new Error("No Anthropic API key: neither this salon's own nor the shared one is set.");
  const cfg = await getSalonConfig(asker.organizationId);
  const { prisma } = await import("@/lib/prisma");
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: asker.organizationId },
    select: { businessName: true },
  });
  const now = opts.now ?? new Date();

  const session: VoiceBookingSession = {
    id: randomUUID(),
    asker,
    userId,
    model: receptionistModel(),
    pending: null,
    lastUsed: Date.now(),
    busy: false,
    engine: null as unknown as ReceptionistEngine,
  };

  const propose = async (p: Proposal) => {
    if (!p.ok) return p;
    session.pending = p.draft;
    return { ok: true, shownOnScreen: describeDraft(p.draft, cfg.timeZone) };
  };

  session.engine = new ReceptionistEngine({
    client: opts.client ?? new Anthropic({ apiKey: key!.apiKey }),
    model: session.model,
    maxTokens: 400,
    system: [
      {
        type: "text",
        text: [
          instructions(settings?.businessName || "the salon", opts.speaker, asker.role === "stylist" ? asker.stylist?.name ?? null : null),
          `# The salon\n\nTeam: ${cfg.stylists.map((s) => s.name).join(", ")}.\nServices: ${cfg.services
            .map((s) => `${s.name} (${s.durationMinutes} min${s.requiresPatchTest ? ", skin test for new clients" : ""})`)
            .join("; ")}.`,
        ].join("\n\n"),
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `It is ${now.toLocaleString("en-GB", { timeZone: cfg.timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} at the salon.\n\n${upcomingDays(cfg, now, 14)}`,
      },
    ],
    tools: TOOLS,
    execute: async (name, input) => {
      const i = input as Record<string, string | boolean | undefined>;
      switch (name) {
        case "find_client":
          return { clients: await findClients(asker.organizationId, String(i.name ?? "")) };
        case "find_bookings":
          return { bookings: await upcomingBookings(asker, String(i.clientId ?? ""), cfg) };
        case "check_availability":
          return executeVapiFunction("check_availability", asker.organizationId, {
            date: i.date,
            service: i.service,
            stylist: i.stylist,
            clientType: "returning",
          });
        case "propose_booking":
          return propose(
            await proposeBooking(asker, {
              clientId: str(i.clientId),
              clientName: str(i.clientName),
              clientPhone: str(i.clientPhone),
              service: str(i.service),
              stylist: str(i.stylist),
              date: str(i.date),
              time: str(i.time),
              skinTestDone: i.skinTestDone === true,
              notes: str(i.notes),
            })
          );
        case "propose_move":
          return propose(
            await proposeMove(asker, {
              appointmentId: str(i.appointmentId),
              date: str(i.date),
              time: str(i.time),
              stylist: str(i.stylist),
            })
          );
        case "propose_cancel":
          return propose(await proposeCancel(asker, { appointmentId: str(i.appointmentId) }));
        default:
          return { error: `There is no tool called ${name}.` };
      }
    },
  });

  // The conversation has to open with the person speaking; the first turn
  // is theirs, so there is nothing to seed.
  return session;
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** One line, as the assistant should read the card back. */
export function describeDraft(d: Draft, timeZone: string): string {
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true });
  if (d.kind === "book") return `${d.clientName}, ${d.service}, ${when(d.startsAt)} with ${d.stylist}${d.patchTestRequired ? " (skin test needed)" : ""}`;
  if (d.kind === "move") return `${d.clientName}'s ${d.service}, moving to ${when(d.startsAt)} with ${d.stylist}`;
  return `Cancel ${d.clientName}'s ${d.service}, ${when(d.startsAt)} with ${d.stylist}`;
}

// --- Sessions, in memory ------------------------------------------------------------------

const IDLE_MS = 15 * 60_000;
const g = globalThis as unknown as { __voiceBooking?: Map<string, VoiceBookingSession> };
const store: Map<string, VoiceBookingSession> = (g.__voiceBooking ??= new Map());

export function keepSession(s: VoiceBookingSession) {
  const now = Date.now();
  for (const [id, e] of store) if (now - e.lastUsed > IDLE_MS) store.delete(id);
  store.set(s.id, s);
}

/** Only for the person and salon that started it. */
export function findSession(id: string | undefined, organizationId: string, userId: string): VoiceBookingSession | null {
  if (!id) return null;
  const s = store.get(id);
  if (!s || s.asker.organizationId !== organizationId || s.userId !== userId) return null;
  if (Date.now() - s.lastUsed > IDLE_MS) {
    store.delete(id);
    return null;
  }
  s.lastUsed = Date.now();
  return s;
}

export function endSession(id: string) {
  store.delete(id);
}
