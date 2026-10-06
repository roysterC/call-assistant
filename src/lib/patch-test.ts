/**
 * A client's most recent skin (patch) test, as recorded at the desk.
 *
 * It is a day, not a moment: stored at noon UTC so it reads as the same date
 * wherever it is shown, and sent to the screens as "YYYY-MM-DD".
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type PatchTestInput = { ok: true; value: Date | null } | { ok: false; error: string };

/** "YYYY-MM-DD" (or null, to clear it) from the client's page. */
export function parsePatchTestDate(raw: unknown, now: Date = new Date()): PatchTestInput {
  if (raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" || !DAY.test(raw)) {
    return { ok: false, error: "The patch test date should look like 2026-10-06." };
  }
  const value = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== raw) {
    return { ok: false, error: "That isn't a real date." };
  }
  // A day's grace for timezones; a test can't be recorded before it happens.
  if (value.getTime() > now.getTime() + 36 * 3600_000) {
    return { ok: false, error: "A patch test can't be in the future." };
  }
  return { ok: true, value };
}

/** The stored date as the screens show it. */
export function patchTestDay(at: Date | null): string | null {
  return at ? at.toISOString().slice(0, 10) : null;
}
