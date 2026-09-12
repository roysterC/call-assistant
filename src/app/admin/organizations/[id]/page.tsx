"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Save,
  Trash2,
  Plus,
  ExternalLink,
  Phone,
  Users as UsersIcon,
  Globe,
  Copy,
  Check,
} from "lucide-react";

interface Org {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  anthropicApiKeyOverride: string | null;
  enabled: boolean;
  settings: {
    businessName: string;
    chatbotEnabled: boolean;
    whatsappEnabled: boolean;
    voiceEnabled: boolean;
    whatsappSystemPrompt: string | null;
    calComApiKey: string | null;
    calComEventTypeId: string | null;
    instagramEnabled: boolean;
    instagramSystemPrompt: string | null;
    instagramBusinessId: string | null;
    instagramAccessToken: string | null;
    facebookEnabled: boolean;
    facebookSystemPrompt: string | null;
    facebookPageId: string | null;
    facebookPageAccessToken: string | null;
  } | null;
  users: Array<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    createdAt: string;
  }>;
  phoneNumbers: Array<{
    id: string;
    number: string;
    channel: string;
    vapiPhoneNumberId: string | null;
    whatsappPhoneNumberId: string | null;
    label: string | null;
  }>;
  _count: { leads: number; calls: number; websites: number };
}

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [phoneDialog, setPhoneDialog] = useState(false);
  const [phoneForm, setPhoneForm] = useState({
    number: "",
    channel: "whatsapp",
    vapiPhoneNumberId: "",
    whatsappPhoneNumberId: "",
    label: "",
  });

  const [userDialog, setUserDialog] = useState(false);
  const [userForm, setUserForm] = useState({
    email: "",
    name: "",
    role: "member",
    password: "",
  });
  const [userJustCreated, setUserJustCreated] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [copiedPw, setCopiedPw] = useState(false);

  // Websites
  type WebsiteRow = {
    id: string;
    siteId: string;
    name: string;
    botName: string;
    enabled: boolean;
    _count: { conversations: number };
  };
  const [websites, setWebsites] = useState<WebsiteRow[]>([]);
  const [websiteDialog, setWebsiteDialog] = useState(false);
  const [creatingSite, setCreatingSite] = useState(false);
  const [copiedSiteId, setCopiedSiteId] = useState<string | null>(null);

  // Features & prompts (super-admin-only edits to this org's settings) —
  // saved via the unified `save()` button at the top of the page.
  const [websiteForm, setWebsiteForm] = useState({
    siteId: "",
    name: "",
    botName: "Assistant",
    systemPrompt: "",
    greeting: "",
    allowedOrigins: "",
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/organizations/${params.id}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setOrg(data);
      await loadWebsites(data.id);
    } finally {
      setLoading(false);
    }
  }

  async function loadWebsites(organizationId: string) {
    try {
      const res = await fetch(`/api/websites?asOrg=${organizationId}`);
      if (!res.ok) return;
      const data = await res.json();
      setWebsites(data.sites || []);
    } catch (err) {
      console.error("Failed to load websites:", err);
    }
  }

  async function createWebsite() {
    if (!org) return;
    if (!websiteForm.siteId || !websiteForm.name || !websiteForm.systemPrompt) {
      alert("Site ID, Display Name and System Prompt are required");
      return;
    }
    setCreatingSite(true);
    try {
      const res = await fetch("/api/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: org.id,
          siteId: websiteForm.siteId,
          name: websiteForm.name,
          botName: websiteForm.botName || "Assistant",
          systemPrompt: websiteForm.systemPrompt,
          greeting: websiteForm.greeting || null,
          allowedOrigins: websiteForm.allowedOrigins
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to create website");
        return;
      }
      setWebsiteDialog(false);
      setWebsiteForm({
        siteId: "",
        name: "",
        botName: "Assistant",
        systemPrompt: "",
        greeting: "",
        allowedOrigins: "",
      });
      await loadWebsites(org.id);
    } finally {
      setCreatingSite(false);
    }
  }

  async function deleteWebsite(id: string, name: string) {
    if (!org) return;
    if (!confirm(`Delete website "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/websites/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Failed to delete website");
      return;
    }
    await loadWebsites(org.id);
  }

  function copyEmbedForSite(siteId: string) {
    const origin = window.location.origin;
    const snippet = `<script src="${origin}/widget.js" data-site-id="${siteId}" async></script>`;
    navigator.clipboard.writeText(snippet);
    setCopiedSiteId(siteId);
    setTimeout(() => setCopiedSiteId(null), 2000);
  }

  useEffect(() => {
    load();
  }, [params.id]);

  // Single Save button at the top of the page persists everything in one
  // shot: org-level fields (name/plan/anthropic key/enabled) PLUS all the
  // feature/prompt settings. Previously the page had two save buttons that
  // hit different endpoints, which was easy to miss and led to people
  // editing IG/FB prompts and walking away without saving them.
  async function save() {
    if (!org) return;
    setSaving(true);
    try {
      const orgPut = fetch(`/api/admin/organizations/${org.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: org.name,
          planTier: org.planTier,
          anthropicApiKeyOverride: org.anthropicApiKeyOverride,
          enabled: org.enabled,
        }),
      });

      const settingsPut = org.settings
        ? fetch(`/api/settings?asOrg=${org.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatbotEnabled: org.settings.chatbotEnabled,
              whatsappEnabled: org.settings.whatsappEnabled,
              voiceEnabled: org.settings.voiceEnabled,
              whatsappSystemPrompt: org.settings.whatsappSystemPrompt,
              instagramEnabled: org.settings.instagramEnabled,
              instagramSystemPrompt: org.settings.instagramSystemPrompt,
              instagramBusinessId: org.settings.instagramBusinessId,
              instagramAccessToken: org.settings.instagramAccessToken,
              facebookEnabled: org.settings.facebookEnabled,
              facebookSystemPrompt: org.settings.facebookSystemPrompt,
              facebookPageId: org.settings.facebookPageId,
              facebookPageAccessToken: org.settings.facebookPageAccessToken,
              calComApiKey: org.settings.calComApiKey,
              calComEventTypeId: org.settings.calComEventTypeId,
            }),
          })
        : Promise.resolve(null);

      const [orgRes, settingsRes] = await Promise.all([orgPut, settingsPut]);
      if (!orgRes.ok || (settingsRes && !settingsRes.ok)) {
        const which = !orgRes.ok ? orgRes : settingsRes!;
        const err = await which.json().catch(() => ({}));
        alert(err.error || "Failed to save");
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function addPhone() {
    if (!org) return;
    const res = await fetch(`/api/admin/organizations/${org.id}/phone-numbers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(phoneForm),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to add");
      return;
    }
    setPhoneDialog(false);
    setPhoneForm({
      number: "",
      channel: "whatsapp",
      vapiPhoneNumberId: "",
      whatsappPhoneNumberId: "",
      label: "",
    });
    await load();
  }

  async function deletePhone(phoneId: string) {
    if (!org) return;
    if (!confirm("Remove this phone number?")) return;
    await fetch(
      `/api/admin/organizations/${org.id}/phone-numbers/${phoneId}`,
      { method: "DELETE" }
    );
    await load();
  }

  async function addUser() {
    if (!org) return;
    if (!userForm.password || userForm.password.length < 8) {
      alert("Password must be at least 8 characters");
      return;
    }
    const res = await fetch(`/api/admin/organizations/${org.id}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userForm),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to add");
      return;
    }
    // Show the password confirmation so the admin can share it
    setUserJustCreated({
      email: userForm.email,
      password: userForm.password,
    });
    setUserForm({ email: "", name: "", role: "member", password: "" });
    await load();
  }

  function generatePassword() {
    // 12-char random password using safe letters/digits
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    const arr = new Uint32Array(12);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 12; i++) out += chars[arr[i] % chars.length];
    setUserForm((f) => ({ ...f, password: out }));
  }

  // Note: feature/prompt saving was previously a separate `saveFeatures`
  // function with its own button. It's now folded into `save()` above so
  // a single click at the top of the page persists everything.

  function updateFeature<K extends keyof NonNullable<Org["settings"]>>(
    key: K,
    value: NonNullable<Org["settings"]>[K]
  ) {
    if (!org?.settings) return;
    setOrg({
      ...org,
      settings: { ...org.settings, [key]: value },
    });
  }

  async function deleteOrg() {
    if (!org) return;
    if (!confirm(`Delete "${org.name}" and all its data? This cannot be undone.`))
      return;
    await fetch(`/api/admin/organizations/${org.id}`, { method: "DELETE" });
    router.push("/admin/organizations");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Organization not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin/organizations")}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{org.name}</h1>
            <p className="text-sm text-muted-foreground">
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-xs">
                {org.slug}
              </code>
              <span className="ml-3">
                {org._count.leads} leads · {org._count.calls} calls ·{" "}
                {org._count.websites} sites
              </span>
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/?asOrg=${org.id}`)
            }
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            View as org
          </Button>
          <Button variant="outline" onClick={deleteOrg}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
          <Button onClick={save} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Organization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={org.name}
              onChange={(e) => setOrg({ ...org, name: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Plan tier</label>
            <Input
              value={org.planTier}
              onChange={(e) => setOrg({ ...org, planTier: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">
              Anthropic API key override
            </label>
            <Input
              value={org.anthropicApiKeyOverride || ""}
              onChange={(e) =>
                setOrg({
                  ...org,
                  anthropicApiKeyOverride: e.target.value || null,
                })
              }
              placeholder="Leave blank to use shared DOAI key"
              className="mt-1"
              type="password"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Enabled</label>
            <Button
              variant={org.enabled ? "default" : "outline"}
              size="sm"
              onClick={() => setOrg({ ...org, enabled: !org.enabled })}
            >
              {org.enabled ? "Enabled" : "Disabled"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Features & Prompts (super-admin only) */}
      {org.settings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Features & Prompts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Enabled features
              </p>

              <FeatureToggle
                label="Website chatbot"
                description="Embeddable widget on client websites"
                enabled={org.settings.chatbotEnabled}
                onToggle={(v) => updateFeature("chatbotEnabled", v)}
              />
              <FeatureToggle
                label="WhatsApp"
                description="Inbound WhatsApp Business messaging"
                enabled={org.settings.whatsappEnabled}
                onToggle={(v) => updateFeature("whatsappEnabled", v)}
              />
              <FeatureToggle
                label="Instagram"
                description="Inbound Instagram DMs via Meta Graph API"
                enabled={org.settings.instagramEnabled}
                onToggle={(v) => updateFeature("instagramEnabled", v)}
              />
              <FeatureToggle
                label="Facebook Messenger"
                description="Inbound Messenger DMs via Meta Graph API"
                enabled={org.settings.facebookEnabled}
                onToggle={(v) => updateFeature("facebookEnabled", v)}
              />
              <FeatureToggle
                label="Voice agent (Vapi)"
                description="Inbound phone calls handled by AI"
                enabled={org.settings.voiceEnabled}
                onToggle={(v) => updateFeature("voiceEnabled", v)}
              />
            </div>

            <div className="border-t border-border pt-5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                WhatsApp system prompt
              </label>
              <Textarea
                value={org.settings.whatsappSystemPrompt || ""}
                onChange={(e) =>
                  updateFeature(
                    "whatsappSystemPrompt",
                    e.target.value || null
                  )
                }
                rows={6}
                placeholder="Leave empty to auto-generate from business name + services + hours."
                className="mt-1 font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                When empty, the WhatsApp bot auto-builds a prompt from this
                org&apos;s business info.
              </p>
            </div>

            {/* Instagram Direct Messages (Meta Graph API) */}
            <div className="border-t border-border pt-5">
              <label className="text-sm font-medium">
                Instagram (Meta Graph API)
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Requires a Meta app with the Instagram Graph API product
                enabled, an Instagram Business account linked to a Facebook
                Page, and the webhook subscription pointing at{" "}
                <code className="text-[10px]">/api/meta/webhook</code>.
              </p>
              <a
                href="https://developers.facebook.com/docs/messenger-platform/instagram/"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1 mt-2"
              >
                <ExternalLink className="w-3 h-3" />
                Instagram Messaging setup docs
              </a>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">
                    Instagram Business Account ID
                  </label>
                  <Input
                    placeholder="17841400000000000"
                    value={org.settings.instagramBusinessId || ""}
                    onChange={(e) =>
                      updateFeature(
                        "instagramBusinessId",
                        e.target.value || null
                      )
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">
                    Access Token
                  </label>
                  <Input
                    type="password"
                    placeholder="IGAA..."
                    value={org.settings.instagramAccessToken || ""}
                    onChange={(e) =>
                      updateFeature(
                        "instagramAccessToken",
                        e.target.value || null
                      )
                    }
                    className="mt-1"
                  />
                </div>
              </div>
              <label className="text-xs font-medium mt-3 block">
                Instagram system prompt
              </label>
              <Textarea
                value={org.settings.instagramSystemPrompt || ""}
                onChange={(e) =>
                  updateFeature(
                    "instagramSystemPrompt",
                    e.target.value || null
                  )
                }
                rows={4}
                placeholder="Leave empty for auto-generated channel prompt."
                className="mt-1 font-mono text-xs"
              />
            </div>

            {/* Facebook Messenger (Meta Graph API) */}
            <div className="border-t border-border pt-5">
              <label className="text-sm font-medium">
                Facebook Messenger (Meta Graph API)
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Requires a Meta app with Messenger Platform, a Facebook Page
                with the Page access token, and the webhook subscription on
                the <code className="text-[10px]">page.messages</code> field.
              </p>
              <a
                href="https://developers.facebook.com/docs/messenger-platform/webhooks/"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1 mt-2"
              >
                <ExternalLink className="w-3 h-3" />
                Messenger webhook setup docs
              </a>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">
                    Facebook Page ID
                  </label>
                  <Input
                    placeholder="123456789012345"
                    value={org.settings.facebookPageId || ""}
                    onChange={(e) =>
                      updateFeature(
                        "facebookPageId",
                        e.target.value || null
                      )
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">
                    Page Access Token
                  </label>
                  <Input
                    type="password"
                    placeholder="EAA..."
                    value={org.settings.facebookPageAccessToken || ""}
                    onChange={(e) =>
                      updateFeature(
                        "facebookPageAccessToken",
                        e.target.value || null
                      )
                    }
                    className="mt-1"
                  />
                </div>
              </div>
              <label className="text-xs font-medium mt-3 block">
                Messenger system prompt
              </label>
              <Textarea
                value={org.settings.facebookSystemPrompt || ""}
                onChange={(e) =>
                  updateFeature(
                    "facebookSystemPrompt",
                    e.target.value || null
                  )
                }
                rows={4}
                placeholder="Leave empty for auto-generated channel prompt."
                className="mt-1 font-mono text-xs"
              />
            </div>

            <div className="border-t border-border pt-5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Voice agent (Vapi)
              </label>
              <p className="text-sm text-muted-foreground mt-1">
                Vapi assistant prompts live in the Vapi dashboard. Inbound
                calls route to this org via the org&apos;s Phone Numbers
                (managed in the Phone Numbers section above).
              </p>
              <a
                href="https://dashboard.vapi.ai"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1 mt-2"
              >
                <ExternalLink className="w-3 h-3" />
                Open Vapi dashboard
              </a>

              {/* Cal.com integration — books an event when the voice agent
                  creates a callback. Optional; leave blank to skip. */}
              <div className="mt-4 pt-4 border-t border-slate-800">
                <label className="text-sm font-medium">
                  Cal.com booking (optional)
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  When both values are set, callbacks booked via the voice
                  agent will also create a Cal.com event. Leave blank to
                  skip — callbacks will still be recorded in the CRM.
                </p>
                <a
                  href="https://app.cal.com/settings/developer/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1 mt-2"
                >
                  <ExternalLink className="w-3 h-3" />
                  Get a Cal.com API key
                </a>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium">
                      Cal.com API key
                    </label>
                    <Input
                      type="password"
                      placeholder="cal_live_..."
                      value={org.settings.calComApiKey || ""}
                      onChange={(e) =>
                        updateFeature(
                          "calComApiKey",
                          e.target.value || null
                        )
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">
                      Event Type ID
                    </label>
                    <Input
                      placeholder="e.g. 12345"
                      value={org.settings.calComEventTypeId || ""}
                      onChange={(e) =>
                        updateFeature(
                          "calComEventTypeId",
                          e.target.value || null
                        )
                      }
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Phone className="w-5 h-5" />
            Phone Numbers
          </CardTitle>
          <Button size="sm" onClick={() => setPhoneDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Provider ID</TableHead>
                <TableHead>Label</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.phoneNumbers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                    No phone numbers registered
                  </TableCell>
                </TableRow>
              ) : (
                org.phoneNumbers.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.number}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {p.channel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {p.vapiPhoneNumberId || p.whatsappPhoneNumberId || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{p.label || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => deletePhone(p.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Websites
          </CardTitle>
          <Button size="sm" onClick={() => setWebsiteDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Website
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Site ID</TableHead>
                <TableHead>Bot</TableHead>
                <TableHead>Conversations</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {websites.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground text-sm"
                  >
                    No websites configured for this org yet
                  </TableCell>
                </TableRow>
              ) : (
                websites.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">
                      <button
                        onClick={() =>
                          router.push(`/websites/${w.id}?asOrg=${org.id}`)
                        }
                        className="hover:underline text-left"
                      >
                        {w.name}
                      </button>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded">
                        {w.siteId}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm">{w.botName}</TableCell>
                    <TableCell className="text-sm">
                      {w._count.conversations}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={w.enabled ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {w.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex items-center gap-1 justify-end pr-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyEmbedForSite(w.siteId)}
                        title="Copy embed code"
                      >
                        {copiedSiteId === w.siteId ? (
                          <Check className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteWebsite(w.id, w.name)}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <UsersIcon className="w-5 h-5" />
            Users
          </CardTitle>
          <Button size="sm" onClick={() => setUserDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Invite
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground text-sm">
                    No users yet
                  </TableCell>
                </TableRow>
              ) : (
                org.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-sm">{u.email}</TableCell>
                    <TableCell className="text-sm">{u.name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {u.role}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Phone dialog */}
      <Dialog open={phoneDialog} onOpenChange={setPhoneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Phone Number</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Phone number (E.164)</label>
              <Input
                value={phoneForm.number}
                onChange={(e) => setPhoneForm({ ...phoneForm, number: e.target.value })}
                placeholder="+441234567890"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Channel</label>
              <Select
                value={phoneForm.channel}
                onValueChange={(v) =>
                  setPhoneForm({ ...phoneForm, channel: String(v) })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="vapi">Vapi (voice)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {phoneForm.channel === "whatsapp" ? (
              <div>
                <label className="text-xs font-medium">
                  WhatsApp Phone Number ID (from Meta)
                </label>
                <Input
                  value={phoneForm.whatsappPhoneNumberId}
                  onChange={(e) =>
                    setPhoneForm({
                      ...phoneForm,
                      whatsappPhoneNumberId: e.target.value,
                    })
                  }
                  placeholder="1087732817755104"
                  className="mt-1"
                />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium">Vapi Phone Number ID</label>
                <Input
                  value={phoneForm.vapiPhoneNumberId}
                  onChange={(e) =>
                    setPhoneForm({
                      ...phoneForm,
                      vapiPhoneNumberId: e.target.value,
                    })
                  }
                  className="mt-1"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium">Label (optional)</label>
              <Input
                value={phoneForm.label}
                onChange={(e) => setPhoneForm({ ...phoneForm, label: e.target.value })}
                placeholder="Main line"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhoneDialog(false)}>
              Cancel
            </Button>
            <Button onClick={addPhone} disabled={!phoneForm.number}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Website dialog */}
      <Dialog open={websiteDialog} onOpenChange={setWebsiteDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Website</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">
                Site ID (unique across all orgs)
              </label>
              <Input
                value={websiteForm.siteId}
                onChange={(e) =>
                  setWebsiteForm({
                    ...websiteForm,
                    siteId: e.target.value.toLowerCase(),
                  })
                }
                placeholder="client-abc"
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Lowercase letters, numbers, dashes only. Appears in the embed
                tag.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium">Display Name</label>
              <Input
                value={websiteForm.name}
                onChange={(e) =>
                  setWebsiteForm({ ...websiteForm, name: e.target.value })
                }
                placeholder="Client ABC"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Bot Name</label>
              <Input
                value={websiteForm.botName}
                onChange={(e) =>
                  setWebsiteForm({ ...websiteForm, botName: e.target.value })
                }
                placeholder="Assistant"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">
                Greeting (first message shown)
              </label>
              <Input
                value={websiteForm.greeting}
                onChange={(e) =>
                  setWebsiteForm({ ...websiteForm, greeting: e.target.value })
                }
                placeholder="Hi! How can I help?"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">System Prompt</label>
              <Textarea
                value={websiteForm.systemPrompt}
                onChange={(e) =>
                  setWebsiteForm({
                    ...websiteForm,
                    systemPrompt: e.target.value,
                  })
                }
                rows={6}
                className="mt-1 font-mono text-xs"
                placeholder="You are a helpful assistant for..."
              />
            </div>
            <div>
              <label className="text-xs font-medium">
                Allowed Origins (one per line)
              </label>
              <Textarea
                value={websiteForm.allowedOrigins}
                onChange={(e) =>
                  setWebsiteForm({
                    ...websiteForm,
                    allowedOrigins: e.target.value,
                  })
                }
                rows={3}
                className="mt-1"
                placeholder="https://client.com&#10;https://www.client.com"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Leave empty to allow any origin. Supports *.example.com.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWebsiteDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={createWebsite}
              disabled={
                creatingSite ||
                !websiteForm.siteId ||
                !websiteForm.name ||
                !websiteForm.systemPrompt
              }
            >
              {creatingSite ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User dialog */}
      <Dialog open={userDialog} onOpenChange={setUserDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Email</label>
              <Input
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Name (optional)</label>
              <Input
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Role</label>
              <Select
                value={userForm.role}
                onValueChange={(v) =>
                  setUserForm({ ...userForm, role: String(v) })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">
                Initial password (min 8 chars)
              </label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="text"
                  value={userForm.password}
                  onChange={(e) =>
                    setUserForm({ ...userForm, password: e.target.value })
                  }
                  placeholder="Choose a password for them"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={generatePassword}
                >
                  Generate
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                You&apos;ll share this password with them directly. They can
                change it after signing in.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={addUser}
              disabled={
                !userForm.email ||
                !userForm.password ||
                userForm.password.length < 8
              }
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-creation password confirmation */}
      <Dialog
        open={!!userJustCreated}
        onOpenChange={(open) => {
          if (!open) {
            setUserJustCreated(null);
            setCopiedPw(false);
            setUserDialog(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>User created</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              Share these credentials with{" "}
              <strong>{userJustCreated?.email}</strong>. This password won&apos;t
              be shown again.
            </p>
            <div>
              <label className="text-xs font-medium">Email</label>
              <Input
                readOnly
                value={userJustCreated?.email || ""}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Password</label>
              <div className="flex gap-2 mt-1">
                <Input
                  readOnly
                  value={userJustCreated?.password || ""}
                  className="flex-1 font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      userJustCreated?.password || ""
                    );
                    setCopiedPw(true);
                    setTimeout(() => setCopiedPw(false), 2000);
                  }}
                >
                  {copiedPw ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setUserJustCreated(null);
                setCopiedPw(false);
                setUserDialog(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FeatureToggle({
  label,
  description,
  enabled,
  onToggle,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button
        variant={enabled ? "default" : "outline"}
        size="sm"
        onClick={() => onToggle(!enabled)}
      >
        {enabled ? "Enabled" : "Disabled"}
      </Button>
    </div>
  );
}
