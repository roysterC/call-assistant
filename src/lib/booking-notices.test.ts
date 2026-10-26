import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  users: [] as { id: string; organizationId: string }[],
  notices: [] as Record<string, unknown>[],
  devices: [] as { id: string; userId: string; endpoint: string; p256dh: string; auth: string }[],
  deleted: [] as string[],
}));
const sendNotification = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: async ({ where }: { where: { organizationId: string } }) =>
        db.users.filter((u) => u.organizationId === where.organizationId).map(({ id }) => ({ id })),
    },
    bookingNotice: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        db.notices.push(...data);
        return { count: data.length };
      },
    },
    pushSubscription: {
      findMany: async ({ where }: { where: { userId: { in: string[] } } }) =>
        db.devices.filter((d) => where.userId.in.includes(d.userId)),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        db.deleted.push(...where.id.in);
        return { count: where.id.in.length };
      },
    },
  },
}));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

import { bookingPush, bookingUrl, noticeNewBooking } from "./booking-notices";

const TZ = "Europe/London";
const booking = {
  id: "appt1",
  bookingNumber: 1043,
  clientName: "Sarah Jones",
  serviceText: "Cut and finish",
  stylistName: "Jo",
  // 2pm BST on Thursday 1 October 2026.
  startsAt: new Date("2026-10-01T13:00:00Z"),
};

beforeEach(() => {
  vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("AUTH_URL", "https://crm.example");
  db.users = [
    { id: "owner", organizationId: "salon" },
    { id: "stylist", organizationId: "salon" },
    { id: "elsewhere", organizationId: "other" },
  ];
  db.notices = [];
  db.deleted = [];
  db.devices = [
    { id: "d1", userId: "owner", endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
    { id: "d2", userId: "stylist", endpoint: "https://push.example/2", p256dh: "k", auth: "a" },
    { id: "d3", userId: "elsewhere", endpoint: "https://push.example/3", p256dh: "k", auth: "a" },
  ];
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });
});

describe("telling the salon about the receptionist's booking", () => {
  it("opens the diary on the booking's own day, with it open", () => {
    // Just after midnight in London is still the day before in UTC.
    expect(bookingUrl("appt1", new Date("2026-10-01T23:30:00Z"), TZ)).toBe("/calendar?date=2026-10-02&booking=appt1");
  });

  it("says who, what and when on the lock screen", () => {
    expect(bookingPush(booking, TZ, new Date("2026-09-30T09:00:00Z"))).toEqual({
      title: "New booking: Sarah Jones",
      body: "Cut and finish with Jo, tomorrow at 2pm",
      url: "/calendar?date=2026-10-01&booking=appt1",
      tag: "booking-appt1",
    });
  });

  it("gives everyone at the salon a notice, and pushes to their devices only", async () => {
    await noticeNewBooking("salon", booking, TZ);
    expect(db.notices).toEqual([
      { organizationId: "salon", userId: "owner", appointmentId: "appt1" },
      { organizationId: "salon", userId: "stylist", appointmentId: "appt1" },
    ]);
    const endpoints = sendNotification.mock.calls.map((c) => c[0].endpoint);
    expect(endpoints).toEqual(["https://push.example/1", "https://push.example/2"]);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({ title: "New booking: Sarah Jones" });
  });

  it("forgets a device its push service says has gone, and keeps the rest", async () => {
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("/1")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("/2")) throw Object.assign(new Error("Busy"), { statusCode: 503 });
      return { statusCode: 201 };
    });
    await noticeNewBooking("salon", booking, TZ);
    expect(db.deleted).toEqual(["d1"]);
    // The notices are there whatever happened to the pushes.
    expect(db.notices).toHaveLength(2);
  });

  it("never fails the booking it is about", async () => {
    db.users = null as unknown as typeof db.users;
    await expect(noticeNewBooking("salon", booking, TZ)).resolves.toBeUndefined();
  });
});
