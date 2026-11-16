import { describe, expect, it } from "vitest";
import {
  DIARY,
  NAV_PAGES,
  isNavAllowed,
  isNavVisible,
  isNavShown,
  splitNav,
  resolveStartPage,
  featureFlags,
  hasDiary,
  type FeatureFlags,
} from "./navigation";

const salon: FeatureFlags = {
  voiceEnabled: true,
  diaryEnabled: true,
  chatbotEnabled: false,
  whatsappEnabled: false,
  instagramEnabled: false,
  facebookEnabled: false,
};
const chatOnly: FeatureFlags = { ...salon, voiceEnabled: false, diaryEnabled: false, chatbotEnabled: true };

describe("isNavVisible", () => {
  it("shows no feature page until the organisation's features have loaded", () => {
    const diary = NAV_PAGES.find((p) => p.href === DIARY)!;
    expect(isNavVisible(diary, null)).toBe(false);
    expect(isNavVisible(diary, salon)).toBe(true);
    expect(isNavVisible(diary, chatOnly)).toBe(false);
  });
});

describe("the diary", () => {
  const diary = NAV_PAGES.find((p) => p.href === DIARY)!;
  const flags = (s: Parameters<typeof featureFlags>[0]) => featureFlags(s);

  it("comes with the phone receptionist, with booking by message, or on its own", () => {
    expect(hasDiary({ voiceEnabled: true })).toBe(true);
    expect(hasDiary({ chatBookingEnabled: true })).toBe(true);
    expect(hasDiary({ diaryEnabled: true })).toBe(true);
    expect(hasDiary({ instagramEnabled: true } as never)).toBe(false);
  });

  it("shows the diary, clients, sales and callbacks to a salon booking only by Instagram", () => {
    const instagramOnly = flags({ instagramEnabled: true, chatBookingEnabled: true });
    for (const href of [DIARY, "/clients", "/sales", "/callbacks"]) {
      expect(isNavVisible(NAV_PAGES.find((p) => p.href === href)!, instagramOnly)).toBe(true);
    }
    expect(isNavVisible(NAV_PAGES.find((p) => p.href === "/insights")!, instagramOnly)).toBe(false);
  });

  it("and to a salon that only wants the diary", () => {
    expect(isNavVisible(diary, flags({ diaryEnabled: true }))).toBe(true);
  });
});

describe("removed pages", () => {
  it("are gone from the menu: Dashboard, Call history, Leads and Appointments", () => {
    for (const href of ["/dashboard", "/calls", "/leads", "/appointments"]) {
      expect(NAV_PAGES.some((p) => p.href === href)).toBe(false);
    }
  });

  it("leave a salon's people on Clients", () => {
    const clients = NAV_PAGES.find((p) => p.href === "/clients")!;
    expect(isNavShown(clients, salon, "member")).toBe(true);
  });
});

describe("resolveStartPage", () => {
  it("opens a salon whose diary takes bookings on the diary", () => {
    expect(resolveStartPage({ flags: salon, diaryTakesBookings: true })).toBe(DIARY);
  });

  it("opens a salon whose diary is not set up yet on Settings, where services and team are added", () => {
    expect(resolveStartPage({ flags: salon, diaryTakesBookings: false })).toBe("/settings");
  });

  it("opens an organisation without the diary on Conversations", () => {
    expect(resolveStartPage({ flags: chatOnly, diaryTakesBookings: true })).toBe("/conversations");
  });

  it("opens on Settings when there is nothing else to show", () => {
    const nothing = { ...chatOnly, chatbotEnabled: false };
    expect(resolveStartPage({ flags: nothing, diaryTakesBookings: false })).toBe("/settings");
  });
});

describe("owner-only pages", () => {
  const insights = NAV_PAGES.find((p) => p.href === "/insights")!;
  const diary = NAV_PAGES.find((p) => p.href === DIARY)!;

  it("keep Insights from members", () => {
    expect(isNavAllowed(insights, "member")).toBe(false);
    expect(isNavAllowed(insights, "admin")).toBe(true);
    expect(isNavAllowed(insights, "superAdmin")).toBe(true);
    expect(isNavAllowed(diary, "member")).toBe(true);
  });

  it("no longer include Websites: a salon sets its chat up in Settings", () => {
    expect(NAV_PAGES.some((p) => p.href === "/websites")).toBe(false);
  });

  it("show Insights to a salon with the receptionist but no chatbot", () => {
    expect(isNavVisible(insights, { ...salon, chatbotEnabled: false })).toBe(true);
    expect(isNavVisible(insights, chatOnly)).toBe(true);
    expect(
      isNavVisible(insights, { ...salon, voiceEnabled: false, chatbotEnabled: false })
    ).toBe(false);
  });
});

describe("the menu's three parts", () => {
  const page = (href: string) => ({ href });
  const salon = ["/conversations", "/insights", "/calendar", "/clients", "/sales", "/callbacks", "/settings"].map(page);
  const hrefs = (ps: { href: string }[]) => ps.map((p) => p.href);

  it("puts Diary and Conversations up front, Settings apart, the rest under More in order", () => {
    const { primary, more, settings } = splitNav(salon);
    expect(hrefs(primary)).toEqual([DIARY, "/conversations"]);
    expect(hrefs(more)).toEqual(["/insights", "/clients", "/sales", "/callbacks"]);
    expect(settings?.href).toBe("/settings");
  });

  it("never leaves an organisation with nothing up front", () => {
    const chatless = ["/insights", "/clients", "/settings"].map(page);
    expect(hrefs(splitNav(chatless).primary)).toEqual(["/insights"]);
    expect(hrefs(splitNav(chatless).more)).toEqual(["/clients"]);
  });
});
