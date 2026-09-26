"use client";

/**
 * The receptionist lab: a phone call, typed.
 *
 * For getting our own receptionist right before it has a voice: what it says,
 * which tools it reaches for, and how long the first word takes. Everything it
 * does goes through the real booking code against the real diary.
 */

import { useEffect, useRef, useState } from "react";
import { FlaskConical, PhoneOff, Play, Send, TriangleAlert, Wrench } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-fetch";
import { VoiceLab } from "@/components/receptionist/voice-lab";
import { formatPence } from "@/lib/usage/cost";
import { cn } from "@/lib/utils";

type ToolRun = { name: string; input: Record<string, unknown>; result: unknown; isError: boolean };

type Line =
  | {
      kind: "assistant";
      text: string;
      firstTextMs?: number | null;
      totalMs?: number;
      cacheRead?: number;
      /** What the turn cost us; only sent to super-admins. */
      costPence?: number;
    }
  | { kind: "caller"; text: string }
  | { kind: "tool"; run: ToolRun }
  | { kind: "note"; text: string };

const TOOL_LABEL: Record<string, string> = {
  save_customer_details: "Saved the caller's details",
  check_availability: "Checked the diary",
  book_appointment: "Booked an appointment",
  find_appointment: "Looked up a booking",
  cancel_appointment: "Cancelled a booking",
  reschedule_appointment: "Moved a booking",
  book_callback: "Booked a callback",
  transfer_call: "Transferred the call",
};

export default function ReceptionistLabPage() {
  const [callerNumber, setCallerNumber] = useState("07700 900123");
  // Typing tests what it says; talking tests how it sounds and how quickly.
  const [mode, setMode] = useState<"type" | "talk">("type");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [keySource, setKeySource] = useState<"salon" | "shared" | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, busy]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/receptionist/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start the call.");
        return;
      }
      setSessionId(data.sessionId);
      setModel(data.model);
      setKeySource(data.keySource ?? null);
      setLines([
        {
          kind: "note",
          text: data.callerNumber ? `Call from ${data.callerNumber}` : "Call from a withheld number",
        },
        { kind: "assistant", text: data.greeting },
      ]);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const hangUp = async () => {
    if (sessionId) {
      await apiFetch(`/api/receptionist/lab?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    setSessionId(null);
    setLines((ls) => [...ls, { kind: "note", text: "Call ended" }]);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !sessionId || busy) return;
    setDraft("");
    setBusy(true);
    setError(null);
    setLines((ls) => [...ls, { kind: "caller", text }]);
    try {
      const res = await apiFetch("/api/receptionist/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "That turn failed.");
        if (res.status === 404) setSessionId(null);
        return;
      }
      setLines((ls) => [
        ...ls,
        ...((data.tools ?? []) as ToolRun[]).map((run) => ({ kind: "tool" as const, run })),
        {
          kind: "assistant",
          text: data.reply,
          firstTextMs: data.firstTextMs,
          totalMs: data.totalMs,
          cacheRead: data.usage?.cacheRead,
          costPence: data.costPence,
        },
        ...(data.ended ? [{ kind: "note" as const, text: "The receptionist ended the call" }] : []),
      ]);
      if (data.ended) setSessionId(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receptionist lab"
        description="Try our own receptionist by typing or by talking, the way a caller would."
      />

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          This uses the real diary. Anything it books, moves or cancels really happens, and
          confirmation texts go to the caller number below. Use a test number, and tidy up
          the diary after.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit" role="tablist" aria-label="How to talk to it">
        {(["type", "talk"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            disabled={Boolean(sessionId)}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
              mode === m ? "bg-card text-foreground shadow-surface" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m === "type" ? "Type" : "Talk"}
          </button>
        ))}
      </div>

      {mode === "talk" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <VoiceLab callerNumber={callerNumber} />
          <Card className="gap-3 h-fit">
            <CardContent className="space-y-2">
              <label className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">Calling from</span>
                <Input value={callerNumber} onChange={(e) => setCallerNumber(e.target.value)} placeholder="Withheld" />
              </label>
              <p className="text-xs text-muted-foreground">
                Pause when you have finished speaking; the receptionist answers after a short
                silence. Talk over it to interrupt.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card className="py-0 gap-0 min-h-[60vh]">
          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3 max-h-[65vh]">
            {lines.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
                <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
                  <FlaskConical className="w-5 h-5" />
                </div>
                <p className="text-sm font-medium text-foreground">No call yet</p>
                <p className="text-xs mt-1 max-w-xs">
                  Set the number the call comes from, then start the call. Leave it blank to
                  test a withheld number.
                </p>
              </div>
            )}
            {lines.map((line, i) => (
              <LineView key={i} line={line} />
            ))}
            {busy && sessionId && (
              <div className="text-xs text-muted-foreground px-1">Receptionist is answering…</div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="border-t border-border p-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={sessionId ? "What the caller says…" : "Start a call first"}
              disabled={!sessionId}
              className="h-10"
              aria-label="What the caller says"
            />
            <Button type="submit" className="h-10 px-4 gap-1.5" disabled={!sessionId || busy || !draft.trim()}>
              <Send className="h-4 w-4" />
              Say
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="gap-3">
            <CardContent className="space-y-3">
              <label className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">Calling from</span>
                <Input
                  value={callerNumber}
                  onChange={(e) => setCallerNumber(e.target.value)}
                  placeholder="Withheld"
                  disabled={Boolean(sessionId)}
                />
              </label>
              {sessionId ? (
                <Button variant="outline" className="w-full gap-1.5" onClick={hangUp}>
                  <PhoneOff className="h-4 w-4" />
                  Hang up
                </Button>
              ) : (
                <Button className="w-full gap-1.5" onClick={start} disabled={busy}>
                  <Play className="h-4 w-4" />
                  {lines.length ? "Start a new call" : "Start the call"}
                </Button>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
            </CardContent>
          </Card>
          {model && (
            <Card className="gap-2">
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p>
                  Model <span className="font-mono text-foreground">{model}</span>
                </p>
                {keySource && (
                  <p>
                    Charged to{" "}
                    <span className="text-foreground">
                      {keySource === "salon" ? "this salon's own API key" : "the shared API key"}
                    </span>
                  </p>
                )}
                <p>
                  The time under each reply is how long until its first word, then until the
                  whole reply. On the phone, the first number is the silence the caller hears.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function LineView({ line }: { line: Line }) {
  if (line.kind === "note") {
    return <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">{line.text}</p>;
  }
  if (line.kind === "caller") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[min(75%,52ch)] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {line.text}
        </p>
      </div>
    );
  }
  if (line.kind === "tool") {
    const { run } = line;
    return (
      <details className="group mx-auto max-w-[90%] rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground">
          <Wrench className={cn("h-3.5 w-3.5", run.isError ? "text-red-600" : "text-primary")} />
          <span className="text-foreground">{TOOL_LABEL[run.name] ?? run.name}</span>
          <span className="font-mono">{run.name}</span>
          {run.isError && <span className="text-red-600">failed</span>}
        </summary>
        <div className="mt-2 grid gap-2">
          <pre className="whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-[11px]">
            {JSON.stringify(run.input, null, 2)}
          </pre>
          <pre className="whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-[11px]">
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </div>
      </details>
    );
  }
  return (
    <div className="flex flex-col items-start">
      <p className="max-w-[min(75%,52ch)] rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2.5 text-sm">
        {line.text}
      </p>
      {line.totalMs !== undefined && (
        <span className="mt-1 px-1 text-[11px] tabular-nums text-muted-foreground">
          {line.firstTextMs != null ? `${(line.firstTextMs / 1000).toFixed(1)}s to first word · ` : ""}
          {(line.totalMs / 1000).toFixed(1)}s total
          {line.cacheRead ? ` · ${line.cacheRead.toLocaleString()} tokens from cache` : ""}
          {line.costPence !== undefined ? ` · cost ${formatPence(line.costPence)}` : ""}
        </span>
      )}
    </div>
  );
}
