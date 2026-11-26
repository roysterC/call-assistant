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
import { bookingHref } from "@/lib/booking-link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/language-provider";
import { dateClockTime } from "@/lib/i18n";
import { formatMoney, formatMoneyShort } from "@/lib/money";
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


const DEFAULT_TZ = "Europe/London";

/** The statuses with a name of their own in every language. */
const STATUSES = ["booked", "completed", "cancelled", "no_show"] as const;

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
  const router = useRouter();
  const { t, clock, locale } = useT();
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
        setError(data.error || t("sales.loadFailed"));
        setRows([]);
        setTotals(null);
        return;
      }
      setRows(data.rows ?? []);
      setTotals(data.totals ?? null);
    } catch {
      setError(t("common.noServer"));
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [kind, anchor, t]);

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

  // "24 Nov, 2:30pm", on the person's own 12- or 24-hour clock.
  const when = { format: (at: Date) => dateClockTime(at, clock, timeZone, locale, { weekday: false }) };
  const statusLabel = (status: string) =>
    (STATUSES as readonly string[]).includes(status) ? t(`status.${status as (typeof STATUSES)[number]}`) : status.replace(/_/g, " ");
  const columns: ColumnDef<SaleRow>[] = [
    {
      id: "client",
      header: t("sales.client"),
      accessorFn: (r) => r.clientName ?? t("sales.walkIn"),
      cell: ({ row: { original: r } }) => <PersonCell name={r.clientName ?? t("sales.walkIn")} detail={r.serviceText} />,
    },
    {
      id: "date",
      header: t("sales.date"),
      accessorFn: (r) => r.startsAt,
      meta: { className: "whitespace-nowrap tabular-nums text-muted-foreground" },
      cell: ({ row: { original: r } }) => when.format(new Date(r.startsAt)),
    },
    { id: "stylist", header: t("sales.stylist"), accessorKey: "stylistName", meta: { className: "whitespace-nowrap" } },
    {
      id: "status",
      header: t("sales.status"),
      accessorFn: (r) => statusLabel(r.status),
      cell: ({ row: { original: r } }) => {
        const tone = APPOINTMENT_STATUS[r.status] ?? APPOINTMENT_STATUS.booked;
        return <span className={cn(STATUS_BADGE, tone.className)}>{statusLabel(r.status)}</span>;
      },
    },
    {
      // A figure in brackets is the list price, not money taken.
      id: "amount",
      header: t("sales.amount"),
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
        title={t("sales.title")}
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
              {t(`sales.period.${k}`)}
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(shiftPeriod(kind, anchor, -1))}
          aria-label={t("sales.previous")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(shiftPeriod(kind, anchor, 1))}
          aria-label={t("sales.next")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(today)}
          disabled={isCurrent}
        >
          {t(`sales.this.${kind}`)}
        </Button>

        <span className="text-sm font-semibold ml-1">
          {describePeriod(period, locale)}
        </span>
        {loading && (
          <span className="text-xs text-muted-foreground">{t("sales.loading")}</span>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {totals && (
        <div className="grid gap-px bg-border border border-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("sales.taken")}
            </p>
            <p className="text-2xl font-semibold tabular-nums text-tea-green-200">
              {formatMoneyShort(totals.takenMinor)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("sales.finished", { n: totals.takenCount })}
              {totals.unpricedCount > 0 && t("sales.noFigure", { n: totals.unpricedCount })}
            </p>
          </div>

          <div className="bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("sales.stillBooked")}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoneyShort(totals.expectedMinor)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("sales.atListPrice", { n: totals.bookedCount })}
            </p>
          </div>

          <div className="bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("sales.average")}
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
            <p className="text-xs text-muted-foreground mt-1">{t("sales.perFinished")}</p>
          </div>

          <div className="bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("sales.noShows")}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {totals.noShowCount}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("sales.neitherTotal")}
            </p>
          </div>
        </div>
      )}

      {totals && totals.byStylist.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown title={t("sales.byStylist")} count={t("sales.stylists", { n: totals.byStylist.length })} items={totals.byStylist} />
          <Breakdown title={t("sales.byService")} count={t("sales.services", { n: Math.min(8, totals.byService.length) })} items={totals.byService.slice(0, 8)} />
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        // A sale is a booking: it opens in the diary, on its day.
        onRowClick={(r) => router.push(bookingHref(r.id, r.startsAt, timeZone))}
        rowLabel={(r) => `${r.clientName ?? t("sales.walkIn")}, ${r.serviceText}`}
        loading={loading}
        initialSorting={[{ id: "date", desc: false }]}
        pageSize={50}
        noun={t("sales.noun")}
        empty={
          <span className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Receipt className="h-4 w-4" />
            {t(`sales.nothingIn.${kind}`)}
          </span>
        }
      />

      <p className="text-xs text-muted-foreground">
        {t("sales.footnote")}
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
  count,
  items,
}: {
  title: string;
  /** "4 nail technicians": how many are in it. */
  count: string;
  items: Array<{ name: string; minor: number; count: number }>;
}) {
  const { t } = useT();
  const max = Math.max(...items.map((i) => i.minor), 1);
  const top = items.reduce<(typeof items)[number] | null>((a, i) => (!a || i.minor > a.minor ? i : a), null);
  return (
    <details className="group self-start rounded-md border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">
            {count}
            {top && top.minor > 0 && t("sales.top", { name: top.name, amount: formatMoney(top.minor) })}
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
