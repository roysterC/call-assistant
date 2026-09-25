"use client";

/**
 * Step two of a desk booking: what, when, and what it costs.
 *
 * Several services make one appointment — a colour and a cut are booked back
 * to back in one slot, timed and priced as the sum of their parts, exactly as
 * the phone assistant books them (combineServices). The minutes stay editable
 * because the person at the desk can see the client's hair and the catalogue
 * cannot; the cost is the list price, and what was actually taken is recorded
 * when the appointment is marked done.
 */

import { useMemo, useState } from "react";
import { Plus, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { combineServices, type SalonService } from "@/lib/salon-config";
import { formatMoney } from "@/lib/money";
import { speakablePhone } from "@/lib/phone";
import { wallTimeToUtc } from "@/lib/calendar-layout";
import { Field, type ClientRow } from "./client-picker";
import type { CalendarAppointment, DiaryBlock } from "./day-grid";

export interface BookingDraft {
  date: string;
  time: string;
  stylistName: string;
  serviceNames: string[];
  durationMinutes: number;
  notes: string;
  walkInName: string;
  /** Editing only: text the client that their booking has moved. */
  notifyClient: boolean;
}

/** Set when the screen is changing an existing booking rather than making one. */
export interface EditingBooking {
  /** The booking itself, left out of its own clash check. */
  appointmentId: string;
  /** Done, no-show or past: services, notes and client only. */
  lockWhen: boolean;
}

interface BookingDetailsProps {
  /** Null for a walk-in with no details. */
  client: ClientRow | null;
  services: SalonService[];
  stylists: string[];
  timeZone: string;
  /** The day's appointments, to warn about a clash on the day shown. */
  dayAppointments: CalendarAppointment[];
  /** The day's blocked time, likewise. */
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
  onBack: () => void;
  /** Editing: leave without saving. */
  onCancel?: () => void;
  onSubmit: (draft: BookingDraft) => void;
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
  onBack,
  onCancel,
  onSubmit,
}: BookingDetailsProps) {
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [stylistName, setStylistName] = useState(initial.stylistName);
  const [lines, setLines] = useState<string[]>(() =>
    initial.serviceNames?.length ? initial.serviceNames : [""]
  );
  // An existing booking whose length differs from its services' keeps it,
  // shown as an override so changing a service does not silently reset it.
  const [minutesOverride, setMinutesOverride] = useState(() => {
    if (!initial.minutes || !initial.serviceNames?.length) return "";
    const listed = initial.serviceNames
      .map((n) => services.find((s) => s.name === n))
      .filter((s): s is SalonService => Boolean(s));
    const natural = listed.length ? combineServices(listed).durationMinutes : 0;
    return natural === initial.minutes ? "" : String(initial.minutes);
  });
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [walkInName, setWalkInName] = useState("");
  const [notifyClient, setNotifyClient] = useState(true);
  const locked = Boolean(editing?.lockWhen);
  const whenChanged =
    date !== initial.date || time !== initial.time || stylistName !== initial.stylistName;

  const picked = useMemo(
    () =>
      lines
        .map((name) => services.find((s) => s.name === name))
        .filter((s): s is SalonService => Boolean(s)),
    [lines, services]
  );
  const combined = picked.length ? combineServices(picked) : null;
  const minutes =
    Number(minutesOverride) > 0
      ? Math.round(Number(minutesOverride))
      : (combined?.durationMinutes ?? 0);

  const isNew = !client || client.visits === 0;
  const patchTest = Boolean(combined?.requiresPatchTest) && isNew;

  // Only the day on screen is loaded, so a clash can only be checked there.
  const clash = (() => {
    if (!minutes || !time || date !== dayShown) return null;
    const start = wallTimeToUtc(date, time, timeZone).getTime();
    const end = start + minutes * 60_000;
    return (
      dayAppointments.find(
        (a) =>
          a.stylistName.toLowerCase() === stylistName.toLowerCase() &&
          a.id !== editing?.appointmentId &&
          a.status !== "cancelled" &&
          a.status !== "no_show" &&
          new Date(a.startsAt).getTime() < end &&
          new Date(a.endsAt).getTime() > start
      ) ?? null
    );
  })();

  // Blocked time, on the same terms: the desk is warned but may book it.
  const blocked = (() => {
    if (!minutes || !time || date !== dayShown) return null;
    const start = wallTimeToUtc(date, time, timeZone).getTime();
    const end = start + minutes * 60_000;
    return (
      dayBlocks.find(
        (b) =>
          (b.stylistName === null ||
            b.stylistName.toLowerCase() === stylistName.toLowerCase()) &&
          new Date(b.start).getTime() < end &&
          new Date(b.end).getTime() > start
      ) ?? null
    );
  })();

  const endTime = (() => {
    if (!minutes || !time) return null;
    const [h, m] = time.split(":").map(Number);
    const total = h * 60 + m + minutes;
    const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
    return `${hh}:${String(total % 60).padStart(2, "0")}`;
  })();

  const canBook =
    picked.length > 0 &&
    picked.length === lines.length &&
    minutes > 0 &&
    Boolean(date && time && stylistName);

  const setLine = (i: number, name: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? name : l)));

  return (
    <form
      className="grid gap-4 min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canBook || saving) return;
        onSubmit({
          date,
          time,
          stylistName,
          serviceNames: picked.map((s) => s.name),
          durationMinutes: minutes,
          notes,
          walkInName,
          notifyClient: Boolean(editing) && whenChanged && notifyClient,
        });
      }}
    >
      <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5">
        <div className="min-w-0">
          {client ? (
            <>
              <div className="font-medium truncate">
                {client.name ?? "Unnamed client"}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums truncate">
                {[client.phone && speakablePhone(client.phone), client.email]
                  .filter(Boolean)
                  .join(" · ") || "No contact details"}
              </div>
            </>
          ) : (
            <Field label="Walk-in name (optional)" id="walkin-name">
              <Input
                id="walkin-name"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                placeholder="Walk-in"
                className="h-8"
              />
            </Field>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {isNew ? "New client" : `Returning · ${client!.visits} visit${client!.visits === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={onBack}
            className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
          >
            Change
          </button>
        </div>
      </div>

      {client?.notes && (
        <p className="text-xs text-muted-foreground border-l-2 border-border pl-3 whitespace-pre-line">
          {client.notes}
        </p>
      )}

      {locked && (
        <p className="text-xs text-muted-foreground">
          This booking is finished or in the past, so its time and stylist
          stay as they were. Services, notes and client can still change.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Date" id="booking-date">
          <Input
            id="booking-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={locked}
            required
          />
        </Field>
        <Field label="Time" id="booking-time">
          <Input
            id="booking-time"
            type="time"
            step={900}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={locked}
            required
          />
        </Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label="Stylist" id="booking-stylist">
            <Select
              value={stylistName}
              onValueChange={(v) => setStylistName(v ?? "")}
              disabled={locked}
            >
              <SelectTrigger id="booking-stylist" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {stylists.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>Services</span>
          <span className="hidden sm:inline">Minutes · Price</span>
        </div>
        {lines.map((name, i) => {
          const s = services.find((x) => x.name === name);
          return (
            <div key={i} className="flex items-center gap-2">
              <Select value={name} onValueChange={(v) => setLine(i, v ?? "")}>
                <SelectTrigger className="flex-1 min-w-0" aria-label={`Service ${i + 1}`}>
                  <SelectValue placeholder="Choose a service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((opt) => (
                    <SelectItem key={opt.name} value={opt.name}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="w-24 sm:w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {s ? (
                  <>
                    {s.durationMinutes} min ·{" "}
                    {s.priceMinor === null ? "no price" : formatMoney(s.priceMinor)}
                  </>
                ) : null}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove service"
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setLines((ls) => [...ls, ""])}
          >
            <Plus className="h-3.5 w-3.5" />
            Add service
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 px-3 py-3">
        <Field label="Total time (minutes)" id="booking-minutes">
          <Input
            id="booking-minutes"
            inputMode="numeric"
            value={minutesOverride || (combined ? String(combined.durationMinutes) : "")}
            onChange={(e) => setMinutesOverride(e.target.value)}
            placeholder="—"
            disabled={locked}
            className="h-8 w-24 tabular-nums"
          />
          {endTime && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {time} to {endTime}
            </span>
          )}
        </Field>
        <div className="grid gap-1.5 content-start">
          <span className="text-xs text-muted-foreground">Total cost</span>
          <span className="text-xl font-semibold tabular-nums">
            {!combined
              ? "—"
              : combined.priceMinor === null
                ? "Not priced"
                : formatMoney(combined.priceMinor)}
          </span>
          {combined && combined.priceMinor === null && (
            <span className="text-[11px] text-muted-foreground">
              A service here has no price set.
            </span>
          )}
        </div>
      </div>

      <Field label="Notes" id="booking-notes">
        <Textarea id="booking-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>

      {patchTest && (
        <p className="flex gap-2 text-xs text-amber-400">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          New client having colour: needs a skin patch test 48 hours before.
        </p>
      )}
      {blocked && (
        <p className="flex gap-2 text-xs text-amber-400">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {blocked.stylistName === null
            ? `The salon is blocked for ${blocked.label}.`
            : `${blocked.stylistName} is blocked for ${blocked.label}.`}{" "}
          You can still book it.
        </p>
      )}
      {clash && (
        <p className="flex gap-2 text-xs text-amber-400">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          Overlaps {clash.lead.name ?? "another booking"} ({clash.serviceText}) with{" "}
          {clash.stylistName}. You can still book it.
        </p>
      )}
      {editing && whenChanged && client?.phone && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notifyClient}
            onChange={(e) => setNotifyClient(e.target.checked)}
            className="h-4 w-4 accent-foreground"
          />
          Text the client about the change
        </label>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={editing && onCancel ? onCancel : onBack}
          disabled={saving}
        >
          {editing ? "Cancel" : "Back"}
        </Button>
        <Button type="submit" disabled={!canBook || saving}>
          {editing ? (saving ? "Saving…" : "Save changes") : saving ? "Booking…" : "Book"}
        </Button>
      </div>
    </form>
  );
}
