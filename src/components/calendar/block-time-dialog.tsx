"use client";

/**
 * Block time out of the diary, or change a block already there.
 *
 * Laid out like a booking (booking-details.tsx): what it is for, whose
 * diary, when, and a summary with the button always in view at the foot.
 *
 * Bookings already inside the time are listed before saving but never
 * touched: blocking a holiday months ahead has to be possible while a regular
 * is still in the book, and the salon decides whether to move them.
 */

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import type { TimeBlockForm } from "@/lib/time-blocks";
import { minutesTime, type MessageKey } from "@/lib/i18n";
import { CloseButton } from "./client-picker";
import { BOOKING_CARD } from "./new-booking-dialog";
import { useT } from "@/components/providers/language-provider";

export type BlockDialogState =
  | { mode: "new"; initial: TimeBlockForm }
  | {
      mode: "edit";
      blockId: string;
      initial: TimeBlockForm;
      /** The day that was clicked, which "skip this week" takes out. */
      occurrenceDate: string;
    };

interface Affected {
  id: string;
  bookingNumber: number | null;
  clientName: string | null;
  stylistName: string;
  serviceText: string;
  startsAt: string;
}

// Quick labels, written in the language of whoever picks one: the label is
// what everyone then sees on the block.
const LABELS: MessageKey[] = ["block.lunch", "block.holiday", "block.training", "block.personal"];
// Monday first, as a salon's week reads.
const DAYS: Array<[number, MessageKey]> = [
  [1, "weekday.mon"],
  [2, "weekday.tue"],
  [3, "weekday.wed"],
  [4, "weekday.thu"],
  [5, "weekday.fri"],
  [6, "weekday.sat"],
  [0, "weekday.sun"],
];

/** Quick lengths from the start time; 0 is "the rest of the day", to closing. */
const LENGTHS: Array<[number, MessageKey]> = [
  [30, "block.len30"],
  [60, "block.len60"],
  [120, "block.len120"],
  [0, "block.lenRest"],
];

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Every quarter hour from 6am to 11pm, and the time already set if it falls between. */
function quarterHours(current: string, after?: string): string[] {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 23 * 60; m += 15) out.push(toHhmm(m));
  if (current && !out.includes(current)) out.push(current);
  return out.sort().filter((o) => !after || o > after || o === current);
}

interface BlockTimeDialogProps {
  state: BlockDialogState | null;
  stylists: string[];
  timeZone: string;
  /** The salon's closing time on a day ("17:30"), or null when closed or not set: for "Rest of the day". */
  closingTime?: (date: string) => string | null;
  onClose: () => void;
  onSaved: () => void;
}

function prettyDay(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function BlockTimeDialog({
  state,
  stylists,
  timeZone,
  closingTime,
  onClose,
  onSaved,
}: BlockTimeDialogProps) {
  const [form, setForm] = useState<TimeBlockForm | null>(null);
  const [affected, setAffected] = useState<Affected[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { t, locale, clock } = useT();
  const dayRef = useRef<HTMLInputElement>(null);
  const toDayRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm(state ? state.initial : null);
    setAffected([]);
    setHint(null);
    setError(null);
    setConfirmDelete(false);
  }, [state]);

  const endpoint =
    state?.mode === "edit" ? `/api/time-blocks/${state.blockId}` : "/api/time-blocks";
  const method = state?.mode === "edit" ? "PATCH" : "POST";

  // Which bookings fall inside, re-asked as the form changes.
  useEffect(() => {
    if (!form) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(endpoint, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, preview: true }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAffected([]);
          setHint(data.error ?? null);
          return;
        }
        setHint(null);
        setAffected(data.affected ?? []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setHint(null);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [form, endpoint, method]);


  if (!state || !form) {
    return <Dialog open={false} onOpenChange={() => onClose()} />;
  }

  const set = (patch: Partial<TimeBlockForm>) => setForm({ ...form, ...patch });
  const weekly = form.repeat === "weekly";
  const editing = state.mode === "edit";
  const clockText = (hhmm: string) => minutesTime(toMin(hhmm), clock);
  const close = closingTime?.(form.startDate) ?? null;
  // A one-off block over several days, made before blocks were set by the day.
  const spansDays = !weekly && !form.allDay && form.endDate !== form.startDate;

  const send = async (label: string, url: string, init: RequestInit) => {
    setBusy(label);
    setError(null);
    try {
      const res = await apiFetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t("block.didNotSave"));
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError(t("common.noServer"));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    send("save", endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

  const time = (at: string) =>
    new Date(at).toLocaleString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    });

  /** The end for a quick length, or null when it does not fit in the day. */
  const endFor = (len: number): string | null => {
    if (len === 0) return close && close > form.startTime ? close : null;
    const end = toMin(form.startTime) + len;
    return end <= 24 * 60 ? toHhmm(end) : null;
  };

  const dayNames = DAYS.filter(([d]) => form.weekdays.includes(d)).map(([, k]) => t(k)).join(", ");
  const days = weekly
    ? t("block.everyDays", { days: dayNames || "…" })
    : form.endDate !== form.startDate
      ? `${prettyDay(form.startDate, locale)} – ${prettyDay(form.endDate, locale)}`
      : prettyDay(form.startDate, locale);
  const when = form.allDay
    ? t("block.whenAllDay", { days })
    : t("block.whenTimes", { days, from: clockText(form.startTime), to: clockText(form.endTime) });
  const who = form.stylistName ?? t("block.everyone");

  const pill = (on: boolean) =>
    on ? "border-foreground bg-foreground text-background" : "border-tea-green-700 bg-card hover:bg-tea-green-900";
  const fieldCard =
    "relative flex h-[58px] flex-col justify-center gap-0.5 rounded-[14px] border-[1.5px] border-tea-green-700 bg-card px-3.5 text-left focus-within:border-tea-green-300 focus-within:ring-3 focus-within:ring-tea-green-800 hover:border-tea-green-500";
  const overlay = "absolute inset-0 h-full w-full cursor-pointer opacity-0";
  const cardLabel = "text-[11.5px] font-semibold text-muted-foreground";
  const cardValue = "flex items-center justify-between gap-2 text-[15px] font-bold tabular-nums";
  const heading = "text-[13px] font-bold";

  /** A date as a card that opens the phone's own date picker. */
  const dateCard = (
    label: string,
    value: string,
    onPick: (v: string) => void,
    ref: React.RefObject<HTMLInputElement | null>,
    opts: { min?: string; optional?: boolean } = {}
  ) => (
    <label className={fieldCard}>
      <span className={cardLabel}>{label}</span>
      <span className={cardValue}>
        <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? prettyDay(value, locale) : t("block.noEnd")}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </span>
      <input
        ref={ref}
        type="date"
        value={value}
        min={opts.min}
        required={!opts.optional}
        onChange={(e) => (e.target.value || opts.optional) && onPick(e.target.value)}
        onClick={() => {
          try {
            ref.current?.showPicker();
          } catch {
            // Older browsers open it themselves on a tap.
          }
        }}
        aria-label={label}
        className={overlay}
      />
    </label>
  );

  /** A time as a card over a list of quarter hours. */
  const timeCard = (label: string, value: string, onPick: (v: string) => void, after?: string) => (
    <label className={fieldCard}>
      <span className={cardLabel}>{label}</span>
      <span className={cardValue}>
        {clockText(value)}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </span>
      <select value={value} onChange={(e) => onPick(e.target.value)} aria-label={label} className={overlay}>
        {quarterHours(value, after).map((o) => (
          <option key={o} value={o}>
            {clockText(o)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className={BOOKING_CARD}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && form.label.trim()) save();
          }}
        >
          {/* What it is, and where it starts. */}
          <div className="shrink-0 border-b border-tea-green-800 px-6 pb-4 pt-5 phone:px-4 phone:pt-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-bold uppercase tracking-[0.07em] text-tea-green-200">
                  {editing ? (weekly ? t("block.kickerEditWeekly") : t("block.titleEdit")) : t("block.titleNew")}
                </span>
                <DialogTitle className="mt-0.5 truncate font-heading text-2xl font-extrabold phone:text-[22px]">
                  {editing && form.label.trim() ? form.label : t("block.whatFor")}
                </DialogTitle>
              </div>
              <CloseButton onClose={onClose} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-tea-green-800 px-3 text-[13.5px] font-bold tabular-nums">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {prettyDay(form.startDate, locale)}
                {!form.allDay && ` · ${clockText(form.startTime)}`}
              </span>
              <span className="inline-flex h-8 items-center rounded-full bg-tea-green-800 px-3 text-[13.5px] font-bold">
                {form.stylistName ? t("new.withStylist", { stylist: form.stylistName }) : t("block.everyone")}
              </span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-6 py-5 phone:px-4">
            {/* Label */}
            <section className="grid gap-2">
              <h3 className={heading}>{t("block.label")}</h3>
              <div className="flex flex-wrap gap-1.5">
                {LABELS.map((key) => {
                  const l = t(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={form.label === l}
                      onClick={() => set({ label: l, ...(key === "block.holiday" ? { allDay: true } : {}) })}
                      className={cn("h-10 rounded-full border-[1.5px] px-4 text-sm font-bold", pill(form.label === l))}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
              <input
                value={LABELS.some((k) => t(k) === form.label) ? "" : form.label}
                onChange={(e) => set({ label: e.target.value })}
                placeholder={t("block.ownLabel")}
                aria-label={t("block.label")}
                maxLength={60}
                className="h-11 w-full rounded-xl border-[1.5px] border-tea-green-700 bg-card px-3.5 text-[15px] focus:border-tea-green-300 focus:outline-none focus:ring-3 focus:ring-tea-green-800"
              />
            </section>

            {/* Whose diary */}
            <section className="grid gap-2">
              <h3 className={heading}>{t("block.who")}</h3>
              <div className="flex flex-wrap gap-1.5">
                {[...stylists.map((s) => [s, s] as const), [null, t("block.everyoneShort")] as const].map(([value, name]) => (
                  <button
                    key={value ?? "everyone"}
                    type="button"
                    aria-pressed={form.stylistName === value}
                    onClick={() => set({ stylistName: value })}
                    className={cn("h-10 rounded-xl border-[1.5px] px-3.5 text-sm font-bold", pill(form.stylistName === value))}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </section>

            {/* When */}
            <section className="grid gap-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h3 className={cn(heading, "mr-auto")}>{t("block.when")}</h3>
                <div className="inline-flex rounded-xl bg-tea-green-900 p-[3px]" role="radiogroup" aria-label={t("block.when")}>
                  {(["none", "weekly"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={form.repeat === r}
                      onClick={() =>
                        set({
                          repeat: r,
                          ...(r === "weekly" && form.weekdays.length === 0
                            ? { weekdays: [new Date(`${form.startDate}T12:00:00Z`).getUTCDay()] }
                            : {}),
                        })
                      }
                      className={cn(
                        "h-[34px] rounded-[9px] px-3 text-[13px] font-bold",
                        form.repeat === r ? "bg-foreground text-background" : "text-foreground hover:bg-tea-green-800"
                      )}
                    >
                      {r === "none" ? t("block.once") : t("block.weekly")}
                    </button>
                  ))}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-semibold">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.allDay}
                    onClick={() => set({ allDay: !form.allDay })}
                    className={cn("relative h-[26px] w-[42px] shrink-0 rounded-full transition-colors", form.allDay ? "bg-primary" : "bg-tea-green-600")}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-[left]",
                        form.allDay ? "left-[19px]" : "left-[3px]"
                      )}
                    />
                  </button>
                  {t("block.allDay")}
                </label>
              </div>

              {weekly && (
                <>
                  <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={t("block.on")}>
                    {DAYS.map(([d, name]) => {
                      const on = form.weekdays.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => set({ weekdays: on ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d] })}
                          className={cn("h-10 rounded-[10px] border-[1.5px] text-[13px] font-bold", pill(on))}
                        >
                          {t(name)}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {dateCard(t("block.starting"), form.startDate, (v) => set({ startDate: v }), dayRef)}
                    {dateCard(t("block.until"), form.untilDate ?? "", (v) => set({ untilDate: v || null }), toDayRef, {
                      min: form.startDate,
                      optional: true,
                    })}
                  </div>
                </>
              )}

              {!weekly && form.allDay && (
                <div className="grid grid-cols-2 gap-2">
                  {dateCard(t("block.from"), form.startDate, (v) => set({ startDate: v, ...(form.endDate < v ? { endDate: v } : {}) }), dayRef)}
                  {dateCard(t("block.to"), form.endDate, (v) => set({ endDate: v }), toDayRef, { min: form.startDate })}
                </div>
              )}

              {!form.allDay && (
                <>
                  <div className={cn("grid gap-2", weekly ? "grid-cols-2" : "grid-cols-[1.3fr_1fr_1fr] phone:grid-cols-2")}>
                    {!weekly && (
                      <div className={cn("grid gap-2", spansDays ? "grid-cols-2 phone:col-span-2" : "phone:col-span-2")}>
                        {dateCard(
                          spansDays ? t("block.from") : t("block.day"),
                          form.startDate,
                          (v) => set({ startDate: v, endDate: spansDays && form.endDate >= v ? form.endDate : v }),
                          dayRef
                        )}
                        {spansDays && dateCard(t("block.to"), form.endDate, (v) => set({ endDate: v }), toDayRef, { min: form.startDate })}
                      </div>
                    )}
                    {timeCard(t("block.startTime"), form.startTime, (v) =>
                      set({ startTime: v, ...(!spansDays && form.endTime <= v ? { endTime: toHhmm(Math.min(toMin(v) + 60, 24 * 60)) } : {}) })
                    )}
                    {timeCard(t("block.endTime"), form.endTime, (v) => set({ endTime: v }), spansDays ? undefined : form.startTime)}
                  </div>
                  {!spansDays && (
                    <div className="flex flex-wrap gap-1.5">
                      {LENGTHS.map(([len, key]) => {
                        const end = endFor(len);
                        if (!end) return null;
                        const on = form.endTime === end;
                        return (
                          <button
                            key={len}
                            type="button"
                            aria-pressed={on}
                            onClick={() => set({ endTime: end })}
                            className={cn("h-8 rounded-full border-[1.5px] px-3 text-[13px] font-semibold", pill(on))}
                          >
                            {t(key)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </section>

            {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}

            {affected.length > 0 && (
              <div className="flex gap-2.5 rounded-[14px] bg-light-bronze-900 px-3.5 py-3 text-[13.5px] leading-snug text-light-bronze-200">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold">
                    {affected.length === 1 ? t("block.affectedOne") : t("block.affectedMany", { n: affected.length })}
                  </p>
                  <ul className="mt-1 grid max-h-32 gap-0.5 overflow-y-auto tabular-nums">
                    {affected.map((a) => (
                      <li key={a.id}>
                        {t("block.affectedRow", {
                          when: time(a.startsAt),
                          client: a.clientName ?? t("grid.client"),
                          stylist: a.stylistName,
                        })}
                        {a.bookingNumber !== null && ` · #${a.bookingNumber}`}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* The summary and the button, always in view. */}
          <div className="shrink-0 border-t border-tea-green-800 bg-card px-6 py-3.5 phone:px-4 phone:pb-[max(1rem,env(safe-area-inset-bottom))]">
            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
            {editing && (
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                {confirmDelete ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => send("delete", endpoint, { method: "DELETE" })}
                    className="h-10 rounded-xl bg-red-700 px-3.5 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50"
                  >
                    {t("block.confirmDelete")}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => setConfirmDelete(true)}
                    className="h-10 rounded-xl px-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {state.initial.repeat === "weekly" ? t("block.deleteWeekly") : t("common.delete")}
                  </button>
                )}
                {state.initial.repeat === "weekly" && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      send("skip", endpoint, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ skipDate: state.occurrenceDate }),
                      })
                    }
                    className="h-10 rounded-xl border-[1.5px] border-tea-green-700 px-3.5 text-sm font-semibold hover:bg-tea-green-900 disabled:opacity-50"
                  >
                    {t("block.skipOnly", { day: prettyDay(state.occurrenceDate, locale) })}
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center gap-4 phone:flex-col phone:items-stretch phone:gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {form.label.trim() || t("block.noLabel")} · {when}
                </p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {who} · {t("block.nobody")}
                </p>
              </div>
              <button
                type="submit"
                disabled={Boolean(busy) || !form.label.trim()}
                className="h-[52px] shrink-0 rounded-[14px] bg-primary px-7 text-base font-bold text-primary-foreground hover:bg-tea-green-100 disabled:bg-tea-green-500 disabled:hover:bg-tea-green-500"
              >
                {busy === "save" ? t("common.saving") : editing ? t("form.saveChanges") : t("block.blockIt")}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
