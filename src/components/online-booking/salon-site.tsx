/**
 * A salon's own one-page website (/s/<slug>), built entirely from its CRM
 * settings: services and prices, team, opening hours, address and phone. The
 * salon edits those once, in Settings, and the site and the diary can never
 * disagree.
 *
 * Every "Book" opens the booking flow; a service's own Book button skips
 * choosing the service, and "Next free" skips to the last step.
 */

import Link from "next/link";
import { ArrowRight, MapPin, Phone } from "lucide-react";
import { formatMoneyShort } from "@/lib/money";
import type { PublicSalon, PublicSlot } from "@/lib/online-booking";
import { brandStyle, durationText, longDay, timeText } from "./format";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function withQuery(path: string, q: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return `${path}${s ? `?${s}` : ""}`;
}

export function SalonSite({
  salon,
  takesBookings,
  nextFree,
  bookPath,
}: {
  salon: PublicSalon;
  takesBookings: boolean;
  /** The booking flow's path on the address this page was opened on. */
  bookPath: string;
  /** The soonest free time for the first service, if there is one. */
  nextFree: { service: string; slot: PublicSlot; date: string } | null;
}) {
  const brandButton = { background: "var(--brand)", color: "var(--brand-fg)" };
  const tel = salon.phone ? `tel:${salon.phone.replace(/\s+/g, "")}` : null;
  const hasHours = salon.hours.length > 0;

  return (
    <div className="h-dvh overflow-y-auto bg-white text-stone-900" style={brandStyle(salon.brandColor)}>
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-6">
          <a href="#top" className="flex-1 truncate font-heading text-xl font-extrabold tracking-tight">
            {salon.name}
          </a>
          <nav aria-label="Sections" className="hidden gap-6 text-[0.95rem] font-medium md:flex">
            {salon.services.length > 0 && <a href="#services">Services</a>}
            {salon.stylists.length > 0 && <a href="#team">Team</a>}
            <a href="#visit">Visit us</a>
          </nav>
          {tel && (
            <a href={tel} className="hidden text-[0.95rem] font-medium md:inline" aria-label={`Call ${salon.phone}`}>
              {salon.phone}
            </a>
          )}
          {tel && (
            <a
              href={tel}
              aria-label="Call the salon"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-stone-200 md:hidden"
            >
              <Phone className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          {takesBookings && (
            <Link
              href={withQuery(bookPath)}
              className="hidden rounded-full px-5 py-3 text-[0.95rem] font-semibold md:inline-block"
              style={brandButton}
            >
              Book now
            </Link>
          )}
        </div>
      </header>

      <main id="top" className="pb-28 md:pb-0">
        <section className="mx-auto max-w-6xl px-4 pb-12 pt-10 md:px-6 md:pb-16 md:pt-16">
          <div className="max-w-2xl space-y-5">
            <h1 className="font-heading text-4xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
              {salon.headline || salon.name}
            </h1>
            {salon.about && (
              <p className="whitespace-pre-line text-lg leading-relaxed text-stone-600">{salon.about}</p>
            )}
            {takesBookings && (
              <div className="flex flex-wrap gap-3">
                <Link
                  href={withQuery(bookPath)}
                  className="rounded-full px-7 py-4 text-[1.05rem] font-semibold"
                  style={brandButton}
                >
                  Book an appointment
                </Link>
                {salon.services.length > 0 && (
                  <a href="#services" className="rounded-full border border-stone-300 px-6 py-4 text-[1.05rem] font-semibold">
                    See prices
                  </a>
                )}
              </div>
            )}
            {takesBookings && nextFree && (
              <Link
                href={withQuery(bookPath, {
                  service: nextFree.service,
                  start: nextFree.slot.start,
                  stylist: nextFree.slot.stylist,
                })}
                className="flex max-w-md items-center gap-3.5 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3.5"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-700" aria-hidden="true" />
                <span className="flex flex-1 flex-col">
                  <span className="text-sm text-stone-600">Next free appointment</span>
                  <span className="font-semibold">
                    {longDay(nextFree.date, salon.timeZone).split(",")[0]} {timeText(nextFree.slot.start, salon.timeZone)} ·{" "}
                    {nextFree.service}
                  </span>
                </span>
                <span className="font-semibold text-[var(--brand-ink)]">Book it</span>
              </Link>
            )}
            {!takesBookings && salon.phone && (
              <p className="text-lg">
                To book, ring us on{" "}
                <a className="font-semibold underline" href={tel ?? undefined}>
                  {salon.phone}
                </a>
                .
              </p>
            )}
          </div>
        </section>

        {salon.services.length > 0 && (
          <section id="services" className="scroll-mt-20 border-y border-stone-200 bg-stone-50">
            <div className="mx-auto max-w-6xl space-y-6 px-4 py-12 md:px-6 md:py-16">
              <h2 className="font-heading text-3xl font-extrabold tracking-tight">Services &amp; prices</h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {salon.services.map((s) => (
                  <li key={s.name} className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-white px-5 py-4">
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[1.05rem] font-semibold">{s.name}</span>
                      <span className="text-sm text-stone-600">
                        {durationText(s.durationMinutes)}
                        {s.requiresPatchTest ? " · skin test for new clients" : ""}
                      </span>
                    </span>
                    {s.priceMinor !== null && (
                      <span className="text-[1.05rem] font-semibold">from {formatMoneyShort(s.priceMinor)}</span>
                    )}
                    {takesBookings && (
                      <Link
                        href={withQuery(bookPath, { service: s.name })}
                        aria-label={`Book ${s.name}`}
                        className="rounded-full border px-4 py-2.5 text-[0.95rem] font-semibold text-[var(--brand-ink)]"
                        style={{ borderColor: "var(--brand-ink)" }}
                      >
                        Book
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              {salon.services.some((s) => s.priceMinor !== null) && (
                <p className="text-sm text-stone-600">Prices are a guide and can vary with hair length and thickness.</p>
              )}
            </div>
          </section>
        )}

        {salon.stylists.length > 0 && (
          <section id="team" className="mx-auto max-w-6xl scroll-mt-20 space-y-6 px-4 py-12 md:px-6 md:py-16">
            <h2 className="font-heading text-3xl font-extrabold tracking-tight">The team</h2>
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {salon.stylists.map((p) => (
                <li key={p.name} className="flex flex-col gap-1 rounded-2xl border border-stone-200 p-5">
                  <span className="font-heading text-lg font-bold">{p.name}</span>
                  {p.role && <span className="text-sm text-stone-600">{p.role}</span>}
                  {takesBookings && (
                    <Link
                      href={withQuery(bookPath, { stylist: p.name })}
                      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--brand-ink)]"
                    >
                      Book with {p.name} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section id="visit" className="scroll-mt-20 border-t border-stone-200 bg-stone-50">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-2 md:px-6 md:py-16">
            <div className="space-y-4">
              <h2 className="font-heading text-3xl font-extrabold tracking-tight">Visit us</h2>
              {salon.address && <p className="whitespace-pre-line text-lg leading-relaxed">{salon.address}</p>}
              <div className="flex flex-wrap gap-3">
                {salon.address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${salon.name}, ${salon.address}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-5 py-3 font-semibold"
                  >
                    <MapPin className="h-4 w-4" aria-hidden="true" /> Get directions
                  </a>
                )}
                {tel && (
                  <a href={tel} className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-5 py-3 font-semibold">
                    <Phone className="h-4 w-4" aria-hidden="true" /> Call {salon.phone}
                  </a>
                )}
              </div>
            </div>
            {hasHours && (
              <div className="space-y-3">
                <h3 className="font-heading text-xl font-bold">Opening hours</h3>
                <dl className="grid max-w-sm grid-cols-[8rem_1fr] gap-x-4 gap-y-2">
                  {WEEK.map((d) => {
                    const h = salon.hours.find((x) => x.day === d);
                    return (
                      <div key={d} className="contents">
                        <dt className="text-stone-600">{DAY_NAMES[d]}</dt>
                        <dd className="font-medium tabular-nums">{!h || h.closed ? "Closed" : `${h.open} – ${h.close}`}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-4 py-6 text-sm text-stone-600 md:px-6">
          <span>© {salon.name}</span>
          <span>Online booking by Kikai</span>
        </div>
      </footer>

      {takesBookings && (
        <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 md:hidden">
          <Link
            href={withQuery(bookPath)}
            className="flex h-14 items-center justify-center rounded-full text-[1.05rem] font-semibold"
            style={brandButton}
          >
            Book an appointment
          </Link>
        </div>
      )}
    </div>
  );
}
