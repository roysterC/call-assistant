import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { StreamingClient } from "@/lib/receptionist/engine";

/**
 * Booking by message, with the real engine and read-back, the salon's
 * settings and diary stood in for, and a model that answers each request
 * with the next scripted reply.
 */

const db = vi.hoisted(() => ({
  settings: { chatBookingEnabled: true, businessName: "Polished", voiceSystemPrompt: null, salonFaq: null } as Record<
    string,
    unknown
  > | null,
  sessions: new Map<string, { messages: unknown; state: unknown; createdAt: Date; updatedAt: Date }>(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationSettings: { findUnique: async () => db.settings },
    chatSession: {
      findUnique: async ({ where }: { where: { channel_conversationId: { channel: string; conversationId: string } } }) => {
        const k = `${where.channel_conversationId.channel}:${where.channel_conversationId.conversationId}`;
        return db.sessions.get(k) ?? null;
      },
      upsert: async (args: {
        where: { channel_conversationId: { channel: string; conversationId: string } };
        create: { messages: unknown; state: unknown };
        update: { messages: unknown; state: unknown; createdAt?: Date };
      }) => {
        const k = `${args.where.channel_conversationId.channel}:${args.where.channel_conversationId.conversationId}`;
        const old = db.sessions.get(k);
        const now = new Date();
        const row = old
          ? { ...old, ...args.update, createdAt: args.update.createdAt ?? old.createdAt, updatedAt: now }
          : { messages: args.create.messages, state: args.create.state, createdAt: now, updatedAt: now };
        db.sessions.set(k, JSON.parse(JSON.stringify(row), (key, v) => (key.endsWith("At") ? new Date(v) : v)));
        return row;
      },
    },
  },
}));

const caps = vi.hoisted(() => ({
  readAvailability: true,
  createBooking: true,
  perStaffAvailability: true,
  forwardSearch: true,
  availabilityIsAdvisory: false,
}));
vi.mock("@/lib/booking", () => ({
  getSalonConfig: async () => ({
    diary: "native",
    timeZone: "Europe/London",
    hours: [{ day: 4, closed: false, open: "09:00", close: "18:00" }],
    services: [{ name: "BIAB infill", durationMinutes: 60, requiresPatchTest: false, priceMinor: 3500 }],
    stylists: [{ name: "Lan", workingDays: [4], services: [], bookable: true }],
    calComApiKey: null,
    calComEventTypeId: null,
    businessTypes: ["nails"],
  }),
  selectProvider: () => ({ id: "native", capabilities: caps }),
  explainProviderSelection: () => [],
}));

const photos = vi.hoisted(() => ({ attachPhotosToBooking: vi.fn(async () => 1) }));
vi.mock("@/lib/chat-photos", () => photos);

const actions = vi.hoisted(() => ({
  runAction: vi.fn(async () => ({ success: true, bookingNumber: 1043, message: "Booked. A text has gone." })),
  handleBookAppointment: vi.fn(async () => ({
    success: true,
    ready: true,
    service: "BIAB infill",
    durationMinutes: 60,
    stylist: "Lan",
    startsAt: "2026-11-12T15:00:00+00:00",
    when: "Thursday 12 November at 3pm",
    clientName: "Roy",
    phone: "+447700900123",
    usedCallerId: true,
    patchTestRequired: false,
  })),
}));
vi.mock("@/lib/receptionist/actions", () => ({
  ...actions,
  isActionName: () => true,
  normaliseParameters: (p: Record<string, unknown>) => p,
}));
vi.mock("@/lib/receptionist/session", () => ({
  receptionistApiKey: async () => null,
  receptionistModel: () => "claude-haiku-5-5",
  receptionistRequestOptions: () => ({}),
}));

import { bookingChatReply, bookingReply, CHAT_SESSION_IDLE_MS, forSaving, fromMessages } from "./chat-booking";
import { buildChatSystem, buildSystem } from "@/lib/receptionist/prompt";
import type { SalonConfig } from "@/lib/booking";

type Reply = { text?: string; tool?: { name: string; input: Record<string, unknown> } };

/** A model that answers request n with script[n]. */
function model(script: Reply[]) {
  const requests: Anthropic.MessageParam[][] = [];
  const client: StreamingClient = {
    messages: {
      stream(params) {
        requests.push(JSON.parse(JSON.stringify(params.messages)));
        const r = script[Math.min(requests.length - 1, script.length - 1)];
        let onText: ((d: string) => void) | null = null;
        const n = requests.length;
        return {
          on(_e: "text", l: (d: string) => void) {
            onText = l;
            return this;
          },
          finalMessage: async () => {
            if (r.text) onText?.(r.text);
            return {
              id: `m${n}`,
              type: "message",
              role: "assistant",
              model: "test",
              content: [
                { type: "thinking", thinking: "", signature: "sig" },
                ...(r.text ? [{ type: "text", text: r.text, citations: null }] : []),
                ...(r.tool ? [{ type: "tool_use", id: `t${n}`, name: r.tool.name, input: r.tool.input }] : []),
              ],
              stop_reason: r.tool ? "tool_use" : "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            } as unknown as Anthropic.Message;
          },
        };
      },
    },
  };
  return { client, requests };
}

const turn = (text: string, client: StreamingClient, over: Record<string, unknown> = {}) => ({
  organizationId: "org",
  channel: "whatsapp" as const,
  conversationId: "c1",
  earlier: [],
  text,
  phone: "+447700900123",
  client,
  ...over,
});

const prepare = { tool: { name: "prepare_booking", input: { date: "Thursday", time: "3pm", service: "BIAB infill", customerName: "Roy" } } };
const readBack = { text: "BIAB infill with Lan, Thursday 12 November at 3pm, for Roy. Shall I book it?" };
const book = { tool: { name: "book_appointment", input: { bookingRef: "R1" } } };
const booked = { text: "That's booked, and a text is on its way." };

beforeEach(() => {
  db.sessions.clear();
  db.settings = { chatBookingEnabled: true, businessName: "Polished", voiceSystemPrompt: null, salonFaq: null };
  actions.runAction.mockClear();
  actions.handleBookAppointment.mockClear();
});

describe("booking by message", () => {
  it("reads back in one message and books on the yes in the next, with their WhatsApp number", async () => {
    const first = model([prepare, readBack]);
    expect(await bookingChatReply(turn("BIAB infill Thursday 3pm please, I'm Roy", first.client))).toBe(readBack.text);
    expect(actions.runAction).not.toHaveBeenCalled();

    const second = model([book, booked]);
    expect(await bookingChatReply(turn("yes please", second.client))).toBe(booked.text);
    expect(actions.runAction).toHaveBeenCalledWith(
      "book_appointment",
      "org",
      expect.objectContaining({
        customerName: "Roy",
        stylist: "Lan",
        time: "2026-11-12T15:00:00+00:00",
        callerNumber: "+447700900123",
        // The diary would otherwise say it was booked by phone.
        notes: "Booked by WhatsApp message.",
      })
    );
    // A photo they sent goes with the booking.
    expect(photos.attachPhotosToBooking).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org", channel: "whatsapp", conversationId: "c1", bookingNumber: 1043 })
    );
    // The second message carried on from the first, diary checks and all.
    const history = second.requests[0];
    expect(history.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"))).toBe(true);
    expect(history.at(-1)).toEqual({ role: "user", content: "yes please" });
  });

  it("never books in the same message as the read-back", async () => {
    const m = model([prepare, book, readBack]);
    await bookingChatReply(turn("Book me BIAB Thursday 3, Roy", m.client));
    expect(actions.runAction).not.toHaveBeenCalled();
  });

  it("asks Instagram for a number, and passes none to the tools", async () => {
    const m = model([prepare, readBack]);
    await bookingChatReply(turn("BIAB Thursday 3", m.client, { channel: "instagram", phone: null }));
    const call = (actions.handleBookAppointment.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0];
    expect(call[1]).not.toHaveProperty("callerNumber");
  });

  it("starts again from the messages after a quiet spell, with nothing read back", async () => {
    await bookingChatReply(turn("BIAB Thursday 3, Roy", model([prepare, readBack]).client));
    const later = new Date(Date.now() + CHAT_SESSION_IDLE_MS + 60_000);
    const m = model([book, { text: "Sorry, which day was that?" }]);
    await bookingChatReply(
      turn("yes", m.client, {
        now: later,
        earlier: [
          { role: "user", content: "BIAB Thursday 3, Roy" },
          { role: "assistant", content: readBack.text },
        ],
      })
    );
    expect(actions.runAction).not.toHaveBeenCalled();
    expect(m.requests[0]).toEqual([
      { role: "user", content: "BIAB Thursday 3, Roy" },
      { role: "assistant", content: readBack.text },
      { role: "user", content: "yes" },
    ]);
  });

  it("starts again after the conversation was reset for a new prompt", async () => {
    await bookingChatReply(turn("BIAB Thursday 3, Roy", model([prepare, readBack]).client));
    const m = model([book, { text: "Which day?" }]);
    await bookingChatReply(turn("yes", m.client, { resetAt: new Date(Date.now() + 1000) }));
    expect(actions.runAction).not.toHaveBeenCalled();
  });

  it("answers one conversation's messages one at a time", async () => {
    const order: string[] = [];
    const slow = model([{ text: "first" }]).client;
    const fast = model([{ text: "second" }]).client;
    await Promise.all([
      bookingChatReply(turn("a", slow)).then((t) => order.push(t)),
      bookingChatReply(turn("b", fast)).then((t) => order.push(t)),
    ]);
    expect(order).toEqual(["first", "second"]);
    const saved = db.sessions.get("whatsapp:c1")!.messages as Anthropic.MessageParam[];
    expect(saved.filter((x) => x.role === "user").map((x) => x.content)).toEqual(["a", "b"]);
  });
});

describe("the webhooks' way in", () => {
  it("gives null, for the plain chat, where booking by message is off", async () => {
    db.settings = { chatBookingEnabled: false };
    expect(await bookingReply(turn("hi", model([{ text: "x" }]).client))).toBeNull();
  });

  it("gives null, for the plain chat, if anything goes wrong", async () => {
    const broken: StreamingClient = {
      messages: {
        stream() {
          throw new Error("overloaded");
        },
      },
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await bookingReply(turn("hi", broken))).toBeNull();
    err.mockRestore();
  });
});

describe("what is kept between messages", () => {
  it("starts the history with their words, and leaves out empty messages", () => {
    expect(
      fromMessages([
        { role: "assistant", content: "Hi!" },
        { role: "user", content: "  " },
        { role: "user", content: "Gel nails?" },
        { role: "agent", content: "Yes" },
      ])
    ).toEqual([
      { role: "user", content: "Gel nails?" },
      { role: "assistant", content: "Yes" },
    ]);
  });

  it("drops the model's reasoning, and never keeps a tool call without its result", () => {
    const toolTurn: Anthropic.MessageParam[] = [
      { role: "user", content: "x" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "s" },
          { type: "tool_use", id: "t", name: "check_availability", input: {} },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "{}" }] },
      { role: "assistant", content: "Thursday at 3?" },
    ];
    const long = Array.from({ length: 30 }, () => toolTurn).flat();
    const kept = forSaving(long);
    expect(kept.length).toBeLessThanOrEqual(60);
    expect(kept[0]).toEqual({ role: "user", content: "x" });
    expect(JSON.stringify(kept)).not.toContain('"thinking"');
  });
});

describe("the instructions for a chat", () => {
  const cfg = {
    diary: "native",
    timeZone: "Europe/London",
    hours: [{ day: 4, closed: false, open: "09:00", close: "18:00" }],
    services: [{ name: "BIAB infill", durationMinutes: 60, requiresPatchTest: false, priceMinor: 3500 }],
    stylists: [{ name: "Lan", workingDays: [4], services: [], bookable: true }],
    businessTypes: ["nails"],
  } as unknown as SalonConfig;
  const now = new Date("2026-11-09T10:00:00Z");

  it("are the phone's booking rules, written for messages, with no call to end", () => {
    const [stable, context] = buildChatSystem(cfg, "Polished", "whatsapp", null, now, "+447700900123");
    expect(stable.text).toContain("You answer WhatsApp messages for Polished");
    expect(stable.text).toContain("Read it back before you book");
    expect(stable.text).toContain("Do not name the nail technician");
    expect(stable.text).not.toContain("# Ending the call");
    expect(stable.text).not.toContain("read it out, digit by digit");
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(context.text).toContain("from their own number");
    expect(buildSystem(cfg, "Polished", null, now, null)[0].text).toContain("# Ending the call");
  });

  it("ask one thing per message, with no opener", () => {
    const [stable] = buildChatSystem(cfg, "Polished", "instagram", null, now, null);
    expect(stable.text).toContain("One question per message, and it is the last thing in it.");
    expect(stable.text).toContain("which service, then the day, then");
    expect(stable.text).toContain('No openers: no "Great.", "Got');
    // The phone keeps its own, spoken, rules.
    expect(buildSystem(cfg, "Polished", null, now, null)[0].text).not.toContain("reads like a form");
  });

  it("ask Instagram and Messenger for a number", () => {
    const [, context] = buildChatSystem(cfg, "Polished", "instagram", null, now, null);
    expect(context.text).toContain("messaging on Instagram, which gives no phone number");
  });
});
