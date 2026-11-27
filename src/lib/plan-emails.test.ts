import { beforeEach, describe, expect, it, vi } from "vitest";

/** "Your free trial is ending": three days before, the day before, once each. */

const db = vi.hoisted(() => ({ orgs: [] as Array<Record<string, unknown>>, sent: [] as Array<{ to: string; subject: string; html: string }> }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findMany: vi.fn(async () => db.orgs.map((o) => ({ ...o }))),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; trialReminderSent: string | null }; data: Record<string, unknown> }) => {
        const o = db.orgs.find((x) => x.id === where.id)!;
        if (o.trialReminderSent !== where.trialReminderSent) return { count: 0 };
        Object.assign(o, data);
        return { count: 1 };
      }),
    },
  },
}));
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: vi.fn(async (e: { to: string; subject: string; html: string }) => {
    db.sent.push(e);
    return { ok: true, id: "1" };
  }),
}));

import { sendTrialReminders, trialReminderDue } from "@/lib/plan-emails";

const NOW = new Date("2026-12-01T10:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 864e5);
const trial = (days: number, sent: string | null = null) => ({
  billingStatus: "trialing",
  trialEndsAt: inDays(days),
  stripeSubscriptionId: null,
  trialReminderSent: sent,
});

describe("which reminder is due", () => {
  it("none with more than three days left", () => {
    expect(trialReminderDue(trial(5), NOW)).toBeNull();
  });

  it("the three-day one, once", () => {
    expect(trialReminderDue(trial(3), NOW)).toBe("3");
    expect(trialReminderDue(trial(3, "3"), NOW)).toBeNull();
  });

  it("the day-before one, even after the three-day one, once", () => {
    expect(trialReminderDue(trial(1, "3"), NOW)).toBe("1");
    expect(trialReminderDue(trial(1), NOW)).toBe("1");
    expect(trialReminderDue(trial(1, "1"), NOW)).toBeNull();
  });

  it("counts London calendar days, so 'tomorrow' always goes the day before", () => {
    // Ends 6pm tomorrow: 32 hours away, still "tomorrow".
    const endsTomorrowEvening = { ...trial(0), trialEndsAt: new Date("2026-12-02T18:00:00Z") };
    expect(trialReminderDue(endsTomorrowEvening, NOW)).toBe("1");
    // Ends 6pm in two days: not yet "tomorrow".
    expect(trialReminderDue({ ...trial(0), trialEndsAt: new Date("2026-12-03T18:00:00Z") }, NOW)).toBe("3");
  });

  it("none for a salon with a card, not on trial, or whose trial has ended", () => {
    expect(trialReminderDue({ ...trial(1), stripeSubscriptionId: "sub_1" }, NOW)).toBeNull();
    expect(trialReminderDue({ ...trial(1), billingStatus: "free" }, NOW)).toBeNull();
    expect(trialReminderDue(trial(-1), NOW)).toBeNull();
  });
});

describe("sending", () => {
  beforeEach(() => {
    db.sent = [];
    db.orgs = [
      {
        id: "org1",
        name: "Mai Nails",
        ...trial(3),
        users: [
          { email: "owner@example.com", language: "en" },
          { email: "co-owner@example.com", language: "vi" },
        ],
      },
    ];
  });

  it("emails each owner in their language, with a link to add a card", async () => {
    expect(await sendTrialReminders("https://app.example", NOW)).toEqual({ sent: 2, failed: 0 });
    expect(db.sent[0]).toMatchObject({ to: "owner@example.com", subject: "Your Kikai free trial ends in 3 days" });
    expect(db.sent[0].html).toContain("https://app.example/settings#plan");
    expect(db.sent[1].subject).toContain("3 ngày");
  });

  it("sends it once, however often it runs", async () => {
    await sendTrialReminders("https://app.example", NOW);
    expect(await sendTrialReminders("https://app.example", NOW)).toEqual({ sent: 0, failed: 0 });
  });
});
