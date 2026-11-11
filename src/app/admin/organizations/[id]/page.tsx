"use client";

import { BusinessTypePicker } from "@/components/admin/business-type-picker";
import { businessTypesOf, PROFILES } from "@/lib/business-types";
import { hasDiary } from "@/lib/navigation";
import { bookingReadiness, missingText } from "@/lib/booking/readiness";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, PersonCell, Pill, type ColumnDef } from "@/components/ui/data-table";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  MoreHorizontal,
  KeyRound,
  UserCog,
  Trash2,
  Plus,
  ExternalLink,
  Phone,
  Users as UsersIcon,
  Globe,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SaveBar, useLeaveGuard } from "@/components/ui/unsaved-changes";
import { EmptyState } from "@/components/ui/empty-state";
import { plural } from "@/lib/plural";
import { VOICE_CHANNEL, WHATSAPP_CHANNEL, channelLabel } from "@/lib/phone-channels";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { InvitationsSection } from "@/components/admin/invitations";


interface Org {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  businessType: string;
  alsoOffers: string[];
  anthropicApiKeyOverride: string | null;
  usageMarkupPercent: number | null;
  enabled: boolean;
  /** The owner has not finished onboarding yet (src/app/onboarding). */
  needsOnboarding?: boolean;
  settings: {
    businessName: string;
    // The salon's diary set-up, edited on its own Settings page; read here
    // only to say whether it can take bookings (bookingReadiness).
    services?: unknown;
    teamMembers?: unknown;
    businessHours?: unknown;
    diaryProvider?: string | null;
    chatbotEnabled: boolean;
    whatsappEnabled: boolean;
    chatBookingEnabled: boolean;
    diaryEnabled: boolean;
    voiceEnabled: boolean;
    whatsappSystemPrompt: string | null;
    calComApiKey: string | null;
    calComEventTypeId: string | null;
    instagramEnabled: boolean;
    instagramSystemPrompt: string | null;
    instagramBusinessId: string | null;
    /** The handle, for ig.me links in rebooking texts (src/lib/rebook.ts). */
    instagramUsername: string | null;
    instagramAccessToken: string | null;
    facebookEnabled: boolean;
    facebookSystemPrompt: string | null;
    facebookPageId: string | null;
    facebookPageAccessToken: string | null;
    metaAppSecret: string | null;
    instagramAppSecret: string | null;
    metaVerifyToken: string | null;
    whatsappAccessToken: string | null;
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
    whatsappPhoneNumberId: string | null;
    label: string | null;
  }>;
  _count: { leads: number; calls: number; websites: number };
}

/** The organisation's own fields this page saves (PUT /api/admin/organizations/[id]). */
function orgBody(o: Org) {
  return {
    name: o.name,
    planTier: o.planTier,
    businessType: o.businessType,
    alsoOffers: o.alsoOffers,
    anthropicApiKeyOverride: o.anthropicApiKeyOverride,
    usageMarkupPercent: o.usageMarkupPercent,
    enabled: o.enabled,
  };
}

/** The settings this page saves (PUT /api/settings): features, keys and prompts. */
function settingsBody(s: NonNullable<Org["settings"]>) {
  return {
    chatbotEnabled: s.chatbotEnabled,
    whatsappEnabled: s.whatsappEnabled,
    chatBookingEnabled: s.chatBookingEnabled,
    diaryEnabled: s.diaryEnabled,
    voiceEnabled: s.voiceEnabled,
    whatsappSystemPrompt: s.whatsappSystemPrompt,
    instagramEnabled: s.instagramEnabled,
    instagramSystemPrompt: s.instagramSystemPrompt,
    instagramBusinessId: s.instagramBusinessId,
    instagramUsername: s.instagramUsername,
    instagramAccessToken: s.instagramAccessToken,
    facebookEnabled: s.facebookEnabled,
    facebookSystemPrompt: s.facebookSystemPrompt,
    facebookPageId: s.facebookPageId,
    facebookPageAccessToken: s.facebookPageAccessToken,
    metaAppSecret: s.metaAppSecret,
    instagramAppSecret: s.instagramAppSecret,
    metaVerifyToken: s.metaVerifyToken,
    whatsappAccessToken: s.whatsappAccessToken,
    calComApiKey: s.calComApiKey,
    calComEventTypeId: s.calComEventTypeId,
  };
}

/** Everything Save sends, to compare with what was last loaded. */
function snapshot(o: Org): string {
  return JSON.stringify({ org: orgBody(o), settings: o.settings ? settingsBody(o.settings) : null });
}

/** What Save would send from `edited`, laid over freshly loaded `fresh`. */
function withEdits(fresh: Org, edited: Org): Org {
  return {
    ...fresh,
    ...orgBody(edited),
    settings: fresh.settings && edited.settings ? { ...fresh.settings, ...settingsBody(edited.settings) } : fresh.settings,
  };
}

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { confirm, notify } = useDialogs();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // As last loaded from the server: the page has unsaved changes while what
  // Save would send differs from it (the save bar and the leave guard).
  const [savedOrg, setSavedOrg] = useState<Org | null>(null);
  const orgRef = useRef<Org | null>(null);
  const savedRef = useRef<Org | null>(null);
  useEffect(() => {
    orgRef.current = org;
    savedRef.current = savedOrg;
  }, [org, savedOrg]);

  const [phoneDialog, setPhoneDialog] = useState(false);
  const [phoneForm, setPhoneForm] = useState({
    number: "",
    channel: WHATSAPP_CHANNEL,
    whatsappPhoneNumberId: "",
    label: "",
  });

  const [userDialog, setUserDialog] = useState(false);
  const [userForm, setUserForm] = useState({
    email: "",
    name: "",
    role: "admin",
    password: "",
  });
  const [userJustCreated, setUserJustCreated] = useState<{
    email: string;
    password: string;
    /** "User created" when absent. */
    title?: string;
  } | null>(null);
  const [copiedPw, setCopiedPw] = useState(false);
  // A new password for someone who has forgotten theirs. There is no email,
  // so they ask us; we set one here and pass it on.
  const [resetFor, setResetFor] = useState<{ id: string; email: string } | null>(null);
  const [resetPassword, setResetPassword] = useState("");

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


  // Both wrapped so the effect below can depend on them honestly. They were
  // plain functions, re-created every render, so listing them as dependencies
  // would have refetched on every render — which is why the dependency was
  // omitted and the lint rule suppressed rather than satisfied.
  const loadWebsites = useCallback(async (organizationId: string) => {
    try {
      const res = await fetch(`/api/websites?asOrg=${organizationId}`);
      if (!res.ok) return;
      const data = await res.json();
      setWebsites(data.sites || []);
    } catch (err) {
      console.error("Failed to load websites:", err);
    }
  }, []);

  // Reloaded after adding a number, a website or a login too: unsaved edits
  // to the form are kept through those (they used to vanish), and dropped
  // only after a save.
  const load = useCallback(async (opts: { keepEdits?: boolean } = {}) => {
    // The spinner is for the first load only. Reloading after a save used to
    // put it up too, which took the whole page away and brought it back at
    // the top; now the page updates where it stands.
    if (!orgRef.current) setLoading(true);
    try {
      const res = await fetch(`/api/admin/organizations/${params.id}`);
      if (!res.ok) throw new Error("Not found");
      const data: Org = await res.json();
      const current = orgRef.current;
      const edited =
        opts.keepEdits !== false && current && savedRef.current && snapshot(current) !== snapshot(savedRef.current);
      setSavedOrg(data);
      setOrg(edited && current ? withEdits(data, current) : data);
      await loadWebsites(data.id);
    } finally {
      setLoading(false);
    }
  }, [params.id, loadWebsites]);

  async function createWebsite() {
    if (!org) return;
    if (!websiteForm.siteId || !websiteForm.name || !websiteForm.systemPrompt) {
      notify("Site ID, display name and system prompt are required");
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
        notify(err.error || "Failed to create website");
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
    const yes = await confirm({
      title: `Delete the website "${name}"?`,
      body: "Its chat stops working at once, and this cannot be undone.",
      confirmLabel: "Delete website",
      destructive: true,
    });
    if (!yes) return;
    const res = await fetch(`/api/websites/${id}`, { method: "DELETE" });
    if (!res.ok) {
      notify("Failed to delete website");
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
  }, [load]);

  // Single Save button at the top of the page persists everything in one
  // shot: org-level fields (name/plan/anthropic key/enabled) PLUS all the
  // feature/prompt settings. Previously the page had two save buttons that
  // hit different endpoints, which was easy to miss and led to people
  // editing IG/FB prompts and walking away without saving them.
  /** Whether it saved: the page is only left after a save that worked. */
  async function save(): Promise<boolean> {
    if (!org) return false;
    setSaving(true);
    try {
      const orgPut = fetch(`/api/admin/organizations/${org.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orgBody(org)),
      });

      const settingsPut = org.settings
        ? fetch(`/api/settings?asOrg=${org.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settingsBody(org.settings)),
          })
        : Promise.resolve(null);

      const [orgRes, settingsRes] = await Promise.all([orgPut, settingsPut]);
      if (!orgRes.ok || (settingsRes && !settingsRes.ok)) {
        const which = !orgRes.ok ? orgRes : settingsRes!;
        const err = await which.json().catch(() => ({}));
        notify(err.error || "Failed to save");
        return false;
      }
      await load({ keepEdits: false });
      // A save that worked used to say nothing, which left a new API key
      // looking as if it might not have taken.
      notify("Organisation saved", "success");
      return true;
    } catch {
      notify("Could not reach the server. Nothing was saved.");
      return false;
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
      notify(err.error || "Failed to add");
      return;
    }
    setPhoneDialog(false);
    setPhoneForm({
      number: "",
      channel: WHATSAPP_CHANNEL,
      whatsappPhoneNumberId: "",
      label: "",
    });
    await load();
  }

  async function deletePhone(phoneId: string) {
    if (!org) return;
    const yes = await confirm({
      title: "Remove this phone number?",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!yes) return;
    const res = await fetch(
      `/api/admin/organizations/${org.id}/phone-numbers/${phoneId}`,
      { method: "DELETE" }
    );
    if (!res.ok) notify("Couldn't remove that number. Try again.");
    await load();
  }

  async function addUser() {
    if (!org) return;
    if (!userForm.password || userForm.password.length < 8) {
      notify("Password must be at least 8 characters");
      return;
    }
    const res = await fetch(`/api/admin/organizations/${org.id}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userForm),
    });
    if (!res.ok) {
      const err = await res.json();
      notify(err.error || "Failed to add");
      return;
    }
    // Show the password confirmation so the admin can share it
    setUserJustCreated({
      email: userForm.email,
      password: userForm.password,
    });
    setUserForm({ email: "", name: "", role: "admin", password: "" });
    await load();
  }

  function generatePassword() {
    setUserForm((f) => ({ ...f, password: randomPassword() }));
  }

  async function changeUser(userId: string, body: { role?: string; password?: string }) {
    if (!org) return false;
    const res = await fetch(`/api/admin/organizations/${org.id}/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      notify(err.error || "Failed to change that login");
      return false;
    }
    await load();
    return true;
  }

  async function saveNewPassword() {
    if (!resetFor) return;
    if (resetPassword.length < 8) {
      notify("Password must be at least 8 characters");
      return;
    }
    if (!(await changeUser(resetFor.id, { password: resetPassword }))) return;
    setUserJustCreated({ email: resetFor.email, password: resetPassword, title: "Password reset" });
    setResetFor(null);
    setResetPassword("");
  }

  async function removeUser(u: { id: string; email: string }) {
    if (!org) return;
    const yes = await confirm({
      title: `Remove ${u.email}?`,
      body: "They are signed out at once and can't sign in again. The salon's bookings, clients and calls are kept.",
      confirmLabel: "Remove login",
      destructive: true,
    });
    if (!yes) return;
    const res = await fetch(`/api/admin/organizations/${org.id}/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      notify(err.error || "Failed to remove that login");
      return;
    }
    await load();
  }

  // Note: feature/prompt saving was previously a separate `saveFeatures`
  // function with its own button. It's now folded into `save()` above so
  // a single click at the top of the page persists everything.

  /**
   * The phone or booking by message, which book into the diary: switching
   * one on switches the diary on too, and it stays on if they are later
   * switched off, so a salon does not lose its diary with its receptionist.
   */
  function switchOnWithDiary(key: "voiceEnabled" | "chatBookingEnabled", on: boolean) {
    if (!org?.settings) return;
    setOrg({
      ...org,
      settings: { ...org.settings, [key]: on, ...(on ? { diaryEnabled: true } : {}) },
    });
  }

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
    const yes = await confirm({
      title: `Delete "${org.name}" and all its data?`,
      body: "Every booking, client, call and login goes with it. This cannot be undone.",
      confirmLabel: "Delete organisation",
      destructive: true,
    });
    if (!yes) return;
    const res = await fetch(`/api/admin/organizations/${org.id}`, { method: "DELETE" });
    if (!res.ok) {
      notify("Couldn't delete the organisation. Try again.");
      return;
    }
    router.push("/admin/organizations");
  }

  // Before the early returns below, so they run on every render.
  const dirty = Boolean(org && savedOrg && snapshot(org) !== snapshot(savedOrg));
  const discard = () => {
    if (org && savedOrg) setOrg(withEdits(org, savedOrg));
  };
  const { dialog: leaveDialog, leave } = useLeaveGuard({ dirty, save, discard });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Organisation not found</p>
      </div>
    );
  }

  const phoneColumns: ColumnDef<Org["phoneNumbers"][number]>[] = [
    {
      id: "number",
      header: "Number",
      accessorKey: "number",
      cell: ({ row: { original: p } }) => <PersonCell name={p.label || p.number} detail={p.label ? p.number : null} />,
    },
    {
      id: "channel",
      header: "Channel",
      accessorFn: (p) => channelLabel(p.channel),
      cell: ({ row: { original: p } }) => (
        <Pill className="bg-muted capitalize text-foreground">{channelLabel(p.channel)}</Pill>
      ),
    },
    {
      id: "provider",
      header: "Provider ID",
      accessorFn: (p) => p.whatsappPhoneNumberId || "",
      meta: { className: "font-mono text-xs text-muted-foreground" },
      cell: ({ row: { original: p } }) => p.whatsappPhoneNumberId || "—",
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      meta: { align: "right" },
      cell: ({ row: { original: p } }) => (
        <Button variant="ghost" size="sm" onClick={() => deletePhone(p.id)} aria-label={`Remove ${p.number}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const websiteColumns: ColumnDef<WebsiteRow>[] = [
    {
      id: "name",
      header: "Website",
      accessorKey: "name",
      cell: ({ row: { original: w } }) => <PersonCell name={w.name} detail={<code className="text-xs">{w.siteId}</code>} />,
    },
    { id: "bot", header: "Bot", accessorKey: "botName" },
    { id: "conversations", header: "Conversations", accessorFn: (w) => w._count.conversations, meta: { align: "right" } },
    {
      id: "status",
      header: "Status",
      accessorFn: (w) => (w.enabled ? "Enabled" : "Disabled"),
      cell: ({ row: { original: w } }) =>
        w.enabled ? (
          <Pill className="bg-tea-green-800 text-tea-green-100">Enabled</Pill>
        ) : (
          <Pill className="bg-red-50 text-red-800">Disabled</Pill>
        ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      meta: { align: "right" },
      cell: ({ row: { original: w } }) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => copyEmbedForSite(w.siteId)} aria-label={`Copy embed code for ${w.name}`} title="Copy embed code">
            {copiedSiteId === w.siteId ? <Check className="h-4 w-4 text-tea-green-200" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => deleteWebsite(w.id, w.name)} aria-label={`Delete ${w.name}`} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </span>
      ),
    },
  ];

  const userColumns: ColumnDef<Org["users"][number]>[] = [
    {
      id: "user",
      header: "User",
      accessorFn: (u) => `${u.name ?? ""} ${u.email}`,
      sortingFn: (a, b) => (a.original.name || a.original.email).localeCompare(b.original.name || b.original.email),
      cell: ({ row: { original: u } }) => <PersonCell name={u.name || u.email} detail={u.name ? u.email : null} />,
    },
    {
      id: "role",
      header: "Role",
      accessorFn: (u) => ROLE_LABEL[u.role] ?? u.role,
      cell: ({ row: { original: u } }) => <Pill className="bg-muted text-foreground">{ROLE_LABEL[u.role] ?? u.role}</Pill>,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      meta: { align: "right" },
      cell: ({ row: { original: u } }) =>
        u.role === "superAdmin" ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Manage ${u.email}`}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {u.role !== "admin" && (
                <DropdownMenuItem onClick={() => changeUser(u.id, { role: "admin" })}>
                  <UserCog />
                  Make admin (owner)
                </DropdownMenuItem>
              )}
              {u.role !== "member" && (
                <DropdownMenuItem onClick={() => changeUser(u.id, { role: "member" })}>
                  <UserCog />
                  Make member (staff)
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  setResetPassword("");
                  setResetFor({ id: u.id, email: u.email });
                }}
              >
                <KeyRound />
                Reset password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => removeUser(u)}>
                <Trash2 />
                Remove login
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Back to organisations"
          className="mt-0.5"
          onClick={() => leave("/admin/organizations")}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <PageHeader
          className="flex-1"
          title={org.name}
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => leave(`/start?asOrg=${org.id}`)}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View as org
              </Button>
              <Button variant="outline" onClick={deleteOrg}>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </>
          }
        />
      </div>

      {/*
        The slug, the volumes and — the point of putting it here — whether this
        org is enabled at all. That last one previously lived only in a toggle
        further down the page, so a disabled client looked exactly like a live
        one until you scrolled.
      */}
      <p className="text-sm text-muted-foreground -mt-3 ml-12 flex items-center gap-3 flex-wrap">
        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
          {org.slug}
        </code>
        <span>
          <span className="capitalize">{org.planTier}</span> plan
        </span>
        <span>{businessTypesOf(org.businessType, org.alsoOffers).map((t) => PROFILES[t].label).join(" + ")}</span>
        <span>{plural(org._count.leads, "lead")}</span>
        <span>{plural(org._count.calls, "call")}</span>
        <span>{plural(org._count.websites, "site")}</span>
        <span className={org.enabled ? "text-tea-green-200" : "text-red-600"}>
          {org.enabled ? "Enabled" : "Disabled"}
        </span>
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organisation</CardTitle>
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
          <BusinessTypePicker
            main={businessTypesOf(org.businessType)[0]}
            also={businessTypesOf(org.businessType, org.alsoOffers).slice(1)}
            onChange={(businessType, alsoOffers) => setOrg({ ...org, businessType, alsoOffers })}
          />
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
              placeholder="Leave blank to use shared Kikai key"
              className="mt-1"
              type="password"
            />
          </div>
          <div>
            <label htmlFor="usage-markup" className="text-sm font-medium">
              Markup on AI call costs
            </label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id="usage-markup"
                inputMode="numeric"
                value={org.usageMarkupPercent ?? ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, "");
                  setOrg({ ...org, usageMarkupPercent: v === "" ? null : Number(v) });
                }}
                placeholder="Not set"
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              What the salon is charged on top of what its calls cost us: 100% shows them double our cost.
              Blank hides charges from the salon altogether. Only super-admins ever see the cost itself.
            </p>
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
            <CardTitle className="text-base">Features and prompts</CardTitle>
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
                label="Diary"
                description={
                  org.settings.voiceEnabled || org.settings.chatBookingEnabled
                    ? "Diary, clients, sales and callbacks. On while the phone receptionist or booking from messages is: they book into it."
                    : "Diary, clients, sales and callbacks, for a salon running its book on Kikai, with or without the receptionist."
                }
                enabled={hasDiary(org.settings)}
                locked={org.settings.voiceEnabled || org.settings.chatBookingEnabled}
                onToggle={(v) => updateFeature("diaryEnabled", v)}
              />
              <FeatureToggle
                label="Book from messages"
                description="WhatsApp, Instagram and Messenger book into the diary, read back and confirmed like the phone. Needs the salon's diary set up."
                enabled={org.settings.chatBookingEnabled}
                onToggle={(v) => switchOnWithDiary("chatBookingEnabled", v)}
              />
              <FeatureToggle
                label="Phone receptionist"
                description="Calls to the salon's Voice numbers answered by our receptionist"
                enabled={org.settings.voiceEnabled}
                onToggle={(v) => switchOnWithDiary("voiceEnabled", v)}
              />
              <BookingStatus org={org} />
            </div>

            {/* The salon's own Meta app: signs WhatsApp, Instagram and Messenger webhooks */}
            <div className="border-t border-border pt-5">
              <label className="text-sm font-medium">This salon&apos;s Meta app</label>
              <p className="text-xs text-muted-foreground mt-1">
                The app that carries the salon&apos;s WhatsApp, Instagram and Messenger. Meta signs
                every message it sends us with the app secret (App settings → Basic), and the verify
                token is whatever you type into the app&apos;s webhook settings. Webhook URLs:{" "}
                <code className="text-[10px]">/api/whatsapp/webhook</code> and{" "}
                <code className="text-[10px]">/api/meta/webhook</code>.
              </p>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">App secret</label>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder="32 hex characters"
                    value={org.settings.metaAppSecret || ""}
                    onChange={(e) => updateFeature("metaAppSecret", e.target.value || null)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Webhook verify token</label>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder="Any long random string"
                    value={org.settings.metaVerifyToken || ""}
                    onChange={(e) => updateFeature("metaVerifyToken", e.target.value || null)}
                    className="mt-1"
                  />
                </div>
              </div>
              {!org.settings.metaAppSecret &&
                (org.settings.whatsappEnabled || org.settings.instagramEnabled || org.settings.facebookEnabled) && (
                  <p className="text-xs text-papaya-whip-100 mt-2">
                    No app secret yet: this salon&apos;s messages are being checked with the shared
                    key from the server&apos;s settings, which is being retired.
                  </p>
                )}
            </div>

            <div className="border-t border-border pt-5">
              <label className="text-sm font-medium">WhatsApp (Cloud API)</label>
              <p className="text-xs text-muted-foreground mt-1">
                Replies go from the number the customer wrote to (add it under Phone numbers with
                its Phone Number ID), using this salon&apos;s access token.
              </p>
              <div className="mt-3 md:max-w-[50%] md:pr-1.5">
                <label className="text-xs font-medium">Access token</label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="EAA..."
                  value={org.settings.whatsappAccessToken || ""}
                  onChange={(e) => updateFeature("whatsappAccessToken", e.target.value || null)}
                  className="mt-1"
                />
              </div>
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
                The salon&apos;s Instagram professional account, added in the Meta app&apos;s
                Instagram API setup (no Facebook Page needed). The account ID and token
                come from &quot;Generate access tokens&quot;; the webhook points at{" "}
                <code className="text-[10px]">/api/meta/webhook</code>, subscribed to{" "}
                <code className="text-[10px]">messages</code>. Unified Login apps sign with the
                Meta app secret above; only Instagram Login apps need their own below.
              </p>
              <a
                href="https://developers.facebook.com/docs/messenger-platform/instagram/"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-2"
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
                    Instagram username
                  </label>
                  <Input
                    placeholder="hoangnails"
                    value={org.settings.instagramUsername || ""}
                    onChange={(e) =>
                      updateFeature("instagramUsername", e.target.value.replace(/^@/, "") || null)
                    }
                    className="mt-1"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Without the @. Rebooking texts link to ig.me/m/ this.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium">
                    Access token
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
                <div>
                  <label className="text-xs font-medium">Instagram app secret</label>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder="From Instagram → API setup with Instagram login"
                    value={org.settings.instagramAppSecret || ""}
                    onChange={(e) => updateFeature("instagramAppSecret", e.target.value || null)}
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Only for apps on Instagram Login (IGAA tokens), which sign with Instagram&apos;s own secret. Unified Login (EAA tokens): leave blank.
                  </p>
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
                className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-2"
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
                    Page access token
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
                Phone receptionist
              </label>
              <p className="text-sm text-muted-foreground mt-1">
                Its instructions are generated from this salon&apos;s settings
                at the start of every call. Calls reach it through the
                salon&apos;s Voice numbers (below) once Twilio points them at
                /api/twilio/voice.
              </p>

              {/* Cal.com integration — books an event when the voice agent
                  creates a callback. Optional; leave blank to skip. */}
              <div className="mt-4 pt-4 border-t border-border">
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
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-2"
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

      <section className="space-y-3" aria-labelledby="org-phones">
        <div className="flex items-center justify-between">
          <h2 id="org-phones" className="flex items-center gap-2 font-heading text-base font-semibold">
            <Phone className="h-5 w-5" />
            Phone numbers
          </h2>
          <Button size="sm" onClick={() => setPhoneDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>
        <DataTable
          columns={phoneColumns}
          data={org.phoneNumbers}
          getRowId={(p) => p.id}
          empty={
            <EmptyState
              icon={Phone}
              title="No phone numbers registered"
              hint="Add the WhatsApp or voice number this client answers on."
            />
          }
        />
      </section>

      <section className="space-y-3" aria-labelledby="org-websites">
        <div className="flex items-center justify-between">
          <h2 id="org-websites" className="flex items-center gap-2 font-heading text-base font-semibold">
            <Globe className="h-5 w-5" />
            Websites
          </h2>
          <Button size="sm" onClick={() => setWebsiteDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add website
          </Button>
        </div>
        <DataTable
          columns={websiteColumns}
          data={websites}
          getRowId={(w) => w.id}
          onRowClick={(w) => router.push(`/websites/${w.id}?asOrg=${org.id}`)}
          rowLabel={(w) => w.name}
          empty={
            <EmptyState icon={Globe} title="No websites yet" hint="Each site gets its own chatbot, prompt and embed snippet." />
          }
        />
      </section>

      <section className="space-y-3" aria-labelledby="org-users">
        <div className="flex items-center justify-between">
          <h2 id="org-users" className="flex items-center gap-2 font-heading text-base font-semibold">
            <UsersIcon className="h-5 w-5" />
            Users
          </h2>
          <Button size="sm" onClick={() => setUserDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Invite
          </Button>
        </div>
        <DataTable
          columns={userColumns}
          data={org.users}
          getRowId={(u) => u.id}
          empty={
            <EmptyState icon={UsersIcon} title="No users yet" hint="Nobody at this client can sign in until you add one." />
          }
        />
      </section>

      {org.needsOnboarding && (
        <p className="rounded-xl border border-light-bronze-300 bg-light-bronze-900/40 px-4 py-3 text-sm" data-testid="onboarding-pending">
          The owner hasn&apos;t finished setting up yet. When they sign in, they&apos;re taken through the salon&apos;s
          name, type, opening hours, services and team.
        </p>
      )}

      <InvitationsSection orgId={org.id} onChange={() => load({ keepEdits: true })} />

      {/* Add Phone dialog */}
      <Dialog open={phoneDialog} onOpenChange={setPhoneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add phone number</DialogTitle>
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
                  <SelectItem value={WHATSAPP_CHANNEL}>WhatsApp</SelectItem>
                  <SelectItem value={VOICE_CHANNEL}>Voice (our receptionist)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {phoneForm.channel === WHATSAPP_CHANNEL ? (
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
              <p className="text-xs text-muted-foreground">
                Calls to this number are answered by our receptionist once its
                webhook in Twilio points at /api/twilio/voice.
              </p>
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
            <DialogTitle>Add website</DialogTitle>
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
              <label className="text-xs font-medium">Display name</label>
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
              <label className="text-xs font-medium">System prompt</label>
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
              {creatingSite ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User dialog */}
      <Dialog open={userDialog} onOpenChange={setUserDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
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
                  <SelectItem value="admin">Admin (owner)</SelectItem>
                  <SelectItem value="member">Member (staff)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                {userForm.role === "member"
                  ? "Day-to-day: diary, clients, calls, conversations and takings. Settings are read-only; no websites, chatbot or charges."
                  : "Everything for this salon: settings, websites and chatbot, and charges."}
              </p>
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

      {/* New password for a login whose owner has forgotten it */}
      <Dialog
        open={!!resetFor}
        onOpenChange={(open) => {
          if (!open) setResetFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-foreground/80">
              A new password for <strong>{resetFor?.email}</strong>. Every
              device they are signed in on is signed out. Pass it on to them;
              they can change it under Settings → Account.
            </p>
            <div>
              <label htmlFor="reset-password" className="text-xs font-medium">
                New password (min 8 chars)
              </label>
              <div className="flex gap-2 mt-1">
                <Input
                  id="reset-password"
                  type="text"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="flex-1 font-mono"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setResetPassword(randomPassword())}>
                  Generate
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveNewPassword} disabled={resetPassword.length < 8}>
              Set password
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
            <DialogTitle>{userJustCreated?.title ?? "User created"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-foreground/80">
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

      {/* Comes up once something is changed; see unsaved-changes.tsx. */}
      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={discard} />
      {leaveDialog}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  superAdmin: "Super admin",
  admin: "Admin (owner)",
  member: "Member (staff)",
  stylist: "Stylist (withdrawn)",
};

/** 12 characters from letters and digits that can't be misread (no 0/O, 1/l/I). */
function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

/**
 * Whether the salon's diary can take bookings, under the switches that book
 * into it. Read from its saved Settings (services, team, hours), which this
 * page does not edit. Until it can, the phone and the chats take messages
 * instead, and nothing else says so.
 */
function BookingStatus({ org }: { org: Org }) {
  const s = org.settings;
  if (!s || !hasDiary(s)) return null;
  const staff = PROFILES[businessTypesOf(org.businessType)[0]].staff;
  const r = bookingReadiness({
    services: s.services,
    teamMembers: s.teamMembers,
    businessHours: s.businessHours,
    diaryProvider: s.diaryProvider,
    staff,
  });
  const books = s.voiceEnabled || s.chatBookingEnabled;
  return r.ready ? (
    <p className="flex items-start gap-2 rounded-md border border-tea-green-600 bg-tea-green-900 px-3 py-2 text-xs text-tea-green-200">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        The diary is ready to take bookings
        {books ? ": the phone and chats switched on above book into it." : "."}
      </span>
    </p>
  ) : (
    <p className="flex items-start gap-2 rounded-md border border-papaya-whip-400 bg-papaya-whip-700 px-3 py-2 text-xs text-papaya-whip-100">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Not taking bookings yet: {missingText(r)}.{" "}
        {books && "Until then the phone and chats take messages instead. "}
        Set these up in the salon&apos;s own Settings (View as org).
      </span>
    </p>
  );
}

function FeatureToggle({
  label,
  description,
  enabled,
  onToggle,
  locked = false,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  /** On because something else needs it: shown, not switchable. */
  locked?: boolean;
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
        disabled={locked}
        onClick={() => onToggle(!enabled)}
      >
        {enabled ? "Enabled" : "Disabled"}
      </Button>
    </div>
  );
}
