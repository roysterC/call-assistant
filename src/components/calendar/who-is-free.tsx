"use client";

/**
 * "Who's free": each of the team, what they are doing now and when they are
 * next free today, for a walk-in at the desk or a call asking to come in now
 * (src/lib/booking/free-now.ts). Choosing a service narrows it to those who
 * do it, with when each could start; Book opens a booking at that time.
 */

import { useCallback, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/language-provider";
import { apiFetch } from "@/lib/api-fetch";
import { clockTime } from "@/lib/i18n";
import type { SalonService } from "@/lib/salon-config";
import { cn } from "@/lib/utils";
import { StylistBadge, type CalendarStylist } from "./day-grid";

interface Stretch {
  start: string;
  end: string;
}

interface Person {
  name: string;
  working: boolean;
  busyNow: { until: string; what: string | null } | null;
  nextFree: Stretch | null;
  canStartAt?: string | null;
}

interface Answer {
  closedToday: boolean;
  closedNow: boolean;
  people: Person[];
  warning?: string;
}

const REFRESH_MS = 60_000;
/** Within this of now counts as "now": times are on the five minutes. */
const NOW_MS = 5 * 60_000;

export function WhoIsFree({
  open,
  onClose,
  services,
  columns,
  timeZone,
  onBook,
}: {
  open: boolean;
  onClose: () => void;
  services: SalonService[];
  /** The diary's columns, for each person's badge. */
  columns: CalendarStylist[];
  timeZone: string;
  /** "HH:MM" today, in the salon's clock. */
  onBook: (stylistName: string, time: string) => void;
}) {
  const { t, clock } = useT();
  const [service, setService] = useState("");
  // With when it was asked, which "now" is measured from.
  const [answer, setAnswer] = useState<(Answer & { at: number }) | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/appointments/free-now${service ? `?service=${encodeURIComponent(service)}` : ""}`);
      if (!res.ok) throw new Error(String(res.status));
      setAnswer({ ...(await res.json()), at: Date.now() });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [service]);

  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, load]);

  const time = (iso: string) => clockTime(new Date(iso), clock, timeZone);
  const wallTime = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const isNow = (iso: string) => new Date(iso).getTime() - (answer?.at ?? 0) <= NOW_MS;
  // Free now: the next five minutes from when Book is pressed, not when the list was loaded.
  const book = (name: string, startAt: string) => {
    const soonest = Math.ceil(Date.now() / NOW_MS) * NOW_MS;
    onBook(name, wallTime(new Date(Math.max(new Date(startAt).getTime(), soonest)).toISOString()));
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto gap-0">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-lg">{t("free.title")}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 p-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">{t("free.for")}</span>
            <select
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                setAnswer(null);
              }}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">{t("free.anyService")}</option>
              {services.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          {failed && !answer && <p className="text-sm text-muted-foreground">{t("free.failed")}</p>}
          {!failed && !answer && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
          {answer?.warning && <p className="text-xs text-papaya-whip-100">{answer.warning}</p>}
          {answer?.closedToday && <p className="text-sm text-muted-foreground">{t("free.closedToday")}</p>}
          {answer && !answer.closedToday && answer.closedNow && (
            <p className="text-sm text-muted-foreground">{t("free.closedNow")}</p>
          )}
          {answer && !answer.closedNow && answer.people.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("free.nobody")}</p>
          )}

          {answer && !answer.closedNow && answer.people.length > 0 && (
            <ul className="divide-y divide-border rounded-xl ring-1 ring-border">
              {answer.people.map((p) => {
                const column = columns.find((c) => c.name.toLowerCase() === p.name.toLowerCase());
                const startAt = service ? p.canStartAt ?? null : p.nextFree?.start ?? null;
                const freeNow = Boolean(startAt && isNow(startAt));
                return (
                  <li key={p.name} className={cn("flex items-start gap-3 px-3 py-3", !p.working && "opacity-60")}>
                    <span className="mt-0.5">
                      <StylistBadge stylist={column ?? { name: p.name, worksToday: p.working, bookable: true }} />
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex items-center gap-2 font-medium">
                        {p.name}
                        {p.working && freeNow && (
                          <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500" />
                        )}
                      </p>
                      {!p.working ? (
                        <p className="text-xs text-muted-foreground">{t("free.notIn")}</p>
                      ) : (
                        <>
                          {p.busyNow && (
                            <p className="text-xs text-muted-foreground">
                              {p.busyNow.what
                                ? t("free.with", { what: p.busyNow.what, time: time(p.busyNow.until) })
                                : t("free.busyUntil", { time: time(p.busyNow.until) })}
                            </p>
                          )}
                          {service ? (
                            <p className={cn("text-xs", startAt ? "text-foreground" : "text-muted-foreground")}>
                              {!startAt
                                ? t("free.noRoom")
                                : freeNow
                                  ? t("free.canStartNow")
                                  : t("free.canStart", { time: time(startAt) })}
                            </p>
                          ) : (
                            <p className={cn("text-xs", p.nextFree ? "text-foreground" : "text-muted-foreground")}>
                              {!p.nextFree
                                ? t("free.bookedUp")
                                : isNow(p.nextFree.start)
                                  ? t("free.freeNow", { time: time(p.nextFree.end) })
                                  : t("free.nextFree", { from: time(p.nextFree.start), to: time(p.nextFree.end) })}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    {p.working && startAt && (
                      <Button type="button" size="sm" variant={freeNow ? "default" : "outline"} onClick={() => book(p.name, startAt)}>
                        {t("free.book")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">{t("free.hint")}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
