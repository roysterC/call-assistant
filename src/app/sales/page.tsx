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
import { ChevronDown, ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { plural } from "@/lib/plural";
import { APPOINTMENT_STATUS, STATUS_BADGE } from "@/lib/status-styles";
import { DataTable, PersonCell, type ColumnDef } from "@/components/ui/data-table";
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

  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const columns: ColumnDef<SaleRow>[] = [
    {
      id: "client",
      header: "Client",
      accessorFn: (r) => r.clientName ?? "Walk-in",
      cell: ({ row: { original: r } }) => <PersonCell name={r.clientName ?? "Walk-in"} detail={r.serviceText} />,
    },
    {
      id: "date",
      header: "Date",
      accessorFn: (r) => r.startsAt,
      meta: { className: "whitespace-nowrap tabular-nums text-muted-foreground" },
      cell: ({ row: { original: r } }) => when.format(new Date(r.startsAt)),
    },
    { id: "stylist", header: "Stylist", accessorKey: "stylistName", meta: { className: "whitespace-nowrap" } },
    {
      id: "status",
      header: "Status",
      accessorFn: (r) => (APPOINTMENT_STATUS[r.status] ?? APPOINTMENT_STATUS.booked).label,
      cell: ({ row: { original: r } }) => {
        const tone = APPOINTMENT_STATUS[r.status] ?? APPOINTMENT_STATUS.booked;
        return <span className={cn(STATUS_BADGE, tone.className)}>{tone.label}</span>;
      },
    },
    {
      // A figure in brackets is the list price, not money taken.
      id: "amount",
      header: "Amount",
      accessorFn: (r) => r.amountMinor ?? -1,
      meta: { align: "right", className: "whitespace-nowrap" },
      cell: ({ row: { original: r } }) =>
        r.amountMinor !== null ? (
          formatMoney(r.amountMinor)
        ) : (
          <span className="text-muted-foreground">
            {r.listPriceMinor !== null ? `(${formatMoney(r.listPriceMinor)})` : "—"}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales"
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      {totals && (
        <div className="grid gap-px bg-border border border-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Taken
            </p>
            <p className="text-2xl font-semibold tabular-nums text-tea-green-200">
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
          <Breakdown title="By stylist" noun="stylist" items={totals.byStylist} />
          <Breakdown title="By service" noun="service" items={totals.byService.slice(0, 8)} />
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        loading={loading}
        initialSorting={[{ id: "date", desc: false }]}
        pageSize={50}
        noun="appointments"
        empty={
          <span className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Receipt className="h-4 w-4" />
            Nothing in this {PERIOD_LABEL[kind].toLowerCase()}.
          </span>
        }
      />

      <p className="text-xs text-muted-foreground">
        A figure in brackets is the list price, not money taken — the
        appointment has not been marked done with an amount. Only real amounts
        are counted in the total.
      </p>
    </div>
  );
}

/**
 * Closed until asked for: the totals and the bookings are what the page is
 * for, and two lists of bars above the table pushed it off the screen. The
 * summary names the biggest, which is usually what anyone opens it to see.
 */
function Breakdown({
  title,
  noun,
  items,
}: {
  title: string;
  /** "stylist": the summary reads "4 stylists". */
  noun: string;
  items: Array<{ name: string; minor: number; count: number }>;
}) {
  const max = Math.max(...items.map((i) => i.minor), 1);
  const top = items.reduce<(typeof items)[number] | null>((a, i) => (!a || i.minor > a.minor ? i : a), null);
  return (
    <details className="group self-start rounded-md border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">
            {plural(items.length, noun)}
            {top && top.minor > 0 && (
              <>
                {" "}· top: {top.name} {formatMoney(top.minor)}
              </>
            )}
          </span>
          <ChevronDown aria-hidden className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <ul className="space-y-2 border-t border-border p-4">
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
                className="h-full bg-tea-green-300/70"
                style={{ width: `${(i.minor / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
