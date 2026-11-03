import {
  canReadAvailability,
  earliestBookableStart,
  getBookingProvider,
  getSalonConfig,
  type SalonConfig,
} from "@/lib/booking";
import type { ReadableProvider } from "@/lib/booking/types";
import {
  DEFAULT_SEARCH_DAYS,
  filterSlotsByPreference,
  parseTimeOfDay,
  type SlotPreference,
} from "@/lib/booking/availability";
import type { TimeSlot } from "@/lib/booking/types";
import { chooseOffer } from "@/lib/booking/offer";
import { stylistServiceProblem } from "@/lib/booking/rules";
import { matchStylist, resolveBookedService, type SalonService } from "@/lib/salon-config";
import { normaliseCallerName } from "@/lib/caller-name";
import {
  openWindowFor,
  parseSpokenTimeOn,
  resolveSpokenDate,
  zonedDateString,
  zonedIsoString,
} from "@/lib/business-hours";
import { hasBeenBefore } from "@/lib/client-link";
import {
  DAY_NAMES,
  blankToUndefined,
  normaliseClientType,
  patchTestOnFile,
  resolveCallerPhone,
  serviceNotResolvedMessage,
  serviceStaffedOnDate,
  spokenDay,
  spokenTime,
} from "./action-helpers";

/**
 * check_availability: what is free, and what the receptionist offers.
 *
 * The request is read into one shape (availabilityRequest), the diary read
 * for free times (readFreeSlots), an offer chosen (chooseOffer), and the
 * reply worded (availabilityReply). Staff asking through the diary's
 * assistant get the whole day instead (staffAvailability).
 */

/**
 * The diary as staff ask about it: every free time on the day, and who is
 * free at each. A caller is offered two times and no names, so as not to be
 * read a list; someone at the salon choosing who to put a client with needs
 * the whole day. The day is the one asked about, or the first after it with
 * anything free.
 */
function staffAvailability(input: {
  slots: TimeSlot[];
  date: string;
  today: string;
  named: boolean;
  timeZone: string;
  service: string;
  durationMinutes: number;
}) {
  const dayOf = (sl: TimeSlot) => zonedDateString(new Date(sl.start), input.timeZone);
  const onDay = input.slots.filter((sl) => dayOf(sl) === input.date);
  const shown = onDay.length ? onDay : input.slots.filter((sl) => dayOf(sl) > input.date || !input.named);
  const day = shown.length ? dayOf(shown[0]) : null;
  if (!day) {
    return {
      available: false,
      canCheck: true,
      today: input.today,
      date: input.date,
      message: `Nothing free for ${input.service.toLowerCase()} on ${spokenDay(input.date, input.timeZone)} or in the weeks after.`,
    };
  }
  const options = shown
    .filter((sl) => dayOf(sl) === day)
    .map((sl) => ({
      day: spokenDay(day, input.timeZone),
      date: day,
      time: spokenTime(sl.start, input.timeZone),
      startsAt: zonedIsoString(new Date(sl.start), input.timeZone),
      stylist: sl.stylistName,
    }));
  const byStylist = new Map<string, string[]>();
  for (const o of options) {
    const name = o.stylist ?? "Anyone";
    byStylist.set(name, [...(byStylist.get(name) ?? []), o.time]);
  }
  const list = [...byStylist]
    .map(([name, times]) => `${name} at ${times.length > 1 ? `${times.slice(0, -1).join(", ")} and ${times.at(-1)}` : times[0]}`)
    .join("; ");
  const movedOn = day !== input.date;
  return {
    available: !movedOn,
    canCheck: true,
    today: input.today,
    date: day,
    ...(movedOn ? { requestedDate: input.date } : {}),
    service: input.service,
    durationMinutes: input.durationMinutes,
    options,
    message:
      (movedOn && input.named ? `Nothing free on ${spokenDay(input.date, input.timeZone)}. ` : "") +
      `Free on ${spokenDay(day, input.timeZone)}: ${list}.`,
  };
}

/** How far ahead a caller who can wait is looked for: a month. */
const MONTH_SEARCH_DAYS = 31;

/**
 * Nothing in the range searched: offer to look further, or take a message.
 * A diary read a day at a time has only looked at the one day, so the caller
 * is asked for another.
 */
function nothingAhead(service: string, range: string, lookedFurther: boolean, canLookAhead: boolean): string {
  if (!canLookAhead) return "Ask which other day suits them, and check that day.";
  if (lookedFurther) {
    return (
      `Nothing free for ${service.toLowerCase()} in the next ${range}. Say so, and ` +
      "take a message with take_message so someone can ring them back with something."
    );
  }
  return (
    `Nothing free for ${service.toLowerCase()} in the next two weeks. Say so, and ask whether they could ` +
    "wait longer. If they could, call this again with lookFurther true to look a month ahead; if not, " +
    "take a message with take_message so someone can ring them back."
  );
}

/**
 * "Saturday", said on a Saturday, means a week today: today is its own word.
 * But a caller ringing on a Saturday afternoon may well mean today, and a
 * receptionist handed next week's diary without being told so said "this
 * Saturday is fully booked". So the answer says which Saturday it is about.
 */
export async function handleCheckAvailability(
  organizationId: string,
  params: Parameters<typeof checkAvailability>[1] & {
    customerPhone?: string;
    callerNumber?: string;
    customerName?: string;
  }
) {
  // A patch test on record: offered as for a returning client, with no
  // 48-hour wait for colour, and the agent is told so it need not ask.
  const askedType = normaliseClientType(
    params.clientType ?? (params.newClient === true ? "new" : params.newClient === false ? "returning" : undefined)
  );
  const onFile = askedType === "returning" ? null : await patchTestOnFile(organizationId, params);
  const checked = await checkAvailability(
    organizationId,
    onFile ? { ...params, clientType: "returning", newClient: undefined } : params
  );
  const result = onFile
    ? {
        ...checked,
        patchTestOnRecord: onFile,
      }
    : checked;
  const asked = (params.date || params.day || "").trim().toLowerCase().replace(/^(this|on)\s+/, "");
  const r = result as { today?: string; date?: string; requestedDate?: string; message?: unknown };
  if (!r.today || typeof r.message !== "string") return result;
  const todayName = DAY_NAMES[new Date(`${r.today}T12:00:00Z`).getUTCDay()];
  const answeredFor = r.requestedDate ?? r.date;
  if (asked !== todayName.toLowerCase() || !answeredFor || answeredFor === r.today) return result;
  return {
    ...result,
    message:
      `Today is ${todayName}, so "${params.date || params.day}" was taken as a week today, ` +
      `not today; if they meant today, check "today". ${r.message}`,
  };
}

/** What check_availability is asked. */
interface AvailabilityParams {
  date?: string;
  /** The model sometimes sends a weekday under `day`. */
  day?: string;
  service?: string;
  stylist?: string;
  teamMember?: string;
  clientType?: string;
  /** Some phrasings produce a boolean instead of clientType. */
  newClient?: boolean;
  /** Who it is for, with their number: enough to tell a regular from their record. */
  customerName?: string;
  customerPhone?: string;
  callerNumber?: string;
  /** "morning" | "afternoon" | "evening" */
  timeOfDay?: string;
  /** "HH:MM" local — caller wants nothing before this. */
  after?: string;
  /** "HH:MM" local — caller wants nothing after this. */
  before?: string;
  /** "earliest" when they asked for the soonest rather than a choice. */
  prefer?: string;
  /** The one time they asked for ("2pm", "14:00"): offered alone when free. */
  time?: string;
  /** Search a month ahead rather than two weeks, once the caller has said they can wait. */
  lookFurther?: boolean | string;
  /**
   * Asked by staff (the diary's assistant), not a caller: every free time
   * on the day, with who is free, rather than the two choices a caller is
   * offered. Never set from the phone: the receptionist's session drops it.
   */
  forStaff?: boolean;
}

/**
 * The diary, as a caller (or staff) asked about it. Each step is below, in
 * the order they run:
 *
 * 1. availabilityRequest: what was asked, checked and resolved.
 * 2. readFreeSlots: the diary, from that day for two weeks (or a month).
 * 3. staffAvailability: for staff, every free time with names, and done.
 * 4. chooseOffer (booking/offer.ts): the time asked for, or two choices.
 * 5. availabilityReply: those in words, with why a named day is out.
 */
async function checkAvailability(organizationId: string, params: AvailabilityParams) {
  const provider = await getBookingProvider(organizationId);

  // Belt to the type system's braces. Even if `check_availability` is left
  // attached for an organization whose provider cannot read a diary, the
  // refusal is returned here — at the exact moment the model would otherwise
  // improvise a time. This is what replaced stubSlots().
  if (!canReadAvailability(provider)) {
    return {
      available: null,
      canCheck: false,
      message:
        "You cannot see the diary. Do not state or imply that any time is " +
        "free. Take the booking request and tell the caller the salon will " +
        "confirm it when they open.",
    };
  }

  const cfg = await getSalonConfig(organizationId);
  const req = await availabilityRequest(organizationId, params, cfg);
  if (!req.ok) return req.reply;

  const canLookAhead = provider.capabilities.forwardSearch;
  // Two weeks ahead as a rule; a month when the caller has said they can
  // wait that long.
  const searchDays = !canLookAhead ? 1 : req.lookFurther ? MONTH_SEARCH_DAYS : DEFAULT_SEARCH_DAYS;

  const read = await readFreeSlots(provider, organizationId, req, searchDays);
  if (!read.ok) return read.reply;

  // Inside the window they gave. If it has nothing at all in the range, say
  // so and offer what there is, rather than quietly ignoring them.
  const inWindow = req.hasPreference ? filterSlotsByPreference(read.slots, cfg.timeZone, req.preference) : read.slots;
  const windowEmpty = req.hasPreference && inWindow.length === 0;
  const pool = windowEmpty ? read.slots : inWindow;

  if (params.forStaff) {
    return staffAvailability({
      slots: pool,
      date: req.date,
      today: req.today,
      named: req.named,
      timeZone: cfg.timeZone,
      service: req.service.name,
      durationMinutes: req.service.durationMinutes,
    });
  }

  const offer = chooseOffer({
    slots: pool,
    timeZone: cfg.timeZone,
    day: req.date,
    named: req.named,
    time: req.askedTime,
    minGapMinutes: req.service.durationMinutes,
  });
  return availabilityReply(cfg, req, offer, { windowEmpty, searchDays, canLookAhead });
}

type AvailabilityRequest = {
  ok: true;
  service: SalonService;
  clientType: "new" | "returning" | "unknown";
  stylistName: string | undefined;
  /** They named a day (or a date), rather than asking for the soonest. */
  named: boolean;
  date: string;
  today: string;
  preference: { timeOfDay: ReturnType<typeof parseTimeOfDay>; after?: string; before?: string };
  hasPreference: boolean;
  /** "HH:MM", the one time they asked for. */
  askedTime: string | null;
  lookFurther: boolean;
};

/**
 * Step 1: what was asked, checked and resolved, or the reply that sends the
 * model back for something it is missing (a service, a real stylist, a day).
 */
async function availabilityRequest(
  organizationId: string,
  params: AvailabilityParams,
  cfg: SalonConfig
): Promise<AvailabilityRequest | { ok: false; reply: Record<string, unknown> }> {
  // Every service the caller named, folded into one appointment. A cut and a
  // colour is one slot as long as both of them together, and checking for
  // only one of them offers a time that will not fit the work.
  const resolvedService = resolveBookedService(blankToUndefined(params.service), cfg.services);
  if (!resolvedService.ok) {
    return {
      ok: false,
      reply: {
        available: null,
        canCheck: true,
        message: params.service?.trim()
          ? serviceNotResolvedMessage(params.service, resolvedService.matched, resolvedService.unmatched, cfg.services)
          : "Which service is that for? I need to know before I can check " +
            "the diary, because different services take different amounts " +
            "of time.",
      },
    };
  }
  const service = resolvedService.service;

  let clientType = normaliseClientType(
    params.clientType ?? (params.newClient === true ? "new" : params.newClient === false ? "returning" : undefined)
  );
  // Only colour cares (a new client's skin test holds back the first two
  // days), and then a regular found on their own record is offered those
  // days like anyone else, without being asked.
  const forName = normaliseCallerName(params.customerName);
  const forPhone = resolveCallerPhone(params.customerPhone, params.callerNumber);
  if (
    service.requiresPatchTest &&
    clientType !== "returning" &&
    forName.ok &&
    forPhone.ok &&
    (await hasBeenBefore(organizationId, forPhone.e164, forName.name))
  ) {
    clientType = "returning";
  }
  const stylistName = blankToUndefined(params.stylist) ?? blankToUndefined(params.teamMember);

  // A name that is nobody here. Searching everyone instead would read out
  // other stylists' times as if they were the one asked for. Usually the
  // line mishearing a name ("Joe" for "Jo"), so the team is listed.
  if (stylistName && !matchStylist(stylistName, cfg.stylists)) {
    return {
      ok: false,
      reply: {
        available: null,
        canCheck: true,
        unknownStylist: true,
        team: cfg.stylists.map((st) => st.name),
        message:
          `"${stylistName}" is not a stylist here. The team is ` +
          `${cfg.stylists.map((st) => st.name).join(", ")}. Check the name ` +
          "with the caller, then call this again.",
      },
    };
  }

  const pairing = stylistServiceProblem(stylistName, service, cfg.stylists);
  if (pairing) return { ok: false, reply: { available: null, canCheck: true, message: pairing } };

  const wants: SlotPreference = (blankToUndefined(params.prefer) ?? "").toLowerCase() === "earliest" ? "earliest" : "any";
  const today = zonedDateString(new Date(), cfg.timeZone);

  // Callers say "Thursday"; the model has no dependable idea what today is.
  // Resolve against the salon's own clock rather than trusting it to compute.
  let date = resolveSpokenDate(params.date || params.day, cfg.timeZone);
  if (!date) {
    // "As soon as you can" is already an answer to "which day?" — asking
    // again is the deafness this whole path exists to avoid. Start from today
    // and let the forward search find the day.
    if (wants !== "earliest") {
      return {
        ok: false,
        reply: {
          available: null,
          canCheck: true,
          message: "Which day did they mean? Ask for a specific day of the week or a date, then call this again.",
        },
      };
    }
    date = today;
  }

  // A model with no reliable sense of today will happily produce a date from
  // two years ago. Rather than search an empty past, hand back today's date so
  // it can correct itself on the next call.
  if (date < today) {
    return {
      ok: false,
      reply: {
        available: null,
        canCheck: true,
        today,
        message:
          `That date (${date}) is in the past. Today is ${today}. Work out the ` +
          "day the caller meant from that and call this again.",
      },
    };
  }

  // Honour what the caller asked for. Offering nine in the morning to someone
  // who said "anytime after five" is the kind of thing that makes an agent
  // sound like it is not listening — which applies just as much to the day we
  // look ahead to as to the day they named.
  const preference = {
    timeOfDay: parseTimeOfDay(blankToUndefined(params.timeOfDay)),
    after: blankToUndefined(params.after),
    before: blankToUndefined(params.before),
  };

  return {
    ok: true,
    service,
    clientType,
    stylistName,
    named: wants !== "earliest",
    date,
    today,
    preference,
    hasPreference: Boolean(preference.timeOfDay || preference.after || preference.before),
    // "Can I have 2 o'clock?": the one time they asked for.
    askedTime: parseSpokenTimeOn(blankToUndefined(params.time) ?? "", cfg.hours, date) ?? null,
    lookFurther: params.lookFurther === true || params.lookFurther === "true",
  };
}

/**
 * Step 2: the day they named and the days after it, in one free/busy read:
 * when that day has nothing, the next choices are already to hand.
 */
async function readFreeSlots(
  provider: ReadableProvider,
  organizationId: string,
  req: AvailabilityRequest,
  searchDays: number
): Promise<{ ok: true; slots: TimeSlot[] } | { ok: false; reply: Record<string, unknown> }> {
  try {
    const slots = await provider.getAvailability({
      organizationId,
      date: req.date,
      serviceName: req.service.name,
      stylistName: req.stylistName,
      clientType: req.clientType,
      searchDays,
    });
    return { ok: true, slots };
  } catch (err) {
    // Could not read the diary. Say so — never fall back to a guess.
    console.error("[RECEPTIONIST] Availability lookup failed:", err);
    return {
      ok: false,
      reply: {
        available: null,
        canCheck: false,
        message:
          "The diary could not be reached. Apologise, take the booking request, " +
          "and tell the caller the salon will confirm it when they open.",
      },
    };
  }
}

/** Step 5: what chooseOffer picked, in words for the receptionist to say. */
function availabilityReply(
  cfg: SalonConfig,
  req: AvailabilityRequest,
  offer: ReturnType<typeof chooseOffer>,
  ctx: { windowEmpty: boolean; searchDays: number; canLookAhead: boolean }
) {
  const { service, stylistName, date, today, named, askedTime } = req;
  const spokenRange = req.lookFurther ? "month" : "two weeks";

  // What is said is the time and its day; who would do it waits for the
  // read-back, unless they asked for someone.
  const options = offer.picks.map((sl) => {
    const day = zonedDateString(new Date(sl.start), cfg.timeZone);
    return {
      day: spokenDay(day, cfg.timeZone),
      date: day,
      time: spokenTime(sl.start, cfg.timeZone),
      // In the salon's clock, so the digits match the time just spoken.
      startsAt: zonedIsoString(new Date(sl.start), cfg.timeZone),
      ...(stylistName ? { stylist: sl.stylistName } : {}),
    };
  });
  const said = (o: (typeof options)[number], dayAlready?: string) =>
    `${o.date === dayAlready ? "" : `${o.day} `}at ${o.time}`;
  const offerLine =
    options.length === 2
      ? `${said(options[0])}, or ${said(options[1], options[0].date)}`
      : options.length === 1
        ? said(options[0])
        : "";
  const noStylist = stylistName ? "" : " Do not name a stylist; who it is with is read back before it is booked.";
  const howToOffer =
    (options.length === 2 ? "Offer these two, each with its day, and nothing else: " : "Offer this: ") +
    `${offerLine}.` +
    noStylist +
    " When they choose, use the exact startsAt value for that option.";

  const dayHasAny = offer.picks.some((sl) => zonedDateString(new Date(sl.start), cfg.timeZone) === date);
  const firstDate = options[0]?.date ?? date;

  if (offer.kind === "exact") {
    return {
      available: true,
      canCheck: true,
      today,
      date,
      service: service.name,
      durationMinutes: service.durationMinutes,
      exact: true,
      options,
      message:
        `${options[0].time} on ${options[0].day} is free. Offer just that one; do not read out ` +
        "other times. If they take it, use the exact startsAt value." +
        noStylist,
    };
  }

  if (named && !dayHasAny) {
    const out = whyDayIsOut(cfg, req, ctx.windowEmpty, spokenRange);
    const nextAvailable = options.length ? { date: firstDate, options } : undefined;
    return {
      available: false,
      canCheck: true,
      today,
      date,
      searchedDays: ctx.searchDays,
      nextAvailable,
      closed: out.closed,
      unstaffed: out.unstaffed,
      ...(out.patchTest ? { patchTestRequired: true } : {}),
      ...(ctx.windowEmpty ? { outsidePreference: true } : {}),
      message: options.length
        ? `${out.why} ${howToOffer}`
        : `${out.why} ${nothingAhead(service.name, spokenRange, req.lookFurther, ctx.canLookAhead)}`,
    };
  }

  if (offer.kind === "none") {
    return {
      available: false,
      canCheck: true,
      today,
      date,
      searchedDays: ctx.searchDays,
      message:
        (ctx.canLookAhead ? "" : `Nothing free for ${service.name.toLowerCase()} ${spokenDay(date, cfg.timeZone)}. `) +
        nothingAhead(service.name, spokenRange, req.lookFurther, ctx.canLookAhead),
    };
  }

  // The answer may be about a later day than the one they named, or than
  // today when they named none; each option says its own day.
  const movedOn = firstDate !== date;
  return {
    available: true,
    canCheck: true,
    // Every response carries the date, so the model can orient from the first
    // successful call rather than guessing and being corrected afterwards.
    today,
    date: firstDate,
    ...(movedOn ? { requestedDate: date } : {}),
    service: service.name,
    durationMinutes: service.durationMinutes,
    ...(ctx.windowEmpty ? { outsidePreference: true } : {}),
    options,
    message:
      (ctx.windowEmpty ? "Nothing free in the window they asked for. Say so plainly, then: " : "") +
      (askedTime && named ? `${spokenTime(`${date}T${askedTime}:00Z`, "UTC")} is taken. Say so, then: ` : "") +
      howToOffer,
  };
}

/**
 * Why the day they named has nothing. It matters: shut is not full, too late
 * today is not full, and a day nobody does this service on is not full.
 */
function whyDayIsOut(cfg: SalonConfig, req: AvailabilityRequest, windowEmpty: boolean, spokenRange: string) {
  const { service, date, today } = req;
  const floor = earliestBookableStart(service, req.clientType, new Date(), undefined, undefined, cfg);
  const closed = openWindowFor(cfg.hours, cfg.timeZone, date) === null;
  const unstaffed = !closed && !serviceStaffedOnDate(cfg, service, date);
  const window = closed ? null : openWindowFor(cfg.hours, cfg.timeZone, date);
  const overForToday =
    date === today && window !== null && Date.now() + service.durationMinutes * 60_000 > window.end.getTime();
  const theDay = spokenDay(date, cfg.timeZone);
  const why =
    floor.reason === "patch_test" && date < zonedDateString(floor.at, cfg.timeZone)
      ? `${service.name} needs a skin patch test at least 48 hours beforehand for a new client, done ` +
        `at the salon while it is open, so the earliest is ${spokenDay(zonedDateString(floor.at, cfg.timeZone), cfg.timeZone)}.`
      : closed
        ? `The salon is closed on ${theDay} — say that, not that it is booked up.`
        : overForToday
          ? "It is too late in the day for that today: the salon is closing or has closed. Say " +
            "that, not that it is booked up."
          : unstaffed
            ? `Nobody who does ${service.name.toLowerCase()} works ${theDay} — say that it is not a ` +
              "day we offer it, not that it is booked up, so they do not ask again for the same " +
              "day next week."
            : windowEmpty
              ? `Nothing free on ${theDay} in the window they asked for, nor in the next ${spokenRange}.`
              : `Nothing free on ${theDay} for that service.`;
  return { why, closed, unstaffed, patchTest: floor.reason === "patch_test" };
}
