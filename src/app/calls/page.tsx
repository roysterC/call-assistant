"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Phone, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { sentimentStyle, STATUS_BADGE } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { UsageSummary } from "@/components/usage/usage-summary";
import { formatPence } from "@/lib/usage/cost";

interface Call {
  id: string;
  vapiCallId: string;
  phoneNumber: string;
  duration: number;
  summary: string | null;
  sentiment: string | null;
  createdAt: string;
  lead: { name: string | null; company: string | null } | null;
  /** What the salon is charged for this call; null until a markup is set. */
  chargePence?: number | null;
  /** What it cost us. Only present for super-admins. */
  costPence?: number;
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedSummary, setExpandedSummary] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCalls() {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/calls?page=${page}&limit=20`);
        const data = await res.json();
        setCalls(data.calls || []);
        setTotalPages(data.totalPages || 1);
      } catch (error) {
        console.error("Failed to fetch calls:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchCalls();
  }, [page]);

  // Money columns appear only when the server sent money: charges once the
  // salon has a markup, our cost only to super-admins.
  const showCharge = calls.some((c) => c.chargePence !== null && c.chargePence !== undefined);
  const showCost = calls.some((c) => c.costPence !== undefined);
  const columns = 6 + (showCharge ? 1 : 0) + (showCost ? 1 : 0);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call history"
        description="All calls handled by your AI assistant"
      />

      <UsageSummary />

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caller</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                {showCharge && <TableHead className="text-right">Charge</TableHead>}
                {showCost && <TableHead className="text-right">Cost</TableHead>}
                <TableHead>Sentiment</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={columns} className="text-center py-12">
                    <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
                  </TableCell>
                </TableRow>
              ) : calls.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns} className="p-0">
                    <EmptyState
                      icon={Phone}
                      title="No calls recorded yet"
                      hint="Every call your assistant answers is logged here with a summary and how the caller sounded."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                calls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell>
                      <span
                        className={
                          call.lead?.name
                            ? "font-medium"
                            : "text-muted-foreground italic"
                        }
                      >
                        {call.lead?.name || "Unknown caller"}
                      </span>
                      {call.lead?.company && (
                        <span className="text-xs text-muted-foreground block">
                          {call.lead.company}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {call.phoneNumber}
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums">
                      {formatDuration(call.duration)}
                    </TableCell>
                    {showCharge && (
                      <TableCell className="text-sm text-right tabular-nums">
                        {call.chargePence != null ? formatPence(call.chargePence) : "—"}
                      </TableCell>
                    )}
                    {showCost && (
                      <TableCell className="text-sm text-right tabular-nums text-indigo-700">
                        {call.costPence !== undefined ? formatPence(call.costPence) : "—"}
                      </TableCell>
                    )}
                    {/*
                      Sentiment is the one column here that carries a judgement,
                      so it gets the shared meaning-colours. It used to take the
                      Badge "default" variant for positive — the near-white
                      primary — while the dashboard drew the same fact in green.
                    */}
                    <TableCell>
                      {call.sentiment ? (
                        (() => {
                          const s = sentimentStyle(call.sentiment);
                          return (
                            <span
                              className={cn(STATUS_BADGE, s.className)}
                            >
                              {s.label}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {/* Same button treatment as the leads table's Issue cell. */}
                    <TableCell className="max-w-sm">
                      {call.summary ? (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSummary(
                              expandedSummary === call.id ? null : call.id
                            )
                          }
                          aria-expanded={expandedSummary === call.id}
                          className={cn(
                            "text-sm text-left text-muted-foreground hover:text-foreground transition-colors w-full",
                            expandedSummary === call.id
                              ? "whitespace-normal"
                              : "truncate"
                          )}
                        >
                          {call.summary}
                        </button>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(call.createdAt), "d MMM, HH:mm")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
