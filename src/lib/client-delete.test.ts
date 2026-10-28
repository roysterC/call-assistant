import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a client takes their bookings and callbacks with them, and is
 * refused while it would leave a slot in the diary nobody told the client
 * about, or a child on their number with no way to be texted.
 */

const db = vi.hoisted(() => {
  const tx = {
    lead: { findFirst: vi.fn(), delete: vi.fn() },
    appointment: { count: vi.fn(), deleteMany: vi.fn() },
    callback: { deleteMany: vi.fn() },
  };
  return { tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { deleteClient } from "./client-delete";

beforeEach(() => {
  vi.clearAllMocks();
  db.tx.lead.findFirst.mockResolvedValue({ id: "c1", dependents: [] });
  db.tx.appointment.count.mockResolvedValue(0);
  db.tx.appointment.deleteMany.mockResolvedValue({ count: 3 });
  db.tx.callback.deleteMany.mockResolvedValue({ count: 1 });
});

describe("deleteClient", () => {
  it("deletes the client with their bookings and callbacks, within the salon", async () => {
    expect(await deleteClient("org1", "c1")).toEqual({ ok: true, bookings: 3, callbacks: 1 });
    expect(db.tx.lead.findFirst.mock.calls[0][0].where).toEqual({ id: "c1", organizationId: "org1" });
    expect(db.tx.appointment.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "org1", leadId: "c1" } });
    expect(db.tx.callback.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "org1", leadId: "c1" } });
    expect(db.tx.lead.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("does not find another salon's client", async () => {
    db.tx.lead.findFirst.mockResolvedValue(null);
    expect(await deleteClient("org1", "c1")).toMatchObject({ ok: false, status: 404 });
    expect(db.tx.lead.delete).not.toHaveBeenCalled();
  });

  it("refuses while they have bookings coming up", async () => {
    db.tx.appointment.count.mockResolvedValue(2);
    const result = await deleteClient("org1", "c1");
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(!result.ok && result.message).toContain("2 bookings coming up");
    expect(db.tx.appointment.count.mock.calls[0][0].where).toMatchObject({ status: "booked", leadId: "c1" });
    expect(db.tx.appointment.deleteMany).not.toHaveBeenCalled();
    expect(db.tx.lead.delete).not.toHaveBeenCalled();
  });

  it("refuses while someone books through their number", async () => {
    db.tx.lead.findFirst.mockResolvedValue({ id: "c1", dependents: [{ name: "Mia" }] });
    const result = await deleteClient("org1", "c1");
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(!result.ok && result.message).toContain("Mia books through");
    expect(db.tx.lead.delete).not.toHaveBeenCalled();
  });
});
