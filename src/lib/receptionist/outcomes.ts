/**
 * What a call to our receptionist came to, for Call History.
 *
 * No recording, transcript or summary is kept: a call is logged only as its
 * outcomes, read from what the receptionist actually did, never from what it
 * said. A booking counts only if the booking tool succeeded.
 */

import type { TurnResult } from "./engine";

export const CALL_OUTCOMES = ["booked", "rescheduled", "cancelled", "message", "enquiry", "hung_up"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** The tools whose success is an outcome worth logging. */
const DONE: Record<string, CallOutcome> = {
  book_appointment: "booked",
  reschedule_appointment: "rescheduled",
  cancel_appointment: "cancelled",
  take_message: "message",
  book_callback: "message",
};

function succeeded(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { success?: unknown }).success === true;
}

/**
 * Everything the call did, in a fixed order. With nothing done, it was an
 * enquiry if the receptionist said goodbye (the caller's questions were
 * answered), and a hang-up if the caller put the phone down first.
 */
export function callOutcomes(turns: TurnResult[], endedByReceptionist: boolean): CallOutcome[] {
  const done = new Set<CallOutcome>();
  for (const turn of turns) {
    for (const tool of turn.tools) {
      const outcome = DONE[tool.name];
      if (outcome && !tool.isError && succeeded(tool.result)) done.add(outcome);
    }
  }
  if (done.size === 0) return [endedByReceptionist ? "enquiry" : "hung_up"];
  return CALL_OUTCOMES.filter((o) => done.has(o));
}
