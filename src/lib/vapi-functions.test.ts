import { describe, expect, it } from "vitest";
import { callerNumberFromVapiPayload } from "./vapi-functions";

/**
 * The payload shape varies by event and by which tool format the assistant is
 * configured with, and getting it wrong is silent: the number comes back null,
 * the fallback never runs, and the agent asks the caller to read out the
 * number it is already being rung from. Each shape below is one Vapi actually
 * sends.
 */
describe("callerNumberFromVapiPayload", () => {
  const number = "+447700900123";

  it("reads it from a server-URL function call", () => {
    expect(
      callerNumberFromVapiPayload({
        message: {
          type: "function-call",
          functionCall: { name: "book_appointment", parameters: {} },
          call: { customer: { number } },
        },
      })
    ).toBe(number);
  });

  it("reads it from a toolCallList payload", () => {
    expect(
      callerNumberFromVapiPayload({
        message: {
          toolCallList: [{ function: { name: "book_appointment", arguments: "{}" } }],
          call: { customer: { number } },
        },
      })
    ).toBe(number);
  });

  it("reads it when the call sits at the root", () => {
    expect(
      callerNumberFromVapiPayload({ call: { customer: { number } } })
    ).toBe(number);
  });

  it("reads it when the customer sits beside the message", () => {
    expect(
      callerNumberFromVapiPayload({ message: { customer: { number } } })
    ).toBe(number);
  });

  it("returns null for a web call, which has no number to ring from", () => {
    expect(
      callerNumberFromVapiPayload({
        message: { type: "function-call", call: { assistantId: "a1" } },
      })
    ).toBeNull();
  });

  it("returns null rather than a blank that would pass a truthiness check", () => {
    expect(
      callerNumberFromVapiPayload({ message: { call: { customer: { number: "" } } } })
    ).toBeNull();
    expect(
      callerNumberFromVapiPayload({ message: { call: { customer: { number: "   " } } } })
    ).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(
      callerNumberFromVapiPayload({
        message: { call: { customer: { number: 447700900123 } } },
      })
    ).toBeNull();
    expect(
      callerNumberFromVapiPayload({ message: { call: { customer: null } } })
    ).toBeNull();
  });

  it("survives a payload with nothing in it", () => {
    expect(callerNumberFromVapiPayload({})).toBeNull();
  });
});

// --- Phone bookings only go where the diary would offer --------------------

import { phoneSlotProblem } from "./vapi-functions";
import type { SalonConfig } from "@/lib/booking";
import type { BookingProvider } from "@/lib/booking/types";

describe("phoneSlotProblem", () => {
  const cut = { name: "Cut and finish", durationMinutes: 45, bufferMinutes: 0, requiresPatchTest: false, priceMinor: 4500 };
  const marcus = { name: "Marcus", workingDays: [2, 3, 4, 5], services: [] };
  const cfg = {
    timeZone: "Europe/London",
    hours: [
      { day: 0, closed: true, open: "", close: "" },
      { day: 3, closed: false, open: "09:00", close: "18:00" },
      { day: 6, closed: false, open: "08:30", close: "17:00" },
    ],
    services: [cut],
    stylists: [marcus],
  } as unknown as SalonConfig;
  // Wednesday 30 September 2026, London (UTC+1).
  const at = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00+01:00`);
  const offering = (...times: string[]) =>
    ({
      id: "native",
      capabilities: { readAvailability: true },
      getAvailability: async () => times.map((t) => ({ start: at(t).toISOString(), end: "", stylistName: "Marcus" })),
    }) as unknown as BookingProvider;

  it("refuses 3am, which a named stylist and a straight booking once let through", async () => {
    const why = await phoneSlotProblem(offering("03:00"), "org", cfg, at("03:00"), cut, marcus, { offeredOnly: true });
    expect(why).toMatch(/outside opening hours/);
  });

  it("refuses a service that would run past closing", async () => {
    const why = await phoneSlotProblem(offering("17:30"), "org", cfg, at("17:30"), cut, marcus, { offeredOnly: true });
    expect(why).toMatch(/open 09:00 to 18:00/);
  });

  it("refuses a closed day, and a day the stylist is not in", async () => {
    const sunday = new Date("2026-10-04T10:00:00+01:00");
    expect(await phoneSlotProblem(offering(), "org", cfg, sunday, cut, marcus, { offeredOnly: false })).toMatch(/closed on Sundays/);
    const saturday = new Date("2026-10-03T10:00:00+01:00");
    expect(await phoneSlotProblem(offering(), "org", cfg, saturday, cut, marcus, { offeredOnly: false })).toMatch(
      /Marcus does not work on Saturdays/
    );
  });

  it("refuses a new booking at a time the diary would not offer", async () => {
    const why = await phoneSlotProblem(offering("10:00"), "org", cfg, at("11:00"), cut, marcus, { offeredOnly: true });
    expect(why).toMatch(/check_availability/);
  });

  it("allows a time the diary offers, inside hours", async () => {
    expect(await phoneSlotProblem(offering("10:00"), "org", cfg, at("10:00"), cut, marcus, { offeredOnly: true })).toBeNull();
    // A move is checked on hours alone: its own current slot would look busy.
    expect(await phoneSlotProblem(offering(), "org", cfg, at("11:00"), cut, marcus, { offeredOnly: false })).toBeNull();
  });
});
