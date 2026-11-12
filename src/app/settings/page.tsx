"use client";

import { hasDiary } from "@/lib/navigation";
import { bookingReadiness, missingText } from "@/lib/booking/readiness";
import { useTradeWords } from "@/components/providers/language-provider";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  MessageSquare,
  MessageCircle,
  Phone,
  Camera,
  Send,
  AlertTriangle,
} from "lucide-react";
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
import { ExpandableSection } from "@/components/settings/expandable-section";
import { TeamLogins } from "@/components/settings/team-logins";
import { plural } from "@/lib/plural";
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

  // Built here rather than inline in the JSX so the five channels are declared
  // once, in one shape, instead of five hand-written blocks that drifted apart.
  const numberList = (nums: PhoneNumber[]) =>
    nums
      .map((p) => (p.label ? `${p.number} (${p.label})` : p.number))
      .join(", ");

  const channels: {
    label: string;
    icon: typeof MessageSquare;
    enabled: boolean;
    detail: string;
    missing: string;
  }[] = [
    {
      label: "Website chatbot",
      icon: MessageSquare,
      enabled: settings.chatbotEnabled,
      detail: "",
      missing: "Configured under Websites",
    },
    {
      label: "WhatsApp",
      icon: MessageCircle,
      enabled: settings.whatsappEnabled,
      detail: numberList(whatsappNumbers),
      missing: "No number assigned yet — contact Kikai",
    },
    {
      label: "Voice agent",
      icon: Phone,
      enabled: settings.voiceEnabled,
      detail: numberList(voiceNumbers),
      missing: "No number assigned yet — contact Kikai",
    },
    {
      label: "Instagram",
      icon: Camera,
      enabled: settings.instagramEnabled,
      detail: settings.instagramBusinessId || "",
      missing: "No business account linked yet — contact Kikai",
    },
    {
      label: "Facebook Messenger",
      icon: Send,
      enabled: settings.facebookEnabled,
      detail: settings.facebookPageId || "",
      missing: "No Page linked yet — contact Kikai",
    },
  ].filter((c) => c.enabled);

  return (
    <div className="space-y-6">
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
          (booking/readiness.ts). Until then those take messages instead. */}
      {settings.hasDiary && !readiness.ready && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-papaya-whip-400 bg-papaya-whip-700 px-4 py-3 text-sm text-papaya-whip-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-medium">Not taking bookings yet:</span> {missingText(readiness)}.{" "}
            {canEdit ? "Add them below, then save." : "The salon's owner can add them here."}
            {(settings.voiceEnabled || settings.chatBookingEnabled) &&
              " Until then the receptionist and chats take messages instead of booking."}
          </p>
        </div>
      )}

      {/* Everything a save changes. Disabled as one, so a member sees the
          salon's setup but no control in it works. */}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
        {/* Business Info — always visible */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Business name</label>
              <Input
                value={settings.businessName}
                onChange={(e) =>
                  setSettings({ ...settings, businessName: e.target.value })
                }
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Contact number</label>
              <Input
                value={settings.contactPhone ?? ""}
                placeholder="01234 567890"
                onChange={(e) =>
                  setSettings({ ...settings, contactPhone: e.target.value })
                }
                className="mt-1"
              />
              {/* Texts go out from a one-way sender, so without this a client
                  who cannot make their appointment has no way to tell you. */}
              <p className="text-xs text-muted-foreground mt-1">
                Printed in confirmation and reminder texts. Customers cannot
                reply to those messages, so this is the only way they can reach
                you about a booking.
              </p>
            </div>

            <div>
              <label htmlFor="start-page" className="text-sm font-medium">
                Start page
              </label>
              <select
                id="start-page"
                value={settings.startPage ?? ""}
                onChange={(e) => setSettings({ ...settings, startPage: e.target.value || null })}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">Automatic ({labelFor(automaticStart)})</option>
                {NAV_PAGES.filter((p) => isStartPageChoice(p.href) && isNavVisible(p, { ...settings, diaryEnabled: settings.hasDiary })).map((p) => (
                  <option key={p.href} value={p.href}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                The screen the CRM opens on after signing in, and the top of the
                menu. Automatic opens a salon taking bookings on the Diary, and
                anyone else on the Dashboard.
              </p>
            </div>
          </CardContent>
        </Card>

        {/*
          One card, one row per channel.

          This was five near-identical cards — icon, name, an "Enabled" badge and
          a single line of detail each — stacked down the page. Five card frames
          to carry five lines of text made the page look padded out, and two of
          them said "contact Kikai" in exactly the same words. A row each says the
          same thing in a quarter of the height, and the differences between
          channels are finally visible side by side.

          Only enabled channels appear: a client has no use for a row telling
          them about a product they have not bought.
        */}
        {channels.length > 0 && (
          <Card className="gap-0">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base">Channels</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {channels.map((c) => (
                  <li
                    key={c.label}
                    className="flex items-center gap-3 px-4 py-3 flex-wrap"
                  >
                    <c.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className="flex-1 min-w-0 text-right">
                      {c.detail ? (
                        <span className="text-xs font-mono text-foreground/80 break-all">
                          {c.detail}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {c.missing}
                        </span>
                      )}
                    </span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      Enabled
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* The salon diary — hours, services and who can be booked.

            All three feed the same place: the availability algorithm enforces
            them, and the voice prompt is generated from them, so what the agent
            says and what it will actually do cannot drift apart. */}
        {settings.hasDiary && (
          <>
            <Card className="gap-0">
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-base">Opening hours</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  When appointments can be booked. Also what the receptionist
                  tells callers.
                </p>
              </CardHeader>
              <CardContent className="pt-4">
                <OpeningHoursEditor
                  value={settings.businessHours}
                  onChange={(businessHours) =>
                    setSettings({ ...settings, businessHours })
                  }
                />
              </CardContent>
            </Card>

            <ExpandableSection
              title="Services"
              description="What you offer and how long each takes."
              summary={plural(settings.services.length, "service")}
            >
              <ServicesImport
                services={settings.services}
                onApply={(services) => setSettings({ ...settings, services })}
              />
              <ServicesEditor
                value={settings.services}
                onChange={(services) => setSettings({ ...settings, services })}
                rebook={settings.rebookTextsEnabled}
              />
            </ExpandableSection>

            <ExpandableSection
              title={w("Stylists")}
              description={
                settings.diaryProvider === "google"
                  ? "Each needs a Google calendar shared with the service account before they can be booked."
                  : undefined
              }
              summary={plural(settings.teamMembers.length, w("stylist"))}
            >
              {settings.teamMembers.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No one added yet"
                  hint={w("Add a stylist so the receptionist has someone to book with.")}
                />
              ) : null}
              <StylistsEditor
                value={settings.teamMembers}
                services={settings.services}
                businessHours={settings.businessHours}
                usesGoogle={settings.diaryProvider === "google"}
                onChange={(teamMembers) =>
                  setSettings({ ...settings, teamMembers })
                }
              />
            </ExpandableSection>
          </>
        )}

        {/* The salon's website and online booking (src/lib/online-booking):
            the salon's own choice, like rebooking texts. Only with a diary,
            which is what it books into. */}
        {settings.hasDiary && (
          <OnlineBookingSettings
            value={settings.online}
            onChange={(online) => setSettings({ ...settings, online })}
            slug={slug}
            bookingOrigin={bookingOrigin}
            live={Boolean(saved?.online.onlineBookingEnabled)}
            services={settings.services}
            notReady={readiness.ready ? null : missingText(readiness)}
            staff={w("stylist")}
          />
        )}

        {/* Rebooking texts (src/lib/rebook.ts): the salon's own choice, since
            they go to its clients in its name. Only where chats book, as the
            text's link opens one. */}
        {settings.chatBookingEnabled && (
          <ExpandableSection
            title="Rebooking texts"
            description="A text to clients when they are due back, offering a free time."
            summary={settings.rebookTextsEnabled ? "On" : "Off"}
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
                <p role="status" className="flex items-start gap-2 text-xs text-papaya-whip-100">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Not sending yet: {rebookNeeds.join("; ")}.</span>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Set when each service is due again under Services, e.g. an infill after 3
                weeks. A new set can be rebooked as an infill.
              </p>
            </div>
          </ExpandableSection>
        )}

        {/* Who can sign in: the owner invites and removes staff here. */}
        {canEdit && <TeamLogins salon={settings.businessName || "your salon"} />}

        {/* What the bots may tell customers about the salon beyond the hours,
            services, prices and team above. They answer salon questions only
            from Settings, so anything not written anywhere gets "I'm not sure"
            rather than a guess. */}
        {(settings.voiceEnabled ||
          settings.chatbotEnabled ||
          settings.whatsappEnabled ||
          settings.instagramEnabled ||
          settings.facebookEnabled) && (
          <ExpandableSection
            title="Salon FAQs"
            description="What the receptionist and the chat bots tell customers who ask."
            summary={
              settings.salonFaq.trim()
                ? plural(settings.salonFaq.split("\n").filter((l) => l.trim()).length, "line")
                : "None yet"
            }
          >
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                They already know your hours, services, prices and team from
                above, and can explain things like what balayage is. For anything
                else about the salon they only use what you write here, and say
                they are not sure otherwise.
              </p>
              <Textarea
                aria-label="Salon FAQs"
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
              <p className="text-xs text-muted-foreground">
                A question and its answer per line is plenty. Prices come from
                Services, quoted as &ldquo;from&rdquo;. {settings.salonFaq.length}/{SALON_FAQ_MAX}
              </p>
            </div>
          </ExpandableSection>
        )}
      </fieldset>

      {/* Comes up once something is changed; see unsaved-changes.tsx. */}
      {canEdit && <SaveBar dirty={dirty} saving={saving} onSave={() => void handleSave()} onDiscard={discard} />}
      {leaveGuard}
    </div>
  );
}
