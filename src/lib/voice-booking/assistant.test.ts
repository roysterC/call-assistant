import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { StreamingClient } from "@/lib/receptionist/engine";

vi.mock("@/lib/prisma", () => ({
  prisma: { organizationSettings: { findUnique: async () => ({ businessName: "Shogo" }) } },
}));
vi.mock("@/lib/booking", () => ({
  getSalonConfig: async () => ({
    timeZone: "Europe/London",
    hours: [],
    services: [{ name: "Cut and finish", durationMinutes: 45, bufferMinutes: 0, requiresPatchTest: false, priceMinor: null }],
    stylists: [{ name: "Jo", workingDays: [], services: [] }],
  }),
}));
const drafts = vi.hoisted(() => ({
  proposeBooking: vi.fn(async () => ({
    ok: true,
    draft: {
      id: "d1",
      kind: "book",
      clientName: "Sarah Jones",
      service: "Cut and finish",
      stylist: "Jo",
      startsAt: "2026-10-01T13:00:00.000Z",
      endsAt: "2026-10-01T13:45:00.000Z",
      patchTestRequired: false,
    },
  })),
  commitDraft: vi.fn(),
}));
vi.mock("./drafts", () => ({
  ...drafts,
  findClients: vi.fn(async () => []),
  upcomingBookings: vi.fn(async () => []),
  proposeMove: vi.fn(),
  proposeCancel: vi.fn(),
  proposeNote: vi.fn(),
  proposeText: vi.fn(),
}));
vi.mock("@/lib/vapi-functions", () => ({ executeVapiFunction: vi.fn() }));
vi.mock("./knowledge", () => ({ daySchedule: vi.fn(), clientHistory: vi.fn(), phoneMessages: vi.fn(), takings: vi.fn() }));
vi.mock("@/lib/receptionist/session", () => ({
  receptionistApiKey: async () => null,
  receptionistModel: () => "claude-haiku-4-5",
}));

import { startVoiceBooking } from "./assistant";

/** A model that asks for one tool, then says a line. */
function asks(name: string, input: object): StreamingClient {
  let n = 0;
  return {
    messages: {
      stream() {
        const content = (n++ === 0
          ? [{ type: "tool_use", id: "t1", name, input }]
          : [{ type: "text", text: "Done.", citations: null }]) as Anthropic.ContentBlock[];
        return {
          on() {
            return this;
          },
          finalMessage: async () =>
            ({ content, stop_reason: n === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Message,
        };
      },
    },
  };
}

const owner = { organizationId: "org", role: "admin" as const, stylist: null };

describe("the assistant behind the diary's microphone", () => {
  it("has no tool that writes to the diary", async () => {
    const s = await startVoiceBooking(owner, "u", { speaker: "x", client: asks("find_client", { name: "x" }) });
    const names = (s.engine as unknown as { cfg: { tools: Anthropic.Tool[] } }).cfg.tools.map((t) => t.name);
    // Lookups that change nothing, and proposals that only draw a card.
    const readOnly = ["find_client", "find_bookings", "check_availability", "day_schedule", "client_history", "phone_messages", "takings"];
    expect(names.filter((n) => !readOnly.includes(n)).every((n) => n.startsWith("propose_"))).toBe(true);
    expect(names).toEqual(expect.arrayContaining(readOnly));
  });

  it("refuses a tool it was not given, and saves nothing", async () => {
    for (const name of ["book_appointment", "commit", "save_booking", "cancel_appointment"]) {
      const s = await startVoiceBooking(owner, "u", { speaker: "x", client: asks(name, {}) });
      const turn = await s.engine.respond("just book it");
      expect(JSON.stringify(turn.tools[0].result)).toContain("no tool");
      expect(s.pending).toBeNull();
    }
    expect(drafts.commitDraft).not.toHaveBeenCalled();
  });

  it("puts a proposal on screen, and only on screen", async () => {
    const s = await startVoiceBooking(owner, "u", {
      speaker: "x",
      client: asks("propose_booking", { clientName: "Sarah Jones", service: "cut and finish", date: "Thursday", time: "2pm" }),
    });
    const turn = await s.engine.respond("Sarah Jones, cut and finish, Thursday at two");
    expect(s.pending?.id).toBe("d1");
    expect(JSON.stringify(turn.tools[0].result)).toContain("Sarah Jones, Cut and finish");
    expect(drafts.commitDraft).not.toHaveBeenCalled();
  });
});
