import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Quotes for designs: filing one from a chat's photos, and sending the
 * salon's prices back, with the database and the senders stood in for.
 */

const db = vi.hoisted(() => ({
  photos: [] as Array<{ id: string; createdAt: Date }>,
  quotes: [] as Array<Record<string, unknown>>,
  lastClient: null as Date | null,
  socialMessages: [] as Array<Record<string, unknown>>,
  whatsappMessages: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatPhoto: { findMany: async () => db.photos.map((p) => ({ id: p.id })) },
    quote: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        db.quotes.find((q) => Object.entries(where).every(([k, v]) => q[k] === v)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `q${db.quotes.length + 1}`, status: "requested", clientName: null, clientPhone: null, ...data };
        db.quotes.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.quotes.find((q) => q.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    user: { findMany: async () => [{ id: "u1" }, { id: "u2" }] },
    whatsAppMessage: {
      findFirst: async () => (db.lastClient ? { createdAt: db.lastClient } : null),
      create: async ({ data }: { data: Record<string, unknown> }) => db.whatsappMessages.push(data),
    },
    socialMessage: {
      findFirst: async () => (db.lastClient ? { createdAt: db.lastClient } : null),
      create: async ({ data }: { data: Record<string, unknown> }) => db.socialMessages.push(data),
    },
    whatsAppConversation: { update: async () => ({}), findFirst: async () => ({ phoneNumber: "+447700900123" }) },
    socialConversation: { update: async () => ({}), findFirst: async () => ({ externalUserId: "ig-user-1" }) },
    phoneNumber: { findFirst: async () => ({ whatsappPhoneNumberId: "wa1" }) },
  },
}));

const push = vi.hoisted(() => ({ pushToUsers: vi.fn(async () => ({ sent: 2, failed: 0 })) }));
vi.mock("@/lib/push", () => push);
const sms = vi.hoisted(() => ({ sendSms: vi.fn(async () => ({ ok: true, sid: "SM1", sender: "Polished", segments: 1 })) }));
vi.mock("@/lib/sms", () => sms);
const meta = vi.hoisted(() => ({
  orgContextFor: vi.fn(async () => ({ organizationId: "org", accessToken: "EAA", accountId: "ig1" })),
  sendText: vi.fn(async () => ({ success: true, messageId: "mid.1" })),
}));
vi.mock("@/lib/meta-messaging", () => meta);
vi.mock("@/lib/meta-credentials", () => ({ whatsappSender: async () => ({ phoneNumberId: "wa1", accessToken: "t" }) }));
const wa = vi.hoisted(() => ({ sendTextMessage: vi.fn(async () => ({ success: true, messageId: "wamid.1" })) }));
vi.mock("@/lib/whatsapp", () => wa);

import { requestQuote, sendQuote, quoteUrl } from "./quotes";
import { quoteReply, quoteReady, ordinal, minutesText, parseQuoteItems } from "./quote-text";

const now = new Date("2026-11-14T12:00:00Z");

beforeEach(() => {
  db.photos = [
    { id: "p1", createdAt: now },
    { id: "p2", createdAt: now },
    { id: "p3", createdAt: now },
  ];
  db.quotes = [];
  db.lastClient = new Date(now.getTime() - 10 * 60_000);
  db.socialMessages = [];
  db.whatsappMessages = [];
  push.pushToUsers.mockClear();
  sms.sendSms.mockClear();
  meta.sendText.mockClear();
  wa.sendTextMessage.mockClear();
});

const ask = (over: Record<string, unknown> = {}) =>
  requestQuote({
    organizationId: "org",
    channel: "instagram",
    conversationId: "c1",
    customerName: "Jane",
    request: "BIAB, medium almond, 3 designs, Saturday",
    now,
    ...over,
  });

describe("filing a quote", () => {
  it("takes every photo from the chat, one design each, and tells everyone at the salon", async () => {
    const r = await ask();
    expect(r).toMatchObject({ success: true, designs: 3 });
    expect(parseQuoteItems(db.quotes[0].items).map((i) => i.photoId)).toEqual(["p1", "p2", "p3"]);
    expect(push.pushToUsers).toHaveBeenCalledWith(
      ["u1", "u2"],
      expect.objectContaining({
        title: "Quote needed: Jane",
        body: "3 designs on Instagram, waiting for a price",
        url: quoteUrl("instagram", "c1"),
      })
    );
  });

  it("tells the receptionist to ask for pictures when there are none", async () => {
    db.photos = [];
    expect(await ask()).toMatchObject({ success: false });
    expect(db.quotes).toHaveLength(0);
  });

  it("adds a picture sent later to the quote still waiting, rather than starting another", async () => {
    await ask();
    db.photos.push({ id: "p4", createdAt: now });
    await ask();
    expect(db.quotes).toHaveLength(1);
    expect(parseQuoteItems(db.quotes[0].items).map((i) => i.photoId)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("keeps their number, in full, for a text if the chat goes quiet", async () => {
    await ask({ customerPhone: "07700 900123" });
    expect(db.quotes[0].clientPhone).toBe("+447700900123");
  });
});

describe("sending a quote", () => {
  const priced = [
    { photoId: "p1", priceMinor: 4800, minutes: null, declined: false },
    { photoId: "p2", priceMinor: 4200, minutes: 90, declined: false },
    { photoId: "p3", priceMinor: null, minutes: null, declined: true },
  ];
  const send = (items: unknown = priced) =>
    sendQuote({ organizationId: "org", quoteId: "q1", items, from: "Lan", sentBy: "Lan Nguyen", now });

  it("sends the prices in the chat, as the salon's own message, and marks it sent", async () => {
    await ask();
    const r = await send();
    expect(r).toMatchObject({ ok: true, via: "chat" });
    const text = quoteReply(parseQuoteItems(priced), "Lan");
    expect(meta.sendText).toHaveBeenCalledWith(expect.anything(), "instagram", "ig-user-1", text);
    expect(db.socialMessages[0]).toMatchObject({ conversationId: "c1", role: "agent", content: text });
    expect(db.quotes[0]).toMatchObject({ status: "sent", sentBy: "Lan Nguyen", sentVia: "chat" });
  });

  it("refuses until every design has a price or is marked as not done", async () => {
    await ask();
    const r = await send([{ photoId: "p1", priceMinor: 4800, minutes: null, declined: false }]);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(meta.sendText).not.toHaveBeenCalled();
  });

  it("texts it once the chat's 24 hours have passed, when they gave a number", async () => {
    await ask({ customerPhone: "07700 900123" });
    db.lastClient = new Date(now.getTime() - 30 * 3_600_000);
    const r = await send();
    expect(r).toMatchObject({ ok: true, via: "sms" });
    expect(meta.sendText).not.toHaveBeenCalled();
    expect(sms.sendSms).toHaveBeenCalledWith("org", "+447700900123", expect.stringContaining("£48"));
    expect(String(db.socialMessages[0].content)).toContain("Sent by text message");
  });

  it("says why when the chat has closed and there is no number to text", async () => {
    await ask();
    db.lastClient = new Date(now.getTime() - 30 * 3_600_000);
    const r = await send();
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(db.quotes[0].status).toBe("requested");
  });

  it("sends on WhatsApp to their number", async () => {
    await ask({ channel: "whatsapp" });
    await send();
    expect(wa.sendTextMessage).toHaveBeenCalledWith(expect.anything(), "+447700900123", expect.stringContaining("£42"));
    expect(db.whatsappMessages[0]).toMatchObject({ role: "agent", waMessageId: "wamid.1" });
  });

  it("is not sent twice", async () => {
    await ask();
    await send();
    expect(await send()).toMatchObject({ ok: false, status: 409 });
  });
});

describe("the reply", () => {
  it("lists each design by its order, with the price as entered and the time when given", () => {
    expect(
      quoteReply(
        [
          { photoId: "a", priceMinor: 4800, minutes: null, declined: false },
          { photoId: "b", priceMinor: 4250, minutes: 90, declined: false },
          { photoId: "c", priceMinor: null, minutes: null, declined: true },
        ],
        "Lan"
      )
    ).toBe(
      [
        "Thanks for waiting! Here are the prices from Lan:",
        "1st design: £48",
        "2nd design: £42.50, about 1h 30",
        "3rd design: not one we do, sorry",
        "Would you like to book one? Just say which.",
      ].join("\n")
    );
  });

  it("is one line for one design, from the team when nobody is named", () => {
    expect(quoteReply([{ photoId: "a", priceMinor: 6000, minutes: 120, declined: false }], null)).toBe(
      "Thanks for waiting! The team says that design would be £60, about 2h. Would you like to book it?"
    );
  });

  it("is ready only when every design is answered and one is priced", () => {
    const d = (priceMinor: number | null, declined = false) => ({ photoId: "x", priceMinor, minutes: null, declined });
    expect(quoteReady([d(4800), d(null, true)])).toBe(true);
    expect(quoteReady([d(4800), d(null)])).toBe(false);
    expect(quoteReady([d(null, true)])).toBe(false);
  });

  it("counts and times as people say them", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
    expect([45, 60, 90, 150].map(minutesText)).toEqual(["45 min", "1h", "1h 30", "2h 30"]);
  });
});
