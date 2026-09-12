"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Save,
  Plus,
  Trash2,
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

interface TeamMember {
  name: string;
  email: string;
  phone: string;
  role: string;
}

interface Settings {
  businessName: string;
  teamMembers: TeamMember[];
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
      missing: "No number assigned yet — contact DOAI",
    },
    {
      label: "Voice agent",
      icon: Phone,
      enabled: settings.voiceEnabled,
      detail: numberList(voiceNumbers),
      missing: "No number assigned yet — contact DOAI",
    },
    {
      label: "Instagram",
      icon: Camera,
      enabled: settings.instagramEnabled,
      detail: settings.instagramBusinessId || "",
      missing: "No business account linked yet — contact DOAI",
    },
    {
      label: "Facebook Messenger",
      icon: Send,
      enabled: settings.facebookEnabled,
      detail: settings.facebookPageId || "",
      missing: "No Page linked yet — contact DOAI",
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
        </CardContent>
      </Card>

      {/*
        One card, one row per channel.

        This was five near-identical cards — icon, name, an "Enabled" badge and
        a single line of detail each — stacked down the page. Five card frames
        to carry five lines of text made the page look padded out, and two of
        them said "contact DOAI" in exactly the same words. A row each says the
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

      {/* Team members — only if voice is enabled */}
      {settings.voiceEnabled && (
        <Card className="gap-0">
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-base">Team members</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Who the voice agent offers when a caller asks for a person.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {settings.teamMembers.length === 0 && (
              <EmptyState
                icon={Users}
                title="No one added yet"
                hint="Add a colleague so the voice agent has someone to name when a caller asks for a person."
              />
            )}
            {/*
              Labelled fields, and the role out of the grid.

              The row was a 2x2 of bare inputs whose placeholders vanished the
              moment they held anything, so a filled-in member was three
              unlabelled boxes; the fourth cell held only a role badge, leaving
              a gap beside the phone number.
            */}
            {settings.teamMembers.map((member, i) => (
              <div key={i} className="p-3 border border-border rounded-lg">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Badge variant="outline" className="text-[10px]">
                    {member.role}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${member.name || "team member"}`}
                    onClick={() => {
                      setSettings({
                        ...settings,
                        teamMembers: settings.teamMembers.filter(
                          (_, idx) => idx !== i,
                        ),
                      });
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="text-xs text-muted-foreground">
                    Name
                    <Input
                      value={member.name}
                      onChange={(e) => {
                        const updated = [...settings.teamMembers];
                        updated[i] = { ...updated[i], name: e.target.value };
                        setSettings({ ...settings, teamMembers: updated });
                      }}
                      placeholder="Sam Okoye"
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Email
                    <Input
                      type="email"
                      value={member.email}
                      onChange={(e) => {
                        const updated = [...settings.teamMembers];
                        updated[i] = { ...updated[i], email: e.target.value };
                        setSettings({ ...settings, teamMembers: updated });
                      }}
                      placeholder="sam@example.co.uk"
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Phone
                    <Input
                      type="tel"
                      value={member.phone}
                      onChange={(e) => {
                        const updated = [...settings.teamMembers];
                        updated[i] = { ...updated[i], phone: e.target.value };
                        setSettings({ ...settings, teamMembers: updated });
                      }}
                      placeholder="07700 900000"
                      className="mt-1"
                    />
                  </label>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSettings({
                  ...settings,
                  teamMembers: [
                    ...settings.teamMembers,
                    { name: "", email: "", phone: "", role: "member" },
                  ],
                })
              }
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add team member
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
