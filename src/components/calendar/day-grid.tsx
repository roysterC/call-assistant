"use client";

/**
 * One day, one column per stylist, time running down.
 *
 * Every stylist keeps a column whether or not they are rostered, so the shape
 * of the screen does not change as you page through the week — a column that
 * moves under the cursor is how a busy front desk books the wrong person.
 * A stylist who is not working today is shaded and refuses clicks instead.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  closedBands,
  hourMarks,
  isOnDate,
  layoutColumn,
  minutesOfDay,
  rowFromOffset,
  spanGeometry,
  quarterMarks,
  freeGaps,
  timeOfRow,
  dayWindow,
  rowCount,
  HOUR_HEIGHT_PX,
  PHONE_HOUR_HEIGHT_PX,
  OVERBOOK_GUTTER_PX,
  SLOT_MINUTES,
  EARLIEST_SHOWN_MIN,
  LATEST_SHOWN_MIN,
  type DiaryWindow,
  type PlacedBlock,
} from "@/lib/calendar-layout";
import { NEW_BOOKING, toneFor, type ServiceTone } from "@/lib/service-colours";
import { FORMER_STYLIST_COLOUR, stylistInitials } from "@/lib/stylist-colours";
import { useT } from "@/components/providers/language-provider";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { minutesTime, type Clock, type Translate } from "@/lib/i18n";
import { blocksTechnician, isTechnicians } from "@/lib/technician-match";

export interface CalendarAppointment {
  id: string;
  bookingNumber: number | null;
  serviceText: string;
  durationMinutes: number;
  stylistName: string;
  /** Her permanent id (src/lib/technicians.ts); her name is stylistName. */
  technicianId?: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  patchTestRequired: boolean;
  amountMinor: number | null;
  clientType: string;
  notes: string | null;
  /** Photos the client sent when booking by message: ids for /api/chat-photos/[id]. */
  photos?: { id: string }[];
  /** Booked by the receptionist and not yet opened by whoever is looking. */
  unseen?: boolean;
  /** The confirmation text: when it went, or why it did not. */
  confirmationSentAt?: string | null;
  confirmationError?: string | null;
  /** A design quoted in the chat: its price, in pence, instead of the price list's. */
  quotedPriceMinor?: number | null;
  lead: {
    id: string;
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
    /** Reached through another client's number (a child on a parent's phone). */
    contactLead?: { id: string; name: string | null; phone: string | null } | null;
    /** Set once the client was deleted: the booking stays, who they were does not. */
    anonymisedAt?: string | null;
  };
}

/** The line, and the pill on the clock, at the time it is now. */
// The --now token (globals.css): light enough for ink on its pill to clear 4.5:1.
const NOW_COLOUR = "var(--now)";

/**
 * A time inside the diary, on the reader's clock: "10:45", "2:15" or "14:15".
 * No am or pm: the hour labels beside it say which, and a salon's day leaves
 * no doubt.
 */
function shortTime(min: number, clock: Clock): string {
  return minutesTime(min, clock, false);
}

/** "45 min", "1 h", "1 h 30". */
function lengthLabel(min: number, t: Translate): string {
  if (min < 60) return t("grid.lenMin", { n: min });
  const h = Math.floor(min / 60);
  return min % 60 ? t("grid.lenHoursMin", { h, m: min % 60 }) : t("grid.lenHours", { h });
}

/** Who a booking is for, as the diary names them. */
/**
 * The bookings that overlap another of the same person's that day:
 * double-booked. Cancelled ones hold no time, so never count.
 */
export function doubleBookedIds(appointments: CalendarAppointment[]): Set<string> {
  const live = appointments
    .filter((a) => a.status !== "cancelled")
    .map((a) => ({ id: a.id, who: a.stylistName.toLowerCase(), from: Date.parse(a.startsAt), to: Date.parse(a.endsAt) }))
    .sort((x, y) => x.from - y.from);
  const out = new Set<string>();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length && live[j].from < live[i].to; j++) {
      if (live[j].who === live[i].who) {
        out.add(live[i].id);
        out.add(live[j].id);
      }
    }
  }
  return out;
}

export function clientLabel(lead: CalendarAppointment["lead"], t: Translate): string {
  if (lead.anonymisedAt) return t("grid.deletedClient");
  return lead.name ?? t("grid.client");
}

/**
 * Time nobody can be booked into, blocked or outside opening hours: one look
 * for both, so a closed morning and a stylist's lunch read the same.
 *
 * Drawn once, behind every column, rather than on each band: a pattern
 * starts from the corner of whatever it is drawn on, so a closed morning
 * striped column by column had its stripes break at every divider. Each
 * column paints itself white and leaves holes where it is unavailable
 * (`columnBackground`), so the one pattern shows through them all.
 */
const UNAVAILABLE_BG: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, color-mix(in oklab, var(--muted-foreground) 14%, transparent) 0 6px, transparent 6px 12px)",
  backgroundColor: "color-mix(in oklab, var(--muted) 55%, var(--card))",
};

/**
 * A column's own background: card white, with see-through holes where it is
 * closed or blocked so the stripes behind the grid show there.
 */
export function columnBackground(spans: Array<{ topPct: number; heightPct: number }>): string {
  const holes = spans
    .map((b) => [Math.max(b.topPct, 0), Math.min(b.topPct + b.heightPct, 100)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of holes) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  if (merged.length === 0) return "var(--diary-lane)";
  const stops: string[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) stops.push(`var(--diary-lane) ${at}% ${a}%`);
    stops.push(`transparent ${a}% ${b}%`);
    at = b;
  }
  if (at < 100) stops.push(`var(--diary-lane) ${at}% 100%`);
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

/** A stretch of blocked time as the diary fetch returns it. */
export interface DiaryBlock {
  blockId: string;
  stylistName: string | null;
  label: string;
  allDay: boolean;
  repeat: "none" | "weekly";
  /** Salon date the stretch starts on. */
  date: string;
  start: string;
  end: string;
}

export interface CalendarStylist {
  /** Her permanent id, when she is on the team (src/lib/technicians.ts). */
  id?: string;
  name: string;
  worksToday: boolean;
  bookable: boolean;
  /**
   * No longer on the team, but has bookings this day. Shown so they are never
   * hidden: the desk moves them to someone else from here. Nothing new can be
   * booked into the column.
   */
  former?: boolean;
  /** Their badge colour, from `stylistColour` by team order. */
  colour?: string;
}

/** A stylist's initials on their colour: who a column, or a tab, belongs to. */
export function StylistBadge({
  stylist,
  size = "md",
}: {
  stylist: CalendarStylist;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-card",
        size === "md" ? "h-7 w-7 text-[11px]" : "h-5 w-5 text-[9px]",
        !stylist.worksToday && !stylist.former && "opacity-60"
      )}
      style={{ background: stylist.former ? FORMER_STYLIST_COLOUR : (stylist.colour ?? FORMER_STYLIST_COLOUR) }}
    >
      {stylistInitials(stylist.name)}
    </span>
  );
}

/**
 * A strip above the first hour and below the last, so their labels, drawn
 * centred on the line, are not cut in half by the header and the bottom edge.
 * Carries the column edges so the dividers run unbroken.
 */
function EdgeStrip({ count }: { count: number }) {
  return (
    <div className="flex h-2.5" aria-hidden="true">
      <div className="w-16 shrink-0" />
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex-1 min-w-0 border-l-[6px] border-card" />
      ))}
    </div>
  );
}

interface DayGridProps {
  date: string;
  timeZone: string;
  stylists: CalendarStylist[];
  appointments: CalendarAppointment[];
  blocks: DiaryBlock[];
  /** Opening window in minutes past midnight, or null when shut. */
  open: { openMin: number; closeMin: number } | null;
  /** The salon's widest opening hours in the week: what a day it is shut shows. */
  usual?: { openMin: number; closeMin: number } | null;
  /** Minutes elapsed today, or null when the day shown is not today. */
  nowMinutes: number | null;
  /** The whole day is behind us. */
  isPastDay: boolean;
  /** Service name (lower-cased) to colour, built from the salon's list. */
  tones: Map<string, ServiceTone>;
  onPickSlot: (stylistName: string, time: string) => void;
  onOpenAppointment: (appointment: CalendarAppointment) => void;
  onOpenBlock: (block: DiaryBlock) => void;
  /** Taller on a phone, so a quarter-hour is about a fingertip high. */
  hourHeightPx?: number;
  /** The stylists' names above their columns. A phone leaves them out: its tabs say whose day it is. */
  showHeader?: boolean;
  /**
   * A booking was dragged to a stylist and time. Asks, never moves: the page
   * confirms before anything changes. Absent, bookings cannot be dragged.
   */
  onMoveAppointment?: (
    appointment: CalendarAppointment,
    stylistName: string,
    time: string
  ) => void;
}

/** A booking being dragged, and where on it the pointer took hold. */
interface Drag {
  appointment: CalendarAppointment;
  grabOffsetPx: number;
}

/** The smallest an hour is drawn to fit the whole day on screen: the phone's. */
const MIN_FIT_HOUR_PX = PHONE_HOUR_HEIGHT_PX;

export function DayGrid({
  date,
  timeZone,
  stylists,
  appointments,
  blocks,
  open,
  usual = null,
  nowMinutes,
  isPastDay,
  tones,
  onPickSlot,
  onOpenAppointment,
  onOpenBlock,
  onMoveAppointment,
  hourHeightPx = HOUR_HEIGHT_PX,
  showHeader = true,
}: DayGridProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropAt, setDropAt] = useState<{ stylistName: string; row: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // Hours asked for above and below the day ("show earlier", "show later"),
  // for the day they were asked on.
  const [more, setMore] = useState<{ date: string; earlier: number; later: number }>({ date, earlier: 0, later: 0 });
  const extra = more.date === date ? more : { date, earlier: 0, later: 0 };

  // The stretch of the day shown: its opening hours and half an hour either
  // side, stretched over anything on it outside them (calendar-layout.ts).
  const busy: Array<[number, number]> = [
    ...appointments
      .filter((a) => isOnDate(new Date(a.startsAt), date, timeZone))
      .map((a): [number, number] => {
        const from = minutesOfDay(new Date(a.startsAt), timeZone);
        const to = minutesOfDay(new Date(a.endsAt), timeZone);
        return [from, to > from ? to : 24 * 60];
      }),
    // Blocked time within the day; a holiday across whole days is not a
    // reason to show the small hours.
    ...blocks
      .filter((b) => isOnDate(new Date(b.start), date, timeZone) && isOnDate(new Date(b.end), date, timeZone))
      .map((b): [number, number] => [minutesOfDay(new Date(b.start), timeZone), minutesOfDay(new Date(b.end), timeZone)]),
  ];
  const win = dayWindow({ open, usual, busy, earlierHours: extra.earlier, laterHours: extra.later });

  // The day fills the screen it is on. A tall screen showed the day at its
  // set size with a band of nothing below it; the hours stretch to fill it
  // instead, up to twice their size. One a little short of the whole day
  // shrinks the hours to fit it, but never below the phone's size, which is
  // as small as a quarter-hour booking stays readable; shorter than that,
  // the set size, and it scrolls.
  const [fitPx, setFitPx] = useState<number | null>(null);
  const hours = (win.endMin - win.startMin) / 60;
  useEffect(() => {
    const el = scroller.current;
    const grid = body.current;
    if (!el || !grid || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const content = el.firstElementChild as HTMLElement | null;
      if (!content) return;
      // Everything that is not the hours: the names, the "show earlier/later" strips.
      const around = content.offsetHeight - grid.offsetHeight;
      const px = Math.floor((el.clientHeight - around) / hours);
      setFitPx(px > hourHeightPx ? Math.min(px, hourHeightPx * 2) : px >= MIN_FIT_HOUR_PX ? px : null);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [hours, hourHeightPx]);
  const hourPx = fitPx ?? hourHeightPx;

  // Open each day where it is worth looking: today an hour before now while
  // the salon is open, otherwise at opening time. Only when the day changes,
  // so the grid never moves under someone reading it.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const shown = open ?? usual;
    const target =
      nowMinutes !== null && (!open || nowMinutes < open.closeMin)
        ? nowMinutes - 60
        : shown
          ? shown.openMin - SLOT_MINUTES
          : win.startMin;
    const y = ((Math.max(target, win.startMin) - win.startMin) / 60) * hourPx;
    el.scrollTop = Math.max(0, y);
    // The day is what decides; now and opening are read as they stand then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  const { t, clock } = useT();
  const marks = hourMarks(win);
  const lines = quarterMarks(win);
  const shaded = closedBands(open, win);
  const nowShown = nowMinutes !== null && nowMinutes >= win.startMin && nowMinutes <= win.endMin;
  /** A clock label the now pill would sit on top of. */
  const nearNow = (min: number) => nowShown && Math.abs(min - nowMinutes!) < 14;
  // Nobody to book all day: closed, or everyone off. Said once, across the grid.
  const nobodyToday = stylists.length > 0 && (!open || stylists.every((s) => !s.worksToday));
  // Whose lane holds two bookings at once, flagged in its header too.
  const doubled = doubleBookedIds(appointments.filter((a) => isOnDate(new Date(a.startsAt), date, timeZone)));
  const doubledLanes = new Set(
    stylists.filter((s) => appointments.some((a) => doubled.has(a.id) && isTechnicians(a, s))).map((s) => s.name)
  );

  return (
    <div ref={scroller} className="flex-1 min-w-0 min-h-0 overflow-auto rounded-xl border border-border bg-card shadow-surface">
      {/* min-width keeps columns readable; the container scrolls rather than
          letting four stylists squeeze into thumbnails on a laptop. One
          column (a phone) needs no such help. */}
      <div className={stylists.length > 1 ? "min-w-[560px]" : undefined}>
        {showHeader && (
        <div className="flex sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border">
          <div className="w-16 shrink-0" />
          {stylists.map((s) => (
            <div
              key={s.name}
              className="flex-1 min-w-0 px-2 py-2 border-l-[6px] border-card flex items-center justify-center gap-2"
            >
              <StylistBadge stylist={s} />
              <div className="min-w-0 text-left">
                <div className="text-sm font-semibold leading-tight truncate">{s.name}</div>
                <div
                  className={cn(
                    "text-[11px] leading-tight truncate",
                    s.former ? "font-medium text-papaya-whip-100" : "text-muted-foreground"
                  )}
                >
                  {s.former
                    ? t("grid.notOnTeam")
                    : !s.bookable
                      ? t("grid.noCalendar")
                      : s.worksToday
                        ? null
                        : t("grid.notIn")}
                </div>
                {doubledLanes.has(s.name) && (
                  <span className="mt-0.5 inline-flex max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-full bg-red-50 px-1.5 py-px text-[11px] font-bold text-red-800">
                    <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t("grid.doubleBookedTitle")}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        )}

        {win.startMin > EARLIEST_SHOWN_MIN && (
          <MoreHours
            label={t("grid.showEarlier", { time: minutesTime(Math.max(EARLIEST_SHOWN_MIN, win.startMin - 60), clock) })}
            up
            onClick={() => setMore({ ...extra, earlier: extra.earlier + 1 })}
          />
        )}
        <EdgeStrip count={stylists.length} />
        <div
          ref={body}
          className="flex relative"
          style={{
            height: `${hours * hourPx}px`,
            ...UNAVAILABLE_BG,
          }}
        >
          {/* The clock: each hour large and bold across the column, read from
              a step back; the half hours small between them. The pill for
              now covers whichever label it would sit on. */}
          <div className="w-16 shrink-0 relative bg-card">
            {marks.map((m) => (
              <div
                key={m.hour}
                className={cn(
                  "absolute inset-x-0 pl-1.5 pr-2.5 -translate-y-1/2 text-right text-[17px] font-bold leading-none tabular-nums text-foreground",
                  nearNow(m.hour * 60) && "invisible"
                )}
                style={{ top: `${m.topPct}%` }}
              >
                {/* "14:00" on the 24-hour clock, "2pm" on the 12-hour. */}
                {clock === "24h" ? `${m.hour}:00` : m.label}
              </div>
            ))}
            {lines
              .filter((l) => l.half)
              .map((l) => (
                <div
                  key={l.minutes}
                  className={cn(
                    "absolute inset-x-0 pr-2.5 -translate-y-1/2 text-right text-[12.5px] font-medium leading-none tabular-nums text-tea-green-200",
                    nearNow(l.minutes) && "invisible"
                  )}
                  style={{ top: `${l.topPct}%` }}
                >
                  {shortTime(l.minutes, clock)}
                </div>
              ))}
            {nowShown && (
              <div
                aria-hidden="true"
                className="absolute right-1 z-10 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums text-tea-green-100"
                style={{ top: `${minutePct(nowMinutes!, win)}%`, background: NOW_COLOUR }}
              >
                {shortTime(nowMinutes!, clock)}
              </div>
            )}
          </div>

          {stylists.map((s) => (
            <StylistColumn
              key={s.name}
              stylist={s}
              dayOffLabel={!nobodyToday}
              timeZone={timeZone}
              win={win}
              open={open}
              shaded={shaded}
              lines={lines}
              nowMinutes={nowMinutes}
              isPastDay={isPastDay}
              tones={tones}
              appointments={appointments.filter(
                (a) =>
                  isTechnicians(a, s) &&
                  // The fetch is bounded to this day, but a block is placed by
                  // its time of day alone — so anything that slipped through
                  // would be drawn here at the right hour on the wrong date.
                  isOnDate(new Date(a.startsAt), date, timeZone)
              )}
              blocks={blocks.filter((b) => blocksTechnician(b, s))}
              date={date}
              onPickSlot={onPickSlot}
              onOpenAppointment={onOpenAppointment}
              onOpenBlock={onOpenBlock}
              drag={onMoveAppointment ? drag : null}
              dropRow={dropAt?.stylistName === s.name ? dropAt.row : null}
              onDragStart={onMoveAppointment ? setDrag : undefined}
              onDragHover={(row) =>
                setDropAt(row === null ? null : { stylistName: s.name, row })
              }
              onDrop={(row) => {
                if (drag && onMoveAppointment) {
                  onMoveAppointment(drag.appointment, s.name, timeOfRow(row, win));
                }
                setDrag(null);
                setDropAt(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setDropAt(null);
              }}
            />
          ))}
          {/* A day with nobody to book says so, rather than looking like an
              empty, open day until a click is refused. */}
          {nobodyToday && (
            <div className="pointer-events-none absolute inset-x-0 top-8 z-20 flex justify-center px-4">
              <span className="rounded-full bg-card px-4 py-2 text-center text-sm font-semibold shadow-raised ring-1 ring-border">
                {!open ? t("grid.closedDay") : t("grid.nobodyIn")}
              </span>
            </div>
          )}
        </div>
        <EdgeStrip count={stylists.length} />
        {win.endMin < LATEST_SHOWN_MIN && (
          <MoreHours
            label={t("grid.showLater", { time: minutesTime(Math.min(LATEST_SHOWN_MIN, win.endMin + 60), clock) })}
            onClick={() => setMore({ ...extra, later: extra.later + 1 })}
          />
        )}
      </div>
    </div>
  );
}

/** "Show from 7:30am" above the day, "Show until 7pm" below: an hour more, to book outside the usual hours. */
function MoreHours({ label, up = false, onClick }: { label: string; up?: boolean; onClick: () => void }) {
  const Icon = up ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 phone:h-11 w-full items-center justify-center gap-1.5 bg-muted/60 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Where a time of day sits down the grid, as a percentage. */
function minutePct(min: number, win: DiaryWindow): number {
  return ((min - win.startMin) / (win.endMin - win.startMin)) * 100;
}

function StylistColumn({
  stylist,
  timeZone,
  win,
  open,
  shaded,
  lines,
  nowMinutes,
  isPastDay,
  tones,
  appointments,
  blocks,
  date,
  onPickSlot,
  onOpenAppointment,
  onOpenBlock,
  drag,
  dropRow,
  onDragStart,
  onDragHover,
  onDrop,
  onDragEnd,
  dayOffLabel = true,
}: {
  stylist: CalendarStylist;
  /** "Day off" in the lane; not when the whole day already says nobody is in. */
  dayOffLabel?: boolean;
  timeZone: string;
  win: DiaryWindow;
  open: { openMin: number; closeMin: number } | null;
  shaded: Array<{ topPct: number; heightPct: number }>;
  lines: Array<{ minutes: number; topPct: number; major: boolean; half: boolean }>;
  nowMinutes: number | null;
  isPastDay: boolean;
  tones: Map<string, ServiceTone>;
  appointments: CalendarAppointment[];
  blocks: DiaryBlock[];
  date: string;
  onPickSlot: (stylistName: string, time: string) => void;
  onOpenAppointment: (appointment: CalendarAppointment) => void;
  onOpenBlock: (block: DiaryBlock) => void;
  drag: Drag | null;
  /** Where a dragged booking would land in this column, if over it. */
  dropRow: number | null;
  onDragStart?: (drag: Drag) => void;
  onDragHover: (row: number | null) => void;
  onDrop: (row: number) => void;
  onDragEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t, clock } = useT();
  const { notify } = useDialogs();
  const bookable = stylist.worksToday && stylist.bookable && !isPastDay;

  // How much of the column has already been and gone. Booking into it would
  // be accepted by the database and rejected by physics.
  const elapsedPct =
    nowMinutes === null
      ? isPastDay
        ? 100
        : 0
      : Math.min(
          Math.max(((nowMinutes - win.startMin) / (win.endMin - win.startMin)) * 100, 0),
          100
        );

  const blockSpans = blocks.flatMap((b) => {
    const g = spanGeometry(new Date(b.start), new Date(b.end), date, timeZone, win);
    return g ? [{ block: b, ...g }] : [];
  });

  // A cancelled booking no longer holds its time: it is drawn as a slip in
  // the strip down the lane's edge (still there to open and book again),
  // and the lane beside it books like any free time.
  const placed: PlacedBlock<CalendarAppointment>[] = layoutColumn(
    appointments.filter((a) => a.status !== "cancelled"),
    (a) => ({ startsAt: new Date(a.startsAt), endsAt: new Date(a.endsAt) }),
    timeZone,
    win
  );

  // Room for another booking: every stretch of half an hour or more, from
  // now (or opening) to closing, around the bookings and blocked time. Read
  // off what is drawn, so a note never sits over a block beside it. Hidden
  // while a booking is being dragged, which has its own outline.
  const toMin = (pct: number) => Math.round(win.startMin + (pct / 100) * (win.endMin - win.startMin));
  const gaps =
    bookable && open && !drag
      ? freeGaps(
          [
            ...placed.map((b): [number, number] => [toMin(b.topPct), toMin(b.topPct + b.heightPct)]),
            ...blockSpans.map((g): [number, number] => [toMin(g.topPct), toMin(g.topPct + g.heightPct)]),
          ],
          Math.max(
            open.openMin,
            win.startMin,
            nowMinutes === null ? 0 : Math.ceil(nowMinutes / SLOT_MINUTES) * SLOT_MINUTES
          ),
          Math.min(open.closeMin, win.endMin)
        )
      : [];

  /**
   * The quarter-hour row the dragged booking's top edge is over, snapped to
   * the nearest, or null where it may not go (the past, a day off).
   */
  const dropRowAt = (clientY: number): number | null => {
    const el = ref.current;
    if (!el || !drag || !bookable) return null;
    const box = el.getBoundingClientRect();
    const top = clientY - drag.grabOffsetPx - box.top;
    const row = Math.min(Math.max(Math.round((top / box.height) * rowCount(win)), 0), rowCount(win) - 1);
    if (nowMinutes !== null && win.startMin + row * SLOT_MINUTES < nowMinutes) return null;
    return row;
  };

  /**
   * A click on empty time: open a booking there, or say why not. Refusals
   * used to be silent, so a click on this morning simply did nothing and
   * looked broken.
   */
  const pick = (clientY: number) => {
    const el = ref.current;
    if (!el) return;
    if (!bookable) {
      notify(
        isPastDay
          ? t("grid.refusePastDay")
          : stylist.former
            ? t("grid.refuseFormer", { name: stylist.name })
            : !stylist.bookable
              ? t("grid.refuseNoCalendar", { name: stylist.name })
              : t("grid.refuseNotIn", { name: stylist.name }),
        "info"
      );
      return;
    }
    const box = el.getBoundingClientRect();
    const row = rowFromOffset((clientY - box.top) / box.height, win);

    // Refuse a time that has already passed. The phone path enforces a lead
    // time through `earliestBookableStart`; the desk had no equivalent, so a
    // click on this morning would happily book into it.
    if (nowMinutes !== null && win.startMin + row * SLOT_MINUTES < nowMinutes) {
      const next = Math.ceil(nowMinutes / SLOT_MINUTES) * SLOT_MINUTES;
      notify(t("grid.refusePast", { time: minutesTime(next, clock) }), "info");
      return;
    }

    onPickSlot(stylist.name, timeOfRow(row, win));
  };

  return (
    <div
      ref={ref}
      onClick={(e) => pick(e.clientY)}
      onDragOver={(e) => {
        const row = dropRowAt(e.clientY);
        if (row === null) return onDragHover(null);
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (row !== dropRow) onDragHover(row);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDragHover(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const row = dropRowAt(e.clientY);
        if (row !== null) onDrop(row);
        else onDragEnd();
      }}
      className={cn(
        "flex-1 min-w-0 relative border-l-[6px] border-card",
        bookable ? "cursor-copy" : "cursor-not-allowed"
      )}
      // Closed hours look like blocked time: either way, nobody can be
      // booked then. Both are holes onto the stripes behind the grid.
      style={{ background: stylist.worksToday ? columnBackground([...shaded, ...blockSpans]) : "transparent" }}
    >

      {/* A day off is hatched like closed time (the stripes behind the grid)
          and says so in the lane, not only in small type under the name. */}
      {dayOffLabel && !stylist.worksToday && !stylist.former && (
        // Pinned under the sticky lane headers as the day scrolls.
        <span className="pointer-events-none sticky top-16 z-[6] mx-auto mt-3 block w-fit max-w-[90%] truncate rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
          {t("grid.dayOff")}
        </span>
      )}

      {/* The overbook strip. Faintly marked so it reads as somewhere you may
          click, rather than as dead space beside a full column. */}
      {bookable && placed.length > 0 && (
        <div
          className="absolute inset-y-0 right-0 border-l border-dashed border-border/60 bg-accent/10 pointer-events-none"
          style={{ width: `${OVERBOOK_GUTTER_PX}px` }}
          aria-hidden="true"
        />
      )}

      {elapsedPct > 0 && (
        <div
          className="absolute inset-x-0 top-0 bg-muted/30 pointer-events-none"
          style={{ height: `${elapsedPct}%` }}
        />
      )}

      {lines.map((l) => (
        <div
          key={l.minutes}
          className={cn(
            "absolute inset-x-0 border-t pointer-events-none",
            // Every quarter-hour visible, the hour plainest, the quarter
            // past and to only just there: enough to aim a click at without
            // ruling the day into a ledger.
            l.major
              ? "border-tea-green-500"
              : l.half
                ? "border-tea-green-600"
                : "border-tea-green-700/55"
          )}
          style={{ top: `${l.topPct}%` }}
        />
      ))}

      {nowMinutes !== null && nowMinutes >= win.startMin && nowMinutes <= win.endMin && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 z-[5] border-t-2 pointer-events-none"
          style={{ top: `${minutePct(nowMinutes, win)}%`, borderColor: NOW_COLOUR }}
        />
      )}

      {/* Blocked time sits under the bookings, so a booking made into a
          block (the desk may) is still there to click. */}
      {blockSpans.map(({ block: b, ...g }) => {
        return (
          <button
            key={`${b.blockId}-${b.date}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenBlock(b);
            }}
            title={b.stylistName === null ? t("grid.everyone", { label: b.label }) : b.label}
            className="absolute inset-x-0 overflow-hidden border-y border-border/60 px-1.5 py-1 text-left text-[11px] leading-tight text-muted-foreground hover:text-foreground focus-visible:ring-2"
            style={{ top: `${g.topPct}%`, height: `${g.heightPct}%` }}
          >
            <span className="font-medium">{b.label}</span>
          </button>
        );
      })}

      {/* Free time, as words at the top of each gap and nothing more: a
          click there lands on the column, which books the time clicked. */}
      {gaps.map(([from, to]) => (
        <span
          key={from}
          className="pointer-events-none absolute left-0 max-w-full truncate whitespace-nowrap px-2 pt-1 text-[11.5px] font-medium leading-tight text-tea-green-200"
          style={{ top: `${minutePct(from, win)}%` }}
        >
          {t("grid.free", { len: lengthLabel(to - from, t) })}
        </span>
      ))}

      {drag && dropRow !== null && (
        <div
          className="absolute inset-x-1 z-10 rounded-md border-2 border-dashed border-foreground/70 bg-foreground/5 pointer-events-none"
          style={{
            top: `${(dropRow / rowCount(win)) * 100}%`,
            height: `${(drag.appointment.durationMinutes / (win.endMin - win.startMin)) * 100}%`,
          }}
          aria-hidden="true"
        >
          <span className="block px-1.5 py-0.5 text-[11px] font-medium">
            {timeOfRow(dropRow, win)}
          </span>
        </div>
      )}

      {appointments
        .filter((a) => a.status === "cancelled")
        .map((a) => {
          const g = spanGeometry(new Date(a.startsAt), new Date(a.endsAt), date, timeZone, win);
          if (!g) return null;
          const s0 = minutesOfDay(new Date(a.startsAt), timeZone);
          const e0 = minutesOfDay(new Date(a.endsAt), timeZone);
          const label = `${shortTime(s0, clock)}–${shortTime(e0, clock)}, ${clientLabel(a.lead, t)}, ${a.serviceText}, ${t("grid.cancelled")}`;
          // One line at its start time, on the right so a "free" note at the
          // left still reads; only the line takes clicks, so its time books.
          return (
            <button
              key={a.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenAppointment(a);
              }}
              aria-label={label}
              title={label}
              className="@container absolute z-[6] flex h-[22px] max-w-[calc(100%-6px)] items-center gap-1 truncate rounded-full border border-tea-green-600 bg-card px-2 text-[11px] font-medium leading-none text-muted-foreground hover:text-foreground focus-visible:ring-2"
              style={{ top: `calc(${g.topPct}% + 2px)`, right: `${OVERBOOK_GUTTER_PX + 2}px` }}
            >
              <span className="shrink-0 tabular-nums">{shortTime(s0, clock)}</span>
              <span className="min-w-[3ch] truncate line-through">{clientLabel(a.lead, t)}</span>
              {/* The word goes before the name on a narrow lane; the strike
                  and the name, its label and its sheet still say it. */}
              <span className="hidden shrink-0 @min-[9rem]:inline">· {t("grid.cancelled")}</span>
            </button>
          );
        })}

      {placed.map((b) => {
        const a = b.item;
        const startMin = minutesOfDay(new Date(a.startsAt), timeZone);
        const endMin = minutesOfDay(new Date(a.endsAt), timeZone);
        const length = a.durationMinutes || endMin - startMin;
        // Half an hour has room for two lines: the time leads the name. Longer
        // bookings give the time a line of its own.
        const roomy = length > 30;
        // New from the receptionist: its own colour until it is opened.
        const tone = a.unseen ? NEW_BOOKING : toneFor(a.serviceText, tones);
        // Two bookings at once for one person: flagged in words and red, the
        // start time kept whole (the end time goes first when it is narrow).
        const doubled = b.lanes > 1;
        // Doubled bookings cascade rather than split the lane in half: each
        // keeps the whole width less a step per lane, so its start time,
        // name and status all still read; the later one sits on top.
        const inset = doubled ? b.lane * 14 : 0;
        const done = a.status === "completed";
        const noShow = a.status === "no_show";
        const statusWord = done ? t("grid.done") : noShow ? t("grid.noShow") : null;
        const statusChip = statusWord && (
          <span
            className={cn(
              "mt-0.5 inline-flex w-fit max-w-full shrink-0 items-center gap-0.5 truncate rounded-full px-1.5 py-px text-[10.5px] font-bold",
              noShow ? "bg-red-50 text-red-800" : "bg-tea-green-700 text-tea-green-100"
            )}
          >
            {done && <Check className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />}
            {statusWord}
          </span>
        );
        // Only a booking still to come can be moved; judged by the same
        // "now" the grid greys the past with.
        const draggable =
          Boolean(onDragStart) &&
          stylist.bookable &&
          a.status === "booked" &&
          !isPastDay &&
          (nowMinutes === null ||
            minutesOfDay(new Date(a.startsAt), timeZone) > nowMinutes);
        return (
          <button
            key={a.id}
            type="button"
            draggable={draggable}
            onDragStart={(e) => {
              if (!onDragStart) return;
              e.dataTransfer.effectAllowed = "move";
              // Firefox will not start a drag without some data.
              e.dataTransfer.setData("text/plain", a.id);
              onDragStart({
                appointment: a,
                grabOffsetPx: e.clientY - e.currentTarget.getBoundingClientRect().top,
              });
            }}
            onDragEnd={onDragEnd}
            onClick={(e) => {
              e.stopPropagation();
              onOpenAppointment(a);
            }}
            title={`${a.unseen ? t("grid.newBooking") : ""}${shortTime(startMin, clock)}–${shortTime(endMin, clock)} ${clientLabel(a.lead, t)} — ${a.serviceText}`}
            aria-label={[
              `${shortTime(startMin, clock)}–${shortTime(endMin, clock)}`,
              clientLabel(a.lead, t),
              a.serviceText,
              stylist.name,
              a.unseen ? t("grid.new") : null,
              statusWord,
              doubled ? t("grid.doubleBooked") : null,
            ]
              .filter(Boolean)
              .join(", ")}
            className={cn(
              // Content from the top, where the booking starts: a button
              // centres it otherwise, putting a long booking's time halfway down.
              // Lines keep their height and the card clips at the bottom, rather
              // than squeezing a chip on top of the line above it.
              "@container absolute flex flex-col justify-start rounded-[12px] border-[1.5px] px-2 py-1.5 text-left overflow-hidden text-foreground [&>*]:shrink-0",
              "text-[12px] leading-tight shadow-[0_1px_2px_0_rgb(45_51_26/0.06),0_4px_10px_-4px_rgb(45_51_26/0.10)] transition-shadow hover:shadow-[0_2px_4px_0_rgb(45_51_26/0.08),0_10px_20px_-8px_rgb(45_51_26/0.18)] focus-visible:ring-2",
              // Colour carries the service, so status has its own channel:
              // a word on the booking, and a quieter fill for one that is done
              // (never opacity, which took its text below 4.5:1).
              noShow && "border-dashed",
              b.clippedStart && "rounded-t-none",
              b.clippedEnd && "rounded-b-none",
              a.unseen && "border-2"
            )}
            style={{
              background: done ? "var(--secondary)" : tone.fill,
              borderColor: doubled ? "var(--destructive)" : tone.border,
              borderWidth: doubled ? 2 : undefined,
              top: `${b.topPct}%`,
              height: `${b.heightPct}%`,
              // Every block sits inside the column minus the overbook strip,
              // so there is always bare column left to click on.
              left: `${inset + 2}px`,
              width: `calc(100% - ${OVERBOOK_GUTTER_PX}px - ${inset + 4}px)`,
              // Above the now line, which shows only in the gaps.
              zIndex: 6 + b.lane,
            }}
          >
            {/* The start time is the headline, the largest thing on the
                booking, so the day can be read from a step back; the end
                time sits small beside it. Half-hour and quarter-hour
                bookings put it before the name, a little smaller. */}
            {roomy && (
              <span className="flex items-baseline gap-1.5 min-w-0">
                <span
                  className={cn(
                    "shrink-0 font-extrabold leading-[1.1] tracking-[-0.01em] tabular-nums text-tea-green-100",
                    "text-[20px]"
                  )}
                >
                  {shortTime(startMin, clock)}
                </span>
                {/* Dropped, not cut mid-number, when the booking is too narrow. */}
                <span className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums text-foreground/80 @max-[8.75rem]:hidden">
                  – {shortTime(endMin, clock)}
                </span>
                {/* On a doubled booking the status rides on the time line: the
                    later booking covers the rest of the card. */}
                {doubled && statusChip}
              </span>
            )}
            <span className={cn("flex items-baseline gap-1.5 font-semibold min-w-0 text-[13px]", roomy && "mt-0.5")}>
              {!roomy && (
                <span
                  className={cn(
                    "shrink-0 font-extrabold leading-[1.1] tracking-[-0.01em] tabular-nums text-tea-green-100",
                    length <= 15 ? "text-[15px]" : "text-[17px]"
                  )}
                >
                  {shortTime(startMin, clock)}
                </span>
              )}
              {doubled && <TriangleAlert className="h-3.5 w-3.5 shrink-0 self-center text-destructive" aria-hidden="true" />}
              {a.unseen && (
                <span
                  className="shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wide text-white"
                  style={{ background: NEW_BOOKING.chip }}
                >
                  {t("grid.new")}
                </span>
              )}
              <span className="truncate">{clientLabel(a.lead, t)}</span>
            </span>
            {length > 15 && <span className="block truncate text-foreground/80">{a.serviceText}</span>}
            {statusWord && !(doubled && roomy) && statusChip}
            {/* The word where it fits; the red border, the mark and the lane's
                header say it on a narrow lane. */}
            {doubled && length > 45 && (
              <span className="mt-0.5 inline-flex w-fit max-w-full items-center truncate rounded-full bg-red-50 px-1.5 py-px text-[10.5px] font-bold text-red-800 @max-[6.5rem]:hidden">
                {t("grid.doubleBookedTitle")}
              </span>
            )}
            {a.patchTestRequired && (
              <span className="block truncate font-medium text-papaya-whip-100">{t("grid.patchTest")}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
