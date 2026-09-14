"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DayHours } from "@/lib/business-hours";

/**
 * Opening hours.
 *
 * These are not decorative: the availability algorithm refuses to offer a slot
 * outside them, and they are rendered into the voice prompt so the agent's
 * spoken hours and the enforced hours come from this one place. Getting a day
 * wrong here means the receptionist offers appointments the salon cannot keep.
 */

// Monday first — Sunday-first is a calendar convention, not how anyone
// describes their working week.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const DEFAULT_OPEN = "09:00";
const DEFAULT_CLOSE = "17:30";

export function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: DayHours[];
  onChange: (next: DayHours[]) => void;
}) {
  function dayOf(day: number): DayHours {
    return (
      value.find((d) => d.day === day) ?? {
        day,
        closed: true,
        open: "",
        close: "",
      }
    );
  }

  function update(day: number, patch: Partial<DayHours>) {
    const existing = dayOf(day);
    const merged = { ...existing, ...patch };
    onChange([...value.filter((d) => d.day !== day), merged].sort((a, b) => a.day - b.day));
  }

  return (
    <div className="space-y-2">
      {DAY_ORDER.map((day) => {
        const d = dayOf(day);
        return (
          <div key={day} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-sm">{DAY_LABELS[day]}</span>

            <button
              type="button"
              onClick={() =>
                update(day, {
                  closed: !d.closed,
                  // Restore sensible times when reopening a day, so the row
                  // does not become two empty boxes that silently fail
                  // validation on save.
                  open: d.closed ? d.open || DEFAULT_OPEN : d.open,
                  close: d.closed ? d.close || DEFAULT_CLOSE : d.close,
                })
              }
              aria-pressed={!d.closed}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors w-16 text-center",
                d.closed
                  ? "bg-muted text-muted-foreground hover:text-foreground"
                  : "bg-emerald-500/15 text-emerald-400"
              )}
            >
              {d.closed ? "Closed" : "Open"}
            </button>

            {d.closed ? (
              <span className="text-xs text-muted-foreground">
                No appointments offered
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={d.open}
                  onChange={(e) => update(day, { open: e.target.value })}
                  className="w-28 h-8"
                  aria-label={`${DAY_LABELS[day]} opening time`}
                />
                <span className="text-muted-foreground text-xs">to</span>
                <Input
                  type="time"
                  value={d.close}
                  onChange={(e) => update(day, { close: e.target.value })}
                  className="w-28 h-8"
                  aria-label={`${DAY_LABELS[day]} closing time`}
                />
                {d.open && d.close && d.open >= d.close && (
                  <span className="text-xs text-red-400">
                    Closing time must be after opening
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground pt-1">
        An appointment has to finish before closing time, so the last slot of
        the day depends on how long the service takes.
      </p>
    </div>
  );
}
