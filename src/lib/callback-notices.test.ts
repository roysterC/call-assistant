import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ calls: [] as Array<{ userIds: string[]; message: Record<string, unknown> }> }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: async () => [{ id: "u1" }, { id: "u2" }] } },
}));
vi.mock("@/lib/push", () => ({
  pushToUsers: async (userIds: string[], message: Record<string, unknown>) => {
    sent.calls.push({ userIds, message });
    return { sent: userIds.length, failed: 0 };
  },
}));

import { callbackPush, noticeNewCallback } from "./callback-notices";

beforeEach(() => {
  sent.calls = [];
});

describe("a callback's push", () => {
  it("says what it is and who, with the first line of the note", () => {
    expect(callbackPush({ id: "c1", kind: "message", clientName: "Luna", notes: "About my fringe\nmore" })).toEqual({
      title: "New message: Luna",
      body: "About my fringe",
      url: "/callbacks",
      tag: "callback-c1",
      kind: "callback",
    });
    expect(callbackPush({ id: "c2", kind: "not_booked", clientName: null, notes: "COULD NOT BOOK: diary down" }).title).toBe(
      "Could not book: ring them: a client"
    );
  });

  it("keeps a long note short enough for a lock screen", () => {
    expect(callbackPush({ id: "c3", kind: "callback", clientName: "Mai", notes: "x".repeat(300) }).body).toHaveLength(118);
  });

  it("goes to everyone at the salon", async () => {
    await noticeNewCallback("org", { id: "c1", kind: "callback", clientName: "Luna", notes: "Ring about a refill" });
    expect(sent.calls).toEqual([{ userIds: ["u1", "u2"], message: expect.objectContaining({ title: "Call back: Luna" }) }]);
  });
});
