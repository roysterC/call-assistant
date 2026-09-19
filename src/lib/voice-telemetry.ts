/**
 * One grep-able line per availability check, so the forward-search settings
 * can be tuned from real calls instead of intuition.
 *
 * `DEFAULT_SEARCH_DAYS` (a fortnight) and `DEFAULT_MAX_DAYS_WITH_SLOTS`
 * (three) were picked as plausible starting values. Whether they are right
 * depends on questions no one can answer from the code: how often callers ask
 * for the soonest at all rather than naming a day, and how far ahead the
 * answer actually comes from when they do. If it is always today or tomorrow,
 * a fortnight is wasted work; if it clusters at a week out, the fortnight is
 * carrying the feature.
 *
 * Deliberately carries no personal data — no number, no name, no transcript.
 * The existing payload dump in the tool route has all of that; this is meant
 * to be the line you can keep, aggregate and paste into a ticket.
 */

import { parseDateOnly } from "@/lib/business-hours";

export type AvailabilityOutcome =
  | "found"
  | "none"
  | "closed"
  | "patch_test";

export interface AvailabilityTelemetry {
  /** What the caller asked for: "earliest", "any", or absent. */
  prefer: string;
  /** Whether they named a day at all. An omitted date starts from today. */
  dateGiven: boolean;
  /** The answer came back for a different day than the one asked about. */
  movedOn: boolean;
  outcome: AvailabilityOutcome;
  /**
   * Days between today and the day actually offered — the number that says
   * whether searching a fortnight ahead earns its keep. Null when nothing
   * was offered at all.
   */
  answeredDaysOut: number | null;
  /** How many days the search was allowed to walk. */
  searchedDays: number | null;
  optionCount: number;
  service: string | null;
}

/** Whole days between two "YYYY-MM-DD" dates. */
function daysBetween(from: string, to: string): number | null {
  try {
    const a = parseDateOnly(from);
    const b = parseDateOnly(to);
    const ms =
      Date.UTC(b.year, b.month - 1, b.day) -
      Date.UTC(a.year, a.month - 1, a.day);
    return Math.round(ms / 86_400_000);
  } catch {
    // A malformed date is not worth failing a call over.
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Reduce one check_availability call to the few numbers worth keeping.
 *
 * Returns null for anything that is not a real availability search — a
 * different tool, or an organisation whose provider cannot check at all.
 */
export function summariseAvailabilityCall(
  params: Record<string, unknown>,
  result: Record<string, unknown>
): AvailabilityTelemetry | null {
  if (!result || typeof result !== "object") return null;
  if (result.canCheck === false) return null;

  const today = str(result.today);
  const answered = str(result.date);
  const available = result.available === true;

  const outcome: AvailabilityOutcome = available
    ? "found"
    : result.patchTestRequired === true
      ? "patch_test"
      : result.closed === true
        ? "closed"
        : "none";

  // When nothing was free, the fallback offer is the day that matters: it is
  // what the forward search actually reached.
  const next = result.nextAvailable as { date?: unknown } | null | undefined;
  const offered = available ? answered : str(next?.date);

  const options = Array.isArray(result.options) ? result.options.length : 0;

  return {
    prefer: str(params.prefer) ?? "unset",
    dateGiven: Boolean(str(params.date)),
    movedOn: Boolean(str(result.requestedDate)),
    outcome,
    answeredDaysOut:
      today && offered ? daysBetween(today, offered) : null,
    searchedDays:
      typeof result.searchedDays === "number" ? result.searchedDays : null,
    optionCount: options,
    service: str(result.service),
  };
}

/**
 * A single line, stable field order, easy to grep and cut.
 *
 *   journalctl -u call-assistant | grep '\[VAPI\]\[availability\]'
 */
export function telemetryLine(t: AvailabilityTelemetry): string {
  const fields = [
    `prefer=${t.prefer}`,
    `dateGiven=${t.dateGiven ? "y" : "n"}`,
    `movedOn=${t.movedOn ? "y" : "n"}`,
    `outcome=${t.outcome}`,
    `daysOut=${t.answeredDaysOut ?? "-"}`,
    `searchedDays=${t.searchedDays ?? "-"}`,
    `options=${t.optionCount}`,
    `service=${t.service ? t.service.replace(/\s+/g, "_") : "-"}`,
  ];
  return `[VAPI][availability] ${fields.join(" ")}`;
}
