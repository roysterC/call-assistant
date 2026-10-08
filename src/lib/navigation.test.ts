import { describe, expect, it } from "vitest";
import {
  DASHBOARD,
  DIARY,
  NAV_PAGES,
  isNavAllowed,
  isNavVisible,
  isStartPageChoice,
  orderForStartPage,
  resolveStartPage,
  type FeatureFlags,
} from "./navigation";

const salon: FeatureFlags = {
  voiceEnabled: true,
  chatbotEnabled: false,
  whatsappEnabled: false,
  instagramEnabled: false,
  facebookEnabled: false,
};
const chatOnly: FeatureFlags = { ...salon, voiceEnabled: false, chatbotEnabled: true };

describe("isNavVisible", () => {
  it("shows no feature page until the organisation's features have loaded", () => {
    const diary = NAV_PAGES.find((p) => p.href === DIARY)!;
    expect(isNavVisible(diary, null)).toBe(false);
    expect(isNavVisible(diary, salon)).toBe(true);
    expect(isNavVisible(diary, chatOnly)).toBe(false);
  });
});

describe("a salon's people", () => {
  const leads = NAV_PAGES.find((p) => p.href === "/leads")!;
  const clients = NAV_PAGES.find((p) => p.href === "/clients")!;

  it("are its Clients, not Leads, once it has the diary", () => {
    expect(isNavVisible(clients, salon)).toBe(true);
    expect(isNavVisible(leads, salon)).toBe(false);
  });

  it("stay Leads for an organisation without it", () => {
    expect(isNavVisible(leads, chatOnly)).toBe(true);
    expect(isNavVisible(clients, chatOnly)).toBe(false);
  });

  it("show neither until the features have loaded", () => {
    expect(isNavVisible(leads, null)).toBe(false);
    expect(isNavVisible(clients, null)).toBe(false);
  });

  it("no longer include Appointments, which the diary shows", () => {
    expect(NAV_PAGES.some((p) => p.href === "/appointments")).toBe(false);
  });
});

describe("resolveStartPage", () => {
  it("opens a salon whose diary takes bookings on the diary", () => {
    expect(resolveStartPage({ chosen: null, flags: salon, diaryTakesBookings: true })).toBe(DIARY);
  });

  it("opens anyone else on the dashboard: no diary set up, or no diary at all", () => {
    expect(resolveStartPage({ chosen: null, flags: salon, diaryTakesBookings: false })).toBe(DASHBOARD);
    expect(resolveStartPage({ chosen: null, flags: chatOnly, diaryTakesBookings: true })).toBe(DASHBOARD);
  });

  it("honours the organisation's own choice over the automatic one", () => {
    expect(resolveStartPage({ chosen: DASHBOARD, flags: salon, diaryTakesBookings: true })).toBe(DASHBOARD);
    expect(resolveStartPage({ chosen: "/conversations", flags: chatOnly, diaryTakesBookings: false })).toBe(
      "/conversations"
    );
  });

  it("ignores a choice the organisation can no longer see, or that is not a page", () => {
    // Diary chosen, then voice switched off: the diary is not in its menu.
    expect(resolveStartPage({ chosen: DIARY, flags: chatOnly, diaryTakesBookings: false })).toBe(DASHBOARD);
    expect(resolveStartPage({ chosen: "/nowhere", flags: salon, diaryTakesBookings: true })).toBe(DIARY);
    expect(resolveStartPage({ chosen: "/settings", flags: salon, diaryTakesBookings: false })).toBe(DASHBOARD);
  });
});

describe("owner-only pages", () => {
  const websites = NAV_PAGES.find((p) => p.href === "/websites")!;
  const insights = NAV_PAGES.find((p) => p.href === "/insights")!;
  const diary = NAV_PAGES.find((p) => p.href === DIARY)!;

  it("keep the websites and chatbot pages from members", () => {
    for (const page of [websites, insights]) {
      expect(isNavAllowed(page, "member")).toBe(false);
      expect(isNavAllowed(page, "admin")).toBe(true);
      expect(isNavAllowed(page, "superAdmin")).toBe(true);
    }
    expect(isNavAllowed(diary, "member")).toBe(true);
  });

  it("show Insights to a salon with the receptionist but no chatbot", () => {
    expect(isNavVisible(insights, { ...salon, chatbotEnabled: false })).toBe(true);
    expect(isNavVisible(insights, chatOnly)).toBe(true);
    expect(
      isNavVisible(insights, { ...salon, voiceEnabled: false, chatbotEnabled: false })
    ).toBe(false);
  });

  it("are a start page for the owner, but a member opens on the automatic page", () => {
    const chosen = "/insights";
    expect(resolveStartPage({ chosen, flags: chatOnly, diaryTakesBookings: false })).toBe(chosen);
    expect(resolveStartPage({ chosen, flags: chatOnly, diaryTakesBookings: false, isOwner: false })).toBe(DASHBOARD);
  });
});

describe("the sidebar's order", () => {
  it("puts the start page first and keeps the rest as listed", () => {
    const ordered = orderForStartPage(NAV_PAGES, DIARY).map((p) => p.href);
    expect(ordered[0]).toBe(DIARY);
    expect(ordered.slice(1)).toEqual(NAV_PAGES.map((p) => p.href).filter((h) => h !== DIARY));
  });

  it("leaves it alone before the start page is known", () => {
    expect(orderForStartPage(NAV_PAGES, null)).toEqual(NAV_PAGES);
  });
});

describe("start page choices", () => {
  it("are the working pages, not Settings or the lab", () => {
    expect(isStartPageChoice(DIARY)).toBe(true);
    expect(isStartPageChoice(DASHBOARD)).toBe(true);
    expect(isStartPageChoice("/settings")).toBe(false);
    expect(isStartPageChoice("/receptionist")).toBe(false);
    // Super-admin only, so never a salon's start page.
    expect(NAV_PAGES.find((p) => p.href === "/receptionist")?.superAdminOnly).toBe(true);
    expect(isStartPageChoice("https://example.com")).toBe(false);
  });
});
