import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reply catalogue: exactly what the receptionist's tools answer, word for
 * word and field for field, in each situation they meet on calls. Recorded in
 * __snapshots__/catalogue.test.ts.snap.
 *
 * A restructure must leave every entry as it was. A change that is meant to
 * alter a reply shows up here as a diff to read, then accept with
 * `npx vitest run -u src/lib/receptionist/catalogue.test.ts`.
 */

const db = vi.hoisted(() => ({
  lead: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  appointment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
  organizationSettings: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

// Open Tuesdays 09:00-18:00 and Saturdays 08:30-17:00. Jo does everything;
// Marcus does blow dries only.
const salon = vi.hoisted(() => ({
  timeZone: "Europe/London",
  hours: [
    { day: 2, closed: false, open: "09:00", close: "18:00" },
    { day: 6, closed: false, open: "08:30", close: "17:00" },
  ],
  services: [
    { name: "Blow dry", durationMinutes: 45, bufferMinutes: 0, requiresPatchTest: false, priceMinor: 3000 },
    { name: "Root tint", durationMinutes: 90, bufferMinutes: 15, requiresPatchTest: true, priceMinor: 6500 },
  ],
  stylists: [
    { name: "Jo", workingDays: [2, 6], services: [], bookable: true },
    { name: "Marcus", workingDays: [2, 6], services: ["Blow dry"], bookable: true },
  ],
  free: [] as Array<{ start: string; end: string; stylistName: string }>,
  forwardSearch: true,
}));
const written = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/booking", async (original) => ({
  ...(await original<typeof import("@/lib/booking")>()),
  getSalonConfig: async () => salon,
  getBookingProvider: async () => ({
    id: "native",
    get capabilities() {
      return { readAvailability: true, forwardSearch: salon.forwardSearch, createBooking: true };
    },
    getAvailability: async (q: { stylistName?: string }) =>
      salon.free.filter((f) => !q.stylistName || f.stylistName === q.stylistName),
    createBooking: async () => ({}),
    cancelBooking: async () => ({}),
  }),
}));
vi.mock("@/lib/booking/diary", async (original) => ({
  ...(await original<typeof import("@/lib/booking/diary")>()),
  bookAppointment: async (_p: unknown, write: { startsAt: string }, record: unknown) => {
    written.push({ booked: { write, record } });
    return { ok: true, appointment: { id: "appt-new", bookingNumber: 1050, startsAt: new Date(write.startsAt) } };
  },
  moveAppointment: async (_p: unknown, _appt: unknown, move: { startsAt: Date; durationMinutes: number }) => {
    written.push({ moved: move });
    return {
      ok: true,
      appointment: { id: "appt-1", startsAt: move.startsAt, endsAt: new Date(move.startsAt.getTime() + move.durationMinutes * 60_000) },
      oldCleared: true,
    };
  },
}));
const noticed = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/booking-notices", () => ({
  noticeNewBooking: async (_org: string, booking: unknown) => {
    noticed.push(booking);
  },
}));
const texts = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/sms", async (original) => ({
  ...(await original<typeof import("@/lib/sms")>()),
  sendSms: texts.send,
}));

import {
  handleBookAppointment,
  handleCancelAppointment,
  handleCheckAvailability,
  handleRescheduleAppointment,
} from "./actions";

const SARAH = "+447700900715"; // a regular: her own number
const CLAIRE = "+447700900721"; // a mum, whose daughter Amy books on her phone
const NEW = "+447700900799"; // nobody the salon knows

/** A free slot, in the salon's clock. */
const slot = (local: string, stylistName = "Jo") => ({ start: new Date(`${local}+01:00`).toISOString(), end: "", stylistName });
// Tuesday 29 September and Saturday 3 October.
const tuesday = ["09:00", "10:00", "11:00", "12:30", "14:00", "15:30"].map((t) => slot(`2026-09-29T${t}:00`));
const saturday = ["08:30", "13:00"].map((t) => slot(`2026-10-03T${t}:00`));

let visits = 0;
let patchTest: Date | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  // Saturday 26 September 2026, ten in the morning.
  vi.setSystemTime(new Date("2026-09-26T10:00:00+01:00"));
  vi.clearAllMocks();
  salon.free = [...tuesday, ...saturday];
  salon.forwardSearch = true;
  salon.stylists[0].services = [];
  salon.stylists[1].workingDays = [2, 6];
  written.length = 0;
  noticed.length = 0;
  visits = 0;
  patchTest = null;
  texts.send.mockResolvedValue({ ok: true, configured: true });
  db.lead.findUnique.mockImplementation(async ({ where }) => {
    const phone = where.organizationId_phone?.phone;
    if (phone === SARAH) return { id: "lead-sarah", name: "Sarah Friend", phone: SARAH, email: null, patchTestAt: patchTest };
    if (phone === CLAIRE) return { id: "lead-claire", name: "Claire Burns", phone: CLAIRE, email: null, patchTestAt: null };
    return null;
  });
  db.lead.findMany.mockResolvedValue([]);
  db.lead.create.mockImplementation(async ({ data }) => ({ id: `lead-${data.name}`, email: null, phone: null, ...data }));
  db.lead.update.mockImplementation(async ({ where, data }) => ({ id: where.id, email: null, ...data }));
  db.appointment.count.mockImplementation(async ({ where }) => (where.leadId === "lead-sarah" ? visits : 0));
  const sarahsBooking = {
    id: "appt-1",
    bookingNumber: 1043,
    status: "booked",
    startsAt: new Date("2026-09-29T09:00:00+01:00"),
    durationMinutes: 45,
    serviceText: "Blow dry",
    stylistName: "Jo",
    clientType: "returning",
    patchTestRequired: false,
    notes: null,
    googleEventId: null,
    googleCalendarId: null,
    createdAt: new Date("2026-09-20T12:00:00Z"),
    lead: { id: "lead-sarah", name: "Sarah Friend", phone: SARAH, contactLead: null, patchTestAt: null },
  };
  db.appointment.findMany.mockImplementation(async () => [sarahsBooking]);
  db.appointment.findFirst.mockImplementation(async ({ where }) => (where?.bookingNumber === 1043 ? sarahsBooking : null));
  db.appointment.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  db.organizationSettings.findUnique.mockResolvedValue({ businessName: "Shogo", contactPhone: "020 7431 7546" });
});
afterEach(() => vi.useRealTimers());

type P = Record<string, unknown>;
const check = (p: P) => handleCheckAvailability("org", p as Parameters<typeof handleCheckAvailability>[1]);
const book = (p: P, opts?: { dryRun?: boolean }) =>
  handleBookAppointment("org", { customerPhone: "", ...p } as Parameters<typeof handleBookAppointment>[1], opts);
const move = (p: P) => handleRescheduleAppointment("org", p as unknown as Parameters<typeof handleRescheduleAppointment>[1]);
const cancel = (p: P) => handleCancelAppointment("org", p as Parameters<typeof handleCancelAppointment>[1]);

/** The reply, and anything written or texted on the way: all of it is the behaviour. */
async function record(run: () => Promise<unknown>) {
  const reply = await run();
  return {
    reply,
    written: [...written],
    texted: texts.send.mock.calls.map((c) => c.slice(1)),
    noticed: [...noticed],
  };
}

const cases: Array<[string, () => Promise<unknown>, (() => void)?]> = [
  // --- check_availability ---
  ["check: no service named", () => check({ date: "Tuesday" })],
  ["check: a service the salon does not list", () => check({ date: "Tuesday", service: "balayage" })],
  ["check: a stylist who is not here", () => check({ date: "Tuesday", service: "blow dry", stylist: "Joe" })],
  ["check: a stylist who does not do the service", () => check({ date: "Tuesday", service: "root tint", stylist: "Marcus" })],
  ["check: no day named", () => check({ service: "blow dry" })],
  ["check: a day in the past", () => check({ date: "2020-01-01", service: "blow dry" })],
  ["check: a day with plenty free", () => check({ date: "Tuesday", service: "blow dry" })],
  ["check: the time asked for is free", () => check({ date: "Tuesday", service: "blow dry", time: "2pm" })],
  ["check: the time asked for is taken", () => check({ date: "Tuesday", service: "blow dry", time: "1pm" })],
  ["check: an afternoon", () => check({ date: "Tuesday", service: "blow dry", timeOfDay: "afternoon" })],
  ["check: after six, which has nothing", () => check({ date: "Tuesday", service: "blow dry", after: "18:00" })],
  ["check: a closed day", () => check({ date: "Monday", service: "blow dry" })],
  ["check: the soonest", () => check({ prefer: "earliest", service: "blow dry" })],
  ["check: a named stylist", () => check({ date: "Tuesday", service: "blow dry", stylist: "Jo" })],
  ["check: 'Saturday' said on a Saturday", () => check({ date: "Saturday", service: "blow dry" })],
  ["check: too late today", () => check({ date: "today", service: "blow dry" }), () => vi.setSystemTime(new Date("2026-09-26T17:20:00+01:00"))],
  ["check: nothing in two weeks", () => check({ date: "Tuesday", service: "blow dry" }), () => (salon.free = [])],
  ["check: a day nobody who does it works", () => check({ date: "Tuesday", service: "blow dry" }), () => {
    salon.free = [...saturday];
    salon.stylists[1].workingDays = [6];
    salon.stylists[0].services = ["Root tint"];
  }],
  ["check: nothing in a month either", () => check({ date: "Tuesday", service: "blow dry", lookFurther: true }), () => (salon.free = [])],
  ["check: a diary read one day at a time, empty", () => check({ date: "Tuesday", service: "blow dry" }), () => ((salon.forwardSearch = false), (salon.free = []))],
  ["check: staff asking", () => check({ date: "Tuesday", service: "blow dry", forStaff: true })],
  ["check: colour for someone new, inside the skin-test wait", () => check({ date: "Tuesday", service: "root tint", clientType: "new" })],
  ["check: colour for someone new, the day they named inside the skin-test wait", () => check({ date: "Tuesday", service: "root tint", clientType: "new" }), () => {
    vi.setSystemTime(new Date("2026-09-26T17:30:00+01:00"));
    salon.free = [...saturday];
  }],
  ["check: colour for a regular found on her record", () => check({ date: "Tuesday", service: "root tint", customerName: "Sarah Friend", callerNumber: SARAH }), () => (visits = 2)],
  ["check: colour for someone with a patch test on record", () => check({ date: "Tuesday", service: "root tint", callerNumber: SARAH }), () => (patchTest = new Date("2026-09-01T12:00:00Z"))],

  // --- book_appointment ---
  ["book: on caller ID, text sent", () => book({ time: "2026-09-29T10:00:00+01:00", service: "blow dry", customerName: "Sarah Friend", callerNumber: SARAH })],
  ["book: on caller ID, text not sent", () => book({ time: "2026-09-29T10:00:00+01:00", service: "blow dry", customerName: "Sarah Friend", callerNumber: SARAH }), () => texts.send.mockResolvedValue({ ok: false, configured: true, reason: "landline" })],
  ["book: a number read out", () => book({ time: "2026-09-29T10:00:00+01:00", service: "blow dry", customerName: "Nina New", customerPhone: "07700 900799" })],
  ["book: no name", () => book({ time: "2026-09-29T10:00:00+01:00", service: "blow dry", callerNumber: NEW })],
  ["book: a number that will not parse", () => book({ time: "2026-09-29T10:00:00+01:00", service: "blow dry", customerName: "Nina New", customerPhone: "0770" })],
  ["book: a stylist who is not here", () => book({ time: "2026-09-29T10:00:00+01:00", service: "blow dry", stylist: "Joe", customerName: "Nina New", callerNumber: NEW })],
  ["book: no stylist named, worked out from the slot", () => book({ time: "2026-09-29T14:00:00+01:00", service: "blow dry", customerName: "Nina New", callerNumber: NEW })],
  ["book: a time the diary did not offer", () => book({ time: "2026-09-29T13:00:00+01:00", service: "blow dry", stylist: "Jo", customerName: "Nina New", callerNumber: NEW })],
  ["book: colour, client type unknown", () => book({ time: "2026-09-29T10:00:00+01:00", service: "root tint", customerName: "Nina New", callerNumber: NEW })],
  ["book: colour for someone new, too soon", () => book({ time: "2026-09-29T10:00:00+01:00", service: "root tint", clientType: "new", customerName: "Nina New", callerNumber: NEW }), () => vi.setSystemTime(new Date("2026-09-26T17:30:00+01:00"))],
  ["book: colour for someone new, far enough ahead", () => book({ time: "2026-10-03T13:00:00+01:00", service: "root tint", clientType: "new", customerName: "Nina New", callerNumber: NEW })],
  ["book: a regular, returning from her record", () => book({ time: "2026-09-29T10:00:00+01:00", service: "root tint", customerName: "Sarah Friend", callerNumber: SARAH }), () => (visits = 3)],
  ["book: a patch test on record", () => book({ time: "2026-09-29T10:00:00+01:00", service: "root tint", customerName: "Sarah Friend", callerNumber: SARAH }), () => (patchTest = new Date("2026-09-01T12:00:00Z"))],
  ["book: a daughter on her mum's phone", () => book({ time: "2026-09-29T10:00:00+01:00", service: "blow dry", customerName: "Amy Burns", callerNumber: CLAIRE })],
  ["book: checked only, for the read-back", () => book({ time: "2026-09-29T14:00:00+01:00", service: "blow dry", customerName: "Nina New", callerNumber: NEW }, { dryRun: true })],
  ["book: checked only, a new colour client", () => book({ time: "2026-10-03T13:00:00+01:00", service: "root tint", clientType: "new", customerName: "Nina New", callerNumber: NEW }, { dryRun: true })],

  // --- reschedule_appointment and cancel_appointment ---
  ["move: her own booking, to a free time", () => move({ date: "Tuesday", time: "2026-09-29T14:00:00+01:00", callerNumber: SARAH })],
  ["move: to a time the diary did not offer (moves leave clashes to the diary's write)", () => move({ date: "Tuesday", time: "2026-09-29T13:00:00+01:00", stylist: "Jo", callerNumber: SARAH })],
  ["move: someone else's booking", () => move({ date: "Tuesday", time: "2026-09-29T14:00:00+01:00", callerNumber: NEW, bookingNumber: "1043" })],
  ["cancel: her own booking", () => cancel({ callerNumber: SARAH })],
  ["cancel: someone else's booking", () => cancel({ callerNumber: NEW, bookingNumber: "1043" })],
];

describe("the reply catalogue", () => {
  it.each(cases)("%s", async (_name, run, setUp) => {
    setUp?.();
    expect(await record(run)).toMatchSnapshot();
  });
});
