import { describe, expect, it } from "vitest";
import { parsePatchTestDate, patchTestDay } from "./patch-test";

const now = new Date("2026-10-06T09:00:00Z");

describe("parsePatchTestDate", () => {
  it("stores a day at noon UTC, so it reads the same everywhere", () => {
    const r = parsePatchTestDate("2026-09-30", now);
    expect(r).toEqual({ ok: true, value: new Date("2026-09-30T12:00:00Z") });
    if (r.ok) expect(patchTestDay(r.value)).toBe("2026-09-30");
  });

  it("accepts today", () => {
    expect(parsePatchTestDate("2026-10-06", now).ok).toBe(true);
  });

  it("clears it", () => {
    expect(parsePatchTestDate(null, now)).toEqual({ ok: true, value: null });
    expect(parsePatchTestDate("", now)).toEqual({ ok: true, value: null });
  });

  it("refuses something that is not a day, or not a real one", () => {
    expect(parsePatchTestDate("30/09/2026", now).ok).toBe(false);
    expect(parsePatchTestDate("2026-02-30", now).ok).toBe(false);
    expect(parsePatchTestDate(20260930, now).ok).toBe(false);
  });

  it("refuses a test in the future", () => {
    expect(parsePatchTestDate("2026-10-09", now).ok).toBe(false);
  });
});
