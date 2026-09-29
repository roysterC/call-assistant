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
  lead: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  appointment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
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
  /** What the diary was asked, newest last. */
  asked: [] as Array<{ clientType?: string }>,
}));
const written = vi.hoisted(() => [] as Array<{ write: unknown; record: unknown }>);
vi.mock("@/lib/booking", async (original) => ({
  ...(await original<typeof import("@/lib/booking")>()),
  getSalonConfig: async () => salon,
  getBookingProvider: async () => ({
    id: "native",
    capabilities: { readAvailability: true, forwardSearch: false, createBooking: true },
    getAvailability: async (q: { stylistName?: string; clientType?: string }) => {
      salon.asked.push(q);
      return salon.free.filter((f) => !q.stylistName || f.stylistName === q.stylistName);
    },
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
const texts = vi.hoisted(() => ({ send: vi.fn(async () => ({ ok: false, configured: false, reason: "not in tests" })) }));
vi.mock("@/lib/sms", async (original) => ({
  ...(await original<typeof import("@/lib/sms")>()),
  sendSms: texts.send,
}));

import {
  handleCancelAppointment,
  handleBookAppointment,
  handleCheckAvailability,
  handleFindAppointment,
  executeVapiFunction,
  handleSaveCustomerDetails,
  lookupPhone,
  parseBookingNumber,
  saysNotBooked,
  thirdPartyRefusal,
} from "./vapi-functions";

const SARAH = "+447700900715";
const OLIVIA = "+447700900714";
const CLAIRE = "+447700900721";

beforeEach(() => {
  vi.clearAllMocks();
  salon.free = [];
  salon.asked = [];
  written.length = 0;
  db.lead.findUnique.mockImplementation(async ({ where }) =>
    where.organizationId_phone.phone === SARAH ? { id: "lead-sarah", name: "Sarah Friend", phone: SARAH } : null
  );
  // Nobody is reached through anybody's number unless a test says so.
  db.lead.findMany.mockResolvedValue([]);
  db.lead.create.mockImplementation(async ({ data }) => ({ id: `lead-${data.name}`, email: null, phone: null, ...data }));
  db.lead.update.mockImplementation(async ({ where, data }) => ({ id: where.id, email: null, ...data }));
  const sarahsBooking = {
    id: "appt-1",
    bookingNumber: 1043,
    startsAt: new Date(Date.now() + 3 * 86_400_000),
    serviceText: "Cut and finish",
    stylistName: "Jo",
    notes: null,
    googleEventId: null,
    lead: { id: "lead-sarah", name: "Sarah Friend", phone: SARAH, contactLead: null },
  };
  db.appointment.findMany.mockResolvedValue([sarahsBooking]);
  db.appointment.findFirst.mockImplementation(async ({ where }) => (where.bookingNumber === 1043 ? sarahsBooking : null));
  db.organizationSettings.findUnique.mockResolvedValue({ businessName: "Shogo", contactPhone: null });
  // Nobody has been in before unless a test says so.
  db.appointment.count.mockResolvedValue(0);
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

describe("by booking number", () => {
  it("reads the number however the model sent it", () => {
    expect(parseBookingNumber("1043")).toBe(1043);
    expect(parseBookingNumber("booking 1043")).toBe(1043);
    expect(parseBookingNumber("#10 43")).toBe(1043);
    expect(parseBookingNumber("the one on her text")).toBeNull();
    expect(parseBookingNumber(undefined)).toBeNull();
  });

  it("is not enough on its own: a friend on another phone is asked whose name it is under", async () => {
    const r = await handleFindAppointment("org", { bookingNumber: "1043", callerNumber: OLIVIA });
    expect(r).toMatchObject({ found: true, needsBookingName: true });
    expect(r).not.toHaveProperty("when");
    expect(JSON.stringify(r)).not.toMatch(/Sarah/);
  });

  it("with the name it is under, lets a friend hear it and cancel it, and texts the client", async () => {
    const found = await handleFindAppointment("org", {
      bookingNumber: "1043",
      bookingName: "Sarah Friend",
      callerNumber: OLIVIA,
    });
    expect(found).toMatchObject({ found: true, bookingNumber: 1043, service: "Cut and finish", stylist: "Jo" });

    const r = await handleCancelAppointment("org", {
      bookingNumber: "1043",
      bookingName: "Sarah",
      callerNumber: OLIVIA,
      callerName: "Olivia Hart",
    });
    expect(r).toMatchObject({ success: true });
    expect(db.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "appt-1" }, data: expect.objectContaining({ status: "cancelled" }) })
    );
    expect(texts.send).toHaveBeenCalledWith("org", SARAH, expect.any(String));
  });

  it("takes the client's own name when she is the one ringing", async () => {
    const r = await handleFindAppointment("org", { bookingNumber: "1043", callerName: "Sarah Friend", callerNumber: OLIVIA });
    expect(r).toMatchObject({ found: true, service: "Cut and finish" });
  });

  it("refuses a number with the wrong name, without saying whose it is, and changes nothing", async () => {
    const r = await handleCancelAppointment("org", {
      bookingNumber: "1043",
      bookingName: "Nina Ward",
      callerNumber: OLIVIA,
    });
    expect(r).toMatchObject({ success: false, found: false, nameDidNotMatch: true });
    expect(JSON.stringify(r)).not.toMatch(/Sarah|Cut and finish|Jo\b/);
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it("takes either the child's name or the parent's she is reached through", async () => {
    const amys = {
      id: "appt-2",
      bookingNumber: 1044,
      startsAt: new Date(Date.now() + 3 * 86_400_000),
      serviceText: "Cut and finish",
      stylistName: "Jo",
      notes: null,
      googleEventId: null,
      lead: { id: "lead-amy", name: "Amy Burns", phone: null, contactLead: { name: "Claire Burns", phone: CLAIRE } },
    };
    db.appointment.findFirst.mockResolvedValue(amys);
    for (const bookingName of ["Amy Burns", "Claire Burns"]) {
      const r = await handleFindAppointment("org", { bookingNumber: "1044", bookingName, callerNumber: OLIVIA });
      expect(r).toMatchObject({ found: true, bookingNumber: 1044, clientName: "Amy Burns" });
    }
    const wrong = await handleFindAppointment("org", { bookingNumber: "1044", bookingName: "Olivia Hart", callerNumber: OLIVIA });
    expect(wrong).toMatchObject({ found: false, nameDidNotMatch: true });
  });

  it("finds nothing for a number that is not a booking, and changes nothing", async () => {
    const r = await handleCancelAppointment("org", { bookingNumber: "9999", callerNumber: OLIVIA });
    expect(r).toMatchObject({ success: false, found: false });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it("is what a refused caller is asked for", () => {
    const r = thirdPartyRefusal(SARAH, { callerNumber: OLIVIA, callerName: "Olivia Hart" }, "Sarah Friend");
    expect(r?.message).toMatch(/bookingNumber/);
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

describe("what the model sends", () => {
  it("answers a number where text was expected, rather than crashing", async () => {
    // The stress test found `service: 123` crashing on .trim(). Numbers are
    // turned into text before any handler sees them.
    const r = (await executeVapiFunction("check_availability", "org", { date: "Tuesday", service: 123 })) as {
      message: string;
    };
    expect(r.message).toMatch(/"123"/);
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

  it("on caller ID, says the text is on its way to this phone, without asking whether the number is right", async () => {
    texts.send.mockResolvedValueOnce({ ok: true, configured: true } as never);
    const r = (await handleBookAppointment("org", {
      date: "Tuesday",
      time: "2026-09-29T13:15:00+01:00",
      service: "blow dry",
      customerPhone: "", // "the one I'm ringing from"
      customerName: "Olivia Hart",
      callerNumber: "+447700900714",
    })) as { success: boolean; usedCallerId: boolean; textSent: boolean; message: string };
    expect(r).toMatchObject({ success: true, usedCallerId: true, textSent: true });
    expect(r.message).toMatch(/on its way to this phone/);
    expect(r.message).toMatch(/Do not read the number out or ask whether it is right/);
    // The digits are not handed over, so there is nothing to read out.
    expect(r.message).not.toMatch(/900|714/);
  });

  it("when the text could not be sent, promises none, guesses no reason, and still does not read the number out", async () => {
    const r = (await handleBookAppointment("org", {
      date: "Tuesday",
      time: "2026-09-29T13:15:00+01:00",
      service: "blow dry",
      customerPhone: "", // "the one I'm ringing from"
      customerName: "Olivia Hart",
      callerNumber: "+442074317546",
    })) as { success: boolean; textSent: boolean; message: string };
    expect(r).toMatchObject({ success: true, textSent: false });
    expect(r.message).toMatch(/Do NOT promise a text/);
    expect(r.message).toMatch(/The booking still stands/);
    // A failure on our side is not the caller's phone being a landline.
    expect(r.message).not.toMatch(/landline/);
    expect(r.message).not.toMatch(/431|7546/);
  });

  it("books a daughter on her mum's phone as her own client, reached through her mum's number", async () => {
    db.lead.findUnique.mockResolvedValue({ id: "lead-claire", name: "Claire Burns", phone: CLAIRE, email: null });
    const r = (await handleBookAppointment("org", {
      time: quarterPastOne,
      service: "blow dry",
      stylist: "Jo",
      customerPhone: "07700 900721",
      customerName: "Amy Burns",
    })) as { success: boolean; message: string };
    expect(r.success).toBe(true);
    // Her own record, linked; her mum's left as it was.
    expect(db.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Amy Burns", contactLeadId: "lead-claire" }),
    });
    expect(db.lead.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "lead-claire" } }));
    expect(written[0].record).toMatchObject({ leadId: "lead-Amy Burns" });
    expect(written[0].write).toMatchObject({ clientName: "Amy Burns" });
    expect(r.message).toMatch(/for Amy Burns/);
    // The text goes to her mum, and greets her mum.
    expect(texts.send).toHaveBeenCalledWith("org", CLAIRE, expect.stringMatching(/^Hi Claire Burns — Amy is booked in/));
  });

  it("books her on the same record next time, and her mum on her own", async () => {
    db.lead.findUnique.mockResolvedValue({ id: "lead-claire", name: "Claire Burns", phone: CLAIRE, email: null });
    db.lead.findMany.mockResolvedValue([{ id: "lead-amy", name: "Amy Burns", phone: null, email: null }]);
    const book = (customerName: string) =>
      handleBookAppointment("org", {
        time: quarterPastOne,
        service: "blow dry",
        stylist: "Jo",
        customerPhone: "07700 900721",
        customerName,
      });
    await book("Amy");
    await book("Claire Burns");
    expect(db.lead.create).not.toHaveBeenCalled();
    expect(written.map((w) => (w.record as { leadId: string }).leadId)).toEqual(["lead-amy", "lead-claire"]);
  });

  it("fills in a surname for the same person rather than making a second record", async () => {
    db.lead.findUnique.mockResolvedValue({ id: "lead-sarah", name: "Sarah", phone: SARAH, email: null });
    await handleBookAppointment("org", {
      time: quarterPastOne,
      service: "blow dry",
      stylist: "Jo",
      customerPhone: "07700 900715",
      customerName: "Sarah Friend",
    });
    expect(db.lead.update).toHaveBeenCalledWith({ where: { id: "lead-sarah" }, data: { name: "Sarah Friend" } });
    expect(db.lead.create).not.toHaveBeenCalled();
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

  describe("a client who has been before, on the same name and number", () => {
    // Sarah Friend, the number's own client, with a visit on her record.
    const visited = (...leadIds: string[]) =>
      db.appointment.count.mockImplementation(async ({ where }) => (leadIds.includes(where.leadId) ? 1 : 0));
    const book = (extra: Record<string, unknown>) =>
      handleBookAppointment("org", {
        time: quarterPastOne,
        stylist: "Jo",
        customerPhone: "",
        callerNumber: SARAH,
        customerName: "Sarah Friend",
        service: "blow dry",
        ...extra,
      } as Parameters<typeof handleBookAppointment>[1]) as Promise<{ success: boolean; patchTestRequired?: boolean; message: string }>;

    it("is booked as returning without anyone asking", async () => {
      visited("lead-sarah");
      const r = await book({});
      expect(r.success).toBe(true);
      expect(written[0].record).toMatchObject({ leadId: "lead-sarah", clientType: "returning" });
    });

    it("is returning even when a no was misheard", async () => {
      visited("lead-sarah");
      await book({ clientType: "new" });
      expect(written[0].record).toMatchObject({ clientType: "returning" });
    });

    it("gets colour booked without being asked, and with no skin test", async () => {
      visited("lead-sarah");
      const r = await book({ service: "root tint" });
      expect(r).toMatchObject({ success: true, patchTestRequired: false });
      expect(written[0].record).toMatchObject({ clientType: "returning", patchTestRequired: false });
      expect(r.message).not.toMatch(/skin/);
    });

    it("counts only visits that happened: done, or booked for a time now past", async () => {
      visited("lead-sarah");
      await book({});
      expect(db.appointment.count).toHaveBeenCalledWith({
        where: {
          leadId: "lead-sarah",
          OR: [{ status: "completed" }, { status: "booked", startsAt: { lt: expect.any(Date) } }],
        },
      });
    });

    it("is not returning on the number alone: another name there is not them", async () => {
      visited("lead-sarah");
      await book({ customerName: "Amy Friend" });
      expect(written[0].record).toMatchObject({ clientType: "unknown" });
    });

    it("does not make a daughter returning on her mum's visits, so her colour still needs asking", async () => {
      visited("lead-sarah");
      const r = await book({ customerName: "Amy Friend", service: "root tint" });
      expect(r).toMatchObject({ success: false, needsClientType: true });
      expect(r.message).toMatch(/no visit on record for Amy Friend/);
      expect(written).toHaveLength(0);
    });

    it("asks the diary for colour times as a returning client, which a new client's skin test would hold back", async () => {
      visited("lead-sarah");
      const ask = (extra: Record<string, unknown>) =>
        handleCheckAvailability("org", {
          date: "Tuesday",
          service: "root tint",
          callerNumber: SARAH,
          ...extra,
        } as Parameters<typeof handleCheckAvailability>[1]);

      await ask({ customerName: "Sarah Friend" });
      expect(salon.asked.at(-1)).toMatchObject({ clientType: "returning" });

      // Without a name nothing says who it is for, so it is not assumed.
      await ask({});
      expect(salon.asked.at(-1)).toMatchObject({ clientType: "unknown" });

      // Nor for someone else on her number.
      await ask({ customerName: "Amy Friend" });
      expect(salon.asked.at(-1)).toMatchObject({ clientType: "unknown" });
    });

    it("is not returning with no visit on the record", async () => {
      await book({});
      expect(written[0].record).toMatchObject({ leadId: "lead-sarah", clientType: "unknown" });
    });
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

describe("a number and the clients reached through it", () => {
  const soon = (days: number) => new Date(Date.now() + days * 86_400_000);
  const claireLead = { id: "lead-claire", name: "Claire Burns", phone: CLAIRE, contactLead: null };
  const amyLead = { id: "lead-amy", name: "Amy Burns", phone: null, contactLead: { name: "Claire Burns", phone: CLAIRE } };
  const booking = (id: string, lead: typeof claireLead | typeof amyLead, days: number) => ({
    id,
    bookingNumber: null,
    startsAt: soon(days),
    serviceText: "Cut and finish",
    stylistName: "Jo",
    notes: null,
    googleEventId: null,
    lead,
  });

  beforeEach(() => {
    db.lead.findUnique.mockResolvedValue({ id: "lead-claire", name: "Claire Burns" });
    db.lead.findMany.mockResolvedValue([{ id: "lead-amy", name: "Amy Burns" }]);
    db.appointment.findMany.mockImplementation(async ({ where }) =>
      [booking("appt-claire", claireLead, 2), booking("appt-amy", amyLead, 3)].filter((a) => where.leadId.in.includes(a.lead.id))
    );
  });

  it("lists everyone's bookings for a call from the number, saying whose each is", async () => {
    const r = (await handleFindAppointment("org", { callerNumber: CLAIRE })) as {
      ambiguous: boolean;
      appointments: Array<{ for: string }>;
    };
    expect(r.ambiguous).toBe(true);
    expect(r.appointments.map((a) => a.for)).toEqual(["Claire Burns", "Amy Burns"]);
  });

  it("gives the daughter, on another phone, her own bookings and not her mum's", async () => {
    const r = await handleFindAppointment("org", { customerPhone: "07700 900721", callerNumber: OLIVIA, callerName: "Amy Burns" });
    expect(r).toMatchObject({ found: true, appointmentId: "appt-amy", clientName: "Amy Burns" });
    // Said as hers, not "your mum's".
    expect((r as { message: string }).message).toMatch(/^Amy Burns has cut and finish/);
  });

  it("still refuses a stranger", async () => {
    const r = await handleFindAppointment("org", { customerPhone: "07700 900721", callerNumber: OLIVIA, callerName: "Olivia Hart" });
    expect(r).toMatchObject({ notTheirs: true });
  });

  it("texts the mum, greeting her, when the daughter's booking is cancelled", async () => {
    const r = await handleCancelAppointment("org", { callerNumber: CLAIRE, appointmentId: "appt-amy" });
    expect(r).toMatchObject({ success: true });
    expect(texts.send).toHaveBeenCalledWith("org", CLAIRE, expect.stringMatching(/^Hi Claire Burns — Amy's appointment/));
  });
});
