import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callback: {
      findMany: async () => [
        { id: "cb1", createdAt: new Date("2026-11-17T10:00:00Z"), notes: "About my fringe\nmore", lead: { name: "Mai", phone: "+447700900111", contactLead: null } },
        {
          id: "cb2",
          createdAt: new Date("2026-11-17T09:00:00Z"),
          notes: "COULD NOT BOOK: diary down\nWanted: BIAB infill with Lan at 2026-11-20T10:00:00.000Z",
          lead: { name: null, phone: "+447700900222", contactLead: null },
        },
      ],
      count: async () => 5,
    },
    quote: {
      findMany: async () => [
        {
          id: "q1",
          createdAt: new Date("2026-11-17T11:00:00Z"),
          clientName: "Luna",
          channel: "instagram",
          conversationId: "c1",
          items: [{ photoId: "p1" }, { photoId: "p2" }],
        },
      ],
      count: async () => 1,
    },
  },
}));
vi.mock("@/lib/booking-notices", () => ({
  openNotices: async () => ({
    total: 2,
    notices: [
      {
        id: "n1",
        createdAt: "2026-11-17T08:00:00.000Z",
        appointmentId: "a1",
        clientName: "Hannah",
        serviceText: "Gel polish",
        stylistName: "Jo",
        // 00:30 in London on the 21st, still the 20th in UTC.
        startsAt: "2026-11-21T00:30:00.000Z",
      },
    ],
  }),
}));
vi.mock("@/lib/booking", () => ({ getSalonConfig: async () => ({ timeZone: "Europe/London" }) }));

import { callbackLine, notificationsFor } from "./notifications";

describe("what is waiting on a person", () => {
  it("lists new bookings, callbacks and quotes, newest first, with whole counts", async () => {
    const n = await notificationsFor("u1", "org");
    expect(n.counts).toEqual({ booking: 2, callback: 5, quote: 1 });
    expect(n.total).toBe(8);
    expect(n.items.map((i) => i.key)).toEqual(["quote:q1", "callback:cb1", "callback:cb2", "booking:n1"]);
  });

  it("links each to where it is dealt with", async () => {
    const byKey = Object.fromEntries((await notificationsFor("u1", "org")).items.map((i) => [i.key, i]));
    expect(byKey["booking:n1"].href).toBe("/calendar?date=2026-11-21&booking=a1");
    expect(byKey["callback:cb1"].href).toBe("/callbacks?c=cb1");
    expect(byKey["quote:q1"]).toMatchObject({ href: expect.stringContaining("quote=1"), designs: 2, detail: "Instagram" });
  });

  it("names who it is about, by number when there is no name", async () => {
    const byKey = Object.fromEntries((await notificationsFor("u1", "org")).items.map((i) => [i.key, i]));
    expect(byKey["callback:cb2"]).toMatchObject({ name: "+447700900222", notBooked: true, detail: "BIAB infill with Lan" });
  });
});

describe("a callback's note, as one line", () => {
  it("is the message, or what they wanted when the diary would not book it", () => {
    expect(callbackLine("Ring about a refill")).toEqual({ line: "Ring about a refill", notBooked: false });
    expect(callbackLine("COULD NOT BOOK: x\nWanted: Cut with Jo at 2026-11-20T10:00:00.000Z")).toEqual({ line: "Cut with Jo", notBooked: true });
    expect(callbackLine(null)).toEqual({ line: "", notBooked: false });
  });
});
