"use client";

/**
 * Takings for a day, a week, a month or a year.
 *
 * Two totals, never added together. "Taken" is money the desk actually
 * recorded against a finished appointment. "Still booked" is what the diary
 * holds at list price. One is revenue and the other is a hope, and a report
 * that sums them is how a salon ends up arguing with its own accountant.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { APPOINTMENT_STATUS } from "@/lib/status-styles";
import {
  describePeriod,
  PERIOD_KINDS,
  resolvePeriod,
  shiftPeriod,
  type PeriodKind,
} from "@/lib/sales-period";

interface SaleRow {
  id: string;
  date: string;
  startsAt: string;
  clientName: string | null;
  serviceText: string;
  stylistName: string;
  status: string;
  source: string;
  amountMinor: number | null;
  listPriceMinor: number | null;
}

interface Totals {
  takenMinor: number;
  expectedMinor: number;
  takenCount: number;
  unpricedCount: number;
  bookedCount: number;
  noShowCount: number;
  byStylist: Array<{ name: string; minor: number; count: number }>;
  byService: Array<{ name: string; minor: number; count: number }>;
}

const PERIOD_LABEL: Record<PeriodKind, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

const DEFAULT_TZ = "Europe/London";

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function SalesPage() {
  const [timeZone, setTimeZone] = useState(DEFAULT_TZ);
  const [kind, setKind] = useState<PeriodKind>("month");
  const [anchor, setAnchor] = useState(() => todayIn(DEFAULT_TZ));

  const [rows, setRows] = useState<SaleRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/settings");
        const { settings } = await res.json();
        if (settings?.timezone) {
          setTimeZone(settings.timezone);
          setAnchor(todayIn(settings.timezone));
        }
      } catch {
        // Defaults are fine; the window is still correct for London.
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/sales?period=${kind}&anchor=${anchor}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not load the figures.");
        setRows([]);
        setTotals(null);
        return;
      }
      setRows(data.rows ?? []);
      setTotals(data.totals ?? null);
    } catch {
      setError("Could not reach the server.");
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [kind, anchor]);

  useEffect(() => {
    load();
  }, [load]);

  const period = useMemo(
    () => resolvePeriod(kind, anchor, timeZone),
    [kind, anchor, timeZone]
  );

  const today = todayIn(timeZone);
  const isCurrent = useMemo(() => {
    const now = resolvePeriod(kind, today, timeZone);
    return now.firstDate === period.firstDate;
  }, [kind, today, timeZone, period.firstDate]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales"
        description="What the salon took, and what is still in the diary."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border overflow-hidden">
          {PERIOD_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={cn(
                "px-3 py-1.5 text-xs transition-colors",
                kind === k
                  ? "bg-accent text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              {PERIOD_LABEL[k]}
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(shiftPeriod(kind, anchor, -1))}
          aria-label="Previous period"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(shiftPeriod(kind, anchor, 1))}
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(today)}
          disabled={isCurrent}
        >
          This {PERIOD_LABEL[kind].toLowerCase()}
        </Button>

        <span className="text-sm font-semibold ml-1">
          {describePeriod(period)}
        </span>
        {loading && (
          <span className="text-xs text-muted-foreground">loading…</span>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {totals && (
        <div className="grid gap-px bg-border border border-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Taken
            </p>
            <p className="text-2xl font-semibold tabular-nums text-emerald-400">
              {formatMoneyShort(totals.takenMinor)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {totals.takenCount} finished
              {totals.unpricedCount > 0 &&
                ` · ${totals.unpricedCount} with no figure`}
            </p>
          </div>

          <div className="bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Still booked
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoneyShort(totals.expectedMinor)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {totals.bookedCount} at list price
            </p>
          </div>

          <div className="bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Average
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoneyShort(
                totals.takenCount - totals.unpricedCount > 0
                  ? Math.round(
                      totals.takenMinor /
                        (totals.takenCount - totals.unpricedCount)
                    )
                  : null
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">per finished appointment</p>
          </div>

          <div className="bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              No shows
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {totals.noShowCount}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              counted in neither total
            </p>
          </div>
        </div>
      )}

      {totals && totals.byStylist.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown title="By stylist" items={totals.byStylist} />
          <Breakdown title="By service" items={totals.byService.slice(0, 8)} />
        </div>
      )}

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Stylist</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={6}>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                    <Receipt className="h-4 w-4" />
                    Nothing in this {PERIOD_LABEL[kind].toLowerCase()}.
                  </span>
                </TableCell>
              </TableRow>
            )}

            {rows.map((r) => {
              const tone =
                APPOINTMENT_STATUS[r.status] ?? APPOINTMENT_STATUS.booked;
              return (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums whitespace-nowrap">
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone,
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(r.startsAt))}
                  </TableCell>
                  <TableCell>{r.clientName ?? "Walk-in"}</TableCell>
                  <TableCell>{r.serviceText}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.stylistName}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-xs whitespace-nowrap",
                        tone.className
                      )}
                    >
                      {tone.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {r.amountMinor !== null ? (
                      formatMoney(r.amountMinor)
                    ) : (
                      <span className="text-muted-foreground">
                        {r.listPriceMinor !== null
                          ? `(${formatMoney(r.listPriceMinor)})`
                          : "—"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        A figure in brackets is the list price, not money taken — the
        appointment has not been marked done with an amount. Only real amounts
        are counted in the total.
      </p>
    </div>
  );
}

function Breakdown({
  title,
  items,
}: {
  title: string;
  items: Array<{ name: string; minor: number; count: number }>;
}) {
  const max = Math.max(...items.map((i) => i.minor), 1);
  return (
    <div className="rounded-md border border-border p-4">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-3">
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.name} className="grid gap-1">
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate">{i.name}</span>
              <span className="tabular-nums whitespace-nowrap">
                {formatMoney(i.minor)}
                <span className="text-muted-foreground text-xs ml-2">
                  ×{i.count}
                </span>
              </span>
            </div>
            {/* One scale across the list, so the bars are comparable. */}
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500/70"
                style={{ width: `${(i.minor / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
