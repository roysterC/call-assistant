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
import { Check, CalendarDays } from "lucide-react";
import { Dialog, DialogContent, PHONE_FULL_SCREEN, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { minutesTime } from "@/lib/i18n";
import { wallTimeToUtc } from "@/lib/calendar-layout";
import { formatMoney } from "@/lib/money";
import { combineServices, type SalonService } from "@/lib/salon-config";
import { ClientPicker, CloseButton, type ClientRow } from "./client-picker";
import { BookingDetails, type BookingDraft } from "./booking-details";
import type { CalendarAppointment, DiaryBlock } from "./day-grid";
import { useT } from "@/components/providers/language-provider";

/**
 * The booking pop-ups' card: 640 wide on a computer with its header and
 * footer fixed and the middle scrolling; the whole screen on a phone.
 */
export const BOOKING_CARD = cn(
  PHONE_FULL_SCREEN,
  "flex flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[640px] md:max-h-[min(860px,calc(100dvh-2rem))]",
  // The card's own cap (100dvh less a margin) would leave the app's tab bar
  // showing under a full-screen card on a phone.
  "max-md:max-h-none max-md:overflow-hidden max-md:rounded-none max-md:pb-0"
);

export interface BookingSlot {
  stylistName: string;
  /** "HH:MM" in the salon's own clock. */
  time: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** Booking again for someone: skip choosing the client. */
  client?: ClientRow;
  /** And the services to start from. */
  serviceNames?: string[];
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
  /** "YYYY-MM-DD" of the day the diary shows, which those two belong to. */
  dayShown: string;
  onClose: () => void;
  onBooked: () => void;
  /** The slot was clicked to block it, not to book it. */
  onBlockInstead: (slot: BookingSlot) => void;
}

function describeWhen(date: string, time: string, timeZone: string, locale: string): string {
  return wallTimeToUtc(date, time, timeZone).toLocaleString(locale, {
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
  dayShown,
  onClose,
  onBooked,
  onBlockInstead,
}: NewBookingDialogProps) {
  const [step, setStep] = useState<Step>({ kind: "client" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, locale, clock } = useT();

  // Back to the start for every slot, so the last booking's client never
  // rides along into the next one.
  useEffect(() => {
    if (!slot) return;
    setStep(slot.client ? { kind: "details", client: slot.client } : { kind: "client" });
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
        setError(data.error || t("new.couldNotSave"));
        return;
      }
      const picked = draft.serviceNames
        .map((n) => services.find((s) => s.name === n))
        .filter((s): s is SalonService => Boolean(s));
      setStep({
        kind: "done",
        booked: {
          bookingNumber: data.appointment?.bookingNumber ?? null,
          clientName: client?.name ?? (draft.walkInName.trim() || t("form.walkIn")),
          whenText: describeWhen(draft.date, draft.time, timeZone, locale),
          stylistName: draft.stylistName,
          serviceText: data.appointment?.serviceText ?? draft.serviceNames.join(" + "),
          priceMinor: picked.length ? combineServices(picked).priceMinor : null,
        },
      });
      onBooked();
    } catch {
      setError(t("common.noServer"));
    } finally {
      setSaving(false);
    }
  };

  const slotWhen = slot
    ? wallTimeToUtc(slot.date, "12:00", timeZone).toLocaleDateString(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone,
      })
    : "";
  const slotTime = slot
    ? minutesTime(Number(slot.time.slice(0, 2)) * 60 + Number(slot.time.slice(3, 5)), clock)
    : "";
  const chip = "inline-flex h-[30px] items-center gap-1.5 rounded-full bg-tea-green-800 px-3 text-[13px] font-semibold";

  return (
    <Dialog open={Boolean(slot)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(BOOKING_CARD, step.kind === "done" && "sm:max-w-[520px]")}
      >
        {slot && step.kind === "client" && (
          <ClientPicker
            timeZone={timeZone}
            kicker={t("new.kickerClient")}
            title={t("new.whoFor2")}
            context={
              <div className="flex flex-wrap gap-2">
                <span className={chip}>
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  {slotWhen} · {slotTime}
                </span>
                <span className={chip}>{t("new.withStylist", { stylist: slot.stylistName })}</span>
              </div>
            }
            onClose={onClose}
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
            dayShown={dayShown}
            initial={slot}
            saving={saving}
            error={error}
            kicker={t("new.kickerDetails")}
            onBack={() => setStep({ kind: "client" })}
            onClose={onClose}
            onSubmit={(draft) => submit(step.client, draft)}
          />
        )}

        {step.kind === "done" && (
          <div className="relative flex flex-col items-center gap-5 overflow-y-auto px-8 pb-7 pt-9 text-center max-md:min-h-full max-md:px-5 max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-md:pt-16">
            <div className="absolute right-4 top-4">
              <CloseButton onClose={onClose} />
            </div>
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-8 w-8" strokeWidth={2.6} aria-hidden="true" />
            </span>
            <div>
              <DialogTitle className="font-heading text-[26px] font-extrabold">{t("new.booked")}</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("new.bookingNumber")}{" "}
                <strong className="text-base text-foreground tabular-nums">
                  {step.booked.bookingNumber !== null ? `#${step.booked.bookingNumber}` : "—"}
                </strong>
              </p>
            </div>
            <dl className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-2xl bg-tea-green-900 px-[18px] py-4 text-left text-sm">
              <dt className="text-muted-foreground">{t("new.client")}</dt>
              <dd className="font-semibold">{step.booked.clientName}</dd>
              <dt className="text-muted-foreground">{t("new.when")}</dt>
              <dd className="font-semibold">{step.booked.whenText}</dd>
              <dt className="text-muted-foreground">{t("new.stylist")}</dt>
              <dd className="font-semibold">{step.booked.stylistName}</dd>
              <dt className="text-muted-foreground">{t("new.services")}</dt>
              <dd className="font-semibold">{step.booked.serviceText}</dd>
              <dt className="text-muted-foreground">{t("new.cost")}</dt>
              <dd className="font-semibold tabular-nums">
                {step.booked.priceMinor === null ? t("form.notPriced") : formatMoney(step.booked.priceMinor)}
              </dd>
            </dl>
            <div className="mt-auto grid w-full grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setStep({ kind: "client" })}
                className="h-12 rounded-[14px] border-[1.5px] border-tea-green-700 bg-card text-[15px] font-semibold hover:bg-tea-green-900"
              >
                {t("new.bookAnother")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-12 rounded-[14px] bg-primary text-[15px] font-bold text-primary-foreground hover:bg-tea-green-100"
              >
                {t("new.done")}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
