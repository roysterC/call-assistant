"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { readableTextOn } from "@/lib/contrast";
import { slugifySiteId, originsFromUrl } from "@/lib/prompt-template";

interface Form {
  name: string;
  siteUrl: string;
  businessName: string;
  description: string;
  services: string;
  nextStep: string;
  ctaLabel: string;
  ctaSelector: string;
  ctaUrl: string;
  avoid: string;
  tone: "friendly" | "professional" | "direct";
  discussPricing: boolean;
  botName: string;
  greeting: string;
  quickReplies: string;
  brandColor: string;
}

const EMPTY: Form = {
  name: "",
  siteUrl: "",
  businessName: "",
  description: "",
  services: "",
  nextStep: "",
  ctaLabel: "",
  ctaSelector: "",
  ctaUrl: "",
  avoid: "",
  tone: "friendly",
  discussPricing: false,
  botName: "",
  greeting: "",
  quickReplies: "",
  brandColor: "#2563eb",
};

const STEPS = ["Your site", "Your business", "Appearance"];

export default function NewWebsitePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ siteId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const siteId = slugifySiteId(form.name);
  const origins = originsFromUrl(form.siteUrl);
  const contrast = readableTextOn(form.brandColor);

  // Each step gates on only what it actually needs, so nobody is blocked by a
  // field two screens away.
  const canContinue =
    step === 0
      ? form.name.trim().length > 1 && origins.length > 0
      : step === 1
      ? form.businessName.trim().length > 1 &&
        form.description.trim().length > 20
      : true;

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          siteId,
          siteUrl: form.siteUrl.trim(),
          botName: form.botName.trim() || "Assistant",
          greeting: form.greeting.trim() || null,
          quickReplies: form.quickReplies
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          brandColor: form.brandColor,
          ctaLabel: form.ctaLabel.trim() || null,
          ctaSelector: form.ctaSelector.trim() || null,
          ctaUrl: form.ctaUrl.trim() || null,
          // The prompt is generated server-side from these — clients never
          // write raw prompt text.
          profile: {
            businessName: form.businessName.trim(),
            description: form.description.trim(),
            services: form.services,
            nextStep: form.nextStep,
            avoid: form.avoid,
            tone: form.tone,
            discussPricing: form.discussPricing,
            botName: form.botName.trim() || "Assistant",
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create site");
      setCreated({ siteId: data.siteId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create site");
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const snippet = `<script src="${origin}/widget.js" data-site-id="${created.siteId}" async></script>`;
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
            <Check className="w-6 h-6 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold">{form.name} is ready</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add this one line to your site, just before{" "}
            <code>&lt;/body&gt;</code>.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-2 items-start">
              <code className="flex-1 bg-muted p-3 rounded text-xs text-foreground/80 break-all">
                {snippet}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(snippet);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              It will only run on {origins.join(" and ")} — add more domains in
              settings if you need them.
            </p>
          </CardContent>
        </Card>

        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => router.push("/websites")}>
            All websites
          </Button>
          <Button onClick={() => router.push(`/websites`)}>
            Fine-tune settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/websites")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold mt-2">Add a website</h1>
      </div>

      <div className="flex gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex-1">
            <div
              className={`h-1 rounded-full ${
                i <= step ? "bg-emerald-500" : "bg-accent"
              }`}
            />
            <p
              className={`text-xs mt-1.5 ${
                i === step ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              <div>
                <label className="text-sm font-medium">
                  What should we call it?
                </label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Acme Plumbing"
                  className="mt-1"
                />
                {siteId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Embed id: <code>{siteId}</code>
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium">
                  Where will the chat live?
                </label>
                <Input
                  value={form.siteUrl}
                  onChange={(e) => set("siteUrl", e.target.value)}
                  placeholder="acmeplumbing.co.uk"
                  className="mt-1"
                />
                {/*
                  Stated rather than hidden: this is the setting that stops
                  anyone else embedding the same bot on their own site.
                */}
                <p className="text-xs text-muted-foreground mt-1">
                  {origins.length
                    ? `The chat will only run on ${origins.join(" and ")}.`
                    : "The chat will only run on the domain you enter here."}
                </p>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <label className="text-sm font-medium">Business name</label>
                <Input
                  value={form.businessName}
                  onChange={(e) => set("businessName", e.target.value)}
                  placeholder="Acme Plumbing"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  What does the business do?
                </label>
                <Textarea
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="We're a family-run plumbing firm covering Leeds and Bradford. Emergency callouts, boiler servicing and bathroom installs."
                  rows={3}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The more specific this is, the less the bot has to guess.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">
                  Main services (one per line)
                </label>
                <Textarea
                  value={form.services}
                  onChange={(e) => set("services", e.target.value)}
                  placeholder={"Emergency callouts\nBoiler servicing\nBathroom installation"}
                  rows={3}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  What should someone do next?
                </label>
                <Input
                  value={form.nextStep}
                  onChange={(e) => set("nextStep", e.target.value)}
                  placeholder="Book a callback, or ring us on 0113 496 0000"
                  className="mt-1"
                />
              </div>
              {/*
                Sits with "what should someone do next" because it is the same
                question asked twice: that field tells the bot what to say, this
                one gives the visitor a button that takes them there. Asking now
                is the point — this is the one moment the client is looking at
                their own page and knows where the form lives.
              */}
              <div className="rounded-lg border border-border p-3 space-y-3">
                <div>
                  <label className="text-sm font-medium">
                    Button to your booking or contact form
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Shown once someone has sent a message. There is no
                    &ldquo;talk to a human&rdquo; option — this sends them
                    somewhere you&apos;ll actually see them. Leave blank to skip.
                  </p>
                </div>
                <Input
                  value={form.ctaLabel}
                  onChange={(e) => set("ctaLabel", e.target.value)}
                  placeholder="Book a call with the team"
                  maxLength={40}
                />
                <Input
                  value={form.ctaUrl}
                  onChange={(e) => set("ctaUrl", e.target.value)}
                  placeholder="/contact  — or a full link to your booking page"
                />
                <details className="group">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground/80 select-none">
                    The form is on this page already?
                  </summary>
                  <div className="mt-2">
                    <Input
                      value={form.ctaSelector}
                      onChange={(e) => set("ctaSelector", e.target.value)}
                      placeholder="#booking-form"
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      The id of the section, written with a{" "}
                      <code className="text-muted-foreground">#</code> in front. The
                      chat scrolls there instead of loading a new page — it never
                      clicks anything for the visitor.
                    </p>
                  </div>
                </details>
                {form.ctaLabel.trim() &&
                  !form.ctaUrl.trim() &&
                  !form.ctaSelector.trim() && (
                    <p className="text-xs text-amber-700">
                      Add a link or a section id, or the button stays hidden —
                      it has nowhere to send anyone.
                    </p>
                  )}
              </div>

              <div>
                <label className="text-sm font-medium">
                  Anything it must not say?
                </label>
                <Input
                  value={form.avoid}
                  onChange={(e) => set("avoid", e.target.value)}
                  placeholder="Don't promise same-day appointments"
                  className="mt-1"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium">Tone</label>
                  <select
                    value={form.tone}
                    onChange={(e) =>
                      set("tone", e.target.value as Form["tone"])
                    }
                    className="mt-1 w-full h-9 rounded-md border border-border bg-transparent px-2 text-sm"
                  >
                    <option value="friendly">Friendly</option>
                    <option value="professional">Professional</option>
                    <option value="direct">Direct</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">Bot name</label>
                  <Input
                    value={form.botName}
                    onChange={(e) => set("botName", e.target.value)}
                    placeholder="Alex"
                    className="mt-1"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.discussPricing}
                  onChange={(e) => set("discussPricing", e.target.checked)}
                  className="w-4 h-4"
                />
                Let it discuss pricing
              </label>
              {!form.discussPricing && (
                <p className="text-xs text-muted-foreground -mt-2">
                  It will decline price questions and point people to you — safer
                  than letting it guess a number.
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="text-sm font-medium">Brand colour</label>
                <div className="flex gap-2 mt-1">
                  <Input
                    type="color"
                    value={form.brandColor}
                    onChange={(e) => set("brandColor", e.target.value)}
                    className="w-20 h-10 p-1 cursor-pointer"
                  />
                  <Input
                    value={form.brandColor}
                    onChange={(e) => set("brandColor", e.target.value)}
                    className="flex-1"
                  />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className="px-3 py-1.5 rounded-md text-xs font-semibold"
                    style={{
                      backgroundColor: form.brandColor,
                      color: contrast.color,
                    }}
                  >
                    {form.botName || "Assistant"}
                  </div>
                  <span
                    className={`text-xs ${
                      contrast.meetsAA ? "text-muted-foreground" : "text-amber-700"
                    }`}
                  >
                    {contrast.meetsAA
                      ? `Contrast ${contrast.ratio.toFixed(1)}:1 — passes AA`
                      : `Contrast ${contrast.ratio.toFixed(
                          1
                        )}:1 — below 4.5:1, hard to read`}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">First message</label>
                <Input
                  value={form.greeting}
                  onChange={(e) => set("greeting", e.target.value)}
                  placeholder="Hi! Got a question about a job?"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Suggested questions (one per line)
                </label>
                <Textarea
                  value={form.quickReplies}
                  onChange={(e) => set("quickReplies", e.target.value)}
                  placeholder={"Do you cover my area?\nHow quickly can you come out?\nDo you do emergency callouts?"}
                  rows={3}
                  className="mt-1"
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
            Continue <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={create} disabled={saving}>
            {saving ? "Creating..." : "Create website"}
          </Button>
        )}
      </div>
    </div>
  );
}
