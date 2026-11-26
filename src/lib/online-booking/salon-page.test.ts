import { describe, expect, it } from "vitest";
import {
  accentFor,
  artFor,
  clockText,
  designMessageLink,
  lowestPrice,
  menuGroups,
  nailGoals,
  openDaysText,
  openStatus,
  treatmentTiles,
  weekHours,
  whenText,
} from "./salon-page";
import type { PublicService } from "./catalogue";
import type { BusinessHours } from "@/lib/business-hours";

const TZ = "Europe/London";
// Tuesday to Sunday; Thursday late; closed Monday.
const HOURS: BusinessHours = [
  { day: 0, closed: false, open: "11:00", close: "17:00" },
  { day: 1, closed: true, open: "", close: "" },
  { day: 2, closed: false, open: "10:00", close: "19:00" },
  { day: 3, closed: false, open: "10:00", close: "19:00" },
  { day: 4, closed: false, open: "11:00", close: "20:30" },
  { day: 5, closed: false, open: "10:00", close: "19:00" },
  { day: 6, closed: false, open: "09:00", close: "18:00" },
];
// Tuesday 24 November 2026, in London (GMT).
const at = (hhmm: string) => new Date(`2026-11-24T${hhmm}:00Z`);

const svc = (name: string, treatment?: string, priceMinor: number | null = null): PublicService => ({
  name,
  durationMinutes: 60,
  priceMinor,
  requiresPatchTest: false,
  stylists: [],
  ...(treatment ? { treatment } : {}),
});

describe("openStatus", () => {
  it("says it's open, and until when", () => {
    expect(openStatus(HOURS, TZ, at("14:00"))).toEqual({ open: true, text: "Open now, until 7pm" });
  });
  it("says when it opens later today", () => {
    expect(openStatus(HOURS, TZ, at("08:15"))).toEqual({ open: false, text: "Opens today at 10am" });
  });
  it("after closing, names the next day it opens", () => {
    expect(openStatus(HOURS, TZ, at("19:00"))?.text).toBe("Opens tomorrow at 10am");
    // Sunday evening: Monday is shut, so Tuesday.
    expect(openStatus(HOURS, TZ, new Date("2026-11-29T18:00:00Z"))?.text).toBe("Opens Tuesday at 10am");
  });
  it("says nothing without hours", () => {
    expect(openStatus([], TZ, at("12:00"))).toBeNull();
  });
});

describe("the hours", () => {
  it("writes times as people do", () => {
    expect(clockText("10:00")).toBe("10am");
    expect(clockText("20:30")).toBe("8:30pm");
    expect(clockText("12:00")).toBe("12pm");
  });
  it("lists the week from Monday, with today marked", () => {
    const week = weekHours(HOURS, TZ, at("12:00"));
    expect(week[0]).toEqual({ day: "Monday", text: "Closed", closed: true, today: false });
    expect(week[1]).toEqual({ day: "Tuesday", text: "10am – 7pm", closed: false, today: true });
    expect(week[3].text).toBe("11am – 8:30pm");
  });
  it("counts the days it opens", () => {
    expect(openDaysText(HOURS)).toEqual({ title: "Open 6 days", detail: "Closed Mondays" });
    expect(openDaysText(HOURS.map((h) => ({ ...h, closed: false, open: "09:00", close: "17:00" })))?.title).toBe("Open every day");
  });
});

describe("treatmentTiles", () => {
  it("makes one tile per treatment, in menu order, opening on its options", () => {
    const tiles = treatmentTiles([
      svc("BIAB overlay", "BIAB"),
      svc("BIAB infill", "BIAB"),
      svc("Gel polish, hands", "Gel polish"),
      svc("Pedicure", "Pedicure"),
    ]);
    expect(tiles.map((t) => [t.name, t.art, t.count])).toEqual([
      ["BIAB", "biab", 2],
      ["Gel polish", "gel", 1],
      ["Pedicure", "pedicure", 1],
    ]);
    expect(tiles[0].query).toEqual({ treatment: "BIAB" });
    // One service: straight to its times.
    expect(tiles[1].query).toEqual({ service: "Gel polish, hands" });
  });
  it("gives a flat price list a tile per service", () => {
    expect(treatmentTiles([svc("Acrylic full set"), svc("Nail art")]).map((t) => [t.name, t.art, t.query])).toEqual([
      ["Acrylic full set", "acrylic", { service: "Acrylic full set" }],
      ["Nail art", "art", { service: "Nail art" }],
    ]);
  });
  it("draws what the name says", () => {
    expect(artFor("Builder gel")).toBe("biab");
    expect(artFor("Gel-X extensions")).toBe("acrylic");
    expect(artFor("Luxury manicure")).toBe("gel");
    expect(artFor("Toes")).toBe("pedicure");
    expect(artFor("Waxing")).toBe("other");
  });
});

describe("the rest of the page", () => {
  it("finds the lowest price", () => {
    expect(lowestPrice([svc("A", undefined, 3500), svc("B", undefined, 2800), svc("C")])).toEqual({ minor: 2800, service: "B" });
    expect(lowestPrice([svc("C")])).toBeNull();
  });
  it("says when the next free time is", () => {
    expect(whenText("2026-11-24", "2:30pm", TZ, at("12:00"))).toBe("Today at 2:30pm");
    expect(whenText("2026-11-25", "10am", TZ, at("12:00"))).toBe("Tomorrow at 10am");
    expect(whenText("2026-11-27", "11am", TZ, at("12:00"))).toBe("Friday at 11am");
  });
  it("sends a design to Instagram first, else WhatsApp", () => {
    expect(designMessageLink({ instagram: "lumi.nails", whatsapp: { number: "+447700900123" } })).toEqual({
      label: "Message @lumi.nails",
      href: "https://ig.me/m/lumi.nails",
    });
    expect(designMessageLink({ instagram: null, whatsapp: { number: "+44 7700 900123" } })?.href).toBe("https://wa.me/447700900123");
    expect(designMessageLink(null)).toBeNull();
  });
});

describe("accentFor", () => {
  it("is orange on cool and neutral brand colours", () => {
    expect(accentFor("#b794f6")).toBe("#ff8748");
    expect(accentFor("#2b6cb0")).toBe("#ff8748");
    expect(accentFor("#777777")).toBe("#ff8748");
  });
  it("is cream where orange would clash", () => {
    expect(accentFor("#9d3b5e")).toBe("#fff4e8");
    expect(accentFor("#e0702f")).toBe("#fff4e8");
    expect(accentFor("#f2c14e")).toBe("#fff4e8");
  });
  it("falls back to orange for anything that isn't a colour", () => {
    expect(accentFor("pink")).toBe("#ff8748");
  });
});

describe("nailGoals", () => {
  it("offers one goal per kind of treatment, in the salon's words and prices", () => {
    const goals = nailGoals([
      { ...svc("BIAB overlay", "Builder gel", 3500), durationMinutes: 75 },
      { ...svc("BIAB infill", "Builder gel", 3000), durationMinutes: 60 },
      svc("Gel manicure", "Gel", 2800),
      svc("Gel pedicure", "Pedicures", 3200),
    ]);
    expect(goals.map((g) => g.art)).toEqual(["biab", "gel", "pedicure"]);
    expect(goals[0]).toMatchObject({ name: "Builder gel", fromMinor: 3000, minutes: 60, query: { treatment: "Builder gel" } });
    expect(goals[1]).toMatchObject({ name: "Gel", query: { service: "Gel manicure" } });
  });
  it("works from service names when there are no treatments", () => {
    const goals = nailGoals([svc("Acrylic full set", undefined, 4000), svc("Nail art (per nail)")]);
    expect(goals.map((g) => [g.art, g.name, g.fromMinor])).toEqual([
      ["acrylic", "Acrylic full set", 4000],
      ["art", "Nail art (per nail)", null],
    ]);
  });
  it("is empty when there would be only one choice", () => {
    expect(nailGoals([svc("Gel manicure", "Gel"), svc("Gel removal", "Gel")])).toEqual([]);
  });
});

describe("menuGroups", () => {
  it("groups by treatment and puts loose services last as More", () => {
    const groups = menuGroups([svc("Classic manicure"), svc("Gel manicure", "Gel"), svc("Gel toes", "Gel")]);
    expect(groups.map((g) => [g.heading, g.services.length])).toEqual([
      ["Gel", 2],
      ["More", 1],
    ]);
  });
  it("leaves a flat price list unheaded", () => {
    expect(menuGroups([svc("A"), svc("B")])).toEqual([{ heading: null, services: [svc("A"), svc("B")] }]);
  });
});
