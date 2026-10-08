import { describe, expect, it, vi } from "vitest";
import { ReadBackGate, readBackSentence, type PreparedBooking } from "./read-back";

const checked: PreparedBooking = {
  success: true,
  ready: true,
  service: "Wash and blow dry, medium hair",
  stylist: "Chloe",
  startsAt: "2026-10-15T11:00:00+01:00",
  when: "Thursday 15 October at 11am",
  clientName: "Hannah Lee",
  phone: "+447700900604",
  usedCallerId: true,
  patchTestRequired: false,
};

/** A gate over stand-in checks and bookings, with the caller's turns in our hands. */
function gate(check: unknown = checked) {
  let turn = 1;
  const deps = {
    turn: () => turn,
    check: vi.fn(async () => check),
    book: vi.fn(async (input: Record<string, unknown>) => ({ success: true, booked: input })),
  };
  return { g: new ReadBackGate(deps), deps, callerSpeaks: () => turn++ };
}

const asked = { time: "2026-10-15T11:00:00+01:00", service: "medium blow dry", customerName: "Hannah Lee" };

describe("booking only after a read-back the caller has answered", () => {
  it("checks the booking and hands back what to read out, booking nothing", async () => {
    const { g, deps } = gate();
    const r = (await g.prepare(asked)) as { bookingRef: string; readBack: string; message: string };
    expect(deps.check).toHaveBeenCalledWith(asked);
    expect(deps.book).not.toHaveBeenCalled();
    expect(r.readBack).toBe(
      "Wash and blow dry, medium hair with Chloe on Thursday 15 October at 11am, for Hannah Lee, " +
        "and the confirmation text goes to the phone they're calling from."
    );
    expect(r.message).toMatch(/^Nothing is booked yet/);
    expect(r.message).toMatch(new RegExp(`bookingRef ${r.bookingRef}`));
  });

  it("will not book in the same breath as the read-back", async () => {
    const { g, deps } = gate();
    const { bookingRef } = (await g.prepare(asked)) as { bookingRef: string };
    const r = (await g.book({ bookingRef })) as { success: boolean; message: string };
    expect(r).toMatchObject({ success: false, notBooked: true });
    expect(r.message).toMatch(/^NOT booked: the caller has not answered/);
    expect(deps.book).not.toHaveBeenCalled();
  });

  it("books once the caller has answered: what was read back, stylist and time as checked", async () => {
    const { g, deps, callerSpeaks } = gate();
    const { bookingRef } = (await g.prepare({ ...asked, time: "11:00" })) as { bookingRef: string };
    callerSpeaks(); // "Yes please."
    // Whatever else the model sends now, the prepared booking is what is made.
    await g.book({ bookingRef, service: "something else" });
    expect(deps.book).toHaveBeenCalledTimes(1);
    expect(deps.book).toHaveBeenCalledWith({ ...asked, time: "2026-10-15T11:00:00+01:00", stylist: "Chloe" });
  });

  it("will not book without a read-back, or with a reference it did not give", async () => {
    const { g, deps, callerSpeaks } = gate();
    callerSpeaks();
    expect(await g.book({})).toMatchObject({ success: false, notBooked: true });
    await g.prepare(asked);
    callerSpeaks();
    expect(await g.book({ bookingRef: "R99" })).toMatchObject({ success: false, notBooked: true });
    expect(deps.book).not.toHaveBeenCalled();
  });

  it("books a read-back once: a second booking has to be read back afresh", async () => {
    const { g, deps, callerSpeaks } = gate();
    const { bookingRef } = (await g.prepare(asked)) as { bookingRef: string };
    callerSpeaks();
    await g.book({ bookingRef });
    callerSpeaks();
    expect(await g.book({ bookingRef })).toMatchObject({ success: false, notBooked: true });
    expect(deps.book).toHaveBeenCalledTimes(1);
  });

  it("forgets an earlier read-back once a changed one is read out", async () => {
    const { g, deps, callerSpeaks } = gate();
    const first = (await g.prepare(asked)) as { bookingRef: string };
    callerSpeaks(); // "Actually, can it be with Jo?"
    const second = (await g.prepare({ ...asked, stylist: "Jo" })) as { bookingRef: string };
    expect(second.bookingRef).not.toBe(first.bookingRef);
    callerSpeaks(); // "Yes."
    expect(await g.book({ bookingRef: first.bookingRef })).toMatchObject({ success: false, notBooked: true });
    await g.book({ bookingRef: second.bookingRef });
    expect(deps.book).toHaveBeenCalledTimes(1);
  });

  it("passes on a booking the checks refuse, with nothing to read back or book", async () => {
    const refused = { success: false, missingName: true, message: "We need their name." };
    const { g, deps, callerSpeaks } = gate(refused);
    expect(await g.prepare(asked)).toEqual(refused);
    callerSpeaks();
    expect(await g.book({ bookingRef: "R1" })).toMatchObject({ success: false, notBooked: true });
    expect(deps.book).not.toHaveBeenCalled();
  });
});

describe("the read-back sentence", () => {
  it("gives a number the caller read out, and never caller ID's digits", () => {
    expect(readBackSentence(checked)).not.toMatch(/\d{3}/);
    expect(readBackSentence({ ...checked, usedCallerId: false, phone: "+447700900605" })).toMatch(
      /confirmation text goes to 07700 900605/
    );
  });

  it("includes the skin test, before anything is booked, for a new colour client", () => {
    expect(readBackSentence({ ...checked, service: "Root tint", patchTestRequired: true })).toMatch(
      /need a quick skin test at the salon at least 48 hours before/
    );
    expect(readBackSentence(checked)).not.toMatch(/skin test/);
  });
});
