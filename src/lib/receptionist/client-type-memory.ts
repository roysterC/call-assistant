/**
 * Whether the caller has been before, once they have said, kept for the rest
 * of the call.
 *
 * The tools ask the model to find out (a colour service with nothing on
 * record), and the model sends the answer as `clientType` on the call it
 * makes next. It does not reliably send it again on the calls after that. On
 * a cut-and-colour call the diary check was told "new", the read-back was not,
 * so the read-back was refused for want of it; the model retried, then told
 * the caller "You've told me you're new to colour, so I'll book you as new."
 * The caller answered once; that is enough.
 *
 * Kept by the name it was given for, so a parent who says they are new and
 * then books their child is not taken to have said it of the child too.
 */

import { blankToUndefined, normaliseClientType } from "./action-helpers";

/** The tools that take a client type. */
const TAKES_CLIENT_TYPE = new Set(["check_availability", "prepare_booking", "book_appointment"]);

export class ClientTypeMemory {
  private readonly said: Map<string, "new" | "returning">;

  /** `saved`: what a chat's earlier messages had said (chat-booking.ts). */
  constructor(saved: Record<string, "new" | "returning"> = {}) {
    this.said = new Map(Object.entries(saved));
  }

  /** What has been said, by name, to save between messages. */
  entries(): Record<string, "new" | "returning"> {
    return Object.fromEntries(this.said);
  }

  /**
   * Notes what this input says, and returns it with the client type filled
   * in when it leaves it out and the caller has already said.
   */
  apply(tool: string, input: Record<string, unknown>): Record<string, unknown> {
    if (!TAKES_CLIENT_TYPE.has(tool)) return input;
    const who = nameKey(input.customerName);
    const given = normaliseClientType(
      typeof input.clientType === "string"
        ? input.clientType
        : input.newClient === true
          ? "new"
          : input.newClient === false
            ? "returning"
            : undefined
    );
    if (given !== "unknown") {
      this.said.set(who, given);
      return input;
    }
    // Said before the name was taken counts for whoever is named next.
    const known = this.said.get(who) ?? (who ? this.said.get("") : undefined);
    return known ? { ...input, clientType: known } : input;
  }
}

function nameKey(name: unknown): string {
  return (typeof name === "string" ? (blankToUndefined(name) ?? "") : "").toLowerCase().replace(/\s+/g, " ");
}
