/**
 * Where a booking opens: the diary, on its day, with the booking itself open
 * (the calendar page reads ?date and ?booking). Every list that shows a
 * booking links here, so a tap on one is never just the day.
 *
 * In the browser only: it keeps a super-admin's ?asOrg, so a booking opens in
 * the salon being viewed.
 */

import { zonedDateString } from "@/lib/business-hours";
import { withAsOrg } from "@/lib/api-fetch";

export function bookingHref(id: string, startsAt: string | Date, timeZone: string): string {
  const day = zonedDateString(new Date(startsAt), timeZone);
  return withAsOrg(`/calendar?date=${day}&booking=${encodeURIComponent(id)}`);
}
