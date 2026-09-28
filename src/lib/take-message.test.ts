import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Can I speak to someone?" Nobody can be put through, so the receptionist
 * takes a message, and it must land on the Callbacks page: due now while the
 * salon is open, when it next opens otherwise.
 */

const db = vi.hoisted(() => ({
  lead: { findUnique: vi.fn(), create: vi.fn() },
  callback: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/booking", async (original) => ({
  ...(await original<typeof import("@/lib/booking")>()),
  // Tuesday to Saturday 10 to 7 in London; closed Sunday and Monday.
  getSalonConfig: async () => ({
    timeZone: "Europe/London",
    hours: [2, 3, 4, 5, 6].map((day) => ({ day, closed: false, open: "10:00", close: "19:00" })),
    services: [],
    stylists: [
      { name: "Jo", workingDays: [], services: [] },
      { name: "Shogo", workingDays: [], services: [] },
    ],
  }),
}));

import { handleTakeMessage, mergeMessage } from "./vapi-functions";
import { buildVoiceTools } from "./vapi-assistant";

beforeEach(() => {
  vi.clearAllMocks();
  db.lead.findUnique.mockResolvedValue(null);
  db.lead.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "lead-1", ...data }));
  db.callback.create.mockResolvedValue({ id: "cb-1" });
  db.callback.findFirst.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

const saved = () => db.callback.create.mock.calls[0][0].data;

describe("take_message", () => {
  it("puts the message on the callback list, due now while the salon is open", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-29T13:00:00Z"), toFake: ["Date"] }); // Tuesday 2pm
    const r = await handleTakeMessage("org", {
      customerName: "Sarah Jones",
      callerNumber: "+447700900715",
      message: "Wants to talk to someone about a colour correction.",
    });
    expect(r.success).toBe(true);
    expect(saved()).toMatchObject({
      organizationId: "org",
      leadId: "lead-1",
      assignedTo: "Team",
      notes: "Wants to talk to someone about a colour correction.",
    });
    expect(saved().scheduledAt.toISOString()).toBe("2026-09-29T13:00:00.000Z");
    expect(r.message).toMatch(/ring them back today/);
    // Their number came from caller ID: the receptionist is told to check it.
    expect(r.message).toMatch(/ringing from; check it/);
    expect(r.message).toMatch(/Do not say anyone will be put through/);
  });

  it("is due when the salon next opens if it is closed, and says when", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T20:00:00Z"), toFake: ["Date"] }); // Sunday 9pm
    const r = await handleTakeMessage("org", {
      customerName: "Sarah Jones",
      customerPhone: "07700 900715",
      message: "Asked to speak to Jo about a wedding.",
      forStylist: "jo",
    });
    expect(saved().assignedTo).toBe("Jo");
    // Tuesday 10am London.
    expect(saved().scheduledAt.toISOString()).toBe("2026-09-29T09:00:00.000Z");
    expect(r.message).toMatch(/Message taken for Jo/);
    expect(r.message).toMatch(/when the salon opens, Tuesday at 10/);
  });

  it("adds more detail from the same caller to the message already taken", async () => {
    db.callback.findFirst.mockResolvedValue({ id: "cb-1", notes: "Has a complaint to discuss" });
    const r = await handleTakeMessage("org", {
      customerName: "Tom Baker",
      callerNumber: "+447700900613",
      message: "Fringe cut far too short on Saturday.",
    });
    expect(db.callback.create).not.toHaveBeenCalled();
    expect(db.callback.update.mock.calls[0][0]).toMatchObject({
      where: { id: "cb-1" },
      data: { notes: "Has a complaint to discuss\nFringe cut far too short on Saturday." },
    });
    expect(r.message).toMatch(/^Added to their message/);
  });

  it("keeps one clean message whether it is resent whole or a detail is added", () => {
    // Resent whole, with the detail worked in: the fuller version replaces it.
    expect(
      mergeMessage(
        "The stylist cut my fringe far too short on Saturday. Wants the manager.",
        "The stylist cut my fringe far too short on Saturday and was rude. Wants the manager."
      )
    ).toBe("The stylist cut my fringe far too short on Saturday and was rude. Wants the manager.");
    // Only the new detail: added underneath.
    expect(mergeMessage("Complaint about a fringe cut too short.", "Also says the stylist was rude.")).toBe(
      "Complaint about a fringe cut too short.\nAlso says the stylist was rude."
    );
    expect(mergeMessage("", "Wants a job.")).toBe("Wants a job.");
  });

  it("will not take a message without a name or without the message", async () => {
    const noName = await handleTakeMessage("org", { callerNumber: "+447700900715", message: "Hi" });
    expect(noName.success).toBe(false);
    const noMessage = await handleTakeMessage("org", { customerName: "Sarah Jones", callerNumber: "+447700900715" });
    expect(noMessage.success).toBe(false);
    expect(db.callback.create).not.toHaveBeenCalled();
  });

  it("asks for a number when caller ID is withheld and none was given", async () => {
    const r = await handleTakeMessage("org", { customerName: "Sarah Jones", message: "Call me" });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/best number to ring them back on/);
    expect(db.callback.create).not.toHaveBeenCalled();
  });

  it("is always on the receptionist's list, whether or not it can book", () => {
    const names = (createBooking: boolean) =>
      buildVoiceTools({ readAvailability: true, forwardSearch: false, createBooking, perStaffAvailability: true, availabilityIsAdvisory: false }).map((t) => t.function.name);
    expect(names(true)).toContain("take_message");
    expect(names(false)).toContain("take_message");
    expect(names(true)).not.toContain("transfer_call");
  });
});
