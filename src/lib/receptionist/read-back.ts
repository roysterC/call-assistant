/**
 * A booking is made only after it has been read back and the caller has
 * answered.
 *
 * Told to sum up and ask first, the model mostly did, and sometimes booked
 * as the caller picked a time; the caller then heard their details for the
 * first time once they were in the diary and the text had gone. So the
 * booking is split in two:
 *
 * - `prepare_booking` runs every check a booking is held to and writes
 *   nothing. It gives back the details to read out, and a reference.
 * - `book_appointment` books that reference, and only once the caller has
 *   spoken since it was read back. It cannot happen in the same breath as the
 *   read-back.
 *
 * What is booked is what was read back: the prepared details, with the
 * stylist and time as checked, not whatever the model sends the second time.
 * A new read-back replaces the last one, so a booking the caller changed
 * cannot be made from the earlier reference.
 */

import { speakablePhone } from "@/lib/phone";

/** What the check-only booking run gives back when everything passes. */
export interface PreparedBooking {
  success: true;
  ready: true;
  service: string;
  /** How long it takes, every service in it together. */
  durationMinutes: number;
  stylist: string;
  startsAt: string;
  /** Weekday, date and time, as said: "Thursday 15 October at 11am". */
  when: string;
  clientName: string;
  phone: string;
  usedCallerId: boolean;
  patchTestRequired: boolean;
  patchTestOnRecord?: string;
}

export interface ReadBackDeps {
  /** How many times the caller has spoken so far. */
  turn: () => number;
  /** The booking's checks, writing nothing. */
  check: (input: Record<string, unknown>) => Promise<unknown>;
  /** The booking itself. */
  book: (input: Record<string, unknown>) => Promise<unknown>;
}

function isPrepared(r: unknown): r is PreparedBooking {
  return typeof r === "object" && r !== null && (r as { ready?: unknown }).ready === true;
}

/** The details in one sentence, for the receptionist to read back in its own words. */
export function readBackSentence(p: PreparedBooking): string {
  // Their own phone needs no mention: "a text is on its way" says it after
  // booking. A number they gave is read back, because only they can catch it.
  const textTo = p.usedCallerId ? "" : `, with the text to ${speakablePhone(p.phone)}`;
  // Said here, before they commit, and not again once it is booked.
  const skinTest = p.patchTestRequired
    ? " They need a quick skin test at the salon 48 hours before, which the salon will arrange."
    : "";
  // A long appointment says how long: a caller booking cut and colour had
  // to ask, and it is what they plan the day around.
  const length = p.durationMinutes >= LONG_MINUTES ? `, ${spokenLength(p.durationMinutes)},` : "";
  return `${p.service}${length} with ${p.stylist} on ${p.when}, for ${p.clientName}${textTo}.${skinTest}`;
}

/** From an hour and a half, the read-back says how long it takes. */
const LONG_MINUTES = 90;

/** "about two and a half hours": to the nearest half hour, as said. */
export function spokenLength(minutes: number): string {
  const halves = Math.max(1, Math.round(minutes / 30));
  const hours = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight"];
  const exact = halves * 30 === minutes;
  const about = exact ? "" : "about ";
  if (hours === 0) return `${about}half an hour`;
  if (hours === 1) return `${about}${half ? "an hour and a half" : "an hour"}`;
  const h = words[hours] ?? String(hours);
  return `${about}${h}${half ? " and a half" : ""} hours`;
}

export class ReadBackGate {
  private prepared: { ref: string; input: Record<string, unknown>; turn: number } | null = null;
  private count = 0;

  constructor(private readonly deps: ReadBackDeps) {}

  async prepare(input: Record<string, unknown>): Promise<unknown> {
    const checked = await this.deps.check(input);
    if (!isPrepared(checked)) {
      // A booking that would be refused is refused now, before anything is
      // read back: the same message book_appointment would have given.
      this.prepared = null;
      return checked;
    }
    const ref = `R${++this.count}`;
    // Booked as checked: the stylist worked out for an unnamed slot, and the
    // exact start, so the booking is the one that was read back.
    this.prepared = {
      ref,
      input: { ...input, stylist: checked.stylist, time: checked.startsAt },
      turn: this.deps.turn(),
    };
    const sentence = readBackSentence(checked);
    return {
      success: true,
      bookingRef: ref,
      readBack: sentence,
      message:
        "Nothing is booked yet. Read this back to the caller in one short sentence, keeping every " +
        "detail and adding nothing, and ask if you should book it: " +
        `"${sentence}" ` +
        (checked.usedCallerId ? "Do not read out the digits of the number they are calling from. " : "") +
        `When they say yes, call book_appointment with bookingRef ${ref}. If they change anything, ` +
        "call prepare_booking again with the change.",
    };
  }

  async book(input: Record<string, unknown>): Promise<unknown> {
    const ref = typeof input.bookingRef === "string" ? input.bookingRef.trim() : "";
    const p = this.prepared;
    if (!p || p.ref !== ref) {
      return {
        success: false,
        notBooked: true,
        message:
          "NOT booked. Call prepare_booking first, read the details back to the caller, and book only " +
          "once they say yes, with the bookingRef it gives you.",
      };
    }
    if (this.deps.turn() === p.turn) {
      return {
        success: false,
        notBooked: true,
        message:
          "NOT booked: the caller has not answered the read-back yet. Read the details back, ask if " +
          "you should book it, and wait for their yes.",
      };
    }
    // One booking per read-back: anything after this is read back afresh.
    this.prepared = null;
    return this.deps.book(p.input);
  }
}
