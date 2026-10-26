"use client";

/**
 * Block time out of the diary, or change a block already there.
 *
 * Bookings already inside the time are listed before saving but never
 * touched: blocking a holiday months ahead has to be possible while a regular
 * is still in the book, and the salon decides whether to move them.
 */

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  PHONE_FULL_SCREEN,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import type { TimeBlockForm } from "@/lib/time-blocks";
import { Field } from "./client-picker";
import { useT } from "@/components/providers/language-provider";
import type { MessageKey } from "@/lib/i18n";

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

const EVERYONE = "__everyone__";
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

interface BlockTimeDialogProps {
  state: BlockDialogState | null;
  stylists: string[];
  timeZone: string;
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
  onClose,
  onSaved,
}: BlockTimeDialogProps) {
  const [form, setForm] = useState<TimeBlockForm | null>(null);
  const [affected, setAffected] = useState<Affected[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { t, locale } = useT();

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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`sm:max-w-lg ${PHONE_FULL_SCREEN}`}>
        <DialogHeader>
          <DialogTitle>{state.mode === "edit" ? t("block.titleEdit") : t("block.titleNew")}</DialogTitle>
          <p className="text-xs text-muted-foreground">{t("block.intro")}</p>
        </DialogHeader>

        <form
          className="grid gap-4 min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) save();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("block.who")} id="block-who">
              <Select
                value={form.stylistName ?? EVERYONE}
                onValueChange={(v) =>
                  set({ stylistName: !v || v === EVERYONE ? null : v })
                }
              >
                <SelectTrigger id="block-who" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EVERYONE}>{t("block.everyone")}</SelectItem>
                  {stylists.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("block.label")} id="block-label">
              <Input
                id="block-label"
                value={form.label}
                onChange={(e) => set({ label: e.target.value })}
                placeholder={t("block.lunch")}
                maxLength={60}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5 -mt-2">
            {LABELS.map((key) => {
              const l = t(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => set({ label: l, ...(key === "block.holiday" ? { allDay: true } : {}) })}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs",
                    form.label === l
                      ? "border-foreground text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {l}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup">
              {(["none", "weekly"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={form.repeat === r}
                  onClick={() => set({ repeat: r })}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs",
                    form.repeat === r ? "bg-muted text-foreground" : "text-muted-foreground"
                  )}
                >
                  {r === "none" ? t("block.noRepeat") : t("block.weekly")}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => set({ allDay: e.target.checked })}
                className="h-4 w-4 accent-foreground"
              />
              {t("block.allDay")}
            </label>
          </div>

          {weekly && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">{t("block.on")}</span>
              <div className="flex flex-wrap gap-1">
                {DAYS.map(([d, name]) => {
                  const on = form.weekdays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        set({
                          weekdays: on
                            ? form.weekdays.filter((x) => x !== d)
                            : [...form.weekdays, d],
                        })
                      }
                      className={cn(
                        "w-11 rounded-md border py-1 text-xs",
                        on
                          ? "border-foreground bg-muted text-foreground"
                          : "border-border text-muted-foreground"
                      )}
                    >
                      {t(name)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={weekly ? t("block.starting") : t("block.from")} id="block-start-date">
              <Input
                id="block-start-date"
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  set({
                    startDate: e.target.value,
                    ...(form.endDate < e.target.value ? { endDate: e.target.value } : {}),
                  })
                }
                required
              />
            </Field>
            {weekly ? (
              <Field label={t("block.until")} id="block-until">
                <Input
                  id="block-until"
                  type="date"
                  value={form.untilDate ?? ""}
                  min={form.startDate}
                  onChange={(e) => set({ untilDate: e.target.value || null })}
                />
              </Field>
            ) : (
              <Field label={t("block.to")} id="block-end-date">
                <Input
                  id="block-end-date"
                  type="date"
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(e) => set({ endDate: e.target.value })}
                  required
                />
              </Field>
            )}
            {!form.allDay && (
              <>
                <Field label={t("block.startTime")} id="block-start-time">
                  <Input
                    id="block-start-time"
                    type="time"
                    step={900}
                    value={form.startTime}
                    onChange={(e) => set({ startTime: e.target.value })}
                    required
                  />
                </Field>
                <Field label={t("block.endTime")} id="block-end-time">
                  <Input
                    id="block-end-time"
                    type="time"
                    step={900}
                    value={form.endTime}
                    onChange={(e) => set({ endTime: e.target.value })}
                    required
                  />
                </Field>
              </>
            )}
          </div>

          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

          {affected.length > 0 && (
            <div className="rounded-md border border-papaya-whip-400 bg-papaya-whip-700 p-3 text-xs">
              <p className="flex gap-2 text-papaya-whip-100 mb-1.5">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                {affected.length === 1
                  ? t("block.affectedOne")
                  : t("block.affectedMany", { n: affected.length })}
              </p>
              <ul className="grid gap-0.5 pl-6 text-muted-foreground max-h-32 overflow-y-auto">
                {affected.map((a) => (
                  <li key={a.id} className="tabular-nums">
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
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <DialogFooter className="gap-2 sm:justify-between">
            {state.mode === "edit" ? (
              <div className="flex flex-wrap gap-2">
                {confirmDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => send("delete", endpoint, { method: "DELETE" })}
                  >
                    {weekly ? t("block.deleteWeekly") : t("block.deleteIt")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => setConfirmDelete(true)}
                  >
                    {t("common.delete")}
                  </Button>
                )}
                {state.initial.repeat === "weekly" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      send("skip", endpoint, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ skipDate: state.occurrenceDate }),
                      })
                    }
                  >
                    {t("block.skipOnly", { day: prettyDay(state.occurrenceDate, locale) })}
                  </Button>
                )}
              </div>
            ) : (
              <Button type="button" variant="ghost" onClick={onClose} disabled={Boolean(busy)}>
                {t("common.cancel")}
              </Button>
            )}
            <Button type="submit" disabled={Boolean(busy) || !form.label.trim()}>
              {busy === "save" ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
