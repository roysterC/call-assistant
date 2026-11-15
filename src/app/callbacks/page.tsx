"use client";

/**
 * Callbacks: people waiting for the salon to ring them back.
 *
 * A list to work down, longest wait first, rather than a table: each one
 * says what they want in their own words, how long they have waited, where
 * they left it (a call, WhatsApp, Instagram…) and who it is for. Picking one
 * shows it in full beside the list (in a sheet on a phone) with Call, their
 * chat and Book, a little about them, and "How did it go?": Booked, Sorted
 * and Not needed move it to Done; No answer counts the try and keeps it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronDown } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { callbacksChanged } from "@/lib/use-pending-callbacks";
import { useT } from "@/components/providers/language-provider";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CallbackCard,
  CallbackDetail,
  displayName,
  outcomeLabel,
  type CallbackRow,
  type DoneOutcome,
} from "@/components/callbacks/callback-parts";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/lib/use-is-phone";

type View = "todo" | "done";
const ALL = "";

export default function CallbacksPage() {
  const { t } = useT();
  const { notify } = useDialogs();
  const [view, setView] = useState<View>("todo");
  const [rows, setRows] = useState<CallbackRow[]>([]);
  const [timeZone, setTimeZone] = useState("Europe/London");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A phone shows the one picked in a sheet over the list.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [forWho, setForWho] = useState(ALL);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [todoCount, setTodoCount] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const isPhone = useIsPhone();

  const load = useCallback(async (v: View) => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await apiFetch(`/api/callbacks?view=${v}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const list: CallbackRow[] = data.callbacks ?? [];
      setRows(list);
      setTimeZone(data.timeZone ?? "Europe/London");
      if (v === "todo") setTodoCount(list.length);
      setNow(Date.now());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(view);
  }, [view, load]);

  // The waits keep counting while the page is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Who they can be for: the names on the list, so a stylist can see just theirs.
  const people = useMemo(
    () => [...new Set(rows.map((r) => r.assignedTo).filter((n) => n && n !== "Team" && n !== "Anyone"))].sort(),
    [rows]
  );
  const shown = useMemo(
    () => rows.filter((r) => forWho === ALL || r.assignedTo === forWho),
    [rows, forWho]
  );
  // On a wide screen the first is open from the start.
  const selected = shown.find((r) => r.id === selectedId) ?? shown[0] ?? null;

  function pick(id: string) {
    setSelectedId(id);
    setNote("");
    setSheetOpen(true);
  }

  async function patch(cb: CallbackRow, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await apiFetch("/api/callbacks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cb.id, ...body }),
      });
      if (!res.ok) throw new Error();
      callbacksChanged();
      return true;
    } catch {
      notify(t("callbacks.saveFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Off the list, and the next one up in its place. */
  function removeAndMoveOn(cb: CallbackRow) {
    const i = shown.findIndex((r) => r.id === cb.id);
    const next = shown[i + 1] ?? shown[i - 1] ?? null;
    setRows((all) => all.filter((r) => r.id !== cb.id));
    setSelectedId(next?.id ?? null);
    setNote("");
    setSheetOpen(false);
  }

  async function done(cb: CallbackRow, outcome: DoneOutcome) {
    if (!(await patch(cb, { action: "done", outcome, note: note.trim() || undefined }))) return;
    removeAndMoveOn(cb);
    setTodoCount((n) => (n === null ? n : Math.max(0, n - 1)));
    notify(t("callbacks.markedAs", { name: displayName(cb, t), outcome: outcomeLabel(t, outcome, "completed") }), "success");
  }

  async function noAnswer(cb: CallbackRow) {
    if (!(await patch(cb, { action: "no_answer", note: note.trim() || undefined }))) return;
    const at = new Date().toISOString();
    setRows((all) => all.map((r) => (r.id === cb.id ? { ...r, attempts: r.attempts + 1, lastAttemptAt: at } : r)));
    setNote("");
    setSheetOpen(false);
    notify(t("callbacks.triedNoted", { name: displayName(cb, t) }), "success");
  }

  async function undo(cb: CallbackRow) {
    if (!(await patch(cb, { action: "undo" }))) return;
    removeAndMoveOn(cb);
    setTodoCount((n) => (n === null ? n : n + 1));
  }

  const n = todoCount ?? 0;
  const subtitle =
    view === "done"
      ? t("callbacks.subtitleDone")
      : n === 0
        ? t("callbacks.subtitleNone")
        : n === 1
          ? t("callbacks.subtitleOne")
          : t("callbacks.subtitleMany", { n });

  const detail = (onClose?: () => void) =>
    selected && (
      <CallbackDetail
        key={selected.id}
        cb={selected}
        timeZone={timeZone}
        busy={busy}
        note={note}
        onNote={setNote}
        onDone={(o) => void done(selected, o)}
        onNoAnswer={() => void noAnswer(selected)}
        onUndo={() => void undo(selected)}
        onClose={onClose}
      />
    );

  return (
    <div className="flex h-full overflow-hidden">
      <section aria-label={t("callbacks.title")} className="flex w-full min-w-0 flex-col border-r border-border md:w-[25rem] md:shrink-0 lg:w-[31rem]">
        <div className="shrink-0 px-4 pb-3 pt-5 md:px-5">
          <h1 className="font-heading text-[26px] font-extrabold tracking-tight">{t("callbacks.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{loading && todoCount === null ? " " : subtitle}</p>
          <div className="mt-3.5 flex items-center gap-2">
            <div role="tablist" aria-label={t("callbacks.show")} className="flex rounded-xl bg-muted p-[3px]">
              {(["todo", "done"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => {
                    setView(v);
                    setSelectedId(null);
                    setSheetOpen(false);
                  }}
                  className={cn(
                    "h-8 rounded-[9px] px-3.5 text-[13.5px] font-semibold transition-colors",
                    view === v ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`callbacks.tab.${v}`)}
                  {v === "todo" && todoCount !== null && ` · ${todoCount}`}
                </button>
              ))}
            </div>
            {people.length > 0 && (
              <label className="relative ml-auto">
                <span className="sr-only">{t("callbacks.forLabel")}</span>
                <select
                  value={forWho}
                  onChange={(e) => setForWho(e.target.value)}
                  className="h-9 appearance-none rounded-[10px] border border-border bg-card pl-3 pr-8 text-[13px] font-semibold"
                >
                  <option value={ALL}>{t("callbacks.forEveryone")}</option>
                  {people.map((p) => (
                    <option key={p} value={p}>
                      {t("callbacks.forOne", { name: p })}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </label>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:px-5">
          {failed ? (
            <p role="alert" className="py-6 text-sm text-red-600">
              {t("callbacks.loadFailed")}
            </p>
          ) : loading ? (
            <div className="flex flex-col gap-2.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={view === "todo" ? t("callbacks.emptyTodo") : t("callbacks.emptyDone")}
              hint={view === "todo" ? t("callbacks.emptyTodoHint") : t("callbacks.emptyDoneHint")}
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {shown.map((cb) => (
                <li key={cb.id}>
                  <CallbackCard cb={cb} selected={selected?.id === cb.id} onPick={() => pick(cb.id)} now={now} timeZone={timeZone} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Beside the list on a wide screen. */}
      <section aria-label={selected ? displayName(selected, t) : undefined} className="hidden min-w-0 flex-1 flex-col bg-card md:flex">
        {isPhone ? null : selected ? (
          detail()
        ) : (
          !loading && <p className="m-auto text-sm text-muted-foreground">{t("callbacks.pickOne")}</p>
        )}
      </section>

      {/* A sheet over the list on a phone. */}
      {isPhone && sheetOpen && selected && (
        <div className="fixed inset-0 z-50 flex flex-col bg-foreground/35 md:hidden" onClick={() => setSheetOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={displayName(selected, t)}
            className="mt-10 flex min-h-0 flex-1 flex-col rounded-t-3xl bg-card pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-tea-green-700" aria-hidden="true" />
            {detail(() => setSheetOpen(false))}
          </div>
        </div>
      )}
    </div>
  );
}
