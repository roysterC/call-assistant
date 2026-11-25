/**
 * A salon's own one-page website (/s/<slug>), built entirely from its CRM
 * settings: treatments, team, opening hours, address, phone and brand colour.
 * The salon edits those once, in Settings, and the site and the diary can
 * never disagree.
 *
 * The look is "Atelier": a serif for headings, the salon's colour for what
 * can be tapped. Treatments are tiles, not a price list: a tile opens the
 * booking flow on that treatment, where its options, prices and times are.
 * "Next free" skips straight to the last step.
 */

import localFont from "next/font/local";
import { ArrowRight, MapPin, MessageCircle, Phone } from "lucide-react";
import { BookLink } from "./book-link";
import { TreatmentArt, artBackground } from "./treatment-art";
import { formatMoneyShort } from "@/lib/money";
import type { PublicSalon, PublicSlot } from "@/lib/online-booking";
import { lowestPrice, openDaysText, openStatus, treatmentTiles, weekHours, whenText } from "@/lib/online-booking/salon-page";
import { brandStyle, timeText } from "./format";

// The headings' serif ships with the app, like its other fonts (app/layout.tsx).
const serif = localFont({
  src: "../../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2",
  variable: "--font-salon-serif",
  adjustFontFallback: false,
});
const serifVietnamese = localFont({
  src: "../../../node_modules/@fontsource-variable/fraunces/files/fraunces-vietnamese-wght-normal.woff2",
  variable: "--font-salon-serif-vi",
  adjustFontFallback: false,
});
const SERIF = "var(--font-salon-serif), var(--font-salon-serif-vi), Georgia, serif";

const surface = "#f6f1ef";
const rule = "#ece6e3";
const muted = "#6b6469";

function withQuery(path: string, q: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return `${path}${s ? `?${s}` : ""}`;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] font-bold uppercase tracking-[0.1em] text-[var(--brand-ink)]">{children}</span>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="m-0 text-[36px] font-normal leading-[1.05] tracking-[-0.02em] md:text-[52px]" style={{ fontFamily: SERIF }}>
      {children}
    </h2>
  );
}

export function SalonSite({
  salon,
  takesBookings,
  nextFree,
  bookPath,
  messageUs,
}: {
  salon: PublicSalon;
  takesBookings: boolean;
  /** The booking flow's path on the address this page was opened on. */
  bookPath: string;
  /** The soonest free time for the first service, if there is one. */
  nextFree: { service: string; slot: PublicSlot; date: string } | null;
  /** Where to send a photo of a design to be quoted: the salon's Instagram or WhatsApp. */
  messageUs: { label: string; href: string } | null;
}) {
  const brandButton = { background: "var(--brand)", color: "var(--brand-fg)" };
  const tel = salon.phone ? `tel:${salon.phone.replace(/\s+/g, "")}` : null;
  const status = openStatus(salon.hours, salon.timeZone);
  const week = weekHours(salon.hours, salon.timeZone);
  const hasHours = week.some((d) => !d.closed);
  const tiles = treatmentTiles(salon.services);
  const lowest = lowestPrice(salon.services);
  const days = openDaysText(salon.hours);
  const facts = [
    lowest && { title: `From ${formatMoneyShort(lowest.minor)}`, detail: lowest.service },
    days && { title: days.title, detail: days.detail },
    salon.stylists.length > 1 && {
      title: `${salon.stylists.length} nail technicians`,
      detail: "Choose who you see, or anyone",
    },
    takesBookings && { title: "Book any time", detail: "Online, day or night" },
  ].filter((f): f is { title: string; detail: string } => Boolean(f));
  const maps = salon.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${salon.name}, ${salon.address}`)}`
    : null;

  return (
    <div
      className={`${serif.variable} ${serifVietnamese.variable} h-dvh overflow-y-auto bg-white text-[#1c1a1e]`}
      style={brandStyle(salon.brandColor)}
    >
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur" style={{ borderColor: rule }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:h-[76px] md:px-8">
          <a href="#top" className="flex-1 truncate text-[22px] font-medium tracking-[-0.01em] md:text-[26px]" style={{ fontFamily: SERIF }}>
            {salon.name}
          </a>
          <nav aria-label="Sections" className="hidden gap-7 text-[15px] font-semibold text-[#4a444a] md:flex">
            {tiles.length > 0 && <a href="#treatments">Treatments</a>}
            {salon.stylists.length > 0 && <a href="#team">Team</a>}
            <a href="#visit">Visit</a>
          </nav>
          {tel && (
            <>
              <a href={tel} className="hidden text-[15px] font-semibold text-[#4a444a] lg:inline">
                {salon.phone}
              </a>
              <a
                href={tel}
                aria-label={`Call ${salon.phone}`}
                className="flex h-12 w-12 items-center justify-center rounded-full border-[1.5px] lg:hidden"
                style={{ borderColor: "#e2dbd8" }}
              >
                <Phone className="h-5 w-5" aria-hidden="true" />
              </a>
            </>
          )}
          {takesBookings && (
            <BookLink
              href={withQuery(bookPath)}
              className="hidden h-12 items-center rounded-full px-6 text-[15px] font-bold md:inline-flex"
              style={brandButton}
            >
              Book now
            </BookLink>
          )}
        </div>
      </header>

      <main id="top" className="pb-28 md:pb-0">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-12 pt-8 md:grid-cols-2 md:gap-16 md:px-8 md:pb-24 md:pt-20">
          <div className="flex flex-col gap-6 md:gap-7">
            {status && (
              <span
                className="inline-flex h-8 items-center gap-2.5 self-start rounded-full px-3.5 text-sm font-semibold text-[#4a444a]"
                style={{ background: surface }}
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ background: status.open ? "#2f7d4f" : "#9a9196" }}
                />
                {status.text}
              </span>
            )}
            <h1
              className="m-0 text-[42px] font-normal leading-[1.03] tracking-[-0.025em] md:text-[clamp(48px,5.6vw,76px)]"
              style={{ fontFamily: SERIF }}
            >
              {salon.headline || salon.name}
            </h1>
            {salon.about && <p className="m-0 max-w-[520px] whitespace-pre-line text-[17px] leading-relaxed text-[#5a535a] md:text-lg">{salon.about}</p>}
            {takesBookings && (
              <div className="flex flex-wrap gap-3">
                <BookLink
                  href={withQuery(bookPath)}
                  className="inline-flex h-14 items-center rounded-full px-7 text-[17px] font-bold"
                  style={brandButton}
                >
                  Book an appointment
                </BookLink>
                {tiles.length > 0 && (
                  <a
                    href="#treatments"
                    className="inline-flex h-14 items-center rounded-full border-[1.5px] px-6 text-[17px] font-semibold"
                    style={{ borderColor: "#d9d1cd" }}
                  >
                    See treatments
                  </a>
                )}
              </div>
            )}
            {takesBookings && nextFree && (
              <BookLink
                href={withQuery(bookPath, {
                  service: nextFree.service,
                  start: nextFree.slot.start,
                  stylist: nextFree.slot.stylist,
                })}
                className="flex max-w-[520px] items-center gap-4 rounded-[20px] px-5 py-4"
                style={{ background: surface }}
              >
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: muted }}>
                    Next free
                  </span>
                  <span className="text-base font-semibold md:text-[17px]">
                    {whenText(nextFree.date, timeText(nextFree.slot.start, salon.timeZone), salon.timeZone)} · {nextFree.service}
                    {nextFree.slot.stylist && salon.stylists.length > 1 ? ` with ${nextFree.slot.stylist}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--brand-ink)]">
                  Book it <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </BookLink>
            )}
          </div>

          <div aria-hidden="true" className="relative h-[230px] overflow-hidden rounded-3xl md:h-[460px] md:rounded-[32px]" style={{ background: surface }}>
            <TreatmentArt art="other" />
          </div>
        </section>

        {facts.length > 0 && (
          <section aria-label="At a glance" className="border-y" style={{ borderColor: rule }}>
            <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-4 gap-y-5 px-4 py-5 md:grid-cols-4 md:gap-6 md:px-8 md:py-7">
              {facts.map((f) => (
                <div key={f.title} className="flex flex-col gap-0.5">
                  <span className="text-[21px] md:text-[26px]" style={{ fontFamily: SERIF }}>
                    {f.title}
                  </span>
                  <span className="text-[13px] md:text-sm" style={{ color: muted }}>
                    {f.detail}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {tiles.length > 0 && (
          <section id="treatments" className="mx-auto flex max-w-6xl scroll-mt-20 flex-col gap-8 px-4 pb-10 pt-14 md:gap-14 md:px-8 md:pb-24 md:pt-28">
            <div className="flex flex-wrap items-end justify-between gap-4 md:gap-6">
              <div className="flex max-w-[620px] flex-col gap-2.5 md:gap-3.5">
                <Eyebrow>Treatments</Eyebrow>
                <SectionTitle>What would you like?</SectionTitle>
              </div>
              <p className="m-0 max-w-[380px] text-sm md:text-[15px]" style={{ color: muted }}>
                {takesBookings
                  ? "Tap one to pick its options and a time. Prices and lengths are shown as you book."
                  : "Ring us to book any of these."}
              </p>
            </div>

            <ul className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] md:gap-6">
              {tiles.map((t) => {
                const inner = (
                  <>
                    <div
                      aria-hidden="true"
                      className="relative h-[172px] overflow-hidden rounded-[22px] md:h-[300px] md:rounded-[28px]"
                      style={{ background: artBackground(t.art) }}
                    >
                      <TreatmentArt art={t.art} />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[21px] leading-tight md:text-[28px]" style={{ fontFamily: SERIF }}>
                          {t.name}
                        </span>
                        <span className="hidden text-sm md:block" style={{ color: muted }}>
                          {t.count > 1 ? `${t.count} options` : "Book now"}
                        </span>
                      </span>
                      {takesBookings && (
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full md:h-12 md:w-12"
                          style={brandButton}
                        >
                          <ArrowRight className="h-5 w-5" aria-hidden="true" />
                        </span>
                      )}
                    </div>
                  </>
                );
                return (
                  <li key={t.name}>
                    {takesBookings ? (
                      <BookLink
                        href={withQuery(bookPath, t.query)}
                        aria-label={`Book ${t.name}`}
                        className="flex flex-col gap-2.5 rounded-[22px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] md:gap-4"
                      >
                        {inner}
                      </BookLink>
                    ) : (
                      <div className="flex flex-col gap-2.5 md:gap-4">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>

            {messageUs && (
              <div className="flex flex-col gap-3.5 rounded-[20px] p-5 md:flex-row md:flex-wrap md:items-center md:gap-8 md:rounded-3xl md:px-8 md:py-7" style={{ background: surface }}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[17px] font-bold md:text-lg">Got a design in mind?</span>
                  <span className="text-[15px] text-[#5a535a]">
                    Send us a photo and we&rsquo;ll reply with a price and how long it takes.
                  </span>
                </div>
                <a
                  href={messageUs.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#1c1a1e] px-6 text-[15px] font-bold text-white"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {messageUs.label}
                </a>
              </div>
            )}
          </section>
        )}

        {salon.stylists.length > 0 && (
          <section id="team" className="scroll-mt-20" style={{ background: surface }}>
            <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 md:gap-12 md:px-8 md:py-24">
              <div className="flex flex-col gap-2.5 md:gap-3.5">
                <Eyebrow>The team</Eyebrow>
                <SectionTitle>Who you&rsquo;ll see</SectionTitle>
              </div>
              <ul className="m-0 grid list-none gap-2.5 p-0 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] md:gap-5">
                {salon.stylists.map((p) => {
                  const body = (
                    <>
                      <span
                        aria-hidden="true"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[21px] text-[var(--brand-ink)] md:h-16 md:w-16 md:text-[26px]"
                        style={{ fontFamily: SERIF, background: "color-mix(in srgb, var(--brand) 14%, white)" }}
                      >
                        {p.name.trim()[0]?.toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col md:gap-1">
                        <span className="text-[17px] font-bold md:text-2xl md:font-normal md:[font-family:var(--font-salon-serif),var(--font-salon-serif-vi),Georgia,serif]">
                          {p.name}
                        </span>
                        {p.role && (
                          <span className="text-sm md:text-[15px]" style={{ color: muted }}>
                            {p.role}
                          </span>
                        )}
                      </span>
                      {takesBookings && (
                        <span className="flex items-center gap-2 text-sm font-bold text-[var(--brand-ink)] md:text-[15px]">
                          <span className="md:hidden">Book</span>
                          <span className="hidden md:inline">Book with {p.name}</span>
                          <ArrowRight className="hidden h-4 w-4 md:block" aria-hidden="true" />
                        </span>
                      )}
                    </>
                  );
                  const card =
                    "flex items-center gap-3.5 rounded-[18px] bg-white px-4 py-3.5 md:flex-col md:items-start md:gap-[18px] md:rounded-3xl md:p-7";
                  return (
                    <li key={p.name}>
                      {takesBookings ? (
                        <BookLink href={withQuery(bookPath, { stylist: p.name })} className={card}>
                          {body}
                        </BookLink>
                      ) : (
                        <div className={card}>{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        <section id="visit" className="mx-auto grid max-w-6xl scroll-mt-20 gap-8 px-4 py-14 md:grid-cols-2 md:gap-16 md:px-8 md:py-28">
          <div className="flex flex-col gap-5 md:gap-7">
            <Eyebrow>Visit us</Eyebrow>
            <SectionTitle>{salon.address ? salon.address.replace(/\s*\n\s*/g, ", ") : salon.name}</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5 md:flex md:flex-wrap md:gap-3">
              {maps && (
                <a
                  href={maps}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-[52px] items-center justify-center gap-2.5 rounded-full border-[1.5px] px-5 text-[15px] font-semibold md:text-base"
                  style={{ borderColor: "#d9d1cd" }}
                >
                  <MapPin className="h-[18px] w-[18px]" aria-hidden="true" /> Directions
                </a>
              )}
              {tel && (
                <a
                  href={tel}
                  className="inline-flex h-[52px] items-center justify-center gap-2.5 rounded-full border-[1.5px] px-5 text-[15px] font-semibold md:text-base"
                  style={{ borderColor: "#d9d1cd" }}
                >
                  <Phone className="h-[18px] w-[18px]" aria-hidden="true" />
                  <span className="md:hidden">Call us</span>
                  <span className="hidden md:inline">{salon.phone}</span>
                </a>
              )}
            </div>
          </div>
          {hasHours && (
            <div className="flex flex-col gap-3.5">
              <span className="text-[13px] font-bold uppercase tracking-[0.1em]" style={{ color: muted }}>
                Opening hours
              </span>
              <dl className="m-0 flex flex-col">
                {week.map((d) => (
                  <div
                    key={d.day}
                    className={`flex items-center gap-3 rounded-[14px] px-4 py-3 md:py-3.5 ${d.today ? "font-bold" : "font-medium"}`}
                    style={d.today ? { background: "color-mix(in srgb, var(--brand) 10%, white)" } : undefined}
                  >
                    <dt className="flex-1 text-[15px] md:text-base">{d.day}</dt>
                    {d.today && <span className="text-xs font-bold text-[var(--brand-ink)] md:text-[13px]">Today</span>}
                    <dd className="m-0 text-[15px] tabular-nums md:text-base" style={{ color: d.closed ? muted : undefined }}>
                      {d.text}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      </main>

      <footer className="bg-[#1c1a1e] text-[#e9e3e0]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 pb-32 pt-10 md:flex-row md:flex-wrap md:items-center md:gap-10 md:px-8 md:py-14">
          <span className="text-[22px] text-white md:min-w-[220px] md:flex-1 md:text-2xl" style={{ fontFamily: SERIF }}>
            {salon.name}
          </span>
          {salon.address && <span className="text-sm md:text-[15px]">{salon.address.replace(/\s*\n\s*/g, ", ")}</span>}
          {tel && (
            <a href={tel} className="text-sm md:text-[15px]">
              {salon.phone}
            </a>
          )}
          <span className="text-xs text-[#b9b1b4] md:text-[13px]">Online booking by Kikai</span>
        </div>
      </footer>

      {takesBookings && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 md:hidden"
          style={{ borderColor: rule }}
        >
          <BookLink
            href={withQuery(bookPath)}
            className="flex h-14 items-center justify-center rounded-full text-[17px] font-bold"
            style={brandButton}
          >
            Book an appointment
          </BookLink>
        </div>
      )}
    </div>
  );
}
