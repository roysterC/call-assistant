"use client";

/**
 * The diary: one day across every stylist, with a month panel to jump by.
 *
 * Reads the appointments table, which on the salon's own diary (the default)
 * is the whole diary. A salon set to Google Calendar keeps its diary there, and
 * anything entered directly in Google will not appear here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { MonthPanel } from "@/components/calendar/month-panel";
import {
  minutesOfDay,
  salonDate,
  salonDayRange,
} from "@/lib/calendar-layout";
import {
  DayGrid,
  type CalendarAppointment,
  type CalendarStylist,
  type DiaryBlock,
} from "@/components/calendar/day-grid";
import { AppointmentSheet } from "@/components/calendar/appointment-sheet";
import {
  BlockTimeDialog,
  type BlockDialogState,
} from "@/components/calendar/block-time-dialog";
import {
  blockToForm,
  type TimeBlockForm,
  type TimeBlockRecord,
} from "@/lib/time-blocks";
import {
  buildServiceTones,
  familiesInUse,
  FAMILY_HUE,
  FAMILY_LABEL,
} from "@/lib/service-colours";
import {
  NewBookingDialog,
  type BookingSlot,
} from "@/components/calendar/new-booking-dialog";
import {
  parseServices,
  resolveBookedService,
  type SalonService,
} from "@/lib/salon-config";

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

/**
 * The list price of what an appointment was booked as. A desk booking of two
 * services is stored as "Full head colour + Cut and finish", which no single
 * catalogue entry matches, so it is priced as the sum of its parts.
 */
function listPriceFor(
  serviceText: string | undefined,
  services: SalonService[]
): number | null {
  const r = resolveBookedService(serviceText, services);
  return r.ok ? r.service.priceMinor : null;
}

/** A new block's form, starting from a day, a person and a time. An hour long. */
function newBlockForm(
  date: string,
  stylistName: string | null,
  time: string
): TimeBlockForm {
  const [h, m] = time.split(":").map(Number);
  const end = Math.min(h * 60 + m + 60, 23 * 60 + 45);
  const endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  return {
    stylistName,
    label: "",
    allDay: false,
    repeat: "none",
    startDate: date,
    endDate: date,
    startTime: time,
    endTime,
    weekdays: [weekdayOf(date)],
    untilDate: null,
  };
}

export default function CalendarPage() {
  const [timeZone, setTimeZone] = useState(DEFAULT_TZ);
  const [selected, setSelected] = useState(() => dateIn(DEFAULT_TZ));
  const [view, setView] = useState(() => {
    const [y, m] = dateIn(DEFAULT_TZ).split("-").map(Number);
    return { year: y, month: m };
  });

  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [services, setServices] = useState<SalonService[]>([]);
  const [hours, setHours] = useState<BusinessHour[]>([]);
  // On the salon's own diary everyone can be booked; on Google, only
  // stylists with a calendar shared to us.
  const [usesGoogle, setUsesGoogle] = useState(false);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [blocks, setBlocks] = useState<DiaryBlock[]>([]);
  // The stored blocks behind `blocks`, so one can be opened for editing.
  const [blockRecords, setBlockRecords] = useState<Map<string, TimeBlockRecord>>(
    new Map()
  );
  const [blockDialog, setBlockDialog] = useState<BlockDialogState | null>(null);
  const [monthBusy, setMonthBusy] = useState<Set<string>>(new Set());
  const [slot, setSlot] = useState<BookingSlot | null>(null);
  const [openAppointment, setOpenAppointment] =
    useState<CalendarAppointment | null>(null);
  const [loading, setLoading] = useState(true);
  // Until settings arrive we know nothing about the team, and "no stylists
  // configured" would be a false statement rather than an empty one.
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const today = useMemo(() => salonDate(new Date(), timeZone), [timeZone]);

  // Minutes elapsed today, so the grid can grey out time that has gone. Null
  // on any day but today: a past day is wholly past, a future one wholly not.
  const nowMinutes = useMemo(
    () => (selected === today ? minutesOfDay(new Date(), timeZone) : null),
    [selected, today, timeZone]
  );
  const isPastDay = selected < today;

  // Built once per service list rather than per block: the mapping depends on
  // the whole list (a service's step is its position within its family), so
  // it cannot be worked out one appointment at a time.
  const tones = useMemo(() => buildServiceTones(services), [services]);
  const legend = useMemo(() => familiesInUse(services), [services]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/settings");
        const { settings } = await res.json();
        setStylists(settings?.teamMembers ?? []);
        setServices(parseServices(settings?.services));
        setHours(settings?.businessHours ?? []);
        setUsesGoogle(settings?.diaryProvider === "google");
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
      const { from, to } = salonDayRange(selected, timeZone);
      const [res, blockRes] = await Promise.all([
        apiFetch(`/api/appointments?status=all&from=${from}&to=${to}`),
        apiFetch(`/api/time-blocks?from=${from}&to=${to}`),
      ]);
      const data = await res.json();
      setAppointments(data.appointments ?? []);
      const blockData = blockRes.ok ? await blockRes.json() : {};
      setBlocks(blockData.occurrences ?? []);
      setBlockRecords(
        new Map(
          (blockData.blocks ?? []).map(
            (r: TimeBlockRecord & { startsAt: string | null; endsAt: string | null }) => [
              r.id,
              {
                ...r,
                startsAt: r.startsAt ? new Date(r.startsAt) : null,
                endsAt: r.endsAt ? new Date(r.endsAt) : null,
              },
            ]
          )
        )
      );
    } catch {
      setAppointments([]);
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  }, [selected, timeZone]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  // Dots on the month panel. A separate, wider fetch so paging days does not
  // refetch the month, and paging months does not disturb the day.
  const loadMonth = useCallback(async () => {
    const first = `${view.year}-${String(view.month).padStart(2, "0")}-01`;
    const nextMonth =
      view.month === 12
        ? `${view.year + 1}-01-01`
        : `${view.year}-${String(view.month + 1).padStart(2, "0")}-01`;
    try {
      const { from } = salonDayRange(first, timeZone);
      const { from: to } = salonDayRange(nextMonth, timeZone);
      const res = await apiFetch(
        `/api/appointments?status=all&from=${from}&to=${to}`
      );
      const data = await res.json();
      const days = new Set<string>();
      for (const a of data.appointments ?? []) {
        days.add(salonDate(new Date(a.startsAt), timeZone));
      }
      setMonthBusy(days);
    } catch {
      setMonthBusy(new Set());
    }
  }, [view, timeZone]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

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
        bookable: !usesGoogle || Boolean(s.googleCalendarId),
      })),
    [stylists, open, weekday, usesGoogle]
  );

  const jump = (date: string) => {
    setSelected(date);
    const [y, m] = date.split("-").map(Number);
    setView({ year: y, month: m });
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden p-4 md:p-6">
      <div className="shrink-0">
        <PageHeader
          title="Diary"
          description="Every stylist, one day at a time. Click an empty slot to book."
        />
      </div>

      <div className="flex items-center gap-2 px-1 pb-3 shrink-0 flex-wrap">
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
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            setBlockDialog({
              mode: "new",
              initial: newBlockForm(selected, stylists[0]?.name ?? null, "13:00"),
            })
          }
          disabled={stylists.length === 0}
        >
          <Ban className="h-3.5 w-3.5" />
          Block time
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

      <div className="flex gap-4 flex-1 min-h-0 overflow-hidden flex-col-reverse lg:flex-row">
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
            nowMinutes={nowMinutes}
            isPastDay={isPastDay}
            tones={tones}
            onPickSlot={(stylistName, time) =>
              setSlot({ stylistName, time, date: selected })
            }
            onOpenAppointment={setOpenAppointment}
            blocks={blocks}
            onOpenBlock={(b) => {
              const record = blockRecords.get(b.blockId);
              if (!record) return;
              setBlockDialog({
                mode: "edit",
                blockId: b.blockId,
                initial: blockToForm(record, timeZone),
                occurrenceDate: b.date,
              });
            }}
          />
        )}

        <aside className="w-full lg:w-60 shrink-0 overflow-y-auto max-h-[38vh] lg:max-h-none lg:border-l lg:border-border lg:pl-4 flex flex-col gap-5">
          {legend.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Services
              </p>
              <ul className="grid gap-1.5">
                {legend.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0 border"
                      style={{
                        background: `${FAMILY_HUE[f]}2e`,
                        borderColor: `${FAMILY_HUE[f]}b3`,
                      }}
                    />
                    <span className="text-muted-foreground truncate">
                      {FAMILY_LABEL[f]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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

      <AppointmentSheet
        appointment={openAppointment}
        timeZone={timeZone}
        tones={tones}
        listPriceMinor={listPriceFor(openAppointment?.serviceText, services)}
        onClose={() => setOpenAppointment(null)}
        onChanged={() => {
          loadDay();
          loadMonth();
        }}
      />

      <NewBookingDialog
        slot={slot}
        services={services}
        stylists={stylists.map((s) => s.name)}
        timeZone={timeZone}
        dayAppointments={appointments}
        dayBlocks={blocks}
        onClose={() => setSlot(null)}
        onBooked={() => {
          loadDay();
          loadMonth();
        }}
        onBlockInstead={(s) => {
          setSlot(null);
          setBlockDialog({
            mode: "new",
            initial: newBlockForm(s.date, s.stylistName, s.time),
          });
        }}
      />

      <BlockTimeDialog
        state={blockDialog}
        stylists={stylists.map((s) => s.name)}
        timeZone={timeZone}
        onClose={() => setBlockDialog(null)}
        onSaved={loadDay}
      />
    </div>
  );
}
