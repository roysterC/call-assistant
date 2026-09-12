"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

interface Call {
  id: string;
  vapiCallId: string;
  phoneNumber: string;
  duration: number;
  summary: string | null;
  sentiment: string | null;
  createdAt: string;
  lead: { name: string | null; company: string | null } | null;
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caller</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Sentiment</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
                  </TableCell>
                </TableRow>
              ) : calls.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-0">
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
                    <TableCell className="font-medium">
                      {call.lead?.name || "Unknown"}
                      {call.lead?.company && (
                        <span className="text-xs text-muted-foreground block">
                          {call.lead.company}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{call.phoneNumber}</TableCell>
                    <TableCell className="text-sm">{formatDuration(call.duration)}</TableCell>
                    <TableCell>
                      {call.sentiment && (
                        <Badge
                          variant={
                            call.sentiment === "positive"
                              ? "default"
                              : call.sentiment === "negative"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {call.sentiment}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-sm text-muted-foreground cursor-pointer ${expandedSummary === call.id ? "whitespace-normal" : "max-w-xs truncate"}`}
                      onClick={() => setExpandedSummary(expandedSummary === call.id ? null : call.id)}
                      title={expandedSummary !== call.id ? "Click to expand" : "Click to collapse"}
                    >
                      {call.summary || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(call.createdAt), "MMM d, h:mm a")}
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
