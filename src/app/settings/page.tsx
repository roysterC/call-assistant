"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssistantShortcut } from "@/components/settings/assistant-shortcut";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Save,
  Users,
  MessageSquare,
  MessageCircle,
  Phone,
  Camera,
  Send,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { OpeningHoursEditor } from "@/components/settings/opening-hours-editor";
import { ServicesEditor } from "@/components/settings/services-editor";
import { StylistsEditor } from "@/components/settings/stylists-editor";
import type { DayHours } from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";
import { DASHBOARD, NAV_PAGES, isNavVisible, isStartPageChoice } from "@/lib/navigation";
import { SALON_FAQ_MAX } from "@/lib/salon-knowledge";

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
}

interface PhoneNumber {
  id: string;
  number: string;
  channel: "vapi" | "whatsapp";
  label: string | null;
  active: boolean;
  createdAt: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [whatsappNumbers, setWhatsappNumbers] = useState<PhoneNumber[]>([]);
  const [voiceNumbers, setVoiceNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // What the last save did. It used to say nothing either way, which is how a
  // contact number that never saved went unnoticed.
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  // What "automatic" currently means for this organisation, to show beside it.
  const [automaticStart, setAutomaticStart] = useState<string>(DASHBOARD);

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
          instagramEnabled: !!data.settings?.instagramEnabled,
          instagramBusinessId: data.settings?.instagramBusinessId ?? null,
          facebookEnabled: !!data.settings?.facebookEnabled,
          facebookPageId: data.settings?.facebookPageId ?? null,
          startPage: data.settings?.startPage ?? null,
          salonFaq: data.settings?.salonFaq ?? "",
        };
        setSettings(s);
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
            apiFetch("/api/phone-numbers?channel=vapi")
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

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setSaveResult(null);
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveResult({ ok: false, message: data.error || "Could not save your changes." });
        return;
      }
      // Show what was stored, e.g. the contact number as texts will print it.
      setSettings({
        ...settings,
        contactPhone: data.settings?.contactPhone ?? null,
        startPage: data.settings?.startPage ?? null,
        salonFaq: data.settings?.salonFaq ?? "",
      });
      setSaveResult({ ok: true, message: "Saved." });
    } catch (error) {
      console.error("Failed to save settings:", error);
      setSaveResult({ ok: false, message: "Could not reach the server." });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

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
          <div className="flex items-center gap-3">
            {saveResult && (
              <span
                role="status"
                className={saveResult.ok ? "text-sm text-emerald-700" : "text-sm text-red-600"}
              >
                {saveResult.message}
              </span>
            )}
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        }
      />

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
              {NAV_PAGES.filter((p) => isStartPageChoice(p.href) && isNavVisible(p, settings)).map((p) => (
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
      {settings.voiceEnabled && (
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

          <Card className="gap-0">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base">Services</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                What you offer and how long each takes.
              </p>
            </CardHeader>
            <CardContent className="pt-4">
              <ServicesEditor
                value={settings.services}
                onChange={(services) => setSettings({ ...settings, services })}
              />
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base">Stylists</CardTitle>
              {settings.diaryProvider === "google" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Each needs a Google calendar shared with the service account
                  before they can be booked.
                </p>
              )}
            </CardHeader>
            <CardContent className="pt-4">
              {settings.teamMembers.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No one added yet"
                  hint="Add a stylist so the receptionist has someone to book with."
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
            </CardContent>
          </Card>
        </>
      )}

      {/* What the bots may tell customers about the salon beyond the hours,
          services, prices and team above. They answer salon questions only
          from Settings, so anything not written anywhere gets "I'm not sure"
          rather than a guess. */}
      {(settings.voiceEnabled ||
        settings.chatbotEnabled ||
        settings.whatsappEnabled ||
        settings.instagramEnabled ||
        settings.facebookEnabled) && (
        <Card className="gap-0">
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-base">Salon FAQs</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              What the receptionist and the chat bots tell customers who ask.
              They already know your hours, services, prices and team from
              above, and can explain things like what balayage is. For anything
              else about the salon they only use what you write here, and say
              they are not sure otherwise.
            </p>
          </CardHeader>
          <CardContent className="pt-4 space-y-1.5">
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
          </CardContent>
        </Card>
      )}

      <Card className="gap-0">
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-base">Your assistant, hands-free</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Open the assistant already listening, with Siri or from your phone&apos;s home screen, without touching the
            screen.
          </p>
        </CardHeader>
        <CardContent className="pt-4">
          <AssistantShortcut />
        </CardContent>
      </Card>

    </div>
  );
}
