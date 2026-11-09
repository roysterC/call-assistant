import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  appointment: { findFirst: vi.fn(async () => ({ id: "appt-1" })) },
  chatPhoto: { updateMany: vi.fn(async () => ({ count: 2 })), create: vi.fn(async () => ({ id: "p1" })) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { attachPhotosToBooking, downloadLinkedPhoto, downloadWhatsAppPhoto, MAX_PHOTO_BYTES, photoLine } from "./chat-photos";

const sender = { phoneNumberId: "pn", accessToken: "tok" };

afterEach(() => vi.unstubAllGlobals());

describe("a photo in the conversation", () => {
  it("is a line of text, with what they wrote", () => {
    expect(photoLine("like this but pink")).toBe("[Sent a photo] like this but pink");
    expect(photoLine(undefined)).toBe("[Sent a photo]");
    expect(photoLine("this", false)).toBe("[Sent a photo that could not be saved] this");
  });
});

describe("fetching a WhatsApp photo", () => {
  it("asks for its address with the salon's token, then fetches it with the token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.example/x", mime_type: "image/jpeg", file_size: 3 })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetch);
    const photo = await downloadWhatsAppPhoto(sender, "media-1");
    expect(photo).toEqual({ mediaType: "image/jpeg", data: Buffer.from([1, 2, 3]) });
    expect(fetch.mock.calls[0][0]).toBe("https://graph.facebook.com/v21.0/media-1");
    expect(fetch.mock.calls[1][1]).toEqual({ headers: { Authorization: "Bearer tok" } });
  });

  it("refuses anything too big, or not an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://x", mime_type: "image/jpeg", file_size: MAX_PHOTO_BYTES + 1 })))
    );
    expect(await downloadWhatsAppPhoto(sender, "m")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://x", mime_type: "application/pdf" })))
        .mockResolvedValueOnce(new Response(new Uint8Array([1])))
    );
    expect(await downloadWhatsAppPhoto(sender, "m")).toBeNull();
  });
});

describe("fetching an Instagram or Messenger photo", () => {
  it("fetches only https links to images", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([9]), { headers: { "content-type": "image/png" } })));
    expect(await downloadLinkedPhoto("https://cdn.example/p.png")).toEqual({ mediaType: "image/png", data: Buffer.from([9]) });
    expect(await downloadLinkedPhoto("http://cdn.example/p.png")).toBeNull();
  });
});

describe("linking photos to the booking", () => {
  it("links this conversation's recent photos, not yet on a booking, to the booking just made", async () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(
      await attachPhotosToBooking({ organizationId: "org", channel: "instagram", conversationId: "c1", bookingNumber: 1043, now })
    ).toBe(2);
    expect(db.appointment.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org", bookingNumber: 1043 },
      select: { id: true },
    });
    expect(db.chatPhoto.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org",
        channel: "instagram",
        conversationId: "c1",
        appointmentId: null,
        createdAt: { gte: new Date("2026-11-03T12:00:00Z") },
      },
      data: { appointmentId: "appt-1" },
    });
  });
});
