"use client";

/**
 * Kikai's side of billing (src/lib/plan.ts): the prices every salon pays, on
 * the salons list, and each salon's plan, on its page. English only, like the
 * rest of Admin.
 */

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { apiFetch } from "@/lib/api-fetch";
import { ADDONS, changedAddons, formatPence, PRICE_KEYS, type Addon, type PriceKey, type PriceList } from "@/lib/plan";
import type { BillingSummary } from "@/lib/billing";

export const PRICE_LABEL: Record<PriceKey, string> = {
  base: "Base plan (owner included)",
  seat: "Each extra team member",
  receptionist: "Phone receptionist",
  chatReplies: "AI chat replies",
  chatBooking: "Booking by message",
  rebookTexts: "Rebooking texts",
};

const STATUS_LABEL: Record<string, string> = {
  free: "Not billed",
  trialing: "Free trial",
  active: "Paying",
  past_due: "Payment failed, retrying",
  restricted: "Restricted",
};

function poundsToPence(v: string): number | null {
  const n = Number(v.replace(/[£,\s]/g, ""));
  return v.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100);
}

/** The prices, each saved on its own. */
export function BillingPrices() {
  const { notify } = useDialogs();
  const [prices, setPrices] = useState<PriceList | null>(null);
  const [draft, setDraft] = useState<Partial<Record<PriceKey, string>>>({});

  useEffect(() => {
    apiFetch("/api/admin/billing-prices")
      .then((r) => r.json())
      .then((d: { prices: PriceList }) => setPrices(d.prices))
      .catch(() => notify("Could not load prices."));
  }, [notify]);

  async function save(key: PriceKey) {
    const raw = draft[key] ?? "";
    const pence = poundsToPence(raw);
    if (raw.trim() !== "" && pence === null) return notify("Type a price in pounds, like 9 or 12.50.");
    const res = await apiFetch("/api/admin/billing-prices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, pence }),
    });
    const d = await res.json();
    if (!res.ok) return notify(d.error || "Could not save.");
    setPrices(d.prices);
    setDraft((x) => ({ ...x, [key]: undefined }));
    notify(`${PRICE_LABEL[key]}: ${pence === null ? "not for sale" : `${formatPence(pence)} a month`}.`, "success");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          A month, VAT included. A new price is for salons that subscribe from now: those already paying keep the price
          they joined on. An add-on with no price is not for sale.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRICE_KEYS.map((key) => {
            const pence = prices?.[key];
            const value = draft[key] ?? (pence == null ? "" : (pence / 100).toFixed(pence % 100 ? 2 : 0));
            return (
              <div key={key} className="flex items-center gap-2 rounded-lg border p-2">
                <label htmlFor={`price-${key}`} className="min-w-0 flex-1 text-sm">
                  {PRICE_LABEL[key]}
                </label>
                <span className="text-sm text-muted-foreground">£</span>
                <Input
                  id={`price-${key}`}
                  className="h-8 w-20"
                  inputMode="decimal"
                  value={value}
                  placeholder="—"
                  onChange={(e) => setDraft((x) => ({ ...x, [key]: e.target.value }))}
                />
                <Button size="sm" variant="outline" disabled={draft[key] === undefined} onClick={() => void save(key)}>
                  Save
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/** One salon's plan: its state, add-ons, people and bill. */
export function OrgBilling({ orgId }: { orgId: string }) {
  const { notify, confirm } = useDialogs();
  const [b, setB] = useState<BillingSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch(`/api/admin/organizations/${orgId}/billing`)
      .then((r) => r.json())
      .then(setB)
      .catch(() => notify("Could not load the plan."));
  }, [orgId, notify]);
  useEffect(load, [load]);

  async function put(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/admin/organizations/${orgId}/billing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) return notify(d.error || "Could not save.");
      setB(d);
      if (d.stripeError) notify(`Saved, but Stripe said: ${d.stripeError}`);
    } finally {
      setBusy(false);
    }
  }

  if (!b) return null;
  const { plan } = b;

  async function toggle(a: Addon, on: boolean) {
    const next = changedAddons(plan.addons, a, on);
    const extra = next.filter((x) => x !== a && !plan.addons.includes(x));
    const gone = plan.addons.filter((x) => x !== a && !next.includes(x));
    if (extra.length || gone.length) {
      const what = on
        ? `It works through ${extra.map((x) => PRICE_LABEL[x]).join(" and ")}, which will be added too.`
        : `${gone.map((x) => PRICE_LABEL[x]).join(" and ")} needs it, and will go too.`;
      if (!(await confirm({ title: `${on ? "Add" : "Remove"} ${PRICE_LABEL[a]}?`, body: what }))) return;
    }
    await put({ addons: next });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Plan and billing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold">{STATUS_LABEL[plan.status] ?? plan.status}</span>
          {plan.status === "trialing" && (
            <span className="text-muted-foreground">
              {b.trialEndsAt
                ? `Ends ${format(new Date(b.trialEndsAt), "d MMM yyyy")} (${plan.trialDaysLeft} days left)`
                : "Starts when the owner first signs in"}
            </span>
          )}
          <span className="text-muted-foreground">{plan.hasCard ? "Card on file (Stripe)" : "No card"}</span>
          <span className="text-muted-foreground">
            {b.people} {b.people === 1 ? "person" : "people"} on the team · {b.seats} extra
          </span>
        </div>

        {b.addonRequests.length > 0 && (
          <div className="rounded-md border border-papaya-whip-400 bg-papaya-whip-700 px-3 py-2 text-xs text-papaya-whip-100">
            Asked for: {b.addonRequests.map((a) => PRICE_LABEL[a]).join(", ")}. Set it up below (its switch under
            Features), then add it to the plan.
            <div className="mt-2 flex gap-2">
              {b.addonRequests.map((a) => (
                <Button key={a} size="sm" variant="outline" disabled={busy} onClick={() => void put({ dismissRequest: a })}>
                  Dismiss {PRICE_LABEL[a]}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Add-ons on the plan</p>
          {ADDONS.map((a) => {
            const on = plan.addons.includes(a);
            const price = b.prices[a];
            return (
              <label key={a} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={on}
                  disabled={busy}
                  onChange={(e) => void toggle(a, e.target.checked)}
                />
                <span className="flex-1">{PRICE_LABEL[a]}</span>
                <span className="text-muted-foreground">{price == null ? "no price set" : `${formatPence(price)}/mo`}</span>
                <span className={plan.addonActive[a] ? "text-tea-green-200" : "text-muted-foreground"}>
                  {plan.addonActive[a] ? "working" : "not working"}
                </span>
              </label>
            );
          })}
          {plan.status === "free" && (
            <p className="text-xs text-muted-foreground">Not billed: every add-on it is set up for works, on the plan or not.</p>
          )}
        </div>

        <div className="rounded-lg bg-muted px-3 py-2">
          {b.bill.lines.map((l) => (
            <div key={l.key} className="flex justify-between">
              <span>
                {PRICE_LABEL[l.key]}
                {l.quantity > 1 ? ` × ${l.quantity}` : ""}
              </span>
              <span>{formatPence(l.pence)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>{plan.status === "free" ? "Would be, a month" : "A month"}</span>
            <span>{formatPence(b.bill.total)}</span>
          </div>
        </div>

        {!plan.hasCard && (
          <div className="flex flex-wrap gap-2">
            {plan.status !== "free" ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void put({ billingStatus: "free" })}>
                Stop billing (not billed)
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void put({ billingStatus: "trialing", trialEndsAt: new Date(Date.now() + 14 * 864e5).toISOString() })}
              >
                Start a 14-day trial
              </Button>
            )}
            {plan.status !== "free" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const from = b.trialEndsAt && new Date(b.trialEndsAt) > new Date() ? new Date(b.trialEndsAt) : new Date();
                  void put({ billingStatus: "trialing", trialEndsAt: new Date(from.getTime() + 7 * 864e5).toISOString() });
                }}
              >
                Give 7 more trial days
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
