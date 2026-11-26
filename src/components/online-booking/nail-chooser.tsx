"use client";

/**
 * "Not sure what to book?" on the salon's page: the client says what they
 * want from their nails, and it points at the salon's own treatment for that,
 * with its price and length, and a link straight into booking it.
 */

import Image from "next/image";
import { useState } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { NailGoal } from "@/lib/online-booking/salon-page";
import { BookLink } from "./book-link";
import { CREAM, INK, MUTED, displayStyle } from "./fonts";
import { PHOTOS } from "./photos";

export function NailChooser({
  goals,
  bookHrefs,
  priceTexts,
  minutesTexts,
  takesBookings,
}: {
  goals: NailGoal[];
  /** Per goal, the booking link for its treatment. */
  bookHrefs: string[];
  /** Per goal, "From £28", or null when unpriced. */
  priceTexts: (string | null)[];
  /** Per goal, "45 min". */
  minutesTexts: string[];
  takesBookings: boolean;
}) {
  const [picked, setPicked] = useState(0);
  const g = goals[picked] ?? goals[0];
  const photo = PHOTOS[g.art];
  return (
    <div className="grid items-start gap-8 md:grid-cols-2 md:gap-16">
      <div className="flex min-w-0 flex-col gap-7">
        <h2 className="m-0 text-[44px] md:text-[clamp(52px,5.4vw,80px)]" style={{ ...displayStyle, color: CREAM }}>
          Not sure what to book?
        </h2>
        <p className="m-0 max-w-[38ch] text-[17px] leading-relaxed text-[#D9CDE8]">
          Gel, BIAB, infills&hellip; the words get confusing. Tell us what you want from your nails and
          we&rsquo;ll point you to the right one.
        </p>
        <div role="group" aria-label="What do you want from your nails?" className="flex flex-col gap-2.5">
          {goals.map((x, i) => {
            const on = i === picked;
            return (
              <button
                key={x.art}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(i)}
                className="flex min-h-[60px] w-full items-center justify-between gap-4 rounded-[18px] border-[1.5px] px-[22px] text-left text-[17px] font-semibold transition-colors duration-200 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[var(--brand)]"
                style={
                  on
                    ? { background: "var(--brand)", color: "var(--brand-fg)", borderColor: "var(--brand)" }
                    : { background: "transparent", color: CREAM, borderColor: "rgba(255,244,232,.35)" }
                }
              >
                {x.goal}
                <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
      <div aria-live="polite" className="flex min-w-0 flex-col overflow-hidden rounded-[28px]" style={{ background: CREAM, color: INK }}>
        <div className="relative aspect-[16/10] w-full">
          <Image src={photo.src} alt={photo.alt} fill sizes="(min-width: 768px) 560px, 100vw" className="object-cover" placeholder="blur" />
        </div>
        <div className="flex flex-col gap-4 p-6 md:p-9">
          <span className="text-sm font-semibold" style={{ color: MUTED }}>
            We&rsquo;d suggest
          </span>
          <span className="text-[44px] md:text-[48px]" style={displayStyle}>
            {g.name}
          </span>
          <p className="m-0 text-[17px] leading-relaxed text-[#3D3447]">{g.why}</p>
          <p className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-[15px] font-semibold tabular-nums">
            {priceTexts[picked] && <span>{priceTexts[picked]}</span>}
            <span>{minutesTexts[picked]}</span>
          </p>
          {takesBookings && (
            <BookLink
              href={bookHrefs[picked]}
              className="mt-1.5 inline-flex min-h-[52px] items-center gap-2.5 self-start rounded-full px-6 text-base font-semibold transition-transform duration-200 hover:-translate-y-0.5"
              style={{ background: INK, color: CREAM }}
            >
              Book {g.name}
              <ArrowUpRight className="h-[18px] w-[18px]" aria-hidden="true" />
            </BookLink>
          )}
        </div>
      </div>
    </div>
  );
}
