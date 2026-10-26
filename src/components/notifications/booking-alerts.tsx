"use client";

/**
 * Pop-ups in the corner for the receptionist's new bookings. Each stays until
 * the person closes it or opens the booking: nothing times out, so a booking
 * taken while they were with a client is still there when they look up.
 *
 * Top right, clear of the assistant's button in the bottom corner; across
 * the top on a phone.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { onServiceWorkerMessage } from "@/lib/push-client";
import { NEW_BOOKING } from "@/lib/service-colours";
import { hideNotice, noticesChanged, useBookingNotices, type BookingNotice } from "@/lib/use-booking-notices";
import { useT } from "@/components/providers/language-provider";
import { INTL_LOCALE, clockTime, type Lang, type Translate } from "@/lib/i18n";

/** Asks an open diary to show a booking: `detail` is { date, id }. */
export const OPEN_BOOKING = "kikai:open-booking";

function when(iso: string, timeZone: string, lang: Lang): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString(INTL_LOCALE[lang], { timeZone, weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${clockTime(at, lang, timeZone)}`;
}

function ago(iso: string, t: Translate): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return t("alerts.justNow");
  if (mins < 60) return t("alerts.minAgo", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t(hours === 1 ? "alerts.hourAgo" : "alerts.hoursAgo", { n: hours });
  const days = Math.round(hours / 24);
  return t(days === 1 ? "alerts.dayAgo" : "alerts.daysAgo", { n: days });
}

function dateIn(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

export function BookingAlerts() {
  const { notices, total, timeZone } = useBookingNotices(true);
  const { t, lang } = useT();
  const router = useRouter();
  const pathname = usePathname();

  /** The diary, on the booking's day, with it open. */
  function openBooking(date: string, id: string) {
    if (pathname?.startsWith("/calendar")) {
      window.dispatchEvent(new CustomEvent(OPEN_BOOKING, { detail: { date, id } }));
    } else {
      router.push(`/calendar?date=${date}&booking=${encodeURIComponent(id)}`);
    }
  }

  // A push notification tapped while the CRM is open in this browser.
  useEffect(() => {
    return onServiceWorkerMessage((msg) => {
      if (msg.type !== "open-booking" || !msg.url) return;
      const url = new URL(msg.url, window.location.origin);
      const date = url.searchParams.get("date");
      const id = url.searchParams.get("booking");
      // The diary marks it seen as it opens it.
      if (date && id) {
        openBooking(date, id);
      } else {
        router.push(url.pathname + url.search);
      }
    });
    // openBooking reads the current path each time it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function close(id: string | "all") {
    hideNotice(id);
    await apiFetch("/api/booking-notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id === "all" ? { action: "dismiss" } : { action: "dismiss", id }),
    }).catch(() => {});
    noticesChanged();
  }

  async function view(n: BookingNotice) {
    hideNotice(n.id);
    openBooking(dateIn(n.startsAt, timeZone), n.appointmentId);
    await apiFetch("/api/booking-notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "seen", appointmentId: n.appointmentId }),
    }).catch(() => {});
    noticesChanged();
  }

  if (notices.length === 0) return null;
  const more = total - notices.length;

  return (
    <section
      aria-label={t("alerts.region")}
      aria-live="polite"
      className="fixed z-50 inset-x-2 top-16 md:inset-x-auto md:top-4 md:right-4 md:w-[360px] flex flex-col gap-2"
      data-testid="booking-alerts"
    >
      {notices.map((n, i) => (
        <article
          key={n.id}
          className={cn(
            "rounded-xl border border-border border-l-4 bg-card p-3 shadow-raised animate-in fade-in-0 slide-in-from-top-2",
            // A phone shows the newest only; the rest are counted below it.
            i > 0 && "hidden md:block"
          )}
          style={{ borderLeftColor: NEW_BOOKING.border }}
        >
          <div className="flex items-start gap-2">
            <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0" style={{ color: NEW_BOOKING.border }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("alerts.newBooking", { ago: ago(n.createdAt, t) })}
              </p>
              <p className="mt-0.5 font-semibold truncate">{n.clientName}</p>
              <p className="text-sm truncate">{n.serviceText}</p>
              <p className="text-sm text-muted-foreground">
                {t("alerts.withStylist", { when: when(n.startsAt, timeZone, lang), stylist: n.stylistName })}
                {n.bookingNumber ? ` · #${n.bookingNumber}` : ""}
              </p>
              {n.status === "cancelled" && <p className="mt-1 text-xs font-medium text-rose-600">{t("alerts.sinceCancelled")}</p>}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("alerts.closeAbout", { name: n.clientName })}
              onClick={() => void close(n.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2.5 flex gap-2 pl-6">
            <Button size="sm" onClick={() => void view(n)}>
              {t("alerts.view")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void close(n.id)}>
              {t("alerts.close")}
            </Button>
          </div>
        </article>
      ))}
      {total > 1 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-raised">
          <span className="text-muted-foreground">
            {more > 0 ? t("alerts.countShown", { n: total, shown: notices.length }) : t("alerts.count", { n: total })}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void close("all")}>
            {t("alerts.closeAll")}
          </Button>
        </div>
      )}
    </section>
  );
}
