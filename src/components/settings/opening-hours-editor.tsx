"use client";

import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/language-provider";
import type { MessageKey } from "@/lib/i18n";
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

const DEFAULT_OPEN = "09:00";
const DEFAULT_CLOSE = "17:30";

export function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: DayHours[];
  onChange: (next: DayHours[]) => void;
}) {
  const { t } = useT();
  const dayName = (day: number) => t(`day.${day}` as MessageKey);
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
            <span className="w-24 shrink-0 text-sm">{dayName(day)}</span>

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
                  : "bg-tea-green-800 text-tea-green-200"
              )}
            >
              {d.closed ? t("hours.closed") : t("hours.open")}
            </button>

            {d.closed ? (
              <span className="text-xs text-muted-foreground">{t("hours.none")}</span>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={d.open}
                  onChange={(e) => update(day, { open: e.target.value })}
                  className="w-28 h-8"
                  aria-label={t("hours.openingTime", { day: dayName(day) })}
                />
                <span className="text-muted-foreground text-xs">{t("hours.to")}</span>
                <Input
                  type="time"
                  value={d.close}
                  onChange={(e) => update(day, { close: e.target.value })}
                  className="w-28 h-8"
                  aria-label={t("hours.closingTime", { day: dayName(day) })}
                />
                {d.open && d.close && d.open >= d.close && (
                  <span className="text-xs text-red-600">{t("hours.order")}</span>
                )}
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground pt-1">{t("hours.lastSlot")}</p>
    </div>
  );
}
