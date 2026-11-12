/**
 * Where a conversation stands, for the Conversations list: does it need
 * someone, is Kikai dealing with it, or is it done, and what happened.
 *
 *   you   Needs you: Kikai took a message for the team that nobody has
 *         dealt with yet; the client's last message has gone unanswered
 *         for more than REPLY_GRACE_MS (Kikai answers within seconds, so
 *         this is a chat it could not or did not answer); or staff took a
 *         website chat over from Kikai.
 *   bot   Kikai is handling: it answered last, or is about to.
 *   done  It came to something: a booking, a message taken for a
 *         callback that someone has since dealt with, or staff answered
 *         last.
 *
 * What happened is read from what the chat's client has: a booking or a
 * callback made in the OUTCOME_WINDOW_MS before its last message (a chat
 * books, then the client says thanks). Older ones belong to an earlier
 * conversation with the same person. Plain code, no database.
 */

export type ConversationGroup = "you" | "bot" | "done";

export type ConversationKind =
  | "callback" // a message Kikai took is waiting for the team
  | "waiting" // the client is waiting for a reply
  | "staff" // staff took over from Kikai (website)
  | "replying" // the client just wrote; Kikai is answering
  | "bot" // Kikai answered
  | "booked" // a booking came of it
  | "message" // a message taken for a callback, since dealt with
  | "replied"; // staff answered last

export interface ConversationState {
  group: ConversationGroup;
  kind: ConversationKind;
  /** For "booked": what and when. */
  booking?: { service: string; startsAt: string };
  /** For "callback": when the message was taken, for how long it has waited. */
  since?: string;
}

/** Kikai waits for a quiet spell before answering a burst of messages; give it that, and a little more. */
export const REPLY_GRACE_MS = 2 * 60 * 1000;
export const OUTCOME_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface StateInput {
  /** Who sent the last message: "user" (the client), "assistant" (Kikai), "agent" (staff). */
  lastRole: string | null;
  lastMessageAt: Date;
  /** Website only: "human" once staff took over. */
  handoffState?: string | null;
  /** The client's most recent booking, if any (not cancelled). */
  booking?: { createdAt: Date; service: string; startsAt: Date } | null;
  /** The client's most recent callback, if any, and whether it is still to be dealt with. */
  callback?: { createdAt: Date; pending: boolean } | null;
  now?: Date;
}

/** Whether something made at `at` belongs to this conversation's latest stretch. */
export function inOutcomeWindow(at: Date, lastMessageAt: Date): boolean {
  const t = at.getTime();
  const last = lastMessageAt.getTime();
  // A little after the last message too: the booking can be saved a moment
  // after the reply that confirms it is stored.
  return t >= last - OUTCOME_WINDOW_MS && t <= last + 5 * 60 * 1000;
}

export function conversationState(input: StateInput): ConversationState {
  const now = input.now ?? new Date();
  if (input.handoffState === "human") return { group: "you", kind: "staff" };
  // Kikai told the client someone will get back to them: until someone has,
  // the chat is not done, however it ended.
  const callback = input.callback && inOutcomeWindow(input.callback.createdAt, input.lastMessageAt) ? input.callback : null;
  if (callback?.pending) return { group: "you", kind: "callback", since: callback.createdAt.toISOString() };
  if (input.lastRole === "user") {
    return now.getTime() - input.lastMessageAt.getTime() > REPLY_GRACE_MS
      ? { group: "you", kind: "waiting" }
      : { group: "bot", kind: "replying" };
  }
  if (input.booking && inOutcomeWindow(input.booking.createdAt, input.lastMessageAt)) {
    return {
      group: "done",
      kind: "booked",
      booking: { service: input.booking.service, startsAt: input.booking.startsAt.toISOString() },
    };
  }
  if (callback) {
    return { group: "done", kind: "message" };
  }
  if (input.lastRole === "agent") return { group: "done", kind: "replied" };
  return { group: "bot", kind: "bot" };
}
