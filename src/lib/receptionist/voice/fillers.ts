/**
 * What the receptionist says while a tool runs and it has said nothing yet,
 * so the line is not silent. Fitted to what it is doing, and varied: the
 * same "One moment." before every lookup sounded robotic.
 *
 * Each is a few words at most: it fills a pause, it is not a reply.
 */

export const FILLERS: Record<string, readonly string[]> = {
  check_availability: [
    "Let me have a look.",
    "Let me check the diary.",
    "Let me see what we've got.",
    "Let me check if we have availability.",
    "Bear with me.",
  ],
  find_appointment: ["Let me find your booking.", "Let me look that up.", "Bear with me."],
  prepare_booking: ["Okay.", "Right.", "Okay, one sec."],
  book_appointment: ["Okay, booking that in now.", "Right, booking it now."],
  reschedule_appointment: ["Okay, moving that now.", "Right, let me move that."],
  cancel_appointment: ["Okay, cancelling that now.", "Right, cancelling it now."],
  take_message: ["Let me note that down.", "Okay, I'll note that."],
  book_callback: ["Let me note that down.", "Okay, I'll note that."],
};

const GENERAL: readonly string[] = ["One moment.", "Bear with me.", "Okay, one sec."];

/**
 * Picks the next filler for a tool, in turn, never the one said last time
 * (whatever tool that was for), so two lookups in a row do not open the
 * same way.
 */
export class FillerPicker {
  private readonly next = new Map<string, number>();
  private last = "";

  pick(tool: string): string {
    const options = FILLERS[tool] ?? GENERAL;
    let i = this.next.get(tool) ?? 0;
    let line = options[i % options.length];
    if (line === this.last && options.length > 1) {
      i++;
      line = options[i % options.length];
    }
    this.next.set(tool, i + 1);
    this.last = line;
    return line;
  }
}
