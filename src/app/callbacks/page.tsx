"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  PersonCell,
  SubText,
  TableTabs,
  TableToolbar,
  type ColumnDef,
} from "@/components/ui/data-table";
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
import { callbacksChanged } from "@/lib/use-pending-callbacks";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { callbackStatus, STATUS_BADGE } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/language-provider";
import { DATE_FNS_LOCALE, type MessageKey } from "@/lib/i18n";

const OUTCOMES = ["converted", "no_answer", "not_interested", "follow_up", "other"] as const;
type Outcome = (typeof OUTCOMES)[number];
const isOutcome = (v: string | null): v is Outcome => (OUTCOMES as readonly (string | null)[]).includes(v);

const STATUSES = ["pending", "completed", "missed"] as const;
const EMPTY: Record<string, { title: MessageKey; hint: MessageKey }> = {
  pending: { title: "callbacks.noPending", hint: "callbacks.pendingHint" },
  completed: { title: "callbacks.noCompleted", hint: "callbacks.completedHint" },
  missed: { title: "callbacks.noMissed", hint: "callbacks.missedHint" },
};

interface Callback {
  id: string;
  assignedTo: string;
  createdAt: string;
  status: string;
  outcome: string | null;
  completedAt: string | null;
  notes: string | null;
  lead: { name: string | null; phone: string | null; company: string | null };
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
  const { t, lang } = useT();
  const outcomeLabel = (o: string | null) => (isOutcome(o) ? t(`callbacks.outcome.${o}`) : (o ?? ""));

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
      callbacksChanged();
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
      callbacksChanged();
    } catch (error) {
      console.error("Failed to complete callback:", error);
    } finally {
      setSubmitting(false);
    }
  }

  const columns: ColumnDef<Callback>[] = [
    {
      id: "customer",
      header: t("callbacks.customer"),
      accessorFn: (cb) => cb.lead.name ?? "",
      cell: ({ row: { original: cb } }) => (
        <PersonCell
          name={cb.lead.name || t("callbacks.unknown")}
          detail={[cb.lead.phone, cb.lead.company].filter(Boolean).join(" · ")}
        />
      ),
    },
    {
      // When the caller rang (there is no due time), and who it is for.
      id: "called",
      header: t("callbacks.called"),
      accessorFn: (cb) => cb.createdAt,
      meta: { className: "whitespace-nowrap text-muted-foreground" },
      cell: ({ row: { original: cb } }) => (
        <>
          {format(new Date(cb.createdAt), "d MMM, HH:mm", { locale: DATE_FNS_LOCALE[lang] })}
          {cb.assignedTo && <SubText>{t("callbacks.for", { name: cb.assignedTo })}</SubText>}
        </>
      ),
    },
    {
      id: "notes",
      header: t("callbacks.notes"),
      enableSorting: false,
      cell: ({ row: { original: cb } }) =>
        cb.notes ? (
          <button
            type="button"
            onClick={() => setExpandedNotes(expandedNotes === cb.id ? null : cb.id)}
            aria-expanded={expandedNotes === cb.id}
            className={cn(
              "block w-full max-w-60 text-left text-muted-foreground transition-colors hover:text-foreground",
              expandedNotes === cb.id ? "whitespace-normal" : "truncate"
            )}
          >
            {cb.notes}
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    ...(filter === "completed"
      ? [
          {
            id: "outcome",
            header: t("callbacks.outcome"),
            accessorFn: (cb) => outcomeLabel(cb.outcome),
            cell: ({ row: { original: cb } }) =>
              cb.outcome ? (
                <span className={cn(STATUS_BADGE, callbackStatus("completed").className)}>
                  {outcomeLabel(cb.outcome)}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          } satisfies ColumnDef<Callback>,
        ]
      : []),
    ...(filter === "pending"
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">{t("callbacks.actions")}</span>,
            enableSorting: false,
            meta: { align: "right" },
            cell: ({ row: { original: cb } }) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="outline" onClick={() => openCompleteDialog(cb)} title={t("callbacks.completeTitle")}>
                  <Check className="mr-1 h-3 w-3" />
                  {t("callbacks.complete")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => updateStatus(cb.id, "missed")} title={t("callbacks.missedTitle")}>
                  <X className="mr-1 h-3 w-3" />
                  {t("callbacks.missed")}
                </Button>
              </div>
            ),
          } satisfies ColumnDef<Callback>,
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("callbacks.title")}
      />

      <TableToolbar>
        <TableTabs
          label={t("callbacks.show")}
          value={filter}
          onChange={setFilter}
          items={STATUSES.map((status) => ({
            value: status,
            label: t(`callbacks.status.${status}`),
          }))}
        />
      </TableToolbar>

      <DataTable
        columns={columns}
        data={callbacks}
        getRowId={(cb) => cb.id}
        loading={loading}
        pageSize={25}
        noun={t("callbacks.noun")}
        empty={
          <EmptyState
            icon={CalendarClock}
            title={t((EMPTY[filter] ?? EMPTY.pending).title)}
            hint={t((EMPTY[filter] ?? EMPTY.pending).hint)}
          />
        }
      />

      {/* Mark Complete dialog */}
      <Dialog
        open={completeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCompleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("callbacks.markComplete")}</DialogTitle>
          </DialogHeader>
          {completeTarget && (
            <div className="space-y-4">
              <div className="text-sm">
                <span className="text-muted-foreground">{t("callbacks.customerLabel")} </span>
                <span className="font-medium">
                  {completeTarget.lead.name || completeTarget.lead.phone}
                </span>
              </div>
              <div>
                <label className="text-sm font-medium">{t("callbacks.outcome")}</label>
                <Select
                  value={outcome}
                  onValueChange={(v) => v && setOutcome(v)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOMES.map((o) => (
                      <SelectItem key={o} value={o}>
                        {t(`callbacks.outcome.${o}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">
                  {t("callbacks.completionNotes")}{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    {t("callbacks.optional")}
                  </span>
                </label>
                <Textarea
                  className="mt-1"
                  placeholder={t("callbacks.notesPlaceholder")}
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
              {t("common.cancel")}
            </Button>
            <Button onClick={submitComplete} disabled={submitting}>
              {submitting ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
