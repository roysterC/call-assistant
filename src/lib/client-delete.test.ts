import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a client wipes who they were but keeps their bookings, so the
 * takings stay in Sales. Refused while it would leave a slot in the diary for
 * someone nobody can contact, or a child on their number with no way to be
 * texted.
 */

const db = vi.hoisted(() => {
  const tx = {
    lead: { findFirst: vi.fn(), update: vi.fn() },
    appointment: { count: vi.fn(), updateMany: vi.fn() },
    callback: { deleteMany: vi.fn() },
    call: { updateMany: vi.fn() },
    whatsAppConversation: { updateMany: vi.fn() },
    websiteConversation: { updateMany: vi.fn() },
    socialConversation: { updateMany: vi.fn() },
  };
  return { tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { deleteClient } from "./client-delete";

beforeEach(() => {
  vi.clearAllMocks();
  db.tx.lead.findFirst.mockResolvedValue({ id: "c1", dependents: [] });
  db.tx.appointment.count.mockResolvedValue(0);
  db.tx.appointment.updateMany.mockResolvedValue({ count: 3 });
  db.tx.callback.deleteMany.mockResolvedValue({ count: 1 });
});

describe("deleteClient", () => {
  it("wipes their details and marks them deleted, within the salon", async () => {
    expect(await deleteClient("org1", "c1")).toEqual({ ok: true, bookingsKept: 3, callbacks: 1 });
    expect(db.tx.lead.findFirst.mock.calls[0][0].where).toEqual({ id: "c1", organizationId: "org1", anonymisedAt: null });
    const { where, data } = db.tx.lead.update.mock.calls[0][0];
    expect(where).toEqual({ id: "c1" });
    for (const field of ["name", "firstName", "lastName", "email", "phone", "notes", "patchTestAt", "contactLeadId"]) {
      expect(data[field], field).toBeNull();
    }
    expect(data.anonymisedAt).toBeInstanceOf(Date);
  });

  it("keeps their bookings, and the takings on them, but not the notes on them", async () => {
    await deleteClient("org1", "c1");
    expect(db.tx.appointment.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org1", leadId: "c1" },
      data: { notes: null },
    });
  });

  it("drops their callbacks and unlinks calls and conversations", async () => {
    await deleteClient("org1", "c1");
    expect(db.tx.callback.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "org1", leadId: "c1" } });
    const unlink = { where: { organizationId: "org1", leadId: "c1" }, data: { leadId: null } };
    for (const table of [db.tx.call, db.tx.whatsAppConversation, db.tx.websiteConversation, db.tx.socialConversation]) {
      expect(table.updateMany).toHaveBeenCalledWith(unlink);
    }
  });

  it("does not find another salon's client, or one already deleted", async () => {
    db.tx.lead.findFirst.mockResolvedValue(null);
    expect(await deleteClient("org1", "c1")).toMatchObject({ ok: false, status: 404 });
    expect(db.tx.lead.update).not.toHaveBeenCalled();
  });

  it("refuses while they have bookings coming up", async () => {
    db.tx.appointment.count.mockResolvedValue(2);
    const result = await deleteClient("org1", "c1");
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(!result.ok && result.message).toContain("2 bookings coming up");
    expect(db.tx.appointment.count.mock.calls[0][0].where).toMatchObject({ status: "booked", leadId: "c1" });
    expect(db.tx.appointment.updateMany).not.toHaveBeenCalled();
    expect(db.tx.lead.update).not.toHaveBeenCalled();
  });

  it("refuses while someone books through their number", async () => {
    db.tx.lead.findFirst.mockResolvedValue({ id: "c1", dependents: [{ name: "Mia" }] });
    const result = await deleteClient("org1", "c1");
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(!result.ok && result.message).toContain("Mia books through");
    expect(db.tx.lead.update).not.toHaveBeenCalled();
  });
});
