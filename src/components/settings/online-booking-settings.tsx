"use client";

/**
 * Settings › Website & online booking: switching it on, the links and code a
 * salon needs (its own website, or booking on the website it already has),
 * the few things the site adds to the rest of Settings, and the online rules.
 *
 * Services, prices, team, hours and phone are not repeated here: the site
 * reads them from the rest of Settings (src/lib/online-booking).
 */

import { useState } from "react";
import { AlertTriangle, Check, Copy, ExternalLink } from "lucide-react";
import { ExpandableSection } from "@/components/settings/expandable-section";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SalonService } from "@/lib/salon-config";
import {
  DEFAULT_BRAND_COLOR,
  isHiddenOnline,
  SITE_ABOUT_MAX,
  SITE_ADDRESS_MAX,
  SITE_HEADLINE_MAX,
} from "@/lib/online-booking/catalogue";

export interface OnlineSettings {
  onlineBookingEnabled: boolean;
  siteHeadline: string;
  siteAbout: string;
  siteAddress: string;
  siteBrandColor: string | null;
  onlineMaxDaysAhead: number;
  onlineStylistChoice: boolean;
  onlineHiddenServices: string[];
}

/** From the settings API's row. */
export function onlineSettingsFrom(s: Record<string, unknown> | undefined | null): OnlineSettings {
  return {
    onlineBookingEnabled: s?.onlineBookingEnabled === true,
    siteHeadline: typeof s?.siteHeadline === "string" ? s.siteHeadline : "",
    siteAbout: typeof s?.siteAbout === "string" ? s.siteAbout : "",
    siteAddress: typeof s?.siteAddress === "string" ? s.siteAddress : "",
    siteBrandColor: typeof s?.siteBrandColor === "string" ? s.siteBrandColor : null,
    onlineMaxDaysAhead: typeof s?.onlineMaxDaysAhead === "number" ? s.onlineMaxDaysAhead : 56,
    onlineStylistChoice: s?.onlineStylistChoice !== false,
    onlineHiddenServices: Array.isArray(s?.onlineHiddenServices) ? (s.onlineHiddenServices as string[]) : [],
  };
}

const AHEAD_CHOICES = [
  { days: 7, label: "1 week ahead" },
  { days: 14, label: "2 weeks ahead" },
  { days: 28, label: "4 weeks ahead" },
  { days: 56, label: "8 weeks ahead" },
  { days: 84, label: "12 weeks ahead" },
  { days: 182, label: "6 months ahead" },
];

const SWATCHES = ["#9d3b5e", "#1f4e5f", "#7a4b2a", "#3f5f2a", "#1c1917"];

function CopyBox({ label, value, open }: { label: string; value: string; open?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard: the text is on screen to select by hand.
    }
  };
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-lg bg-muted px-3 py-2 font-mono text-xs leading-relaxed">
          {value}
        </code>
        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-accent"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {open && (
            <a
              href={open}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function OnlineBookingSettings({
  value,
  onChange,
  slug,
  live,
  services,
  notReady,
  staff,
}: {
  value: OnlineSettings;
  onChange: (v: OnlineSettings) => void;
  /** The salon's slug, for its web address. */
  slug: string | null;
  /** Switched on and saved: the links work. */
  live: boolean;
  services: SalonService[];
  /** What the diary still lacks before anything can be booked, or null. */
  notReady: string | null;
  /** "stylist", "nail technician"… */
  staff: string;
}) {
  const set = (patch: Partial<OnlineSettings>) => onChange({ ...value, ...patch });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const site = slug ? `${origin}/s/${slug}` : "";
  const brand = value.siteBrandColor ?? DEFAULT_BRAND_COLOR;

  return (
    <ExpandableSection
      title="Website & online booking"
      description="Clients book straight into your diary, from your own page or the website you already have."
      summary={value.onlineBookingEnabled ? (live ? "Live" : "On, not saved") : "Off"}
    >
      <div className="space-y-6">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={value.onlineBookingEnabled}
            onChange={(e) => set({ onlineBookingEnabled: e.target.checked })}
          />
          <span>
            <span className="font-medium">Take bookings online</span>
            <span className="block text-xs text-muted-foreground">
              Three taps and a name and mobile number: no account for your clients. Bookings go in the diary with a
              booking number and a confirmation text, the same as a phone booking, and pop up here like one.
            </span>
          </span>
        </label>

        {value.onlineBookingEnabled && notReady && (
          <p role="status" className="flex items-start gap-2 text-xs text-papaya-whip-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Your page will show, but cannot take bookings until the diary is set up: {notReady}.
            </span>
          </p>
        )}

        {value.onlineBookingEnabled && slug && (
          <div className="space-y-4 rounded-xl border p-4">
            {!live && <p className="text-xs text-muted-foreground">Save to put these live.</p>}
            <CopyBox label="Your website" value={site} open={live ? site : undefined} />
            <CopyBox
              label="Booking link: for a “Book” button anywhere, your Instagram bio or your Google listing"
              value={`${site}/book`}
              open={live ? `${site}/book` : undefined}
            />
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-medium">Already have a website? Add booking to it.</p>
              <CopyBox
                label="1. Paste once, anywhere on your site"
                value={`<script src="${origin}/book.js" data-salon="${slug}" async></script>`}
              />
              <CopyBox
                label="2. Then any link or button with data-kikai-book opens booking over the page"
                value={`<a href="#" data-kikai-book>Book now</a>`}
              />
              <CopyBox
                label="Or put the booking on a page of its own"
                value={`<div data-kikai-book-inline></div>`}
              />
              <p className="text-xs text-muted-foreground">
                Add <code className="font-mono">data-service=&quot;Blow dry&quot;</code> to a button to open on that
                service, or <code className="font-mono">data-button=&quot;Book now&quot;</code> to the script for a
                button in the corner of every page. Works with Wix, Squarespace, WordPress and hand-built sites.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Your page</h3>
          <p className="text-xs text-muted-foreground">
            Services, prices, the team, opening hours and your phone number come from the rest of Settings, so your
            page never disagrees with the diary.
          </p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Headline</span>
            <Input
              value={value.siteHeadline}
              maxLength={SITE_HEADLINE_MAX}
              placeholder="Cuts, colour and care that fit your day."
              onChange={(e) => set({ siteHeadline: e.target.value })}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">About the salon</span>
            <Textarea
              value={value.siteAbout}
              maxLength={SITE_ABOUT_MAX}
              rows={3}
              placeholder="A sentence or two about you."
              onChange={(e) => set({ siteAbout: e.target.value })}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Address</span>
            <Textarea
              value={value.siteAddress}
              maxLength={SITE_ADDRESS_MAX}
              rows={2}
              placeholder={"47 Bridge Street\nTown, AB1 2CD"}
              onChange={(e) => set({ siteAddress: e.target.value })}
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Brand colour</span>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Brand colour ${c}`}
                  aria-pressed={brand === c}
                  onClick={() => set({ siteBrandColor: c })}
                  className={`h-8 w-8 rounded-full ring-offset-2 ${brand === c ? "ring-2 ring-foreground" : ""}`}
                  style={{ background: c }}
                />
              ))}
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="color"
                  value={brand}
                  onChange={(e) => set({ siteBrandColor: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded border bg-transparent"
                  aria-label="Choose any brand colour"
                />
                Any colour
              </label>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Booking rules</h3>
          <p className="text-xs text-muted-foreground">
            Online bookings follow the same rules as the phone: your hours, who works when, blocked time, at least two
            hours&rsquo; notice, and 48 hours for a new client&rsquo;s colour.
          </p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Clients can book up to</span>
            <select
              value={value.onlineMaxDaysAhead}
              onChange={(e) => set({ onlineMaxDaysAhead: Number(e.target.value) })}
              className="h-9 rounded-lg border bg-background px-2 text-sm"
            >
              {(AHEAD_CHOICES.some((c) => c.days === value.onlineMaxDaysAhead)
                ? AHEAD_CHOICES
                : [...AHEAD_CHOICES, { days: value.onlineMaxDaysAhead, label: `${value.onlineMaxDaysAhead} days ahead` }]
              ).map((c) => (
                <option key={c.days} value={c.days}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary"
              checked={value.onlineStylistChoice}
              onChange={(e) => set({ onlineStylistChoice: e.target.checked })}
            />
            <span>
              <span className="font-medium">Let clients choose their {staff}</span>
              <span className="block text-xs text-muted-foreground">
                Otherwise they are booked with whoever is free, as by phone.
              </span>
            </span>
          </label>
          {services.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-muted-foreground">Services clients can book online</legend>
              <div className="flex flex-wrap gap-2 pt-1.5">
                {services.map((s) => {
                  const on = !isHiddenOnline(s.name, value.onlineHiddenServices);
                  return (
                    <label key={s.name} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={on}
                        onChange={(e) =>
                          set({
                            onlineHiddenServices: e.target.checked
                              ? value.onlineHiddenServices.filter((h) => h.toLowerCase() !== s.name.toLowerCase())
                              : [...value.onlineHiddenServices, s.name],
                          })
                        }
                      />
                      {s.name}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Untick anything that needs a chat first, like a consultation or colour correction. New services are
                bookable online until you untick them.
              </p>
            </fieldset>
          )}
        </div>
      </div>
    </ExpandableSection>
  );
}
