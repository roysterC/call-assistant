"use client";

import { hasDiary } from "@/lib/navigation";
import { bookingReadiness } from "@/lib/booking/readiness";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Users, MessageCircle, MessageSquareText, Phone, Camera, Send, Globe } from "lucide-react";
import type { TextsStatus } from "@/lib/sms-sender";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { SaveBar, useLeaveGuard } from "@/components/ui/unsaved-changes";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { OpeningHoursEditor } from "@/components/settings/opening-hours-editor";
import { PriceListEditor } from "@/components/settings/price-list-editor";
import { addServicesToMenu, flattenMenu, type SalonMenu } from "@/lib/nail-menu";
import { StylistsEditor } from "@/components/settings/stylists-editor";
import { ServicesImport } from "@/components/settings/services-import";
import type { DayHours } from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";
import { SALON_FAQ_MAX } from "@/lib/salon-knowledge";
import { useMe } from "@/components/providers/me-provider";
import { useT } from "@/components/providers/language-provider";
import type { Translate } from "@/lib/i18n";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { SettingsSection } from "@/components/settings/settings-section";
import { TeamLogins } from "@/components/settings/team-logins";
import { cn } from "@/lib/utils";
import { settingsTabs, setupSteps, tabFromHash, type SettingsTab, type SetupStep } from "@/lib/settings-tabs";
import { VOICE_CHANNEL, type PhoneChannel } from "@/lib/phone-channels";
import {
  OnlineBookingSettings,
  onlineSettingsFrom,
  type OnlineSettings,
} from "@/components/settings/online-booking-settings";

interface Settings {
  businessName: string;
  contactPhone: string | null;
  timezone: string;
  businessHours: DayHours[];
  services: SalonService[];
  /** The price list as treatments (nail-menu.ts); `services` is made from it. */
  menu: SalonMenu;
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
  | "menu"
  | "teamMembers"
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
    menu: s.menu,
    teamMembers: s.teamMembers,
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
  const [settings, setSettings] = useState<Settings | null>(null);
  // Members see the settings but cannot change them; the API refuses them
  // too. Locked until the role has loaded, so nobody edits what they cannot
  // save.
  const me = useMe();
  const { t } = useT();
  const canEdit = me !== null && me.role !== "member";

  // The salon's logins, for each technician's "Signs in as" (owners only:
  // the list is theirs to see).
  const [logins, setLogins] = useState<Array<{ id: string; label: string }> | null>(null);
  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    apiFetch("/api/team-logins")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { users?: Array<{ id: string; name: string | null; email: string }> } | null) => {
        if (live && d?.users) setLogins(d.users.map((u) => ({ id: u.id, label: u.name ? `${u.name} (${u.email})` : u.email })));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [canEdit]);
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
  // The salon's web address, /s/<slug>.
  const [slug, setSlug] = useState<string | null>(null);
  // Where salons' pages are given out, when that is not this app's address.
  const [bookingOrigin, setBookingOrigin] = useState<string | null>(null);
  // Whether the salon's texts can go, and from whom (sms-sender.ts).
  const [texts, setTexts] = useState<TextsStatus | null>(null);

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
          menu: data.settings?.menu ?? { treatments: [], extras: [] },
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
          salonFaq: data.settings?.salonFaq ?? "",
          rebookTextsEnabled: !!data.settings?.rebookTextsEnabled,
          instagramUsername: data.settings?.instagramUsername ?? null,
          online: onlineSettingsFrom(data.settings),
        };
        setSlug(data.organizationSlug ?? null);
        setBookingOrigin(data.bookingOrigin ?? null);
        setTexts(data.texts ?? null);
        setSettings(s);
        setSaved(editable(s));

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
          // The menu: the server makes the services from it.
          menu: settings.menu,
          teamMembers: settings.teamMembers,
          salonFaq: settings.salonFaq,
          rebookTextsEnabled: settings.rebookTextsEnabled,
          ...settings.online,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(data.error || t("settings.saveFailed"));
        return false;
      }
      // Show what was stored, e.g. the contact number as texts will print it.
      const stored = {
        ...settings,
        contactPhone: data.settings?.contactPhone ?? null,
        salonFaq: data.settings?.salonFaq ?? "",
        // As stored: rows left without a name dropped.
        menu: data.settings?.menu ?? settings.menu,
        services: data.settings?.services ?? settings.services,
        // As stored: blank text cleared, the colour checked.
        online: onlineSettingsFrom(data.settings),
      };
      setSettings(stored);
      setSaved(editable(stored));
      notify(t("settings.saved"), "success");
      return true;
    } catch (error) {
      console.error("Failed to save settings:", error);
      notify(t("settings.offline"));
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
    staff: "nail technician",
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
    staffPlural: "nail technicians",
  });
  const todo = settings.hasDiary && !readiness.ready ? steps.filter((s) => !s.done) : [];
  const needs = (tb: SettingsTab) => todo.some((s) => s.tab === tb);
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
    !rebookChat && t("settings.rebook.needChat"),
    !readiness.ready && t("settings.rebook.needDiary"),
    !settings.services.some((s) => s.rebookWeeks) && t("settings.rebook.needDue"),
  ].filter((x): x is string => Boolean(x));

  const numberList = (nums: PhoneNumber[]) =>
    nums
      .filter((p) => p.active)
      .map((p) => (p.label ? `${p.number} (${p.label})` : p.number))
      .join(", ");

  // Every channel, switched on or not, so the salon sees what it has and what
  // it could have. Kikai switches them on; nothing here changes them.
  const chatDoes = settings.chatBookingEnabled
    ? t("settings.channels.chatBooks")
    : settings.hasDiary
      ? t("settings.channels.chatNumber")
      : t("settings.channels.chatAnswers");
  const status = (enabled: boolean, ready: boolean, notReady: string) => channelStatus(enabled, ready, notReady, t);
  const channels: ChannelRow[] = [
    // Every booking's confirmation and reminder go this way, so first, and
    // never "Off": without a sender they all fail (sms-sender.ts).
    ...(texts
      ? [
          {
            id: "texts",
            name: t("settings.channels.texts"),
            icon: MessageSquareText,
            address: texts.ready && texts.sender ? t("settings.channels.textsFrom", { sender: texts.sender }) : "",
            does: texts.ready ? t("settings.channels.textsOn") : t("settings.channels.textsOff"),
            status: (texts.ready ? "on" : "waiting") as ChannelState,
            statusText: texts.ready ? t("settings.on") : t("settings.channels.notSetUp"),
          },
        ]
      : []),
    {
      id: "phone",
      name: t("settings.channels.phone"),
      icon: Phone,
      address: numberList(voiceNumbers),
      does: t("settings.channels.phoneDoes"),
      ...status(settings.voiceEnabled, Boolean(numberList(voiceNumbers)), t("settings.channels.noNumber")),
    },
    {
      id: "instagram",
      name: "Instagram",
      icon: Camera,
      address: settings.instagramUsername ? `@${settings.instagramUsername}` : "",
      does: chatDoes,
      ...status(settings.instagramEnabled, Boolean(settings.instagramBusinessId), t("settings.channels.notLinked")),
    },
    {
      id: "whatsapp",
      name: "WhatsApp",
      icon: MessageCircle,
      address: numberList(whatsappNumbers),
      does: chatDoes,
      ...status(settings.whatsappEnabled, Boolean(numberList(whatsappNumbers)), t("settings.channels.noNumber")),
    },
    {
      id: "facebook",
      name: "Facebook Messenger",
      icon: Send,
      address: "",
      does: chatDoes,
      ...status(settings.facebookEnabled, Boolean(settings.facebookPageId), t("settings.channels.notLinked")),
    },
    {
      id: "website",
      name: t("settings.channels.website"),
      icon: Globe,
      address: "",
      does: "",
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
        title={t("settings.title")}
        actions={
          me?.role === "member" ? (
            <span className="text-sm text-muted-foreground">
              {t("settings.ownerOnly")}
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
        aria-label={t("settings.tabsLabel")}
        // Scrolls sideways on a phone, never up and down: the line under the
        // tabs is drawn inside the bar (an inset shadow) rather than as a
        // border the tabs overlap, which overflowed by a pixel and gave the
        // bar a vertical scrollbar. The scrollbar itself is hidden; a swipe
        // still scrolls it.
        className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden px-1 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const i = tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1);
          const next = tabs[(i + tabs.length) % tabs.length];
          choose(next);
          document.getElementById(`tab-${next}`)?.focus();
        }}
      >
        {tabs.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            id={`tab-${tb}`}
            aria-selected={tb === tab}
            aria-controls={`panel-${tb}`}
            tabIndex={tb === tab ? 0 : -1}
            onClick={() => choose(tb)}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm transition-colors",
              tb === tab
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`settings.tab.${tb}`)}
            {needs(tb) ? (
              <span className="h-2 w-2 rounded-full bg-papaya-whip-400">
                <span className="sr-only">{t("settings.needsDoing")}</span>
              </span>
            ) : counts[tb] !== undefined ? (
              <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">{counts[tb]}</span>
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
                title={t("settings.details.title")}
                description={t("settings.details.description")}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">{t("settings.details.name")}</span>
                    <Input
                      value={settings.businessName}
                      onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">{t("settings.details.phone")}</span>
                    <Input
                      value={settings.contactPhone ?? ""}
                      placeholder="01234 567890"
                      onChange={(e) => setSettings({ ...settings, contactPhone: e.target.value })}
                    />
                    {/* Texts go out from a one-way sender, so without this a client
                        who cannot make their appointment has no way to tell you. */}
                    <span className="block text-xs text-muted-foreground">
                      {t("settings.details.phoneHint")}
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
                  title={t("settings.hours.title")}
                  description={t("settings.hours.description")}
                  attention={needs("salon")}
                >
                  <OpeningHoursEditor
                    value={settings.businessHours}
                    onChange={(businessHours) => setSettings({ ...settings, businessHours })}
                  />
                </SettingsSection>
              )}

            </>
          )}

          {tab === "services" && (
            <SettingsSection
              id="price-list"
              title={t("settings.prices.title")}
              description={t("settings.prices.description")}
              attention={needs("services")}
            >
              <PriceListEditor
                value={settings.menu}
                onChange={(menu) => setSettings({ ...settings, menu, services: flattenMenu(menu) })}
                rebook={settings.rebookTextsEnabled}
                importer={
                  <ServicesImport
                    short
                    services={settings.services}
                    onApply={(services) => {
                      const menu = addServicesToMenu(settings.menu, services);
                      setSettings({ ...settings, menu, services: flattenMenu(menu) });
                    }}
                    className="h-11 w-full rounded-xl text-sm font-semibold"
                  />
                }
              />
            </SettingsSection>
          )}

          {tab === "team" && (
            <>
              {settings.hasDiary && (
                <SettingsSection
                  id="people"
                  title={t("settings.team.title")}
                  description={usesGoogle ? t("settings.team.descriptionGoogle") : t("settings.team.description")}
                  attention={needs("team")}
                >
                  {settings.teamMembers.length === 0 && (
                    <EmptyState
                      icon={Users}
                      title={t("settings.team.empty")}
                      hint={t("settings.team.emptyHint")}
                    />
                  )}
                  <StylistsEditor
                    value={settings.teamMembers}
                    services={settings.services}
                    businessHours={settings.businessHours}
                    usesGoogle={usesGoogle}
                    logins={canEdit ? logins : null}
                    onInvite={() => document.getElementById("team-logins")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    onChange={(teamMembers) => setSettings({ ...settings, teamMembers })}
                  />
                </SettingsSection>
              )}

              {/* Who can sign in: the owner invites and removes staff here. */}
              {canEdit && <TeamLogins salon={settings.businessName || t("settings.yourSalon")} />}
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
              notReady={!readiness.ready}
              chatbotEnabled={settings.chatbotEnabled}
              businessName={settings.businessName}
            />
          )}

          {tab === "chats" && (
            <>
              <SettingsSection
                id="channels"
                title={t("settings.channels.title")}
                description={t("settings.channels.description")}
              >
                <ul className="divide-y divide-border overflow-hidden rounded-lg ring-1 ring-border">
                  {channels.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <c.icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {c.name}
                          {c.address && <span className="ml-1.5 font-normal text-muted-foreground">{c.address}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {c.id === "website" ? (
                            <>
                              {t("settings.channels.websiteDoes")}{" "}
                              <a href="#online" className="font-medium underline underline-offset-2">
                                {t("settings.tab.online")}
                              </a>
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
                  title={t("settings.rebook.title")}
                  description={t("settings.rebook.description")}
                  actions={
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        STATUS_STYLE[settings.rebookTextsEnabled ? "on" : "off"]
                      )}
                    >
                      {settings.rebookTextsEnabled ? t("settings.on") : t("settings.off")}
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
                        <span className="font-medium">{t("settings.rebook.label")}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t("settings.rebook.how", { chat: rebookChat ?? t("settings.rebook.eitherChat") })}
                        </span>
                      </span>
                    </label>
                    <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                      {rebookSample(settings.businessName)}
                    </p>
                    {settings.rebookTextsEnabled && rebookNeeds.length > 0 && (
                      <p role="status" className="rounded-lg bg-papaya-whip-700 px-3 py-2 text-xs text-papaya-whip-100">
                        {t("settings.rebook.notSending", { reasons: rebookNeeds.join("; ") })}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("settings.rebook.dueIn")}{" "}
                      <button type="button" className="font-medium underline underline-offset-2" onClick={() => choose("services", "price-list")}>
                        {t("settings.tab.services")}
                      </button>
                      {t("settings.rebook.dueExample")}
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
                  title={t("settings.faq.title")}
                  description={t("settings.faq.description")}
                >
                  <div className="space-y-1.5">
                    <Textarea
                      aria-label={t("settings.faq.label")}
                      value={settings.salonFaq}
                      maxLength={SALON_FAQ_MAX}
                      rows={8}
                      placeholder={t("settings.faq.placeholder")}
                      onChange={(e) => setSettings({ ...settings, salonFaq: e.target.value })}
                      className="min-h-40"
                    />
                    <p className="flex justify-between gap-3 text-xs text-muted-foreground">
                      <span>{t("settings.faq.hint")}</span>
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
  id: string;
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
function channelStatus(enabled: boolean, ready: boolean, notReady: string, t: Translate): { status: ChannelState; statusText: string } {
  if (!enabled) return { status: "off", statusText: t("settings.off") };
  return ready ? { status: "on", statusText: t("settings.on") } : { status: "waiting", statusText: notReady };
}

/**
 * What a rebooking text looks like. Texts to clients are in English, whatever
 * language the CRM is read in, so the example is too.
 */
function rebookSample(salon: string): string {
  return `“Hi Mai, your BIAB infill is due. Lan has Thursday at 3pm free. Book: https://…/r/Ab3kQ9 Stop these: https://…/r/Ab3kQ9/stop ${salon || "Your salon"}”`;
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
  const { t } = useT();
  const done = steps.filter((s) => s.done).length;
  return (
    <div role="status" className="space-y-2 rounded-xl bg-card px-4 py-3 shadow-surface ring-1 ring-papaya-whip-400">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium">{done === 0 ? t("settings.setup.start") : t("settings.setup.almost")}</span>
        <span aria-hidden="true" className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${(done / steps.length) * 100}%` }} />
        </span>
        <span className="text-sm text-muted-foreground">
          {t("settings.setup.done", { done, total: steps.length })}
        </span>
        <button
          type="button"
          onClick={() => onGo(next)}
          className="ml-auto text-sm font-semibold text-papaya-whip-100 underline-offset-4 hover:underline"
        >
          {t(`settings.step.${next.key}`)} →
        </button>
      </div>
      {takesMessages && (
        <p className="text-xs text-muted-foreground">{t("settings.setup.messages")}</p>
      )}
    </div>
  );
}
