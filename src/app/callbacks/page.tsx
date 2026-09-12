"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CalendarClock, Check, X } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { callbackStatus, STATUS_BADGE } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

const OUTCOMES: Array<{ value: string; label: string }> = [
  { value: "converted", label: "Converted" },
  { value: "no_answer", label: "No answer" },
  { value: "not_interested", label: "Not interested" },
  { value: "follow_up", label: "Needs follow-up" },
  { value: "other", label: "Other" },
];

const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(
  OUTCOMES.map((o) => [o.value, o.label])
);

interface Callback {
  id: string;
  assignedTo: string;
  scheduledAt: string;
  status: string;
  outcome: string | null;
  completedAt: string | null;
  notes: string | null;
  lead: { name: string | null; phone: string; company: string | null };
}

export default function CallbacksPage() {
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [expandedNotes, setExpandedNotes] = useState<string | null>(null);

  // Mark-complete dialog state
  const [completeTarget, setCompleteTarget] = useState<Callback | null>(null);
  const [outcome, setOutcome] = useState<string>("converted");
  const [completionNotes, setCompletionNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchCallbacks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/callbacks?status=${filter}`);
      const data = await res.json();
      setCallbacks(data.callbacks || []);
    } catch (error) {
      console.error("Failed to fetch callbacks:", error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchCallbacks();
  }, [fetchCallbacks]);

  async function updateStatus(id: string, status: string) {
    try {
      await apiFetch("/api/callbacks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      fetchCallbacks();
    } catch (error) {
      console.error("Failed to update callback:", error);
    }
  }

  function openCompleteDialog(cb: Callback) {
    setCompleteTarget(cb);
    setOutcome("converted");
    setCompletionNotes("");
  }

  async function submitComplete() {
    if (!completeTarget) return;
    setSubmitting(true);
    try {
      // Preserve existing notes, append the completion notes below a separator.
      const mergedNotes = completionNotes
        ? completeTarget.notes
          ? `${completeTarget.notes}\n\n---\n[Completed] ${completionNotes}`
          : `[Completed] ${completionNotes}`
        : completeTarget.notes;

      await apiFetch("/api/callbacks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: completeTarget.id,
          status: "completed",
          outcome,
          notes: mergedNotes,
        }),
      });
      setCompleteTarget(null);
      fetchCallbacks();
    } catch (error) {
      console.error("Failed to complete callback:", error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Callbacks"
        description="Scheduled follow-up calls with customers"
      />

      <div className="flex gap-1">
        {["pending", "completed", "missed"].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            aria-pressed={filter === status}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              filter === status
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            {callbackStatus(status).label}
          </button>
        ))}
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Status</TableHead>
                {filter === "completed" && <TableHead>Outcome</TableHead>}
                {filter === "pending" && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
                  </TableCell>
                </TableRow>
              ) : callbacks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState
                      icon={CalendarClock}
                      title={`No ${filter} callbacks`}
                      hint={
                        filter === "pending"
                          ? "When a caller asks for a call back, it lands here with the time they wanted."
                          : `Callbacks you mark as ${filter} will be listed here.`
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                callbacks.map((cb) => (
                  <TableRow key={cb.id}>
                    <TableCell>
                      <span
                        className={
                          cb.lead.name
                            ? "font-medium"
                            : "text-muted-foreground italic"
                        }
                      >
                        {cb.lead.name || "Unknown"}
                      </span>
                      {cb.lead.company && (
                        <span className="text-xs text-muted-foreground block">
                          {cb.lead.company}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {cb.lead.phone}
                    </TableCell>
                    <TableCell className="text-sm">{cb.assignedTo}</TableCell>
                    {/*
                      A pending callback whose time has passed is the only thing
                      on this page anyone is in a hurry about, and the column
                      gave no sign of it — every row looked equally calm.
                    */}
                    <TableCell className="text-sm whitespace-nowrap">
                      {format(new Date(cb.scheduledAt), "d MMM, HH:mm")}
                      {cb.status === "pending" &&
                        new Date(cb.scheduledAt) < new Date() && (
                          <span className="block text-[11px] text-amber-400">
                            Overdue
                          </span>
                        )}
                    </TableCell>
                    {/* Same expand treatment as the leads and calls tables. */}
                    <TableCell className="max-w-xs">
                      {cb.notes ? (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedNotes(
                              expandedNotes === cb.id ? null : cb.id
                            )
                          }
                          aria-expanded={expandedNotes === cb.id}
                          className={cn(
                            "text-sm text-left text-muted-foreground hover:text-foreground transition-colors w-full",
                            expandedNotes === cb.id
                              ? "whitespace-normal"
                              : "truncate"
                          )}
                        >
                          {cb.notes}
                        </button>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const s = callbackStatus(cb.status);
                        return (
                          <span className={cn(STATUS_BADGE, s.className)}>
                            {s.label}
                          </span>
                        );
                      })()}
                    </TableCell>
                    {filter === "completed" && (
                      <TableCell>
                        {cb.outcome ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {OUTCOME_LABEL[cb.outcome] || cb.outcome}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    )}
                    {filter === "pending" && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openCompleteDialog(cb)}
                            title="Mark complete with outcome"
                          >
                            <Check className="w-3 h-3 mr-1" />
                            Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(cb.id, "missed")}
                            title="Mark missed"
                          >
                            <X className="w-3 h-3 mr-1" />
                            Missed
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mark Complete dialog */}
      <Dialog
        open={completeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCompleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark callback complete</DialogTitle>
          </DialogHeader>
          {completeTarget && (
            <div className="space-y-4">
              <div className="text-sm">
                <span className="text-muted-foreground">Customer: </span>
                <span className="font-medium">
                  {completeTarget.lead.name || completeTarget.lead.phone}
                </span>
              </div>
              <div>
                <label className="text-sm font-medium">Outcome</label>
                <Select
                  value={outcome}
                  onValueChange={(v) => v && setOutcome(v)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOMES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">
                  Completion notes{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <Textarea
                  className="mt-1"
                  placeholder="What happened on the call?"
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCompleteTarget(null)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={submitComplete} disabled={submitting}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
