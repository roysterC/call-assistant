"use client";

/**
 * The diary: one day across every stylist, with a month panel to jump by.
 *
 * Reads the appointments table only. Google Calendar remains the diary the
 * booking engine checks, so anything entered directly in Google will not
 * appear here — overlaying those events is a later change, and until then
 * this screen shows what came through the system, not everything that exists.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { MonthPanel } from "@/components/calendar/month-panel";
import {
  DayGrid,
  type CalendarAppointment,
  type CalendarStylist,
} from "@/components/calendar/day-grid";
import {
  NewBookingDialog,
  type BookingSlot,
  type ServiceOption,
} from "@/components/calendar/new-booking-dialog";

interface Stylist {
  name: string;
  workingDays?: number[];
  googleCalendarId?: string;
}

interface BusinessHour {
  day: number;
  closed?: boolean;
  open?: string;
  close?: string;
}

const DEFAULT_TZ = "Europe/London";

/** "YYYY-MM-DD" for an instant, as observed in `tz`. */
function dateIn(tz: string, at = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return p;
}

/** 0=Sunday, matching the weekday numbering used in settings. */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function hhmmToMin(v: string | undefined): number | null {
  if (!v) return null;
  const [h, m] = v.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

export default function CalendarPage() {
  const [timeZone, setTimeZone] = useState(DEFAULT_TZ);
  const [selected, setSelected] = useState(() => dateIn(DEFAULT_TZ));
  const [view, setView] = useState(() => {
    const [y, m] = dateIn(DEFAULT_TZ).split("-").map(Number);
    return { year: y, month: m };
  });

  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [monthBusy, setMonthBusy] = useState<Set<string>>(new Set());
  const [slot, setSlot] = useState<BookingSlot | null>(null);
  const [loading, setLoading] = useState(true);
  // Until settings arrive we know nothing about the team, and "no stylists
  // configured" would be a false statement rather than an empty one.
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const today = useMemo(() => dateIn(timeZone), [timeZone]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/settings");
        const { settings } = await res.json();
        setStylists(settings?.teamMembers ?? []);
        setServices(settings?.services ?? []);
        setHours(settings?.businessHours ?? []);
        // Column is `timezone`; SalonConfig renames it to `timeZone` but the
        // settings endpoint returns the row as stored.
        if (settings?.timezone) setTimeZone(settings.timezone);
      } catch {
        // Leave the defaults; the grid still renders and says nothing false.
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, []);

  const loadDay = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/appointments?status=all&from=${selected}T00:00:00.000Z&to=${shiftDate(
          selected,
          1
        )}T00:00:00.000Z`
      );
      const data = await res.json();
      setAppointments(data.appointments ?? []);
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  // Dots on the month panel. A separate, wider fetch so paging days does not
  // refetch the month, and paging months does not disturb the day.
  useEffect(() => {
    (async () => {
      const first = `${view.year}-${String(view.month).padStart(2, "0")}-01`;
      const nextMonth =
        view.month === 12
          ? `${view.year + 1}-01-01`
          : `${view.year}-${String(view.month + 1).padStart(2, "0")}-01`;
      try {
        const res = await apiFetch(
          `/api/appointments?status=all&from=${first}T00:00:00.000Z&to=${nextMonth}T00:00:00.000Z`
        );
        const data = await res.json();
        const days = new Set<string>();
        for (const a of data.appointments ?? []) {
          days.add(dateIn(timeZone, new Date(a.startsAt)));
        }
        setMonthBusy(days);
      } catch {
        setMonthBusy(new Set());
      }
    })();
  }, [view, timeZone]);

  const weekday = weekdayOf(selected);

  const open = useMemo(() => {
    const row = hours.find((h) => h.day === weekday);
    if (!row || row.closed) return null;
    const openMin = hhmmToMin(row.open);
    const closeMin = hhmmToMin(row.close);
    if (openMin === null || closeMin === null) return null;
    return { openMin, closeMin };
  }, [hours, weekday]);

  const columns: CalendarStylist[] = useMemo(
    () =>
      stylists.map((s) => ({
        name: s.name,
        // An empty list means "any day the salon is open", the same rule the
        // booking engine applies.
        worksToday:
          Boolean(open) &&
          ((s.workingDays?.length ?? 0) === 0 ||
            (s.workingDays ?? []).includes(weekday)),
        bookable: Boolean(s.googleCalendarId),
      })),
    [stylists, open, weekday]
  );

  const jump = (date: string) => {
    setSelected(date);
    const [y, m] = date.split("-").map(Number);
    setView({ year: y, month: m });
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Diary"
        description="Every stylist, one day at a time. Click an empty slot to book."
      />

      <div className="flex items-center gap-2 px-1 pb-3">
        <Button variant="outline" size="sm" onClick={() => jump(shiftDate(selected, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => jump(shiftDate(selected, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => jump(today)}
          disabled={selected === today}
        >
          Today
        </Button>
        <div className="ml-2 min-w-0">
          <span className="text-sm font-semibold">{prettyDate(selected)}</span>
          {settingsLoaded && !open && (
            <span className="ml-2 text-xs text-muted-foreground">closed</span>
          )}
          {loading && (
            <span className="ml-2 text-xs text-muted-foreground">loading…</span>
          )}
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0 flex-col-reverse lg:flex-row">
        {!settingsLoaded ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground py-16">
            Loading the diary…
          </div>
        ) : columns.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground gap-2 py-16">
            <CalendarDays className="h-4 w-4" />
            No stylists configured yet — add your team in Settings.
          </div>
        ) : (
          <DayGrid
            date={selected}
            timeZone={timeZone}
            stylists={columns}
            appointments={appointments}
            open={open}
            onPickSlot={(stylistName, time) =>
              setSlot({ stylistName, time, date: selected })
            }
            onOpenAppointment={(a) => {
              window.location.href = `/appointments?focus=${a.id}`;
            }}
          />
        )}

        <aside className="w-full lg:w-60 shrink-0 lg:border-l lg:border-border lg:pl-4">
          <MonthPanel
            selected={selected}
            today={today}
            viewYear={view.year}
            viewMonth={view.month}
            onViewChange={(year, month) => setView({ year, month })}
            onSelect={jump}
            busyDates={monthBusy}
          />
        </aside>
      </div>

      <NewBookingDialog
        slot={slot}
        services={services}
        timeZone={timeZone}
        onClose={() => setSlot(null)}
        onBooked={loadDay}
      />
    </div>
  );
}
