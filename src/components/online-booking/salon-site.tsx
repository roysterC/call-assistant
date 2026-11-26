/**
 * A salon's own one-page website (/s/<slug>), built entirely from its CRM
 * settings: name, headline, about, treatments and prices, team, opening
 * hours, address, phone and brand colour. The salon edits those once, in
 * Settings, and the site and the diary can never disagree.
 *
 * The look: the salon's colour as a poster-like ground, big narrow capitals
 * for headings, cream between, nail-tip arches around the photos. The photos
 * are the same for every salon (./photos.ts) and never stand in for its work.
 *
 * Built for someone on a phone who wants to book: the price list says how
 * long and how much on every row, each with its own Book; "Not sure what to
 * book?" turns treatment names into plain wants; open-now, address and hours
 * are one scroll away; Book and Call stay at the bottom of the screen.
 */

import Image from "next/image";
import { ArrowDown, ArrowUpRight, MapPin, MessageCircle, Phone } from "lucide-react";
import { BookLink } from "./book-link";
import { NailChooser } from "./nail-chooser";
import { CREAM, INK, MUTED, TEXT, displayStyle, salonFontVars } from "./fonts";
import { HERO_PHOTO, IDEA_PHOTOS, PHOTOS } from "./photos";
import { formatMoneyShort } from "@/lib/money";
import type { PublicSalon, PublicSlot } from "@/lib/online-booking";
import {
  accentFor,
  lowestPrice,
  menuGroups,
  nailGoals,
  openDaysText,
  openStatus,
  treatmentTiles,
  weekHours,
  whenText,
  type TileArt,
} from "@/lib/online-booking/salon-page";
import { brandStyle, durationText, timeText } from "./format";

function withQuery(path: string, q: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return `${path}${s ? `?${s}` : ""}`;
}

/** The four-point sparkle the page uses as its mark. */
function Sparkle({ size, fill = "currentColor", stroke, className }: { size: number; fill?: string; stroke?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={stroke ? 1.4 : undefined}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A photo in a nail-tip arch. */
function Arch({ art, className, sizes, priority }: { art: TileArt | "hero"; className?: string; sizes: string; priority?: boolean }) {
  const photo = art === "hero" ? HERO_PHOTO : PHOTOS[art];
  return (
    <div className={`relative overflow-hidden ${className ?? ""}`} style={{ borderRadius: "999px 999px 24px 24px" }}>
      <Image src={photo.src} alt={photo.alt} fill sizes={sizes} priority={priority} placeholder="blur" className="object-cover" />
    </div>
  );
}

/** How big the hero's heading can be for how long it is. */
function heroSize(text: string): string {
  const n = text.length;
  if (n <= 28) return "clamp(52px, 8.2vw, 120px)";
  if (n <= 60) return "clamp(42px, 5.8vw, 84px)";
  return "clamp(34px, 4.2vw, 62px)";
}

/** The salon's name across the footer, as big as its length allows. */
function wordmarkSize(name: string): string {
  const n = Math.max(4, name.length);
  return `clamp(48px, ${Math.min(22, 150 / n).toFixed(1)}vw, 320px)`;
}

const BUTTON = "inline-flex min-h-[52px] items-center gap-2.5 rounded-full px-6 text-base font-semibold transition-transform duration-200 hover:-translate-y-0.5";
const SECTION_H2 = "m-0 text-[48px] md:text-[clamp(56px,6vw,88px)]";
const WRAP = "mx-auto w-full max-w-[1280px] px-4 md:px-[clamp(24px,4vw,56px)]";

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
  const tel = salon.phone ? `tel:${salon.phone.replace(/\s+/g, "")}` : null;
  const status = openStatus(salon.hours, salon.timeZone);
  const week = weekHours(salon.hours, salon.timeZone);
  const hasHours = week.some((d) => !d.closed);
  const tiles = treatmentTiles(salon.services);
  const groups = menuGroups(salon.services);
  const goals = nailGoals(salon.services);
  const lowest = lowestPrice(salon.services);
  const days = openDaysText(salon.hours);
  const anyPriced = salon.services.some((s) => s.priceMinor !== null);
  const address = salon.address ? salon.address.replace(/\s*\n\s*/g, ", ") : null;
  const addressLines = salon.address ? salon.address.split(/\s*(?:\n|,)\s*/).filter(Boolean) : [];
  const maps = salon.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${salon.name}, ${salon.address}`)}`
    : null;
  const heading = salon.headline || salon.name;
  const menuArts: TileArt[] = [...new Set(tiles.map((t) => t.art).filter((a) => a !== "other"))];
  const sideArts: TileArt[] = [...menuArts, "gel" as const, "pedicure" as const].filter((a, i, all) => all.indexOf(a) === i).slice(0, 2);
  const facts = [
    lowest && { title: `From ${formatMoneyShort(lowest.minor)}`, detail: lowest.service },
    days && { title: days.title, detail: days.detail },
    salon.stylists.length > 1 && { title: `${salon.stylists.length} nail techs`, detail: "Choose who you see, or anyone" },
    takesBookings && { title: "Book any time", detail: "Online, day or night" },
  ].filter((f): f is { title: string; detail: string } => Boolean(f));
  const brandButton = { background: "var(--brand-fg)", color: "var(--brand)" };
  const inkButton = { background: INK, color: CREAM };

  return (
    <div
      className={`${salonFontVars} h-dvh overflow-y-auto antialiased selection:bg-[#16121A] selection:text-[#EFE3FF]`}
      style={{ ...brandStyle(salon.brandColor), ["--pop" as string]: accentFor(salon.brandColor), background: CREAM, color: INK, fontFamily: TEXT }}
    >
      <header className="sticky top-0 z-10 border-b-[1.5px]" style={{ background: CREAM, borderColor: INK }}>
        <div className={`${WRAP} flex h-16 items-center gap-4 md:h-[76px] md:gap-7`}>
          <a href="#top" className="flex min-w-0 flex-1 items-center gap-2 no-underline md:flex-none" style={{ color: INK }}>
            <span
              className="block min-w-0 truncate text-[24px] leading-[1.1] md:text-[28px]"
              style={{ ...displayStyle, textTransform: "none", letterSpacing: "-0.03em", fontVariationSettings: "'wdth' 75, 'opsz' 48" }}
            >
              {salon.name}
            </span>
            <Sparkle size={18} fill="none" stroke={INK} className="shrink-0" />
          </a>
          <nav aria-label="Sections" className="hidden flex-1 justify-center gap-7 text-[15px] font-medium md:flex">
            {groups.length > 0 && <a href="#treatments">Treatments &amp; prices</a>}
            {salon.stylists.length > 0 && <a href="#team">Team</a>}
            <a href="#visit">Find us</a>
          </nav>
          {status && (
            <span className="hidden items-center gap-2 text-sm font-medium lg:inline-flex" style={{ color: "#3D3447" }}>
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: status.open ? "#1F7A4A" : "#9a9196", boxShadow: status.open ? "0 0 0 4px rgba(31,122,74,.16)" : undefined }}
              />
              {status.text}
            </span>
          )}
          {tel && (
            <a
              href={tel}
              aria-label={`Call ${salon.phone}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] md:hidden"
              style={{ borderColor: INK }}
            >
              <Phone className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          {takesBookings && (
            <BookLink
              href={withQuery(bookPath)}
              className="hidden min-h-[46px] items-center gap-2.5 rounded-full px-5 text-[15px] font-semibold transition-transform duration-200 hover:-translate-y-0.5 md:inline-flex"
              style={inkButton}
            >
              Book now
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </BookLink>
          )}
        </div>
      </header>

      <main id="top" className="pb-28 md:pb-0">
        {/* Hero, on the salon's colour */}
        <section className="overflow-hidden" style={{ background: "var(--brand)", color: "var(--brand-fg)" }}>
          <div className={`${WRAP} pt-6 md:pt-7`}>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs font-semibold uppercase tracking-[0.12em]">
              {tiles.length > 0 && (
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                  {tiles.slice(0, 3).map((t) => t.name).join(" · ")}
                </span>
              )}
              {addressLines.length > 0 && <span className="hidden sm:inline">{addressLines.slice(-2).join(", ")}</span>}
            </div>
            <div className="grid items-end gap-8 pt-10 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:gap-[clamp(24px,4vw,64px)] md:pt-16">
              <div className="flex min-w-0 flex-col gap-7 pb-2 md:gap-8 md:pb-20">
                {status && (
                  <span className="inline-flex items-center gap-2 self-start text-sm font-semibold lg:hidden">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: "currentColor", opacity: status.open ? 1 : 0.5 }} />
                    {status.text}
                  </span>
                )}
                <div className="flex flex-col gap-3">
                  <h1 className="m-0" style={{ ...displayStyle, fontSize: heroSize(heading) }}>
                    {heading}
                  </h1>
                  <svg viewBox="0 0 400 18" preserveAspectRatio="none" aria-hidden="true" className="h-3.5 w-[min(60%,320px)] overflow-visible">
                    <path d="M3 12C70 4 150 3 215 8S338 15 397 6" fill="none" stroke="var(--pop)" strokeWidth="6" strokeLinecap="round" />
                  </svg>
                </div>
                {salon.about && <p className="m-0 max-w-[40ch] whitespace-pre-line text-lg leading-relaxed md:text-[20px]">{salon.about}</p>}
                {takesBookings ? (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <BookLink href={withQuery(bookPath)} className={BUTTON} style={brandButton}>
                      Book an appointment
                      <ArrowUpRight className="h-[18px] w-[18px]" aria-hidden="true" />
                    </BookLink>
                    {groups.length > 0 && (
                      <a href="#treatments" className="inline-flex min-h-[52px] items-center gap-2 px-1 text-base font-semibold">
                        See prices
                        <ArrowDown className="h-[18px] w-[18px]" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                ) : (
                  tel && (
                    <a href={tel} className={BUTTON} style={{ ...brandButton, alignSelf: "flex-start" }}>
                      <Phone className="h-[18px] w-[18px]" aria-hidden="true" /> Call {salon.phone} to book
                    </a>
                  )
                )}
                {takesBookings && nextFree && (
                  <BookLink
                    href={withQuery(bookPath, { service: nextFree.service, start: nextFree.slot.start, stylist: nextFree.slot.stylist })}
                    className="flex max-w-[520px] items-center gap-4 rounded-[20px] border-[1.5px] border-dashed px-5 py-4"
                    style={{ borderColor: "currentColor" }}
                  >
                    <Sparkle size={24} fill="var(--pop)" stroke={INK} className="shrink-0" />
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[13px] font-bold">Next free</span>
                      <span className="text-base font-semibold md:text-[17px]">
                        {whenText(nextFree.date, timeText(nextFree.slot.start, salon.timeZone), salon.timeZone)} · {nextFree.service}
                        {nextFree.slot.stylist && salon.stylists.length > 1 ? ` with ${nextFree.slot.stylist}` : ""}
                      </span>
                    </span>
                    <ArrowUpRight className="h-5 w-5 shrink-0" aria-hidden="true" />
                  </BookLink>
                )}
              </div>
              <div className="relative min-w-0 self-stretch">
                <div className="relative h-[340px] w-full overflow-hidden md:h-full md:min-h-[520px]" style={{ borderRadius: "999px 999px 0 0" }}>
                  <Image
                    src={HERO_PHOTO.src}
                    alt={HERO_PHOTO.alt}
                    fill
                    priority
                    placeholder="blur"
                    sizes="(min-width: 768px) 520px, 100vw"
                    className="object-cover"
                  />
                </div>
                {takesBookings && (
                  <div
                    className="absolute left-2 top-[6%] flex h-[116px] w-[116px] -rotate-[10deg] items-center justify-center rounded-full md:-left-7 md:h-[136px] md:w-[136px]"
                    style={{ background: "var(--pop)", color: INK, boxShadow: "0 14px 30px -14px rgba(22,18,26,.5)" }}
                  >
                    <svg viewBox="0 0 136 136" aria-hidden="true" className="absolute inset-0 h-full w-full motion-safe:animate-spin" style={{ animationDuration: "18s" }}>
                      <defs>
                        <path id="salon-sticker-ring" d="M68 68m-48 0a48 48 0 1 1 96 0a48 48 0 1 1 -96 0" />
                      </defs>
                      <text fill={INK} style={{ font: "700 11.5px var(--font-salon-text), sans-serif", letterSpacing: "0.18em", textTransform: "uppercase" }}>
                        <textPath href="#salon-sticker-ring">Book in a minute · Book in a minute ·</textPath>
                      </text>
                    </svg>
                    <Sparkle size={28} fill={INK} />
                  </div>
                )}
                <Sparkle size={52} fill="none" stroke={CREAM} className="absolute bottom-6 right-5" />
              </div>
            </div>
          </div>
        </section>

        {facts.length > 0 && (
          <section aria-label="At a glance" className="border-y-[1.5px]" style={{ borderColor: INK }}>
            <div className={`${WRAP} grid grid-cols-2 gap-x-4 gap-y-5 py-5 md:grid-cols-4 md:gap-6 md:py-7`}>
              {facts.map((f) => (
                <div key={f.title} className="flex min-w-0 flex-col gap-1">
                  <span className="text-[26px] md:text-[32px]" style={displayStyle}>
                    {f.title}
                  </span>
                  <span className="text-[13px] md:text-sm" style={{ color: MUTED }}>
                    {f.detail}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* The price list: every row says how long, how much, and books itself */}
        {groups.length > 0 && (
          <section id="treatments" className="scroll-mt-20">
            <div className={`${WRAP} grid items-start gap-10 py-16 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-[clamp(32px,5vw,88px)] md:py-28`}>
              <div className="flex min-w-0 flex-col gap-6 md:sticky md:top-28">
                <h2 className={SECTION_H2} style={displayStyle}>
                  The menu
                </h2>
                <p className="m-0 max-w-[34ch] text-[17px] leading-relaxed" style={{ color: MUTED }}>
                  {takesBookings
                    ? "Tap Book on anything to see its free times. You pay at the salon."
                    : tel
                      ? `Ring us on ${salon.phone} to book any of these.`
                      : "Get in touch to book any of these."}
                </p>
                <div aria-hidden="true" className="hidden grid-cols-2 gap-4 md:grid">
                  <Arch art={sideArts[0]} sizes="240px" className="aspect-[3/4]" />
                  <Arch art={sideArts[1]} sizes="240px" className="mt-12 aspect-[3/4]" />
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-12">
                {groups.map((g) => (
                  <div key={g.heading ?? "all"}>
                    {g.heading && <h3 className="m-0 mb-3.5 text-[22px] font-bold">{g.heading}</h3>}
                    <ul className="m-0 list-none border-b-[1.5px] p-0" style={{ borderColor: INK }}>
                      {g.services.map((s) => (
                        <li
                          key={s.name}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t-[1.5px] py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:gap-x-6"
                          style={{ borderColor: INK }}
                        >
                          <span className="min-w-0 text-[18px] font-semibold md:text-[19px]">{s.name}</span>
                          <span className="text-right text-[18px] font-bold tabular-nums sm:order-3 md:text-[19px]">
                            {s.priceMinor !== null ? formatMoneyShort(s.priceMinor) : ""}
                          </span>
                          <span className="text-[15px] tabular-nums sm:order-2" style={{ color: MUTED }}>
                            {durationText(s.durationMinutes)}
                            {s.stylists.length === 1 && salon.stylists.length > 1 ? ` · with ${s.stylists[0]}` : ""}
                          </span>
                          {takesBookings && (
                            <BookLink
                              href={withQuery(bookPath, { service: s.name })}
                              aria-label={`Book ${s.name}`}
                              className="inline-flex min-h-11 items-center justify-self-end rounded-full border-[1.5px] px-4 text-[15px] font-semibold transition-colors duration-150 hover:bg-[#16121A] hover:text-[#FFF4E8] sm:order-4"
                              style={{ borderColor: INK }}
                            >
                              Book
                            </BookLink>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {anyPriced && (
                  <p className="m-0 text-sm" style={{ color: MUTED }}>
                    Prices are a guide: nail art and designs are priced individually.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {goals.length > 0 && (
          <section style={{ background: INK, color: CREAM }}>
            <div className={`${WRAP} py-16 md:py-28`}>
              <NailChooser
                goals={goals}
                takesBookings={takesBookings}
                bookHrefs={goals.map((g) => withQuery(bookPath, g.query))}
                priceTexts={goals.map((g) => (g.fromMinor !== null ? `From ${formatMoneyShort(g.fromMinor)}` : null))}
                minutesTexts={goals.map((g) => `From ${durationText(g.minutes)}`)}
              />
            </div>
          </section>
        )}

        {salon.stylists.length > 0 && (
          <section id="team" className="scroll-mt-20 border-t-[1.5px]" style={{ borderColor: INK }}>
            <div className={`${WRAP} flex flex-col gap-10 py-16 md:gap-14 md:py-28`}>
              <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
                <h2 className={SECTION_H2} style={displayStyle}>
                  Who you&rsquo;ll see
                </h2>
                {takesBookings && (
                  <p className="m-0 max-w-[38ch] text-[17px] leading-relaxed" style={{ color: MUTED }}>
                    Pick someone you know, or book anyone and we&rsquo;ll show you every free time.
                  </p>
                )}
              </div>
              <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] md:gap-5">
                {salon.stylists.map((p) => {
                  const body = (
                    <>
                      <span
                        aria-hidden="true"
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[28px] md:h-[72px] md:w-[72px] md:text-[34px]"
                        style={{ ...displayStyle, background: "var(--brand)", color: "var(--brand-fg)" }}
                      >
                        {p.name.trim()[0]?.toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-[30px] md:text-[36px]" style={displayStyle}>
                          {p.name}
                        </span>
                        {p.role && (
                          <span className="text-[15px]" style={{ color: MUTED }}>
                            {p.role}
                          </span>
                        )}
                      </span>
                      {takesBookings && (
                        <span className="inline-flex items-center gap-1.5 text-[15px] font-bold underline decoration-[1.5px] underline-offset-4">
                          Book with {p.name}
                          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                        </span>
                      )}
                    </>
                  );
                  const card =
                    "flex h-full flex-row flex-wrap items-center gap-4 rounded-[24px] border-[1.5px] bg-white p-5 transition-transform duration-200 sm:flex-col sm:items-start sm:p-7";
                  return (
                    <li key={p.name}>
                      {takesBookings ? (
                        <BookLink href={withQuery(bookPath, { stylist: p.name })} className={`${card} hover:-translate-y-0.5`} style={{ borderColor: INK }}>
                          {body}
                        </BookLink>
                      ) : (
                        <div className={card} style={{ borderColor: INK }}>
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {messageUs && (
          <section className="overflow-hidden" style={{ background: "var(--brand)", color: "var(--brand-fg)" }}>
            <div className={`${WRAP} flex flex-col gap-10 py-16 md:gap-12 md:py-28`}>
              <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
                <h2 className={SECTION_H2} style={displayStyle}>
                  Got a design in mind?
                </h2>
                <div className="flex max-w-[42ch] flex-col gap-4">
                  <p className="m-0 text-[17px] leading-relaxed">
                    Send us a photo of anything you love and we&rsquo;ll reply with a price and how long it takes.
                  </p>
                  <a
                    href={messageUs.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${BUTTON} self-start`}
                    style={brandButton}
                  >
                    <MessageCircle className="h-[18px] w-[18px]" aria-hidden="true" />
                    {messageUs.label}
                  </a>
                </div>
              </div>
              <figure className="m-0 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
                  {IDEA_PHOTOS.map((p, i) => (
                    <div
                      key={i}
                      className={`relative aspect-[3/4] overflow-hidden ${i % 2 === 1 ? "mt-10 md:mt-14" : ""}`}
                      style={{ borderRadius: "999px 999px 20px 20px" }}
                    >
                      <Image src={p.src} alt={p.alt} fill sizes="(min-width: 768px) 300px, 50vw" placeholder="blur" className="object-cover" />
                    </div>
                  ))}
                </div>
                <figcaption className="text-sm">Ideas to bring along. Example photos, not our own work.</figcaption>
              </figure>
            </div>
          </section>
        )}

        <section id="visit" className="scroll-mt-20 border-t-[1.5px]" style={{ borderColor: INK, background: "color-mix(in srgb, var(--brand) 16%, #FFF4E8)" }}>
          <div className={`${WRAP} grid items-start gap-12 py-16 md:grid-cols-2 md:gap-[clamp(32px,5vw,80px)] md:py-28`}>
            <div className="flex min-w-0 flex-col gap-6">
              <h2 className={SECTION_H2} style={displayStyle}>
                Find us
              </h2>
              <address className="flex flex-col text-lg not-italic leading-relaxed">
                <strong className="text-[20px]">{salon.name}</strong>
                {addressLines.map((l) => (
                  <span key={l}>{l}</span>
                ))}
              </address>
              <div className="flex flex-wrap gap-3">
                {maps && (
                  <a href={maps} target="_blank" rel="noopener noreferrer" className={BUTTON} style={inkButton}>
                    <MapPin className="h-[18px] w-[18px]" aria-hidden="true" /> Directions
                  </a>
                )}
                {tel && (
                  <a href={tel} className={`${BUTTON} border-[1.5px]`} style={{ borderColor: INK }}>
                    <Phone className="h-[18px] w-[18px]" aria-hidden="true" /> {salon.phone}
                  </a>
                )}
              </div>
            </div>
            {hasHours && (
              <table className="w-full border-collapse text-[17px] tabular-nums">
                <caption className="pb-3 text-left text-[20px] font-bold">Opening hours</caption>
                <tbody>
                  {week.map((d, i) => (
                    <tr
                      key={d.day}
                      className={`border-t-[1.5px] ${i === week.length - 1 ? "border-b-[1.5px]" : ""}`}
                      style={{ borderColor: INK, ...(d.today ? { background: "var(--brand)", color: "var(--brand-fg)" } : {}) }}
                    >
                      <th scope="row" className={`px-3 py-3 text-left ${d.today ? "font-bold" : "font-medium"}`}>
                        {d.day}
                        {d.today && <span className="font-medium"> (today)</span>}
                      </th>
                      <td className={`px-3 py-3 text-right ${d.today ? "font-bold" : ""}`} style={d.closed && !d.today ? { color: MUTED } : undefined}>
                        {d.text}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      <footer className="overflow-hidden border-t-[1.5px]" style={{ background: "var(--brand)", color: "var(--brand-fg)", borderColor: INK }}>
        <div className={`${WRAP} flex flex-col gap-10 pb-32 pt-14 md:pb-8`}>
          {takesBookings && (
            <div className="flex flex-wrap items-center justify-between gap-6">
              <p className="m-0 max-w-[26ch] text-[20px] font-semibold">Ready when you are.</p>
              <BookLink href={withQuery(bookPath)} className={BUTTON} style={brandButton}>
                Book an appointment
                <ArrowUpRight className="h-[18px] w-[18px]" aria-hidden="true" />
              </BookLink>
            </div>
          )}
          <div
            aria-hidden="true"
            className="whitespace-nowrap"
            style={{ ...displayStyle, fontSize: wordmarkSize(salon.name), lineHeight: 0.8, letterSpacing: "-0.04em", textTransform: "lowercase" }}
          >
            {salon.name}
          </div>
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-2 text-sm">
            <span>
              {salon.name}
              {address ? ` · ${address}` : ""}
            </span>
            <span className="flex flex-wrap gap-x-5">
              {tel && <a href={tel}>{salon.phone}</a>}
              <span>Online booking by Kikai</span>
            </span>
          </div>
        </div>
      </footer>

      {takesBookings && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 flex gap-2.5 border-t-[1.5px] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 md:hidden"
          style={{ background: CREAM, borderColor: INK }}
        >
          {tel && (
            <a
              href={tel}
              aria-label={`Call ${salon.phone}`}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[1.5px]"
              style={{ borderColor: INK }}
            >
              <Phone className="h-[22px] w-[22px]" aria-hidden="true" />
            </a>
          )}
          <BookLink
            href={withQuery(bookPath)}
            className="flex h-14 flex-1 items-center justify-center gap-2.5 rounded-full text-[17px] font-semibold"
            style={inkButton}
          >
            Book an appointment
            <ArrowUpRight className="h-[18px] w-[18px]" aria-hidden="true" />
          </BookLink>
        </div>
      )}
    </div>
  );
}
