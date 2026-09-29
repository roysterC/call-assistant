import { describe, expect, it, vi } from "vitest";
import type { TurnResult } from "./engine";

const db = vi.hoisted(() => ({
  lead: { findUnique: vi.fn() },
  call: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { callOutcomes } from "./outcomes";
import { logCall } from "./call-log";

const turn = (...tools: Array<[string, unknown, boolean?]>): TurnResult => ({
  text: "",
  tools: tools.map(([name, result, isError]) => ({ name, input: {}, result, isError: Boolean(isError) })),
  stopReason: "end_turn",
  endCall: false,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

describe("what a call came to", () => {
  it("counts only what actually went through", () => {
    const turns = [
      turn(["check_availability", { available: true }]),
      // A booking that failed is not a booking.
      turn(["book_appointment", { success: false, conflict: true }]),
      turn(["book_appointment", { success: true }]),
    ];
    expect(callOutcomes(turns, true)).toEqual(["booked"]);
    // On its own, a failed booking must not show as one. (With a successful
    // booking alongside, as above, that mistake would go unseen.)
    expect(callOutcomes([turn(["book_appointment", { success: false, conflict: true }])], true)).toEqual(["enquiry"]);
    expect(callOutcomes([turn(["take_message", { success: false, missingName: true }])], false)).toEqual(["hung_up"]);
  });

  it("lists everything the call did, in a fixed order", () => {
    const turns = [
      turn(["take_message", { success: true }]),
      turn(["cancel_appointment", { success: true }], ["book_appointment", { success: true }]),
      turn(["reschedule_appointment", { success: true }]),
    ];
    expect(callOutcomes(turns, false)).toEqual(["booked", "rescheduled", "cancelled", "message"]);
  });

  it("is an enquiry when answered and closed by the receptionist, a hang-up when the caller went first", () => {
    const asked = [turn(["check_availability", { available: true }])];
    expect(callOutcomes(asked, true)).toEqual(["enquiry"]);
    expect(callOutcomes(asked, false)).toEqual(["hung_up"]);
    expect(callOutcomes([], false)).toEqual(["hung_up"]);
  });

  it("ignores a tool that errored", () => {
    expect(callOutcomes([turn(["book_appointment", { success: true }, true])], true)).toEqual(["enquiry"]);
  });
});

describe("the Call History line", () => {
  it("keeps who, when, how long and the outcome, and nothing that was said", async () => {
    db.lead.findUnique.mockResolvedValue({ id: "lead-1" });
    await logCall("org", {
      callerNumber: "07700 900715",
      startedAt: new Date("2026-09-29T13:00:00Z"),
      endedAt: new Date("2026-09-29T13:02:30Z"),
      outcomes: ["booked"],
    });
    const data = db.call.create.mock.calls[0][0].data;
    expect(data).toEqual({
      organizationId: "org",
      phoneNumber: "+447700900715",
      status: "completed",
      duration: 150,
      outcomes: ["booked"],
      leadId: "lead-1",
      createdAt: new Date("2026-09-29T13:00:00Z"),
    });
    expect(data).not.toHaveProperty("transcript");
    expect(data).not.toHaveProperty("summary");
  });

  it("logs a withheld number as withheld", async () => {
    db.call.create.mockClear();
    await logCall("org", { callerNumber: null, startedAt: new Date(), endedAt: new Date(), outcomes: ["hung_up"] });
    expect(db.call.create.mock.calls[0][0].data).toMatchObject({ phoneNumber: "Withheld", leadId: null });
  });
});
