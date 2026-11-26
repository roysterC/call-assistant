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
import { SettingsSection } from "@/components/settings/settings-section";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageChat } from "@/components/settings/page-chat";
import type { SalonService } from "@/lib/salon-config";
import {
  DEFAULT_BRAND_COLOR,
  isHiddenOnline,
  SITE_ABOUT_MAX,
  SITE_ADDRESS_MAX,
  SITE_HEADLINE_MAX,
} from "@/lib/online-booking/catalogue";
import { useT } from "@/components/providers/language-provider";
import type { Translate } from "@/lib/i18n";

export interface OnlineSettings {
  onlineBookingEnabled: boolean;
  siteHeadline: string;
  siteAbout: string;
  siteAddress: string;
  siteBrandColor: string | null;
  onlineMaxDaysAhead: number;
  onlineStylistChoice: boolean;
  onlineHiddenServices: string[];
  /** The chat shown on the page (src/lib/salon-chat.ts, set up in PageChat), or null. */
  siteChatSiteId: string | null;
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
    siteChatSiteId: typeof s?.siteChatSiteId === "string" ? s.siteChatSiteId : null,
  };
}

const AHEAD_CHOICES = [7, 14, 28, 56, 84, 182];

/** "2 weeks ahead", "6 months ahead", or days for anything else. */
function aheadLabel(days: number, t: Translate): string {
  if (days === 182) return t("online.monthsAhead", { n: 6 });
  return days % 7 === 0 ? t("online.weeksAhead", { n: days / 7 }) : t("online.daysAhead", { n: days });
}

const SWATCHES = ["#9d3b5e", "#1f4e5f", "#7a4b2a", "#3f5f2a", "#1c1917"];

function CopyBox({ label, value, open }: { label: string; value: string; open?: string }) {
  const { t } = useT();
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
            {copied ? t("online.copied") : t("online.copy")}
          </button>
          {open && (
            <a
              href={open}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {t("online.open")}
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
  bookingOrigin,
  live,
  services,
  notReady,
  chatbotEnabled,
  businessName,
}: {
  value: OnlineSettings;
  onChange: (v: OnlineSettings) => void;
  /** The salon's slug, for its web address. */
  slug: string | null;
  /** Where salons' pages are given out (book.getkikai.com), or null for this app's /s/. */
  bookingOrigin?: string | null;
  /** Switched on and saved: the links work. */
  live: boolean;
  services: SalonService[];
  /** The diary cannot take bookings yet. */
  notReady: boolean;
  /** Website chat is on for the salon (Kikai switches it on), so a chat can go on the page. */
  chatbotEnabled: boolean;
  /** The salon's name, which its chat answers as to begin with. */
  businessName: string;
}) {
  const { t } = useT();
  const set = (patch: Partial<OnlineSettings>) => onChange({ ...value, ...patch });
  const here = typeof window !== "undefined" ? window.location.origin : "";
  // The booking address serves the pages, the flow and book.js on its own.
  const origin = bookingOrigin || here;
  const site = slug ? (bookingOrigin ? `${bookingOrigin}/${slug}` : `${here}/s/${slug}`) : "";
  const brand = value.siteBrandColor ?? DEFAULT_BRAND_COLOR;

  return (
    <SettingsSection
      id="online-booking"
      title={t("online.title")}
      description={t("online.description")}
      actions={
        <span
          className={
            value.onlineBookingEnabled && live
              ? "rounded-full bg-tea-green-800 px-2.5 py-0.5 text-xs font-semibold text-tea-green-200"
              : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
          }
        >
          {value.onlineBookingEnabled ? (live ? t("online.live") : t("online.onNotSaved")) : t("online.off")}
        </span>
      }
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
            <span className="font-medium">{t("online.take")}</span>
            <span className="block text-xs text-muted-foreground">{t("online.takeHow")}</span>
          </span>
        </label>

        {value.onlineBookingEnabled && notReady && (
          <p role="status" className="flex items-start gap-2 text-xs text-papaya-whip-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t("online.notReady")}</span>
          </p>
        )}

        {value.onlineBookingEnabled && slug && (
          <div className="space-y-4 rounded-xl border p-4">
            {!live && <p className="text-xs text-muted-foreground">{t("online.saveToLive")}</p>}
            <CopyBox label={t("online.yourWebsite")} value={site} open={live ? site : undefined} />
            <CopyBox
              label={t("online.bookingLink")}
              value={`${site}/book`}
              open={live ? `${site}/book` : undefined}
            />
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-medium">{t("online.haveSite")}</p>
              <CopyBox
                label={t("online.step1")}
                value={`<script src="${origin}/book.js" data-salon="${slug}" async></script>`}
              />
              <CopyBox
                label={t("online.step2")}
                value={`<a href="#" data-kikai-book>Book now</a>`}
              />
              <CopyBox
                label={t("online.inline")}
                value={`<div data-kikai-book-inline></div>`}
              />
              <p className="text-xs text-muted-foreground">
                {t("online.addService", { service: 'data-service="Gel polish"', button: 'data-button="Book now"' })}
              </p>
            </div>
          </div>
        )}

        {value.onlineBookingEnabled && (
          <PageChat
            chatbotEnabled={chatbotEnabled}
            value={value.siteChatSiteId}
            onChange={(siteChatSiteId) => set({ siteChatSiteId })}
            businessName={businessName}
            brand={brand}
            pageUrl={site}
            headline={value.siteHeadline}
          />
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t("online.page")}</h3>
          <p className="text-xs text-muted-foreground">{t("online.pageFrom")}</p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("online.headline")}</span>
            <Input
              value={value.siteHeadline}
              maxLength={SITE_HEADLINE_MAX}
              placeholder={t("online.headlineExample")}
              onChange={(e) => set({ siteHeadline: e.target.value })}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("online.about")}</span>
            <Textarea
              value={value.siteAbout}
              maxLength={SITE_ABOUT_MAX}
              rows={3}
              placeholder={t("online.aboutExample")}
              onChange={(e) => set({ siteAbout: e.target.value })}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("online.address")}</span>
            <Textarea
              value={value.siteAddress}
              maxLength={SITE_ADDRESS_MAX}
              rows={2}
              placeholder={t("online.addressExample")}
              onChange={(e) => set({ siteAddress: e.target.value })}
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("online.brand")}</span>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={t("online.brandSwatch", { colour: c })}
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
                  aria-label={t("online.chooseColour")}
                />
                {t("online.anyColour")}
              </label>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t("online.rules")}</h3>
          <p className="text-xs text-muted-foreground">{t("online.rulesHow")}</p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("online.upTo")}</span>
            <select
              value={value.onlineMaxDaysAhead}
              onChange={(e) => set({ onlineMaxDaysAhead: Number(e.target.value) })}
              className="h-9 rounded-lg border bg-background px-2 text-sm"
            >
              {(AHEAD_CHOICES.includes(value.onlineMaxDaysAhead) ? AHEAD_CHOICES : [...AHEAD_CHOICES, value.onlineMaxDaysAhead]).map(
                (days) => (
                  <option key={days} value={days}>
                    {aheadLabel(days, t)}
                  </option>
                )
              )}
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
              <span className="font-medium">{t("online.chooseStylist")}</span>
              <span className="block text-xs text-muted-foreground">{t("online.chooseStylistHint")}</span>
            </span>
          </label>
          {services.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-muted-foreground">{t("online.services")}</legend>
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
              <p className="text-xs text-muted-foreground">{t("online.servicesHint")}</p>
            </fieldset>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
