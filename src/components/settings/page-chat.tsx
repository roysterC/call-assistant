"use client";

/**
 * Settings › Online booking › Chat on your page: the salon's chat, set up
 * where it is used, rather than on a page of its own.
 *
 * Switching it on is enough. The first time, a chat is made for the salon
 * (a WebsiteConfig, as the Websites editor makes) answering as the salon, in
 * the page's brand colour. It knows the salon's services, prices, hours and
 * team, and the answers in Chats & texts, from Settings at the time of each
 * message (withSalonFacts), so nothing about the salon is typed twice here.
 *
 * Which chat is on the page (siteChatSiteId) is saved with the rest of
 * Settings. How the chat looks and talks is the chat's own record, saved as
 * each field is left, the way the Websites editor saves it.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Copy, MessageCircle } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { originsFromUrl } from "@/lib/prompt-template";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/language-provider";

export interface ChatSite {
  id: string;
  siteId: string;
  name: string;
  enabled: boolean;
  botName: string;
  greeting: string | null;
  brandColor: string;
  launcherPosition: string;
  allowedOrigins: unknown;
  proactiveEnabled: boolean;
  proactiveMessage: string | null;
  proactiveDelaySeconds: number;
}

// What clients see in the chat stays in English, as everything they are sent
// does; only the salon's own screens are translated.

/** Said first when the chat opens, until the salon writes its own. */
const DEFAULT_GREETING = "Hi! Ask me about prices or times, or tap Book online.";
const DEFAULT_NUDGE = "Any questions? I can check times for you.";
/** The preview of the salon's page, as clients see it. */
const PREVIEW = { salon: "Your salon", headline: "Book in three taps.", book: "Book online" };

function originList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((o): o is string => typeof o === "string") : [];
}

/** The salon's own website, out of a chat's allowed origins: the first that is not one of the booking page's. */
function ownSiteOf(origins: string[], pageOrigins: string[]): string {
  const own = origins.find((o) => !pageOrigins.includes(o) && o !== "*");
  return own ? own.replace(/^https?:\/\//, "") : "";
}

export function PageChat({
  chatbotEnabled,
  value,
  onChange,
  businessName,
  brand,
  pageUrl,
  headline,
}: {
  /** Website chat is on for the salon (Kikai switches it on). */
  chatbotEnabled: boolean;
  /** The chat on the page (siteChatSiteId), or null for none. */
  value: string | null;
  onChange: (siteId: string | null) => void;
  businessName: string;
  /** The page's brand colour, which the chat wears too. */
  brand: string;
  /** The salon's page, for the chat's allowed address and the preview. */
  pageUrl: string;
  headline: string;
}) {
  const { t } = useT();
  const [sites, setSites] = useState<ChatSite[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // Drafts of the text fields, saved when the field is left.
  const [draft, setDraft] = useState({ botName: "", greeting: "", nudge: "", ownSite: "" });

  const pageOrigins = originsFromUrl(pageUrl);

  useEffect(() => {
    if (!chatbotEnabled) return;
    let live = true;
    apiFetch("/api/websites")
      .then((r) => (r.ok ? r.json() : { sites: [] }))
      .then((d) => {
        if (live) setSites(Array.isArray(d.sites) ? d.sites : []);
      })
      .catch(() => live && setSites([]));
    return () => {
      live = false;
    };
  }, [chatbotEnabled]);

  const chosen = sites?.find((s) => s.siteId === value) ?? null;
  const on = Boolean(value && chosen);

  // Fill the drafts from the chat each time a different one is shown.
  const shownId = chosen?.id ?? null;
  useEffect(() => {
    if (!chosen) return;
    setDraft({
      botName: chosen.botName,
      greeting: chosen.greeting ?? "",
      nudge: chosen.proactiveMessage ?? "",
      ownSite: ownSiteOf(originList(chosen.allowedOrigins), pageOrigins),
    });
    // Only when the chat itself changes, not on every keystroke's re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId]);

  const save = async (patch: Partial<ChatSite>) => {
    if (!chosen) return;
    setError(null);
    // Shown at once; put back if the server refuses.
    const before = chosen;
    setSites((all) => all?.map((s) => (s.id === chosen.id ? { ...s, ...patch } : s)) ?? all);
    try {
      const res = await apiFetch(`/api/websites/${chosen.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      setSavedAt(Date.now());
    } catch {
      setSites((all) => all?.map((s) => (s.id === before.id ? before : s)) ?? all);
      setError(t("chat.saveFailed"));
    }
  };

  // The chat wears the page's colour: changing it above changes the chat.
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!chosen || !on || chosen.brandColor === brand || synced.current === `${chosen.id}:${brand}`) return;
    synced.current = `${chosen.id}:${brand}`;
    const timer = setTimeout(() => save({ brandColor: brand }), 600);
    return () => clearTimeout(timer);
    // save reads the current chat; the colour and the chat are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand, chosen?.id, chosen?.brandColor, on]);

  const switchOn = async () => {
    if (!sites) return;
    // Without the page's address a new chat would have no allowed address,
    // which the widget reads as "any website".
    if (!pageUrl) {
      setError(t("chat.savePageFirst"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The chat already chosen, or the salon's own, before making another.
      const existing = sites.find((s) => s.siteId === value) ?? sites.find((s) => s.enabled) ?? sites[0];
      if (existing) {
        if (!existing.enabled || existing.brandColor !== brand) {
          const res = await apiFetch(`/api/websites/${existing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true, brandColor: brand }),
          });
          if (!res.ok) throw new Error();
          setSites(sites.map((s) => (s.id === existing.id ? { ...s, enabled: true, brandColor: brand } : s)));
        }
        onChange(existing.siteId);
        return;
      }
      const name = businessName.trim() || "Salon";
      const res = await apiFetch("/api/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          botName: name,
          greeting: DEFAULT_GREETING,
          brandColor: brand,
          siteUrl: pageUrl,
          profile: {
            businessName: name,
            description: `${name} is a salon. Clients book online from its page.`,
            nextStep: "the Book online button",
            botName: name,
          },
        }),
      });
      const site = await res.json().catch(() => null);
      if (!res.ok || !site?.siteId) throw new Error();
      // Bottom right, where clients expect a chat.
      setSites([...sites, { launcherPosition: "right", proactiveEnabled: false, proactiveMessage: null, proactiveDelaySeconds: 15, ...site }]);
      onChange(site.siteId);
    } catch {
      setError(t("chat.switchFailed"));
    } finally {
      setBusy(false);
    }
  };

  const ownSiteOrigins = originsFromUrl(draft.ownSite);
  const snippet = chosen
    ? `<script src="${typeof window !== "undefined" ? window.location.origin : ""}/widget.js" data-site-id="${chosen.siteId}" async></script>`
    : "";
  const left = chosen?.launcherPosition === "left";

  if (!chatbotEnabled) {
    return (
      <Card>
        <p className="text-xs text-muted-foreground">
          {t("chat.notOn")}
        </p>
      </Card>
    );
  }

  return (
    <Card
      toggle={
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t("chat.switchLabel")}
          disabled={busy || sites === null}
          onClick={() => (on ? onChange(null) : switchOn())}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
            on ? "bg-primary" : "bg-tea-green-500"
          )}
        >
          <span
            className={cn(
              "absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-[left]",
              on ? "left-[23px]" : "left-[3px]"
            )}
          />
        </button>
      }
    >
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {!on && (
        <p className="rounded-xl bg-muted/50 px-3.5 py-3 text-xs text-muted-foreground">
          {busy
            ? t("chat.settingUp")
            : t("chat.off")}
        </p>
      )}

      {on && chosen && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            {sites && sites.length > 1 && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("chat.which")}</span>
                <select
                  value={value ?? ""}
                  onChange={(e) => onChange(e.target.value)}
                  className="h-9 rounded-lg border bg-background px-2 text-sm"
                >
                  {sites.map((s) => (
                    <option key={s.siteId} value={s.siteId}>
                      {s.name}
                      {s.enabled ? "" : t("chat.switchedOffSuffix")}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex flex-wrap gap-3">
              <label className="block min-w-48 flex-1 space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("chat.answersAs")}</span>
                <Input
                  value={draft.botName}
                  maxLength={60}
                  onChange={(e) => setDraft({ ...draft, botName: e.target.value })}
                  onBlur={() => {
                    const v = draft.botName.trim() || businessName.trim() || "Assistant";
                    if (v !== chosen.botName) save({ botName: v });
                  }}
                />
              </label>
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-muted-foreground">{t("chat.corner")}</span>
                <div role="group" aria-label={t("chat.corner")} className="flex h-9 overflow-hidden rounded-lg border">
                  {(["left", "right"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      aria-pressed={chosen.launcherPosition === side}
                      onClick={() => chosen.launcherPosition !== side && save({ launcherPosition: side })}
                      className={cn(
                        "px-3.5 text-sm font-medium first:border-r",
                        chosen.launcherPosition === side ? "bg-tea-green-800" : "hover:bg-accent"
                      )}
                    >
                      {t(`chat.${side}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t("chat.firstMessage")}</span>
              <Textarea
                rows={2}
                maxLength={300}
                value={draft.greeting}
                placeholder={DEFAULT_GREETING}
                onChange={(e) => setDraft({ ...draft, greeting: e.target.value })}
                onBlur={() => {
                  const v = draft.greeting.trim() || null;
                  if (v !== (chosen.greeting ?? null)) save({ greeting: v });
                }}
              />
            </label>

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-4 w-4 shrink-0 rounded" style={{ background: brand }} aria-hidden="true" />
              {t("chat.brand")}
            </p>

            <button
              type="button"
              onClick={() => setMore(!more)}
              aria-expanded={more}
              className="flex items-center gap-1.5 text-sm font-medium text-primary"
            >
              <ChevronRight className={cn("h-4 w-4 transition-transform", more && "rotate-90")} aria-hidden="true" />
              {t("chat.more")}
            </button>
            {more && (
              <div className="space-y-3 rounded-xl border bg-muted/30 p-3.5">
                <p className="text-xs text-muted-foreground">
                  {t("chat.knows")}{" "}
                  <a href="#chats" className="font-medium text-primary underline underline-offset-2">
                    {t("settings.tab.chats")}
                  </a>
                  {t("chat.knowsSame")}
                </p>
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-primary"
                    checked={chosen.proactiveEnabled}
                    onChange={(e) =>
                      save({
                        proactiveEnabled: e.target.checked,
                        proactiveMessage: draft.nudge.trim() || chosen.proactiveMessage || DEFAULT_NUDGE,
                      })
                    }
                  />
                  <span>
                    <span className="font-medium">{t("chat.helloFirst")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("chat.helloWhen", { n: chosen.proactiveDelaySeconds })}
                    </span>
                  </span>
                </label>
                {chosen.proactiveEnabled && (
                  <Input
                    aria-label={t("chat.helloLabel")}
                    maxLength={200}
                    value={draft.nudge}
                    placeholder={DEFAULT_NUDGE}
                    onChange={(e) => setDraft({ ...draft, nudge: e.target.value })}
                    onBlur={() => {
                      const v = draft.nudge.trim() || DEFAULT_NUDGE;
                      if (v !== chosen.proactiveMessage) save({ proactiveMessage: v });
                    }}
                  />
                )}
              </div>
            )}

            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-medium">{t("chat.ownSite")}</p>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("chat.ownSiteAddress")}</span>
                <Input
                  value={draft.ownSite}
                  placeholder="yoursalon.co.uk"
                  onChange={(e) => setDraft({ ...draft, ownSite: e.target.value })}
                  onBlur={() => {
                    const origins = [...new Set([...pageOrigins, ...ownSiteOrigins])];
                    const now = originList(chosen.allowedOrigins);
                    if (draft.ownSite.trim() && ownSiteOrigins.length === 0) {
                      setError(t("chat.ownSiteBad"));
                      return;
                    }
                    if (origins.join(" ") !== now.join(" ")) save({ allowedOrigins: origins });
                  }}
                />
                <span className="block text-xs text-muted-foreground">
                  {t("chat.ownSiteOnly")}
                </span>
              </label>
              {ownSiteOrigins.length > 0 && <Snippet value={snippet} />}
            </div>

            {savedAt && !error && (
              <p role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> {t("chat.saved")}
              </p>
            )}
            {!chosen.enabled && (
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-papaya-whip-100">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("chat.isOff")}
                <button
                  type="button"
                  onClick={() => save({ enabled: true })}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  {t("chat.switchBack")}
                </button>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              aria-expanded={showPreview}
              className="h-10 w-full rounded-lg border text-sm font-medium hover:bg-accent lg:hidden"
            >
              {showPreview ? t("chat.hidePreview") : t("chat.showPreview")}
            </button>
            <div className={cn("space-y-2", !showPreview && "max-lg:hidden")}>
              <span className="block text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {t("chat.previewTitle")}
              </span>
              <div
                aria-label={t("chat.previewLabel")}
                className="relative h-[380px] overflow-hidden rounded-2xl border bg-white text-[#1c1917]"
              >
                <div className="px-4 py-4 text-white" style={{ background: brand }}>
                  <p className="font-heading text-base font-extrabold">{businessName || PREVIEW.salon}</p>
                  <p className="mt-0.5 truncate text-xs opacity-85">{headline || PREVIEW.headline}</p>
                </div>
                <div className="space-y-2 p-4">
                  <div className="h-10 rounded-lg bg-stone-100" />
                  <div className="h-10 rounded-lg bg-stone-100" />
                </div>
                <div className={cn("absolute bottom-3 flex flex-col gap-2", left ? "left-3 items-start" : "right-3 items-end")}>
                  <div className="w-[230px] overflow-hidden rounded-xl bg-white shadow-raised">
                    <div className="truncate px-3 py-2 text-[13px] font-bold text-white" style={{ background: brand }}>
                      {draft.botName || chosen.botName}
                    </div>
                    <div className="space-y-2 p-3">
                      <p className="rounded-xl rounded-bl-sm bg-stone-100 px-2.5 py-1.5 text-xs leading-snug">
                        {draft.greeting || DEFAULT_GREETING}
                      </p>
                      <span
                        className="inline-flex h-7 items-center rounded-full border-[1.5px] px-2.5 text-[11.5px] font-bold"
                        style={{ borderColor: brand, color: brand }}
                      >
                        {PREVIEW.book}
                      </span>
                    </div>
                  </div>
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-full text-white"
                    style={{ background: brand }}
                    aria-hidden="true"
                  >
                    <MessageCircle className="h-5 w-5" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function Card({ toggle, children }: { toggle?: React.ReactNode; children: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold">{t("chat.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("chat.description")}</p>
        </div>
        {toggle}
      </div>
      {children}
    </div>
  );
}

function Snippet({ value }: { value: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t("chat.paste")}</span>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-lg bg-muted px-3 py-2 font-mono text-xs leading-relaxed">
          {value}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // No clipboard: the code is on screen to select by hand.
            }
          }}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-accent"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("chat.copied") : t("chat.copy")}
        </button>
      </div>
    </div>
  );
}
