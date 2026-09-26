import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tool handlers against a stand-in database and diary, for what the
 * simulated-caller stress test (scripts/receptionist-stress.ts) caught:
 * "caller_id" sent as the number to look up; a friend read, then allowed to
 * cancel, someone else's booking; times misread from UTC; "which stylist?"
 * for a slot two stylists could take; a mum's record renamed to her
 * daughter's; "fully booked" said of a day that had simply closed.
 */

const db = vi.hoisted(() => ({
  lead: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  appointment: { findMany: vi.fn(), update: vi.fn() },
  organizationSettings: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
// Saturdays 08:30 to 17:00, and a diary with nothing free, for the
// availability answers.
const salon = vi.hoisted(() => ({
  timeZone: "Europe/London",
  hours: [
    { day: 2, closed: false, open: "09:00", close: "18:00" },
    { day: 6, closed: false, open: "08:30", close: "17:00" },
  ],
  services: [
    { name: "Blow dry", durationMinutes: 45, bufferMinutes: 0, requiresPatchTest: false, priceMinor: null },
    { name: "Root tint", durationMinutes: 90, bufferMinutes: 15, requiresPatchTest: true, priceMinor: null },
  ],
  stylists: [
    { name: "Jo", workingDays: [2, 3, 4, 5, 6], services: [] },
    { name: "Marcus", workingDays: [2, 3, 4, 5, 6], services: [] },
  ],
  /** What the stand-in diary has free. Empty unless a test fills it. */
  free: [] as Array<{ start: string; end: string; stylistName: string }>,
}));
const written = vi.hoisted(() => [] as Array<{ write: unknown; record: unknown }>);
vi.mock("@/lib/booking", async (original) => ({
  ...(await original<typeof import("@/lib/booking")>()),
  getSalonConfig: async () => salon,
  getBookingProvider: async () => ({
    id: "native",
    capabilities: { readAvailability: true, forwardSearch: false, createBooking: true },
    getAvailability: async ({ stylistName }: { stylistName?: string }) =>
      salon.free.filter((f) => !stylistName || f.stylistName === stylistName),
    createBooking: async () => ({}),
  }),
}));
vi.mock("@/lib/booking/diary", async (original) => ({
  ...(await original<typeof import("@/lib/booking/diary")>()),
  bookAppointment: async (_provider: unknown, write: { startsAt: string }, record: unknown) => {
    written.push({ write, record });
    return { ok: true, appointment: { id: "appt-new", startsAt: new Date(write.startsAt) } };
  },
}));
vi.mock("@/lib/sms", async (original) => ({
  ...(await original<typeof import("@/lib/sms")>()),
  sendSms: async () => ({ ok: false, reason: "not in tests" }),
}));

import {
  handleCancelAppointment,
  handleBookAppointment,
  handleCheckAvailability,
  handleFindAppointment,
  handleSaveCustomerDetails,
  lookupPhone,
  saysNotBooked,
  thirdPartyRefusal,
} from "./vapi-functions";

const SARAH = "+447700900715";
const OLIVIA = "+447700900714";

beforeEach(() => {
  vi.clearAllMocks();
  salon.free = [];
  written.length = 0;
  db.lead.findUnique.mockImplementation(async ({ where }) =>
    where.organizationId_phone.phone === SARAH ? { id: "lead-sarah", name: "Sarah Friend" } : null
  );
  db.appointment.findMany.mockResolvedValue([
    {
      id: "appt-1",
      startsAt: new Date(Date.now() + 3 * 86_400_000),
      serviceText: "Cut and finish",
      stylistName: "Jo",
      notes: null,
      googleEventId: null,
      lead: { id: "lead-sarah", name: "Sarah Friend", phone: SARAH },
    },
  ]);
  db.organizationSettings.findUnique.mockResolvedValue({ businessName: "Shogo", contactPhone: null });
});

describe("lookupPhone", () => {
  it("uses caller ID when the model sends a placeholder instead of a number", () => {
    expect(lookupPhone("caller_id", SARAH)).toEqual({ ok: true, e164: SARAH, source: "callerId" });
    expect(lookupPhone("the number I'm ringing from", SARAH)).toMatchObject({ e164: SARAH });
    expect(lookupPhone(undefined, SARAH)).toMatchObject({ e164: SARAH });
  });

  it("uses a number that was actually said, and asks again for one that will not parse", () => {
    expect(lookupPhone("07700 900714", SARAH)).toEqual({ ok: true, e164: OLIVIA, source: "given" });
    expect(lookupPhone("0770", SARAH).ok).toBe(false);
  });

  it("has nothing to fall back to when caller ID is withheld", () => {
    expect(lookupPhone("this number", undefined).ok).toBe(false);
  });
});

describe("thirdPartyRefusal", () => {
  it("lets the booking's own number through without a name", () => {
    expect(thirdPartyRefusal(SARAH, { callerNumber: "07700 900715" }, "Sarah Friend")).toBeNull();
  });

  it("asks who is calling, without naming the client, from any other number", () => {
    const r = thirdPartyRefusal(SARAH, { callerNumber: OLIVIA }, "Sarah Friend");
    expect(r).toMatchObject({ needsCallerName: true });
    expect(JSON.stringify(r)).not.toMatch(/Sarah/);
  });

  it("refuses someone who is not the client, and allows the client on another phone", () => {
    expect(thirdPartyRefusal(SARAH, { callerNumber: OLIVIA, callerName: "Olivia Hart" }, "Sarah Friend")).toMatchObject({
      notTheirs: true,
    });
    expect(thirdPartyRefusal(SARAH, { callerNumber: OLIVIA, callerName: "Sarah" }, "Sarah Friend")).toBeNull();
    // Withheld caller ID is another phone too.
    expect(thirdPartyRefusal(SARAH, {}, "Sarah Friend")).toMatchObject({ needsCallerName: true });
  });

  it("treats a filler the model put in the name field as no name at all", () => {
    expect(thirdPartyRefusal(SARAH, { callerNumber: OLIVIA, callerName: "yourself" }, "Sarah Friend")).toMatchObject({
      needsCallerName: true,
    });
  });
});

describe("find_appointment and cancel_appointment", () => {
  it("find the caller's own booking when the model sends 'caller_id' as the number", async () => {
    const r = await handleFindAppointment("org", { customerPhone: "caller_id", callerNumber: SARAH });
    expect(r).toMatchObject({ found: true, service: "Cut and finish", stylist: "Jo" });
  });

  it("give a friend nothing about the booking, and do not cancel it", async () => {
    const found = await handleFindAppointment("org", {
      customerPhone: "07700 900 715",
      callerNumber: OLIVIA,
      callerName: "Olivia Hart",
    });
    expect(found).toMatchObject({ found: true, notTheirs: true });
    expect(found).not.toHaveProperty("when");
    expect(found).not.toHaveProperty("service");

    const cancelled = await handleCancelAppointment("org", {
      customerPhone: "07700 900 715",
      callerNumber: OLIVIA,
      callerName: "Olivia Hart",
    });
    expect(cancelled).toMatchObject({ success: false, notTheirs: true });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it("cancel for the client herself, ringing from her own number", async () => {
    const r = await handleCancelAppointment("org", { callerNumber: SARAH });
    expect(r).toMatchObject({ success: true });
    expect(db.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "appt-1" }, data: expect.objectContaining({ status: "cancelled" }) })
    );
  });
});

describe("saysNotBooked", () => {
  it("puts the refusal first on a failed booking, once", () => {
    const r = saysNotBooked({ success: false, message: "Which stylist is that with?" });
    expect(r.message).toBe("NOT booked. Which stylist is that with?");
    expect(saysNotBooked(r).message).toBe(r.message);
  });

  it("leaves a successful booking alone", () => {
    expect(saysNotBooked({ success: true, message: "Booked." })).toEqual({ success: true, message: "Booked." });
  });
});

describe("save_customer_details for someone else's number", () => {
  it("leaves the client's name alone and says who the message is from", async () => {
    db.lead.upsert.mockResolvedValue({ id: "lead-sarah", name: "Sarah Friend" });
    const r = await handleSaveCustomerDetails("org", {
      name: "Olivia Hart",
      phone: "07700 900715",
      issue: "Sarah is ill, cancel Friday",
    });
    expect(r.message).toMatch(/^That number is Sarah Friend's, not Olivia Hart's: saved as a message/);
    const { update } = db.lead.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty("name");
    expect(update.issue).toBe("From Olivia Hart: Sarah is ill, cancel Friday");
  });

  it("still updates the name when it is the same person saying more of it", async () => {
    db.lead.findUnique.mockResolvedValue({ name: "Sarah" });
    db.lead.upsert.mockResolvedValue({ id: "lead-sarah", name: "Sarah Friend" });
    await handleSaveCustomerDetails("org", { name: "Sarah Friend", phone: "07700 900715" });
    expect(db.lead.upsert.mock.calls[0][0].update.name).toBe("Sarah Friend");
  });
});

describe("check_availability late on a Saturday", () => {
  // Saturday 26 September 2026, twenty past five: the salon closed at five.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T17:20:00+01:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("says the day is over, not that it is booked up", async () => {
    const r = (await handleCheckAvailability("org", { date: "today", service: "blow dry" })) as { message: string };
    expect(r.message).toMatch(/too late in the day/);
    expect(r.message).not.toMatch(/Nothing free/);
  });

  it("says 'Saturday' was taken as a week today", async () => {
    const r = (await handleCheckAvailability("org", { date: "Saturday", service: "blow dry" })) as {
      date: string;
      message: string;
    };
    expect(r.date).toBe("2026-10-03");
    expect(r.message).toMatch(/^Today is Saturday, so "Saturday" was taken as a week today/);
  });

  it("adds nothing when the day named is not today's", async () => {
    const r = (await handleCheckAvailability("org", { date: "Tuesday", service: "blow dry" })) as { message: string };
    expect(r.message).not.toMatch(/Today is/);
  });
});

describe("book_appointment", () => {
  // Saturday morning; Jo and Marcus both free at quarter past one on Tuesday.
  const quarterPastOne = "2026-09-29T12:15:00.000Z";
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T10:00:00+01:00"));
    salon.free = ["Jo", "Marcus"].map((stylistName) => ({ start: quarterPastOne, end: "", stylistName }));
  });
  afterEach(() => vi.useRealTimers());

  it("takes the time the caller heard, and gives it back with the day, in the salon's clock", async () => {
    const r = (await handleBookAppointment("org", {
      date: "Tuesday",
      time: "2026-09-29T13:15:00+01:00",
      service: "blow dry",
      customerPhone: "07700 900714",
      customerName: "Olivia Hart",
    })) as { success: boolean; startsAt: string; stylist: string; message: string };
    expect(r.success).toBe(true);
    expect(r.startsAt).toBe("2026-09-29T13:15:00+01:00");
    expect(r.message).toMatch(/on Tuesday at quarter past 1/);
    // Two free and none named: the one check_availability offered, Jo, not "which stylist?".
    expect(r.stylist).toBe("Jo");
  });

  it("books a second person on the same number without renaming the first", async () => {
    db.lead.findUnique.mockResolvedValue({ name: "Claire Burns" });
    db.lead.upsert.mockResolvedValue({ id: "lead-claire", name: "Claire Burns", email: null });
    const r = (await handleBookAppointment("org", {
      time: quarterPastOne,
      service: "blow dry",
      stylist: "Jo",
      customerPhone: "07700 900721",
      customerName: "Amy Burns",
    })) as { success: boolean; message: string };
    expect(r.success).toBe(true);
    expect(db.lead.upsert.mock.calls[0][0].update).not.toHaveProperty("name");
    expect(written[0].record).toMatchObject({ notes: "For Amy Burns" });
    expect(written[0].write).toMatchObject({ clientName: "Amy Burns" });
    expect(r.message).toMatch(/for Amy Burns/);
  });

  it("will not book colour without knowing whether they have had it here before", async () => {
    const r = (await handleBookAppointment("org", {
      time: quarterPastOne,
      service: "root tint",
      stylist: "Jo",
      customerPhone: "07700 900714",
      customerName: "Grace Hill",
    })) as { success: boolean; needsClientType?: boolean };
    expect(r).toMatchObject({ success: false, needsClientType: true });
    expect(written).toHaveLength(0);
  });

  it("will not book a new client's colour before the salon has been open 48 hours to do the skin test", async () => {
    // Saturday half five, shut Sunday and Monday: Tuesday is too soon.
    vi.setSystemTime(new Date("2026-09-26T17:30:00+01:00"));
    const r = (await handleBookAppointment("org", {
      time: quarterPastOne,
      service: "root tint",
      stylist: "Jo",
      clientType: "new",
      customerPhone: "07700 900714",
      customerName: "Priya Shah",
    })) as { success: boolean; tooSoon?: boolean };
    expect(r).toMatchObject({ success: false, tooSoon: true });
    expect(written).toHaveLength(0);
  });

  it("starts a refused booking with NOT booked, through the tool router", async () => {
    const { executeVapiFunction } = await import("./vapi-functions");
    const r = (await executeVapiFunction("book_appointment", "org", {
      time: "2026-09-29T15:00:00+01:00",
      service: "blow dry",
      stylist: "Jo",
      customerPhone: "07700 900714",
      customerName: "Olivia Hart",
    })) as { success: boolean; message: string };
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/^NOT booked\. /);
  });
});
