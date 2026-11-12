import type { ConversationState } from "@/lib/conversation-state";

export type Channel = "whatsapp" | "website" | "instagram" | "facebook";

/** A visit as the conversation API sends it (src/lib/conversation-client.ts), dates as strings. */
export interface ClientVisit {
  id: string;
  bookingNumber: number | null;
  startsAt: string;
  durationMinutes: number;
  serviceText: string;
  stylistName: string;
  amountMinor: number | null;
}

export interface ConversationClient {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isClient: boolean;
  visits: number;
  next: (ClientVisit & { photos: number; bookedInChat: boolean; day: string }) | null;
  recent: ClientVisit[];
  booksFor: { id: string; name: string | null }[];
  waiting: { id: string; message: string | null; createdAt: string } | null;
}

export type ThreadEvent =
  | { kind: "booked"; at: string; serviceText: string; startsAt: string; bookingNumber: number | null }
  | { kind: "message"; at: string };

export interface DetailMessage {
  id: string;
  /** "user" is the client, "assistant" Kikai, "agent" staff replying from this inbox. */
  role: "user" | "assistant" | "agent";
  content: string;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  channel: Channel;
  contactName: string | null;
  phoneNumber: string;
  visitorEmail?: string | null;
  visitorPhone?: string | null;
  status: string;
  isRead: boolean;
  starred: boolean;
  createdAt: string;
  lastMessageAt: string;
  userAgent?: string | null;
  referrer?: string | null;
  site?: { name: string; siteId: string; botName: string } | null;
  lead: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    issue: string | null;
    status: string;
    source: string;
  } | null;
  messages: DetailMessage[];
  profilePicUrl?: string | null;
  handle?: string | null;
  /** ISO timestamp of the last persona reset, or null if never reset. */
  personaResetAt?: string | null;
  /** "bot" | "human": website conversations only. */
  handoffState?: string;
  /** Who they are, beside the chat (src/lib/conversation-client.ts). */
  client: ConversationClient | null;
  /** Bookings made and messages taken during the chat, marked in the thread. */
  events: ThreadEvent[];
  /** Message id → ids of the photos it carried. */
  photos: Record<string, string[]>;
}

export type { ConversationState };
