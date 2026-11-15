"use client";

/**
 * The week the diary is on, as seven equal days under the date: the day's
 * name, its number, and a dot when anything is booked. The day showing is
 * dark; a day the salon is closed is faded. The same on a phone (short
 * names) and a wide screen (full names, with arrows to move a week).
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/components/providers/language-provider";
import { INTL_LOCALE } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function weekOf(date: string): string[] {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  // Monday first, as the month panel.
  const back = (at.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, d - back + i)).toISOString().slice(0, 10));
}

export function WeekStrip({
  selected,
  today,
  busy,
  closed,
  onSelect,
  onShiftWeek,
  long = false,
}: {
  selected: string;
  today: string;
  /** Days with something booked. */
  busy: Set<string>;
  /** Days the salon is shut. */
  closed: (date: string) => boolean;
  onSelect: (date: string) => void;
  /** A week back or on (−7 or 7); a wide screen shows arrows for it. */
  onShiftWeek?: (days: number) => void;
  long?: boolean;
}) {
  const { t, lang } = useT();
  const days = weekOf(selected);
  const name = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(INTL_LOCALE[lang], { weekday: long ? "long" : "short", timeZone: "UTC" });

  return (
    <div className="flex items-stretch gap-1.5">
      {onShiftWeek && (
        <button
          type="button"
          onClick={() => onShiftWeek(-7)}
          aria-label={t("diary.prevWeek")}
          className="flex w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      <div role="tablist" aria-label={t("diary.thisWeek")} className="grid flex-1 grid-cols-7 gap-1 md:gap-1.5">
        {days.map((date) => {
          const on = date === selected;
          const shut = closed(date);
          return (
            <button
              key={date}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={new Date(`${date}T12:00:00Z`).toLocaleDateString(INTL_LOCALE[lang], {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              })}
              onClick={() => onSelect(date)}
              className={cn(
                "flex h-[52px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors",
                on ? "bg-foreground text-background" : "bg-card text-foreground hover:bg-muted",
                shut && !on && "opacity-50",
                date === today && !on && "ring-1 ring-inset ring-tea-green-600"
              )}
            >
              <span className="max-w-full truncate px-1 text-[11px] font-semibold opacity-80 md:text-xs">{name(date)}</span>
              <span className="text-[17px] font-extrabold leading-none tabular-nums">{Number(date.slice(8))}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "h-[5px] w-[5px] rounded-full",
                  busy.has(date) ? (on ? "bg-tea-green-800" : "bg-tea-green-400") : "bg-transparent"
                )}
              />
            </button>
          );
        })}
      </div>
      {onShiftWeek && (
        <button
          type="button"
          onClick={() => onShiftWeek(7)}
          aria-label={t("diary.nextWeek")}
          className="flex w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
