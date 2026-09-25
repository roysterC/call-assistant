"use client";

/**
 * One day, one column per stylist, time running down.
 *
 * Every stylist keeps a column whether or not they are rostered, so the shape
 * of the screen does not change as you page through the week — a column that
 * moves under the cursor is how a busy front desk books the wrong person.
 * A stylist who is not working today is shaded and refuses clicks instead.
 */

import { useRef, useState } from "react";
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
  timeOfRow,
  HOUR_HEIGHT_PX,
  ROW_COUNT,
  OVERBOOK_GUTTER_PX,
  SLOT_MINUTES,
  WINDOW_END_HOUR,
  WINDOW_START_HOUR,
  WINDOW_START_MIN,
  WINDOW_MINUTES,
  type PlacedBlock,
} from "@/lib/calendar-layout";
import { toneFor, type ServiceTone } from "@/lib/service-colours";

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
  lead: {
    id: string;
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
  };
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
  /** A colleague's column seen by a stylist login: shown, not bookable. */
  readOnly?: boolean;
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
}: DayGridProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropAt, setDropAt] = useState<{ stylistName: string; row: number } | null>(null);
  const marks = hourMarks();
  const lines = quarterMarks();
  const shaded = closedBands(open);

  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-auto rounded-md border border-border">
      {/* min-width keeps columns readable; the container scrolls rather than
          letting four stylists squeeze into thumbnails on a laptop. */}
      <div className="min-w-[560px]">
        <div className="flex sticky top-0 z-20 bg-background border-b border-border">
          <div className="w-14 shrink-0" />
          {stylists.map((s) => (
            <div
              key={s.name}
              className="flex-1 min-w-0 px-2 py-2 text-center border-l border-border"
            >
              <div className="text-sm font-semibold truncate">{s.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {!s.bookable && !s.readOnly
                  ? "no calendar"
                  : s.worksToday
                    ? "working"
                    : "not in"}
              </div>
            </div>
          ))}
        </div>

        <div
          className="flex relative"
          style={{
            height: `${(WINDOW_END_HOUR - WINDOW_START_HOUR) * HOUR_HEIGHT_PX}px`,
          }}
        >
          <div className="w-14 shrink-0 relative">
            {marks.map((m) => (
              <div
                key={m.hour}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
                style={{ top: `${m.topPct}%` }}
              >
                {m.label}
              </div>
            ))}
          </div>

          {stylists.map((s) => (
            <StylistColumn
              key={s.name}
              stylist={s}
              timeZone={timeZone}
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
      </div>
    </div>
  );
}

function StylistColumn({
  stylist,
  timeZone,
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

  const placed: PlacedBlock<CalendarAppointment>[] = layoutColumn(
    appointments,
    (a) => ({ startsAt: new Date(a.startsAt), endsAt: new Date(a.endsAt) }),
    timeZone
  );

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

  const pick = (clientY: number) => {
    const el = ref.current;
    if (!el || !bookable) return;
    const box = el.getBoundingClientRect();
    const row = rowFromOffset((clientY - box.top) / box.height);

    // Refuse a time that has already passed. The phone path enforces a lead
    // time through `earliestBookableStart`; the desk had no equivalent, so a
    // click on this morning would happily book into it.
    if (nowMinutes !== null && WINDOW_START_MIN + row * SLOT_MINUTES < nowMinutes) {
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
    >
      {shaded.map((b, i) => (
        <div
          key={i}
          className="absolute inset-x-0 bg-muted/40 pointer-events-none"
          style={{ top: `${b.topPct}%`, height: `${b.heightPct}%` }}
        />
      ))}

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
            l.major
              ? "border-border"
              : l.half
                ? "border-border/50"
                : "border-border/25"
          )}
          style={{ top: `${l.topPct}%` }}
        />
      ))}

      {/* Blocked time sits under the bookings, so a booking made into a
          block (the desk may) is still there to click. */}
      {blocks.map((b) => {
        const g = spanGeometry(new Date(b.start), new Date(b.end), date, timeZone);
        if (!g) return null;
        return (
          <button
            key={`${b.blockId}-${b.date}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenBlock(b);
            }}
            title={b.stylistName === null ? `${b.label} (everyone)` : b.label}
            className="absolute inset-x-0 overflow-hidden border-y border-border/60 px-1.5 py-1 text-left text-[11px] leading-tight text-muted-foreground hover:text-foreground focus-visible:ring-2"
            style={{
              top: `${g.topPct}%`,
              height: `${g.heightPct}%`,
              backgroundImage:
                "repeating-linear-gradient(135deg, color-mix(in oklab, var(--muted-foreground) 14%, transparent) 0 6px, transparent 6px 12px)",
              backgroundColor: "color-mix(in oklab, var(--muted) 55%, transparent)",
            }}
          >
            <span className="font-medium">{b.label}</span>
          </button>
        );
      })}

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
        const tone = toneFor(a.serviceText, tones);
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
            title={`${a.lead.name ?? "Client"} — ${a.serviceText}`}
            className={cn(
              "absolute rounded-md border px-1.5 py-1 text-left overflow-hidden text-slate-100",
              "text-[11px] leading-tight transition-shadow hover:shadow-md focus-visible:ring-2",
              // Colour now carries the service, so status needs its own
              // channel rather than competing for the fill.
              a.status === "cancelled" && "opacity-50 line-through",
              a.status === "completed" && "opacity-75",
              a.status === "no_show" && "border-dashed",
              b.clippedStart && "rounded-t-none",
              b.clippedEnd && "rounded-b-none"
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
            <span className="block font-semibold truncate">
              {a.lead.name ?? "Client"}
            </span>
            <span className="block truncate opacity-90">{a.serviceText}</span>
            {a.patchTestRequired && (
              <span className="block truncate opacity-90">patch test</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
