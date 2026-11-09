/**
 * Which messaging channel a booking came from, as written in its notes.
 *
 * The receptionist's bookings are all source "voice", which the dashboard
 * counts as booked by the receptionist; a booking made by message says so
 * in its notes instead (chat-booking.ts), and the diary reads it back from
 * there to say "booked by WhatsApp message" rather than "booked by phone".
 * Shared by both, so the wording cannot drift apart.
 */

export const MESSAGE_CHANNEL_NAMES = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" } as const;
export type MessageChannelName = (typeof MESSAGE_CHANNEL_NAMES)[keyof typeof MESSAGE_CHANNEL_NAMES];

export function bookedByMessageNote(channel: keyof typeof MESSAGE_CHANNEL_NAMES): string {
  return `Booked by ${MESSAGE_CHANNEL_NAMES[channel]} message.`;
}

/** The channel a booking's notes say it was booked on, or null. */
export function bookedByMessage(notes: string | null | undefined): MessageChannelName | null {
  const m = /Booked by (WhatsApp|Instagram|Messenger) message\./.exec(notes ?? "");
  return m ? (m[1] as MessageChannelName) : null;
}
