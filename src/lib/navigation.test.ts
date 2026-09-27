import { describe, expect, it } from "vitest";
import {
  DASHBOARD,
  DIARY,
  NAV_PAGES,
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
    expect(isStartPageChoice("https://example.com")).toBe(false);
  });
});
