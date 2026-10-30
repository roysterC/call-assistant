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
  HOUR_HEIGHT_PX,
  ROW_COUNT,
  OVERBOOK_GUTTER_PX,
  SLOT_MINUTES,
  WINDOW_END_HOUR,
  WINDOW_END_MIN,
  WINDOW_START_HOUR,
  WINDOW_START_MIN,
  WINDOW_MINUTES,
  type PlacedBlock,
} from "@/lib/calendar-layout";
import { NEW_BOOKING, toneFor, type ServiceTone } from "@/lib/service-colours";
import { FORMER_STYLIST_COLOUR, stylistInitials } from "@/lib/stylist-colours";
import { useT } from "@/components/providers/language-provider";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { minutesTime, type Clock, type Translate } from "@/lib/i18n";

export interface CalendarAppointment {
  id: string;
  bookingNumber: number | null;
  serviceText: string;
  durationMinutes: number;
  stylistName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  patchTestRequired: boolean;
  amountMinor: number | null;
  clientType: string;
  notes: string | null;
  /** Booked by the receptionist and not yet opened by whoever is looking. */
  unseen?: boolean;
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
const NOW_COLOUR = "#e07b39";

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
  if (merged.length === 0) return "var(--card)";
  const stops: string[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) stops.push(`var(--card) ${at}% ${a}%`);
    stops.push(`transparent ${a}% ${b}%`);
    at = b;
  }
  if (at < 100) stops.push(`var(--card) ${at}% 100%`);
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
        <div key={i} className="flex-1 min-w-0 border-l border-border" />
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

export function DayGrid({
  date,
  timeZone,
  stylists,
  appointments,
  blocks,
  open,
  nowMinutes,
  isPastDay,
  tones,
  onPickSlot,
  onOpenAppointment,
  onOpenBlock,
  onMoveAppointment,
  hourHeightPx = HOUR_HEIGHT_PX,
}: DayGridProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropAt, setDropAt] = useState<{ stylistName: string; row: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Open each day where it is worth looking: today an hour before now, any
  // other day at opening time. Only when the day changes, so the grid never
  // moves under someone reading it.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target =
      nowMinutes !== null ? nowMinutes - 60 : open ? open.openMin - SLOT_MINUTES : WINDOW_START_MIN;
    const y = ((Math.max(target, WINDOW_START_MIN) - WINDOW_START_MIN) / 60) * hourHeightPx;
    el.scrollTop = Math.max(0, y);
    // The day is what decides; now and opening are read as they stand then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  const { t, clock } = useT();
  const marks = hourMarks();
  const lines = quarterMarks();
  const shaded = closedBands(open);
  const nowShown = nowMinutes !== null && nowMinutes >= WINDOW_START_MIN && nowMinutes <= WINDOW_END_MIN;
  /** A clock label the now pill would sit on top of. */
  const nearNow = (min: number) => nowShown && Math.abs(min - nowMinutes!) < 14;

  return (
    <div ref={scroller} className="flex-1 min-w-0 min-h-0 overflow-auto rounded-xl border border-border bg-card shadow-surface">
      {/* min-width keeps columns readable; the container scrolls rather than
          letting four stylists squeeze into thumbnails on a laptop. One
          column (a phone) needs no such help. */}
      <div className={stylists.length > 1 ? "min-w-[560px]" : undefined}>
        <div className="flex sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border">
          <div className="w-16 shrink-0" />
          {stylists.map((s) => (
            <div
              key={s.name}
              className="flex-1 min-w-0 px-2 py-2 border-l border-border flex items-center justify-center gap-2"
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
                        ? t("grid.working")
                        : t("grid.notIn")}
                </div>
              </div>
            </div>
          ))}
        </div>

        <EdgeStrip count={stylists.length} />
        <div
          className="flex relative"
          style={{
            height: `${(WINDOW_END_HOUR - WINDOW_START_HOUR) * hourHeightPx}px`,
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
                  "absolute inset-x-0 pl-1.5 pr-2.5 -translate-y-1/2 text-right text-[15px] font-bold leading-none tabular-nums text-foreground",
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
                    "absolute inset-x-0 pr-2.5 -translate-y-1/2 text-right text-[11px] font-medium leading-none tabular-nums text-tea-green-200",
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
                style={{ top: `${minutePct(nowMinutes!)}%`, background: NOW_COLOUR }}
              >
                {shortTime(nowMinutes!, clock)}
              </div>
            )}
          </div>

          {stylists.map((s) => (
            <StylistColumn
              key={s.name}
              stylist={s}
              timeZone={timeZone}
              open={open}
              shaded={shaded}
              lines={lines}
              nowMinutes={nowMinutes}
              isPastDay={isPastDay}
              tones={tones}
              appointments={appointments.filter(
                (a) =>
                  a.stylistName.toLowerCase() === s.name.toLowerCase() &&
                  // The fetch is bounded to this day, but a block is placed by
                  // its time of day alone — so anything that slipped through
                  // would be drawn here at the right hour on the wrong date.
                  isOnDate(new Date(a.startsAt), date, timeZone)
              )}
              blocks={blocks.filter(
                (b) =>
                  b.stylistName === null ||
                  b.stylistName.toLowerCase() === s.name.toLowerCase()
              )}
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
                  onMoveAppointment(drag.appointment, s.name, timeOfRow(row));
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
        </div>
        <EdgeStrip count={stylists.length} />
      </div>
    </div>
  );
}

/** Where a time of day sits down the grid, as a percentage. */
function minutePct(min: number): number {
  return ((min - WINDOW_START_MIN) / WINDOW_MINUTES) * 100;
}

function StylistColumn({
  stylist,
  timeZone,
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
}: {
  stylist: CalendarStylist;
  timeZone: string;
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
          Math.max(((nowMinutes - WINDOW_START_MIN) / WINDOW_MINUTES) * 100, 0),
          100
        );

  const blockSpans = blocks.flatMap((b) => {
    const g = spanGeometry(new Date(b.start), new Date(b.end), date, timeZone);
    return g ? [{ block: b, ...g }] : [];
  });

  const placed: PlacedBlock<CalendarAppointment>[] = layoutColumn(
    appointments,
    (a) => ({ startsAt: new Date(a.startsAt), endsAt: new Date(a.endsAt) }),
    timeZone
  );

  // Room for another booking: every stretch of half an hour or more, from
  // now (or opening) to closing, around the bookings and blocked time. Read
  // off what is drawn, so a note never sits over a block beside it. Hidden
  // while a booking is being dragged, which has its own outline.
  const toMin = (pct: number) => Math.round(WINDOW_START_MIN + (pct / 100) * WINDOW_MINUTES);
  const gaps =
    bookable && open && !drag
      ? freeGaps(
          [
            ...placed
              .filter((b) => b.item.status !== "cancelled")
              .map((b): [number, number] => [toMin(b.topPct), toMin(b.topPct + b.heightPct)]),
            ...blockSpans.map((g): [number, number] => [toMin(g.topPct), toMin(g.topPct + g.heightPct)]),
          ],
          Math.max(
            open.openMin,
            WINDOW_START_MIN,
            nowMinutes === null ? 0 : Math.ceil(nowMinutes / SLOT_MINUTES) * SLOT_MINUTES
          ),
          Math.min(open.closeMin, WINDOW_END_MIN)
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
    const row = Math.min(Math.max(Math.round((top / box.height) * ROW_COUNT), 0), ROW_COUNT - 1);
    if (nowMinutes !== null && WINDOW_START_MIN + row * SLOT_MINUTES < nowMinutes) return null;
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
    const row = rowFromOffset((clientY - box.top) / box.height);

    // Refuse a time that has already passed. The phone path enforces a lead
    // time through `earliestBookableStart`; the desk had no equivalent, so a
    // click on this morning would happily book into it.
    if (nowMinutes !== null && WINDOW_START_MIN + row * SLOT_MINUTES < nowMinutes) {
      const next = Math.ceil(nowMinutes / SLOT_MINUTES) * SLOT_MINUTES;
      notify(t("grid.refusePast", { time: minutesTime(next, clock) }), "info");
      return;
    }

    onPickSlot(stylist.name, timeOfRow(row));
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
        "flex-1 min-w-0 relative border-l border-border",
        bookable ? "cursor-copy" : "cursor-not-allowed"
      )}
      // Closed hours look like blocked time: either way, nobody can be
      // booked then. Both are holes onto the stripes behind the grid.
      style={{ background: columnBackground([...shaded, ...blockSpans]) }}
    >

      {!stylist.worksToday && (
        <div className="absolute inset-0 bg-muted/50 pointer-events-none" />
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

      {nowMinutes !== null && nowMinutes >= WINDOW_START_MIN && nowMinutes <= WINDOW_END_MIN && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 z-[5] border-t-2 pointer-events-none"
          style={{ top: `${minutePct(nowMinutes)}%`, borderColor: NOW_COLOUR }}
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
          className="pointer-events-none absolute left-0 px-2 pt-1 text-[11.5px] font-medium leading-tight text-tea-green-200"
          style={{ top: `${minutePct(from)}%` }}
        >
          {t("grid.free", { len: lengthLabel(to - from, t) })}
        </span>
      ))}

      {drag && dropRow !== null && (
        <div
          className="absolute inset-x-1 z-10 rounded-md border-2 border-dashed border-foreground/70 bg-foreground/5 pointer-events-none"
          style={{
            top: `${(dropRow / ROW_COUNT) * 100}%`,
            height: `${(drag.appointment.durationMinutes / WINDOW_MINUTES) * 100}%`,
          }}
          aria-hidden="true"
        >
          <span className="block px-1.5 py-0.5 text-[11px] font-medium">
            {timeOfRow(dropRow)}
          </span>
        </div>
      )}

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
            className={cn(
              "absolute rounded-md border border-l-[3px] px-1.5 py-1 text-left overflow-hidden text-foreground",
              "text-[12px] leading-tight shadow-[0_1px_2px_0_rgb(21_27_44/0.06)] transition-shadow hover:shadow-md focus-visible:ring-2",
              // Colour now carries the service, so status needs its own
              // channel rather than competing for the fill.
              a.status === "cancelled" && "opacity-50 line-through",
              a.status === "completed" && "opacity-75",
              a.status === "no_show" && "border-dashed",
              b.clippedStart && "rounded-t-none",
              b.clippedEnd && "rounded-b-none",
              a.unseen && "border-2 border-l-[3px]"
            )}
            style={{
              background: tone.fill,
              borderColor: tone.border,
              top: `${b.topPct}%`,
              height: `${b.heightPct}%`,
              // Every block sits inside the column minus the overbook strip,
              // so there is always bare column left to click on.
              left: `calc((100% - ${OVERBOOK_GUTTER_PX}px) * ${b.lane / b.lanes} + 2px)`,
              width: `calc((100% - ${OVERBOOK_GUTTER_PX}px) / ${b.lanes} - 4px)`,
            }}
          >
            {roomy && (
              <span className="block truncate font-bold tabular-nums">
                {shortTime(startMin, clock)} – {shortTime(endMin, clock)}
              </span>
            )}
            <span className="flex items-center gap-1 font-semibold min-w-0">
              {!roomy && <span className="shrink-0 font-bold tabular-nums">{shortTime(startMin, clock)}</span>}
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
            {length > 15 && <span className="block truncate text-foreground/70">{a.serviceText}</span>}
            {a.patchTestRequired && (
              <span className="block truncate font-medium text-papaya-whip-100">{t("grid.patchTest")}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
