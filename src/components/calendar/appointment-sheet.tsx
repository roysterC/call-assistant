"use client";

/**
 * A booking, opened from the diary: who, when, what, and the one thing to do
 * about it now.
 *
 * The main button follows where the booking stands, so nothing on screen
 * offers what cannot have happened yet:
 *   still to come     Change booking
 *   under way / past  Mark as done · £38, with what they paid just above it
 *   done, no-show,    what happened, with Undo, and Book again
 *   cancelled
 * The exceptions (they didn't come, cancel the booking) sit behind More, and
 * cancelling always asks first, with the option to text the client. Closing
 * is the ✕ alone: no button that dismisses the card reads like one that
 * changes the booking.
 *
 * Opens in place rather than navigating away: the diary is where someone is
 * standing when the client is in front of them. Marking a booking here does
 * not touch the stylist's Google Calendar, for the same reason the
 * appointments API does not.
 */

import { useEffect, useRef, useState } from "react";
import { MessageSquareText, MoreHorizontal, Phone, StickyNote, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, PHONE_SHEET } from "@/components/ui/dialog";
import { apiFetch, withAsOrg } from "@/lib/api-fetch";
import { bookedByMessage } from "@/lib/booked-by";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { speakablePhone } from "@/lib/phone";
import { minutesTime } from "@/lib/i18n";
import { minutesOfDay, salonDate } from "@/lib/calendar-layout";
import { cn } from "@/lib/utils";
import { toneFor, type ServiceTone } from "@/lib/service-colours";
import { clientLabel, type CalendarAppointment } from "./day-grid";
import { ClientAvatar, CloseButton } from "./client-picker";
import { useT } from "@/components/providers/language-provider";

interface AppointmentSheetProps {
  appointment: CalendarAppointment | null;
  timeZone: string;
  tones: Map<string, ServiceTone>;
  /** List price for this appointment's service, to start the amount from. */
  listPriceMinor?: number | null;
  onClose: () => void;
  onChanged: () => void;
  /** Open the booking for changing: time, stylist, services, client. */
  onEdit: () => void;
  /** A new booking for the same client and services. */
  onBookAgain: () => void;
}

type Phase = "upcoming" | "now" | "done" | "no_show" | "cancelled";

/** Whole days between two instants' salon dates. */
function daysBetween(from: Date, to: Date, timeZone: string): number {
  return Math.round((Date.parse(salonDate(to, timeZone)) - Date.parse(salonDate(from, timeZone))) / 86_400_000);
}

export function AppointmentSheet({
  appointment,
  timeZone,
  tones,
  listPriceMinor,
  onClose,
  onChanged,
  onEdit,
  onBookAgain,
}: AppointmentSheetProps) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [textOnCancel, setTextOnCancel] = useState(true);
  // What this card has done to the booking since it opened, so the result
  // (and its Undo) shows at once rather than after the diary reloads.
  const [changed, setChanged] = useState<{ status: string; amountMinor: number | null } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { t, locale, clock } = useT();

  // Start from whatever is already recorded, then the price list. Reset per
  // appointment so last client's figure never rides along into this one.
  useEffect(() => {
    if (!appointment) return;
    setAmount(minorToInput(appointment.amountMinor ?? listPriceMinor ?? null));
    setError(null);
    setNotice(null);
    setMenu(false);
    setConfirming(false);
    setTextOnCancel(true);
    setChanged(null);
  }, [appointment, listPriceMinor]);

  // The More menu closes on a click anywhere else.
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const a = appointment;
  const status = changed?.status ?? a?.status ?? "booked";
  const amountMinor = changed ? changed.amountMinor : (a?.amountMinor ?? null);
  const now = Date.now();
  const starts = a ? new Date(a.startsAt) : new Date();
  const phase: Phase =
    status === "completed"
      ? "done"
      : status === "no_show"
        ? "no_show"
        : status === "cancelled"
          ? "cancelled"
          : now >= starts.getTime()
            ? "now"
            : "upcoming";

  const setStatus = async (next: string, extra: Record<string, unknown> = {}) => {
    if (!a) return;
    setSaving(next);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { id: a.id, status: next, ...extra };
      const res = await apiFetch("/api/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t("sheet.couldNotUpdate"));
        return;
      }
      setChanged({ status: next, amountMinor: data.appointment?.amountMinor ?? amountMinor });
      setMenu(false);
      setConfirming(false);
      if (next === "cancelled" && extra.notifyClient) {
        setNotice(
          data.textSent
            ? t("sheet.cancelTexted", { name: firstName })
            : t("sheet.cancelTextFailed", { reason: data.textError ?? t("common.noServer") })
        );
      }
      onChanged();
    } catch {
      setError(t("common.noServer"));
    } finally {
      setSaving(null);
    }
  };

  if (!a) {
    return (
      <Dialog open={false} onOpenChange={(o) => !o && onClose()}>
        <DialogContent />
      </Dialog>
    );
  }

  const name = clientLabel(a.lead, t);
  const firstName = a.lead.firstName || name.split(/\s+/)[0];
  const phone = a.lead.phone ?? a.lead.contactLead?.phone ?? null;
  const tel = phone?.replace(/\s+/g, "");
  const tone = toneFor(a.serviceText, tones);
  const timeOf = (d: Date) => minutesTime(minutesOfDay(d, timeZone), clock);
  const dateText = starts.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone });
  const range = `${timeOf(starts)} – ${timeOf(new Date(a.endsAt))}`;
  const days = daysBetween(new Date(now), starts, timeZone);
  const minutesIn = Math.floor((now - starts.getTime()) / 60_000);
  const whenNote =
    phase === "upcoming"
      ? days <= 0
        ? t("sheet.today")
        : days === 1
          ? t("sheet.tomorrow")
          : t("sheet.inDays", { n: days })
      : phase === "now"
        ? now < new Date(a.endsAt).getTime()
          ? t("sheet.startedAgo", { n: Math.max(1, minutesIn) })
          : t("sheet.timePassed")
        : null;

  const how = bookedByMessage(a.notes)
    ? t("sheet.bookedByMessage", { channel: bookedByMessage(a.notes)! })
    : a.source === "voice"
      ? t("sheet.bookedByPhone")
      : a.source === "website"
        ? t("sheet.bookedOnline")
        : t("sheet.bookedAtDesk");

  const pill: Record<Phase, { label: string; className: string; dot: string }> = {
    upcoming: { label: t("status.booked"), className: "bg-tea-green-800 text-tea-green-100", dot: "bg-tea-green-300" },
    now: { label: t("status.booked"), className: "bg-tea-green-800 text-tea-green-100", dot: "bg-tea-green-300" },
    done: { label: t("sheet.doneOnly"), className: "bg-primary text-primary-foreground", dot: "bg-primary-foreground" },
    no_show: { label: t("status.no_show"), className: "bg-papaya-whip-600 text-light-bronze-200", dot: "bg-amber-600" },
    cancelled: { label: t("status.cancelled"), className: "bg-muted text-muted-foreground", dot: "bg-tea-green-400" },
  };

  const paid = parseMoney(amount);
  const markLabel = paid !== null ? t("sheet.markDone", { amount: formatMoney(paid) }) : t("sheet.markDoneOnly");
  const finished = phase === "done" || phase === "no_show" || phase === "cancelled";
  const busy = Boolean(saving);

  const outcome =
    phase === "done"
      ? {
          title: amountMinor !== null ? t("sheet.doneTook", { amount: formatMoney(amountMinor) }) : t("sheet.doneOnly"),
          className: "border-tea-green-600 bg-tea-green-900",
        }
      : phase === "no_show"
        ? { title: t("sheet.wasNoShow"), className: "border-papaya-whip-400 bg-papaya-whip-900" }
        : phase === "cancelled"
          ? { title: t("sheet.wasCancelled"), className: "border-border bg-muted/50" }
          : null;

  const secondary =
    "flex h-[52px] items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-tea-green-700 bg-card px-4 text-[15px] font-semibold hover:bg-tea-green-900 disabled:opacity-50 max-md:h-[50px]";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(PHONE_SHEET, "gap-0 overflow-visible rounded-3xl p-0 sm:max-w-[480px] max-md:rounded-b-none max-md:pb-0")}
      >
        <div className="flex items-center gap-2.5 pl-6 pr-5 pt-[18px] max-md:px-4 max-md:pt-3">
          <span className={cn("inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-bold", pill[phase].className)}>
            <span className={cn("h-[7px] w-[7px] rounded-full", pill[phase].dot)} aria-hidden="true" />
            {pill[phase].label}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
            {a.bookingNumber !== null ? `#${a.bookingNumber} · ${how}` : how}
          </span>
          <CloseButton onClose={onClose} />
        </div>

        <div className="flex items-center gap-3 px-6 pt-3 max-md:px-4 max-md:pt-2">
          <ClientAvatar name={name} regular={a.clientType !== "new"} className="h-12 w-12 text-base max-md:hidden" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate font-heading text-[22px] font-extrabold leading-tight">{name}</DialogTitle>
            {phone && <p className="mt-0.5 text-[13.5px] tabular-nums text-muted-foreground">{speakablePhone(phone)}</p>}
          </div>
          {tel && (
            <>
              <a
                href={`tel:${tel}`}
                aria-label={t("sheet.call")}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-tea-green-900 px-3 text-[13.5px] font-semibold hover:bg-tea-green-800 max-md:h-12 max-md:w-12 max-md:justify-center max-md:rounded-full max-md:bg-tea-green-800 max-md:px-0"
              >
                <Phone className="h-4 w-4 text-tea-green-200 max-md:h-5 max-md:w-5 max-md:text-tea-green-100" aria-hidden="true" />
                <span className="max-md:hidden">{t("sheet.call")}</span>
              </a>
              <a
                href={`sms:${tel}`}
                aria-label={t("sheet.text")}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-tea-green-900 px-3 text-[13.5px] font-semibold hover:bg-tea-green-800 max-md:h-12 max-md:w-12 max-md:justify-center max-md:rounded-full max-md:bg-tea-green-800 max-md:px-0"
              >
                <MessageSquareText className="h-4 w-4 text-tea-green-200 max-md:h-5 max-md:w-5 max-md:text-tea-green-100" aria-hidden="true" />
                <span className="max-md:hidden">{t("sheet.text")}</span>
              </a>
            </>
          )}
        </div>

        <div className="grid gap-3 px-6 pt-4 max-md:px-4 max-md:pt-3">
          <div className="grid gap-2 rounded-2xl bg-tea-green-900 px-4 py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-0.5">
              <span className="text-[17px] font-bold tabular-nums max-md:text-base">
                {dateText} · <span className="whitespace-nowrap">{range}</span>
              </span>
              {whenNote && (
                <span className={cn("shrink-0 text-[12.5px] font-semibold", phase === "now" ? "text-light-bronze-300" : "text-tea-green-200")}>
                  {whenNote}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border"
                style={{ background: tone.fill, borderColor: tone.border }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <strong className="font-semibold">{a.serviceText}</strong>{" "}
                <span className="text-muted-foreground">
                  · {t("form.minShort", { n: a.durationMinutes })} · {t("new.withStylist", { stylist: a.stylistName })}
                </span>
              </span>
              {listPriceMinor != null && <span className="shrink-0 font-bold tabular-nums">{formatMoney(listPriceMinor)}</span>}
            </div>
          </div>

          {a.lead.notes?.trim() && (
            <p className="flex items-start gap-2.5 whitespace-pre-line rounded-xl border border-papaya-whip-400 bg-cornsilk-700 px-3 py-2.5 text-[13px] leading-normal">
              <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-light-bronze-300" aria-hidden="true" />
              {a.lead.notes}
            </p>
          )}
          {a.notes?.trim() && (
            <p className="text-[13px] leading-normal">
              <span className="font-semibold">{t("sheet.bookingNote")}:</span>{" "}
              <span className="whitespace-pre-wrap text-muted-foreground">{a.notes}</span>
            </p>
          )}
          {a.photos && a.photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {a.photos.map((p, i) => (
                <a
                  key={p.id}
                  href={withAsOrg(`/api/chat-photos/${p.id}`)}
                  target="_blank"
                  rel="noopener"
                  className="block overflow-hidden rounded-xl border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image */}
                  <img
                    src={withAsOrg(`/api/chat-photos/${p.id}`)}
                    alt={t("sheet.photoAlt", { n: i + 1 })}
                    className="h-20 w-20 object-cover"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          )}
          {a.patchTestRequired && !finished && (
            <p className="flex gap-2 rounded-xl border border-papaya-whip-400 bg-papaya-whip-900 px-3 py-2.5 text-[13px] text-light-bronze-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t("sheet.patchTest")}
            </p>
          )}
        </div>

        {outcome && (
          <div className={cn("mx-6 mt-3.5 flex items-center gap-2.5 rounded-[14px] border px-3.5 py-3 max-md:mx-4", outcome.className)}>
            <span className="flex-1 text-sm font-semibold">{outcome.title}</span>
            <button
              type="button"
              onClick={() => setStatus("booked")}
              disabled={busy}
              className="h-[34px] rounded-[10px] border bg-card px-3 text-[13px] font-semibold hover:bg-tea-green-900 disabled:opacity-50 max-md:h-10 max-md:px-3.5"
            >
              {saving === "booked" ? "…" : t("sheet.undo")}
            </button>
          </div>
        )}

        {phase === "now" && !confirming && (
          <div className="mx-6 mt-3.5 flex items-center gap-2.5 max-md:mx-4">
            <label htmlFor="appointment-amount" className="text-sm font-semibold max-md:flex-1 max-md:text-[15px]">
              {t("sheet.theyPaid")}
            </label>
            <span className="flex h-[42px] items-center gap-1 rounded-xl border-[1.5px] border-tea-green-500 bg-card px-2.5 focus-within:border-tea-green-300 focus-within:ring-3 focus-within:ring-tea-green-800 max-md:h-[46px]">
              <span className="text-muted-foreground">£</span>
              <input
                id="appointment-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-[72px] bg-transparent text-base font-bold tabular-nums focus:outline-none"
              />
            </span>
            {listPriceMinor != null && (
              <span className="text-[12.5px] text-muted-foreground max-md:hidden">
                {t("sheet.listPrice", { price: formatMoney(listPriceMinor) })}
              </span>
            )}
          </div>
        )}

        {(error || notice) && (
          <p role="status" className={cn("mx-6 mt-3 text-[13px] max-md:mx-4", error ? "text-red-600" : "text-muted-foreground")}>
            {error ?? notice}
          </p>
        )}

        <div className="relative mt-[18px] border-t border-tea-green-800 px-6 pb-[22px] pt-4 max-md:px-4 max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {confirming ? (
            <div className="grid gap-3">
              <p className="text-base font-bold">
                {t("sheet.cancelAsk", { name: firstName, time: timeOf(starts), date: dateText })}
              </p>
              <p className="text-[13.5px] text-muted-foreground">{t("sheet.cancelFrees", { stylist: a.stylistName })}</p>
              {phone && (
                <label className="flex min-h-11 items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={textOnCancel}
                    onChange={(e) => setTextOnCancel(e.target.checked)}
                    className="h-[18px] w-[18px] accent-primary"
                  />
                  {t("sheet.textCancel", { name: firstName })}
                </label>
              )}
              <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className={cn(secondary, "max-md:order-2")}
                >
                  {t("sheet.keepIt")}
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("cancelled", { notifyClient: Boolean(phone) && textOnCancel })}
                  disabled={busy}
                  className="h-[52px] rounded-[14px] bg-red-700 text-[15px] font-bold text-white hover:bg-red-800 disabled:opacity-60 max-md:h-[54px]"
                >
                  {saving === "cancelled" ? "…" : t("sheet.cancelBooking")}
                </button>
              </div>
            </div>
          ) : finished ? (
            <button type="button" onClick={onBookAgain} disabled={busy} className={cn(secondary, "w-full")}>
              {t("sheet.bookAgain")}
            </button>
          ) : (
            <div className="flex gap-2.5 max-md:flex-col max-md:gap-2">
              <button
                type="button"
                onClick={phase === "now" ? () => setStatus("completed", { amountMinor: parseMoney(amount) }) : onEdit}
                disabled={busy}
                className="h-[52px] flex-1 rounded-[14px] bg-primary max-md:flex-none px-5 text-base font-bold text-primary-foreground hover:bg-tea-green-100 disabled:opacity-60 max-md:h-14 max-md:text-[17px]"
              >
                {phase === "now" ? (saving === "completed" ? "…" : markLabel) : t("sheet.changeBooking")}
              </button>
              <div className="flex gap-2.5 max-md:gap-2">
                {phase === "now" && (
                  <button type="button" onClick={onEdit} disabled={busy} className={cn(secondary, "max-md:flex-1")}>
                    {t("sheet.change")}
                  </button>
                )}
                <div ref={menuRef} className="relative max-md:flex-1">
                  <button
                    type="button"
                    onClick={() => setMenu((m) => !m)}
                    aria-expanded={menu}
                    aria-haspopup="menu"
                    aria-label={t("sheet.more")}
                    disabled={busy}
                    className={cn(secondary, "w-[52px] px-0 max-md:w-full")}
                  >
                    <MoreHorizontal className="h-5 w-5 max-md:hidden" aria-hidden="true" />
                    <span className="md:hidden">{menu ? t("sheet.less") : t("sheet.more")}</span>
                  </button>
                  {menu && (
                    <div
                      role="menu"
                      className="absolute bottom-[calc(100%+8px)] right-0 z-10 grid w-[260px] rounded-2xl border border-tea-green-700 bg-card p-1.5 shadow-raised max-md:fixed max-md:inset-x-4 max-md:bottom-[calc(env(safe-area-inset-bottom)+11rem)] max-md:w-auto"
                    >
                      {phase === "now" ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => setStatus("no_show")}
                          className="grid min-h-12 content-center rounded-[10px] px-3 text-left hover:bg-tea-green-900"
                        >
                          <span className="text-[14.5px] font-semibold">{saving === "no_show" ? "…" : t("sheet.noShowItem")}</span>
                          <span className="text-xs text-muted-foreground">{t("sheet.noShowHint")}</span>
                        </button>
                      ) : (
                        <span className="px-3 py-2 text-xs text-muted-foreground">{t("sheet.noShowLater")}</span>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenu(false);
                          setConfirming(true);
                        }}
                        className="min-h-12 rounded-[10px] px-3 text-left text-[14.5px] font-semibold text-red-700 hover:bg-red-50"
                      >
                        {t("sheet.cancelItem")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
