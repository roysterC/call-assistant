/**
 * A salon's phone numbers, by what they are for. Imported by pages as well
 * as the server, so nothing here touches the database.
 *
 * VOICE_CHANNEL is our own receptionist's line. Its stored value is "vapi"
 * for history only: the line was Vapi's before it was ours, and rows already
 * say so. Renaming it would need every stored number rewritten in step with
 * the code that reads it, for nothing a caller or a salon would notice.
 */
export const VOICE_CHANNEL = "vapi";
export const WHATSAPP_CHANNEL = "whatsapp";

export const PHONE_CHANNELS = [VOICE_CHANNEL, WHATSAPP_CHANNEL] as const;
export type PhoneChannel = (typeof PHONE_CHANNELS)[number];

/** As staff read it. */
export function channelLabel(channel: string): string {
  return channel === VOICE_CHANNEL ? "Voice" : channel === WHATSAPP_CHANNEL ? "WhatsApp" : channel;
}
