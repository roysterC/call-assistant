import { describe, expect, it } from "vitest";
import {
  summariseAvailabilityCall,
  telemetryLine,
} from "./voice-telemetry";

const TODAY = "2026-09-16";

describe("summariseAvailabilityCall", () => {
  it("records how far ahead a 'soonest' answer came from", () => {
    const t = summariseAvailabilityCall(
      { prefer: "earliest" },
      {
        available: true,
        canCheck: true,
        today: TODAY,
        date: "2026-09-19",
        service: "Cut and finish",
        options: [{ time: "10:00" }, { time: "14:00" }],
      }
    );
    expect(t).not.toBeNull();
    expect(t!.prefer).toBe("earliest");
    expect(t!.dateGiven).toBe(false);
    expect(t!.outcome).toBe("found");
    expect(t!.answeredDaysOut).toBe(3);
    expect(t!.optionCount).toBe(2);
    expect(t!.service).toBe("Cut and finish");
  });

  it("is zero days out when the answer is today", () => {
    const t = summariseAvailabilityCall(
      { prefer: "earliest" },
      { available: true, canCheck: true, today: TODAY, date: TODAY, options: [] }
    );
    expect(t!.answeredDaysOut).toBe(0);
  });

  it("uses the fallback offer when the day asked for was empty", () => {
    const t = summariseAvailabilityCall(
      { date: "2026-09-16", prefer: "any" },
      {
        available: false,
        canCheck: true,
        today: TODAY,
        date: "2026-09-16",
        searchedDays: 14,
        nextAvailable: { date: "2026-09-23", options: [{ time: "09:00" }] },
      }
    );
    expect(t!.outcome).toBe("none");
    expect(t!.dateGiven).toBe(true);
    expect(t!.answeredDaysOut).toBe(7);
    expect(t!.searchedDays).toBe(14);
  });

  it("has no days-out when nothing at all was offered", () => {
    const t = summariseAvailabilityCall(
      { prefer: "earliest" },
      {
        available: false,
        canCheck: true,
        today: TODAY,
        date: TODAY,
        searchedDays: 14,
      }
    );
    expect(t!.answeredDaysOut).toBeNull();
    expect(t!.outcome).toBe("none");
  });

  it("separates closed and patch-test from plain emptiness", () => {
    const base = { available: false, canCheck: true, today: TODAY, date: TODAY };
    expect(summariseAvailabilityCall({}, { ...base, closed: true })!.outcome)
      .toBe("closed");
    expect(
      summariseAvailabilityCall({}, { ...base, patchTestRequired: true })!
        .outcome
    ).toBe("patch_test");
  });

  it("notes when the answer moved to a different day", () => {
    const t = summariseAvailabilityCall(
      { date: "2026-09-16" },
      {
        available: true,
        canCheck: true,
        today: TODAY,
        date: "2026-09-17",
        requestedDate: "2026-09-16",
        options: [{ time: "11:00" }],
      }
    );
    expect(t!.movedOn).toBe(true);
    expect(t!.answeredDaysOut).toBe(1);
  });

  it("ignores organisations that cannot check availability", () => {
    expect(
      summariseAvailabilityCall({}, { canCheck: false, available: false })
    ).toBeNull();
  });

  it("survives a malformed date rather than throwing", () => {
    const t = summariseAvailabilityCall(
      {},
      { available: true, canCheck: true, today: "not-a-date", date: TODAY }
    );
    expect(t!.answeredDaysOut).toBeNull();
  });
});

describe("telemetryLine", () => {
  it("is one grep-able line with no spaces inside fields", () => {
    const t = summariseAvailabilityCall(
      { prefer: "earliest" },
      {
        available: true,
        canCheck: true,
        today: TODAY,
        date: "2026-09-18",
        service: "Cut and finish",
        options: [{ time: "10:00" }],
      }
    )!;
    const line = telemetryLine(t);
    expect(line).toBe(
      "[VAPI][availability] prefer=earliest dateGiven=n movedOn=n " +
        "outcome=found daysOut=2 searchedDays=- options=1 service=Cut_and_finish"
    );
    expect(line.split("\n")).toHaveLength(1);
  });
});
