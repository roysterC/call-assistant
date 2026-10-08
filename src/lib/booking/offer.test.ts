import { describe, expect, it } from "vitest";
import { chooseOffer, type OfferInput } from "./offer";
import type { TimeSlot } from "./types";

// Thursday 15 and Friday 16 October 2026, London on summer time (UTC+1).
const tz = "Europe/London";
const at = (day: number, hhmm: string, stylistName = "Chloe"): TimeSlot => {
  const [h, m] = hhmm.split(":").map(Number);
  const start = new Date(Date.UTC(2026, 9, day, h - 1, m)).toISOString();
  return { start, end: start, stylistName };
};
const local = (s: TimeSlot) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(s.start)
  );
const offer = (slots: TimeSlot[], more: Partial<OfferInput> = {}) => {
  const o = chooseOffer({ slots, timeZone: tz, day: "2026-10-15", named: true, minGapMinutes: 45, ...more });
  return { kind: o.kind, picks: o.picks.map(local) };
};

const thursday = [at(15, "10:00"), at(15, "10:45"), at(15, "11:30"), at(15, "14:00"), at(15, "15:30")];

describe("which times are offered", () => {
  it("offers the time they asked for on its own when it is free", () => {
    expect(offer(thursday, { time: "14:00" })).toEqual({ kind: "exact", picks: ["Thu 14:00"] });
  });

  it("offers the two nearest when the time they asked for is taken", () => {
    expect(offer(thursday, { time: "13:00" })).toEqual({ kind: "choices", picks: ["Thu 11:30", "Thu 14:00"] });
  });

  it("tops up from the next day, nearest that time of day, when the day has only one near it", () => {
    const r = offer([at(15, "10:00"), at(16, "09:00"), at(16, "13:00"), at(16, "17:00")], { time: "13:00" });
    expect(r).toEqual({ kind: "choices", picks: ["Thu 10:00", "Fri 13:00"] });
  });

  it("offers a morning and an afternoon on the day they named, not an open question", () => {
    expect(offer(thursday)).toEqual({ kind: "choices", picks: ["Thu 10:00", "Thu 14:00"] });
  });

  it("keeps the morning and the afternoon well apart, not 11 and 12", () => {
    const r = offer([at(15, "11:00"), at(15, "12:00"), at(15, "12:45"), at(15, "14:00"), at(15, "16:00")]);
    expect(r).toEqual({ kind: "choices", picks: ["Thu 11:00", "Thu 14:00"] });
    // With nothing later that afternoon, the latest it has.
    expect(offer([at(15, "11:00"), at(15, "12:00"), at(15, "12:45")])).toEqual({
      kind: "choices",
      picks: ["Thu 11:00", "Thu 12:45"],
    });
  });

  it("keeps two choices on one half of the day well apart, not back to back", () => {
    // Two hours apart is not possible here, so as far apart as the day allows.
    expect(offer([at(15, "14:00"), at(15, "14:45"), at(15, "15:30")])).toEqual({
      kind: "choices",
      picks: ["Thu 14:00", "Thu 15:30"],
    });
    expect(offer([at(15, "13:00"), at(15, "13:45"), at(15, "15:00"), at(15, "16:00")])).toEqual({
      kind: "choices",
      picks: ["Thu 13:00", "Thu 15:00"],
    });
  });

  it("offers the one time a day has, and the soonest after it", () => {
    expect(offer([at(15, "16:00"), at(16, "10:00")])).toEqual({ kind: "choices", picks: ["Thu 16:00", "Fri 10:00"] });
  });

  it("offers the two soonest on later days when the day they named has nothing", () => {
    expect(offer([at(16, "10:00"), at(16, "10:45"), at(16, "14:00")])).toEqual({
      kind: "choices",
      picks: ["Fri 10:00", "Fri 14:00"],
    });
  });

  it("offers the two soonest, on different days if need be, for 'when are you next free?'", () => {
    expect(offer([at(15, "17:00"), at(16, "10:00")], { named: false })).toEqual({
      kind: "choices",
      picks: ["Thu 17:00", "Fri 10:00"],
    });
  });

  it("treats one time in two diaries as one choice", () => {
    const r = offer([at(15, "10:00", "Chloe"), at(15, "10:00", "Jo"), at(15, "14:00", "Jo")]);
    expect(r).toEqual({ kind: "choices", picks: ["Thu 10:00", "Thu 14:00"] });
  });

  it("has nothing to offer when nothing is free", () => {
    expect(offer([])).toEqual({ kind: "none", picks: [] });
    expect(offer([at(14, "10:00")])).toEqual({ kind: "none", picks: [] });
  });
});
