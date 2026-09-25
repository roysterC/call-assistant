"use client";

/**
 * What a booking is, and the three things a salon does to one.
 *
 * Opens in place rather than navigating away: the diary is where someone is
 * standing when the client is in front of them, and losing the day they were
 * looking at to answer "what time is Jane in?" is how a screen stops getting
 * used.
 *
 * Marking a booking here does not touch the stylist's Google Calendar, for
 * the same reason the appointments API does not: staff work in that diary
 * directly, and a status change quietly deleting an event out from under them
 * would be worse than the two records disagreeing.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { APPOINTMENT_STATUS } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { toneFor, type ServiceTone } from "@/lib/service-colours";
import type { CalendarAppointment } from "./day-grid";

interface AppointmentSheetProps {
  appointment: CalendarAppointment | null;
  timeZone: string;
  tones: Map<string, ServiceTone>;
  /** List price for this appointment's service, to start the amount from. */
  listPriceMinor?: number | null;
  onClose: () => void;
  onChanged: () => void;
}

function clockRange(startsAt: string, endsAt: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${fmt.format(new Date(startsAt))} – ${fmt.format(new Date(endsAt))}`;
}

const ACTIONS: Array<{ status: string; label: string }> = [
  { status: "completed", label: "Done" },
  { status: "no_show", label: "No show" },
  { status: "cancelled", label: "Cancel" },
];

export function AppointmentSheet({
  appointment,
  timeZone,
  tones,
  listPriceMinor,
  onClose,
  onChanged,
}: AppointmentSheetProps) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  // Start from whatever is already recorded, then the price list. Reset per
  // appointment so last client's figure never rides along into this one.
  useEffect(() => {
    if (!appointment) return;
    setAmount(
      minorToInput(
        appointment.amountMinor ?? listPriceMinor ?? null
      )
    );
    setError(null);
  }, [appointment, listPriceMinor]);

  const setStatus = async (status: string) => {
    if (!appointment) return;
    setSaving(status);
    setError(null);
    try {
      // The amount rides along with the status, so "done" and "this is what
      // they paid" are one action at the desk rather than two.
      const body: Record<string, unknown> = { id: appointment.id, status };
      if (status === "completed") body.amountMinor = parseMoney(amount);

      const res = await apiFetch("/api/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not update that booking.");
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(null);
    }
  };

  const a = appointment;
  const tone = a ? (APPOINTMENT_STATUS[a.status] ?? APPOINTMENT_STATUS.booked) : null;

  return (
    <Dialog open={Boolean(a)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{a?.lead.name ?? "Client"}</DialogTitle>
        </DialogHeader>

        {a && (
          <div className="grid gap-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn("rounded-md border px-2 py-0.5 text-xs", tone?.className)}
              >
                {tone?.label ?? a.status}
              </span>
              <span className="text-muted-foreground text-xs">
                booked {a.source === "voice" ? "by phone" : "at the desk"}
              </span>
              {a.bookingNumber !== null && (
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  Booking #{a.bookingNumber}
                </span>
              )}
            </div>

            <dl className="grid grid-cols-[6rem_1fr] gap-y-2">
              <dt className="text-muted-foreground text-xs pt-0.5">When</dt>
              <dd className="tabular-nums">
                {clockRange(a.startsAt, a.endsAt, timeZone)}{" "}
                <span className="text-muted-foreground">
                  ({a.durationMinutes} min)
                </span>
              </dd>

              <dt className="text-muted-foreground text-xs pt-0.5">Service</dt>
              <dd className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0 border"
                  style={{
                    background: toneFor(a.serviceText, tones).fill,
                    borderColor: toneFor(a.serviceText, tones).border,
                  }}
                  aria-hidden="true"
                />
                {a.serviceText}
              </dd>

              <dt className="text-muted-foreground text-xs pt-0.5">Stylist</dt>
              <dd>{a.stylistName}</dd>

              {a.lead.phone && (
                <>
                  <dt className="text-muted-foreground text-xs pt-0.5">Phone</dt>
                  <dd>
                    <a
                      href={`tel:${a.lead.phone}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      {a.lead.phone}
                    </a>
                  </dd>
                </>
              )}
            </dl>

            <div className="grid gap-1.5">
              <label
                htmlFor="appointment-amount"
                className="text-muted-foreground text-xs"
              >
                Taken
              </label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">£</span>
                <Input
                  id="appointment-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-8 w-28"
                />
                {a.amountMinor === null && listPriceMinor != null && (
                  <span className="text-xs text-muted-foreground">
                    list {formatMoney(listPriceMinor)}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Saved when you mark it done. This is the figure the sales
                report counts.
              </p>
            </div>

            {a.patchTestRequired && (
              <p className="flex gap-2 text-xs text-amber-400">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                Needs a skin patch test 48 hours before the colour.
              </p>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onClose} disabled={Boolean(saving)}>
            Close
          </Button>
          <div className="flex gap-2">
            {ACTIONS.filter((x) => x.status !== a?.status).map((x) => (
              <Button
                key={x.status}
                variant={x.status === "cancelled" ? "outline" : "default"}
                size="sm"
                onClick={() => setStatus(x.status)}
                disabled={Boolean(saving)}
              >
                {saving === x.status ? "…" : x.label}
              </Button>
            ))}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
