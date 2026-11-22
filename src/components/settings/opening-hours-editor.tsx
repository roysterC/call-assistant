"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useT } from "@/components/providers/language-provider";
import { minutesTime, type Clock, type MessageKey, type Translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DayHours } from "@/lib/business-hours";

/**
 * Opening hours.
 *
 * These are not decorative: the availability algorithm refuses to offer a slot
 * outside them, and they are rendered into the voice prompt so the agent's
 * spoken hours and the enforced hours come from this one place. Getting a day
 * wrong here means the receptionist offers appointments the salon cannot keep.
 *
 * Each day is a switch and two times, picked from quarter hours and written
 * in the salon's own clock ("9:00am", or "9:00"). The browser's own time box
 * is not used: squeezed into a row it cut "09:00 AM" to "09:00 AI", and on a
 * phone the row ran off the screen. A phone shows each day's hours as one
 * button that opens both times in a sheet.
 */

// Monday first — Sunday-first is a calendar convention, not how anyone
// describes their working week.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_OPEN = "09:00";
const DEFAULT_CLOSE = "17:30";

/** Quarter hours a salon might open or close at. */
const FIRST = 5 * 60;
const LAST = 23 * 60 + 45;

function toMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Every quarter hour, plus the time already set if it falls between. */
function choices(current: string): number[] {
  const out: number[] = [];
  for (let m = FIRST; m <= LAST; m += 15) out.push(m);
  const cur = toMin(current);
  if (cur !== null && !out.includes(cur)) out.push(cur);
  return out.sort((a, b) => a - b);
}

/** "8h 30", "9h". */
function lengthText(min: number, t: Translate): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t("hours.lengthHM", { h, m: String(m).padStart(2, "0") }) : t("hours.lengthH", { h });
}

function show(hhmm: string, clock: Clock): string {
  const m = toMin(hhmm);
  return m === null ? "–" : minutesTime(m, clock);
}

export function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: DayHours[];
  onChange: (next: DayHours[]) => void;
}) {
  const { t, clock } = useT();
  const dayName = (day: number) => t(`day.${day}` as MessageKey);
  // The day whose times are open in the phone's sheet.
  const [editing, setEditing] = useState<number | null>(null);

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

  function toggle(day: number) {
    const d = dayOf(day);
    update(day, {
      closed: !d.closed,
      // Restore sensible times when reopening a day, so the row does not
      // become two empty times that silently fail validation on save.
      open: d.closed ? d.open || DEFAULT_OPEN : d.open,
      close: d.closed ? d.close || DEFAULT_CLOSE : d.close,
    });
  }

  const wrongWay = (d: DayHours) => {
    const o = toMin(d.open);
    const c = toMin(d.close);
    return o !== null && c !== null && o >= c;
  };

  const sheetDay = editing === null ? null : dayOf(editing);

  return (
    <div>
      <ul className="border-t border-border">
        {DAY_ORDER.map((day) => {
          const d = dayOf(day);
          const bad = !d.closed && wrongWay(d);
          const o = toMin(d.open);
          const c = toMin(d.close);
          return (
            <li key={day} className="flex min-h-14 items-center gap-3 border-b border-border md:min-h-[52px] md:gap-3.5">
              <span className={cn("w-11 shrink-0 text-[15px] font-bold md:w-28 md:text-sm md:font-semibold", d.closed && "text-muted-foreground")}>
                <span className="md:hidden">{t(`dayShort.${day}` as MessageKey)}</span>
                <span className="phone:hidden">{dayName(day)}</span>
              </span>

              <button
                type="button"
                role="switch"
                aria-checked={!d.closed}
                aria-label={t("hours.dayOpen", { day: dayName(day) })}
                onClick={() => toggle(day)}
                className={cn(
                  "relative h-7 w-[46px] shrink-0 rounded-full transition-colors md:h-6 md:w-[42px]",
                  d.closed ? "bg-tea-green-700" : "bg-primary"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-[left] md:h-[18px] md:w-[18px]",
                    d.closed ? "left-[3px]" : "left-[21px]"
                  )}
                />
              </button>

              {d.closed ? (
                <span className="text-sm text-muted-foreground phone:ml-auto">{t("hours.closed")}</span>
              ) : (
                <>
                  {/* A wide screen: the two times, each a list of quarter hours. */}
                  <div className="hidden items-center gap-2 md:flex">
                    <TimeSelect
                      value={d.open}
                      onChange={(v) => update(day, { open: v })}
                      label={t("hours.openingTime", { day: dayName(day) })}
                      bad={bad}
                      clock={clock}
                    />
                    <span className="text-[13px] text-muted-foreground">{t("hours.to")}</span>
                    <TimeSelect
                      value={d.close}
                      onChange={(v) => update(day, { close: v })}
                      label={t("hours.closingTime", { day: dayName(day) })}
                      bad={bad}
                      clock={clock}
                    />
                    {bad ? (
                      <span className="ml-1 text-[12.5px] font-semibold text-red-700">{t("hours.order")}</span>
                    ) : (
                      o !== null &&
                      c !== null && <span className="ml-1 text-[12.5px] text-muted-foreground">{lengthText(c - o, t)}</span>
                    )}
                  </div>

                  {/* A phone: one button for the day's hours, opening a sheet. */}
                  <button
                    type="button"
                    onClick={() => setEditing(day)}
                    aria-label={`${dayName(day)}: ${show(d.open, clock)} ${t("hours.to")} ${show(d.close, clock)}`}
                    className={cn(
                      "ml-auto flex h-10 items-center gap-2 rounded-[11px] border-[1.5px] bg-card pl-3 pr-2 text-[14.5px] font-semibold tabular-nums md:hidden",
                      bad ? "border-red-300 text-red-700" : "border-input"
                    )}
                  >
                    {show(d.open, clock)} – {show(d.close, clock)}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <p className="pt-3 text-xs text-muted-foreground">{t("hours.lastSlot")}</p>

      {editing !== null && sheetDay && (
        <HoursSheet
          day={dayName(editing)}
          hours={sheetDay}
          clock={clock}
          bad={wrongWay(sheetDay)}
          onPick={(patch) => update(editing, patch)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TimeSelect({
  value,
  onChange,
  label,
  bad,
  clock,
}: {
  value: string;
  onChange: (hhmm: string) => void;
  label: string;
  bad: boolean;
  clock: Clock;
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={toMin(value) === null ? "" : toHHMM(toMin(value)!)}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-9 min-w-[6.75rem] appearance-none rounded-[10px] border-[1.5px] bg-card pl-3 pr-8 text-sm font-semibold tabular-nums",
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          bad ? "border-red-300" : "border-input hover:border-tea-green-500"
        )}
      >
        {toMin(value) === null && <option value="">–</option>}
        {choices(value).map((m) => (
          <option key={m} value={toHHMM(m)}>
            {minutesTime(m, clock)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </label>
  );
}

/** A phone: both of a day's times, in two columns of quarter hours. */
function HoursSheet({
  day,
  hours,
  clock,
  bad,
  onPick,
  onClose,
}: {
  day: string;
  hours: DayHours;
  clock: Clock;
  bad: boolean;
  onPick: (patch: Partial<DayHours>) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const o = toMin(hours.open);
  const c = toMin(hours.close);

  const column = (which: "open" | "close") => (
    <div>
      <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.05em] text-muted-foreground">
        {t(which === "open" ? "hours.opens" : "hours.closes")}
      </p>
      <div role="listbox" aria-label={t(which === "open" ? "hours.openingTime" : "hours.closingTime", { day })} className="h-[230px] overflow-y-auto rounded-[14px] bg-muted p-1">
        {choices(hours[which]).map((m) => {
          const on = toMin(hours[which]) === m;
          return (
            <button
              key={m}
              type="button"
              role="option"
              aria-selected={on}
              // The one chosen scrolls into view as the sheet opens.
              ref={on ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
              onClick={() => onPick({ [which]: toHHMM(m) })}
              className={cn(
                "h-10 w-full rounded-[10px] text-[15px] tabular-nums",
                on ? "bg-foreground font-bold text-background" : "font-medium"
              )}
            >
              {minutesTime(m, clock)}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/35 md:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={day}
        className="rounded-t-3xl bg-card px-[18px] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2.5 h-1.5 w-10 rounded-full bg-tea-green-700" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <h3 className="font-heading text-xl font-extrabold">{day}</h3>
          <span className={cn("ml-auto text-[13px] font-semibold", bad ? "text-red-700" : "text-muted-foreground")}>
            {bad ? t("hours.order") : o !== null && c !== null ? t("hours.openFor", { length: lengthText(c - o, t) }) : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("hours.done")}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {column("open")}
          {column("close")}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={bad}
          className="mt-3.5 h-[50px] w-full rounded-[14px] bg-primary text-base font-bold text-primary-foreground disabled:bg-tea-green-700 disabled:text-tea-green-300"
        >
          {bad ? t("hours.fixOrder") : t("hours.done")}
        </button>
      </div>
    </div>
  );
}
