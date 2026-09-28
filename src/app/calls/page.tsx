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

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

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
  const columns = 5 + (showCharge ? 1 : 0) + (showCost ? 1 : 0);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call history"
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
                <TableHead>Outcome</TableHead>
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
                      hint="Every call your receptionist answers is listed here with what it came to: booked, moved, cancelled, a message, or a hang-up."
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
                    {/* What the call came to. Nothing of what was said is kept. */}
                    <TableCell>
                      {call.outcomes?.length ? (
                        <span className="flex flex-wrap gap-1">
                          {call.outcomes.map((o) => {
                            const style = OUTCOME_STYLE[o] ?? { label: o, className: "" };
                            return (
                              <span key={o} className={cn(STATUS_BADGE, style.className)}>
                                {style.label}
                              </span>
                            );
                          })}
                        </span>
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
