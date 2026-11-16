/**
 * who_is_working: who is in on a day, and who could do them at a time.
 *
 * Asked "which nail tech is in on Monday?", the chat had no names to hand
 * (times are offered without them, on purpose) and said "I don't have the
 * rota", then booked "with the owner". This reads the diary for that day:
 * who is rostered, less anyone blocked out for the whole of it (a holiday, a
 * sick day), and with a time, who the diary would offer then for the service.
 *
 * Names only, never why someone is not in: a block's label is written for
 * the salon ("Hospital appointment"), not for clients.
 */

import { prisma } from "@/lib/prisma";
import { canReadAvailability, getBookingProvider, getSalonConfig } from "@/lib/booking";
import { blocksBetween } from "@/lib/booking/diary";
import {
  openWindowFor,
  parseDateOnly,
  parseSpokenTimeOn,
  resolveSpokenDate,
  zonedDateString,
  zonedParts,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";
import {
  isBookable,
  resolveBookedService,
  stylistsForService,
  stylistWorksOn,
  withQuotedMinutes,
  type SalonService,
  type Stylist,
} from "@/lib/salon-config";
import { blockApplies, type BlockOccurrence } from "@/lib/time-blocks";
import { blankToUndefined, serviceNotResolvedMessage, spokenDay, spokenTime } from "./action-helpers";

/**
 * Who of `stylists` is in during `window`: rostered that weekday, and not
 * blocked out for all of it. Plain code, for the handler and its tests.
 */
export function teamInOnDay(p: {
  stylists: Stylist[];
  weekday: number;
  window: { start: Date; end: Date };
  blocks: BlockOccurrence[];
}): string[] {
  return p.stylists
    .filter((s) => stylistWorksOn(s, p.weekday))
    .filter((s) => {
      const mine = p.blocks.filter((b) => blockApplies(b, s.name));
      if (mine.some((b) => b.allDay)) return false;
      // Blocked from opening to closing, without being marked all day.
      return !mine.some((b) => b.start <= p.window.start && b.end >= p.window.end);
    })
    .map((s) => s.name);
}

/** "Hoang", "Hoang and Mai", "Hoang, Mai and Lan". */
export function namesText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export async function handleWhoIsWorking(
  organizationId: string,
  params: { date?: string; day?: string; time?: string; service?: string; minutes?: number | string }
): Promise<Record<string, unknown>> {
  const cfg = await getSalonConfig(organizationId);
  const tz = cfg.timeZone;
  const date = resolveSpokenDate(blankToUndefined(params.date) ?? blankToUndefined(params.day), tz);
  if (!date) {
    return { success: false, message: "Which day do they mean? Ask for a day or date, then call this again." };
  }
  const today = zonedDateString(new Date(), tz);
  if (date < today) {
    return { success: false, today, message: `That date (${date}) is in the past. Today is ${today}. Work out the day they meant.` };
  }

  const { year, month, day } = parseDateOnly(date);
  const weekday = zonedParts(zonedWallTimeToUtc(year, month, day, 12, 0, tz), tz).weekday;
  const when = spokenDay(date, tz);
  const window = openWindowFor(cfg.hours, tz, date);
  if (!window) return { success: true, date, closed: true, message: `The salon is closed ${onWhen(when)}. Say so.` };

  let service: SalonService | null = null;
  if (blankToUndefined(params.service)) {
    const resolved = resolveBookedService(params.service, cfg.services);
    if (!resolved.ok) {
      return {
        success: false,
        message: serviceNotResolvedMessage(params.service!, resolved.matched, resolved.unmatched, cfg.services),
      };
    }
    service = withQuotedMinutes(resolved.service, params.minutes);
  }

  const team = service ? stylistsForService(service, cfg.stylists) : cfg.stylists.filter(isBookable);
  const blocks = await blocksBetween(prisma, organizationId, window.start, window.end, tz);
  const inThatDay = teamInOnDay({ stylists: team, weekday, window, blocks });
  const forWhat = service ? ` who do ${service.name.toLowerCase()}` : "";
  const never = " Give names only: never why someone is not in.";

  if (inThatDay.length === 0) {
    return {
      success: true,
      date,
      inThatDay,
      message: `Nobody${forWhat} is in ${onWhen(when)}. Say so, and offer to look at another day.${never}`,
    };
  }

  const dayLine = `In ${onWhen(when)}${forWhat}: ${namesText(inThatDay)}.`;
  const timeSaid = blankToUndefined(params.time);
  if (!timeSaid) return { success: true, date, inThatDay, message: `${dayLine}${never}` };

  if (!service) {
    return {
      success: true,
      date,
      inThatDay,
      message: `${dayLine} Who is free at a time depends on the service: call this again with it, if you know it.${never}`,
    };
  }

  const clock = parseSpokenTimeOn(timeSaid, cfg.hours, date);
  const m = clock ? /^(\d{2}):(\d{2})$/.exec(clock) : null;
  if (!m) return { success: true, date, inThatDay, message: `${dayLine} That time did not parse ("${timeSaid}"): ask for it again.${never}` };
  const at = zonedWallTimeToUtc(year, month, day, Number(m[1]), Number(m[2]), tz);

  const provider = await getBookingProvider(organizationId);
  let freeThen: string[] = [];
  if (canReadAvailability(provider)) {
    try {
      const slots = await provider.getAvailability({
        organizationId,
        date,
        serviceName: service.name,
        durationMinutes: service.durationMinutes,
        // Who could, not whether this client can yet: a new client's skin
        // test is for the booking to explain, not a reason nobody is free.
        clientType: "returning",
      });
      const iso = at.toISOString();
      freeThen = [...new Set(slots.filter((s) => s.start === iso).map((s) => s.stylistName ?? ""))].filter(Boolean);
    } catch (err) {
      console.error("[RECEPTIONIST] who_is_working could not read the diary:", err);
      return { success: true, date, inThatDay, message: `${dayLine} The diary could not be read for that time.${never}` };
    }
  }
  const atText = `${spokenTime(at.toISOString(), tz)} ${onWhen(when)}`;
  const timeLine = freeThen.length
    ? `Free for ${service.name.toLowerCase()} at ${atText}: ${namesText(freeThen)}.`
    : `Nobody is free for ${service.name.toLowerCase()} at ${atText}. Offer to check other times with check_availability.`;
  return { success: true, date, inThatDay, freeThen, message: `${dayLine} ${timeLine}${never}` };
}

/** "today", "tomorrow", "on Monday 23 November". */
function onWhen(when: string): string {
  return when === "today" || when === "tomorrow" ? when : `on ${when}`;
}
