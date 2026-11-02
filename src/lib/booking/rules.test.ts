import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ patchTestAt: null as Date | null }));
vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findUnique: async () => ({ patchTestAt: db.patchTestAt }) } },
}));

import { moveClientType } from "./rules";

beforeEach(() => {
  db.patchTestAt = null;
});

describe("whether a booking being moved still waits on a skin test", () => {
  it("does not, if it needed none when it was made, whatever its recorded client type", async () => {
    // Booked by phone with a patch test on record: no test needed, type as said ("unknown").
    expect(await moveClientType({ patchTestRequired: false, leadId: "l" })).toBe("returning");
  });

  it("does, if it needed one and none has been recorded since", async () => {
    expect(await moveClientType({ patchTestRequired: true, leadId: "l" })).toBe("new");
  });

  it("does not, once a patch test has been recorded for the client", async () => {
    db.patchTestAt = new Date("2026-09-20T12:00:00Z");
    expect(await moveClientType({ patchTestRequired: true, leadId: "l" })).toBe("returning");
  });
});
