"use client";

/**
 * This month's AI calls at a glance: how many, how long, and what they came to.
 *
 * What it shows depends on who is looking, and the server decides that: an
 * owner's response has charges only (and no money at all until a markup is
 * set), a super-admin's adds the cost underneath and the margin. This
 * component renders whatever it was given.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { formatPence } from "@/lib/usage/cost";

interface Usage {
  period: { anchor: string; label: string };
  calls: number;
  minutes: number;
  priced: boolean;
  chargePence: number | null;
  chargePerCallPence: number | null;
  chargePerMinutePence: number | null;
  // Super-admins only.
  markupPercent?: number | null;
  costPence?: number;
  costPerCallPence?: number | null;
  costPerMinutePence?: number | null;
  marginPence?: number | null;
  sources?: { vapiPence: number; receptionistPence: number };
  lab?: { conversations: number; minutes: number; costPence: number };
  assumptions?: { usdToGbp: number };
}

const money = (p: number | null | undefined) => (p === null || p === undefined ? "—" : formatPence(p));

function shiftMonth(anchor: string, by: number): string {
  const [y, m] = anchor.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 10);
}

export function UsageSummary() {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch(`/api/usage?period=month${anchor ? `&anchor=${anchor}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Usage) => {
        if (live) setUsage(d);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [anchor]);

  if (failed || !usage) return null;
  const admin = usage.costPence !== undefined;

  return (
    <div className="rounded-xl border border-border bg-card shadow-surface">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => setAnchor(shiftMonth(usage.period.anchor, -1))}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-28 text-center font-heading text-sm font-semibold">{usage.period.label}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => setAnchor(shiftMonth(usage.period.anchor, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <Figure label="Calls" value={usage.calls.toLocaleString()} />
        <Figure label="Minutes" value={Math.round(usage.minutes).toLocaleString()} />
        {usage.priced && (
          <>
            <Figure label="Charges" value={money(usage.chargePence)} strong />
            <Figure label="Per call" value={money(usage.chargePerCallPence)} />
            <Figure label="Per minute" value={money(usage.chargePerMinutePence)} />
          </>
        )}
      </div>

      {admin && (
        <div className="border-t border-border bg-indigo-50/60 px-5 py-3.5 rounded-b-xl">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-indigo-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Super-admin only · the salon never sees this
          </p>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Figure label="Our cost" value={money(usage.costPence)} strong />
            <Figure label="Cost per call" value={money(usage.costPerCallPence)} />
            <Figure label="Cost per minute" value={money(usage.costPerMinutePence)} />
            <Figure
              label={usage.markupPercent === null ? "Margin (no markup set)" : `Margin (${usage.markupPercent}% markup)`}
              value={money(usage.marginPence)}
            />
            <Figure
              label="Vapi / our receptionist"
              value={`${money(usage.sources?.vapiPence)} / ${money(usage.sources?.receptionistPence)}`}
            />
            <Figure
              label={`Lab testing (${usage.lab?.conversations ?? 0}, not charged)`}
              value={money(usage.lab?.costPence)}
            />
          </div>
          {usage.markupPercent === null && (
            <p className="mt-2 text-xs text-muted-foreground">
              The salon sees calls and minutes but no charges until a markup is set in Admin → Organizations.
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Providers bill in US dollars; shown at $1 = £{usage.assumptions?.usdToGbp}.
          </p>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={strong ? "font-heading text-lg font-semibold tabular-nums" : "text-sm font-medium tabular-nums"}>
        {value}
      </p>
    </div>
  );
}
