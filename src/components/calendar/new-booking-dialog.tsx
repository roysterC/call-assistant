"use client";

/**
 * Take a booking at the desk: client, then details, then the booking number.
 *
 * Client first because it is the question the desk can always answer (the
 * person is on the phone or standing there), and because knowing who it is
 * answers two things the details step would otherwise ask: whether they are
 * new — which decides the skin test — and how to reach them.
 *
 * The booking number is shown once the booking is saved. It is allocated in
 * the same transaction as the appointment (src/lib/booking-number.ts), so it
 * cannot be known sooner without either reserving numbers that abandoned
 * bookings would leave as gaps, or showing one the phone assistant might take
 * in the meantime.
 */

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  PHONE_FULL_SCREEN,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { wallTimeToUtc } from "@/lib/calendar-layout";
import { formatMoney } from "@/lib/money";
import { combineServices, type SalonService } from "@/lib/salon-config";
import { ClientPicker, type ClientRow } from "./client-picker";
import { BookingDetails, type BookingDraft } from "./booking-details";
import type { CalendarAppointment, DiaryBlock } from "./day-grid";

export interface BookingSlot {
  stylistName: string;
  /** "HH:MM" in the salon's own clock. */
  time: string;
  /** "YYYY-MM-DD". */
  date: string;
}

interface Booked {
  bookingNumber: number | null;
  clientName: string;
  whenText: string;
  stylistName: string;
  serviceText: string;
  priceMinor: number | null;
}

type Step =
  | { kind: "client" }
  | { kind: "details"; client: ClientRow | null }
  | { kind: "done"; booked: Booked };

interface NewBookingDialogProps {
  slot: BookingSlot | null;
  services: SalonService[];
  stylists: string[];
  /** Salon zone, so the chosen wall-clock time is sent as the right instant. */
  timeZone: string;
  /** The appointments on the day shown, for the clash warning. */
  dayAppointments: CalendarAppointment[];
  /** Blocked time on the day shown, for the same. */
  dayBlocks: DiaryBlock[];
  onClose: () => void;
  onBooked: () => void;
  /** The slot was clicked to block it, not to book it. */
  onBlockInstead: (slot: BookingSlot) => void;
}

function describeWhen(date: string, time: string, timeZone: string): string {
  return wallTimeToUtc(date, time, timeZone).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

export function NewBookingDialog({
  slot,
  services,
  stylists,
  timeZone,
  dayAppointments,
  dayBlocks,
  onClose,
  onBooked,
  onBlockInstead,
}: NewBookingDialogProps) {
  const [step, setStep] = useState<Step>({ kind: "client" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Back to the start for every slot, so the last booking's client never
  // rides along into the next one.
  useEffect(() => {
    if (!slot) return;
    setStep({ kind: "client" });
    setError(null);
  }, [slot]);

  const submit = async (client: ClientRow | null, draft: BookingDraft) => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: wallTimeToUtc(draft.date, draft.time, timeZone).toISOString(),
          stylistName: draft.stylistName,
          serviceNames: draft.serviceNames,
          durationMinutes: draft.durationMinutes,
          ...(client
            ? { leadId: client.id }
            : { clientName: draft.walkInName.trim() || undefined }),
          clientType: !client ? "unknown" : client.visits > 0 ? "returning" : "new",
          notes: draft.notes || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save that booking.");
        return;
      }
      const picked = draft.serviceNames
        .map((n) => services.find((s) => s.name === n))
        .filter((s): s is SalonService => Boolean(s));
      setStep({
        kind: "done",
        booked: {
          bookingNumber: data.appointment?.bookingNumber ?? null,
          clientName: client?.name ?? (draft.walkInName.trim() || "Walk-in"),
          whenText: describeWhen(draft.date, draft.time, timeZone),
          stylistName: draft.stylistName,
          serviceText: data.appointment?.serviceText ?? draft.serviceNames.join(" + "),
          priceMinor: picked.length ? combineServices(picked).priceMinor : null,
        },
      });
      onBooked();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const title =
    step.kind === "client"
      ? slot
        ? `${slot.time} with ${slot.stylistName}: who is it for?`
        : "New booking"
      : step.kind === "details"
        ? "Booking details"
        : "Booked";

  return (
    <Dialog open={Boolean(slot)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={`${step.kind === "client" ? "sm:max-w-3xl" : "sm:max-w-lg"} ${PHONE_FULL_SCREEN}`}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {step.kind !== "done" && (
            <p className="text-xs text-muted-foreground">
              Step {step.kind === "client" ? 1 : 2} of 2 ·{" "}
              {step.kind === "client"
                ? "Pick a client, or add a new one"
                : "The booking number is given when you book"}
            </p>
          )}
        </DialogHeader>

        {slot && step.kind === "client" && (
          <ClientPicker
            timeZone={timeZone}
            onPick={(client) => {
              setError(null);
              setStep({ kind: "details", client });
            }}
            onWalkIn={() => {
              setError(null);
              setStep({ kind: "details", client: null });
            }}
            onBlockInstead={() => onBlockInstead(slot)}
          />
        )}

        {slot && step.kind === "details" && (
          <BookingDetails
            client={step.client}
            services={services}
            stylists={stylists}
            timeZone={timeZone}
            dayAppointments={dayAppointments}
            dayBlocks={dayBlocks}
            dayShown={slot.date}
            initial={slot}
            saving={saving}
            error={error}
            onBack={() => setStep({ kind: "client" })}
            onSubmit={(draft) => submit(step.client, draft)}
          />
        )}

        {step.kind === "done" && (
          <div className="grid gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Booking number</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {step.booked.bookingNumber !== null
                    ? `#${step.booked.bookingNumber}`
                    : "—"}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground text-xs pt-0.5">Client</dt>
              <dd>{step.booked.clientName}</dd>
              <dt className="text-muted-foreground text-xs pt-0.5">When</dt>
              <dd>{step.booked.whenText}</dd>
              <dt className="text-muted-foreground text-xs pt-0.5">Stylist</dt>
              <dd>{step.booked.stylistName}</dd>
              <dt className="text-muted-foreground text-xs pt-0.5">Services</dt>
              <dd>{step.booked.serviceText}</dd>
              <dt className="text-muted-foreground text-xs pt-0.5">Cost</dt>
              <dd className="tabular-nums">
                {step.booked.priceMinor === null
                  ? "Not priced"
                  : formatMoney(step.booked.priceMinor)}
              </dd>
            </dl>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
