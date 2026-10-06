"use client";

/**
 * AI call costs across every organisation, for super-admins: what each salon's
 * calls cost us, per call and per minute, what they are charged, and the
 * margin between.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { formatPence } from "@/lib/usage/cost";

interface Row {
  organizationId: string;
  calls: number;
  minutes: number;
  markupPercent: number | null;
  costPence: number;
  costPerCallPence: number | null;
  costPerMinutePence: number | null;
  chargePence: number | null;
  marginPence: number | null;
  labCostPence: number;
}

const money = (p: number | null) => (p === null ? "—" : formatPence(p));

function shiftMonth(anchor: string, by: number): string {
  const [y, m] = anchor.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 10);
}

export function AdminUsageTable({ names }: { names: Record<string, string> }) {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [data, setData] = useState<{ period: { anchor: string; label: string }; organizations: Row[]; usdToGbp: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/usage?period=month${anchor ? `&anchor=${anchor}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setData(d));
    return () => {
      live = false;
    };
  }, [anchor]);

  if (!data) return null;
  const rows = [...data.organizations].sort((a, b) => b.costPence + b.labCostPence - (a.costPence + a.labCostPence));
  const total = rows.reduce(
    (t, r) => ({
      calls: t.calls + r.calls,
      minutes: t.minutes + r.minutes,
      cost: t.cost + r.costPence,
      charge: t.charge + (r.chargePence ?? 0),
      margin: t.margin + (r.marginPence ?? 0),
      lab: t.lab + r.labCostPence,
    }),
    { calls: 0, minutes: 0, cost: 0, charge: 0, margin: 0, lab: 0 }
  );

  const right = { align: "right" } as const;
  const columns: ColumnDef<Row>[] = [
    {
      id: "organisation",
      header: "Organisation",
      accessorFn: (r) => names[r.organizationId] ?? "—",
      meta: { className: "font-medium" },
      footer: "All organisations",
    },
    { id: "calls", header: "Calls", accessorKey: "calls", meta: right, footer: () => total.calls },
    {
      id: "minutes",
      header: "Minutes",
      accessorFn: (r) => r.minutes,
      meta: right,
      cell: ({ row: { original: r } }) => Math.round(r.minutes),
      footer: () => Math.round(total.minutes),
    },
    {
      id: "cost",
      header: "Our cost",
      accessorFn: (r) => r.costPence,
      meta: right,
      cell: ({ row: { original: r } }) => money(r.costPence),
      footer: () => formatPence(total.cost),
    },
    {
      id: "perCall",
      header: "Per call",
      accessorFn: (r) => r.costPerCallPence ?? -1,
      meta: right,
      cell: ({ row: { original: r } }) => money(r.costPerCallPence),
      footer: () => (total.calls ? formatPence(total.cost / total.calls) : "—"),
    },
    {
      id: "perMinute",
      header: "Per minute",
      accessorFn: (r) => r.costPerMinutePence ?? -1,
      meta: right,
      cell: ({ row: { original: r } }) => money(r.costPerMinutePence),
      footer: () => (total.minutes ? formatPence(total.cost / total.minutes) : "—"),
    },
    {
      id: "markup",
      header: "Markup",
      accessorFn: (r) => r.markupPercent ?? -1,
      meta: right,
      cell: ({ row: { original: r } }) =>
        r.markupPercent === null ? <span className="text-muted-foreground">not set</span> : `${r.markupPercent}%`,
      footer: () => null,
    },
    {
      id: "charged",
      header: "Charged",
      accessorFn: (r) => r.chargePence ?? -1,
      meta: right,
      cell: ({ row: { original: r } }) => money(r.chargePence),
      footer: () => formatPence(total.charge),
    },
    {
      id: "margin",
      header: "Margin",
      accessorFn: (r) => r.marginPence ?? -1,
      meta: { ...right, className: "text-emerald-700" },
      cell: ({ row: { original: r } }) => money(r.marginPence),
      footer: () => formatPence(total.margin),
    },
    {
      id: "lab",
      header: "Lab testing",
      accessorFn: (r) => r.labCostPence,
      meta: { ...right, className: "text-muted-foreground" },
      cell: ({ row: { original: r } }) => money(r.labCostPence),
      footer: () => formatPence(total.lab),
    },
  ];

  return (
    <section className="space-y-3" aria-labelledby="ai-call-costs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ai-call-costs" className="font-heading text-base font-semibold">
          AI call costs
        </h2>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setAnchor(shiftMonth(data.period.anchor, -1))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-28 text-center text-sm font-semibold">{data.period.label}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setAnchor(shiftMonth(data.period.anchor, 1))}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.organizationId}
        empty={<p className="px-5 py-8 text-center text-sm text-muted-foreground">No calls this month.</p>}
      />
      <p className="text-[11px] text-muted-foreground">
        Our cost is what the providers bill (Vapi as reported; our own receptionist worked out from its usage),
        shown at $1 = £{data.usdToGbp}. Lab testing is on our bill but never charged to the salon.
      </p>
    </section>
  );
}
