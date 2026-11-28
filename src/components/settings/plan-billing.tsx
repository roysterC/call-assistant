"use client";

/**
 * Settings → Plan & billing, the owner's: where the salon stands (trial,
 * paying, a failed payment, paused), what its plan costs line by line, and
 * the AI tools it can add. The rules are src/lib/plan.ts; the card itself is
 * Stripe's page (/api/billing/checkout and /portal).
 */

import { useCallback, useEffect, useState } from "react";
import { Bot, CalendarCheck, MessageCircle, Phone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";
import { useT } from "@/components/providers/language-provider";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { apiFetch } from "@/lib/api-fetch";
import { INTL_LOCALE } from "@/lib/i18n";
import { ADDONS, addonsNeeding, addonsWith, formatPence, SELF_SERVE_ADDONS, type Addon } from "@/lib/plan";
import type { BillingSummary } from "@/lib/billing";
import { cn } from "@/lib/utils";

type Summary = BillingSummary & { cardPayments: boolean };

const ICON: Record<Addon, typeof Phone> = {
  receptionist: Phone,
  chatReplies: MessageCircle,
  chatBooking: CalendarCheck,
  rebookTexts: RefreshCw,
};

export function PlanBilling() {
  const { t, lang } = useT();
  const { notify, confirm } = useDialogs();
  const [b, setB] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch("/api/billing")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Summary) => {
        setB(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  // Back from Stripe's page: the card is in, and Stripe's word follows
  // shortly by webhook, so look again in a moment.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("card")) return;
    notify(t("plan.cardAdded"), "success");
    const timer = setTimeout(load, 3000);
    window.history.replaceState(null, "", `${window.location.pathname}#plan`);
    return () => clearTimeout(timer);
  }, [load, notify, t]);

  if (failed) return <p className="text-sm text-muted-foreground">{t("plan.loadFailed")}</p>;
  if (!b) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;

  const { plan } = b;
  const money = (pence: number) => formatPence(pence, INTL_LOCALE[lang]);
  const day = (iso: string) => new Date(iso).toLocaleDateString(INTL_LOCALE[lang], { day: "numeric", month: "short" });

  /** Off to one of Stripe's pages. */
  async function goTo(path: "checkout" | "portal") {
    setBusy(path);
    try {
      const res = await apiFetch(`/api/billing/${path}`, { method: "POST" });
      const d = await res.json();
      if (!res.ok || !d.url) throw new Error(d.error);
      window.location.href = d.url;
    } catch {
      notify(t("plan.stripeFailed"));
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    try {
      const res = await apiFetch("/api/billing/retry", { method: "POST" });
      const d = await res.json();
      if (!res.ok) return notify(t("plan.retryFailed"));
      setB({ ...b!, ...d });
      notify(t("plan.retryDone"), "success");
    } finally {
      setBusy(null);
    }
  }

  /** Cancel at the end of the paid month, or keep the plan after all. */
  async function setCancel(cancel: boolean) {
    if (cancel) {
      const ok = await confirm({
        title: t("plan.cancelTitle"),
        body: t("plan.cancelBody"),
        confirmLabel: t("plan.cancelConfirm"),
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy("cancel");
    try {
      const res = await apiFetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel }),
      });
      const d = await res.json();
      if (!res.ok) return notify(t("plan.cancelFailed"));
      setB({ ...b!, ...d });
      notify(cancel ? t("plan.cancelled", { date: d.plan?.endsAt ? day(d.plan.endsAt) : "" }) : t("plan.kept"), "success");
    } finally {
      setBusy(null);
    }
  }

  async function setAddon(a: Addon, on: boolean) {
    const others = on
      ? addonsWith(a).filter((x) => x !== a && !plan.addons.includes(x))
      : addonsNeeding(a).filter((x) => plan.addons.includes(x));
    if (others.length) {
      const names = others.map((x) => t(`plan.addon.${x}.name`)).join(", ");
      const ok = await confirm({
        title: on ? t("plan.addWithTitle", { name: t(`plan.addon.${a}.name`) }) : t("plan.removeWithTitle", { name: t(`plan.addon.${a}.name`) }),
        body: on ? t("plan.addWith", { names }) : t("plan.removeWith", { names }),
        confirmLabel: on ? t("plan.add") : t("plan.remove"),
        destructive: !on,
      });
      if (!ok) return;
    }
    setBusy(a);
    try {
      const res = await apiFetch("/api/billing/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addon: a, on }),
      });
      const d = await res.json();
      if (!res.ok) return notify(d.code === "card_needed" ? t("plan.cardFirst") : d.code === "busy" ? t("plan.busy") : t("plan.addonFailed"));
      setB({ ...b!, ...d });
      notify(d.requested ? t("plan.requested") : on ? t("plan.added") : t("plan.removed"), "success");
    } finally {
      setBusy(null);
    }
  }

  // The card at the top: where the salon stands, and the one thing to do.
  const head = (() => {
    switch (plan.warning) {
      case "restricted":
        return {
          tone: "bad" as const,
          title: t("plan.paused.title"),
          text: t("plan.paused.text"),
          actions: plan.hasCard ? (["portal", "retry"] as const) : (["checkout"] as const),
        };
      case "paymentFailed":
        return { tone: "warn" as const, title: t("plan.failed.title"), text: t("plan.failed.text"), actions: ["portal", "retry"] as const };
    }
    // Cancelled by the owner: it carries on to the end of the paid month.
    if (plan.endsAt) {
      return {
        tone: "info" as const,
        title: t("plan.ending.title", { date: day(plan.endsAt) }),
        text: t("plan.ending.text"),
        actions: ["keep"] as const,
      };
    }
    switch (plan.warning) {
      case "trialEnding":
      case "trialNoCard":
        return {
          tone: plan.warning === "trialEnding" ? ("warn" as const) : ("info" as const),
          title: t("plan.trial.title", { days: plan.trialDaysLeft ?? 0 }),
          text: b.trialEndsAt ? t("plan.trial.text", { date: day(b.trialEndsAt) }) : t("plan.trial.textNoDate"),
          actions: ["checkout"] as const,
        };
    }
    if (plan.status === "free") return { tone: "good" as const, title: t("plan.free.title"), text: t("plan.free.text"), actions: [] as const };
    if (plan.status === "trialing") {
      return {
        tone: "good" as const,
        title: t("plan.trial.title", { days: plan.trialDaysLeft ?? 0 }),
        text: b.trialEndsAt ? t("plan.trialCard.text", { date: day(b.trialEndsAt), total: money(b.bill.total) }) : "",
        actions: ["portal"] as const,
      };
    }
    return {
      tone: "good" as const,
      title: t("plan.paying.title"),
      text: t("plan.paying.text", { total: money(b.bill.total) }),
      actions: ["portal"] as const,
    };
  })();

  const label: Record<"checkout" | "portal" | "retry" | "keep", string> = {
    keep: t("plan.keep"),
    checkout: t("plan.addCard"),
    portal: plan.warning ? t("plan.updateCard") : t("plan.cardInvoices"),
    retry: t("plan.tryAgain"),
  };

  return (
    <div className="space-y-5">
      <section
        aria-labelledby="plan-status-title"
        className={cn(
          "flex flex-col gap-3 rounded-xl px-5 py-4 ring-1 sm:flex-row sm:items-center",
          head.tone === "bad" && "bg-destructive/10 ring-destructive/40",
          head.tone === "warn" && "bg-papaya-whip-700 ring-papaya-whip-400",
          head.tone === "info" && "bg-cornsilk-900 ring-cornsilk-500",
          head.tone === "good" && "bg-card ring-border"
        )}
      >
        <div className="min-w-0 flex-1">
          <h2 id="plan-status-title" className="text-base font-bold">
            {head.title}
          </h2>
          {head.text && <p className="mt-0.5 text-sm text-muted-foreground">{head.text}</p>}
        </div>
        {b.cardPayments && head.actions.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:flex">
            {head.actions.map((a, i) => (
              <Button
                key={a}
                className={cn("h-11", head.actions.length === 1 && "col-span-2")}
                variant={i === 0 ? "default" : "outline"}
                disabled={busy !== null}
                onClick={() => void (a === "retry" ? retry() : a === "keep" ? setCancel(false) : goTo(a))}
              >
                {label[a]}
              </Button>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        <SettingsSection id="plan" title={t("plan.yours")} description={t("plan.included")}>
          <div className="space-y-4">
            <ul className="flex flex-wrap gap-1.5" aria-label={t("plan.included")}>
              {(["diary", "clients", "sales", "website"] as const).map((k) => (
                <li key={k} className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
                  {t(`plan.base.${k}`)}
                </li>
              ))}
            </ul>
            <dl className="divide-y divide-border">
              {b.bill.lines.map((l) => (
                <div key={l.key} className="flex justify-between gap-3 py-2">
                  <dt>
                    {l.key === "base"
                      ? t("plan.line.base")
                      : l.key === "seat"
                        ? t("plan.line.seats", { n: l.quantity, each: money(b.prices.seat ?? 0) })
                        : t(`plan.addon.${l.key}.name`)}
                  </dt>
                  <dd className="tabular-nums">{money(l.pence)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 py-2 text-base font-bold">
                <dt>{plan.status === "free" ? t("plan.wouldBe") : t("plan.aMonth")}</dt>
                <dd className="tabular-nums">{money(b.bill.total)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">{t("plan.teamNote", { people: b.people })}</p>
          </div>
        </SettingsSection>

        <SettingsSection id="ai-tools" title={t("plan.tools")} description={t("plan.toolsHint")}>
          <ul className="divide-y divide-border">
            {ADDONS.map((a) => {
              const Icon = ICON[a];
              const price = b.prices[a];
              const on = plan.addons.includes(a);
              const asked = b.addonRequests.includes(a);
              const selfServe = SELF_SERVE_ADDONS.includes(a) && plan.status !== "free";
              const working = plan.addonActive[a];
              return (
                <li key={a} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t(`plan.addon.${a}.name`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`plan.addon.${a}.does`)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {price == null || !addonsWith(a).every((x) => b.prices[x] != null) ? (
                      <span className="text-xs text-muted-foreground">{t("plan.soon")}</span>
                    ) : (
                      <span className="text-sm font-semibold tabular-nums">{t("plan.perMonth", { price: money(price) })}</span>
                    )}
                    {plan.status === "free" ? (
                      working && <Pill>{t("plan.includedPill")}</Pill>
                    ) : on ? (
                      <>
                        <Pill muted={!working}>{working ? t("plan.on") : t("plan.paused.pill")}</Pill>
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void setAddon(a, false)}>
                          {t("plan.remove")}
                        </Button>
                      </>
                    ) : asked ? (
                      <Pill muted>{t("plan.asked")}</Pill>
                    ) : addonsWith(a).every((x) => b.prices[x] != null) && plan.access === "full" ? (
                      <Button
                        size="sm"
                        variant={selfServe ? "default" : "outline"}
                        disabled={busy !== null || (selfServe && !plan.hasCard)}
                        onClick={() => void setAddon(a, true)}
                      >
                        {selfServe ? t("plan.add") : t("plan.ask")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {plan.status === "trialing" && !plan.hasCard && <p className="pt-2 text-xs text-muted-foreground">{t("plan.cardFirst")}</p>}
          {plan.access === "restricted" && <p className="pt-2 text-xs text-muted-foreground">{t("plan.toolsPaused")}</p>}
        </SettingsSection>
      </div>
      {/* Cancelling: the owner's own, at the end of the paid month. */}
      {b.cardPayments && plan.hasCard && plan.billed && !plan.endsAt && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy !== null} onClick={() => void setCancel(true)}>
            {t("plan.cancelPlan")}
          </Button>
        </div>
      )}
      {!b.cardPayments && plan.billed && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
          {t("plan.noStripe")}
        </p>
      )}
    </div>
  );
}

function Pill({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
        muted ? "bg-muted text-muted-foreground" : "bg-tea-green-800 text-tea-green-200"
      )}
    >
      {children}
    </span>
  );
}
