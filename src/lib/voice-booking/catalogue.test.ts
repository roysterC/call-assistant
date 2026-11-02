import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The assistant's reply catalogue: exactly what proposing a booking or a
 * move answers staff, in each situation, recorded in
 * __snapshots__/catalogue.test.ts.snap. Nothing here is saved: a proposal is
 * a card on screen until someone presses save.
 */

type Lead = { id: string; organizationId: string; name: string | null; phone: string | null; email: string | null; patchTestAt: Date | null };

const db = vi.hoisted(() => ({
  leads: [] as Lead[],
  visits: {} as Record<string, number>,
  appointments: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        db.leads.find((l) => l.id === where.id && l.organizationId === where.organizationId) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => db.leads.find((l) => l.id === where.id) ?? null,
      findMany: async ({ where }: { where: { OR: Array<{ name: { contains: string } }> } }) =>
        db.leads
          .filter((l) => where.OR.some((o) => (l.name ?? "").toLowerCase().includes(o.name.contains)))
          .map((l) => ({ ...l, contactLead: null, appointments: [] })),
    },
    appointment: {
      count: async ({ where }: { where: { leadId: string } }) => db.visits[where.leadId] ?? 0,
      findFirst: async ({ where }: { where: { id: string } }) => db.appointments.find((a) => a.id === where.id) ?? null,
    },
  },
}));

// Open Tuesdays 09:00-18:00 and Saturdays 08:30-17:00. Jo does everything;
// Marcus does blow dries only and works Tuesdays.
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
    { name: "Marcus", workingDays: [2], services: ["Blow dry"], bookable: true },
  ],
}));
vi.mock("@/lib/booking", async (original) => ({
  ...(await original<typeof import("@/lib/booking")>()),
  getSalonConfig: async () => salon,
  getBookingProvider: async () => ({
    id: "native",
    capabilities: { readAvailability: true, forwardSearch: true, createBooking: true },
    getAvailability: async () => [],
    createBooking: async () => ({}),
  }),
}));
// Who is already booked or blocked, by stylist and start.
const busy = vi.hoisted(() => ({ clashes: [] as Array<{ stylist: string; at: string }>, blocks: [] as Array<{ stylist: string | null; at: string }> }));
vi.mock("@/lib/booking/diary", async (original) => ({
  ...(await original<typeof import("@/lib/booking/diary")>()),
  findClash: async (_db: unknown, _org: string, stylist: string, startsAt: Date) => {
    const c = busy.clashes.find((x) => x.stylist === stylist && new Date(x.at).getTime() === startsAt.getTime());
    return c ? { serviceText: "Cut and finish", startsAt } : null;
  },
  findBlockClash: async (_db: unknown, _org: string, stylist: string, startsAt: Date) => {
    const b = busy.blocks.find((x) => (x.stylist === null || x.stylist === stylist) && new Date(x.at).getTime() === startsAt.getTime());
    return b ? { stylistName: b.stylist } : null;
  },
}));

import { proposeBooking, proposeMove } from "./drafts";

const asker = { organizationId: "org", role: "admin" as const };

beforeEach(() => {
  vi.useFakeTimers();
  // Saturday 26 September 2026, ten in the morning.
  vi.setSystemTime(new Date("2026-09-26T10:00:00+01:00"));
  busy.clashes = [];
  busy.blocks = [];
  db.visits = {};
  db.leads = [
    { id: "sarah", organizationId: "org", name: "Sarah Friend", phone: "+447700900715", email: null, patchTestAt: null },
    { id: "nina", organizationId: "org", name: "Nina New", phone: "+447700900799", email: null, patchTestAt: null },
  ];
  db.appointments = [
    {
      id: "appt-1",
      organizationId: "org",
      bookingNumber: 1043,
      status: "booked",
      startsAt: new Date("2026-09-29T09:00:00+01:00"),
      durationMinutes: 45,
      serviceText: "Blow dry",
      stylistName: "Jo",
      leadId: "sarah",
      patchTestRequired: false,
      lead: { id: "sarah", name: "Sarah Friend", phone: "+447700900715", email: null },
    },
    {
      id: "appt-2",
      organizationId: "org",
      bookingNumber: 1044,
      status: "booked",
      startsAt: new Date("2026-10-03T13:00:00+01:00"),
      durationMinutes: 105,
      serviceText: "Root tint",
      stylistName: "Jo",
      leadId: "nina",
      patchTestRequired: true,
      lead: { id: "nina", name: "Nina New", phone: "+447700900799", email: null },
    },
  ];
});
afterEach(() => vi.useRealTimers());

/** The proposal, with its random card id taken out. */
async function shown(run: () => Promise<unknown>) {
  const r = (await run()) as { draft?: { id?: string } };
  return r.draft ? { ...r, draft: { ...r.draft, id: "<id>" } } : r;
}

type B = Parameters<typeof proposeBooking>[1];
const book = (req: B) => () => proposeBooking(asker, req);
const move = (req: Parameters<typeof proposeMove>[1]) => () => proposeMove(asker, req);

const cases: Array<[string, () => Promise<unknown>, (() => void)?]> = [
  ["book: a client on the books, stylist named, free", book({ clientId: "sarah", service: "blow dry", stylist: "Jo", date: "Tuesday", time: "2pm" })],
  ["book: no stylist named, the first free in team order", book({ clientId: "sarah", service: "blow dry", date: "Tuesday", time: "2pm" })],
  ["book: no stylist named, the first is busy", book({ clientId: "sarah", service: "blow dry", date: "Tuesday", time: "2pm" }), () => busy.clashes.push({ stylist: "Jo", at: "2026-09-29T14:00:00+01:00" })],
  ["book: the stylist named is booked then", book({ clientId: "sarah", service: "blow dry", stylist: "Jo", date: "Tuesday", time: "2pm" }), () => busy.clashes.push({ stylist: "Jo", at: "2026-09-29T14:00:00+01:00" })],
  ["book: the stylist named is blocked out then", book({ clientId: "sarah", service: "blow dry", stylist: "Jo", date: "Tuesday", time: "2pm" }), () => busy.blocks.push({ stylist: "Jo", at: "2026-09-29T14:00:00+01:00" })],
  ["book: the salon is blocked out then", book({ clientId: "sarah", service: "blow dry", date: "Tuesday", time: "2pm" }), () => busy.blocks.push({ stylist: null, at: "2026-09-29T14:00:00+01:00" })],
  ["book: any time within hours, not only diary slots", book({ clientId: "sarah", service: "blow dry", stylist: "Jo", date: "Tuesday", time: "quarter past 4" })],
  ["book: outside opening hours", book({ clientId: "sarah", service: "blow dry", stylist: "Jo", date: "Tuesday", time: "7pm" })],
  ["book: running past closing", book({ clientId: "sarah", service: "blow dry", stylist: "Jo", date: "Tuesday", time: "5:30pm" })],
  ["book: a closed day", book({ clientId: "sarah", service: "blow dry", date: "Monday", time: "2pm" })],
  ["book: a day the stylist does not work", book({ clientId: "sarah", service: "blow dry", stylist: "Marcus", date: "Saturday", time: "2pm" })],
  ["book: a stylist who does not do the service", book({ clientId: "sarah", service: "root tint", stylist: "Marcus", date: "Tuesday", time: "2pm" }), () => (db.visits.sarah = 2)],
  ["book: a stylist not on the team", book({ clientId: "sarah", service: "blow dry", stylist: "Joe", date: "Tuesday", time: "2pm" })],
  ["book: a time already gone", book({ clientId: "sarah", service: "blow dry", stylist: "Jo", date: "today", time: "9am" })],
  ["book: a service not on the list", book({ clientId: "sarah", service: "balayage", date: "Tuesday", time: "2pm" })],
  ["book: colour, no visits, inside the skin-test wait", book({ clientId: "nina", service: "root tint", stylist: "Jo", date: "Tuesday", time: "2pm" }), () => vi.setSystemTime(new Date("2026-09-26T17:30:00+01:00"))],
  ["book: colour, no visits, staff say they have had one", book({ clientId: "nina", service: "root tint", stylist: "Jo", date: "Tuesday", time: "2pm", skinTestDone: true }), () => vi.setSystemTime(new Date("2026-09-26T17:30:00+01:00"))],
  ["book: colour, a patch test on record", book({ clientId: "nina", service: "root tint", stylist: "Jo", date: "Tuesday", time: "2pm" }), () => {
    vi.setSystemTime(new Date("2026-09-26T17:30:00+01:00"));
    db.leads[1].patchTestAt = new Date("2026-09-01T12:00:00Z");
  }],
  ["book: colour for a regular", book({ clientId: "sarah", service: "root tint", stylist: "Jo", date: "Tuesday", time: "2pm" }), () => {
    vi.setSystemTime(new Date("2026-09-26T17:30:00+01:00"));
    db.visits.sarah = 3;
  }],
  ["book: a new client by name and number", book({ clientName: "Pat Newcomer", clientPhone: "07700 900111", service: "blow dry", date: "Tuesday", time: "2pm" })],
  ["book: a client found by name", book({ clientName: "Sarah Friend", service: "blow dry", date: "Tuesday", time: "2pm" })],
  ["book: nobody named", book({ service: "blow dry", date: "Tuesday", time: "2pm" })],

  ["move: to a free time the same day", move({ appointmentId: "appt-1", time: "2pm" })],
  ["move: to a time the stylist is booked", move({ appointmentId: "appt-1", time: "2pm" }), () => busy.clashes.push({ stylist: "Jo", at: "2026-09-29T14:00:00+01:00" })],
  ["move: to a closed day", move({ appointmentId: "appt-1", date: "Monday" })],
  ["move: a colour waiting on its skin test, too close", move({ appointmentId: "appt-2", date: "Tuesday", time: "2pm" }), () => vi.setSystemTime(new Date("2026-09-26T17:30:00+01:00"))],
  ["move: a colour whose skin test has since been recorded", move({ appointmentId: "appt-2", date: "Tuesday", time: "2pm" }), () => {
    vi.setSystemTime(new Date("2026-09-26T17:30:00+01:00"));
    db.leads[1].patchTestAt = new Date("2026-09-20T12:00:00Z");
  }],
];

describe("the assistant's reply catalogue", () => {
  it.each(cases)("%s", async (_name, run, setUp) => {
    setUp?.();
    expect(await shown(run)).toMatchSnapshot();
  });
});
