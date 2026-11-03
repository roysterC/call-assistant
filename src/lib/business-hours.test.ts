import { describe, expect, it } from "vitest";
import { parseSpokenTimeOn } from "./business-hours";

describe("parseSpokenTimeOn: a bare hour inside the day's opening hours", () => {
  // Tuesday 29 September 2026.
  const hours = (open: string, close: string) => [{ day: 2, closed: false, open, close }];

  it("reads '3' as three in the afternoon, without asking", () => {
    expect(parseSpokenTimeOn("3", hours("09:00", "18:00"), "2026-09-29")).toBe("15:00");
    expect(parseSpokenTimeOn("half three", hours("09:00", "18:00"), "2026-09-29")).toBe("15:30");
  });

  it("reads '7' as the morning at a salon open from seven, and the evening at one open late", () => {
    expect(parseSpokenTimeOn("7", hours("07:00", "18:00"), "2026-09-29")).toBe("07:00");
    expect(parseSpokenTimeOn("7", hours("09:00", "21:00"), "2026-09-29")).toBe("19:00");
    expect(parseSpokenTimeOn("8", hours("10:00", "21:00"), "2026-09-29")).toBe("20:00");
  });

  it("leaves a time said with am or pm, or in 24-hour form, as it was said", () => {
    expect(parseSpokenTimeOn("7pm", hours("07:00", "18:00"), "2026-09-29")).toBe("19:00");
    expect(parseSpokenTimeOn("3am", hours("09:00", "18:00"), "2026-09-29")).toBe("03:00");
    expect(parseSpokenTimeOn("08:00", hours("10:00", "21:00"), "2026-09-29")).toBe("08:00");
  });

  it("leaves a time that fits neither way for the booking to refuse", () => {
    expect(parseSpokenTimeOn("11", hours("13:00", "18:00"), "2026-09-29")).toBe("11:00");
  });
});
