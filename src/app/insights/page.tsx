"use client";

/**
 * Insights: what Kikai has booked the salon, as one big number. This week,
 * month or year, or ever; a joke or two about it; what it is in the salon's
 * own favourite service; and where it came from (a call, or which chat).
 */

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/providers/language-provider";
import { useMe } from "@/components/providers/me-provider";
import { apiFetch } from "@/lib/api-fetch";
import { formatMoneyShort } from "@/lib/money";
import type { MessageKey } from "@/lib/i18n";
import type { BookedChannel, BookedValue } from "@/lib/booked-value";
import { cn } from "@/lib/utils";

type Period = "week" | "month" | "year" | "all";
const PERIODS: Period[] = ["week", "month", "year", "all"];

interface Booked extends BookedValue {
  period: Period;
  /** The first day counted, "YYYY-MM-DD"; null for "all" before any booking. */
  from: string | null;
  today: string;
}

/** The chats' own names stay as they are in every language. */
const BRAND: Partial<Record<BookedChannel, string>> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Messenger",
};

const CHANNEL_BG: Record<BookedChannel, string> = {
  phone: "bg-primary",
  whatsapp: "bg-tea-green-400",
  instagram: "bg-light-bronze-400",
  facebook: "bg-beige-400",
  website: "bg-tea-green-500",
};

/** A flat white, for the coffee joke. */
const COFFEE_MINOR = 350;

/** Whole pounds: the big number is no place for pence. */
const pounds = (minor: number) => formatMoneyShort(Math.round(minor / 100) * 100);

/** The number counting up to itself when it arrives, unless motion is turned down. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  // Where the number is now, so a new target counts on from there.
  const now = useRef(target);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = now.current;
    if (start === target) return;
    const began = performance.now();
    let frame = 0;
    const tick = (at: number) => {
      const p = reduce ? 1 : Math.min(1, (at - began) / 700);
      now.current = Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3)));
      setShown(now.current);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

export default function InsightsPage() {
  const { t, locale } = useT();
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<Booked | null>(null);
  // The period whose figures could not be loaded, if any.
  const [failedFor, setFailedFor] = useState<Period | null>(null);
  const [joke, setJoke] = useState(0);
  // Only the latest period's answer is shown, however the requests come back.
  const request = useRef(0);
  // Owners only: staff are sent on to the diary, so this waits until it is
  // known who is signed in rather than asking for figures it will be refused.
  const me = useMe();
  const isOwner = me !== null && me.role !== "member";

  useEffect(() => {
    if (!isOwner) return;
    const id = ++request.current;
    apiFetch(`/api/insights/booked?period=${period}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Booked) => {
        if (id !== request.current) return;
        setData(d);
        setFailedFor(null);
      })
      .catch(() => {
        if (id === request.current) setFailedFor(period);
      });
  }, [period, isOwner]);

  const shown = data && data.period === period ? data : null;
  const failed = failedFor === period && !shown;
  const total = useCountUp(shown?.totalMinor ?? 0);

  const when = (() => {
    if (!shown) return "";
    const day = (iso: string, opts: Intl.DateTimeFormatOptions) =>
      new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { ...opts, timeZone: "UTC" });
    if (period === "week") return t("insights.whenWeek");
    if (period === "month") return t("insights.whenMonth", { month: day(shown.today, { month: "long" }) });
    if (period === "year") return t("insights.whenYear", { year: shown.today.slice(0, 4) });
    return shown.from ? t("insights.whenAll", { date: day(shown.from, { day: "numeric", month: "long", year: "numeric" }) }) : t("insights.whenNever");
  })();

  const favouriteCount = shown?.favourite ? Math.floor(shown.totalMinor / shown.favourite.priceMinor) : 0;

  const jokes: string[] = [];
  if (shown && shown.bookings === 0) {
    jokes.push(t("insights.joke.waiting"), t("insights.joke.lonely"));
  } else if (shown) {
    if (shown.favourite && favouriteCount > 0) {
      jokes.push(t("insights.joke.favourite", { count: favouriteCount, service: shown.favourite.service.toLowerCase() }));
    }
    if (shown.afterHoursMinor) jokes.push(t("insights.joke.afterHours", { value: pounds(shown.afterHoursMinor) }));
    if (shown.bookings > 1) jokes.push(t("insights.joke.noBreaks", { n: shown.bookings }));
    const coffees = Math.floor(shown.totalMinor / COFFEE_MINOR);
    if (coffees > 1) jokes.push(t("insights.joke.coffees", { n: coffees.toLocaleString(locale) }));
    jokes.push(t("insights.joke.hold"));
  }

  const facts: { emoji: string; big: string; small: string; className: string }[] = [];
  if (shown?.favourite && favouriteCount > 0) {
    facts.push({
      emoji: "💅",
      big: t("insights.factFavourite", { count: favouriteCount, service: shown.favourite.service }),
      small: t("insights.factFavouriteSmall", { price: formatMoneyShort(shown.favourite.priceMinor) }),
      className: "bg-cornsilk-500",
    });
  }
  if (shown && shown.afterHoursMinor !== null) {
    facts.push({ emoji: "🌙", big: pounds(shown.afterHoursMinor), small: t("insights.factAfterSmall"), className: "bg-tea-green-800" });
  }
  if (shown) {
    facts.push({
      emoji: "☕",
      big: t("insights.factTea"),
      small: t("insights.factTeaSmall"),
      // A phone has room for two; this one is only for fun.
      className: cn("bg-papaya-whip-500", facts.length >= 2 && "max-md:hidden"),
    });
  }

  const periodLabel = (p: Period, short: boolean) => t(`insights.${p}${short ? "Short" : ""}` as MessageKey);

  return (
    <div className="mx-auto w-full max-w-5xl pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-[26px] font-extrabold tracking-tight">{t("insights.title")}</h1>
        <div
          role="tablist"
          aria-label={t("insights.period")}
          className="grid w-full grid-cols-4 rounded-xl bg-muted p-[3px] md:ml-auto md:flex md:w-auto"
        >
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                "h-[34px] rounded-[9px] px-3.5 text-[13px] font-semibold transition-colors md:h-8",
                period === p ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="md:hidden">{periodLabel(p, true)}</span>
              <span className="max-md:hidden">{periodLabel(p, false)}</span>
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <p role="alert" className="py-16 text-center text-muted-foreground">
          {t("insights.loadFailed")}
        </p>
      ) : (
        <>
          {/* The number. */}
          <section
            aria-busy={!shown}
            className="relative mt-4 overflow-hidden rounded-3xl bg-tea-green-100 px-[22px] pb-5 pt-6 text-white md:mt-5 md:rounded-[28px] md:px-12 md:pb-9 md:pt-10"
          >
            <span aria-hidden="true" className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/[0.06] md:h-[340px] md:w-[340px]" />
            <span aria-hidden="true" className="absolute -bottom-32 right-32 hidden h-56 w-56 rounded-full bg-white/[0.04] md:block" />
            <div className="relative">
              <p className="text-[11.5px] font-bold uppercase tracking-[0.09em] text-tea-green-500 md:text-[13px]">
                {t("insights.kicker")}
              </p>
              <p className="mt-1.5 font-heading text-[62px] font-extrabold leading-none tracking-[-0.035em] tabular-nums md:text-[112px]">
                {shown ? pounds(total) : <span className="inline-block h-[62px] w-56 animate-pulse rounded-2xl bg-white/10 md:h-[112px] md:w-[26rem]" />}
              </p>
              <p className="mt-2 min-h-6 text-[15px] font-semibold text-tea-green-800 first-letter:uppercase md:mt-3 md:text-[19px]">
                {shown &&
                  (shown.bookings === 0
                    ? t("insights.nothingYet", { when })
                    : shown.bookings === 1
                      ? t("insights.fromOne", { when })
                      : t("insights.fromMany", { when, n: shown.bookings.toLocaleString(locale) }))}
              </p>
              {jokes.length > 0 && (
                <div className="mt-4 flex flex-col items-start gap-2.5 md:mt-6 md:flex-row md:items-center md:gap-3.5">
                  <p aria-live="polite" className="min-h-[3.75rem] max-w-2xl text-[14.5px] leading-normal text-cornsilk-500 md:min-h-0 md:text-base">
                    “{jokes[joke % jokes.length]}”
                  </p>
                  {jokes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setJoke((j) => j + 1)}
                      className="h-10 shrink-0 rounded-full border border-primary bg-white/10 px-4 text-[13.5px] font-bold text-white hover:bg-white/15 md:ml-auto md:h-[38px] md:text-[13px]"
                    >
                      {t("insights.tellAnother")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* What that is, in the salon's own terms. */}
          {facts.length > 0 && (
            <div className="mt-2.5 grid grid-cols-2 gap-2.5 md:mt-4 md:grid-cols-3 md:gap-3.5">
              {facts.map((f) => (
                <div key={f.emoji} className={cn("rounded-[18px] p-3.5 md:rounded-[20px] md:px-5 md:py-[18px]", f.className)}>
                  <p className="text-[22px] md:text-[28px]" aria-hidden="true">
                    {f.emoji}
                  </p>
                  <p className="mt-1 break-words font-heading text-lg font-extrabold leading-tight tabular-nums md:mt-2 md:text-[26px]">{f.big}</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground md:text-[13.5px]">{f.small}</p>
                </div>
              ))}
            </div>
          )}

          {/* Where it came from. */}
          {shown && shown.channels.length > 0 && (
            <section className="mt-2.5 rounded-[18px] border border-border bg-card px-4 py-3.5 md:mt-4 md:rounded-[20px] md:px-[22px] md:py-[18px]">
              <div className="flex items-baseline">
                <h2 className="text-sm font-bold md:text-[15px]">{t("insights.whereFrom")}</h2>
                <span className="ml-auto text-[12.5px] text-muted-foreground md:text-[13px]">
                  {shown.bookings === 1 ? t("insights.bookingsOne") : t("insights.bookingsMany", { n: shown.bookings.toLocaleString(locale) })}
                </span>
              </div>
              {shown.totalMinor > 0 && (
                <div aria-hidden="true" className="mt-2.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full md:mt-3 md:h-3.5 md:gap-[3px]">
                  {shown.channels
                    .filter((c) => c.valueMinor > 0)
                    .map((c) => (
                      <span key={c.channel} className={CHANNEL_BG[c.channel]} style={{ flexGrow: c.valueMinor }} />
                    ))}
                </div>
              )}
              <ul className="mt-2 md:mt-3 md:flex md:flex-wrap md:gap-x-7 md:gap-y-1">
                {shown.channels.map((c) => (
                  <li key={c.channel} className="flex h-[26px] items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-[3px]", CHANNEL_BG[c.channel])} aria-hidden="true" />
                    <span className="text-[13.5px] text-muted-foreground">
                      {BRAND[c.channel] ?? t(`insights.channel.${c.channel}` as MessageKey)}
                    </span>
                    <strong className="text-[13.5px] tabular-nums max-md:ml-auto md:text-sm">{pounds(c.valueMinor)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {shown && (
            <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">
              {t("insights.footnote")}
              {shown.unpriced > 0 &&
                ` ${shown.unpriced === 1 ? t("insights.unpricedOne") : t("insights.unpricedMany", { n: shown.unpriced })}`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
