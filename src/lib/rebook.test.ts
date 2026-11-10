import { beforeEach, describe, expect, it, vi } from "vitest";
import { smsSize, toGsm } from "@/lib/sms-encoding";

/**
 * Rebooking texts: who is due, which time is offered, what the text says,
 * and that a run never texts anyone twice. The database, diary and Twilio
 * are stood in for.
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  whatsapp: null as { number: string } | null,
  visits: [] as Row[],
  upcoming: [] as Row[],
  leads: [] as Row[],
  texts: [] as Row[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationSettings: { findUnique: async () => db.settings },
    phoneNumber: { findFirst: async () => db.whatsapp },
    appointment: {
      findMany: async ({ where }: { where: { status: string } }) =>
        where.status === "completed" ? db.visits : db.upcoming,
    },
    lead: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        db.leads.filter((l) => where.id.in.includes(l.id as string) && !l.rebookTextsOff),
    },
    rebookText: {
      findMany: async () => db.texts,
      create: async ({ data }: { data: Row }) => {
        if (db.texts.some((t) => t.appointmentId === data.appointmentId)) throw new Error("unique");
        db.texts.push({ ...data });
        return data;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const t = db.texts.find((x) => x.id === where.id)!;
        Object.assign(t, data);
        return t;
      },
    },
  },
}));

const diary = vi.hoisted(() => ({
  getAvailability: vi.fn<(q: { stylistName?: string }) => Promise<Array<{ start: string; end: string; stylistName?: string }>>>(
    async () => []
  ),
}));
vi.mock("@/lib/booking", () => ({
  getSalonConfig: async () => ({
    diary: "native",
    timeZone: "Europe/London",
    hours: [{ day: 4, closed: false, open: "09:00", close: "18:00" }],
    services: [
      { name: "BIAB new set", durationMinutes: 60, requiresPatchTest: false, priceMinor: 4000, rebookWeeks: 3, rebookAs: "BIAB infill" },
      { name: "BIAB infill", durationMinutes: 60, requiresPatchTest: false, priceMinor: 3500, rebookWeeks: 3 },
      { name: "Gel removal", durationMinutes: 20, requiresPatchTest: false, priceMinor: 1000 },
    ],
    stylists: [
      { name: "Lan", workingDays: [4], services: [], bookable: true },
      { name: "Mai", workingDays: [4], services: [], bookable: true },
    ],
    calComApiKey: null,
    calComEventTypeId: null,
    businessTypes: ["nails"],
  }),
  selectProvider: () => ({
    id: "native",
    capabilities: { readAvailability: true, createBooking: true },
    getAvailability: diary.getAvailability,
  }),
  canReadAvailability: () => true,
}));

const sms = vi.hoisted(() => ({
  sendSms: vi.fn<
    (org: string, to: string, body: string) => Promise<
      { ok: true; sid: string; sender: string; segments: number } | { ok: false; reason: string; configured: boolean }
    >
  >(async () => ({ ok: true, sid: "SM1", sender: "Polished", segments: 2 })),
}));
vi.mock("@/lib/sms", () => sms);

import {
  chatLink,
  chatMessage,
  dueDate,
  fullWhen,
  isDueToday,
  pickSlot,
  rebookBody,
  rebookServiceFor,
  runRebookTexts,
} from "@/lib/rebook";

const services = [
  { name: "BIAB infill", durationMinutes: 60, requiresPatchTest: false, priceMinor: null, rebookWeeks: 3 },
  { name: "BIAB infill and art", durationMinutes: 75, requiresPatchTest: false, priceMinor: null, rebookWeeks: 4 },
  { name: "Gel removal", durationMinutes: 20, requiresPatchTest: false, priceMinor: null },
];

describe("which service a visit was", () => {
  it("takes the longest name that has a rebook time", () => {
    expect(rebookServiceFor("BIAB infill and art", services)?.rebookWeeks).toBe(4);
    expect(rebookServiceFor("biab infill + gel removal", services)?.name).toBe("BIAB infill");
  });
  it("is nothing for a service without one", () => {
    expect(rebookServiceFor("Gel removal", services)).toBeNull();
  });
});

describe("when they are due", () => {
  it("is the visit day plus the weeks", () => {
    expect(dueDate("2026-10-20", 3)).toBe("2026-11-10");
  });
  it("texts from three days before to two weeks after", () => {
    expect(isDueToday("2026-11-06", "2026-11-10")).toBe(false);
    expect(isDueToday("2026-11-07", "2026-11-10")).toBe(true);
    expect(isDueToday("2026-11-24", "2026-11-10")).toBe(true);
    expect(isDueToday("2026-11-25", "2026-11-10")).toBe(false);
  });
});

describe("the time offered", () => {
  const slot = (start: string) => ({ start, end: start });
  it("is on the first free day, nearest the time they came last", () => {
    const last = new Date("2026-10-20T17:00:00Z"); // 6pm BST
    const picked = pickSlot(
      [slot("2026-11-13T09:00:00Z"), slot("2026-11-12T10:00:00Z"), slot("2026-11-12T17:30:00Z"), slot("2026-11-12T13:00:00Z")],
      last,
      "Europe/London"
    );
    expect(picked?.start).toBe("2026-11-12T17:30:00Z");
  });
  it("is nothing when nothing is free", () => {
    expect(pickSlot([], new Date(), "Europe/London")).toBeNull();
  });
});

describe("the message they send to book", () => {
  it("has the service, the time and the stylist", () => {
    expect(
      chatMessage({ firstName: "Mai", service: "BIAB infill", whenText: "on Thursday 12 November at 3pm", stylist: "Lan" })
    ).toBe("Hi, it's Mai. Could I book a BIAB infill on Thursday 12 November at 3pm with Lan?");
  });
  it("asks for a time when none is offered, and says who it is for", () => {
    expect(chatMessage({ firstName: "Sue", forName: "Lily", service: "Acrylic infill", whenText: null, stylist: null })).toBe(
      "Hi, it's Sue. I'd like to book an acrylic infill for Lily. When are you free?"
    );
  });
  it("gives the date in full, never \"tomorrow\"", () => {
    expect(fullWhen(new Date("2026-11-11T15:00:00Z"), "Europe/London")).toBe("on Wednesday 11 November at 3pm");
  });
  it("opens WhatsApp with it written, and Instagram's chat", () => {
    expect(chatLink({ kind: "whatsapp", number: "+44 7700 900123" }, "Hi there")).toBe("https://wa.me/447700900123?text=Hi%20there");
    expect(chatLink({ kind: "instagram", username: "hoang.nails" }, "Hi")).toBe("https://ig.me/m/hoang.nails");
  });
});

describe("the text", () => {
  const base = {
    firstName: "Mai",
    service: "BIAB infill",
    whenText: "Thursday at 3pm",
    stylist: "Lan",
    link: "https://89-58-45-110.nip.io/r/Ab3kQ9xYz2",
    businessName: "Hoang Nail Salon",
  };
  it("offers the time and has both links, in two texts at most", () => {
    const t = rebookBody(base);
    expect(t).toBe(
      "Hi Mai, your BIAB infill is due. Lan has Thursday at 3pm free. Book: https://89-58-45-110.nip.io/r/Ab3kQ9xYz2 Stop these: https://89-58-45-110.nip.io/r/Ab3kQ9xYz2/stop Hoang Nail Salon"
    );
    expect(smsSize(toGsm(t)).segments).toBeLessThanOrEqual(2);
  });
  it("names whose visit it is on a parent's phone", () => {
    expect(rebookBody({ ...base, firstName: "Sue", forName: "Lily" })).toContain("Hi Sue, Lily's BIAB infill is due.");
  });
  it("still has the stop link when nothing is free", () => {
    const t = rebookBody({ ...base, whenText: null, stylist: null });
    expect(t).toContain("is due. Book:");
    expect(t).toContain("/stop");
  });
});

describe("a run", () => {
  const now = new Date("2026-11-10T09:00:00Z");

  beforeEach(() => {
    process.env.AUTH_URL = "https://89-58-45-110.nip.io";
    db.settings = {
      rebookTextsEnabled: true,
      chatBookingEnabled: true,
      whatsappEnabled: true,
      instagramEnabled: false,
      instagramUsername: null,
      businessName: "Hoang Nail Salon",
    };
    db.whatsapp = { number: "+447700900123" };
    // A new set three weeks ago at 3pm: due an infill today.
    db.visits = [
      { id: "appt-1", leadId: "lead-1", serviceText: "BIAB new set", stylistName: "Lan", startsAt: new Date("2026-10-20T14:00:00Z") },
    ];
    db.upcoming = [];
    db.leads = [{ id: "lead-1", name: "Mai Tran", phone: "+447700900456", contactLead: null }];
    db.texts = [];
    diary.getAvailability.mockReset();
    diary.getAvailability.mockImplementation(async (q: { stylistName?: string }) =>
      q.stylistName === "Lan"
        ? [
            { start: "2026-11-12T10:00:00Z", end: "2026-11-12T11:00:00Z", stylistName: "Lan" },
            { start: "2026-11-12T15:00:00Z", end: "2026-11-12T16:00:00Z", stylistName: "Lan" },
          ]
        : []
    );
    sms.sendSms.mockClear();
  });

  it("texts a client due back, offering their stylist at their usual time", async () => {
    const r = await runRebookTexts("org-1", { now });
    expect(r).toMatchObject({ due: 1, sent: 1, failed: 0 });
    const [, to, body] = sms.sendSms.mock.calls[0];
    expect(to).toBe("+447700900456");
    expect(body).toMatch(/^Hi Mai, your BIAB infill is due\. Lan has Thursday at 3pm free\. Book: https:\/\/89-58-45-110\.nip\.io\/r\/\w{10} /);
    expect(db.texts).toHaveLength(1);
    expect(db.texts[0]).toMatchObject({ appointmentId: "appt-1", service: "BIAB infill", stylist: "Lan" });
    expect(body).toContain(`/r/${db.texts[0].id}/stop`);
  });

  it("only lists them on a dry run", async () => {
    const r = await runRebookTexts("org-1", { now, dryRun: true });
    expect(r.wouldSend).toHaveLength(1);
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect(db.texts).toHaveLength(0);
  });

  it("never texts about the same visit twice", async () => {
    await runRebookTexts("org-1", { now });
    db.texts.forEach((t) => (t.sentAt = now));
    const again = await runRebookTexts("org-1", { now });
    expect(again).toMatchObject({ due: 0, sent: 0 });
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
  });

  it("leaves out anyone with something booked, or who asked to stop", async () => {
    db.upcoming = [{ leadId: "lead-1" }];
    expect((await runRebookTexts("org-1", { now })).due).toBe(0);
    db.upcoming = [];
    db.leads[0].rebookTextsOff = true;
    expect((await runRebookTexts("org-1", { now })).due).toBe(0);
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it("is not due before three days ahead of time", async () => {
    expect((await runRebookTexts("org-1", { now: new Date("2026-11-06T09:00:00Z") })).due).toBe(0);
  });

  it("records a text that did not go", async () => {
    sms.sendSms.mockResolvedValueOnce({ ok: false, reason: "Twilio said no", configured: true });
    const r = await runRebookTexts("org-1", { now });
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(db.texts[0].sendError).toBe("Twilio said no");
  });

  it("says why a salon sends nothing", async () => {
    db.settings.rebookTextsEnabled = false;
    expect((await runRebookTexts("org-1", { now })).skipped).toBe("rebooking texts are off");
    db.settings.rebookTextsEnabled = true;
    db.whatsapp = null;
    expect((await runRebookTexts("org-1", { now })).skipped).toMatch(/no WhatsApp number or Instagram username/);
    db.settings.instagramEnabled = true;
    db.settings.instagramUsername = "hoang.nails";
    expect((await runRebookTexts("org-1", { now })).skipped).toBeUndefined();
  });
});
