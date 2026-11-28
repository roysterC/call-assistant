"use client";

/**
 * The diary: one day across every stylist, with a month panel to jump by.
 *
 * Reads the appointments table, which on the salon's own diary (the default)
 * is the whole diary. A salon set to Google Calendar keeps its diary there, and
 * anything entered directly in Google will not appear here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WeekStrip, weekOf } from "@/components/calendar/week-strip";
import { WeekView } from "@/components/calendar/week-view";
import { usePendingCallbacks } from "@/lib/use-pending-callbacks";
import { openQuote } from "@/components/notifications/quote-alerts";
import { INTL_LOCALE, type MessageKey } from "@/lib/i18n";
import { useMe } from "@/components/providers/me-provider";
import { DIARY_CHANGED } from "@/components/voice-booking/assistant";
import { OPEN_BOOKING } from "@/components/notifications/booking-alerts";
import { noticesChanged, useBookingNotices } from "@/lib/use-booking-notices";
import { useT } from "@/components/providers/language-provider";
import { apiFetch, withAsOrg } from "@/lib/api-fetch";
import { MonthPanel } from "@/components/calendar/month-panel";
import {
  PHONE_HOUR_HEIGHT_PX,
  minutesOfDay,
  salonDate,
  salonDayRange,
} from "@/lib/calendar-layout";
import {
  DayGrid,
  StylistBadge,
  type CalendarAppointment,
  type CalendarStylist,
  type DiaryBlock,
} from "@/components/calendar/day-grid";
import { AppointmentSheet } from "@/components/calendar/appointment-sheet";
import { useIsPhone } from "@/lib/use-is-phone";
import { stylistColour } from "@/lib/stylist-colours";
import {
  clientOf,
  EditBookingDialog,
  MoveConfirmDialog,
  type PendingMove,
} from "@/components/calendar/edit-booking-dialog";
import {
  BlockTimeDialog,
  type BlockDialogState,
} from "@/components/calendar/block-time-dialog";
import {
  blockToForm,
  type TimeBlockForm,
  type TimeBlockRecord,
} from "@/lib/time-blocks";
import {
  buildServiceTones,
  familiesInUse,
  familyHue,
} from "@/lib/service-colours";
import {
  NewBookingDialog,
  type BookingSlot,
} from "@/components/calendar/new-booking-dialog";
import type { ClientRow } from "@/components/calendar/client-picker";
import {
  parseServices,
  resolveBookedService,
  splitServiceText,
  type SalonService,
} from "@/lib/salon-config";
import type { SalonMenu } from "@/lib/nail-menu";
import { addCalendarDays } from "@/lib/business-hours";

interface Stylist {
  id?: string;
  name: string;
  workingDays?: number[];
  googleCalendarId?: string;
  takesBookings?: boolean;
}

interface BusinessHour {
  day: number;
  closed?: boolean;
  open?: string;
  close?: string;
}

const DEFAULT_TZ = "Europe/London";

/** "YYYY-MM-DD" for an instant, as observed in `tz`. */
function dateIn(tz: string, at = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return p;
}

/** 0=Sunday, matching the weekday numbering used in settings. */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function hhmmToMin(v: string | undefined): number | null {
  if (!v) return null;
  const [h, m] = v.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/**
 * The list price of what an appointment was booked as. A desk booking of two
 * services is stored as "Full head colour + Cut and finish", which no single
 * catalogue entry matches, so it is priced as the sum of its parts.
 */
function listPriceFor(
  serviceText: string | undefined,
  services: SalonService[]
): number | null {
  const r = resolveBookedService(serviceText, services);
  return r.ok ? r.service.priceMinor : null;
}

/** Weeks until a client is usually back when the service does not say. */
const DEFAULT_REBOOK_WEEKS = 4;

/**
 * "Book again" from a booking: the same client, services, stylist and time,
 * as many weeks on as the service says they come back (a month if it does
 * not say), moved on a week at a time until it is not in the past.
 */
function rebookSlot(
  a: CalendarAppointment,
  services: SalonService[],
  today: string,
  timeZone: string
): BookingSlot {
  const text = a.serviceText.toLowerCase();
  const weeks =
    services
      .filter((s) => s.rebookWeeks && text.includes(s.name.toLowerCase()))
      .sort((x, y) => y.name.length - x.name.length)[0]?.rebookWeeks ?? DEFAULT_REBOOK_WEEKS;
  const start = new Date(a.startsAt);
  let date = addCalendarDays(salonDate(start, timeZone), weeks * 7);
  while (date < today) date = addCalendarDays(date, 7);
  const min = minutesOfDay(start, timeZone);
  return {
    stylistName: a.stylistName,
    time: `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`,
    date,
    client: { ...clientOf(a), visits: a.status === "completed" || a.clientType === "returning" ? 1 : 0 },
    serviceNames: splitServiceText(a.serviceText),
  };
}

/** A client from their page's details, as the booking pop-up takes one. */
function clientRowFrom(
  c: Omit<ClientRow, "lastVisit" | "visits" | "nextBooking">,
  appointments: { startsAt: string; status: string }[]
): ClientRow {
  const now = Date.now();
  const past = appointments.filter((a) => (a.status === "booked" || a.status === "completed") && new Date(a.startsAt).getTime() < now);
  const next = appointments
    .filter((a) => a.status === "booked" && new Date(a.startsAt).getTime() >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  return {
    ...c,
    lastVisit: past.map((a) => a.startsAt).sort().at(-1) ?? null,
    visits: past.length,
    nextBooking: next?.startsAt ?? null,
  };
}

/** A new block's form, starting from a day, a person and a time. An hour long. */
function newBlockForm(
  date: string,
  stylistName: string | null,
  time: string
): TimeBlockForm {
  const [h, m] = time.split(":").map(Number);
  const end = Math.min(h * 60 + m + 60, 23 * 60 + 45);
  const endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  return {
    stylistName,
    label: "",
    allDay: false,
    repeat: "none",
    startDate: date,
    endDate: date,
    startTime: time,
    endTime,
    weekdays: [weekdayOf(date)],
    untilDate: null,
  };
}

/** How often an open diary checks for bookings made elsewhere. */
const DIARY_CHECK_MS = 30_000;

export default function CalendarPage() {
  const { t, lang } = useT();
  const [timeZone, setTimeZone] = useState(DEFAULT_TZ);
  const [selected, setSelected] = useState(() => dateIn(DEFAULT_TZ));
  const [view, setView] = useState(() => {
    const [y, m] = dateIn(DEFAULT_TZ).split("-").map(Number);
    return { year: y, month: m };
  });

  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [services, setServices] = useState<SalonService[]>([]);
  const [menu, setMenu] = useState<SalonMenu | null>(null);
  const [hours, setHours] = useState<BusinessHour[]>([]);
  // On the salon's own diary everyone can be booked; on Google, only
  // stylists with a calendar shared to us.
  const [usesGoogle, setUsesGoogle] = useState(false);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [blocks, setBlocks] = useState<DiaryBlock[]>([]);
  // The stored blocks behind `blocks`, so one can be opened for editing.
  const [blockRecords, setBlockRecords] = useState<Map<string, TimeBlockRecord>>(
    new Map()
  );
  const [blockDialog, setBlockDialog] = useState<BlockDialogState | null>(null);
  const [editing, setEditing] = useState<CalendarAppointment | null>(null);
  // Below lg the month picker is folded away, so on a phone the day itself is
  // what the screen opens on rather than a month of dates above it.
  const [showMonth, setShowMonth] = useState(false);
  // From lg up the month and the colours sit beside the day; they can be
  // folded to a strip, giving the columns the room (remembered here).
  const [monthFolded, setMonthFolded] = useMonthFolded();
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [monthBusy, setMonthBusy] = useState<Set<string>>(new Set());
  const [slot, setSlot] = useState<BookingSlot | null>(null);
  // Day, or the week around it (desktop).
  const [mode, setMode] = useState<"day" | "week">("day");
  // The week around the day showing: its dots, and the Week view.
  const [weekAppointments, setWeekAppointments] = useState<CalendarAppointment[]>([]);
  // Clients waiting for a price (src/lib/quotes.ts), for the chip beside the controls.
  const [quotes, setQuotes] = useState<{ id: string; channel: string; conversationId: string }[]>([]);
  const [openAppointment, setOpenAppointment] =
    useState<CalendarAppointment | null>(null);
  // A booking asked for by a pop-up or an alert, opened once its day has
  // loaded (loadedFor), so a day still on its way is not searched too soon.
  const [wanted, setWanted] = useState<{ id: string; date: string } | null>(null);
  // "Book" from Callbacks or Clients: the next free time tapped is for them.
  const [bookingFor, setBookingFor] = useState<ClientRow | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Until settings arrive we know nothing about the team, and "no stylists
  // configured" would be a false statement rather than an empty one.
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // The time, kept current: the now line, the free time after it and the
  // heading's clock all move with it. (It used to be read once, when the day
  // was picked, so a diary left open all morning thought it was still 9.)
  const clock = useClock();
  const today = useMemo(() => salonDate(clock ?? new Date(), timeZone), [clock, timeZone]);

  // Minutes elapsed today, so the grid can grey out time that has gone. Null
  // on any day but today: a past day is wholly past, a future one wholly not.
  const nowMinutes = useMemo(
    () => (selected === today && clock ? minutesOfDay(clock, timeZone) : null),
    [selected, today, timeZone, clock]
  );
  const isPastDay = selected < today;

  // Built once per service list rather than per block: the mapping depends on
  // the whole list (a service's step is its position within its family), so
  // it cannot be worked out one appointment at a time.
  // Coloured by the salon's own trade's families: manicures and sets at a
  // nail salon, cutting and colour at a hairdresser's (service-colours.ts).
  const businessTypes = useMe()?.businessTypes;
  const tones = useMemo(() => buildServiceTones(services, businessTypes), [services, businessTypes]);
  const legend = useMemo(() => familiesInUse(services, businessTypes), [services, businessTypes]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/settings");
        const { settings } = await res.json();
        // Only those who take bookings have a column and can be booked.
        setStylists(((settings?.teamMembers ?? []) as Stylist[]).filter((s) => s.takesBookings !== false));
        setServices(parseServices(settings?.services));
        setMenu(settings?.menu ?? null);
        setHours(settings?.businessHours ?? []);
        setUsesGoogle(settings?.diaryProvider === "google");
        // Column is `timezone`; SalonConfig renames it to `timeZone` but the
        // settings endpoint returns the row as stored.
        if (settings?.timezone) setTimeZone(settings.timezone);
      } catch {
        // Leave the defaults; the grid still renders and says nothing false.
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, []);

  // Only the latest request's answer is shown. The diary can ask for two
  // days at once (today as it opens, then the day a link asked for, or again
  // when the salon's time zone arrives), and an older answer arriving last
  // used to show the wrong day's bookings, or none.
  const dayRequest = useRef(0);
  /**
   * The day's bookings and blocked time. `quiet`: a check for anything new
   * (below), with no loading state, and a failed answer left alone rather
   * than emptying the diary. A quiet check does not take over from a load
   * the diary is waiting on: a day changed meanwhile makes its answer old.
   */
  const loadDay = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    const mine = quiet ? dayRequest.current : ++dayRequest.current;
    if (!quiet) setLoading(true);
    try {
      const { from, to } = salonDayRange(selected, timeZone);
      const [res, blockRes] = await Promise.all([
        apiFetch(`/api/appointments?status=all&from=${from}&to=${to}`),
        apiFetch(`/api/time-blocks?from=${from}&to=${to}`),
      ]);
      if (mine !== dayRequest.current || (quiet && !res.ok)) return;
      const data = await res.json();
      setAppointments(data.appointments ?? []);
      const blockData = blockRes.ok ? await blockRes.json() : {};
      setBlocks(blockData.occurrences ?? []);
      setBlockRecords(
        new Map(
          (blockData.blocks ?? []).map(
            (r: TimeBlockRecord & { startsAt: string | null; endsAt: string | null }) => [
              r.id,
              {
                ...r,
                startsAt: r.startsAt ? new Date(r.startsAt) : null,
                endsAt: r.endsAt ? new Date(r.endsAt) : null,
              },
            ]
          )
        )
      );
    } catch {
      if (quiet || mine !== dayRequest.current) return;
      setAppointments([]);
      setBlocks([]);
    } finally {
      if (!quiet && mine === dayRequest.current) {
        setLoading(false);
        setLoadedFor(selected);
      }
    }
  }, [selected, timeZone]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  // A phone app sits in the background for hours. Coming back to it should
  // show the booking the phone assistant took meanwhile, without anyone
  // having to think of refreshing.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") loadDay({ quiet: true });
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [loadDay]);

  // Dots on the month panel. A separate, wider fetch so paging days does not
  // refetch the month, and paging months does not disturb the day.
  const loadMonth = useCallback(async () => {
    const first = `${view.year}-${String(view.month).padStart(2, "0")}-01`;
    const nextMonth =
      view.month === 12
        ? `${view.year + 1}-01-01`
        : `${view.year}-${String(view.month + 1).padStart(2, "0")}-01`;
    try {
      const { from } = salonDayRange(first, timeZone);
      const { from: to } = salonDayRange(nextMonth, timeZone);
      const res = await apiFetch(
        `/api/appointments?status=all&from=${from}&to=${to}`
      );
      const data = await res.json();
      const days = new Set<string>();
      for (const a of data.appointments ?? []) {
        days.add(salonDate(new Date(a.startsAt), timeZone));
      }
      setMonthBusy(days);
    } catch {
      setMonthBusy(new Set());
    }
  }, [view, timeZone]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const weekStart = weekOf(selected)[0];
  const weekRequest = useRef(0);
  const loadWeek = useCallback(async () => {
    const mine = ++weekRequest.current;
    try {
      const { from } = salonDayRange(weekStart, timeZone);
      const { from: to } = salonDayRange(shiftDate(weekStart, 7), timeZone);
      const res = await apiFetch(`/api/appointments?status=all&from=${from}&to=${to}`);
      const data = await res.json();
      if (mine === weekRequest.current) setWeekAppointments(data.appointments ?? []);
    } catch {
      if (mine === weekRequest.current) setWeekAppointments([]);
    }
  }, [weekStart, timeZone]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const weekBusy = useMemo(() => {
    const days = new Set<string>();
    for (const a of weekAppointments) if (a.status !== "cancelled") days.add(salonDate(new Date(a.startsAt), timeZone));
    return days;
  }, [weekAppointments, timeZone]);

  // What is waiting elsewhere: callbacks (the menu's own count) and quotes.
  const callbacksWaiting = usePendingCallbacks(true);
  useEffect(() => {
    let live = true;
    const load = () =>
      apiFetch("/api/quotes")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => live && d && setQuotes(Array.isArray(d.quotes) ? d.quotes : []))
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const router = useRouter();
  const pathname = usePathname();

  // A diary left open on the desk keeps up by itself: a booking the
  // receptionist took, or one made on another phone or computer, shows
  // without anyone refreshing. Checked every half minute while it is on
  // screen, and at once when a new-booking pop-up arrives (the pop-up is
  // fetched every half minute too, and straight away on a push).
  const notices = useBookingNotices(true);
  const newest = notices.notices[0]?.id ?? null;
  const seenNewest = useRef(newest);
  useEffect(() => {
    if (newest === seenNewest.current) return;
    seenNewest.current = newest;
    if (newest) {
      loadDay({ quiet: true });
      loadMonth();
      loadWeek();
    }
  }, [newest, loadDay, loadMonth, loadWeek]);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      loadDay({ quiet: true });
      loadMonth();
      loadWeek();
    };
    const id = setInterval(tick, DIARY_CHECK_MS);
    return () => clearInterval(id);
  }, [loadDay, loadMonth, loadWeek]);

  const weekday = weekdayOf(selected);

  const open = useMemo(() => {
    const row = hours.find((h) => h.day === weekday);
    if (!row || row.closed) return null;
    const openMin = hhmmToMin(row.open);
    const closeMin = hhmmToMin(row.close);
    if (openMin === null || closeMin === null) return null;
    return { openMin, closeMin };
  }, [hours, weekday]);

  // The week's widest opening hours: the span a day the salon is shut shows.
  const usual = useMemo(() => {
    const days = hours
      .filter((h) => !h.closed)
      .map((h) => ({ openMin: hhmmToMin(h.open), closeMin: hhmmToMin(h.close) }))
      .filter((h): h is { openMin: number; closeMin: number } => h.openMin !== null && h.closeMin !== null);
    if (days.length === 0) return null;
    return { openMin: Math.min(...days.map((d) => d.openMin)), closeMin: Math.max(...days.map((d) => d.closeMin)) };
  }, [hours]);

  const stylistNames = stylists.map((s) => s.name);

  const columns: CalendarStylist[] = useMemo(
    () =>
      stylists.map((s, i): CalendarStylist => ({
        id: s.id,
        name: s.name,
        colour: stylistColour(i),
        // An empty list means "any day the salon is open", the same rule the
        // booking engine applies.
        worksToday:
          Boolean(open) &&
          ((s.workingDays?.length ?? 0) === 0 ||
            (s.workingDays ?? []).includes(weekday)),
        bookable: !usesGoogle || Boolean(s.googleCalendarId),
      })).concat(
        // Bookings belong to a stylist by name. One removed from the team, or
        // renamed, keeps them, and they are real clients still due in: give
        // that name a column on the days it has bookings, rather than leave
        // them invisible behind a dot on the month. Re-adding the same name
        // in Settings puts them back under the stylist.
        [
          ...new Map(
            appointments
              .filter((a) => !stylists.some((s) => s.name.toLowerCase() === a.stylistName.toLowerCase()))
              .map((a) => [a.stylistName.toLowerCase(), a.stylistName])
          ).values(),
        ].map((name) => ({ name, worksToday: false, bookable: false, former: true }))
      ),
    [stylists, open, weekday, usesGoogle, appointments]
  );

  // A phone shows one stylist at a time: five columns at phone width are
  // five slivers nobody can tap. The one picked, else whoever is working
  // today.
  const isPhone = useIsPhone();
  const [phonePick, setPhonePick] = useState<string | null>(null);

  /** A free time tapped: for the client being booked for, if there is one. */
  const pickSlot = (base: BookingSlot) => {
    if (bookingFor) {
      setSlot({ ...base, client: bookingFor });
      setBookingFor(null);
    } else {
      setSlot(base);
    }
  };
  const phoneColumn =
    columns.find((c) => c.name === phonePick) ??
    columns.find((c) => c.worksToday) ??
    columns[0];
  const visibleColumns = isPhone && phoneColumn ? [phoneColumn] : columns;

  const jump = (date: string) => {
    setSelected(date);
    const [y, m] = date.split("-").map(Number);
    setView({ year: y, month: m });
  };

  // Opening a booking the receptionist took clears its "new" colour, for
  // this person, and its pop-up if one is still showing.
  const showAppointment = useCallback((a: CalendarAppointment) => {
    setOpenAppointment(a);
    if (!a.unseen) return;
    setAppointments((list) => list.map((x) => (x.id === a.id ? { ...x, unseen: false } : x)));
    void apiFetch("/api/booking-notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "seen", appointmentId: a.id }),
    })
      .then(noticesChanged)
      .catch(() => {});
  }, []);

  // /calendar?date=…&booking=… (an alert tapped on a phone, or a pop-up's
  // "View booking" from another page): that day, with the booking open.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get("date");
    const id = params.get("booking");
    const bookFor = params.get("bookFor");
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    if (day) jump(day);
    if (day && id) setWanted({ id, date: day });
    if (bookFor) {
      apiFetch(`/api/clients/${encodeURIComponent(bookFor)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.client && setBookingFor(clientRowFrom(d.client, d.appointments ?? [])))
        .catch(() => {});
    }
    if (date || id || bookFor) window.history.replaceState(null, "", withAsOrg("/calendar"));
  }, []);

  // A pop-up's "View booking" while the diary is already open.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { date, id } = (e as CustomEvent<{ date: string; id: string }>).detail;
      setWanted({ id, date });
      // That day, fetched afresh: the booking may be newer than what is showing.
      if (date !== selected) jump(date);
      else loadDay();
    };
    window.addEventListener(OPEN_BOOKING, onOpen);
    return () => window.removeEventListener(OPEN_BOOKING, onOpen);
  });

  useEffect(() => {
    if (!wanted || loading || loadedFor !== wanted.date) return;
    const a = appointments.find((x) => x.id === wanted.id);
    setWanted(null);
    if (a) showAppointment(a);
  }, [wanted, loading, loadedFor, appointments, showAppointment]);

  // The assistant changed the diary: show that day, and reload.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const date = (e as CustomEvent<{ date?: string }>).detail?.date;
      if (date && date !== selected) jump(date);
      loadDay();
      loadMonth();
      loadWeek();
    };
    window.addEventListener(DIARY_CHANGED, onChanged);
    return () => window.removeEventListener(DIARY_CHANGED, onChanged);
  });

  // A day the salon is shut, by its opening hours.
  const closedOn = (date: string) => {
    const row = hours.find((h) => h.day === weekdayOf(date));
    return !row || Boolean(row.closed) || !row.open || !row.close;
  };
  // "Mon 16 Nov", and on today "Today, Mon 16 Nov": short, so the header
  // never shifts with the length of a month's name.
  const shortDate = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(INTL_LOCALE[lang], {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const title =
    mode === "week"
      ? t("diary.weekOf", { date: shortDate(weekStart) })
      : selected === today
        ? t("diary.todayHeading", { date: shortDate(selected) })
        : shortDate(selected);

  /** "+ New booking": the day showing, someone working, the next quarter hour (or opening). */
  const newBooking = () => {
    const col = columns.find((c) => c.worksToday && c.bookable) ?? columns.find((c) => !c.former);
    if (!col) return;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    let start = open ? open.openMin : 9 * 60;
    if (open && nowMinutes !== null) start = Math.min(Math.max(Math.ceil(nowMinutes / 15) * 15, open.openMin), open.closeMin - 15);
    pickSlot({ stylistName: col.name, time: hhmm(start), date: selected });
  };

  const pickDay = (date: string) => {
    jump(date);
    setMode("day");
  };

  const firstQuote = quotes[0];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden p-4 md:p-6 phone:pt-2.5">
      {/* A wide screen: the date on the left, the controls on the right where
          they never move, and the week below in seven equal days. */}
      <div className="hidden md:flex h-12 shrink-0 items-center gap-2.5">
        {/* "Today" is worked out on the server too, which may be either side
            of midnight from the browser; the browser's is the one that counts. */}
        <h1 suppressHydrationWarning className="min-w-0 flex-1 truncate font-heading text-[23px] font-extrabold tracking-tight">
          {title}
        </h1>
        {/* What is waiting, where there is room for it beside the controls
            (an upright tablet has the menu's dots and the bell instead). */}
        {callbacksWaiting > 0 && (
          <Link
            href={withAsOrg("/callbacks")}
            className="hidden h-8 shrink-0 items-center gap-1.5 rounded-full bg-cornsilk-800 lg:inline-flex px-3 text-[13px] font-bold text-cornsilk-100 hover:bg-cornsilk-700"
          >
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            {t(callbacksWaiting === 1 ? "diary.callbackOne" : "diary.callbackMany", { n: callbacksWaiting })}
          </Link>
        )}
        {firstQuote && (
          <button
            type="button"
            onClick={() => openQuote(firstQuote.channel, firstQuote.conversationId, pathname, router.push)}
            className="hidden h-8 shrink-0 items-center rounded-full bg-red-50 lg:inline-flex px-3 text-[13px] font-bold text-red-800 hover:bg-red-100"
          >
            {t(quotes.length === 1 ? "diary.quoteOne" : "diary.quoteMany", { n: quotes.length })}
          </button>
        )}
        {(callbacksWaiting > 0 || firstQuote) && <span aria-hidden="true" className="mx-0.5 hidden h-6 w-px shrink-0 bg-border lg:block" />}
        <Button variant="outline" className="h-9 shrink-0 px-3" onClick={() => pickDay(today)} disabled={selected === today && mode === "day"}>
          {t("diary.today")}
        </Button>
        <div role="tablist" aria-label={t("diary.view")} className="flex shrink-0 rounded-[11px] bg-muted p-[3px]">
          {(["day", "week"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`h-[30px] rounded-lg px-3.5 text-[13px] font-semibold transition-colors ${
                mode === m ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(m === "day" ? "diary.dayView" : "diary.weekView")}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          className="h-9 shrink-0 gap-1.5 px-3 lg:hidden"
          aria-expanded={showMonth}
          onClick={() => setShowMonth((v) => !v)}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {t("diary.month")}
        </Button>
        <Button className="h-9 shrink-0 gap-1.5 px-3.5 font-bold" onClick={newBooking} disabled={columns.length === 0}>
          <Plus className="h-4 w-4" />
          {t("diary.newBooking")}
        </Button>
      </div>
      <div className="hidden md:block shrink-0 pb-3 pt-2.5">
        <WeekStrip
          long
          selected={selected}
          today={today}
          busy={weekBusy}
          closed={closedOn}
          onSelect={pickDay}
          onShiftWeek={(n) => jump(shiftDate(selected, n))}
        />
      </div>

      {/* A phone: the date (which opens the month) and Today on one slim
          line, the week, and whose day as equal tabs. */}
      <div className="md:hidden shrink-0 space-y-2 pb-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMonth((v) => !v)}
            aria-expanded={showMonth}
            aria-label={t("diary.month")}
            className="flex min-h-11 min-w-0 items-center gap-1 font-heading text-[19px] font-extrabold tracking-tight"
          >
            <span suppressHydrationWarning className="truncate">{title}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showMonth ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => pickDay(today)}
            disabled={selected === today}
            className="ml-auto h-11 shrink-0 rounded-full border border-input bg-card px-4 text-[13px] font-bold active:bg-accent disabled:bg-muted disabled:text-muted-foreground"
          >
            {t("diary.today")}
          </button>
          {/* The same New booking as a wide screen's, in reach of a thumb's
              first glance; tapping empty time still works too. */}
          <button
            type="button"
            onClick={newBooking}
            disabled={columns.length === 0}
            aria-label={t("diary.newBooking")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_1px_2px_0_rgb(45_51_26/0.18)] active:translate-y-px disabled:opacity-50"
          >
            <Plus className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
        <WeekStrip selected={selected} today={today} busy={weekBusy} closed={closedOn} onSelect={pickDay} />
        {columns.length > 1 && (
          <div
            role="tablist"
            aria-label={t("diary.stylist")}
            className={columns.length <= 5 ? "grid gap-0.5 rounded-xl bg-muted p-[3px]" : "flex gap-0.5 overflow-x-auto rounded-xl bg-muted p-[3px]"}
            style={columns.length <= 5 ? { gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` } : undefined}
          >
            {columns.map((c) => {
              const on = c.name === phoneColumn?.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-label={c.name}
                  onClick={() => setPhonePick(c.name)}
                  className={`flex h-11 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-[9px] px-1.5 text-[13.5px] font-semibold transition-colors ${
                    on ? "bg-card shadow-sm" : "text-muted-foreground active:bg-card/60"
                  } ${c.worksToday ? "" : "italic"}`}
                >
                  {/* Five across leaves room for the name alone. */}
                  {columns.length <= 4 && <StylistBadge stylist={{ ...c, worksToday: true }} size="sm" />}
                  <span className="truncate">{c.name.split(/\s+/)[0]}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {bookingFor && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-tea-green-600 bg-tea-green-900 px-3.5 py-2.5 text-sm"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong>{t("diary.bookingFor", { name: bookingFor.name ?? t("diary.thisClient") })}</strong>{" "}
            <span className="text-muted-foreground">{t("diary.bookingForHint")}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setBookingFor(null)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}

      {mode === "week" && !isPhone ? (
        <WeekView
          days={weekOf(selected)}
          selected={selected}
          today={today}
          appointments={weekAppointments}
          stylists={stylistNames}
          tones={tones}
          timeZone={timeZone}
          closed={closedOn}
          priceOf={(a) => a.amountMinor ?? listPriceFor(a.serviceText, services)}
          onOpenDay={pickDay}
        />
      ) : (
      <div className="flex gap-4 flex-1 min-h-0 overflow-hidden flex-col-reverse lg:flex-row">
        {!settingsLoaded ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground py-16">
            {t("diary.loadingDiary")}
          </div>
        ) : columns.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground gap-2 py-16">
            <CalendarDays className="h-4 w-4" />
            {t("diary.noStylists")}
          </div>
        ) : (
          <DayGrid
            date={selected}
            timeZone={timeZone}
            stylists={visibleColumns}
            hourHeightPx={isPhone ? PHONE_HOUR_HEIGHT_PX : undefined}
            showHeader={!isPhone}
            appointments={appointments}
            open={open}
            usual={usual}
            nowMinutes={nowMinutes}
            isPastDay={isPastDay}
            tones={tones}
            onPickSlot={(stylistName, time) => pickSlot({ stylistName, time, date: selected })}
            onOpenAppointment={showAppointment}
            onMoveAppointment={(appointment, stylistName, time) =>
              setPendingMove({ appointment, stylistName, time, date: selected })
            }
            blocks={blocks}
            onOpenBlock={(b) => {
              const record = blockRecords.get(b.blockId);
              if (!record) return;
              setBlockDialog({
                mode: "edit",
                blockId: b.blockId,
                initial: blockToForm(record, timeZone),
                occurrenceDate: b.date,
              });
            }}
          />
        )}

        <aside
          className={`${showMonth ? "flex" : "hidden"} lg:flex w-full ${monthFolded ? "lg:w-[3.25rem] lg:pl-2" : "lg:w-60 lg:pl-4"} shrink-0 overflow-y-auto max-h-[50vh] lg:max-h-none lg:border-l lg:border-border flex-col gap-4`}
        >
          {/* Folded: the way back, and the colours as swatches (named on hover). */}
          {monthFolded && (
            <div className="hidden lg:flex flex-col items-center gap-3.5">
              <button
                type="button"
                onClick={() => setMonthFolded(false)}
                aria-label={t("month.unfold")}
                title={t("month.unfold")}
                className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <CalendarDays className="h-4 w-4" />
              </button>
              {legend.length > 0 && (
                <>
                  <span aria-hidden="true" className="h-px w-5 bg-border" />
                  <ul aria-label={t("diary.services")} className="flex flex-col items-center gap-2.5">
                    {legend.map((f) => (
                      <li key={f} title={t(`family.${f}` as MessageKey)}>
                        <span
                          aria-hidden="true"
                          className="block h-3 w-3 rounded-[4px] border"
                          style={{
                            background: `${familyHue(f, businessTypes)}2e`,
                            borderColor: `${familyHue(f, businessTypes)}b3`,
                          }}
                        />
                        <span className="sr-only">{t(`family.${f}` as MessageKey)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {/* Open, and always below lg (the Month button shows it there). */}
          <div className={`flex flex-col gap-4 ${monthFolded ? "lg:hidden" : ""}`}>
          <MonthPanel
            selected={selected}
            today={today}
            viewYear={view.year}
            viewMonth={view.month}
            onViewChange={(year, month) => setView({ year, month })}
            onSelect={(date) => {
              jump(date);
              setShowMonth(false);
            }}
            busyDates={monthBusy}
            showYear={false}
            onFold={() => setMonthFolded(true)}
          />
          {legend.length > 0 && (
            <ul aria-label={t("diary.services")} className="hidden lg:flex flex-wrap gap-x-3 gap-y-1.5 px-1">
              {legend.map((f) => (
                <li key={f} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-[3px] shrink-0 border"
                    style={{
                      background: `${familyHue(f, businessTypes)}2e`,
                      borderColor: `${familyHue(f, businessTypes)}b3`,
                    }}
                  />
                  {t(`family.${f}` as MessageKey)}
                </li>
              ))}
            </ul>
          )}
          </div>
        </aside>
      </div>
      )}

      <AppointmentSheet
        appointment={openAppointment}
        timeZone={timeZone}
        tones={tones}
        listPriceMinor={listPriceFor(openAppointment?.serviceText, services)}
        onClose={() => setOpenAppointment(null)}
        onEdit={() => {
          setEditing(openAppointment);
          setOpenAppointment(null);
        }}
        onBookAgain={() => {
          if (!openAppointment) return;
          setSlot(rebookSlot(openAppointment, services, today, timeZone));
          setOpenAppointment(null);
        }}
        onChanged={() => {
          loadDay();
          loadMonth();
          loadWeek();
        }}
      />

      <NewBookingDialog
        slot={slot}
        services={services}
        menu={menu}
        stylists={stylistNames}
        timeZone={timeZone}
        dayAppointments={appointments}
        dayBlocks={blocks}
        dayShown={selected}
        onClose={() => setSlot(null)}
        onBooked={() => {
          loadDay();
          loadMonth();
          loadWeek();
        }}
        onBlockInstead={(s) => {
          setSlot(null);
          setBlockDialog({
            mode: "new",
            initial: newBlockForm(s.date, s.stylistName, s.time),
          });
        }}
      />

      <EditBookingDialog
        appointment={editing}
        services={services}
        menu={menu}
        stylists={stylistNames}
        timeZone={timeZone}
        dayAppointments={appointments}
        dayBlocks={blocks}
        onClose={() => setEditing(null)}
        onSaved={() => {
          loadDay();
          loadMonth();
          loadWeek();
        }}
      />

      <MoveConfirmDialog
        move={pendingMove}
        timeZone={timeZone}
        onClose={() => setPendingMove(null)}
        onMoved={() => {
          loadDay();
          loadMonth();
          loadWeek();
        }}
      />

      <BlockTimeDialog
        state={blockDialog}
        stylists={stylistNames}
        timeZone={timeZone}
        closingTime={(date) => {
          const row = hours.find((h) => h.day === weekdayOf(date));
          return row && !row.closed ? (row.close ?? null) : null;
        }}
        onClose={() => setBlockDialog(null)}
        onSaved={() => {
          loadDay();
          loadWeek();
        }}
      />
    </div>
  );
}

/**
 * The time now, updated every half minute so the diary's now line keeps up
 * with the day. Null until the page is running in the browser: the server's
 * clock is not the salon's screen's, and text rendered from it would stay.
 */
function useClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const MONTH_FOLDED_KEY = "diary-month-folded";

/**
 * Whether the month and colours beside the day are folded to a strip,
 * remembered in this browser. Read after mount, as the server has no storage
 * and reading it in render would give the server and the browser different
 * markup; storage can be missing or refuse (private windows), so the panel
 * then simply starts open.
 */
function useMonthFolded(): [boolean, (next: boolean) => void] {
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after mount
      if (window.localStorage.getItem(MONTH_FOLDED_KEY) === "1") setFolded(true);
    } catch {
      // No storage: start open.
    }
  }, []);
  const set = (next: boolean) => {
    setFolded(next);
    try {
      window.localStorage.setItem(MONTH_FOLDED_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, but still folded for this visit.
    }
  };
  return [folded, set];
}
