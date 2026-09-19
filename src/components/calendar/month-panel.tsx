"use client";

/**
 * Month grid for jumping to a date, plus the twelve months of the year.
 *
 * Built by hand rather than pulled in: the only interaction needed is "take
 * me to that day", and a date-picker library brings a popover, a range mode
 * and an input parser that this screen never opens.
 */

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Parse "YYYY-MM-DD" into its parts without letting the host zone shift it. */
function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { year: y, month: m, day: d };
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Monday-first index of the 1st, matching how a UK rota is read. */
function leadingBlanks(year: number, month: number) {
  const jsDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun
  return (jsDay + 6) % 7;
}

interface MonthPanelProps {
  /** Currently shown day, "YYYY-MM-DD". */
  selected: string;
  /** Today in the salon's zone, so "today" is the salon's today. */
  today: string;
  /** Month being browsed, which need not contain the selection. */
  viewYear: number;
  viewMonth: number;
  onViewChange: (year: number, month: number) => void;
  onSelect: (date: string) => void;
  /** Days with at least one booking, for the dot marker. */
  busyDates?: Set<string>;
}

export function MonthPanel({
  selected,
  today,
  viewYear,
  viewMonth,
  onViewChange,
  onSelect,
  busyDates,
}: MonthPanelProps) {
  const grid = useMemo(() => {
    const blanks = leadingBlanks(viewYear, viewMonth);
    const total = daysInMonth(viewYear, viewMonth);
    const cells: Array<number | null> = Array(blanks).fill(null);
    for (let d = 1; d <= total; d++) cells.push(d);
    return cells;
  }, [viewYear, viewMonth]);

  const step = (delta: number) => {
    const m = viewMonth + delta;
    if (m < 1) onViewChange(viewYear - 1, 12);
    else if (m > 12) onViewChange(viewYear + 1, 1);
    else onViewChange(viewYear, m);
  };

  const sel = parts(selected);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous month"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">
            {MONTH_SHORT[viewMonth - 1]} {viewYear}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next month"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-px text-center">
          {DAY_INITIALS.map((d, i) => (
            <div
              key={i}
              className="text-[10px] uppercase tracking-wide text-muted-foreground py-1"
            >
              {d}
            </div>
          ))}

          {grid.map((day, i) => {
            if (day === null) return <div key={`b${i}`} />;
            const date = iso(viewYear, viewMonth, day);
            const isSelected = date === selected;
            const isToday = date === today;
            const busy = busyDates?.has(date);

            return (
              <button
                key={date}
                type="button"
                onClick={() => onSelect(date)}
                aria-current={isSelected ? "date" : undefined}
                className={cn(
                  "relative aspect-square flex items-center justify-center rounded-md text-xs tabular-nums transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground font-semibold"
                    : isToday
                      ? "text-foreground font-semibold ring-1 ring-inset ring-border"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {day}
                {busy && !isSelected && (
                  <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => onViewChange(viewYear - 1, viewMonth)}
            aria-label="Previous year"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">{viewYear}</span>
          <button
            type="button"
            onClick={() => onViewChange(viewYear + 1, viewMonth)}
            aria-label="Next year"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {MONTH_SHORT.map((label, i) => {
            const m = i + 1;
            const isViewing = m === viewMonth;
            const holdsSelection = sel.year === viewYear && sel.month === m;
            return (
              <button
                key={label}
                type="button"
                onClick={() => onViewChange(viewYear, m)}
                className={cn(
                  "py-1.5 rounded-md text-xs transition-colors",
                  isViewing
                    ? "bg-accent text-foreground font-semibold"
                    : holdsSelection
                      ? "text-foreground ring-1 ring-inset ring-border"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
