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

import {
  bookedText,
  bookingChatReply,
  carryOver,
  EARLIER_LEFT_OUT,
  chatReply,
  CHAT_SESSION_IDLE_MS,
  forSaving,
  fromMessages,
  sorryText,
  splitPending,
  withColleague,
} from "./chat-booking";
import { buildChatSystem, buildSystem } from "@/lib/receptionist/prompt";
import type { SalonConfig } from "@/lib/booking";

type Reply = { text?: string; tool?: { name: string; input: Record<string, unknown> } };

/** A model that answers request n with script[n]. */
function model(script: Reply[]) {
  const requests: Anthropic.MessageParam[][] = [];
  const tools: string[][] = [];
  const systems: string[] = [];
  const client: StreamingClient = {
    messages: {
      stream(params) {
        requests.push(JSON.parse(JSON.stringify(params.messages)));
        tools.push((params.tools ?? []).map((t) => (t as { name: string }).name));
        systems.push(JSON.stringify(params.system));
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
  return { client, requests, tools, systems };
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

  it("on the website chat, tells it the number they gave, books with no photos, and says where it was booked", async () => {
    const contacts: Array<{ phone: string; name: string | null }> = [];
    const web = { channel: "website" as const, phone: null, conversationId: "w1", onContact: (c: { phone: string; name: string | null }) => contacts.push(c) };
    const withNumber = { tool: { name: "prepare_booking", input: { ...prepare.tool.input, customerPhone: "07700 900123" } } };
    await bookingChatReply(turn("BIAB Thursday 3, Roy, 07700 900123", model([withNumber, readBack]).client, web));
    expect(contacts).toEqual([{ phone: "07700 900123", name: "Roy" }]);
    photos.attachPhotosToBooking.mockClear();
    await bookingChatReply(turn("yes please", model([book, booked]).client, web));
    expect(actions.runAction).toHaveBeenCalledWith(
      "book_appointment",
      "org",
      expect.objectContaining({ notes: "Booked by website chat message." })
    );
    expect(photos.attachPhotosToBooking).not.toHaveBeenCalled();
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
  const broken: StreamingClient = {
    messages: {
      stream() {
        throw new Error("overloaded");
      },
    },
  };

  it("gives null, for the plain chat, to a business that does not use the diary", async () => {
    db.settings = { chatBookingEnabled: false, diaryEnabled: false, voiceEnabled: false };
    expect(await chatReply(turn("hi", model([{ text: "x" }]).client))).toBeNull();
  });

  it("where booking by message is off, still answers as the receptionist, with the number and a call back", async () => {
    db.settings = { chatBookingEnabled: false, diaryEnabled: true, businessName: "Polished", contactPhone: "01234 567890" };
    const m = model([{ text: "You can ring us on 01234 567890 to book, or we can ring you. Which would you prefer?" }]);
    expect(await chatReply(turn("Can I book a BIAB?", m.client))).toContain("01234 567890");
    expect(m.tools[0]).toEqual(expect.arrayContaining(["book_callback", "take_message"]));
    expect(m.tools[0]).not.toContain("prepare_booking");
    expect(m.systems[0]).toContain("You cannot book, or see the diary, in this chat.");
    expect(m.systems[0]).toContain("You can ring us on\\n01234 567890 to book");
  });

  it("tries twice, then says sorry with the salon's number, never an error", async () => {
    db.settings = { ...db.settings, contactPhone: "01234 567890" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await chatReply(turn("hi", broken))).toBe(sorryText("01234 567890"));
    expect(err.mock.calls.filter((c) => String(c[0]).includes("reply failed"))).toHaveLength(2);
    err.mockRestore();
  });

  it("says what was booked when it fails after booking, and does not try again", async () => {
    // Read back first, so the yes books.
    await bookingChatReply(turn("BIAB Thursday 3, Roy", model([prepare, readBack]).client));
    actions.runAction.mockResolvedValueOnce({
      success: true,
      bookingNumber: 1043,
      service: "BIAB infill",
      stylist: "Lan",
      startsAt: "2026-11-12T15:00:00+00:00",
      textSent: true,
      message: "Booked.",
    } as never);
    // The model books, then fails writing what to say.
    let n = 0;
    const failsAfterBooking: StreamingClient = {
      messages: {
        stream(params) {
          n++;
          if (n > 1) throw new Error("overloaded");
          return model([book]).client.messages.stream(params);
        },
      },
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await chatReply(turn("yes", failsAfterBooking))).toBe(
      "You're booked: BIAB infill with Lan, Thursday 12 November at 3pm. A text is on its way."
    );
    expect(actions.runAction).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

describe("what is said when a reply fails", () => {
  it("names the booking, with the time as people write it", () => {
    expect(
      bookedText({ service: "Gel manicure", stylist: "Mai", startsAt: "2026-11-13T14:30:00+00:00", textSent: false, timeZone: "Europe/London" })
    ).toBe("You're booked: Gel manicure with Mai, Friday 13 November at 2:30pm.");
  });
  it("leaves the number out when the salon has none", () => {
    expect(sorryText(null)).toBe("Sorry, I couldn't reply properly just then. Could you send that again in a minute?");
  });
});

describe("the salon's own replies", () => {
  it("are shown as the salon's, not the bot's, when starting afresh", async () => {
    const later = new Date(Date.now() + CHAT_SESSION_IDLE_MS + 60_000);
    const m = model([{ text: "Friday it is." }]);
    await bookingChatReply(
      turn("Friday then", m.client, {
        now: later,
        earlier: [
          { role: "user", content: "Is Lan in Thursday?", createdAt: new Date(later.getTime() - 60_000) },
          { role: "agent", content: "Sorry, Lan is off Thursday", createdAt: new Date(later.getTime() - 30_000) },
        ],
      })
    );
    expect(m.requests[0][1]).toEqual({ role: "assistant", content: "[From the salon's team] Sorry, Lan is off Thursday" });
    expect(m.systems[0]).toContain("were written by someone from the salon, not by you");
  });

  it("are seen when written since the last reply", async () => {
    await bookingChatReply(turn("Is Lan in Thursday?", model([{ text: "Let me check." }]).client));
    const m = model([{ text: "Friday at 3pm then?" }]);
    await bookingChatReply(
      turn("Friday then", m.client, {
        earlier: [
          { role: "user", content: "Is Lan in Thursday?", createdAt: new Date(Date.now() - 60_000) },
          { role: "assistant", content: "Let me check.", createdAt: new Date(Date.now() - 50_000) },
          { role: "agent", content: "Lan is off Thursday, sorry", createdAt: new Date(Date.now() + 1_000) },
        ],
      })
    );
    const last = m.requests[0].at(-2)!;
    expect(last.role).toBe("assistant");
    expect(JSON.stringify(last.content)).toContain("[From the salon's team] Lan is off Thursday, sorry");
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
      { role: "assistant", content: "[From the salon's team] Yes" },
    ]);
  });

  it("joins messages sent one after another", () => {
    expect(
      fromMessages([
        { role: "user", content: "Hi" },
        { role: "user", content: "Can I book?" },
      ])
    ).toEqual([{ role: "user", content: "Hi\n\nCan I book?" }]);
  });

  it("carries over only the last ten, and nothing from before a quiet spell", () => {
    const now = new Date("2026-11-14T11:43:00Z");
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    // The chat in question: a time offered on Wednesday night, a new message on Saturday morning.
    const stale = [
      { role: "user", content: "Full set and can i get the earliest available time pls", createdAt: hoursAgo(37) },
      { role: "assistant", content: "The earliest is tomorrow, Thursday 12 November at 9am. Does that suit you?", createdAt: hoursAgo(37) },
    ];
    expect(carryOver(stale, now).messages).toEqual([]);

    const recent = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `m${i}`,
      createdAt: hoursAgo(6 - i * 0.1),
    }));
    const { messages } = carryOver([...stale, ...recent], now);
    expect(JSON.stringify(messages)).not.toContain("Thursday");
    expect(JSON.stringify(messages)).not.toContain('"m1"');
    expect(messages[0]).toEqual({ role: "user", content: "m2" });
  });

  it("keeps a reply the salon's staff wrote within the last few hours", () => {
    const now = new Date("2026-11-14T11:43:00Z");
    const rows = [
      { role: "user", content: "Can I come Saturday?", createdAt: new Date(now.getTime() - 20 * 3_600_000) },
      { role: "agent", content: "We can do 2pm Saturday, shall I book it?", createdAt: new Date(now.getTime() - 3 * 3_600_000) },
    ];
    expect(carryOver(rows, now).messages).toEqual([
      { role: "user", content: EARLIER_LEFT_OUT },
      { role: "assistant", content: "[From the salon's team] We can do 2pm Saturday, shall I book it?" },
    ]);
  });

  it("joins the salon's replies onto the last one", () => {
    expect(
      withColleague(
        [
          { role: "user", content: "x" },
          { role: "assistant", content: "Let me check." },
        ],
        [{ role: "agent", content: "Off Thursday" }]
      )
    ).toEqual([
      { role: "user", content: "x" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "text", text: "[From the salon's team] Off Thursday" },
        ],
      },
    ]);
  });

  it("answers everything they sent since the last reply", () => {
    const rows = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "user", content: "d" },
    ];
    expect(splitPending(rows)).toEqual({ earlier: rows.slice(0, 2), pending: rows.slice(2) });
    expect(splitPending([...rows, { role: "agent", content: "e" }]).pending).toEqual([]);
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

  it("ask the website chat for a number, naming it as the salon's own", () => {
    const [stable, context] = buildChatSystem(cfg, "Polished", "website", null, now, null);
    expect(stable.text).toContain("You answer the salon's website chat messages for Polished");
    expect(context.text).toContain("messaging on the salon's website chat, which gives no phone number");
  });

  it("ask Instagram and Messenger for a number", () => {
    const [, context] = buildChatSystem(cfg, "Polished", "instagram", null, now, null);
    expect(context.text).toContain("messaging on Instagram, which gives no phone number");
  });
});
