"use client";

/**
 * AI call costs across every organisation, for super-admins: what each salon's
 * calls cost us, per call and per minute, what they are charged, and the
 * margin between.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  return (
    <Card className="py-0 gap-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-4">
        <CardTitle>AI call costs</CardTitle>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setAnchor(shiftMonth(data.period.anchor, -1))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-28 text-center text-sm font-semibold">{data.period.label}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setAnchor(shiftMonth(data.period.anchor, 1))}>
            <ChevronRight />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organisation</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Minutes</TableHead>
              <TableHead className="text-right">Our cost</TableHead>
              <TableHead className="text-right">Per call</TableHead>
              <TableHead className="text-right">Per minute</TableHead>
              <TableHead className="text-right">Markup</TableHead>
              <TableHead className="text-right">Charged</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="text-right">Lab testing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.organizationId}>
                <TableCell className="font-medium">{names[r.organizationId] ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.calls}</TableCell>
                <TableCell className="text-right tabular-nums">{Math.round(r.minutes)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.costPence)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.costPerCallPence)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.costPerMinutePence)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.markupPercent === null ? <span className="text-muted-foreground">not set</span> : `${r.markupPercent}%`}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(r.chargePence)}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-700">{money(r.marginPence)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{money(r.labCostPence)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
              <TableCell>All organisations</TableCell>
              <TableCell className="text-right tabular-nums">{total.calls}</TableCell>
              <TableCell className="text-right tabular-nums">{Math.round(total.minutes)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPence(total.cost)}</TableCell>
              <TableCell className="text-right tabular-nums">{total.calls ? formatPence(total.cost / total.calls) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{total.minutes ? formatPence(total.cost / total.minutes) : "—"}</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">{formatPence(total.charge)}</TableCell>
              <TableCell className="text-right tabular-nums text-emerald-700">{formatPence(total.margin)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{formatPence(total.lab)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="px-4 py-3 text-[11px] text-muted-foreground border-t">
          Our cost is what the providers bill (Vapi as reported; our own receptionist worked out from its usage),
          shown at $1 = £{data.usdToGbp}. Lab testing is on our bill but never charged to the salon.
        </p>
      </CardContent>
    </Card>
  );
}
