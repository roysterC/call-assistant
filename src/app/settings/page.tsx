"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { OpeningHoursEditor } from "@/components/settings/opening-hours-editor";
import { ServicesEditor } from "@/components/settings/services-editor";
import { StylistsEditor } from "@/components/settings/stylists-editor";
import type { DayHours } from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";

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
        };
        setSettings(s);

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
    try {
      // Only send the fields the settings page actually edits. The API
      // strips super-admin-only fields anyway, but being explicit here
      // avoids round-tripping stale flag state.
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: settings.businessName,
          contactPhone: settings.contactPhone,
          timezone: settings.timezone,
          businessHours: settings.businessHours,
          services: settings.services,
          teamMembers: settings.teamMembers,
        }),
      });
    } catch (error) {
      console.error("Failed to save settings:", error);
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
        description="Your organisation profile and enabled features"
        actions={
          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
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
              <p className="text-xs text-muted-foreground mt-1">
                Each needs a Google calendar shared with the service account
                before they can be booked.
              </p>
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
                onChange={(teamMembers) =>
                  setSettings({ ...settings, teamMembers })
                }
              />
            </CardContent>
          </Card>
        </>
      )}

    </div>
  );
}
