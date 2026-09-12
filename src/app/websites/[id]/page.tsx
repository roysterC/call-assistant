"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Trash2, Copy, Check } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { readableTextOn } from "@/lib/contrast";

interface Site {
  id: string;
  siteId: string;
  name: string;
  botName: string;
  systemPrompt: string;
  greeting: string | null;
  quickReplies: string[];
  brandColor: string;
  allowedOrigins: string[];
  enabled: boolean;
  proactiveEnabled: boolean;
  proactiveMessage: string | null;
  proactiveDelaySeconds: number;
  proactiveCooldownHours: number;
  _count: { conversations: number };
}

export default function WebsiteEditPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "superAdmin";

  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch(`/api/websites/${params.id}`);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        setSite({
          ...data,
          quickReplies: data.quickReplies || [],
          allowedOrigins: data.allowedOrigins || [],
        });
      } catch (err) {
        console.error("Failed to load site:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  async function save() {
    if (!site) return;
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = {
        name: site.name,
        botName: site.botName,
        greeting: site.greeting,
        quickReplies: site.quickReplies,
        brandColor: site.brandColor,
        allowedOrigins: site.allowedOrigins,
        enabled: site.enabled,
        proactiveEnabled: site.proactiveEnabled,
        proactiveMessage: site.proactiveMessage,
        proactiveDelaySeconds: site.proactiveDelaySeconds,
        proactiveCooldownHours: site.proactiveCooldownHours,
      };
      // Only super-admins are allowed to change the system prompt.
      if (isSuperAdmin) {
        body.systemPrompt = site.systemPrompt;
      }

      const res = await apiFetch(`/api/websites/${site.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch (err) {
      console.error("Save error:", err);
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSite() {
    if (!site) return;
    if (!confirm(`Delete website "${site.name}"? This cannot be undone.`))
      return;
    await apiFetch(`/api/websites/${site.id}`, { method: "DELETE" });
    router.push("/websites");
  }

  function copyEmbed() {
    if (!site) return;
    const origin = window.location.origin;
    const snippet = `<script src="${origin}/widget.js" data-site-id="${site.siteId}" async></script>`;
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!site) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Website not found</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push("/websites")}
        >
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/websites")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{site.name}</h1>
            <p className="text-sm text-muted-foreground">
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-xs">
                {site.siteId}
              </code>
              <span className="ml-3">
                {site._count.conversations} conversations
              </span>
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button variant="outline" onClick={deleteSite}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          )}
          <Button onClick={save} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Embed Code */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Embed Code</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-start">
            <code className="flex-1 bg-white/5 p-3 rounded text-xs text-slate-300 break-all">
              {`<script src="${typeof window !== "undefined" ? window.location.origin : ""}/widget.js" data-site-id="${site.siteId}" async></script>`}
            </code>
            <Button variant="outline" size="sm" onClick={copyEmbed}>
              {copied ? (
                <Check className="w-4 h-4 text-emerald-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Add this script tag to any HTML page before <code>&lt;/body&gt;</code>
          </p>
        </CardContent>
      </Card>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Enabled</label>
            <Button
              variant={site.enabled ? "default" : "outline"}
              size="sm"
              onClick={() => setSite({ ...site, enabled: !site.enabled })}
            >
              {site.enabled ? "Enabled" : "Disabled"}
            </Button>
          </div>

          <div>
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={site.name}
              onChange={(e) => setSite({ ...site, name: e.target.value })}
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Bot Name</label>
            <Input
              value={site.botName}
              onChange={(e) => setSite({ ...site, botName: e.target.value })}
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Brand Color</label>
            <div className="flex gap-2 mt-1">
              <Input
                type="color"
                value={site.brandColor}
                onChange={(e) =>
                  setSite({ ...site, brandColor: e.target.value })
                }
                className="w-20 h-10 p-1 cursor-pointer"
              />
              <Input
                value={site.brandColor}
                onChange={(e) =>
                  setSite({ ...site, brandColor: e.target.value })
                }
                className="flex-1"
              />
            </div>
            {/*
              Live preview of the header as the visitor will see it. The widget
              picks its own readable foreground, so the point here is to show
              what that choice looks like — and to flag a colour whose contrast
              is poor enough that neither foreground reads well.
            */}
            {(() => {
              const c = readableTextOn(site.brandColor);
              return (
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className="px-3 py-1.5 rounded-md text-xs font-semibold"
                    style={{
                      backgroundColor: site.brandColor,
                      color: c.color,
                    }}
                  >
                    {site.botName || "Assistant"}
                  </div>
                  <span
                    className={`text-xs ${
                      c.meetsAA ? "text-slate-400" : "text-amber-500"
                    }`}
                  >
                    {c.meetsAA
                      ? `Contrast ${c.ratio.toFixed(1)}:1 — passes AA${
                          c.meetsAAA ? " and AAA" : ""
                        }`
                      : `Contrast ${c.ratio.toFixed(
                          1
                        )}:1 — below the 4.5:1 minimum, text may be hard to read`}
                  </span>
                </div>
              );
            })()}
          </div>

          <div>
            <label className="text-sm font-medium">Greeting</label>
            <Input
              value={site.greeting || ""}
              onChange={(e) =>
                setSite({ ...site, greeting: e.target.value || null })
              }
              placeholder="Hi! How can I help?"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">
              Quick Replies (one per line)
            </label>
            <Textarea
              value={site.quickReplies.join("\n")}
              onChange={(e) =>
                setSite({
                  ...site,
                  quickReplies: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="How much does it cost?\nBook a call\nTell me about your services"
              rows={4}
              className="mt-1"
            />
          </div>

          {/* Proactive teaser */}
          <div className="rounded-lg border border-slate-700/60 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Proactive message</label>
                <p className="text-xs text-slate-400 mt-0.5">
                  Shows a prompt beside the launcher after a delay. Skipped for
                  visitors who have already started a conversation.
                </p>
              </div>
              <input
                type="checkbox"
                checked={site.proactiveEnabled}
                onChange={(e) =>
                  setSite({ ...site, proactiveEnabled: e.target.checked })
                }
                className="w-4 h-4 shrink-0 ml-3"
              />
            </div>

            {site.proactiveEnabled && (
              <>
                <Input
                  value={site.proactiveMessage || ""}
                  onChange={(e) =>
                    setSite({ ...site, proactiveMessage: e.target.value })
                  }
                  placeholder="Missing calls while you're on site? Ask me anything."
                />
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-slate-400">
                      Delay (seconds)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={site.proactiveDelaySeconds}
                      onChange={(e) =>
                        setSite({
                          ...site,
                          proactiveDelaySeconds: Number(e.target.value) || 0,
                        })
                      }
                      className="mt-1"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-slate-400">
                      Show again after (hours, 0 = once only)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={site.proactiveCooldownHours}
                      onChange={(e) =>
                        setSite({
                          ...site,
                          proactiveCooldownHours: Number(e.target.value) || 0,
                        })
                      }
                      className="mt-1"
                    />
                  </div>
                </div>
                {!site.proactiveMessage?.trim() && (
                  <p className="text-xs text-amber-500">
                    Enabled but no message set — nothing will be shown.
                  </p>
                )}
              </>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">
              Allowed Origins (one per line)
            </label>
            <Textarea
              value={site.allowedOrigins.join("\n")}
              onChange={(e) =>
                setSite({
                  ...site,
                  allowedOrigins: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="https://client.com&#10;https://www.client.com"
              rows={3}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Supports wildcards like <code>*.example.com</code>. Empty list
              allows all origins.
            </p>
          </div>
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              <span>System Prompt</span>
              <Badge variant="outline" className="text-[10px]">
                {site.systemPrompt.length} chars
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={site.systemPrompt}
              onChange={(e) =>
                setSite({ ...site, systemPrompt: e.target.value })
              }
              rows={20}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Tip: Include a lead capture instruction like &quot;When the
              visitor provides their name, email, and phone, append [LEAD:
              {"{"}&quot;name&quot;:...,&quot;email&quot;:...,&quot;phone&quot;:...{"}"}] at the end of your
              message.&quot;
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
