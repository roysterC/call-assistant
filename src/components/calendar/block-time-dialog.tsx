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
const LABELS = ["Lunch", "Holiday", "Training", "Personal"];
// Monday first, as a salon's week reads.
const DAYS: Array<[number, string]> = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
];

interface BlockTimeDialogProps {
  state: BlockDialogState | null;
  stylists: string[];
  /** Offer "Everyone". Only the owner can close the salon. */
  allowEveryone?: boolean;
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}

function prettyDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function BlockTimeDialog({
  state,
  stylists,
  allowEveryone = true,
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
        setError(data.error || "That did not save.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Could not reach the server.");
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
    new Date(at).toLocaleString("en-GB", {
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
          <DialogTitle>{state.mode === "edit" ? "Blocked time" : "Block time"}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Nobody can book this time by phone. At the desk you&apos;ll get a
            warning but can still book it.
          </p>
        </DialogHeader>

        <form
          className="grid gap-4 min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) save();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Who" id="block-who">
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
                  {allowEveryone && (
                    <SelectItem value={EVERYONE}>Everyone (salon closed)</SelectItem>
                  )}
                  {stylists.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Label" id="block-label">
              <Input
                id="block-label"
                value={form.label}
                onChange={(e) => set({ label: e.target.value })}
                placeholder="Lunch"
                maxLength={60}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5 -mt-2">
            {LABELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => set({ label: l, ...(l === "Holiday" ? { allDay: true } : {}) })}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs",
                  form.label === l
                    ? "border-foreground text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {l}
              </button>
            ))}
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
                  {r === "none" ? "Doesn't repeat" : "Every week"}
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
              All day
            </label>
          </div>

          {weekly && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">On</span>
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
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={weekly ? "Starting" : "From"} id="block-start-date">
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
              <Field label="Until (optional)" id="block-until">
                <Input
                  id="block-until"
                  type="date"
                  value={form.untilDate ?? ""}
                  min={form.startDate}
                  onChange={(e) => set({ untilDate: e.target.value || null })}
                />
              </Field>
            ) : (
              <Field label="To" id="block-end-date">
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
                <Field label="Start time" id="block-start-time">
                  <Input
                    id="block-start-time"
                    type="time"
                    step={900}
                    value={form.startTime}
                    onChange={(e) => set({ startTime: e.target.value })}
                    required
                  />
                </Field>
                <Field label="End time" id="block-end-time">
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
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              <p className="flex gap-2 text-amber-400 mb-1.5">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                {affected.length === 1
                  ? "1 booking falls in this time. It stays booked; move it if you need to."
                  : `${affected.length} bookings fall in this time. They stay booked; move them if you need to.`}
              </p>
              <ul className="grid gap-0.5 pl-6 text-muted-foreground max-h-32 overflow-y-auto">
                {affected.map((a) => (
                  <li key={a.id} className="tabular-nums">
                    {time(a.startsAt)} · {a.clientName ?? "Client"} with {a.stylistName}
                    {a.bookingNumber !== null && ` · #${a.bookingNumber}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

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
                    {weekly ? "Delete every week" : "Delete it"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete
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
                    Skip {prettyDay(state.occurrenceDate)} only
                  </Button>
                )}
              </div>
            ) : (
              <Button type="button" variant="ghost" onClick={onClose} disabled={Boolean(busy)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={Boolean(busy) || !form.label.trim()}>
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
