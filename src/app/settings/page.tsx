"use client";

import { hasDiary } from "@/lib/navigation";
import { bookingReadiness, missingText } from "@/lib/booking/readiness";
import { useTradeWords } from "@/components/providers/language-provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Users, MessageCircle, Phone, Camera, Send, Globe } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { SaveBar, useLeaveGuard } from "@/components/ui/unsaved-changes";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { OpeningHoursEditor } from "@/components/settings/opening-hours-editor";
import { ServicesEditor } from "@/components/settings/services-editor";
import { StylistsEditor } from "@/components/settings/stylists-editor";
import { ServicesImport } from "@/components/settings/services-import";
import type { DayHours } from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";
import { DASHBOARD, NAV_PAGES, isNavVisible, isStartPageChoice } from "@/lib/navigation";
import { SALON_FAQ_MAX } from "@/lib/salon-knowledge";
import { useMe } from "@/components/providers/me-provider";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { SettingsSection } from "@/components/settings/settings-section";
import { TeamLogins } from "@/components/settings/team-logins";
import { cn } from "@/lib/utils";
import { settingsTabs, setupSteps, tabFromHash, TAB_LABELS, type SettingsTab, type SetupStep } from "@/lib/settings-tabs";
import { VOICE_CHANNEL, type PhoneChannel } from "@/lib/phone-channels";
import {
  OnlineBookingSettings,
  onlineSettingsFrom,
  type OnlineSettings,
} from "@/components/settings/online-booking-settings";

const labelFor = (href: string) => NAV_PAGES.find((p) => p.href === href)?.label ?? "Dashboard";

interface Settings {
  businessName: string;
  contactPhone: string | null;
  timezone: string;
  businessHours: DayHours[];
  services: SalonService[];
  teamMembers: Stylist[];
  chatbotEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  /** The diary, by itself or by what books into it (hasDiary). */
  hasDiary: boolean;
  /** WhatsApp, Instagram and Messenger book into the diary (chat-booking.ts). */
  chatBookingEnabled: boolean;
  instagramEnabled: boolean;
  instagramBusinessId: string | null;
  facebookEnabled: boolean;
  facebookPageId: string | null;
  /** "native" (our own diary) or "google". */
  diaryProvider?: string;
  /** The page the CRM opens on; null for automatic. */
  startPage: string | null;
  /** The salon's own answers to common questions, for the bots. */
  salonFaq: string;
  /** Texts to clients due back for a service (src/lib/rebook.ts). */
  rebookTextsEnabled: boolean;
  /** Where a rebooking text's link opens the chat, if not WhatsApp. */
  instagramUsername: string | null;
  /** The salon's website and online booking (src/lib/online-booking). */
  online: OnlineSettings;
}

/** The fields this page edits and saves: what "unsaved changes" compares. */
type Editable = Pick<
  Settings,
  | "businessName"
  | "contactPhone"
  | "timezone"
  | "businessHours"
  | "services"
  | "teamMembers"
  | "startPage"
  | "salonFaq"
  | "rebookTextsEnabled"
  | "online"
>;

function editable(s: Settings): Editable {
  return {
    businessName: s.businessName,
    contactPhone: s.contactPhone,
    timezone: s.timezone,
    businessHours: s.businessHours,
    services: s.services,
    teamMembers: s.teamMembers,
    startPage: s.startPage,
    salonFaq: s.salonFaq,
    rebookTextsEnabled: s.rebookTextsEnabled,
    online: s.online,
  };
}

interface PhoneNumber {
  id: string;
  number: string;
  channel: PhoneChannel;
  label: string | null;
  active: boolean;
  createdAt: string;
}

export default function SettingsPage() {
  const w = useTradeWords();
  const [settings, setSettings] = useState<Settings | null>(null);
  // Members see the settings but cannot change them; the API refuses them
  // too. Locked until the role has loaded, so nobody edits what they cannot
  // save.
  const me = useMe();
  const canEdit = me !== null && me.role !== "member";
  const [whatsappNumbers, setWhatsappNumbers] = useState<PhoneNumber[]>([]);
  const [voiceNumbers, setVoiceNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // What was last loaded or saved: the page has unsaved changes while what is
  // on screen differs from it (see the save bar and the leave guard below).
  const [saved, setSaved] = useState<Editable | null>(null);
  // What a save did, as a snack bar. It used to say nothing either way, which
  // is how a contact number that never saved went unnoticed.
  const { notify } = useDialogs();
  // What "automatic" currently means for this organisation, to show beside it.
  const [automaticStart, setAutomaticStart] = useState<string>(DASHBOARD);
  // The salon's web address, /s/<slug>.
  const [slug, setSlug] = useState<string | null>(null);
  // Where salons' pages are given out, when that is not this app's address.
  const [bookingOrigin, setBookingOrigin] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        const res = await apiFetch("/api/settings");
        const data = await res.json();
        const s: Settings = {
          businessName: data.settings?.businessName || "",
          contactPhone: data.settings?.contactPhone ?? null,
          timezone: data.settings?.timezone || "Europe/London",
          businessHours: data.settings?.businessHours || [],
          services: data.settings?.services || [],
          teamMembers: data.settings?.teamMembers || [],
          chatbotEnabled: !!data.settings?.chatbotEnabled,
          whatsappEnabled: !!data.settings?.whatsappEnabled,
          voiceEnabled: !!data.settings?.voiceEnabled,
          hasDiary: data.settings ? hasDiary(data.settings) : false,
          diaryProvider: data.settings?.diaryProvider ?? "native",
          chatBookingEnabled: !!data.settings?.chatBookingEnabled,
          instagramEnabled: !!data.settings?.instagramEnabled,
          instagramBusinessId: data.settings?.instagramBusinessId ?? null,
          facebookEnabled: !!data.settings?.facebookEnabled,
          facebookPageId: data.settings?.facebookPageId ?? null,
          startPage: data.settings?.startPage ?? null,
          salonFaq: data.settings?.salonFaq ?? "",
          rebookTextsEnabled: !!data.settings?.rebookTextsEnabled,
          instagramUsername: data.settings?.instagramUsername ?? null,
          online: onlineSettingsFrom(data.settings),
        };
        setSlug(data.organizationSlug ?? null);
        setBookingOrigin(data.bookingOrigin ?? null);
        setSettings(s);
        setSaved(editable(s));
        if (!s.startPage && data.startPage) setAutomaticStart(data.startPage);

        // Parallel phone-number fetches (only for enabled features)
        const fetches: Promise<void>[] = [];
        if (s.whatsappEnabled) {
          fetches.push(
            apiFetch("/api/phone-numbers?channel=whatsapp")
              .then((r) => r.json())
              .then((d) => setWhatsappNumbers(d.phoneNumbers || []))
              .catch(() => setWhatsappNumbers([])),
          );
        }
        if (s.voiceEnabled) {
          fetches.push(
            apiFetch(`/api/phone-numbers?channel=${VOICE_CHANNEL}`)
              .then((r) => r.json())
              .then((d) => setVoiceNumbers(d.phoneNumbers || []))
              .catch(() => setVoiceNumbers([])),
          );
        }
        await Promise.allSettled(fetches);
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  /** Whether it saved: a page is only left after a save that worked. */
  async function handleSave(): Promise<boolean> {
    if (!settings) return false;
    setSaving(true);
    try {
      // Only send the fields the settings page actually edits. The API
      // strips super-admin-only fields anyway, but being explicit here
      // avoids round-tripping stale flag state.
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: settings.businessName,
          contactPhone: settings.contactPhone,
          timezone: settings.timezone,
          businessHours: settings.businessHours,
          services: settings.services,
          teamMembers: settings.teamMembers,
          startPage: settings.startPage ?? "",
          salonFaq: settings.salonFaq,
          rebookTextsEnabled: settings.rebookTextsEnabled,
          ...settings.online,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(data.error || "Could not save your changes.");
        return false;
      }
      // Show what was stored, e.g. the contact number as texts will print it.
      const stored = {
        ...settings,
        contactPhone: data.settings?.contactPhone ?? null,
        startPage: data.settings?.startPage ?? null,
        salonFaq: data.settings?.salonFaq ?? "",
        // As stored: blank text cleared, the colour checked.
        online: onlineSettingsFrom(data.settings),
      };
      setSettings(stored);
      setSaved(editable(stored));
      notify("Settings saved", "success");
      return true;
    } catch (error) {
      console.error("Failed to save settings:", error);
      notify("Could not reach the server. Your changes are not saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Hooks before the early return below, so they run on every render.
  const dirty = Boolean(canEdit && settings && saved && JSON.stringify(editable(settings)) !== JSON.stringify(saved));
  const discard = () => {
    if (settings && saved) setSettings({ ...settings, ...saved });
  };
  const { dialog: leaveGuard } = useLeaveGuard({ dirty, save: handleSave, discard });

  // Which tab is open: kept in the address (#services), so a reload or a
  // link (onboarding's #team-logins) opens the right one.
  const [hash, setHash] = useState(() => (typeof window === "undefined" ? "" : window.location.hash));
  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const readiness = bookingReadiness({
    services: settings.services,
    teamMembers: settings.teamMembers,
    businessHours: settings.businessHours,
    diaryProvider: settings.diaryProvider,
    staff: w("stylist"),
  });
  const usesGoogle = settings.diaryProvider === "google";

  // The tabs, and the one open.
  const tabs = settingsTabs({ hasDiary: settings.hasDiary, canEdit });
  const tab = tabFromHash(hash, tabs);
  const choose = (next: SettingsTab, anchor?: string) => {
    setHash(`#${next}`);
    window.history.replaceState(null, "", `#${next}`);
    if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // What setup still needs before anything can be booked: the same three
  // checks as bookingReadiness, as steps, each pointing at its tab.
  const steps = setupSteps({
    serviceCount: settings.services.length,
    teamReady: usesGoogle ? settings.teamMembers.some((s) => s.googleCalendarId) : settings.teamMembers.length > 0,
    hoursOpen: settings.businessHours.some((d) => !d.closed),
    staffPlural: w("stylists"),
  });
  const todo = settings.hasDiary && !readiness.ready ? steps.filter((s) => !s.done) : [];
  const needs = (t: SettingsTab) => todo.some((s) => s.tab === t);
  const counts: Partial<Record<SettingsTab, number>> = settings.hasDiary
    ? { services: settings.services.length, team: settings.teamMembers.length }
    : {};

  // What rebooking texts still need, from what is on screen (the same tests
  // as salonCannotSend in src/lib/rebook.ts, but the switch itself).
  const rebookChat =
    settings.whatsappEnabled && whatsappNumbers.some((n) => n.active)
      ? "WhatsApp"
      : settings.instagramEnabled && settings.instagramUsername
        ? "Instagram"
        : null;
  const rebookNeeds = [
    !rebookChat && "a WhatsApp number or your Instagram username, which Kikai sets up",
    !readiness.ready && `the diary cannot take bookings yet (${missingText(readiness)})`,
    !settings.services.some((s) => s.rebookWeeks) && "no service has a \"due again after\" yet",
  ].filter((x): x is string => Boolean(x));

  const numberList = (nums: PhoneNumber[]) =>
    nums
      .filter((p) => p.active)
      .map((p) => (p.label ? `${p.number} (${p.label})` : p.number))
      .join(", ");

  // Every channel, switched on or not, so the salon sees what it has and what
  // it could have. Kikai switches them on; nothing here changes them.
  const chatDoes = settings.chatBookingEnabled
    ? "Answers messages and books into the diary"
    : settings.hasDiary
      ? "Answers questions, and gives your number or takes a call-back request to book"
      : "Answers questions";
  const channels: ChannelRow[] = [
    {
      name: "Phone receptionist",
      icon: Phone,
      address: numberList(voiceNumbers),
      does: "Answers calls and books into the diary",
      ...status(settings.voiceEnabled, Boolean(numberList(voiceNumbers)), "No number yet"),
    },
    {
      name: "Instagram",
      icon: Camera,
      address: settings.instagramUsername ? `@${settings.instagramUsername}` : "",
      does: chatDoes,
      ...status(settings.instagramEnabled, Boolean(settings.instagramBusinessId), "Not linked yet"),
    },
    {
      name: "WhatsApp",
      icon: MessageCircle,
      address: numberList(whatsappNumbers),
      does: chatDoes,
      ...status(settings.whatsappEnabled, Boolean(numberList(whatsappNumbers)), "No number yet"),
    },
    {
      name: "Facebook Messenger",
      icon: Send,
      address: "",
      does: chatDoes,
      ...status(settings.facebookEnabled, Boolean(settings.facebookPageId), "Not linked yet"),
    },
    {
      name: "Website chat",
      icon: Globe,
      address: "",
      does: "A chat on your website or your booking page, set up in Websites",
      ...status(settings.chatbotEnabled, true, ""),
    },
  ];

  const botsOn =
    settings.voiceEnabled ||
    settings.chatbotEnabled ||
    settings.whatsappEnabled ||
    settings.instagramEnabled ||
    settings.facebookEnabled;

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-24">
      <PageHeader
        title="Settings"
        actions={
          me?.role === "member" ? (
            <span className="text-sm text-muted-foreground">
              Only the salon&apos;s owner can change these.
            </span>
          ) : undefined
        }
      />

      {/* What the diary still needs before the phone and chats can book,
          worked out from what is on screen, so it clears as they fill it in
          (booking/readiness.ts). Above the tabs, so it is seen on any of them. */}
      {todo.length > 0 && (
        <SetupProgress
          steps={steps}
          next={todo[0]}
          takesMessages={settings.voiceEnabled || settings.chatBookingEnabled}
          onGo={(s) => choose(s.tab, s.anchor)}
        />
      )}

      <div
        role="tablist"
        aria-label="Settings"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const i = tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1);
          const next = tabs[(i + tabs.length) % tabs.length];
          choose(next);
          document.getElementById(`tab-${next}`)?.focus();
        }}
      >
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={t === tab}
            aria-controls={`panel-${t}`}
            tabIndex={t === tab ? 0 : -1}
            onClick={() => choose(t)}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm transition-colors",
              t === tab
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {TAB_LABELS[t]}
            {needs(t) ? (
              <span className="h-2 w-2 rounded-full bg-papaya-whip-400">
                <span className="sr-only"> (needs doing)</span>
              </span>
            ) : counts[t] !== undefined ? (
              <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">{counts[t]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Everything a save changes. Disabled as one, so a member sees the
          salon's setup but no control in it works. */}
      <fieldset disabled={!canEdit} className="min-w-0">
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-5">
          {tab === "salon" && (
            <>
              <SettingsSection
                id="details"
                title="Salon details"
                description="How the salon is named to clients: on the phone, in chats and in every text."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">Salon name</span>
                    <Input
                      value={settings.businessName}
                      onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">Contact number</span>
                    <Input
                      value={settings.contactPhone ?? ""}
                      placeholder="01234 567890"
                      onChange={(e) => setSettings({ ...settings, contactPhone: e.target.value })}
                    />
                    {/* Texts go out from a one-way sender, so without this a client
                        who cannot make their appointment has no way to tell you. */}
                    <span className="block text-xs text-muted-foreground">
                      Printed in confirmation and reminder texts, which clients cannot reply to.
                    </span>
                  </label>
                </div>
              </SettingsSection>

              {/* Hours, services and who can be booked all feed the same place:
                  the availability rules enforce them, and the receptionist's
                  instructions are written from them, so what it says and what
                  it will do cannot drift apart. */}
              {settings.hasDiary && (
                <SettingsSection
                  id="hours"
                  title="Opening hours"
                  description="When appointments can be booked, and what the receptionist tells callers."
                  attention={needs("salon")}
                >
                  <OpeningHoursEditor
                    value={settings.businessHours}
                    onChange={(businessHours) => setSettings({ ...settings, businessHours })}
                  />
                </SettingsSection>
              )}

              <SettingsSection
                id="start-page"
                title="Start page"
                description="The screen Kikai opens on after signing in, and the top of the menu."
                actions={
                  <select
                    aria-label="Start page"
                    value={settings.startPage ?? ""}
                    onChange={(e) => setSettings({ ...settings, startPage: e.target.value || null })}
                    className="flex h-9 min-w-56 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="">Automatic ({labelFor(automaticStart)})</option>
                    {NAV_PAGES.filter(
                      (p) => isStartPageChoice(p.href) && isNavVisible(p, { ...settings, diaryEnabled: settings.hasDiary })
                    ).map((p) => (
                      <option key={p.href} value={p.href}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                }
              />
            </>
          )}

          {tab === "services" && (
            <SettingsSection
              id="price-list"
              title="Your price list"
              description="Length decides how much of the diary is blocked. Prices are quoted as “from”."
              attention={needs("services")}
            >
              <div className="space-y-3">
                <ServicesImport
                  services={settings.services}
                  onApply={(services) => setSettings({ ...settings, services })}
                />
                <ServicesEditor
                  value={settings.services}
                  onChange={(services) => setSettings({ ...settings, services })}
                  rebook={settings.rebookTextsEnabled}
                />
              </div>
            </SettingsSection>
          )}

          {tab === "team" && (
            <>
              {settings.hasDiary && (
                <SettingsSection
                  id="people"
                  title={w("Your stylists")}
                  description={
                    usesGoogle
                      ? "Each needs a Google calendar shared with the service account before they can be booked."
                      : "Who can be booked, on which days, and for what."
                  }
                  attention={needs("team")}
                >
                  {settings.teamMembers.length === 0 && (
                    <EmptyState
                      icon={Users}
                      title="No one added yet"
                      hint={w("Add a stylist so the receptionist has someone to book with.")}
                    />
                  )}
                  <StylistsEditor
                    value={settings.teamMembers}
                    services={settings.services}
                    businessHours={settings.businessHours}
                    usesGoogle={usesGoogle}
                    onChange={(teamMembers) => setSettings({ ...settings, teamMembers })}
                  />
                </SettingsSection>
              )}

              {/* Who can sign in: the owner invites and removes staff here. */}
              {canEdit && <TeamLogins salon={settings.businessName || "your salon"} />}
            </>
          )}

          {/* The salon's website and online booking (src/lib/online-booking):
              the salon's own choice, like rebooking texts. */}
          {tab === "online" && (
            <OnlineBookingSettings
              value={settings.online}
              onChange={(online) => setSettings({ ...settings, online })}
              slug={slug}
              bookingOrigin={bookingOrigin}
              live={Boolean(saved?.online.onlineBookingEnabled)}
              services={settings.services}
              notReady={readiness.ready ? null : missingText(readiness)}
              staff={w("stylist")}
              chatbotEnabled={settings.chatbotEnabled}
            />
          )}

          {tab === "chats" && (
            <>
              <SettingsSection
                id="channels"
                title="Where clients reach you"
                description="What each one does for you. Kikai sets these up: ask us to switch one on."
              >
                <ul className="divide-y divide-border overflow-hidden rounded-lg ring-1 ring-border">
                  {channels.map((c) => (
                    <li key={c.name} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <c.icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {c.name}
                          {c.address && <span className="ml-1.5 font-normal text-muted-foreground">{c.address}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {c.name === "Website chat" ? (
                            <>
                              A chat on your website or your booking page, set up in{" "}
                              <Link href="/websites" className="font-medium underline underline-offset-2">
                                Websites
                              </Link>
                            </>
                          ) : (
                            c.does
                          )}
                        </p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[c.status])}>
                        {c.statusText}
                      </span>
                    </li>
                  ))}
                </ul>
              </SettingsSection>

              {/* Rebooking texts (src/lib/rebook.ts): the salon's own choice, since
                  they go to its clients in its name. Only where chats book, as the
                  text's link opens one. */}
              {settings.chatBookingEnabled && (
                <SettingsSection
                  id="rebooking"
                  title="Rebooking texts"
                  description="A text to clients when they are due back, offering a free time."
                  actions={
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        STATUS_STYLE[settings.rebookTextsEnabled ? "on" : "off"]
                      )}
                    >
                      {settings.rebookTextsEnabled ? "On" : "Off"}
                    </span>
                  }
                >
                  <div className="space-y-3">
                    <label className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-primary"
                        checked={settings.rebookTextsEnabled}
                        onChange={(e) => setSettings({ ...settings, rebookTextsEnabled: e.target.checked })}
                      />
                      <span>
                        <span className="font-medium">Text clients when they are due back</span>
                        <span className="block text-xs text-muted-foreground">
                          Sent in the morning, a few days before, to clients with nothing booked. It
                          offers a free time with the same {w("stylist")} where there is one, and a
                          link that opens your {rebookChat ?? "WhatsApp or Instagram"} chat with the
                          booking written for them. Each text has a link to stop them.
                        </span>
                      </span>
                    </label>
                    <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                      &ldquo;Hi Mai, your BIAB infill is due. Lan has Thursday at 3pm free. Book:
                      https://…/r/Ab3kQ9 Stop these: https://…/r/Ab3kQ9/stop {settings.businessName || "Your salon"}&rdquo;
                    </p>
                    {settings.rebookTextsEnabled && rebookNeeds.length > 0 && (
                      <p role="status" className="rounded-lg bg-papaya-whip-700 px-3 py-2 text-xs text-papaya-whip-100">
                        Not sending yet: {rebookNeeds.join("; ")}.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Set when each service is due again in{" "}
                      <button type="button" className="font-medium underline underline-offset-2" onClick={() => choose("services", "price-list")}>
                        Services
                      </button>
                      , e.g. an infill after 3 weeks. A new set can be rebooked as an infill.
                    </p>
                  </div>
                </SettingsSection>
              )}

              {/* What the bots may tell customers about the salon beyond the hours,
                  services, prices and team. They answer salon questions only
                  from Settings, so anything not written anywhere gets "I'm not sure"
                  rather than a guess. */}
              {botsOn && (
                <SettingsSection
                  id="faq"
                  title="What the receptionist and chats know"
                  description="They already know your hours, services, prices and team. For anything else about the salon they only use what you write here, and say they are not sure otherwise."
                >
                  <div className="space-y-1.5">
                    <Textarea
                      aria-label="Your answers to common questions"
                      value={settings.salonFaq}
                      maxLength={SALON_FAQ_MAX}
                      rows={8}
                      placeholder={
                        "Where are you? 47 Bridge Street, next to the florist.\n" +
                        "Parking? Six spaces behind the salon; the Castle Street multi-storey is two minutes away.\n" +
                        "Cancellations: please give 24 hours' notice.\n" +
                        "Gift vouchers: yes, any amount, from the desk."
                      }
                      onChange={(e) => setSettings({ ...settings, salonFaq: e.target.value })}
                      className="min-h-40"
                    />
                    <p className="flex justify-between gap-3 text-xs text-muted-foreground">
                      <span>A question and its answer per line is plenty. Prices come from Services, quoted as &ldquo;from&rdquo;.</span>
                      <span className="shrink-0 tabular-nums">
                        {settings.salonFaq.length}/{SALON_FAQ_MAX}
                      </span>
                    </p>
                  </div>
                </SettingsSection>
              )}
            </>
          )}
        </div>
      </fieldset>

      {/* Comes up once something is changed; see unsaved-changes.tsx. One
          save for every tab, so a change on one is kept while looking at another. */}
      {canEdit && <SaveBar dirty={dirty} saving={saving} onSave={() => void handleSave()} onDiscard={discard} />}
      {leaveGuard}
    </div>
  );
}

type ChannelState = "on" | "waiting" | "off";

interface ChannelRow {
  name: string;
  icon: typeof Phone;
  address: string;
  does: string;
  status: ChannelState;
  statusText: string;
}

const STATUS_STYLE: Record<ChannelState, string> = {
  on: "bg-tea-green-800 text-tea-green-200",
  waiting: "bg-papaya-whip-700 text-papaya-whip-100",
  off: "bg-muted text-muted-foreground",
};

/** A channel's status: on and working, switched on but not set up yet, or off. */
function status(enabled: boolean, ready: boolean, notReady: string): { status: ChannelState; statusText: string } {
  if (!enabled) return { status: "off", statusText: "Off" };
  return ready ? { status: "on", statusText: "On" } : { status: "waiting", statusText: notReady };
}

/**
 * How far setup has got, above the tabs until bookings can be taken, with
 * the next thing to do: one click opens its tab at the right section.
 */
function SetupProgress({
  steps,
  next,
  takesMessages,
  onGo,
}: {
  steps: SetupStep[];
  next: SetupStep;
  takesMessages: boolean;
  onGo: (step: SetupStep) => void;
}) {
  const done = steps.filter((s) => s.done).length;
  return (
    <div role="status" className="space-y-2 rounded-xl bg-card px-4 py-3 shadow-surface ring-1 ring-papaya-whip-400">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium">{done === 0 ? "Set up your diary to take bookings" : "Almost ready to take bookings"}</span>
        <span aria-hidden="true" className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${(done / steps.length) * 100}%` }} />
        </span>
        <span className="text-sm text-muted-foreground">
          {done} of {steps.length} done
        </span>
        <button
          type="button"
          onClick={() => onGo(next)}
          className="ml-auto text-sm font-semibold text-papaya-whip-100 underline-offset-4 hover:underline"
        >
          {next.label} →
        </button>
      </div>
      {takesMessages && (
        <p className="text-xs text-muted-foreground">Until then the receptionist and chats take messages instead of booking.</p>
      )}
    </div>
  );
}
