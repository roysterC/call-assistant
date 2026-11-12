"use client";

/**
 * Step two of a desk booking: what, when, and what it costs. Also the form
 * for changing a booking.
 *
 * Laid out as the desk works through it: who (with their notes), when (date,
 * time and who they are with, each a tap away, and whether it fits before
 * the next booking), then the services as cards to tick, with the total and
 * the Book button always in view at the foot.
 *
 * Several services make one appointment — a colour and a cut are booked back
 * to back in one slot, timed and priced as the sum of their parts, exactly as
 * the phone assistant books them (combineServices). The length stays
 * changeable because the person at the desk can see the client's hair and the
 * catalogue cannot; the cost is the list price, and what was actually taken
 * is recorded when the appointment is marked done.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Minus, Plus, Search, StickyNote, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { combineServices, splitServiceText, type SalonService } from "@/lib/salon-config";
import { classifyService, type ServiceFamily } from "@/lib/service-colours";
import { formatMoney } from "@/lib/money";
import { speakablePhone } from "@/lib/phone";
import { wallTimeToUtc } from "@/lib/calendar-layout";
import { minutesTime } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DialogTitle } from "@/components/ui/dialog";
import { ClientAvatar, ClientLink, CloseButton, DuplicateFlag, type ClientRow } from "./client-picker";
import type { CalendarAppointment, DiaryBlock } from "./day-grid";
import { useT } from "@/components/providers/language-provider";
import { useMe } from "@/components/providers/me-provider";

export interface BookingDraft {
  date: string;
  time: string;
  stylistName: string;
  serviceNames: string[];
  durationMinutes: number;
  notes: string;
  walkInName: string;
  notifyClient: boolean;
}

export interface EditingBooking {
  appointmentId: string;
  lockWhen: boolean;
}

interface BookingDetailsProps {
  client: ClientRow | null;
  services: SalonService[];
  stylists: string[];
  timeZone: string;
  dayAppointments: CalendarAppointment[];
  dayBlocks: DiaryBlock[];
  dayShown: string;
  initial: {
    date: string;
    time: string;
    stylistName: string;
    serviceNames?: string[];
    minutes?: number;
    notes?: string | null;
  };
  editing?: EditingBooking;
  saving: boolean;
  error: string | null;
  /** Over the client's name: "New booking · step 2 of 2", "Change booking #1042". */
  kicker: string;
  /** Back to choosing the client. */
  onBack: () => void;
  onClose: () => void;
  onSubmit: (draft: BookingDraft) => void;
}

const FAMILY_ORDER: ServiceFamily[] = ["cutting", "colour", "finishing", "treatment", "other"];

/** Every quarter hour of a working day, and the time already set if it falls between. */
function timeOptions(current: string): string[] {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 22 * 60; m += 15) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  if (current && !out.includes(current)) out.push(current);
  return out.sort();
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** The service names a client has booked most often, if all are still on the menu. */
function usualServices(history: { serviceText: string; status: string }[], services: SalonService[]): string[] {
  const counts = new Map<string, number>();
  for (const a of history) {
    if (a.status !== "completed" && a.status !== "booked") continue;
    counts.set(a.serviceText, (counts.get(a.serviceText) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return [];
  const names = splitServiceText(best[0]);
  const known = names
    .map((n) => services.find((s) => s.name.toLowerCase() === n.toLowerCase())?.name)
    .filter((n): n is string => Boolean(n));
  return known.length === names.length ? known : [];
}

export function BookingDetails({
  client,
  services,
  stylists,
  timeZone,
  dayAppointments,
  dayBlocks,
  dayShown,
  initial,
  editing,
  saving,
  error,
  kicker,
  onBack,
  onClose,
  onSubmit,
}: BookingDetailsProps) {
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [stylistName, setStylistName] = useState(initial.stylistName);
  const [picked, setPicked] = useState<string[]>(() =>
    (initial.serviceNames ?? []).filter((n) => services.some((s) => s.name === n))
  );
  const [minutesOverride, setMinutesOverride] = useState(() => {
    if (!initial.minutes || !initial.serviceNames?.length) return "";
    const listed = initial.serviceNames
      .map((n) => services.find((s) => s.name === n))
      .filter((s): s is SalonService => Boolean(s));
    const natural = listed.length ? combineServices(listed).durationMinutes : 0;
    return natural === initial.minutes ? "" : String(initial.minutes);
  });
  const [lengthOpen, setLengthOpen] = useState(() => minutesOverride !== "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(initial.notes));
  const [walkInName, setWalkInName] = useState("");
  const [notifyClient, setNotifyClient] = useState(true);
  const [family, setFamily] = useState<ServiceFamily | "all">("all");
  const [serviceQuery, setServiceQuery] = useState("");
  const [history, setHistory] = useState<{ serviceText: string; status: string }[]>([]);
  const dateRef = useRef<HTMLInputElement>(null);
  const { t, locale, clock } = useT();
  const locked = Boolean(editing?.lockWhen);
  const whenChanged =
    date !== initial.date || time !== initial.time || stylistName !== initial.stylistName;

  // What a returning client usually has, from their bookings, offered as one tap.
  const clientId = client && client.visits > 0 && !editing ? client.id : null;
  useEffect(() => {
    if (!clientId) return;
    let live = true;
    apiFetch(`/api/clients/${encodeURIComponent(clientId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && Array.isArray(d?.appointments)) setHistory(d.appointments);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clientId]);
  const usual = useMemo(() => (clientId ? usualServices(history, services) : []), [clientId, history, services]);

  const chosen = useMemo(
    () =>
      picked
        .map((name) => services.find((s) => s.name === name))
        .filter((s): s is SalonService => Boolean(s)),
    [picked, services]
  );
  const combined = chosen.length ? combineServices(chosen) : null;
  const minutes =
    Number(minutesOverride) > 0
      ? Math.round(Number(minutesOverride))
      : (combined?.durationMinutes ?? 0);

  const isNew = !client || client.visits === 0;
  const patchTest = Boolean(combined?.requiresPatchTest) && isNew && !client?.patchTestAt;
  const clock12 = (hhmm: string) => minutesTime(toMinutes(hhmm), clock);
  const endTime = minutes && time ? minutesTime(toMinutes(time) + minutes, clock) : null;

  const busy = (a: CalendarAppointment) =>
    a.stylistName.toLowerCase() === stylistName.toLowerCase() &&
    a.id !== editing?.appointmentId &&
    a.status !== "cancelled" &&
    a.status !== "no_show";

  // Only checkable on the day the diary has loaded.
  const onShownDay = date === dayShown && Boolean(time);
  const startAt = onShownDay ? wallTimeToUtc(date, time, timeZone).getTime() : 0;
  const endAt = startAt + minutes * 60_000;

  const clash =
    onShownDay && minutes
      ? (dayAppointments.find(
          (a) => busy(a) && new Date(a.startsAt).getTime() < endAt && new Date(a.endsAt).getTime() > startAt
        ) ?? null)
      : null;

  const blocked =
    onShownDay && minutes
      ? (dayBlocks.find(
          (b) =>
            (b.stylistName === null || b.stylistName.toLowerCase() === stylistName.toLowerCase()) &&
            new Date(b.start).getTime() < endAt &&
            new Date(b.end).getTime() > startAt
        ) ?? null)
      : null;

  // When the next booking or blocked time for them starts, to say whether it fits.
  const freeUntil = (() => {
    if (!onShownDay) return null;
    const starts = [
      ...dayAppointments.filter(busy).map((a) => new Date(a.startsAt).getTime()),
      ...dayBlocks
        .filter((b) => b.stylistName === null || b.stylistName.toLowerCase() === stylistName.toLowerCase())
        .map((b) => new Date(b.start).getTime()),
    ].filter((s) => s > startAt);
    if (!starts.length) return null;
    const next = new Date(Math.min(...starts));
    const hh = next.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    return minutesTime(toMinutes(hh), clock);
  })();

  const fit: { text: string; warn: boolean } | null = clash
    ? {
        text: t("form.overlaps", {
          client: clash.lead.name ?? t("form.anotherBooking"),
          service: clash.serviceText,
          stylist: clash.stylistName,
        }),
        warn: true,
      }
    : minutes && endTime && freeUntil
      ? { text: t("form.fitsBefore", { from: clock12(time), to: endTime, time: freeUntil }), warn: false }
      : minutes && endTime
        ? { text: t("form.timeRange", { from: clock12(time), to: endTime }), warn: false }
        : freeUntil
          ? { text: t("form.freeUntil", { time: freeUntil }), warn: false }
          : null;

  const canBook = chosen.length > 0 && minutes > 0 && Boolean(date && time && stylistName);
  const toggle = (name: string) =>
    setPicked((ps) => (ps.includes(name) ? ps.filter((p) => p !== name) : [...ps, name]));

  // The diary's service families are read from hair words ("cut", "colour",
  // "blow dry"), so they only sort a hair salon's or a barber's menu; a nail
  // salon's "BIAB new set" would land under Finishing.
  const businessType = useMe()?.businessType;
  const families =
    businessType === "hair" || businessType === "barber"
      ? FAMILY_ORDER.filter((f) => services.some((s) => classifyService(s.name, s.requiresPatchTest) === f))
      : [];
  const query = serviceQuery.trim().toLowerCase();
  const shown = services.filter(
    (s) =>
      (family === "all" || classifyService(s.name, s.requiresPatchTest) === family) &&
      (!query || s.name.toLowerCase().includes(query))
  );
  const showUsual = usual.length > 0 && !usual.every((n) => picked.includes(n));
  const usualPrice = (() => {
    const parts = usual.map((n) => services.find((s) => s.name === n)).filter((s): s is SalonService => Boolean(s));
    return parts.length ? combineServices(parts) : null;
  })();

  const dateText = date
    ? wallTimeToUtc(date, "12:00", timeZone).toLocaleDateString(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone,
      })
    : t("form.choose");

  const fieldCard =
    "relative flex h-[58px] flex-col justify-center gap-0.5 rounded-[14px] border-[1.5px] border-tea-green-700 bg-card px-3.5 text-left focus-within:border-tea-green-300 focus-within:ring-3 focus-within:ring-tea-green-800 hover:border-tea-green-500";
  const overlay = "absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed";

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canBook || saving) return;
        onSubmit({
          date,
          time,
          stylistName,
          serviceNames: chosen.map((s) => s.name),
          durationMinutes: minutes,
          notes,
          walkInName,
          notifyClient: Boolean(editing) && whenChanged && notifyClient,
        });
      }}
    >
      {/* Who */}
      <div className="flex shrink-0 items-center gap-3 border-b border-tea-green-800 px-6 py-4 max-md:px-4">
        {!editing && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("form.backToClients")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tea-green-900 hover:bg-tea-green-800"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <ClientAvatar name={client?.name ?? null} regular={!isNew} className="h-11 w-11 max-md:hidden" />
        <div className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-bold uppercase tracking-[0.07em] text-tea-green-200">{kicker}</span>
          {client ? (
            <>
              <DialogTitle className="truncate text-base font-bold">
                {client.name ?? t("form.unnamedClient")}
                <DuplicateFlag client={client} className="ml-2" />
              </DialogTitle>
              <p className="truncate text-[13px] tabular-nums text-muted-foreground">
                {[client.phone && speakablePhone(client.phone), client.email].filter(Boolean).join(" · ") ||
                  (client.contactLead ? "" : t("form.noContact"))}
              </p>
              <ClientLink client={client} />
            </>
          ) : (
            <>
              <DialogTitle className="sr-only">{t("form.walkIn")}</DialogTitle>
              <label className="mt-0.5 block">
                <span className="sr-only">{t("form.walkInName")}</span>
                <input
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder={t("form.walkInName")}
                  className="h-9 w-full rounded-[10px] border-[1.5px] border-tea-green-500 bg-card px-3 text-[15px] focus:border-tea-green-300 focus:outline-none focus:ring-3 focus:ring-tea-green-800"
                />
              </label>
            </>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold max-md:hidden",
            isNew ? "bg-papaya-whip-600 text-light-bronze-200" : "bg-tea-green-800 text-tea-green-100"
          )}
        >
          {!client
            ? t("form.walkIn")
            : isNew
              ? t("form.newClient")
              : t(client.visits === 1 ? "form.returningOne" : "form.returningMany", { n: client.visits })}
        </span>
        {editing && (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-[10px] border-[1.5px] border-tea-green-700 px-3 py-1.5 text-[13px] font-semibold hover:bg-tea-green-900"
          >
            {t("form.change")}
          </button>
        )}
        <CloseButton onClose={onClose} />
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-6 py-5 max-md:px-4">
        {client?.notes && (
          <p className="flex items-start gap-2.5 whitespace-pre-line rounded-[14px] border border-papaya-whip-400 bg-cornsilk-700 px-3.5 py-2.5 text-[13.5px] leading-normal">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-light-bronze-300" aria-hidden="true" />
            {client.notes}
          </p>
        )}

        {/* When */}
        <section className="grid gap-2">
          <h3 className="text-[13px] font-bold">{t("form.when")}</h3>
          {locked && <p className="text-xs text-muted-foreground">{t("form.locked")}</p>}
          <div className="grid grid-cols-3 gap-2 max-md:grid-cols-1">
            <label className={fieldCard}>
              <span className="text-[11.5px] font-semibold text-muted-foreground">{t("form.date")}</span>
              <span className="flex items-center justify-between text-[15px] font-bold">
                {dateText}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </span>
              <input
                ref={dateRef}
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                onClick={() => {
                  try {
                    dateRef.current?.showPicker();
                  } catch {
                    // Older browsers open it themselves on a tap.
                  }
                }}
                disabled={locked}
                required
                aria-label={t("form.date")}
                className={overlay}
              />
            </label>
            <label className={fieldCard}>
              <span className="text-[11.5px] font-semibold text-muted-foreground">{t("form.time")}</span>
              <span className="flex items-center justify-between text-[15px] font-bold tabular-nums">
                {time ? clock12(time) : t("form.choose")}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </span>
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={locked}
                aria-label={t("form.time")}
                className={overlay}
              >
                {timeOptions(time).map((o) => (
                  <option key={o} value={o}>
                    {clock12(o)}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldCard}>
              <span className="text-[11.5px] font-semibold text-muted-foreground">{t("form.stylist")}</span>
              <span className="flex items-center justify-between gap-2 text-[15px] font-bold">
                <span className="truncate">{stylistName || t("form.choose")}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </span>
              <select
                value={stylistName}
                onChange={(e) => setStylistName(e.target.value)}
                disabled={locked}
                aria-label={t("form.stylist")}
                className={overlay}
              >
                {!stylists.includes(stylistName) && <option value={stylistName}>{stylistName || t("form.choose")}</option>}
                {stylists.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {fit && (
            <p
              className={cn(
                "flex items-center gap-2 text-[13px] font-semibold",
                fit.warn ? "text-light-bronze-300" : "text-tea-green-200"
              )}
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", fit.warn ? "bg-amber-600" : "bg-tea-green-300")} />
              {fit.text}
            </p>
          )}
        </section>

        {showUsual && (
          <div className="flex items-center gap-3 rounded-[14px] bg-tea-green-900 px-3.5 py-3">
            <span className="min-w-0 flex-1 text-[13.5px]">
              <strong>{t("form.usually", { services: usual.join(" + ") })}</strong>
              {usualPrice && (
                <span className="text-muted-foreground">
                  {" "}
                  · {t("form.minShort", { n: usualPrice.durationMinutes })}
                  {usualPrice.priceMinor !== null && ` · ${formatMoney(usualPrice.priceMinor)}`}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setPicked((ps) => [...ps, ...usual.filter((n) => !ps.includes(n))])}
              className="h-9 shrink-0 rounded-[10px] bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground hover:bg-tea-green-100"
            >
              {t("form.addIt")}
            </button>
          </div>
        )}

        {/* Services */}
        <section className="grid gap-2.5">
          <h3 className="text-[13px] font-bold">{t("form.services")}</h3>
          {(families.length > 1 || services.length > 10) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {families.length > 1 &&
                (["all", ...families] as const).map((f) => {
                  const on = family === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFamily(f)}
                      aria-pressed={on}
                      className={cn(
                        "h-[34px] rounded-full border-[1.5px] px-3.5 text-[13px] font-semibold",
                        on ? "border-foreground bg-foreground text-background" : "border-tea-green-700 bg-card hover:bg-tea-green-900"
                      )}
                    >
                      {f === "all" ? t("form.allServices") : t(`family.${f}`)}
                    </button>
                  );
                })}
              {services.length > 10 && (
                <label className="relative ml-auto block w-48 max-md:ml-0 max-md:w-full">
                  <span className="sr-only">{t("form.findService")}</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={serviceQuery}
                    onChange={(e) => setServiceQuery(e.target.value)}
                    placeholder={t("form.findService")}
                    className="h-[34px] w-full rounded-full border-[1.5px] border-tea-green-700 bg-card pl-9 pr-3 text-[13px] focus:border-tea-green-300 focus:outline-none"
                  />
                </label>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
            {shown.map((s) => {
              const on = picked.includes(s.name);
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => toggle(s.name)}
                  aria-pressed={on}
                  className={cn(
                    "flex min-h-[60px] items-center gap-2.5 rounded-[14px] border-[1.5px] px-3 py-2.5 text-left",
                    on ? "border-primary bg-tea-green-900" : "border-tea-green-700 bg-card hover:border-tea-green-500"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-tea-green-500 bg-card text-transparent"
                    )}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12 5 5L20 7" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{s.name}</span>
                    <span className="block text-[12.5px] text-muted-foreground">{t("form.minShort", { n: s.durationMinutes })}</span>
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums">
                    {s.priceMinor === null ? <span className="font-normal text-muted-foreground">{t("form.noPrice")}</span> : formatMoney(s.priceMinor)}
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <p className="col-span-full py-3 text-sm text-muted-foreground">{t("form.noServiceMatch", { q: serviceQuery.trim() })}</p>
            )}
          </div>
        </section>

        {/* Length: from the services, changed when the desk knows better. */}
        {minutes > 0 &&
          (lengthOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">{t("form.lengthLabel")}</span>
              <button
                type="button"
                aria-label={t("form.shorter")}
                disabled={locked || minutes <= 15}
                onClick={() => setMinutesOverride(String(Math.max(15, minutes - 15)))}
                className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[1.5px] border-tea-green-700 hover:bg-tea-green-900 disabled:opacity-50"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                inputMode="numeric"
                aria-label={t("form.lengthLabel")}
                value={minutesOverride || String(minutes)}
                onChange={(e) => setMinutesOverride(e.target.value)}
                disabled={locked}
                className="h-9 w-16 rounded-[10px] border-[1.5px] border-tea-green-700 bg-card text-center text-sm font-semibold tabular-nums focus:border-tea-green-300 focus:outline-none"
              />
              <button
                type="button"
                aria-label={t("form.longer")}
                disabled={locked}
                onClick={() => setMinutesOverride(String(minutes + 15))}
                className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[1.5px] border-tea-green-700 hover:bg-tea-green-900 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ) : (
            !locked && (
              <button
                type="button"
                onClick={() => setLengthOpen(true)}
                className="justify-self-start text-[13.5px] font-semibold text-primary hover:underline"
              >
                {t("form.changeLength")}
              </button>
            )
          ))}

        {noteOpen ? (
          <label className="grid gap-1.5">
            <span className="text-[13px] font-bold">{t("form.noteLabel")}</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              autoFocus={!initial.notes}
              className="resize-y rounded-xl border-[1.5px] border-tea-green-700 bg-card px-3 py-2.5 text-sm focus:border-tea-green-300 focus:outline-none focus:ring-3 focus:ring-tea-green-800"
            />
          </label>
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="justify-self-start text-[13.5px] font-semibold text-primary hover:underline"
          >
            {t("form.addNote")}
          </button>
        )}

        {patchTest && <Warning>{t("form.patchTest")}</Warning>}
        {blocked && (
          <Warning>
            {blocked.stylistName === null
              ? t("form.salonBlocked", { label: blocked.label })
              : t("form.stylistBlocked", { name: blocked.stylistName, label: blocked.label })}{" "}
            {t("form.canStillBook")}
          </Warning>
        )}
        {editing && whenChanged && client?.phone && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notifyClient}
              onChange={(e) => setNotifyClient(e.target.checked)}
              className="h-4 w-4 accent-foreground"
            />
            {t("form.textClient")}
          </label>
        )}
      </div>

      {/* The total and the button, always in view. */}
      <div className="shrink-0 border-t border-tea-green-800 bg-card px-6 py-3.5 max-md:px-4 max-md:pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">
              {chosen.length ? chosen.map((s) => s.name).join(" + ") : t("form.pickService")}
            </p>
            <p className="truncate text-[13px] text-muted-foreground tabular-nums">
              {minutes && endTime
                ? `${t("form.minShort", { n: minutes })} · ${t("form.timeRange", { from: clock12(time), to: endTime })}`
                : `${dateText} · ${time ? clock12(time) : ""} · ${stylistName}`}
            </p>
          </div>
          {combined &&
            (combined.priceMinor === null ? (
              <span className="shrink-0 text-[13px] font-semibold text-muted-foreground">{t("form.notPriced")}</span>
            ) : (
              <span className="shrink-0 font-heading text-2xl font-extrabold tabular-nums max-md:text-xl">
                {formatMoney(combined.priceMinor)}
              </span>
            ))}
          <button
            type="submit"
            disabled={!canBook || saving}
            className="h-[52px] shrink-0 rounded-[14px] bg-primary px-7 text-base font-bold text-primary-foreground hover:bg-tea-green-100 disabled:bg-tea-green-500 disabled:hover:bg-tea-green-500"
          >
            {editing
              ? saving
                ? t("common.saving")
                : t("form.saveChanges")
              : saving
                ? t("form.booking")
                : t("form.book")}
          </button>
        </div>
      </div>
    </form>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl border border-papaya-whip-400 bg-papaya-whip-900 px-3 py-2.5 text-[13px] text-light-bronze-200">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
