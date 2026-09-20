"use client";

/**
 * One day, one column per stylist, time running down.
 *
 * Every stylist keeps a column whether or not they are rostered, so the shape
 * of the screen does not change as you page through the week — a column that
 * moves under the cursor is how a busy front desk books the wrong person.
 * A stylist who is not working today is shaded and refuses clicks instead.
 */

import { useRef } from "react";
import { cn } from "@/lib/utils";
import {
  closedBands,
  hourMarks,
  isOnDate,
  layoutColumn,
  rowFromOffset,
  quarterMarks,
  timeOfRow,
  HOUR_HEIGHT_PX,
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
  serviceText: string;
  durationMinutes: number;
  stylistName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  patchTestRequired: boolean;
  amountMinor: number | null;
  lead: { name: string | null; phone: string | null };
}

export interface CalendarStylist {
  name: string;
  worksToday: boolean;
  bookable: boolean;
}

interface DayGridProps {
  date: string;
  timeZone: string;
  stylists: CalendarStylist[];
  appointments: CalendarAppointment[];
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
}

export function DayGrid({
  date,
  timeZone,
  stylists,
  appointments,
  open,
  nowMinutes,
  isPastDay,
  tones,
  onPickSlot,
  onOpenAppointment,
}: DayGridProps) {
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
                {!s.bookable
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
              onPickSlot={onPickSlot}
              onOpenAppointment={onOpenAppointment}
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
  onPickSlot,
  onOpenAppointment,
}: {
  stylist: CalendarStylist;
  timeZone: string;
  shaded: Array<{ topPct: number; heightPct: number }>;
  lines: Array<{ minutes: number; topPct: number; major: boolean; half: boolean }>;
  nowMinutes: number | null;
  isPastDay: boolean;
  tones: Map<string, ServiceTone>;
  appointments: CalendarAppointment[];
  onPickSlot: (stylistName: string, time: string) => void;
  onOpenAppointment: (appointment: CalendarAppointment) => void;
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

      {placed.map((b) => {
        const a = b.item;
        const tone = toneFor(a.serviceText, tones);
        return (
          <button
            key={a.id}
            type="button"
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
