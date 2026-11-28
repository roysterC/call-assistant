import { describe, expect, it } from "vitest";
import {
  addonsNeeding,
  addonsWith,
  assistantVoiceOn,
  changedAddons,
  countPeople,
  formatPence,
  fromStripeStatus,
  monthlyBill,
  planState,
  seatsFor,
  trialEnd,
  type PlanInput,
} from "@/lib/plan";

const NOW = new Date("2026-12-01T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 864e5);
const base: PlanInput = { billingStatus: "trialing", trialEndsAt: day(10), stripeSubscriptionId: null, addons: [] };

describe("the bill", () => {
  it("is £9 with the owner, and £5 for each other person on the team", () => {
    expect(monthlyBill({}, 0, []).total).toBe(900);
    expect(monthlyBill({}, 3, [])).toEqual({
      lines: [
        { key: "base", quantity: 1, pence: 900 },
        { key: "seat", quantity: 3, pence: 1500 },
      ],
      total: 2400,
    });
  });

  it("adds the add-ons that have a price, and leaves off one that has none", () => {
    expect(monthlyBill({ chatReplies: 1500 }, 1, ["chatReplies", "receptionist"]).total).toBe(900 + 500 + 1500);
  });

  it("uses Kikai's prices over the founder ones", () => {
    expect(monthlyBill({ base: 1900, seat: 700 }, 2, []).total).toBe(1900 + 1400);
  });

  it("says pounds as pounds", () => {
    expect(formatPence(900)).toBe("£9");
    expect(formatPence(1250)).toBe("£12.50");
  });
});

describe("people on the team", () => {
  it("counts everyone on the team, whether they sign in, take bookings or not", () => {
    expect(countPeople([{ userId: "u1" }, { userId: null }, { userId: null }], [{ id: "u1", role: "admin" }])).toBe(3);
  });

  it("counts a login that is not on the team, once, and never Kikai's own or a withdrawn one", () => {
    const team = [{ userId: "u1" }];
    const logins = [
      { id: "u1", role: "admin" },
      { id: "u2", role: "member" },
      { id: "k", role: "superAdmin" },
      { id: "old", role: "stylist" },
    ];
    expect(countPeople(team, logins)).toBe(2);
  });

  it("counts the owner who added themselves to the team once, and staff whose login matches their entry", () => {
    // Onboarding's "Add me": a team entry with the owner's name, not linked.
    expect(countPeople([{ userId: null, name: "Mai Tran" }], [{ id: "o", role: "admin", name: "mai tran", email: "mai@x.com" }])).toBe(1);
    // A member of staff invited by email, her entry carrying it.
    expect(
      countPeople(
        [{ userId: null, name: "Mai" }, { userId: null, name: "Kim Le", email: "kim@x.com" }],
        [
          { id: "o", role: "admin", name: "Mai" },
          { id: "k", role: "member", name: "Kimmy", email: "KIM@x.com" },
        ]
      )
    ).toBe(2);
    // Staff are matched by email, never by name alone: two may share one.
    expect(countPeople([{ userId: null, name: "Kim" }], [{ id: "a", role: "member", name: "Kim" }])).toBe(2);
    // One entry stands for one login only.
    expect(countPeople([{ userId: null, name: "Sam" }], [{ id: "a", role: "admin", name: "Sam" }, { id: "b", role: "admin", name: "Sam" }])).toBe(2);
  });

  it("charges for each one but the owner", () => {
    expect(seatsFor(0)).toBe(0);
    expect(seatsFor(1)).toBe(0);
    expect(seatsFor(4)).toBe(3);
  });
});

describe("the free trial", () => {
  it("runs 14 days", () => {
    expect(trialEnd(NOW).getTime() - NOW.getTime()).toBe(14 * 864e5);
  });

  it("is the base plan only, until there is a card", () => {
    const s = planState({ ...base, addons: ["chatReplies"] }, NOW);
    expect(s).toMatchObject({ status: "trialing", access: "full", trialDaysLeft: 10, hasCard: false, warning: "trialNoCard" });
    expect(s.addonActive.chatReplies).toBe(false);
  });

  it("warns in its last three days", () => {
    expect(planState({ ...base, trialEndsAt: day(2) }, NOW).warning).toBe("trialEnding");
  });

  it("restricts the salon when it ends with no card, with nothing run at midnight", () => {
    expect(planState({ ...base, trialEndsAt: day(-1) }, NOW)).toMatchObject({ status: "restricted", access: "restricted" });
  });

  it("with a card, carries on into the paid plan, add-ons working", () => {
    const s = planState({ ...base, stripeSubscriptionId: "sub_1", addons: ["chatReplies"], trialEndsAt: day(-1) }, NOW);
    expect(s.access).toBe("full");
    expect(s.addonActive.chatReplies).toBe(true);
    expect(s.warning).toBeNull();
  });

  it("has not started while the owner has not signed in", () => {
    expect(planState({ ...base, trialEndsAt: null }, NOW)).toMatchObject({ access: "full", trialDaysLeft: null });
  });
});

describe("add-ons", () => {
  const paying = (addons: string[]) =>
    planState({ billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_1", addons }, NOW);

  it("work only while on the plan", () => {
    const s = paying(["receptionist"]);
    expect(s.addonActive).toEqual({ receptionist: true, chatReplies: false, chatBooking: false, rebookTexts: false });
  });

  it("work only with what they work through", () => {
    expect(paying(["chatBooking"]).addonActive.chatBooking).toBe(false);
    expect(paying(["chatBooking", "chatReplies"]).addonActive.chatBooking).toBe(true);
    expect(paying(["rebookTexts", "chatReplies"]).addonActive.rebookTexts).toBe(false);
    expect(paying(["rebookTexts", "chatBooking", "chatReplies"]).addonActive.rebookTexts).toBe(true);
  });

  it("bring what they need when added, and take what needs them when removed", () => {
    expect(addonsWith("rebookTexts")).toEqual(["rebookTexts", "chatBooking", "chatReplies"]);
    expect(addonsNeeding("chatReplies").sort()).toEqual(["chatBooking", "rebookTexts"]);
    expect(changedAddons([], "rebookTexts", true)).toEqual(["chatReplies", "chatBooking", "rebookTexts"]);
    expect(changedAddons(["chatReplies", "chatBooking", "receptionist"], "chatReplies", false)).toEqual(["receptionist"]);
  });

  it("all work for a salon that is not billed, on the plan or not", () => {
    const s = planState({ billingStatus: "free", trialEndsAt: null, stripeSubscriptionId: null, addons: [] }, NOW);
    expect(Object.values(s.addonActive).every(Boolean)).toBe(true);
    expect(s).toMatchObject({ billed: false, access: "full", warning: null });
  });

  it("all stop while restricted", () => {
    const s = planState({ billingStatus: "restricted", trialEndsAt: null, stripeSubscriptionId: "sub_1", addons: ["receptionist"] }, NOW);
    expect(s.addonActive.receptionist).toBe(false);
    expect(s.warning).toBe("restricted");
  });
});

describe("a cancelled plan", () => {
  it("says when it ends, and works until then", () => {
    const s = planState(
      { billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_1", addons: ["receptionist"], cancelAt: day(12) },
      NOW
    );
    expect(s).toMatchObject({ access: "full", endsAt: day(12).toISOString(), warning: null });
    expect(s.addonActive.receptionist).toBe(true);
  });
});

describe("a failed payment", () => {
  it("keeps everything working while Stripe retries, with a warning", () => {
    const s = planState({ billingStatus: "past_due", trialEndsAt: null, stripeSubscriptionId: "sub_1", addons: ["receptionist"] }, NOW);
    expect(s).toMatchObject({ access: "full", warning: "paymentFailed" });
    expect(s.addonActive.receptionist).toBe(true);
  });

  it("reads Stripe's states as ours", () => {
    expect(fromStripeStatus("active")).toBe("active");
    expect(fromStripeStatus("past_due")).toBe("past_due");
    expect(fromStripeStatus("unpaid")).toBe("restricted");
    expect(fromStripeStatus("canceled")).toBe("restricted");
    expect(fromStripeStatus("incomplete")).toBeNull();
  });

  it("treats a state it does not know as restricted, never as free", () => {
    expect(planState({ billingStatus: "frее", trialEndsAt: null, stripeSubscriptionId: null, addons: [] }, NOW).access).toBe("restricted");
  });
});

describe("the assistant's voice", () => {
  const voice = (o: Partial<PlanInput>) => assistantVoiceOn(planState({ ...base, ...o }, NOW));

  it("is off on a trial or a paid plan with no AI add-on", () => {
    expect(voice({})).toBe(false);
    expect(voice({ stripeSubscriptionId: "sub_1" })).toBe(false);
    expect(voice({ billingStatus: "active", stripeSubscriptionId: "sub_1" })).toBe(false);
  });

  it("is on with any AI add-on that works", () => {
    expect(voice({ billingStatus: "active", stripeSubscriptionId: "sub_1", addons: ["chatReplies"] })).toBe(true);
    expect(voice({ billingStatus: "active", stripeSubscriptionId: "sub_1", addons: ["receptionist"] })).toBe(true);
    // On trial, an add-on works once a card is on file.
    expect(voice({ stripeSubscriptionId: "sub_1", addons: ["chatReplies"] })).toBe(true);
    expect(voice({ addons: ["chatReplies"] })).toBe(false);
  });

  it("is on for a salon that isn't billed, and off once restricted", () => {
    expect(voice({ billingStatus: "free", trialEndsAt: null })).toBe(true);
    expect(voice({ billingStatus: "restricted", addons: ["chatReplies"] })).toBe(false);
  });
});
