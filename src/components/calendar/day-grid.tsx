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
  layoutColumn,
  rowFromOffset,
  timeOfRow,
  type PlacedBlock,
} from "@/lib/calendar-layout";
import { APPOINTMENT_STATUS } from "@/lib/status-styles";

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
  onPickSlot: (stylistName: string, time: string) => void;
  onOpenAppointment: (appointment: CalendarAppointment) => void;
}

export function DayGrid({
  date,
  timeZone,
  stylists,
  appointments,
  open,
  onPickSlot,
  onOpenAppointment,
}: DayGridProps) {
  const marks = hourMarks();
  const shaded = closedBands(open);

  return (
    <div className="flex-1 min-w-0 overflow-auto">
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

        <div className="flex relative" style={{ height: "calc(13 * 56px)" }}>
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
              date={date}
              timeZone={timeZone}
              shaded={shaded}
              marks={marks}
              appointments={appointments.filter(
                (a) => a.stylistName.toLowerCase() === s.name.toLowerCase()
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
  marks,
  appointments,
  onPickSlot,
  onOpenAppointment,
}: {
  stylist: CalendarStylist;
  date: string;
  timeZone: string;
  shaded: Array<{ topPct: number; heightPct: number }>;
  marks: Array<{ hour: number; topPct: number }>;
  appointments: CalendarAppointment[];
  onPickSlot: (stylistName: string, time: string) => void;
  onOpenAppointment: (appointment: CalendarAppointment) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bookable = stylist.worksToday && stylist.bookable;

  const placed: PlacedBlock<CalendarAppointment>[] = layoutColumn(
    appointments,
    (a) => ({ startsAt: new Date(a.startsAt), endsAt: new Date(a.endsAt) }),
    timeZone
  );

  const pick = (clientY: number) => {
    const el = ref.current;
    if (!el || !bookable) return;
    const box = el.getBoundingClientRect();
    onPickSlot(stylist.name, timeOfRow(rowFromOffset((clientY - box.top) / box.height)));
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

      {marks.map((m) => (
        <div
          key={m.hour}
          className="absolute inset-x-0 border-t border-border/60 pointer-events-none"
          style={{ top: `${m.topPct}%` }}
        />
      ))}

      {placed.map((b) => {
        const a = b.item;
        const tone = APPOINTMENT_STATUS[a.status] ?? APPOINTMENT_STATUS.booked;
        const width = 100 / b.lanes;
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
              "absolute rounded-md border px-1.5 py-1 text-left overflow-hidden",
              "text-[11px] leading-tight transition-shadow hover:shadow-md focus-visible:ring-2",
              tone.className,
              a.status === "cancelled" && "opacity-60 line-through",
              b.clippedStart && "rounded-t-none border-t-dashed",
              b.clippedEnd && "rounded-b-none border-b-dashed"
            )}
            style={{
              top: `${b.topPct}%`,
              height: `${b.heightPct}%`,
              left: `${b.lane * width}%`,
              width: `calc(${width}% - 3px)`,
              marginLeft: "2px",
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
