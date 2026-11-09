/**
 * Photos clients send on WhatsApp, Instagram and Messenger: usually the
 * nails they want, so the technician can see the design and quote for it.
 *
 * Each is downloaded when it arrives, kept (ChatPhoto), and recorded in the
 * conversation as a line of text, "[Sent a photo] …", for the inbox and for
 * the bot, which does not look at it: a design is priced by the technician,
 * not by the receptionist. When the conversation then books, its photos are
 * linked to the booking and shown with it in the diary.
 */

import { prisma } from "@/lib/prisma";
import { GRAPH_API_BASE, type WhatsAppSender } from "@/lib/whatsapp";

/** Larger than any phone photo a chat app sends. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Photos sent this long before a booking go with it. */
const ATTACH_WINDOW_MS = 7 * 24 * 60 * 60_000;

export type PhotoChannel = "whatsapp" | "instagram" | "facebook";

export interface Photo {
  mediaType: string;
  data: Buffer;
}

/** What goes in the conversation for a photo, with anything they wrote with it. */
export function photoLine(caption: string | null | undefined, saved = true): string {
  const said = caption?.trim() ? ` ${caption.trim()}` : "";
  return saved ? `[Sent a photo]${said}` : `[Sent a photo that could not be saved]${said}`;
}

/** A WhatsApp image: its address is asked for with the salon's token, then fetched with it. */
export async function downloadWhatsAppPhoto(sender: WhatsAppSender, mediaId: string): Promise<Photo | null> {
  try {
    const auth = { Authorization: `Bearer ${sender.accessToken}` };
    const meta = await fetch(`${GRAPH_API_BASE}/${encodeURIComponent(mediaId)}`, { headers: auth });
    if (!meta.ok) return null;
    const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url || (info.file_size ?? 0) > MAX_PHOTO_BYTES) return null;
    return await fetchPhoto(info.url, auth, info.mime_type);
  } catch (err) {
    console.error("[CHAT PHOTOS] WhatsApp download failed:", err);
    return null;
  }
}

/** An Instagram or Messenger image: Meta gives a link to fetch. */
export async function downloadLinkedPhoto(url: string): Promise<Photo | null> {
  try {
    if (!/^https:\/\//.test(url)) return null;
    return await fetchPhoto(url, {});
  } catch (err) {
    console.error("[CHAT PHOTOS] Download failed:", err);
    return null;
  }
}

async function fetchPhoto(url: string, headers: Record<string, string>, declared?: string): Promise<Photo | null> {
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const mediaType = (declared || res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!mediaType.startsWith("image/")) return null;
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length === 0 || data.length > MAX_PHOTO_BYTES) return null;
  return { mediaType, data };
}

export async function savePhoto(p: {
  organizationId: string;
  channel: PhotoChannel;
  conversationId: string;
  photo: Photo;
  caption?: string | null;
}): Promise<string> {
  const row = await prisma.chatPhoto.create({
    data: {
      organizationId: p.organizationId,
      channel: p.channel,
      conversationId: p.conversationId,
      mediaType: p.photo.mediaType,
      data: new Uint8Array(p.photo.data),
      caption: p.caption?.trim().slice(0, 500) || null,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * The conversation's recent photos, not yet with a booking, linked to the
 * booking it just made. How many were linked.
 */
export async function attachPhotosToBooking(p: {
  organizationId: string;
  channel: PhotoChannel;
  conversationId: string;
  bookingNumber: number;
  now?: Date;
}): Promise<number> {
  const appointment = await prisma.appointment.findFirst({
    where: { organizationId: p.organizationId, bookingNumber: p.bookingNumber },
    select: { id: true },
  });
  if (!appointment) return 0;
  const since = new Date((p.now ?? new Date()).getTime() - ATTACH_WINDOW_MS);
  const { count } = await prisma.chatPhoto.updateMany({
    where: {
      organizationId: p.organizationId,
      channel: p.channel,
      conversationId: p.conversationId,
      appointmentId: null,
      createdAt: { gte: since },
    },
    data: { appointmentId: appointment.id },
  });
  return count;
}
