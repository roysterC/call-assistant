"use client";

/**
 * The diary's week: seven days side by side, each with its bookings in time
 * order (time, client, whose), how many there are and what they come to.
 * Narrowed to one stylist with the chips above it. Clicking a day opens it.
 */

import { useState } from "react";
import { useT } from "@/components/providers/language-provider";
import { INTL_LOCALE, clockTime } from "@/lib/i18n";
import { formatMoneyShort } from "@/lib/money";
import { salonDate } from "@/lib/calendar-layout";
import { initialsFor } from "@/lib/channels";
import { TriangleAlert } from "lucide-react";
import { clientLabel, doubleBookedIds, type CalendarAppointment } from "@/components/calendar/day-grid";
import type { ServiceTone } from "@/lib/service-colours";
import { toneFor } from "@/lib/service-colours";
import { cn } from "@/lib/utils";

const ALL = "";

export function WeekView({
  days,
  selected,
  today,
  appointments,
  stylists,
  tones,
  timeZone,
  closed,
  priceOf,
  onOpenDay,
}: {
  days: string[];
  selected: string;
  today: string;
  appointments: CalendarAppointment[];
  stylists: string[];
  tones: Map<string, ServiceTone>;
  timeZone: string;
  closed: (date: string) => boolean;
  /** What a booking comes to: its own price, else the price list's. */
  priceOf: (a: CalendarAppointment) => number | null;
  onOpenDay: (date: string) => void;
}) {
  const { t, lang, clock } = useT();
  const [who, setWho] = useState(ALL);
  const shown = appointments
    .filter((a) => a.status !== "cancelled" && (who === ALL || a.stylistName.toLowerCase() === who.toLowerCase()))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const byDay = new Map<string, CalendarAppointment[]>();
  for (const a of shown) {
    const d = salonDate(new Date(a.startsAt), timeZone);
    byDay.set(d, [...(byDay.get(d) ?? []), a]);
  }

  // The day view's double-booking flag, on the same bookings.
  const doubled = doubleBookedIds(appointments);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {stylists.length > 1 && (
        <div role="group" aria-label={t("diary.stylist")} className="flex shrink-0 flex-wrap gap-1.5 pb-3">
          {[ALL, ...stylists].map((s) => (
            <button
              key={s || "all"}
              type="button"
              aria-pressed={who === s}
              onClick={() => setWho(s)}
              className={cn(
                "h-8 rounded-full border px-3 text-[13px] font-semibold transition-colors",
                who === s ? "border-foreground bg-foreground text-background" : "border-tea-green-700 bg-card hover:bg-muted"
              )}
            >
              {s || t("diary.everyone")}
            </button>
          ))}
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-2 pb-4">
        {days.map((date) => {
          const list = byDay.get(date) ?? [];
          const shut = closed(date);
          const total = list.reduce((n, a) => n + (a.status === "no_show" ? 0 : priceOf(a) ?? 0), 0);
          return (
            <button
              key={date}
              type="button"
              onClick={() => onOpenDay(date)}
              className={cn(
                "flex min-h-0 min-w-0 flex-col gap-1.5 overflow-hidden rounded-2xl border p-2.5 text-left transition-colors hover:border-tea-green-500",
                date === selected ? "border-foreground" : "border-border",
                shut ? "bg-muted" : "bg-card"
              )}
            >
              <span className="flex items-baseline gap-1.5">
                <span className="text-[13px] font-bold">
                  {new Date(`${date}T12:00:00Z`).toLocaleDateString(INTL_LOCALE[lang], { weekday: "short", timeZone: "UTC" })}
                </span>
                <span className={cn("text-lg font-extrabold tabular-nums", date === today && "text-primary")}>{Number(date.slice(8))}</span>
                {list.length > 0 && (
                  <span className="ml-auto truncate text-[11.5px] text-muted-foreground">
                    {list.length}
                    {total > 0 && ` · ${formatMoneyShort(total)}`}
                  </span>
                )}
              </span>
              {shut && list.length === 0 ? (
                <span className="m-auto text-[13px] text-muted-foreground">{t("diary.closedDay")}</span>
              ) : list.length === 0 ? (
                <span className="m-auto text-[13px] text-muted-foreground">{t("diary.nothingBooked")}</span>
              ) : (
                <span className="flex min-h-0 flex-col gap-1 overflow-y-auto">
                  {list.map((a) => {
                    const tone = toneFor(a.serviceText, tones);
                    return (
                      <span
                        key={a.id}
                        className={cn(
                          "flex flex-col rounded-[10px] border-[1.5px] px-2 py-1.5 text-xs leading-tight",
                          // The day view's marks: a dashed edge for a no-show, a
                          // quieter fill for one that is done, and the word.
                          a.status === "no_show" && "border-dashed",
                          doubled.has(a.id) && "border-2"
                        )}
                        style={{
                          background: a.status === "completed" ? "var(--secondary)" : tone.fill,
                          borderColor: doubled.has(a.id) ? "var(--destructive)" : tone.border,
                        }}
                        title={`${a.serviceText} · ${a.stylistName}`}
                      >
                        <span className="flex items-center gap-1.5">
                          <strong className="tabular-nums">{clockTime(new Date(a.startsAt), clock, timeZone)}</strong>
                          {who === ALL && stylists.length > 1 && (
                            <span className="ml-auto text-[10.5px] font-bold text-muted-foreground">
                              {initialsFor(a.stylistName, a.stylistName)}
                            </span>
                          )}
                        </span>
                        <span className="truncate">{clientLabel(a.lead, t)}</span>
                        {/* The day view's chips, smaller. */}
                        {(a.status === "completed" || a.status === "no_show" || doubled.has(a.id)) && (
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {(a.status === "completed" || a.status === "no_show") && (
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-px text-[10.5px] font-bold",
                                  a.status === "no_show" ? "bg-red-50 text-red-800" : "bg-tea-green-700 text-tea-green-100"
                                )}
                              >
                                {t(a.status === "no_show" ? "grid.noShow" : "grid.done")}
                              </span>
                            )}
                            {doubled.has(a.id) && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-px text-[10.5px] font-bold text-red-800">
                                <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                                {t("grid.doubleBookedTitle")}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
