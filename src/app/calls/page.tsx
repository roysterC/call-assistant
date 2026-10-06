"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, PersonCell, type ColumnDef } from "@/components/ui/data-table";
import { OUTCOME_STYLE, STATUS_BADGE } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { UsageSummary } from "@/components/usage/usage-summary";
import { formatPence } from "@/lib/usage/cost";

interface Call {
  id: string;
  phoneNumber: string;
  duration: number;
  /** What the call came to; empty for calls from before this was kept. */
  outcomes: string[];
  createdAt: string;
  lead: { name: string | null; company: string | null } | null;
  /** What the salon is charged for this call; null until a markup is set. */
  chargePence?: number | null;
  /** What it cost us. Only present for super-admins. */
  costPence?: number;
}

const PAGE = 20;

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(async (page: number) => {
    const res = await apiFetch(`/api/calls?page=${page}&limit=${PAGE}`);
    if (!res.ok) throw new Error();
    return (await res.json()) as { calls: Call[]; total: number };
  }, []);

  useEffect(() => {
    fetchPage(1)
      .then((d) => {
        setCalls(d.calls || []);
        setTotal(d.total || 0);
      })
      .catch((error) => console.error("Failed to fetch calls:", error))
      .finally(() => setLoading(false));
  }, [fetchPage]);

  async function showMore() {
    setLoadingMore(true);
    try {
      const d = await fetchPage(Math.floor(calls.length / PAGE) + 1);
      setCalls((prev) => [...prev, ...(d.calls || [])]);
      setTotal(d.total || 0);
    } catch (error) {
      console.error("Failed to fetch calls:", error);
    } finally {
      setLoadingMore(false);
    }
  }

  // Money columns appear only when the server sent money: charges once the
  // salon has a markup, our cost only to super-admins.
  const showCharge = calls.some((c) => c.chargePence !== null && c.chargePence !== undefined);
  const showCost = calls.some((c) => c.costPence !== undefined);

  const columns = useMemo<ColumnDef<Call>[]>(
    () => [
      {
        id: "caller",
        header: "Caller",
        enableSorting: false,
        cell: ({ row: { original: c } }) => (
          <PersonCell
            name={c.lead?.name || "Unknown caller"}
            detail={[c.phoneNumber, c.lead?.company].filter(Boolean).join(" · ")}
          />
        ),
      },
      {
        id: "duration",
        header: "Duration",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row: { original: c } }) => formatDuration(c.duration),
      },
      ...(showCharge
        ? [
            {
              id: "charge",
              header: "Charge",
              enableSorting: false,
              meta: { align: "right" },
              cell: ({ row: { original: c } }) => (c.chargePence != null ? formatPence(c.chargePence) : "—"),
            } satisfies ColumnDef<Call>,
          ]
        : []),
      ...(showCost
        ? [
            {
              id: "cost",
              header: "Cost",
              enableSorting: false,
              meta: { align: "right", className: "text-indigo-700" },
              cell: ({ row: { original: c } }) => (c.costPence !== undefined ? formatPence(c.costPence) : "—"),
            } satisfies ColumnDef<Call>,
          ]
        : []),
      {
        // What the call came to. Nothing of what was said is kept.
        id: "outcome",
        header: "Outcome",
        enableSorting: false,
        cell: ({ row: { original: c } }) =>
          c.outcomes?.length ? (
            <span className="flex flex-wrap gap-1">
              {c.outcomes.map((o) => {
                const style = OUTCOME_STYLE[o] ?? { label: o, className: "" };
                return (
                  <span key={o} className={cn(STATUS_BADGE, style.className)}>
                    {style.label}
                  </span>
                );
              })}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "date",
        header: "Date",
        enableSorting: false,
        meta: { className: "whitespace-nowrap text-muted-foreground" },
        cell: ({ row: { original: c } }) => format(new Date(c.createdAt), "d MMM, HH:mm"),
      },
    ],
    [showCharge, showCost]
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Call history" />

      <UsageSummary />

      <DataTable
        columns={columns}
        data={calls}
        getRowId={(c) => c.id}
        loading={loading}
        total={total}
        onShowMore={showMore}
        loadingMore={loadingMore}
        noun="calls"
        empty={
          <EmptyState
            icon={Phone}
            title="No calls recorded yet"
            hint="Every call your receptionist answers is listed here with what it came to: booked, moved, cancelled, a message, or a hang-up."
          />
        }
      />
    </div>
  );
}
